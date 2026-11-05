// The picture on the left of the installer's first and last pages and of the uninstaller's (build/installerSidebar.bmp,
// package.json build.nsis): owner, 03.11.2026, about electron-builder's blue one: «замени синюю картинку на какую нибудь
// нашу в нашей стилистике». The monogram (build/brand/mark.svg) and the name (build/brand/name.svg) on the app's dark
// field with a faint map grid. NSIS takes a 24-bit BMP of 164 × 314. Run: node scripts/installer-sidebar.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const WIDTH = 164
const HEIGHT = 314
const R_PATH = 'M115.8 194L80 194L80 32L124.6 32Q141 32 153 35.6Q165 39.2 171.7 48.5Q178.4 57.8 178.4 74.8Q178.4 84.8 176.8 92.6Q175.2 100.4 170.9 106.1Q166.6 111.8 158.6 115.6L180.8 194L143.8 194L126 121.4L115.8 121.4L115.8 194ZM115.8 56L115.8 100.8L125.8 100.8Q133.4 100.8 137.6 98.1Q141.8 95.4 143.5 90.3Q145.2 85.2 145.2 78Q145.2 67.6 141.4 61.8Q137.6 56 127.4 56L115.8 56Z'
const LEG = 'M113.6 117.86L208 117.86L208 204L130.4 204Z'

const name = readFileSync(new URL('../build/brand/name.svg', import.meta.url), 'utf8')
const nameBox = name.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number)
const nameInner = name.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// The R (80…180.8 × 32…194 in the mark's 256 box), centred, its top at y 64.
const scale = 0.6
const markX = WIDTH / 2 - 130.4 * scale
const markY = 64 - 32 * scale
const nameWidth = 112
const nameHeight = (nameWidth * nameBox[3]) / nameBox[2]
const contours = [0, 1, 2, 3, 4].map((i) => {
  const y = 246 + i * 11
  return `<path d="M-4 ${y}C30 ${y - 10} 52 ${y + 8} 84 ${y - 2}S140 ${y - 12} 168 ${y - 4}" fill="none" stroke="#a9b973" stroke-opacity="${0.16 - i * 0.025}"/>`
}).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18201b"/><stop offset="1" stop-color="#0a0f0c"/></linearGradient>
    <radialGradient id="glow" cx="82" cy="112" r="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#a9b973" stop-opacity=".16"/><stop offset="1" stop-color="#a9b973" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 .5H.5V16" fill="none" stroke="#a9b973" stroke-opacity=".07"/></pattern>
    <clipPath id="body"><path d="M0 0H256V256H0Z${LEG}" clip-rule="evenodd"/></clipPath>
    <clipPath id="leg"><path d="${LEG}"/></clipPath>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#field)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  ${contours}
  <path d="M12 26V12H26M138 12H152V26M12 288V302H26M138 302H152V288" fill="none" stroke="#a9b973" stroke-opacity=".5" stroke-width="1.5"/>
  <g transform="translate(${markX} ${markY}) scale(${scale})">
    <path d="${R_PATH}" fill="#ecede8" clip-path="url(#body)"/>
    <path d="${R_PATH}" fill="#a9b973" clip-path="url(#leg)"/>
  </g>
  <path d="M40 182H124" stroke="#d4e0a6" stroke-opacity=".72" stroke-width="2" stroke-dasharray="6 4"/>
  <svg x="${(WIDTH - nameWidth) / 2}" y="196" width="${nameWidth}" height="${nameHeight}" viewBox="${nameBox.join(' ')}">${nameInner}</svg>
</svg>`

const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
if (info.width !== WIDTH || info.height !== HEIGHT || info.channels !== 3) throw new Error(`unexpected render ${info.width}×${info.height}×${info.channels}`)
writeFileSync(new URL('../build/installerSidebar.bmp', import.meta.url), bmp(data, WIDTH, HEIGHT))
if (process.argv.includes('--png')) await sharp(Buffer.from(svg)).png().toFile(process.argv[process.argv.indexOf('--png') + 1])

/** A bottom-up 24-bit BMP (BITMAPINFOHEADER), rows padded to 4 bytes: what NSIS loads. */
function bmp(rgb, width, height) {
  const row = Math.ceil((width * 3) / 4) * 4
  const file = Buffer.alloc(54 + row * height)
  file.write('BM', 0, 'latin1')
  file.writeUInt32LE(file.length, 2)
  file.writeUInt32LE(54, 10)
  file.writeUInt32LE(40, 14)
  file.writeInt32LE(width, 18)
  file.writeInt32LE(height, 22)
  file.writeUInt16LE(1, 26)
  file.writeUInt16LE(24, 28)
  file.writeUInt32LE(row * height, 34)
  file.writeInt32LE(2835, 38)
  file.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 3
      const to = 54 + (height - 1 - y) * row + x * 3
      file[to] = rgb[from + 2]
      file[to + 1] = rgb[from + 1]
      file[to + 2] = rgb[from]
    }
  }
  return file
}
