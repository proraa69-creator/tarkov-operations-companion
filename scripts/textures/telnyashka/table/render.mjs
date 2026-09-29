// Renders the Telnyashka sidebar still life (scene.js) into transparent WebP layers.
//
//   node scripts/textures/telnyashka/table/render.mjs                 # write the layers + layout
//   node scripts/textures/telnyashka/table/render.mjs --preview a.png # also save a composed preview
//   PW_CHROMIUM=/path/to/chrome node scripts/textures/telnyashka/table/render.mjs
//
// A tiny static server (repository root) serves scene.html, which imports three.js from node_modules. Headless
// Chromium renders every layer twice (over black and over white) and recovers exact alpha; sharp encodes WebP.
// Outputs:
//   src/assets/textures/telnyashka/table/{base,sausage,slice-1..5}.webp   (rendered at 3x the CSS size)
//   src/theme/telnyashka/tableLayers.ts                                    (layer boxes and hover vectors, CSS px)
import { chromium } from 'playwright'
import sharp from 'sharp'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../../..')
const outDir = path.join(root, 'src/assets/textures/telnyashka/table')
const layoutFile = path.join(root, 'src/theme/telnyashka/tableLayers.ts')
const SCALE = 3 // rendered px per CSS px
const args = process.argv.slice(2)
const previewPath = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null
const query = args.includes('--query') ? args[args.indexOf('--query') + 1] : ''

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404')) console.error('console', m.text()) })
  await page.goto(`http://127.0.0.1:${port}/scripts/textures/telnyashka/table/scene.html${query ? `?${query}` : ''}`)
  await page.waitForFunction(() => document.title === 'ready', null, { timeout: 180000 })

  if (previewPath) {
    const url = await page.evaluate(() => window.renderPreview())
    fs.writeFileSync(previewPath, Buffer.from(url.split(',')[1], 'base64'))
    console.log('preview ->', previewPath)
  }
  if (args.includes('--preview-only')) process.exit(0)

  const result = await page.evaluate(() => window.renderLayers())
  fs.mkdirSync(outDir, { recursive: true })
  let total = 0
  const boxes = {}
  for (const l of result.layers) {
    const raw = Buffer.from(l.rgba, 'base64')
    const file = path.join(outDir, `${l.name}.webp`)
    await sharp(raw, { raw: { width: l.w, height: l.h, channels: 4 } }).webp({ quality: 90, alphaQuality: 92, effort: 6, smartSubsample: true }).toFile(file)
    const size = fs.statSync(file).size
    total += size
    console.log(`${l.name}.webp ${l.w}x${l.h} @ (${l.x},${l.y}) ${(size / 1024).toFixed(1)} KB`)
    boxes[l.name] = { x: +(l.x / SCALE).toFixed(2), y: +(l.y / SCALE).toFixed(2), w: +(l.w / SCALE).toFixed(2), h: +(l.h / SCALE).toFixed(2) }
  }
  console.log(`total ${(total / 1024).toFixed(1)} KB`)

  // hover vectors (CSS px): the sausage backs off along its own axis, each slice slides away from the cut end
  const [[tx, ty], [cx, cy]] = result.sausageAxis
  const len = Math.hypot(cx - tx, cy - ty), ax = (cx - tx) / len, ay = (cy - ty) / len
  const sausageShift = [+(-ax * 3).toFixed(2), +(-ay * 3).toFixed(2)]
  const spin = [-7, 9, -8, 6, -10]
  const slices = result.sliceCenters.map(([sx, sy], i) => {
    let dx = sx - cx, dy = sy - cy
    const d = Math.hypot(dx, dy) || 1
    dx = dx / d * 0.7 + ax * 0.5; dy = dy / d * 0.7 + ay * 0.5
    const n = Math.hypot(dx, dy), push = 3 + (i % 3) * 0.8
    return { ...boxes[`slice-${i + 1}`], dx: +(dx / n * push).toFixed(2), dy: +(dy / n * push).toFixed(2), rot: spin[i % spin.length] }
  })
  const b = boxes.sausage
  const toCss = ([x, y]) => [+(x / SCALE).toFixed(2), +(y / SCALE).toFixed(2)]
  const layout = {
    width: result.width / SCALE, height: result.height / SCALE,
    base: boxes.base,
    sausage: { ...b, dx: sausageShift[0], dy: sausageShift[1] },
    slices,
    // the pointer target: a capsule around the sausage axis and the slices (CSS px, scene coordinates)
    hit: { from: toCss(result.sausageAxis[0]), to: toCss(result.sausageAxis[1]), slices: result.sliceCenters.map(toCss) },
  }
  fs.writeFileSync(layoutFile, `// Generated by scripts/textures/telnyashka/table/render.mjs — do not edit by hand.\n// Layer boxes of the rendered still life in CSS px (scene ${layout.width}x${layout.height}), hover offsets in CSS px / deg.\nexport const TABLE_LAYOUT = ${JSON.stringify(layout, null, 2)} as const\n`)
  console.log('layout ->', path.relative(root, layoutFile))
} finally {
  await browser.close()
  server.close()
}
