// Sound variants of the 9:16 cut, to choose by ear: the same picture and voice with interface sounds only, a calm
// ambient bed, or a tense drone (rec/sound.mjs), each bed set to a fixed loudness under the voice.
//   node vertical/previews.mjs ru      (needs promo/out/<lang>/vertical-video-<lang>.mp4 from build.mjs)
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { S, FF } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const OUT = `${S}/promo/out/${lang}`
const video = `${OUT}/vertical-video-${lang}.mp4`
// Events of the cut (vertical/build.mjs: intro 3.7 s, shots kappa 3.7, item 7.7, minimap 10.9, maps 13.9, gunsmith
// 16.9, bosses 19.7, end card 22.3; voice lines at 0.3 and 22.6), read off its frames.
const duration = 27.6
const cues = [
  ['logo', 0.15],
  ['whoosh', 3.5], ['pop', 3.75], ['key', 4.35], ['ding', 5.45],
  ['whoosh', 7.7], ['pop', 7.75], ['key', 8.2], ['pop', 8.3], ['ding', 8.55],
  ['whoosh', 10.9], ['pop', 10.95], ['ping', 11.3], ['ping', 12.6],
  ['whoosh', 13.9], ['pop', 13.95], ['tick', 14.45],
  ['whoosh', 16.9], ['pop', 16.95],
  ['whoosh', 19.7], ['pop', 19.75], ['pop', 20.0],
  ['end', 22.3], ['tick', 23.7], ['tick', 24.8], ['tick', 26.0],
].map(([kind, t]) => ({ kind, t }))
writeFileSync(`${OUT}/vertical-sound-cues.json`, JSON.stringify({ duration, cues }))
const loudness = (file) => Number(spawnSync(FF, ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/)?.[1])
// Bed loudness (the voice is at −14 LUFS): the middle of the cut has no voice, so the bed carries it at 5–7 LU below
// the voice and is ducked further while the voice speaks.
const BED = { sfx: -21, ambient: -19, tension: -19 }
const ms = (x) => Math.round(x * 1000)
for (const style of Object.keys(BED)) {
  const wav = `${OUT}/vertical-sound-${style}.wav`
  execFileSync('node', [`${S}/promo/rec/sound.mjs`, `--cues=${OUT}/vertical-sound-cues.json`, `--style=${style}`, `--out=${wav}`], { stdio: 'inherit' })
  const gain = BED[style] - loudness(wav)
  const out = `${S}/promo/out/raidos-vertical-${lang}-${style}.mp4`
  execFileSync(FF, ['-v', 'error', '-y', '-i', `${S}/promo/voice/${lang}/s01.mp3`, '-i', `${S}/promo/voice/${lang}/s20.mp3`, '-i', wav, '-i', video,
    '-filter_complex', `[0:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(0.3)}|${ms(0.3)}[a1];[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(22.6)}|${ms(22.6)}[a2];` +
    `[a1][a2]amix=inputs=2:normalize=0:duration=longest,apad,atrim=0:${duration},loudnorm=I=-14:TP=-1.5:LRA=11,asplit=2[vo][sc];` +
    `[2:a]volume=${gain.toFixed(2)}dB[mu];[mu][sc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=420[duck];[vo][duck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.84[a]`,
    '-map', '3:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' })
  console.log(style, 'bed', gain.toFixed(1), 'dB →', out, 'mix', loudness(out), 'LUFS')
}
