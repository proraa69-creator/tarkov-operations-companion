// Builds transparent boss busts (head + shoulders) for the map from tarkov.dev posters.
// jpg posters are scene artwork, so their background is removed with a local model first.
// Usage: node scripts/gen-boss-busts.mjs
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const OUT = join(SCRIPTS, '../src/assets/boss-busts')
const CACHE = join(tmpdir(), 'tarkov-boss-posters')
const CUT = join(CACHE, 'cut')
const ASSETS = 'https://assets.tarkov.dev'
const RAW = 256
const ICON = 128
const FADE = 0.16

/**
 * bust key → poster file and a square crop: `cx` (share of width), `top` and `size` (share of height).
 * Posters without a crop are already busts; `.webp` ones are also already transparent.
 */
const BUSTS = {
  killa: { file: 'killa-poster.jpg', cx: 0.63, top: 0.08, size: 0.42 },
  'vengeful-killa': { file: 'vengeful-killa-poster.webp' },
  tagilla: { file: 'tagilla-poster.jpg', cx: 0.5, top: 0.05, size: 0.4 },
  'shadow-of-tagilla': { file: 'shadow-of-tagilla-poster.webp' },
  reshala: { file: 'reshala-poster.webp' },
  glukhar: { file: 'glukhar-poster.jpg', cx: 0.57, top: 0.03, size: 0.45 },
  // The poster hides his face behind the rifle.
  shturman: { file: 'shturman-portrait.png' },
  sanitar: { file: 'sanitar-poster.jpg', cx: 0.33, top: 0.08, size: 0.45 },
  kaban: { file: 'kaban-poster.jpg', cx: 0.5, top: 0.02, size: 0.4 },
  kollontay: { file: 'kollontay-poster.jpg', cx: 0.4, top: 0.11, size: 0.28 },
  partisan: { file: 'partisan-poster.jpg', cx: 0.5, top: 0, size: 0.42 },
  zryachiy: { file: 'zryachiy-poster.jpg', cx: 0.44, top: 0.16, size: 0.4 },
  knight: { file: 'knight-poster.jpg', cx: 0.5, top: 0.03, size: 0.42 },
  'big-pipe': { file: 'big-pipe-poster.jpg', cx: 0.5, top: 0.04, size: 0.42 },
  birdeye: { file: 'birdeye-poster.jpg', cx: 0.51, top: 0.05, size: 0.42 },
  'cultist-priest': { file: 'cultist-priest-poster.webp' },
  raider: { file: 'raider-poster.webp' },
  'black-div-raider': { file: 'black-div-raider-poster.webp' },
  rogue: { file: 'rogue-poster.webp' },
  'black-div': { file: 'black-div-poster.webp' },
  'black-div-boss': { file: 'black-div-boss-poster.webp' },
  'the-wedge': { file: 'the-wedge-poster.webp' },
  'the-wedge-labs': { file: 'the-wedge-labs-poster.webp' },
  sentry: { file: 'af-poster.webp' },
}

async function download(file) {
  const path = join(CACHE, file)
  if (existsSync(path)) return
  const response = await fetch(`${ASSETS}/${file}`)
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
}

async function crop(buffer, { cx, top, size }) {
  const { width, height } = await sharp(buffer).metadata()
  const side = Math.round(size * height)
  const left = Math.round(cx * width - side / 2)
  const y = Math.round(top * height)
  const pad = { top: Math.max(0, -y), left: Math.max(0, -left), right: Math.max(0, left + side - width), bottom: Math.max(0, y + side - height) }
  const padded = await sharp(buffer)
    .ensureAlpha()
    .extend({ ...pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  return sharp(padded).extract({ left: left + pad.left, top: y + pad.top, width: side, height: side }).png().toBuffer()
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

function blank(size) {
  return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
}

function square(buffer) {
  return sharp(buffer).resize(RAW, RAW, { fit: 'contain', position: 'bottom', background: transparent }).png().toBuffer()
}

/** Softly dissolves the cut torso at the bottom so the bust has no hard horizontal edge. */
function fadeMask(size) {
  const start = Math.round(size * (1 - FADE))
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="f" x1="0" y1="${start}" x2="0" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#f)"/>
  </svg>`)
}

/** Map icon: the plain transparent bust. */
async function icon(raw) {
  return sharp(raw)
    .resize(ICON, ICON)
    .composite([{ input: fadeMask(ICON), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

await mkdir(CUT, { recursive: true })
for (const { file } of Object.values(BUSTS)) await download(file)

// The background-removal package ships its own sharp build, which cannot share a process with ours.
const needsCut = (file) => !file.endsWith('.webp')
const cutPath = (file) => join(CUT, `${file.replace(/\.\w+$/, '')}.png`)
const missing = Object.values(BUSTS)
  .map(({ file }) => file)
  .filter((file) => needsCut(file) && !existsSync(cutPath(file)))
if (missing.length) execFileSync(process.execPath, [join(SCRIPTS, 'cutout-boss-posters.mjs'), CACHE, CUT, ...missing], { stdio: 'inherit' })

const raw = {}
for (const [key, spec] of Object.entries(BUSTS)) {
  const source = await readFile(needsCut(spec.file) ? cutPath(spec.file) : join(CACHE, spec.file))
  raw[key] = await square(spec.size ? await crop(source, spec) : source)
}

// The Goons: Big Pipe and Birdeye behind Knight.
const back = Math.round(ICON * 0.6)
const front = Math.round(ICON * 0.78)
const member = async (key, size) => sharp(await icon(raw[key])).resize(size, size).png().toBuffer()
const goons = await blank(ICON)
  .composite([
    { input: await member('big-pipe', back), left: 0, top: 4 },
    { input: await member('birdeye', back), left: ICON - back, top: 4 },
    { input: await member('knight', front), left: Math.round((ICON - front) / 2), top: ICON - front },
  ])
  .png({ compressionLevel: 9 })
  .toBuffer()

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
for (const key of Object.keys(BUSTS)) {
  if (key === 'knight' || key === 'big-pipe' || key === 'birdeye') continue
  await writeFile(join(OUT, `${key}.png`), await icon(raw[key]))
  console.log('bust', key)
}
await writeFile(join(OUT, 'goons.png'), goons)
console.log('bust goons')
