// The hideout's picture for «Убежище» (src/hideout/hideoutViews.ts) from the offline game copy's plugin RaidOsHideout
// (E:\SPT-photo\hideout): node scripts/hideout-views.mjs [<plugin out folder>]
//
// Owner, 20.11.2026: «Постоянно один ракурс, но модули разные… картинка вставляется с новым модулем, прям кусок картинки, только
// чтобы все стыки, все совпадало». The plugin's sweep shot the hideout from one camera: for each light (the Illumination level
// 0–3) the base with every module at level 0, and every module alone at each of its levels on that base. Here each of those is
// compared with its base: what changed (near the module's own objects) becomes a piece with a soft edge, the rest of the frame is
// dropped. The app lays the pieces of the levels the player built on the base of the player's light, so the joins match.
// Rooms behind the defective wall (rooms-mask.png, made from the plugin's position map) are drawn black until the wall is broken.
//
// Writes src/assets/hideout-views/*.webp and src/data/hideoutViews.json. Only pictures and numbers: nothing of the game itself.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = process.argv[2] ?? 'E:/SPT/BepInEx/plugins/RaidOsHideout/out'
const sweep = join(source, 'sweep')
const root = fileURLToPath(new URL('..', import.meta.url))
const assets = join(root, 'src/assets/hideout-views')
const dataFile = join(root, 'src/data/hideoutViews.json')
const MAX_WIDTH = 1920
/** The wall's level from which the rooms behind it are open (the breach: level 5 of the defective wall). */
const WALL_OPEN_LEVEL = 5
/** Pixels round a module's own objects where a change still counts as the module's (light it throws, its shadow). */
const MARGIN = 28
/** A change below LOW (0–255, after a light blur) is the game's noise; at HIGH and above the piece is fully opaque. */
const LOW = 7
const HIGH = 24
// The game's camera sees a lot of empty dark ground round the hideout: the picture is cut to it (the brightest base decides).
const LIT = 24

const probe = JSON.parse(readFileSync(join(source, 'probe.json'), 'utf8'))
const idOf = new Map(probe.areas.filter((area) => area.id).map((area) => [area.type, area.id]))
const lights = readdirSync(sweep).filter((name) => /^L\d$/.test(name)).map((name) => Number(name.slice(1))).sort()
if (!lights.length) throw new Error(`no sweep in ${sweep}`)

/** A picture as raw RGB (the plugin writes it without alpha; any alpha is dropped before anything else). */
async function rgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Each channel's 3×3 neighbourhood mean (the game's grain mostly averages out), inside `region` ([x0, y0, x1, y1]) or the whole
 * picture; outside the region the values stay 0.
 */
function blurred(image, region = [0, 0, image.width, image.height]) {
  const { data, width, height } = image
  const out = new Float32Array(width * height * 3)
  const [x0, y0, x1, y1] = region
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0, count = 0
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const yy = y + dy, xx = x + dx
        if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue
        sum += data[(yy * width + xx) * 3 + c]; count += 1
      }
      out[(y * width + x) * 3 + c] = sum / count
    }
  }
  return out
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const toPixels = (rect, width, height) => rect && [
  clamp(Math.floor(rect[0] * width) - MARGIN, 0, width), clamp(Math.floor(rect[1] * height) - MARGIN, 0, height),
  clamp(Math.ceil(rect[2] * width) + MARGIN, 0, width), clamp(Math.ceil(rect[3] * height) + MARGIN, 0, height),
]
const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])

/**
 * The piece of `frame` that differs from `base` inside `region` ([x0, y0, x1, y1] pixels): RGBA, alpha from how much it differs
 * (soft, a little widened and smoothed so the edge does not show), cut to where it is not empty; null when nothing changed there.
 */
function piece(frame, base, frameBlur, baseBlur, region) {
  const { width } = frame
  const [x0, y0, x1, y1] = region
  const w = x1 - x0, h = y1 - y0
  if (w <= 0 || h <= 0) return null
  const soft = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const at = ((y + y0) * width + (x + x0)) * 3
    const change = Math.max(Math.abs(frameBlur[at] - baseBlur[at]), Math.abs(frameBlur[at + 1] - baseBlur[at + 1]), Math.abs(frameBlur[at + 2] - baseBlur[at + 2]))
    soft[y * w + x] = clamp((change - LOW) / (HIGH - LOW), 0, 1)
  }
  // widened by 2 px (the change's own edge), then smoothed over 5×5
  const wide = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let most = 0
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const yy = y + dy, xx = x + dx
      if (yy >= 0 && xx >= 0 && yy < h && xx < w) most = Math.max(most, soft[yy * w + xx])
    }
    wide[y * w + x] = most
  }
  const alpha = new Uint8Array(w * h)
  let left = w, top = h, right = -1, bottom = -1, solid = 0
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let sum = 0, count = 0
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const yy = y + dy, xx = x + dx
      if (yy >= 0 && xx >= 0 && yy < h && xx < w) { sum += wide[yy * w + xx]; count += 1 }
    }
    const value = Math.round(255 * clamp(sum / count, 0, 1))
    alpha[y * w + x] = value
    if (value > 6) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
    if (value > 200) solid += 1
  }
  // a few scattered pixels are noise, not a module
  if (right < 0 || solid < 40) return null
  const pw = right - left + 1, ph = bottom - top + 1
  const out = Buffer.alloc(pw * ph * 4)
  for (let y = 0; y < ph; y += 1) for (let x = 0; x < pw; x += 1) {
    const from = ((y + top + y0) * width + (x + left + x0)) * 3
    const to = (y * pw + x) * 4
    out[to] = frame.data[from]; out[to + 1] = frame.data[from + 1]; out[to + 2] = frame.data[from + 2]
    out[to + 3] = alpha[(y + top) * w + (x + left)]
  }
  return { data: out, x: x0 + left, y: y0 + top, width: pw, height: ph }
}

/** The cut of the whole picture: rows and columns of the brightest base with enough lit pixels, plus the buttons, with a margin. */
function contentBox(image, points, margin = 0.03) {
  const lit = (x, y) => { const i = (y * image.width + x) * 3; return Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) > LIT }
  const rows = [], cols = new Array(image.width).fill(0)
  for (let y = 0; y < image.height; y += 1) { let count = 0; for (let x = 0; x < image.width; x += 1) if (lit(x, y)) { count += 1; cols[x] += 1 } rows.push(count) }
  const first = (list) => list.findIndex((count) => count > 6), last = (list) => list.length - 1 - [...list].reverse().findIndex((count) => count > 6)
  let left = first(cols), right = last(cols), top = first(rows), bottom = last(rows)
  for (const [x, y] of points) { left = Math.min(left, x * image.width); right = Math.max(right, x * image.width); top = Math.min(top, y * image.height); bottom = Math.max(bottom, y * image.height) }
  const padX = margin * image.width, padY = margin * image.height
  left = Math.max(0, Math.floor(left - padX)); top = Math.max(0, Math.floor(top - padY))
  right = Math.min(image.width, Math.ceil(right + padX)); bottom = Math.min(image.height, Math.ceil(bottom + padY))
  return { left, top, width: right - left, height: bottom - top }
}

rmSync(assets, { recursive: true, force: true })
mkdirSync(assets, { recursive: true })

// The buttons: the game's own icon point of every module, on the brightest base.
const brightest = lights.at(-1)
const baseMeta = JSON.parse(readFileSync(join(sweep, `L${brightest}`, 'base.json'), 'utf8'))
const SKIP = new Set(['WeaponStandSecondary', 'ChristmasIllumination'])
const rawSpots = {}
for (const area of baseMeta.areas ?? []) {
  const id = idOf.get(area.type)
  if (!id || SKIP.has(area.type) || area.depth <= 0 || area.x < 0.01 || area.x > 0.99 || area.y < 0.01 || area.y > 0.99) continue
  rawSpots[id] = [area.x, area.y]
}
const brightBase = await rgb(join(sweep, `L${brightest}`, 'base.png'))
const box = contentBox(brightBase, Object.values(rawSpots))
const scale = Math.min(1, MAX_WIDTH / box.width)
const outWidth = Math.round(box.width * scale), outHeight = Math.round(box.height * scale)
/** A rectangle of the full frame in the picture's own pixels (after the cut and the scale). */
const place = (x, y, w, h) => [Math.round((x - box.left) * scale), Math.round((y - box.top) * scale), Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]

// Buttons that would lie on one another are pushed apart a little (the generator, the vents and the solar panel are a hand apart).
const SPACING = 0.042
const aspect = outHeight / outWidth
const placed = Object.entries(rawSpots).map(([id, [x, y]]) => ({ id, x: (x * brightBase.width - box.left) / box.width, y: ((y * brightBase.height - box.top) / box.height) * aspect }))
for (let round = 0; round < 300; round += 1) {
  let moved = false
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) {
    const a = placed[i], b = placed[j]
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy)
    if (distance >= SPACING) continue
    const push = (SPACING - distance) / 2 + 1e-4
    const ux = distance > 1e-5 ? dx / distance : 1, uy = distance > 1e-5 ? dy / distance : 0
    a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push
    moved = true
  }
  if (!moved) break
}
const spots = Object.fromEntries(placed.map((spot) => [spot.id, [Number(spot.x.toFixed(4)), Number((spot.y / aspect).toFixed(4))]]))

async function writePicture(raw, channels, width, height, crop, file, quality) {
  let image = sharp(raw, { raw: { width, height, channels } })
  if (crop) image = sharp(await image.extract(crop).raw().toBuffer(), { raw: { width: crop.width, height: crop.height, channels } })
  if (scale < 1) image = image.resize(Math.max(1, Math.round((crop?.width ?? width) * scale)))
  await image.webp({ quality, alphaQuality: 90 }).toFile(file)
}

const pieces = {}
let pieceCount = 0
for (const light of lights) {
  const dir = join(sweep, `L${light}`)
  const base = await rgb(join(dir, 'base.png'))
  const baseBlur = blurred(base)
  await writePicture(base.data, 3, base.width, base.height, box, join(assets, `base-L${light}.webp`), 80)
  for (const file of readdirSync(dir).filter((name) => /^\w+-\d+\.png$/.test(name)).sort()) {
    const [, type, levelText] = /^(\w+)-(\d+)\.png$/.exec(file)
    const id = idOf.get(type)
    if (!id || SKIP.has(type)) continue
    const meta = JSON.parse(readFileSync(join(dir, file.replace(/\.png$/, '.json')), 'utf8'))
    const region = union(toPixels(meta.level0, base.width, base.height), toPixels(meta.rect, base.width, base.height))
    if (!region) continue
    const frame = await rgb(join(dir, file))
    const cut = piece(frame, base, blurred(frame, region), baseBlur, region)
    if (!cut) continue
    // the piece inside the picture's cut only
    const x0 = Math.max(cut.x, box.left), y0 = Math.max(cut.y, box.top)
    const x1 = Math.min(cut.x + cut.width, box.left + box.width), y1 = Math.min(cut.y + cut.height, box.top + box.height)
    if (x1 <= x0 || y1 <= y0) continue
    const level = Number(levelText)
    await writePicture(cut.data, 4, cut.width, cut.height, { left: x0 - cut.x, top: y0 - cut.y, width: x1 - x0, height: y1 - y0 }, join(assets, `${id}-${level}-L${light}.webp`), 82)
    ;((pieces[id] ??= {})[level] ??= {})[light] = place(x0, y0, x1 - x0, y1 - y0)
    pieceCount += 1
  }
}

// The rooms behind the defective wall: black where the mask is set, until the wall's breach.
let rooms
const roomsFile = join(sweep, 'rooms-mask.png')
if (existsSync(roomsFile)) {
  const { data, info } = await sharp(roomsFile).greyscale().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.alloc(info.width * info.height * 4)
  for (let i = 0; i < info.width * info.height; i += 1) { out[i * 4 + 3] = data[i] }
  const resized = info.width === brightBase.width ? out : await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(brightBase.width, brightBase.height).raw().toBuffer()
  await writePicture(resized, 4, brightBase.width, brightBase.height, box, join(assets, 'rooms.webp'), 70)
  // the modules whose button falls in a closed room
  const inside = Object.entries(rawSpots).filter(([, [x, y]]) => resized[(Math.round(y * (brightBase.height - 1)) * brightBase.width + Math.round(x * (brightBase.width - 1))) * 4 + 3] > 128).map(([id]) => id)
  rooms = { openLevel: WALL_OPEN_LEVEL, station: idOf.get('EmergencyWall'), inside }
}

const json = { size: [outWidth, outHeight], lights, lightStation: idOf.get('Illumination'), spots, pieces, ...(rooms ? { rooms } : {}) }
writeFileSync(dataFile, JSON.stringify(json) + '\n')
console.log(`picture ${outWidth}x${outHeight} (cut ${JSON.stringify(box)}), ${lights.length} lights, ${Object.keys(spots).length} buttons, ${pieceCount} pieces${rooms ? ', rooms mask' : ''}`)
