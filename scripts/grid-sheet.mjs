// Preview images with a 10% grid to pick crop boxes.
// Usage: node scripts/grid-sheet.mjs <out.png> <file> [file ...]
import { basename } from 'node:path'
import sharp from 'sharp'

const [out, ...files] = process.argv.slice(2)
const T = 420
const cols = 3
const rows = Math.ceil(files.length / cols)
const layers = []
for (const [i, file] of files.entries()) {
  const left = (i % cols) * T
  const top = Math.floor(i / cols) * T
  const img = await sharp(file).resize(T - 20, T - 40, { fit: 'inside' }).flatten({ background: '#5a5f58' }).png().toBuffer()
  const { width: gw, height: gh } = await sharp(img).metadata()
  const lines = Array.from({ length: 11 }, (_, k) => `<line x1="${(gw * k) / 10}" y1="0" x2="${(gw * k) / 10}" y2="${gh}"/><line x1="0" y1="${(gh * k) / 10}" x2="${gw}" y2="${(gh * k) / 10}"/><text x="${(gw * k) / 10 + 2}" y="10">${k}</text><text x="2" y="${(gh * k) / 10 + 11}">${k}</text>`).join('')
  const grid = Buffer.from(`<svg width="${gw}" height="${gh}" xmlns="http://www.w3.org/2000/svg"><g stroke="#ffde59" stroke-opacity=".45" stroke-width="1" font-family="Arial" font-size="10" fill="#ffde59">${lines}</g></svg>`)
  layers.push({ input: await sharp(img).composite([{ input: grid }]).png().toBuffer(), left: left + 10, top: top + 30 })
  layers.push({ input: Buffer.from(`<svg width="${T}" height="26" xmlns="http://www.w3.org/2000/svg"><text x="10" y="18" font-family="Segoe UI, Arial" font-size="15" fill="#fff">${basename(file)}</text></svg>`), left, top })
}
await sharp({ create: { width: cols * T, height: rows * T, channels: 3, background: '#161816' } }).composite(layers).png().toFile(out)
console.log(out)
