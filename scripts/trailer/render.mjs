// Step 2 of the trailer: render scripts/trailer/trailer.html into website/public/media/.
//
//   node scripts/trailer/render.mjs                           deterministic: seek every frame, pipe JPEGs to ffmpeg
//   node scripts/trailer/render.mjs --preview=1,5.5,10        only save stills of the timeline (see --preview-dir=)
//   node scripts/trailer/render.mjs --preview=scenes          one still near the end of every scene
//
// Outputs trailer.webm (VP8, <= 20 MB), trailer-poster.jpg (1280x720) and trailer.mp4 (H.264 yuv420p faststart, plays
// on iPhone). ffmpeg: TRAILER_FFMPEG, else Playwright's bundled one (VP8 only, no mp4). The mp4 needs an ffmpeg with
// libx264 (TRAILER_FFMPEG=/path/to/ffmpeg, or one on PATH).
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = normalize(join(here, '..', '..'))
const OUT = join(root, 'website', 'public', 'media')
const FPS = 30
const CHROMIUM = process.env.TRAILER_CHROMIUM ?? '/opt/pw-browsers/chromium'
mkdirSync(OUT, { recursive: true })

function findBundledFfmpeg() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const dir = existsSync(base) ? readdirSync(base).find((d) => d.startsWith('ffmpeg')) : null
  const bin = dir && join(base, dir, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux')
  if (bin && existsSync(bin)) return bin
  throw new Error('ffmpeg not found: set TRAILER_FFMPEG or run `npx playwright install ffmpeg`')
}
const FFMPEG = process.env.TRAILER_FFMPEG ?? findBundledFfmpeg()
const hasX264 = (() => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  if (r.status === 0 && r.stdout.includes('libx264')) return FFMPEG
  const sys = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  return sys.status === 0 && sys.stdout.includes('libx264') ? 'ffmpeg' : null
})()
// Constrained-quality VP8: about 2.3 Mb/s keeps 66 s of 1080p under 20 MB; the picture is mostly still frames.
const VP8 = ['-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-b:v', '2300k', '-maxrate', '3500k', '-bufsize', '7000k', '-crf', '9', '-qmin', '2', '-qmax', '34',
  '-quality', 'good', '-cpu-used', '1', '-auto-alt-ref', '1', '-lag-in-frames', '16', '-g', '60', '-an']
const H264 = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '22', '-movflags', '+faststart', '-an']

// Small static server so fonts/images load over http (file:// blocks font loading).
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
const server = createServer((req, res) => {
  const path = normalize(join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!path.startsWith(here) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const URL_ = `http://127.0.0.1:${server.address().port}/trailer.html`

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'] })

async function load(context) {
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('page error', e.message))
  await page.goto(URL_)
  await page.evaluate(() => window.__ready)
  return page
}

// --preview=1,5.5,10 | scenes [--preview-dir=/tmp/x]: just save stills of the timeline and stop.
const previewArg = process.argv.find((a) => a.startsWith('--preview='))
if (previewArg) {
  const dir = process.argv.find((a) => a.startsWith('--preview-dir='))?.slice(14) ?? join(here, '.preview')
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await load(context)
  const spec = previewArg.slice(10)
  let times
  if (spec === 'scenes') {
    const T = await page.evaluate(() => window.__times)
    times = Object.entries(T).flatMap(([name, [a, b]]) => [[name + '-a', a + 1.9], [name + '-b', b - 0.5]])
  } else times = spec.split(',').map((t) => [String(t), Number(t)])
  for (const [name, t] of times) {
    await page.evaluate((s) => window.__seek(s), t)
    await page.screenshot({ path: join(dir, `${name}.png`) })
  }
  console.log('previews in', dir)
  await browser.close(); server.close(); process.exit(0)
}

const webm = join(OUT, 'trailer.webm')
const mp4 = join(OUT, 'trailer.mp4')
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await load(context)
  const duration = await page.evaluate(() => window.__duration)
  const outputs = [...VP8, '-r', String(FPS), webm]
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...outputs]
  const jobs = [spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] })]
  if (hasX264) jobs.push(spawn(hasX264, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...H264, '-r', String(FPS), mp4], { stdio: ['pipe', 'inherit', 'inherit'] }))
  else console.log('No ffmpeg with libx264: skipping trailer.mp4')
  const done = jobs.map((ff) => new Promise((resolve, reject) => ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))))
  const frames = Math.round(duration * FPS)
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.__seek(t), i / FPS)
    const jpg = await page.screenshot({ type: 'jpeg', quality: 95 })
    for (const ff of jobs) if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
    if (i % 90 === 0) process.stdout.write(`frame ${i}/${frames}\n`)
  }
  for (const ff of jobs) ff.stdin.end()
  await Promise.all(done)
  await context.close()
}

// Poster: the title card, rendered at 1280x720.
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 / 3 })
  const page = await load(context)
  await page.evaluate(() => window.__seek(1.95))
  await page.screenshot({ path: join(OUT, 'trailer-poster.jpg'), type: 'jpeg', quality: 90 })
  await context.close()
}

await browser.close()
server.close()
for (const f of ['trailer.webm', 'trailer-poster.jpg', 'trailer.mp4']) {
  const p = join(OUT, f)
  if (existsSync(p)) console.log(f, (statSync(p).size / 1024 / 1024).toFixed(2), 'MB')
}
