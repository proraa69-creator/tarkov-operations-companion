// The hideout's pictures for «Убежище» (src/hideout/hideoutViews.ts) from the offline game copy's plugin RaidOsHideout
// (E:\SPT-photo\hideout\plugin): node scripts/hideout-views.mjs [<plugin out folder>]
// Reads out/probe.json (the game's area types and their template ids = tarkov.dev station ids), out/overview.png + .json (where
// every area's icon point is on it) and out/area/<Type>-<level>.png; writes src/assets/hideout-views/*.webp and
// src/data/hideoutViews.json. Only pictures and numbers: nothing of the game itself.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = process.argv[2] ?? 'E:/SPT/BepInEx/plugins/RaidOsHideout/out'
const root = fileURLToPath(new URL('..', import.meta.url))
const assets = join(root, 'src/assets/hideout-views')
const dataFile = join(root, 'src/data/hideoutViews.json')
const OVERVIEW_WIDTH = 1920
const MODULE_WIDTH = 1280
// The game's hideout is dark; a picture in the app is lifted so its brightest level reads (one gamma for all levels of a module,
// so the levels still compare as in the game). Target mean brightness of 0..255.
const TARGET_MEAN = 46
// The second weapon rack draws the first one's levels, the Christmas tree is seasonal: neither has a station of its own in the app.
const SKIP = new Set(['WeaponStandSecondary', 'ChristmasIllumination'])
const meanOf = async (file) => (await sharp(file).removeAlpha().greyscale().stats()).channels[0].mean
const gammaFor = (mean) => Math.min(1, Math.max(0.5, Math.log(TARGET_MEAN / 255) / Math.log(Math.max(1, mean) / 255)))
/** The picture without the game's alpha, as raw RGB at full size. */
async function opaqueRaw(file) {
  // The game writes a meaningless alpha into its screenshots (its shaders leave 0 in places): dropped before any resampling,
  // or the resize weighs colours by it and dark parts turn black.
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** The picture (a part of it, `crop`) at a width, its tones raised by a gamma below 1 (dark parts more than light ones), as webp. */
async function liftedWebp(file, gamma, width, quality, out, crop) {
  const raw = await opaqueRaw(file)
  let image = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
  if (crop) image = sharp(await image.extract(crop).raw().toBuffer(), { raw: { width: crop.width, height: crop.height, channels: 3 } })
  const { data, info } = await image.resize(width).raw().toBuffer({ resolveWithObject: true })
  if (gamma < 0.99) {
    const curve = Uint8Array.from({ length: 256 }, (_, value) => Math.round(255 * (value / 255) ** gamma))
    for (let index = 0; index < data.length; index += 1) data[index] = curve[data[index]]
  }
  await sharp(data, { raw: info }).webp({ quality }).toFile(out)
}

/** The part of the overview with the hideout in it: rows and columns with enough lit pixels, then the buttons, with a margin. */
function contentBox(raw, points, margin = 0.03) {
  const lit = (x, y) => { const i = (y * raw.width + x) * 3; return Math.max(raw.data[i], raw.data[i + 1], raw.data[i + 2]) > 24 }
  const rows = [], cols = new Array(raw.width).fill(0)
  for (let y = 0; y < raw.height; y += 1) { let count = 0; for (let x = 0; x < raw.width; x += 1) if (lit(x, y)) { count += 1; cols[x] += 1 } rows.push(count) }
  const first = (list) => list.findIndex((count) => count > 6), last = (list) => list.length - 1 - [...list].reverse().findIndex((count) => count > 6)
  let left = first(cols), right = last(cols), top = first(rows), bottom = last(rows)
  for (const [x, y] of points) { left = Math.min(left, x * raw.width); right = Math.max(right, x * raw.width); top = Math.min(top, y * raw.height); bottom = Math.max(bottom, y * raw.height) }
  const padX = margin * raw.width, padY = margin * raw.height
  left = Math.max(0, Math.floor(left - padX)); top = Math.max(0, Math.floor(top - padY))
  right = Math.min(raw.width, Math.ceil(right + padX)); bottom = Math.min(raw.height, Math.ceil(bottom + padY))
  return { left, top, width: right - left, height: bottom - top }
}

const probe = JSON.parse(readFileSync(join(source, 'probe.json'), 'utf8'))
const idOf = new Map(probe.areas.filter((area) => area.id).map((area) => [area.type, area.id]))
// Areas the game keeps as part of another (the second weapon rack) have no station of their own in tarkov.dev: left out by the app.

rmSync(assets, { recursive: true, force: true })
mkdirSync(assets, { recursive: true })

const overviewMeta = JSON.parse(readFileSync(join(source, 'overview.json'), 'utf8'))
const spots = {}
for (const area of overviewMeta.areas ?? []) {
  const id = idOf.get(area.type)
  // only an icon point in front of the camera and inside the picture
  if (!id || SKIP.has(area.type) || area.depth <= 0 || area.x < 0.01 || area.x > 0.99 || area.y < 0.01 || area.y > 0.99) continue
  spots[id] = [Number(area.x.toFixed(4)), Number(area.y.toFixed(4))]
}
// a hand-set place for an area whose icon point falls behind a wall or another button (spots.json beside the pictures)
const fixes = join(source, 'spots.json')
if (existsSync(fixes)) for (const [type, spot] of Object.entries(JSON.parse(readFileSync(fixes, 'utf8')))) if (idOf.get(type)) spots[idOf.get(type)] = spot

// The overview cut to the hideout (the camera sees a lot of empty dark ground round it), the buttons moved with the cut.
const overviewRaw = await opaqueRaw(join(source, 'overview.png'))
const box = contentBox(overviewRaw, Object.values(spots))
const outWidth = Math.min(OVERVIEW_WIDTH, box.width)
const outHeight = Math.round(outWidth * box.height / box.width)
await liftedWebp(join(source, 'overview.png'), gammaFor(await meanOf(join(source, 'overview.png'))), outWidth, 80, join(assets, 'overview.webp'), box)
for (const [id, [x, y]] of Object.entries(spots)) spots[id] = [(x * overviewRaw.width - box.left) / box.width, (y * overviewRaw.height - box.top) / box.height]

// Buttons that would lie on one another (the game's icon points of the generator, the vents and the solar panel are a hand apart)
// are pushed apart a little: at least SPACING of the picture's width between centres, the vertical scaled to the picture's shape.
const SPACING = 0.042
const aspect = outHeight / outWidth
const placed = Object.entries(spots).map(([id, [x, y]]) => ({ id, x, y: y * aspect }))
for (let round = 0; round < 300; round += 1) {
  let moved = false
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) {
    const a = placed[i], b = placed[j]
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1e-6
    if (distance >= SPACING) continue
    const push = (SPACING - distance) / 2 + 1e-4
    const ux = distance > 1e-5 ? dx / distance : 1, uy = distance > 1e-5 ? dy / distance : 0
    a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push
    moved = true
  }
  if (!moved) break
}
for (const spot of placed) spots[spot.id] = [Number(spot.x.toFixed(4)), Number((spot.y / aspect).toFixed(4))]

const levels = {}
const areaDir = join(source, 'area')
const byType = new Map()
for (const file of existsSync(areaDir) ? readdirSync(areaDir).filter((name) => name.endsWith('.png')) : []) {
  const match = /^(\w+)-(\d+)\.png$/.exec(file)
  if (!match || SKIP.has(match[1]) || !idOf.get(match[1])) continue
  byType.set(match[1], [...(byType.get(match[1]) ?? []), Number(match[2])])
}
for (const [type, list] of byType) {
  const id = idOf.get(type)
  list.sort((a, b) => a - b)
  const gamma = gammaFor(await meanOf(join(areaDir, `${type}-${list.at(-1)}.png`)))
  for (const level of list) {
    await liftedWebp(join(areaDir, `${type}-${level}.png`), gamma, MODULE_WIDTH, 78, join(assets, `${id}-${level}.webp`))
  }
  levels[id] = list
}
for (const list of Object.values(levels)) list.sort((a, b) => a - b)

writeFileSync(dataFile, JSON.stringify({ overview: { width: outWidth, height: outHeight }, spots, levels }, null, 2) + '\n')
console.log(`overview ${outWidth}x${outHeight} (cut ${JSON.stringify(box)}), ${Object.keys(spots).length} buttons, ${Object.values(levels).flat().length} module pictures`)
