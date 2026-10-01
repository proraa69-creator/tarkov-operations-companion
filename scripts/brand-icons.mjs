// Raid OS brand icons (variant E «Чистый»): R monogram with an olive leg on a graphite squircle with a faint stitch.
// Sources: build/brand/*.svg (the approved artwork, text already converted to outlines — no fonts needed).
// Writes every icon the app, the site and the phone apps use. Run from the repo root: node scripts/brand-icons.mjs
//   build/icon.ico, build/icon.png           exe icon (electron-builder win.icon), 256/48/32/24/16 in one .ico
//   public/app-icon.ico, public/favicon.png   window/taskbar icon (electron/main.ts → dist/app-icon.ico), renderer favicon
//   website/public/favicon.svg                site favicon; website/public/brand/*.svg logo artwork for the site
//   android/app/src/main/res/mipmap-*        launcher icons: legacy squircle + round, adaptive foreground + background
//   android/app/src/main/res/drawable*/splash.png, ios/.../Splash.imageset   dark splash with the monogram
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png      1024 px, no transparency (iOS masks it)
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const BRAND = 'build/brand'
const src = async (name) => readFile(join(BRAND, name), 'utf8')
const [iconSvg, iosSvg, androidSvg, markSvg] = await Promise.all(['icon.svg', 'app-ios.svg', 'app-android.svg', 'mark.svg'].map(src))

// Pieces of the artwork reused below: the «Чёрный мультикам» texture pattern and the R monogram of mark.svg.
const texture = /<filter id="lift">[\s\S]*?<\/filter>\s*<pattern id="mc"[\s\S]*?<\/pattern>/.exec(iconSvg)?.[0]
const monogram = /<clipPath id="lg200">[\s\S]*?<\/g><g clip-path="url\(#lg200\)">[\s\S]*?<\/g>/.exec(markSvg)?.[0]
if (!texture || !monogram) throw new Error('build/brand/*.svg changed: texture or monogram not found')
const GRADIENT = '<radialGradient id="gr" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>'
// The R of mark.svg spans x 80…181, y 32…194 (256 units); centre it at (cx, cy) with height h.
const R = (cx, cy, h) => { const s = h / 162; return `<g transform="translate(${cx} ${cy}) scale(${s}) translate(-130.4 -113)">${monogram}</g>` }
const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs>${defs}</defs>${body}</svg>`
const fabric = `<rect width="256" height="256" fill="#0b0b0c"/><rect width="256" height="256" fill="url(#mc)" opacity=".55"/><rect width="256" height="256" fill="url(#gr)"/>`

// 16–32 px: the stitch and the texture turn to noise, so the tile is plain graphite and the R fills it.
const smallTile = (radius) => svg(`<rect x="4" y="4" width="248" height="248" rx="${radius}" fill="url(#g)"/><rect x="5" y="5" width="246" height="246" rx="${radius - 1}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>${R(129, 128, 172)}`,
  `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d1e1b"/><stop offset="1" stop-color="#0b0b0c"/></linearGradient>`)
// iOS and legacy Android squares: the approved tile, but full-bleed (iOS applies its own mask, and must get no alpha).
const fullBleed = (tile) => tile.replace(/<clipPath id="k"><path d="[^"]*"\/><\/clipPath>/, '<clipPath id="k"><path d="M0 0H256V256H0Z"/></clipPath>')
const adaptiveBackground = svg(fabric, texture + GRADIENT)
// Adaptive foreground: 108 dp canvas, the launcher shows the middle 72 dp (66 %); the R keeps well inside it.
const adaptiveForeground = svg(R(129, 128, 72))
const splash = svg(`<rect width="256" height="256" fill="#050506"/>${R(128, 128, 40)}`)

const png = (source, size, { flatten = false } = {}) => {
  let image = sharp(Buffer.from(source), { density: Math.max(72, Math.ceil((72 * size) / 256) * 2) }).resize(size, size)
  if (flatten) image = image.flatten({ background: '#0b0b0c' })
  return image.png({ compressionLevel: 9 }).toBuffer()
}

/** A Windows .ico with PNG entries (Vista+), largest first. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size >= 256 ? 0 : size, entry); header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2); header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((image) => image.data)])
}

const icoImages = []
for (const size of [256, 48]) icoImages.push({ size, data: await png(iconSvg, size) })
for (const size of [32, 24, 16]) icoImages.push({ size, data: await png(smallTile(size >= 32 ? 56 : 48), size) })
const icoFile = ico(icoImages)
await writeFile('build/icon.ico', icoFile)
await writeFile('public/app-icon.ico', icoFile)
await writeFile('build/icon.png', await png(iconSvg, 1024))
await writeFile('public/favicon.png', await png(iconSvg, 64))
await writeFile('website/public/favicon.svg', smallTile(56))
await mkdir('website/public/brand', { recursive: true })
for (const name of ['icon.svg', 'wordmark.svg', 'name.svg']) await copyFile(join(BRAND, name), join('website/public/brand', name))

// Android: sizes of the existing files (mdpi 48/108 … xxxhdpi 192/432).
const res = 'android/app/src/main/res'
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [density, size] of Object.entries(LAUNCHER)) {
  const dir = join(res, `mipmap-${density}`)
  const layer = Math.round(size * 2.25)
  await writeFile(join(dir, 'ic_launcher.png'), await png(iosSvg, size))
  await writeFile(join(dir, 'ic_launcher_round.png'), await png(androidSvg, size))
  await writeFile(join(dir, 'ic_launcher_foreground.png'), await png(adaptiveForeground, layer))
  await writeFile(join(dir, 'ic_launcher_background.png'), await png(adaptiveBackground, layer, { flatten: true }))
}
for (const dir of await readdir(res)) {
  if (!dir.startsWith('drawable')) continue
  const file = join(res, dir, 'splash.png')
  const meta = await sharp(file).metadata().catch(() => null)
  if (!meta?.width || !meta.height) continue
  const side = Math.min(meta.width, meta.height)
  const mark = await png(splash, side, { flatten: true })
  await writeFile(file, await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: '#050506' } })
    .composite([{ input: mark, left: Math.round((meta.width - side) / 2), top: Math.round((meta.height - side) / 2) }]).png({ compressionLevel: 9 }).toBuffer())
}

// iOS
const ios = 'ios/App/App/Assets.xcassets'
await writeFile(join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), await png(fullBleed(iosSvg), 1024, { flatten: true }).then((buffer) => sharp(buffer).removeAlpha().png().toBuffer()))
const iosSplash = await sharp(await png(splash, 2732, { flatten: true })).removeAlpha().png({ compressionLevel: 9 }).toBuffer()
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await writeFile(join(ios, 'Splash.imageset', name), iosSplash)

console.log(`icons written: build/icon.ico (${icoImages.map((image) => image.size).join('/')}), public/app-icon.ico, favicons, Android mipmaps + splash, iOS AppIcon + splash`)
