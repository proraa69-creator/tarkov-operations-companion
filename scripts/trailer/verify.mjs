// Step 3: check the encoded trailer.
//   node scripts/trailer/verify.mjs [outDir] [t1,t2,...]
// Loads trailer.webm in a <video> element to confirm Chromium can play it (duration, size), then
// decodes stills at the given times with Playwright's bundled ffmpeg. (Headless Chromium plays the
// file but paints <video> black in screenshots/canvas on this setup, so stills come from ffmpeg.)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const video = join(here, '..', '..', 'website', 'public', 'media', 'trailer.webm')
const out = process.argv[2] ?? join(here, '.verify')
const times = (process.argv[3] ?? '1.9,6,11,16,21.5,26.5,32,37,42,47.5,52.5,58,63').split(',').map(Number)
mkdirSync(out, { recursive: true })

const data = readFileSync(video)
const server = createServer((req, res) => {
  if (req.url.startsWith('/v.webm')) { res.writeHead(200, { 'content-type': 'video/webm', 'content-length': data.length }); return res.end(data) }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<body style="margin:0;background:#000"><video id="v" src="/v.webm" muted preload="auto"></video></body>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ executablePath: process.env.TRAILER_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${server.address().port}/`)
const info = await page.evaluate(() => new Promise((resolve) => {
  const v = document.getElementById('v')
  const done = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, canPlay: v.canPlayType('video/webm; codecs="vp8"') })
  if (v.readyState >= 1) done(); else v.addEventListener('loadedmetadata', done, { once: true })
}))
console.log('browser sees', info, `${(data.length / 1024 / 1024).toFixed(2)} MB`)
await browser.close()
server.close()

const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
const dir = readdirSync(base).find((d) => d.startsWith('ffmpeg'))
const ffmpeg = process.env.TRAILER_FFMPEG ?? join(base, dir, 'ffmpeg-linux')
if (!existsSync(ffmpeg)) throw new Error('bundled ffmpeg not found')
for (const t of times) {
  const path = join(out, `frame-${String(t).padStart(2, '0')}s.png`)
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', path], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`ffmpeg failed at ${t}s`)
  console.log(path)
}
