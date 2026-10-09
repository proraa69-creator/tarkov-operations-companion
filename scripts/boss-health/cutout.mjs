// The boss health card's skeleton: cuts the figure out of the owner's X-ray picture (the dark background becomes
// transparent, the picture itself is not retouched).
//   node scripts/boss-health/cutout.mjs
// Source: src/assets/boss-health/source/xray-body.webp (1328×2000) → src/assets/boss-health/xray-skeleton.webp.
// CROP must match SKELETON_CROP in src/components/BodyHealthFigure.tsx.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const sharp = createRequire(import.meta.url)('sharp')
const root = fileURLToPath(new URL('../../', import.meta.url))
const CROP = { left: 360, top: 195, width: 710, height: 1485 }
// Background near the figure stays under ~35 of 255, the body (bones and the translucent flesh) is above ~60.
const LOW = 24
const HIGH = 56

const { data, info } = await sharp(`${root}src/assets/boss-health/source/xray-body.webp`).extract(CROP).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const rgba = Buffer.alloc(info.width * info.height * 4)
for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  const t = Math.min(1, Math.max(0, (lum - LOW) / (HIGH - LOW)))
  rgba[j] = data[i]
  rgba[j + 1] = data[i + 1]
  rgba[j + 2] = data[i + 2]
  rgba[j + 3] = Math.round(255 * t * t * (3 - 2 * t))
}
await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .resize({ width: 640 })
  .webp({ quality: 88, alphaQuality: 90 })
  .toFile(`${root}src/assets/boss-health/xray-skeleton.webp`)
console.log('src/assets/boss-health/xray-skeleton.webp')
