// «Стекло» over «Чёрный мультикам» (src/styles/style-glass-cloth.css): the multicam seen through frosted glass.
// The scheme's own tile is near black (values 5–36), so under the glass it was all but gone: this copy lifts and stretches it
// (5 → 10, 36 → 94) and softens it a little, as the frost would. Run: node scripts/textures/glass-cloth.mjs
import sharp from 'sharp'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = `${root}src/assets/textures/blackmc/blackmc-2048.webp`
const target = `${root}src/assets/textures/glass/blackmc-cloth.webp`

await sharp(source)
  .resize(1536, 1536, { kernel: 'lanczos3' })
  .linear(2.7, 10 - 5 * 2.7)
  .blur(1.2)
  .webp({ quality: 82, effort: 6 })
  .toFile(target)
console.log(`${target}: ${Math.round(statSync(target).size / 1024)} KB`)
