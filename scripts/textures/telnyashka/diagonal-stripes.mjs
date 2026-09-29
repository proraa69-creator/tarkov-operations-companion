// Derives a diagonal telnyashka knit from the existing horizontal stripes tile by a tile-preserving 45° shear.
import { chromium } from 'playwright'
import fs from 'node:fs'
// Needs the Vite dev server on :5199 (npx vite --port 5199) and Playwright's Chromium.
const dir = new URL('../../../src/assets/textures/telnyashka/', import.meta.url).pathname
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage()
await p.goto('http://localhost:5199/')
for (const [size, q] of [[1024, 0.86], [2048, 0.72]]) {
  const url = `http://localhost:5199/src/assets/textures/telnyashka/stripes-${size}.webp`
  const data = await p.evaluate(async ({ url, q }) => {
    const img = new Image(); img.src = url; await img.decode()
    const N = img.width
    const c = document.createElement('canvas'); c.width = N; c.height = N
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
    const src = ctx.getImageData(0, 0, N, N); const dst = ctx.createImageData(N, N)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sy = (y + x) % N
      const si = (sy * N + x) * 4, di = (y * N + x) * 4
      dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255
    }
    ctx.putImageData(dst, 0, 0)
    return c.toDataURL('image/webp', q)
  }, { url, q })
  fs.writeFileSync(`${dir}stripes-diag-${size}.webp`, Buffer.from(data.split(',')[1], 'base64'))
}
await b.close()
