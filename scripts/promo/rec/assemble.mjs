// The finished promo: the takes cut at their spans of the global timeline (exact frame counts) with short dissolves
// centred on every cut, each voice clip at its scene's voice start, the project's own synthesised music (scripts/trailer/
// music.mjs: no third-party audio) ducked under the voice, loudness -14 LUFS for social networks.
//   node assemble.mjs ru            → promo/out/raidos-promo-ru.mp4 (+ -nomusic variant)
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { schedule, takes } from './schedule.mjs'
import { S, FF } from './rec.mjs'
import { REPO } from '../env.mjs'
const lang = process.argv[2] ?? 'ru'
const OUT = `${S}/promo/out/${lang}`
const FPS = 30
const H = 4 // half of a dissolve, frames
const { scenes, total } = schedule(lang)
const { list } = takes(lang)
const frames = list.map((take) => Math.round(take.to * FPS) - Math.round(take.from * FPS))
const totalFrames = frames.reduce((a, b) => a + b, 0)
for (const take of list) if (!existsSync(`${OUT}/${take.id}.mp4`)) throw new Error(`missing take ${take.id}`)

// ---- video ---------------------------------------------------------------------------------------------------------
const inputs = list.flatMap((take) => ['-i', `${OUT}/${take.id}.mp4`])
const last = list.length - 1
let graph = list.map((take, i) => {
  // The frame rate is set again after trim: tpad needs it to time its cloned frames (without it they collide and drop).
  const pads = `tpad=start_mode=clone:start=${i > 0 ? H : 0}:stop_mode=clone:stop=${i < last ? H : 0}`
  return `[${i}:v]fps=${FPS},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=-1,trim=end_frame=${frames[i]},setpts=N/(${FPS}*TB),fps=${FPS},${pads},format=yuv420p[p${i}]`
}).join(';')
let length = frames[0] + (last > 0 ? H : 0)
let prev = 'p0'
for (let i = 1; i <= last; i += 1) {
  const offset = (length - 2 * H) / FPS
  graph += `;[${prev}][p${i}]xfade=transition=fade:duration=${(2 * H) / FPS}:offset=${offset.toFixed(6)}[x${i}]`
  length = length + frames[i] + H + (i < last ? H : 0) - 2 * H
  prev = `x${i}`
}
const video = `${OUT}/video-${lang}.mp4`
execFileSync(FF, ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', `[${prev}]`, '-frames:v', String(totalFrames), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: 'inherit' })
console.log('video', video, totalFrames, 'frames', (totalFrames / FPS).toFixed(3), 's, schedule', total.toFixed(3), 's')

// ---- voice ---------------------------------------------------------------------------------------------------------
const voiceInputs = [], voiceGraph = []
for (let n = 1; n <= 20; n += 1) {
  voiceInputs.push('-i', `${S}/promo/voice/${lang}/s${String(n).padStart(2, '0')}.mp3`)
  const ms = Math.round(scenes[n].voice * 1000)
  voiceGraph.push(`[${n - 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${n}]`)
}
const voice = `${OUT}/voice-${lang}.wav`
execFileSync(FF, ['-v', 'error', '-y', ...voiceInputs, '-filter_complex', `${voiceGraph.join(';')};${Array.from({ length: 20 }, (_, i) => `[v${i + 1}]`).join('')}amix=inputs=20:normalize=0:duration=longest,apad,atrim=0:${(totalFrames / FPS).toFixed(4)}[a]`, '-map', '[a]', '-c:a', 'pcm_s16le', voice], { stdio: 'inherit' })

// ---- music ---------------------------------------------------------------------------------------------------------
const at = (id) => list.find((take) => take.id === id).from
const span = (a, b) => [a, b]
const times = {
  intro: span(0, at('t02-overview')), overview: span(at('t02-overview'), at('t03-kappa')), kappa: span(at('t03-kappa'), at('t04-gunsmith-tasks-maps')),
  gunsmith: span(at('t04-gunsmith-tasks-maps'), at('t05-iteminfo')), item: span(at('t05-iteminfo'), at('t06-minimap')), minimap: span(at('t06-minimap'), at('t07-squad')),
  squad: span(at('t07-squad'), at('t08-bosses')), boss: span(at('t08-bosses'), at('t09a-flea-traders')), flea: span(at('t09a-flea-traders'), at('t09b-ballistics')),
  ballistics: span(at('t09b-ballistics'), at('t09c-themes-update')), themes: span(at('t09c-themes-update'), at('t09d-improve-bug')), improve: span(at('t09d-improve-bug'), at('t10-closing')),
  phones: span(scenes[18].start, scenes[19].start), fair: span(scenes[19].start, scenes[20].start), outro: span(scenes[20].start, total),
}
const cues = { duration: totalFrames / FPS, fade: 0, times, cues: [{ t: scenes[1].voice - 0.15, kind: 'logo' }] }
writeFileSync(`${OUT}/music-cues.json`, JSON.stringify(cues, null, 1))
const music = `${OUT}/music-${lang}.wav`
execFileSync('node', [`${REPO}/scripts/trailer/music.mjs`, `--cues=${OUT}/music-cues.json`, `--out=${music}`], { stdio: 'inherit' })

// ---- mix + mux -----------------------------------------------------------------------------------------------------
function mux(withMusic, out) {
  const audio = withMusic
    ? `[0:a]asplit=2[vo][sc];[1:a]volume=0.32[mu];[mu][sc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=420:makeup=1[duck];[vo][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`
    : `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]`
  execFileSync(FF, ['-v', 'error', '-y', '-i', voice, ...(withMusic ? ['-i', music] : []), '-i', video,
    '-filter_complex', audio, '-map', `${withMusic ? 2 : 1}:v`, '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' })
  console.log('→', out)
}
mux(true, `${S}/promo/out/raidos-promo-${lang}.mp4`)
mux(false, `${S}/promo/out/raidos-promo-${lang}-nomusic.mp4`)
