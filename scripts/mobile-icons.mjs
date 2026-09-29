// Placeholder app icons for the phone app: the «TO» mark of the sidebar on the «Чёрный мультикам» colours.
// Overwrites the Capacitor template icons at their existing sizes. Run: node scripts/mobile-icons.mjs
// (replace with final artwork later: ios/App/App/Assets.xcassets/AppIcon.appiconset, android/app/src/main/res/mipmap-*).
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const mark = (size, { background = true, scale = 1 } = {}) => {
  const s = 1024
  const inner = 620 * scale
  const o = (s - inner) / 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  ${background ? `<rect width="${s}" height="${s}" fill="#0b0b0c"/><rect width="${s}" height="${s}" fill="url(#g)"/>` : ''}
  <defs><radialGradient id="g" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="#2a2c24"/><stop offset="1" stop-color="#060607"/></radialGradient></defs>
  <rect x="${o}" y="${o}" width="${inner}" height="${inner}" rx="${inner * 0.2}" fill="#1b1c19" stroke="#a9b973" stroke-width="${inner * 0.03}"/>
  <rect x="${o + inner * 0.07}" y="${o + inner * 0.07}" width="${inner * 0.86}" height="${inner * 0.86}" rx="${inner * 0.15}" fill="none" stroke="#6f7a4a" stroke-width="${inner * 0.012}" stroke-dasharray="${inner * 0.04} ${inner * 0.03}"/>
  <text x="50%" y="50%" dy="${inner * 0.13}" text-anchor="middle" font-family="Oswald, Bahnschrift, Arial Narrow, sans-serif" font-weight="700" font-size="${inner * 0.42}" fill="#d7e2a8" letter-spacing="-${inner * 0.02}">TO</text>
</svg>`)
}

async function render(file, size, options) {
  await writeFile(file, await sharp(mark(size, options)).resize(size, size).png().toBuffer())
}

const res = 'android/app/src/main/res'
for (const dir of await readdir(res)) {
  if (!dir.startsWith('mipmap-') || dir.includes('anydpi')) continue
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const file = join(res, dir, name)
    const meta = await sharp(file).metadata().catch(() => null)
    if (!meta?.width) continue
    await render(file, meta.width, name === 'ic_launcher_foreground.png' ? { background: false, scale: 0.72 } : {})
  }
}
await render('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024)
console.log('icons written')
