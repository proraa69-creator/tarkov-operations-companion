// Renders the owner's boss models (Tripo GLB exports) into standing figures for the Overview raid card.
// The figures never move, so they ship as trimmed transparent WebP stills instead of heavy GLBs.
//   node scripts/bosses/render-figures.mjs [dir with <key>.glb files] [key ...]
//   (default dir: work/bosses-src, the full-size originals, else src/assets/boss-models)
//   -> src/assets/boss-figures/<key>.webp   (keys: see src/data/bossFigures.ts)
//   -> src/assets/boss-figures/sizes.json   { key: height of the still in body heights } — the Overview scales
//      every still by it, so all bosses on a map card stand at the same real-world scale
//   -> src/assets/boss-figures/frames.json  { key: [left, top, width, height] } — where the still sits in the Gallery
//      viewer's start view, in heights of the view (left from its centre), so the still shown while a model loads is
//      exactly where the model appears.  --frames: only this file (the stills and sizes are kept as they are).
// The page (figure.html + figure.ts) is served by Vite so it uses the very same look as the Gallery's live
// 3D viewer — src/gallery/bossLook.ts: tone mapping, lights and material grade. No extra colour grading here.
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const defaultDir = fs.existsSync(path.join(root, 'work/bosses-src')) ? path.join(root, 'work/bosses-src') : path.join(root, 'src/assets/boss-models')
const srcDir = path.resolve(process.argv[2] || defaultDir)
// RENDER_FIGURES_OUT: somewhere else (previews of other models, e.g. the traders)
const outDir = path.resolve(root, process.env.RENDER_FIGURES_OUT || 'src/assets/boss-figures')
const framesOnly = process.argv.includes('--frames')
const only = process.argv.slice(3).filter((arg) => arg !== '--frames')
const HEIGHT = 1100
// pose corrections about the feet, same as BOSS_MODEL_FIX in src/data/bossModels.ts
const ROLL = { partisan: 9.3 }
// seated figures: head height as a share of standing height (the still is scaled as if he stood up)
const SEATED = { kollontay: 0.72 }

const vite = await createServer({
  root, configFile: false, logLevel: 'warn', appType: 'mpa',
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, srcDir] } },
})
await vite.listen()
const port = vite.httpServer.address().port
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
fs.mkdirSync(outDir, { recursive: true })
const sizesFile = path.join(outDir, 'sizes.json')
const sizes = fs.existsSync(sizesFile) ? JSON.parse(fs.readFileSync(sizesFile, 'utf8')) : {}
const framesFile = path.join(outDir, 'frames.json')
const frames = fs.existsSync(framesFile) ? JSON.parse(fs.readFileSync(framesFile, 'utf8')) : {}
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.glb') && !f.startsWith('_') && (!only.length || only.includes(f.replace(/\.glb$/, ''))))
for (const file of files) {
  const key = file.replace(/\.glb$/, '')
  const page = await browser.newPage()
  const model = '/@fs/' + path.join(srcDir, file).split(path.sep).join('/').replace(/^\//, '')
  await page.goto(`http://127.0.0.1:${port}/scripts/bosses/figure.html?m=${encodeURIComponent(model)}&h=${HEIGHT}&roll=${ROLL[key] ?? 0}&seated=${SEATED[key] ?? 1}`)
  await page.waitForFunction(() => document.title !== '', null, { timeout: 180000 })
  const title = await page.title()
  if (!title.startsWith('done')) { console.error(key, title); await page.close(); continue }
  const png = Buffer.from((await page.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64')
  await page.close()
  const bodyPx = Number(title.split(' ')[1])
  const { data: trimmed, info } = await sharp(png).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true })
  // the trimmed still within the full frame (its height is the viewer's), left measured from the frame's centre
  const width = HEIGHT * 0.75, left = -(info.trimOffsetLeft ?? 0), top = -(info.trimOffsetTop ?? 0)
  frames[key] = [(left - width / 2) / HEIGHT, top / HEIGHT, info.width / HEIGHT, info.height / HEIGHT].map((v) => +v.toFixed(5))
  if (framesOnly) { console.log(`${key} frame ${JSON.stringify(frames[key])} (${info.width}x${info.height})`); continue }
  sizes[key] = +(info.height / bodyPx).toFixed(4)
  const out = path.join(outDir, `${key}.webp`)
  await sharp(trimmed).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(out)
  const meta = await sharp(out).metadata()
  console.log(`${key}.webp ${meta.width}x${meta.height} ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${sizes[key]} body heights`)
}
if (!framesOnly) fs.writeFileSync(sizesFile, JSON.stringify(Object.fromEntries(Object.entries(sizes).sort()), null, 2) + '\n')
fs.writeFileSync(framesFile, JSON.stringify(Object.fromEntries(Object.entries(frames).sort()), null, 2) + '\n')
await browser.close()
await vite.close()
