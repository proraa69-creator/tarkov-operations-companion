// Step 2 of the trailer: render scripts/trailer/trailer.html into website/public/media/.
//
//   node scripts/trailer/render.mjs              deterministic: seek every frame, pipe JPEGs to ffmpeg (default)
//   node scripts/trailer/render.mjs --realtime   Playwright recordVideo of the page playing in real time
//
// Outputs trailer.webm (VP8), trailer-poster.jpg (1280x720) and, only if an `ffmpeg` binary with
// libx264 is on PATH, trailer.mp4. Playwright's bundled ffmpeg (VP8 only) is used for the webm.
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = normalize(join(here, '..', '..'))
const OUT = join(root, 'website', 'public', 'media')
const FPS = 30
const REALTIME = process.argv.includes('--realtime')
const CHROMIUM = process.env.TRAILER_CHROMIUM ?? '/opt/pw-browsers/chromium'
mkdirSync(OUT, { recursive: true })

function findBundledFfmpeg() {
  if (process.env.TRAILER_FFMPEG) return process.env.TRAILER_FFMPEG
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const dir = existsSync(base) ? readdirSync(base).find((d) => d.startsWith('ffmpeg')) : null
  const bin = dir && join(base, dir, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux')
  if (bin && existsSync(bin)) return bin
  throw new Error('Playwright ffmpeg not found — run `npx playwright install ffmpeg` or set TRAILER_FFMPEG')
}
const FFMPEG = findBundledFfmpeg()
const VP8 = ['-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-b:v', '5M', '-maxrate', '7M', '-bufsize', '10M', '-crf', '8', '-qmin', '2', '-qmax', '40',
  '-quality', 'good', '-cpu-used', '1', '-auto-alt-ref', '1', '-lag-in-frames', '16', '-g', '60']

// Small static server so fonts/images load over http (file:// blocks font loading).
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = normalize(join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!path.startsWith(here) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const URL_ = `http://127.0.0.1:${server.address().port}/trailer.html`

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'] })

async function load(context, hash = '') {
  const page = await context.newPage()
  await page.goto(URL_ + hash)
  await page.evaluate(() => window.__ready)
  return page
}

function run(bin, args) {
  const r = spawnSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`${bin} exited with ${r.status}`)
}

const webm = join(OUT, 'trailer.webm')
const duration = 15

// --preview=1,5.5,10 [--preview-dir=/tmp/x]: just save stills of the timeline and stop.
const previewArg = process.argv.find((a) => a.startsWith('--preview='))
if (previewArg) {
  const dir = process.argv.find((a) => a.startsWith('--preview-dir='))?.slice(14) ?? join(here, '.preview')
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await load(context)
  for (const t of previewArg.slice(10).split(',').map(Number)) {
    await page.evaluate((s) => window.__seek(s), t)
    await page.screenshot({ path: join(dir, `t${t.toFixed(2)}.png`) })
  }
  console.log('previews in', dir)
  await browser.close(); server.close(); process.exit(0)
}

if (!REALTIME) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await load(context)
  const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...VP8, '-r', String(FPS), webm], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((resolve, reject) => ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))))
  const frames = duration * FPS
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.__seek(t), i / FPS)
    const jpg = await page.screenshot({ type: 'jpeg', quality: 94 })
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
    if (i % 60 === 0) process.stdout.write(`frame ${i}/${frames}\n`)
  }
  ff.stdin.end()
  await done
  await context.close()
} else {
  const tmp = join(here, '.recording')
  rmSync(tmp, { recursive: true, force: true })
  const t0 = Date.now()
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } })
  const page = await load(context)
  const lead = (Date.now() - t0) / 1000
  await page.evaluate(() => window.__play())
  await page.waitForTimeout(duration * 1000 + 300)
  const raw = await page.video().path()
  await context.close()
  // Trim the blank lead-in (page load) and re-encode at a higher bitrate than recordVideo's default.
  run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', raw, '-t', String(duration), ...VP8, webm])
  rmSync(tmp, { recursive: true, force: true })
}

// Poster: the title card, rendered at 1280x720.
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 / 3 })
  const page = await load(context)
  await page.evaluate(() => window.__seek(1.85))
  await page.screenshot({ path: join(OUT, 'trailer-poster.jpg'), type: 'jpeg', quality: 90 })
  await context.close()
}

await browser.close()
server.close()

// Optional H.264 copy when a full ffmpeg is installed.
const sys = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
if (sys.status === 0 && sys.stdout.includes('libx264')) {
  const mp4 = join(OUT, 'trailer.mp4')
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4 + '.tmp.mp4'])
  renameSync(mp4 + '.tmp.mp4', mp4)
  console.log('mp4:', mp4)
} else {
  console.log('No system ffmpeg with libx264 — skipped trailer.mp4')
}
for (const f of ['trailer.webm', 'trailer-poster.jpg', 'trailer.mp4']) {
  const p = join(OUT, f)
  if (existsSync(p)) console.log(f, (statSync(p).size / 1024 / 1024).toFixed(2), 'MB')
}
