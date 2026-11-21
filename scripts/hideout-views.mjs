// The hideout's picture for «Убежище» (src/hideout/hideoutViews.ts) from the offline game copy's plugin RaidOsHideout
// (E:\SPT-photo\hideout): node scripts/hideout-views.mjs [<plugin out folder>]
//
// Owner, 20.11.2026: «Постоянно один ракурс, но модули разные… картинка вставляется с новым модулем, прям кусок картинки, только
// чтобы все стыки, все совпадало». The plugin's sweep shot the hideout from one camera: for each light (the Illumination level
// 0–3) the base with every module at level 0, and every module alone at each of its levels on that base. Here each of those is
// compared with its base: what changed (near the module's own objects) becomes a piece with a soft edge, the rest of the frame is
// dropped. The app lays the pieces of the levels the player built on the base of the player's light, so the joins match.
// The game itself draws the rooms behind the defective wall only from its breach (level 5): before it they are black on the base,
// and they come with the wall's own piece. The modules in those rooms were shot with the wall broken, on a base of their own
// (base-wall.png); the app shows them only once the wall is broken.
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
/** Pixels round the Christmas tree's icon point that make its piece. */
const TREE_RADIUS = 90
/**
 * The modules really behind the wall: their buttons wait for the breach. The med station, rest space and booze generator are shot on
 * the broken wall too (the game draws their room only from it) but are built before it (owner, 20.11.2026: «Все, что за стеной,
 * открывается после сноса стены… Все, что до этого, показывается»).
 */
const BEHIND_WALL = ['Gym', 'PlaceOfFame', 'EquipmentPresetsStand']
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

// The game's hideout from above is dark: every picture is lifted by one curve (from the brightest base), the same for the bases and
// the pieces, so the joins still match and a lower light still looks darker.
const TARGET_MEAN = 40
let curve = null

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
{
  // the lift: what brings the brightest base, with the rooms behind the wall open, to TARGET_MEAN
  const lit = existsSync(join(sweep, `L${brightest}`, 'base-wall.png')) ? await rgb(join(sweep, `L${brightest}`, 'base-wall.png')) : brightBase
  let sum = 0
  for (let index = 0; index < lit.data.length; index += 1) sum += lit.data[index]
  const mean = sum / lit.data.length
  const gamma = Math.min(1, Math.max(0.5, Math.log(TARGET_MEAN / 255) / Math.log(Math.max(1, mean) / 255)))
  curve = Uint8Array.from({ length: 256 }, (_, value) => Math.round(255 * (value / 255) ** gamma))
  console.log(`lift: mean ${mean.toFixed(1)} → gamma ${gamma.toFixed(2)}`)
}
const box = contentBox(brightBase, Object.values(rawSpots))
const scale = Math.min(1, MAX_WIDTH / box.width)
const outWidth = Math.round(box.width * scale), outHeight = Math.round(box.height * scale)
/** A rectangle of the full frame in the picture's own pixels (after the cut and the scale). */
const place = (x, y, w, h) => [Math.round((x - box.left) * scale), Math.round((y - box.top) * scale), Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]

// Buttons that would lie on one another are pushed apart a little (the generator, the vents and the solar panel are a hand apart).
const SPACING = 0.05
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
  if (curve) {
    raw = Buffer.from(raw)
    for (let index = 0; index < raw.length; index += channels) for (let c = 0; c < 3; c += 1) raw[index + c] = curve[raw[index + c]]
  }
  let image = sharp(raw, { raw: { width, height, channels } })
  if (crop) image = sharp(await image.extract(crop).raw().toBuffer(), { raw: { width: crop.width, height: crop.height, channels } })
  if (scale < 1) image = image.resize(Math.max(1, Math.round((crop?.width ?? width) * scale)))
  await image.webp({ quality, alphaQuality: 90 }).toFile(file)
}

const pieces = {}
let pieceCount = 0
/** Every module piece as cut (full-frame pixels, RGBA), by «TYPE-level-Llight»: the pairs are checked against them. */
const cuts = new Map()
/** Station id pair «a|b» → «la|lb» → light → [x, y, width, height]: the pairs' corrections (pairPieces). */
const pairs = {}
let pairCount = 0
/** A pair's correction is kept only when one of the two stackings is off by HIGH on at least this many pixels. */
const PAIR_PIXELS = 200

/**
 * Two neighbouring modules shot together (owner, 21.11.2026: «Каждый модуль с каждым, все вариации, которые находятся рядом. Чтобы
 * старые снимки не накладывались на новые. Полы должны быть новые, стены»): the plugin's `pairs` frames (L<light>/pairs/A-la+B-lb.png).
 * Where both modules' pieces cover the picture, the app lays them one over the other, and the upper one brings the lower module as it
 * was at level 0 (its floor, its walls, its light). Here the real frame of the two together is compared, in that overlap, with both
 * stackings of the pieces; when either is visibly off, the frame's overlap (widened and soft edged) becomes the pair's correction,
 * laid over both pieces whatever their order.
 */
async function pairPieces(light, dir, bases) {
  const folder = join(dir, 'pairs')
  if (!existsSync(folder)) return 0
  let count = 0
  const at = (cut, x, y) => {
    if (!cut || x < cut.x || y < cut.y || x >= cut.x + cut.width || y >= cut.y + cut.height) return null
    return ((y - cut.y) * cut.width + (x - cut.x)) * 4
  }
  for (const file of readdirSync(folder).filter((name) => /^\w+-\d+\+\w+-\d+\.png$/.test(name)).sort()) {
    const [, typeA, la, typeB, lb] = /^(\w+)-(\d+)\+(\w+)-(\d+)\.png$/.exec(file)
    const idA = idOf.get(typeA), idB = idOf.get(typeB)
    const A = cuts.get(`${typeA}-${la}-L${light}`), B = cuts.get(`${typeB}-${lb}-L${light}`)
    if (!idA || !idB || !A || !B) continue
    const x0 = Math.max(A.x, B.x, box.left), y0 = Math.max(A.y, B.y, box.top)
    const x1 = Math.min(A.x + A.width, B.x + B.width, box.left + box.width), y1 = Math.min(A.y + A.height, B.y + B.height, box.top + box.height)
    if (x1 <= x0 || y1 <= y0) continue
    const meta = JSON.parse(readFileSync(join(folder, file.replace(/\.png$/, '.json')), 'utf8'))
    const base = bases[meta.base ?? 'base'] ?? bases.base
    const frame = await rgb(join(folder, file))
    const { width } = frame
    // the overlap of the two pieces (alpha), and how far each stacking is from the real frame there
    const w = x1 - x0, h = y1 - y0
    const both = new Float32Array(w * h)
    let off = 0
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const ia = at(A, x, y), ib = at(B, x, y)
      const aa = ia === null ? 0 : A.data[ia + 3] / 255, ab = ib === null ? 0 : B.data[ib + 3] / 255
      if (aa < 0.15 || ab < 0.15) continue
      both[(y - y0) * w + (x - x0)] = Math.min(aa, ab)
      const f = (y * width + x) * 3
      let worst = 0
      for (let c = 0; c < 3; c += 1) {
        const under = base.data[f + c]
        const pa = A.data[ia + c], pb = B.data[ib + c]
        const aThenB = (under * (1 - aa) + pa * aa) * (1 - ab) + pb * ab
        const bThenA = (under * (1 - ab) + pb * ab) * (1 - aa) + pa * aa
        worst = Math.max(worst, Math.abs(aThenB - frame.data[f + c]), Math.abs(bThenA - frame.data[f + c]))
      }
      if (worst >= HIGH) off += 1
    }
    if (off < PAIR_PIXELS) continue
    // the overlap widened by 6 px and smoothed over 7×7: the correction's alpha
    const wide = new Float32Array(w * h)
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let most = 0
      for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
        const yy = y + dy, xx = x + dx
        if (yy >= 0 && xx >= 0 && yy < h && xx < w) most = Math.max(most, both[yy * w + xx])
      }
      wide[y * w + x] = most
    }
    let left = w, top = h, right = -1, bottom = -1
    const alpha = new Uint8Array(w * h)
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let sum = 0, n = 0
      for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
        const yy = y + dy, xx = x + dx
        if (yy >= 0 && xx >= 0 && yy < h && xx < w) { sum += wide[yy * w + xx]; n += 1 }
      }
      const value = Math.round(255 * clamp(sum / n, 0, 1))
      alpha[y * w + x] = value
      if (value > 6) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
    }
    if (right < 0) continue
    const pw = right - left + 1, ph = bottom - top + 1
    const out = Buffer.alloc(pw * ph * 4)
    for (let y = 0; y < ph; y += 1) for (let x = 0; x < pw; x += 1) {
      const from = ((y + top + y0) * width + (x + left + x0)) * 3
      const to = (y * pw + x) * 4
      out[to] = frame.data[from]; out[to + 1] = frame.data[from + 1]; out[to + 2] = frame.data[from + 2]
      out[to + 3] = alpha[(y + top) * w + (x + left)]
    }
    await writePicture(out, 4, pw, ph, null, join(assets, `pair-${idA}-${la}-${idB}-${lb}-L${light}.webp`), 72)
    ;((pairs[`${idA}|${idB}`] ??= {})[`${la}|${lb}`] ??= {})[light] = place(x0 + left, y0 + top, pw, ph)
    count += 1
  }
  console.log(`L${light}: ${count} pair corrections`)
  return count
}
/** Modules in the rooms behind the defective wall (shot on the base with the wall broken). */
const inside = new Set()
for (const light of lights) {
  const dir = join(sweep, `L${light}`)
  const bases = { base: await rgb(join(dir, 'base.png')) }
  if (existsSync(join(dir, 'base-wall.png'))) bases['base-wall'] = await rgb(join(dir, 'base-wall.png'))
  const blurs = Object.fromEntries(Object.entries(bases).map(([name, image]) => [name, blurred(image)]))
  const base = bases.base
  await writePicture(base.data, 3, base.width, base.height, box, join(assets, `base-L${light}.webp`), 80)
  for (const file of readdirSync(dir).filter((name) => /^\w+-\d+\.png$/.test(name)).sort()) {
    const [, type, levelText] = /^(\w+)-(\d+)\.png$/.exec(file)
    // the Christmas tree is no station of the app: its piece goes under «christmas» (shown in the season, hideout/hideoutViews.ts)
    const id = type === 'ChristmasIllumination' ? 'christmas' : idOf.get(type)
    if (!id || (SKIP.has(type) && type !== 'ChristmasIllumination')) continue
    const meta = JSON.parse(readFileSync(join(dir, file.replace(/\.png$/, '.json')), 'utf8'))
    // The tree's area also holds the garlands under the ceiling: their shadows lie over the whole hall, so its piece is the tree
    // alone, round the game's icon point of the area (it stands right there).
    const treeAt = type === 'ChristmasIllumination' ? (baseMeta.areas ?? []).find((area) => area.type === type) : undefined
    const region = treeAt
      ? [Math.round(treeAt.x * base.width) - TREE_RADIUS, Math.round(treeAt.y * base.height) - TREE_RADIUS, Math.round(treeAt.x * base.width) + TREE_RADIUS, Math.round(treeAt.y * base.height) + TREE_RADIUS]
      : union(toPixels(meta.level0, base.width, base.height), toPixels(meta.rect, base.width, base.height))
    if (!region) continue
    const against = bases[meta.base ?? 'base'] ? meta.base ?? 'base' : 'base'
    if (against === 'base-wall') inside.add(id)
    const frame = await rgb(join(dir, file))
    const cut = piece(frame, bases[against], blurred(frame, region), blurs[against], region)
    if (!cut) continue
    // the piece inside the picture's cut only
    const x0 = Math.max(cut.x, box.left), y0 = Math.max(cut.y, box.top)
    const x1 = Math.min(cut.x + cut.width, box.left + box.width), y1 = Math.min(cut.y + cut.height, box.top + box.height)
    if (x1 <= x0 || y1 <= y0) continue
    const level = Number(levelText)
    await writePicture(cut.data, 4, cut.width, cut.height, { left: x0 - cut.x, top: y0 - cut.y, width: x1 - x0, height: y1 - y0 }, join(assets, `${id}-${level}-L${light}.webp`), 82)
    ;((pieces[id] ??= {})[level] ??= {})[light] = place(x0, y0, x1 - x0, y1 - y0)
    cuts.set(`${type}-${level}-L${light}`, cut)
    pieceCount += 1
  }
  pairCount += await pairPieces(light, dir, bases)
}

const behind = BEHIND_WALL.map((type) => idOf.get(type)).filter((id) => id && inside.has(id))
const rooms = inside.size ? { openLevel: WALL_OPEN_LEVEL, station: idOf.get('EmergencyWall'), inside: [...inside], behind } : undefined

const json = { size: [outWidth, outHeight], lights, lightStation: idOf.get('Illumination'), spots, pieces, ...(pairCount ? { pairs } : {}), ...(rooms ? { rooms } : {}) }
writeFileSync(dataFile, JSON.stringify(json) + '\n')
console.log(`picture ${outWidth}x${outHeight} (cut ${JSON.stringify(box)}), ${lights.length} lights, ${Object.keys(spots).length} buttons, ${pieceCount} pieces, ${pairCount} pair corrections, ${inside.size} modules behind the wall`)
