/**
 * Builds src/import/fleaDigitShapes.ts: samples of the flea market's price digits (src/import/fleaDigits.ts), cut from the
 * owner's flea screenshots of 18.11.2026 kept as test frames (src/import/__fixtures__/flea, made by
 * scripts/make-flea-fixtures.mjs) with the prices they show (labels.json).
 *
 * Learnt only from the training frames: the PvP and Season frames in HELD_OUT are left for the test
 * (src/import/fleaScreen.test.ts), which reads them with these samples — a frame the samples never saw.
 *
 *   node scripts/build-flea-digits.mjs
 */
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sharp = createRequire(join(root, 'package.json'))('sharp')
// Node strips the types of this file (it has no runtime imports).
const { encodeDigitShapes, priceBand, priceGlyphs } = await import(pathToFileURL(join(root, 'src/import/fleaDigits.ts')).href)

export const HELD_OUT = ['pvp-locked-banner', 'season-weapons', 'season-info', 'season-ammo', 'season-short']
const fixtures = join(root, 'src/import/__fixtures__/flea')
const labels = JSON.parse(await readFile(join(fixtures, 'labels.json'), 'utf8'))
const layout = { left: 0, top: 0, unit: 1 }

const samples = []
for (const [name, { rows }] of Object.entries(labels)) {
  if (HELD_OUT.includes(name)) continue
  const { data, info } = await sharp(join(fixtures, `${name}.webp`)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels = { width: info.width, height: info.height, data, channels: 3, bgr: false }
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    const glyphs = priceGlyphs(pixels, priceBand(layout, index), layout.unit)
    const digits = String(row.value).split('').map(Number)
    // Only a band cut into exactly its digits and the sign teaches anything.
    if (glyphs.length !== digits.length + 1) return
    digits.forEach((digit, at) => samples.push({ digit, picture: glyphs[at].picture }))
  })
}

const shapes = encodeDigitShapes(samples)
const kept = shapes.split(';').length
const source = `// Made by scripts/build-flea-digits.mjs from the owner's flea frames (src/import/__fixtures__/flea): do not edit by hand.
// ${samples.length} digits cut from the training frames, ${kept} kept (near-duplicates left out).
export const FLEA_DIGIT_SHAPES = '${shapes}'
`
await writeFile(join(root, 'src/import/fleaDigitShapes.ts'), source, 'utf8')
console.log(`fleaDigitShapes.ts: ${samples.length} digits, ${kept} samples kept`)
