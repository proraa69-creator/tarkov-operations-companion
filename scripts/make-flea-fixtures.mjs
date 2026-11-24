/**
 * Makes the flea test frames (src/import/__fixtures__/flea) from the owner's flea screenshots of 18.11.2026 in the game's
 * Screenshots folder: only what the reader looks at is kept (tabs, filter chips, sort chevron, scrollbar, version line, each row's price
 * band), the rest black — no nicknames, no money. Grey but for the frames whose colours are tested ($, €, the banner).
 * Then: node scripts/build-flea-digits.mjs
 *
 *   node scripts/make-flea-fixtures.mjs src/import/__fixtures__/flea
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const sharp = createRequire(process.cwd() + '/package.json')('sharp')
const dir = process.env.USERPROFILE + '/Documents/Escape from Tarkov/Screenshots/'
const out = process.argv[2]
const D = 'dim'
const frames = {
  'pve-keys': ['2026-11-18[14-47] (0).png', 'pve', '₽', [1000, 2000, 2000, 2000, 2500, 2900, 2900, 2990, 3000, 3000, 3000, 3000]],
  'pve-provisions': ['2026-11-18[14-48] (7).png', 'pve', '₽', [11000, 13333, 14444, 14999, 15530, 15999, 15999, 16000, 16000, 16622, 16666, 16666]],
  'pve-marksman': ['2026-11-18[14-48] (1).png', 'pve', '₽', [36666, 43333, 50000, 55000, 58888, 60000, 63300, 63300, 63333, 64999, 66111, 66666]],
  'pve-machineguns': ['2026-11-18[14-48] (4).png', 'pve', '₽', [79999, 85000, 89000, 89000, 89696, 89696, 90000, 91111, 91111, 92222, 92222, 93000]],
  'pve-machete': ['2026-11-18[14-48] (10).png', 'pve', '₽', [30000, 36900, 36900, 37000, 37000, 37000, 37000, 37000, 37000, 37499, 37499, 37499]],
  'pve-unknown-knife': ['2026-11-18[14-50] (0).png', 'pve', '₽', [50000, 50000, 51000, 51999, 52000, 52222, 55000, 55420, 55555, 55555, 55555, 57000]],
  'pve-usd': ['2026-11-18[14-50] (1).png', 'pve', '$', [100, 125, 200, 250, 270, 275, 280, 400, 400, 410, 520, 600]],
  'pve-eur': ['2026-11-18[14-50] (2).png', 'pve', '€', [150, 200, 250, 250, 270, 275, 300, 317, 322, 400, 500, 555]],
  'pve-gp-closed': ['2026-11-18[14-50] (3).png', 'pve', 'GP', [D, D, D, null, null, null, null, null, null, null, null, null]],
  'season-provisions-14': ['2026-11-18[14-58] (4).png', 'seasonal', '₽', [13999, 14000, 14000, 14000, 14000, 14000, 14443, 14443, 14444, 14444, 15000, 15000]],
  'pvp-locked-banner': ['2026-11-18[14-56] (0).png', 'pvp', '₽', ['banner', 136, D, 262, D, 372, D, 376, 393, D, D, D]],
  'season-weapons': ['2026-11-18[14-58] (0).png', 'seasonal', '₽', [2927, 4585, 5920, D, 7332, 7333, 7509, 7777, 8860, D, D, D]],
  'season-info': ['2026-11-18[14-58] (6).png', 'seasonal', '₽', [11790, 14594, 18936, 19353, D, 22222, [148, '€'], D, 61666, [336, '€'], 65420, 66666]],
  'season-ammo': ['2026-11-18[14-58] (3).png', 'seasonal', '₽', [2, 17, 27, 30, 32, 35, 40, 40, 40, 44, 46, 50]],
  'season-short': ['2026-11-18[14-59] (0).png', 'seasonal', '₽', [55555, 77777, null, null, null, null, null, null, null, null, null, null]],
}
// What the reader looks at (1080p): the tabs, the filter chips, the sort chevron, the scrollbar, the version label and each row's price band.
const keep = [[780, 12, 380, 44], [600, 56, 590, 40], [1415, 108, 40, 27], [1860, 140, 22, 882], [0, 1018, 260, 32], ...Array.from({ length: 12 }, (_, row) => [1330, 144 + row * 72 + 8, 180, 40])]
const colour = new Set(['pve-usd', 'pve-eur', 'season-info', 'pvp-locked-banner'])
const labels = {}
for (const [name, [file, mode, currency, rows]] of Object.entries(frames)) {
  const parts = await Promise.all(keep.map(async ([left, top, width, height]) => ({ input: await sharp(dir + file).extract({ left, top, width, height }).png().toBuffer(), left, top })))
  let picture = sharp(await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#000' } }).composite(parts).png().toBuffer())
  if (!colour.has(name)) picture = picture.grayscale()
  await picture.webp({ lossless: true, effort: 6 }).toFile(`${out}/${name}.webp`)
  labels[name] = { mode, rows: rows.map((row) => row === null ? null : row === D ? 'dim' : row === 'banner' ? 'banner' : Array.isArray(row) ? { value: row[0], currency: row[1] } : { value: row, currency }) }
}
writeFileSync(`${out}/labels.json`, JSON.stringify(labels, null, 1) + '\n')
