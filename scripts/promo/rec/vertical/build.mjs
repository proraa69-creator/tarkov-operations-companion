// The vertical 9:16 cut (~27.6 s): a logo card with the scene-1 voice, six crops of the finished landscape video with
// big captions, and the end card with the scene-20 voice; the project's own synthesised music under it.
//   node vertical/build.mjs ru      (needs promo/out/<lang>/video-<lang>.mp4 from assemble.mjs)
import { chromium, stageAssets } from '../../env.mjs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { schedule } from '../schedule.mjs'
import { S, FF } from '../rec.mjs'
import { REPO } from '../../env.mjs'
const lang = process.argv[2] ?? 'ru'
const DIR = `${S}/promo/rec/vertical`
await stageAssets(DIR)
const OUT = `${S}/promo/out/${lang}`
const FPS = 30
const { scenes } = schedule(lang)
const TEXT = {
  ru: {
    introSub: 'Приложение для<br><em>Escape from Tarkov</em>', tag1: 'Меньше вкладок,', tag2: 'больше рейдов.', download: 'Скачать для Windows', soonPhones: 'Скоро — на iPhone и Android',
    shots: {
      kappa: ['Каппа', 'Нажал клавишу — предметы уже в приложении'], item: ['В рейде', 'Нужен ли предмет — видно сразу'],
      minimap: ['Мини-карта', 'Поверх игры: ты и квесты рядом'], maps: ['Карты', 'Рулетка, маркеры и боссы'],
      gunsmith: ['Оружейник', 'Сборка и нужные модули'], bosses: ['Боссы', '3D-модели и тактика боя'],
    },
  },
  en: {
    introSub: 'The companion app for<br><em>Escape from Tarkov</em>', tag1: 'Fewer tabs,', tag2: 'more raids.', download: 'Download for Windows', soonPhones: 'Soon on iPhone and Android',
    shots: {
      kappa: ['Kappa', 'Press a key — the items are in the app'], item: ['In raid', 'Needed or not — see it at once'],
      minimap: ['Minimap', 'On top of the game: you and nearby quests'], maps: ['Maps', 'Ruler, markers and bosses'],
      gunsmith: ['Gunsmith', 'The build and the parts you need'], bosses: ['Bosses', '3D models and combat tactics'],
    },
  },
}
const text = TEXT[lang]
// Shots: source span in the landscape video (global seconds) and a crop of aspect 1000:1080; `pan` slides the crop to
// x over `dur` seconds from `at` (shot time): the Kappa shot goes from the key press in the stash to the app.
const crop = (x, y, w) => ({ x, y, w, h: Math.round(w * 1.08) })
const SHOTS = [
  { id: 'kappa', src: 29.9, dur: 4.0, crop: crop(40, 0, 1000), pan: { x: 840, at: 1.2, dur: 0.8 } },
  { id: 'item', src: 87.55, dur: 3.2, crop: crop(800, 151, 860) },
  { id: 'minimap', src: 101.9, dur: 3.0, crop: crop(1215, 10, 680) },
  { id: 'maps', src: 72.2, dur: 3.0, crop: crop(520, 0, 1000) },
  { id: 'gunsmith', src: 47.55, dur: 2.8, crop: crop(930, 43, 960) },
  // The model and its card without the modal's title (cut by any crop that keeps the tip card out); ends before the
  // arrows flip to the next boss.
  { id: 'bosses', src: 117.7, dur: 2.6, crop: crop(605, 60, 915) },
]
/** The crop's x: fixed, or a smoothstep slide (ffmpeg expression, quoted for the filter graph). */
const cropX = (s) => (s.pan ? `'st(0,clip((t-${s.pan.at})/${s.pan.dur},0,1));${s.crop.x}+${s.pan.x - s.crop.x}*ld(0)*ld(0)*(3-2*ld(0))'` : s.crop.x)
const INTRO = 3.7, END = 5.3
let t = INTRO
const shots = SHOTS.map((s) => { const from = t; t += s.dur; return { ...s, from, to: t, eyebrow: text.shots[s.id][0], title: text.shots[s.id][1] } })
const endStart = t
const duration = endStart + END
const frames = Math.round(duration * FPS)
const at = { introEnd: INTRO, v1: 0.3, p1: 1.17, endStart, v20: endStart + 0.3, p20: [1.08, 2.18, 3.41], duration }

const video = `${OUT}/vertical-video-${lang}.mp4`
/** Frames of a video, decoded (a stream copy reports no frame count). */
const countFrames = (file) => Number([...spawnSync(FF, ['-hide_banner', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.matchAll(/frame=\s*(\d+)/g)].pop()?.[1])
// --reuse: keep a finished picture of the right length and only redo the sound.
const reuse = process.argv.includes('--reuse') && existsSync(video) && countFrames(video) === frames

// ---- zone stills: each shot cut on its own (one input per ffmpeg run), numbered into one sequence ----------------------
// The first shot holds its first frame under the intro card and the last one its last frame under the end card (both
// cards fade over them). tpad needs a known frame rate (trim/setpts drop it), or its clones all get pts 0.
const introFrames = Math.round(INTRO * FPS), endFrames = frames - Math.round(endStart * FPS)
const zdir = `${DIR}/zone-${lang}`
if (!reuse) {
  rmSync(zdir, { recursive: true, force: true }); mkdirSync(zdir, { recursive: true })
  let next = 0
  shots.forEach((s, i) => {
    const pad = [i === 0 ? `tpad=start_mode=clone:start=${introFrames}` : '', i === shots.length - 1 ? `tpad=stop_mode=clone:stop=${endFrames}` : ''].filter(Boolean)
    const n = Math.round(s.dur * FPS) + (i === 0 ? introFrames : 0) + (i === shots.length - 1 ? endFrames : 0)
    execFileSync(FF, ['-v', 'error', '-y', '-ss', s.src.toFixed(3), '-t', (s.dur + 0.3).toFixed(3), '-i', `${OUT}/video-${lang}.mp4`,
      '-vf', [`fps=${FPS}`, 'setpts=PTS-STARTPTS', `crop=${s.crop.w}:${s.crop.h}:${cropX(s)}:${s.crop.y}`, 'scale=1000:1080:flags=lanczos', 'setsar=1', `trim=end_frame=${Math.round(s.dur * FPS)}`, `setpts=N/(${FPS}*TB)`, `fps=${FPS}`, ...pad].join(','),
      '-frames:v', String(n), '-fps_mode', 'passthrough', '-start_number', String(next), '-q:v', '1', '-qmin', '1', `${zdir}/%04d.jpg`])
    next += n
  })
  if (!existsSync(`${zdir}/${String(frames - 1).padStart(4, '0')}.jpg`) || existsSync(`${zdir}/${String(frames).padStart(4, '0')}.jpg`)) throw new Error(`zone stills ≠ ${frames}`)

  // ---- frames: the browser draws the whole frame and pipes it straight to the encoder (a single input: ffmpeg 7.0's
  // scheduler stalled every multi-input graph here — looped stills, a shot held back by tpad, concat) -----------------
  execFileSync(FF, ['-v', 'error', '-y', '-i', `${S}/promo/rec/closing/intro-bg-${lang}.png`, '-vf', 'crop=1080:1080:420:0', `${DIR}/intro-bg-${lang}.png`])
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
  await page.goto(`file://${DIR}/stage.html?p=${encodeURIComponent(JSON.stringify({ mode: 'overlay', full: true, text, shots, at, introBg: `intro-bg-${lang}.png` }))}`)
  await page.evaluate(() => window.ready)
  await page.waitForTimeout(200)
  const enc = spawn(FF, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = once(enc, 'close')
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate(async ([x, src]) => { await window.setZone(src); window.render(x) }, [i / FPS, `zone-${lang}/${String(i).padStart(4, '0')}.jpg`])
    if (!enc.stdin.write(await page.screenshot({ type: 'png' }))) await once(enc.stdin, 'drain')
    if (i % 120 === 0) console.log('frame', i, '/', frames)
}
enc.stdin.end()
const [code] = await done
await browser.close()
if (code !== 0) throw new Error(`encoder exited with ${code}`)
const got = countFrames(video)
if (got !== frames) throw new Error(`vertical video has ${got} frames, expected ${frames}`)
}

// ---- audio: two voice lines, the music ducked under them -------------------------------------------------------------
const times = { intro: [0, INTRO], ...Object.fromEntries(shots.map((s) => [s.id, [s.from, s.to]])), outro: [endStart, duration] }
times.boss = times.minimap; times.fair = times.bosses
writeFileSync(`${OUT}/vertical-cues.json`, JSON.stringify({ duration, fade: 0, times, cues: [{ t: 0.15, kind: 'logo' }] }))
execFileSync('node', [`${REPO}/scripts/trailer/music.mjs`, `--cues=${OUT}/vertical-cues.json`, `--out=${OUT}/vertical-music-${lang}.wav`], { stdio: 'inherit' })
const ms = (x) => Math.round(x * 1000)
execFileSync(FF, ['-v', 'error', '-y', '-i', `${S}/promo/voice/${lang}/s01.mp3`, '-i', `${S}/promo/voice/${lang}/s20.mp3`, '-i', `${OUT}/vertical-music-${lang}.wav`, '-i', video,
  '-filter_complex', `[0:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(at.v1)}|${ms(at.v1)}[a1];[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(at.v20)}|${ms(at.v20)}[a2];` +
  `[a1][a2]amix=inputs=2:normalize=0:duration=longest,apad,atrim=0:${duration.toFixed(3)},asplit=2[vo][sc];[2:a]volume=0.5[mu];[mu][sc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=420[duck];[vo][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
  '-map', '3:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', `${S}/promo/out/raidos-vertical-${lang}.mp4`], { stdio: 'inherit' })
console.log('vertical', duration.toFixed(2), 's,', frames, 'frames →', `${S}/promo/out/raidos-vertical-${lang}.mp4`)
