// Preview sheet of transparent PNGs on a checkerboard.
// Usage: node scripts/contact-sheet.mjs <dir> <out.png> [tileW] [tileH] [cols]
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const [dir, out, w = '300', h = '220', c = '4'] = process.argv.slice(2)
const [tw, th, cols] = [Number(w), Number(h), Number(c)]
const labelH = 22
const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort()
const rows = Math.ceil(files.length / cols)
const cell = 12
const checker = Buffer.from(`<svg width="${cols * tw}" height="${rows * (th + labelH)}" xmlns="http://www.w3.org/2000/svg">
  <defs><pattern id="p" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">
    <rect width="${cell * 2}" height="${cell * 2}" fill="#5a5f58"/><rect width="${cell}" height="${cell}" fill="#3c403b"/><rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="#3c403b"/>
  </pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`)

const layers = []
for (const [i, f] of files.entries()) {
  const left = (i % cols) * tw
  const top = Math.floor(i / cols) * (th + labelH)
  layers.push({ input: await sharp(join(dir, f)).resize(tw - 8, th - 8, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), left: left + 4, top: top + 4 })
  layers.push({
    input: Buffer.from(`<svg width="${tw}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#161816"/><text x="8" y="16" font-family="Segoe UI, Arial" font-size="14" fill="#e8e4d8">${f.replace(/\.png$/, '')}</text></svg>`),
    left,
    top: top + th,
  })
}
await sharp(checker).composite(layers).png().toFile(out)
console.log(out)
