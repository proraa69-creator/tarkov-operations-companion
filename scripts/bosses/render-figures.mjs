// Renders the owner's boss models (Tripo GLB exports) into standing figures for the Overview raid card.
// The figures never move, so they ship as trimmed transparent WebP stills instead of heavy GLBs.
//   node scripts/bosses/render-figures.mjs <dir with <key>.glb files>   (default: work/bosses-src)
//   -> src/assets/boss-figures/<key>.webp   (keys: see src/data/bossFigures.ts)
import { chromium } from 'playwright'
import sharp from 'sharp'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const srcDir = path.resolve(process.argv[2] || path.join(root, 'work/bosses-src'))
const outDir = path.join(root, 'src/assets/boss-figures')
const only = process.argv.slice(3)
const HEIGHT = 900
// pose corrections about the feet, same as BOSS_MODEL_FIX in src/data/bossModels.ts
const ROLL = { partisan: 9.3 }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const p = url.startsWith('/__src/') ? path.join(srcDir, url.slice(7)) : path.join(root, url)
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
fs.mkdirSync(outDir, { recursive: true })
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.glb') && (!only.length || only.includes(f.replace(/\.glb$/, ''))))
for (const file of files) {
  const key = file.replace(/\.glb$/, '')
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/scripts/bosses/figure.html?m=/__src/${encodeURIComponent(file)}&h=${HEIGHT}&roll=${ROLL[key] ?? 0}`)
  await page.waitForFunction(() => document.title !== '', null, { timeout: 180000 })
  if (!(await page.title()).startsWith('done')) { console.error(key, await page.title()); await page.close(); continue }
  const png = Buffer.from((await page.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64')
  await page.close()
  const trimmed = await sharp(png).trim({ threshold: 1 }).toBuffer()
  const out = path.join(outDir, `${key}.webp`)
  await sharp(trimmed).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(out)
  const meta = await sharp(out).metadata()
  console.log(`${key}.webp ${meta.width}x${meta.height} ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
}
await browser.close()
server.close()
