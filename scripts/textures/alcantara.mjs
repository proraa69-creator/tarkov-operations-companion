// Bakes the Alcantara detail map for the «Алькантара» theme (src/styles/theme-alcantara.css).
//
//   node scripts/textures/alcantara.mjs
//   PW_CHROMIUM=/path/to/chrome node scripts/textures/alcantara.mjs
//   node scripts/textures/alcantara.mjs --preview <dir>   # also writes 1:1 / 3× crops over the theme colour to look at
//
// One 2048² master (alcantara-texgen.js, headless Chromium) → src/assets/textures/alcantara/alcantara-{1024,2048}.webp.
// The theme shows the tile at 1024 CSS px: the 1024 file on 1× screens, the 2048 one on 2× screens (image-set).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '../../src/assets/textures/alcantara')
const args = process.argv.slice(2)
const previewDir = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null
const OUT = [{ size: 1024, quality: 0.8 }, { size: 2048, quality: 0.74 }]

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
})
const page = await browser.newPage()
await page.addScriptTag({ path: path.join(here, 'alcantara-texgen.js') })
const { urls, ms } = await page.evaluate(([s, o]) => window.renderAlcantara(s, o), [2048, OUT])
fs.mkdirSync(outDir, { recursive: true })
OUT.forEach(({ size }, k) => {
  const file = path.join(outDir, `alcantara-${size}.webp`)
  fs.writeFileSync(file, Buffer.from(urls[k].split(',')[1], 'base64'))
  console.log(`alcantara ${size}² ${(fs.statSync(file).size / 1e6).toFixed(2)} MB  (${ms} ms)`)
})

if (previewDir) {
  // the tile over the theme's panel colour, as the CSS does it (overlay blend), 2×2 tiles to check the seams
  fs.mkdirSync(previewDir, { recursive: true })
  const view = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })
  const tex = urls[1]
  await view.setContent(`<body style="margin:0;background:#111">
    <div id="a" style="width:1200px;height:800px;background:url(${tex}) 0 0/1024px,#2a2b2f;background-blend-mode:overlay,normal"></div></body>`)
  await view.waitForTimeout(300)
  await view.screenshot({ path: path.join(previewDir, 'tile-2x.png') })
  await view.screenshot({ path: path.join(previewDir, 'seam-crop.png'), clip: { x: 924, y: 0, width: 200, height: 140 } })
  const zoom = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 })
  await zoom.setContent(`<body style="margin:0"><div style="width:600px;height:400px;background:url(${tex}) -300px -300px/3072px,#2a2b2f;background-blend-mode:overlay,normal;image-rendering:pixelated"></div></body>`)
  await zoom.waitForTimeout(300)
  await zoom.screenshot({ path: path.join(previewDir, 'zoom-3x.png') })
}
await browser.close()
