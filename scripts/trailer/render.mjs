// Step 2 of the trailer: render scripts/trailer/trailer.html into website/public/media/.
//
//   node scripts/trailer/render.mjs                           deterministic: seek every frame, pipe JPEGs to ffmpeg
//   node scripts/trailer/render.mjs --preview=1,5.5,10        only save stills of the timeline (see --preview-dir=)
//   node scripts/trailer/render.mjs --preview=scenes          one still near the end of every scene
//   node scripts/trailer/render.mjs --cut=ad [--music]        the ~30 s advert (trailer.html?cut=ad) into scripts/trailer/out/:
//                                                             raidos-ad-silent.mp4 and, with --music, raidos-ad-music.mp4
//                                                             (music.mjs + loudness -14 LUFS); 1080p, not shipped with the site
//
// Outputs what the website ships (website/public/media): trailer.mp4 — H.264 1280x720 yuv420p faststart, about 3–4 MB
// (it is packed into the server exe, so every MB slows the server's start; every current browser and iPhone plays it) —
// and trailer-poster.jpg (1280x720). Frames are rendered at 1920x1080 and scaled down by ffmpeg. Needs an ffmpeg with
// libx264: TRAILER_FFMPEG, else the one on PATH, else Playwright's bundled one (which has no libx264).
// --webm also writes a full-size 1080p VP8 trailer.webm next to this script (not shipped).
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = normalize(join(here, '..', '..'))
const CUT = process.argv.find((a) => a.startsWith('--cut='))?.slice(6) ?? 'site'
// the site trailer goes to the website; other cuts (the advert) to a local folder (gitignored)
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? (CUT === 'site' ? join(root, 'website', 'public', 'media') : join(here, 'out'))
const BASENAME = CUT === 'site' ? 'trailer' : `raidos-${CUT}`
const WANT_MUSIC = process.argv.includes('--music')
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
// Constrained-quality VP8 (only with --webm): about 2.3 Mb/s keeps a minute of 1080p under 20 MB.
const VP8 = ['-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-b:v', '2300k', '-maxrate', '3500k', '-bufsize', '7000k', '-crf', '9', '-qmin', '2', '-qmax', '34',
  '-quality', 'good', '-cpu-used', '1', '-auto-alt-ref', '1', '-lag-in-frames', '16', '-g', '60', '-an']
// The shipped 720p H.264: mostly still frames with slow moves, so crf 27 stays sharp at about 0.5 Mb/s.
const H264 = ['-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '27',
  '-maxrate', '1500k', '-bufsize', '3000k', '-movflags', '+faststart', '-an']
// Adverts are uploaded to social networks, which re-encode them: full 1080p at a high quality.
const H264_AD = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '18', '-maxrate', '12M', '-bufsize', '24M',
  '-g', '60', '-movflags', '+faststart', '-an']
const WANT_WEBM = process.argv.includes('--webm')

// Small static server so fonts/images load over http (file:// blocks font loading).
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
const server = createServer((req, res) => {
  const path = normalize(join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!path.startsWith(here) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  createReadStream(path).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const URL_ = `http://127.0.0.1:${server.address().port}/trailer.html${CUT === 'site' ? '' : `?cut=${CUT}`}`

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

const webm = join(here, 'trailer.webm')
const mp4 = join(OUT, CUT === 'site' ? 'trailer.mp4' : `${BASENAME}-silent.mp4`)
let cuesFile = null
if (!hasX264) throw new Error('No ffmpeg with libx264: set TRAILER_FFMPEG or put one on PATH (the site ships trailer.mp4)')
{
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await load(context)
  const duration = await page.evaluate(() => window.__duration)
  if (CUT !== 'site') {
    // scene times and sound cues for music.mjs
    cuesFile = join(OUT, `${BASENAME}.cues.json`)
    writeFileSync(cuesFile, JSON.stringify(await page.evaluate(() => ({ cut: window.__cut, duration: window.__duration, fade: 0.4, times: window.__times, cues: window.__cues })), null, 1))
  }
  const input = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0']
  const jobs = [spawn(hasX264, [...input, ...(CUT === 'site' ? H264 : H264_AD), '-r', String(FPS), mp4], { stdio: ['pipe', 'inherit', 'inherit'] })]
  if (WANT_WEBM) jobs.push(spawn(FFMPEG, [...input, ...VP8, '-r', String(FPS), webm], { stdio: ['pipe', 'inherit', 'inherit'] }))
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

// Poster: the title card, rendered at 1280x720 (site trailer only).
if (CUT === 'site') {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 / 3 })
  const page = await load(context)
  await page.evaluate(() => window.__seek(1.95))
  await page.screenshot({ path: join(OUT, 'trailer-poster.jpg'), type: 'jpeg', quality: 90 })
  await context.close()
}

await browser.close()
server.close()

// Advert with sound: music.mjs writes a WAV for the cut's cues, ffmpeg brings it to -14 LUFS (two passes, linear) and
// muxes it as AAC next to the silent video.
let withMusic = null
if (CUT !== 'site' && WANT_MUSIC) {
  const wav = join(OUT, `${BASENAME}-music.wav`)
  const made = spawnSync(process.execPath, [join(here, 'music.mjs'), `--cues=${cuesFile}`, `--out=${wav}`], { stdio: 'inherit' })
  if (made.status !== 0) throw new Error('music.mjs failed')
  const measure = spawnSync(hasX264, ['-hide_banner', '-i', wav, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = JSON.parse(measure.stderr.slice(measure.stderr.lastIndexOf('{'), measure.stderr.lastIndexOf('}') + 1))
  const norm = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  withMusic = join(OUT, `${BASENAME}-music.mp4`)
  const mux = spawnSync(hasX264, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', norm, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', withMusic], { stdio: 'inherit' })
  if (mux.status !== 0) throw new Error('ffmpeg mux failed')
}

for (const p of [mp4, ...(CUT === 'site' ? [join(OUT, 'trailer-poster.jpg')] : []), ...(withMusic ? [withMusic] : []), ...(WANT_WEBM ? [webm] : [])]) {
  if (existsSync(p)) console.log(p, (statSync(p).size / 1024 / 1024).toFixed(2), 'MB')
}
