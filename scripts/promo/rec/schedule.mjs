// Global timeline of the promo: every scene is lead-in + its voice clip + tail, so the picture and the voice line up.
// Takes record spans of this timeline; the assembly places each voice clip at its scene's voice start.
import { readFileSync } from 'node:fs'
import { S } from './rec.mjs'

const LEAD = 0.35
const TAIL = 0.5
// Extra seconds a scene's picture needs beyond its voice (navigation, a hover that has to land).
const EXTRA_BEFORE = { 1: 0.6, 4: 0.0, 5: 0.3, 8: 0.2, 11: 0.4, 18: 0.3, 20: 0.2 }
// Scene 20 holds the end card after the last line, so the disclaimer under it can be read to the end (silent).
const EXTRA_AFTER = { 1: 0.2, 5: 0.6, 7: 0.6, 10: 0.3, 11: 0.5, 13: 0.6, 19: 0.4, 20: 4.7 }

// The takes are timed on the Russian voice (offsets from a scene's voice start). In another language an offset moves to
// the same place of that line: piecewise linear between matching sentence starts [ru, other] (silencedetect, -38 dB /
// 180 ms; inside a sentence without a pause, by its share of the characters).
const ALIGN = {
  en: {
    1: [[1.17, 1.18]], 2: [[0.97, 1.11], [3.03, 3.35], [4.34, 4.73]], 3: [[2.77, 2.45], [6.52, 6.06], [10.25, 9.09], [12.23, 11.17]],
    4: [[1.46, 1.48], [2.86, 2.71], [4.68, 4.64], [7.35, 7.41]],
    5: [[1.03, 0.99], [3.6, 2.9], [5.62, 5.36], [9.35, 9.08], [12.1, 11.6], [14.89, 14.27]],
    6: [[1.43, 1.31], [4.19, 4.77]], 7: [[0.71, 0.76], [2.19, 2.35], [4.85, 4.69], [5.6, 5.54], [8.66, 8.65], [12.27, 12.05]],
    8: [[2.34, 1.96], [5.68, 5.49], [8.74, 8.15]], 9: [[1.74, 1.87], [3.57, 3.27]], 10: [[0.76, 0.91], [2.87, 2.51], [4.7, 3.83]],
    11: [[0.98, 1.03], [3.4, 3.45]], 12: [[1.08, 1.08], [2.54, 2.39]], 13: [], 14: [[1.13, 1.14]], 15: [[2.15, 1.42]],
    16: [[3.28, 2.69]], 17: [[1.17, 1.07]], 18: [[3.17, 3.02]], 19: [[0.98, 1.44], [3.56, 3.87], [4.75, 5.5], [5.99, 5.99], [7.17, 6.75]],
    20: [[1.08, 1.09], [2.18, 2.15], [3.41, 3.43]],
  },
}
const timingOf = (lang) => JSON.parse(readFileSync(`${S}/promo/voice/${lang}/timing.json`, 'utf8'))

/** A Russian offset from scene n's voice start, moved to the same place of the line in `lang`. */
export function align(lang, n, offset) {
  const pairs = ALIGN[lang]?.[n]
  if (!pairs || offset <= 0) return offset
  const ruDur = timingOf('ru')[n].dur, dur = timingOf(lang)[n].dur
  if (offset >= ruDur) return dur + (offset - ruDur)
  const points = [[0, 0], ...pairs, [ruDur, dur]]
  for (let i = 1; i < points.length; i += 1) {
    const [r0, t0] = points[i - 1], [r1, t1] = points[i]
    if (offset <= r1) return t0 + (offset - r0) * (t1 - t0) / (r1 - r0)
  }
  return offset
}

export function schedule(lang = 'ru') {
  const timing = timingOf(lang)
  const scenes = {}
  let t = 0
  for (let n = 1; n <= 20; n += 1) {
    const clip = timing[n]
    const start = t
    const voice = start + LEAD + (EXTRA_BEFORE[n] ?? 0)
    const end = voice + clip.dur + TAIL + (EXTRA_AFTER[n] ?? 0)
    // Sentence starts: the voice start, then the end of every pause in the clip.
    const phrases = [0, ...clip.pauses.map(([, e]) => e)]
    scenes[n] = { n, start, voice, end, dur: clip.dur, pauses: clip.pauses, phrases }
    t = end
  }
  return { scenes, total: t }
}

/** A moment of the Russian timeline (global seconds) at the same place of the `lang` timeline (vertical/build.mjs). */
export function mapGlobal(lang, t) {
  if (lang === 'ru') return t
  const ru = schedule('ru').scenes, other = schedule(lang).scenes
  for (let n = 1; n <= 20; n += 1) {
    if (t < ru[n].end || n === 20) return other[n].voice + (t >= ru[n].voice ? align(lang, n, t - ru[n].voice) : t - ru[n].voice)
  }
  return t
}

/** The takes: spans of the global timeline recorded in one go. */
export function takes(lang = 'ru') {
  const { scenes, total } = schedule(lang)
  const kappaCut = scenes[4].voice + 1.3
  return {
    total,
    list: [
      { id: 't01-intro', from: 0, to: scenes[1].end },
      { id: 't02-overview', from: scenes[2].start, to: kappaCut },
      { id: 't03-kappa', from: kappaCut, to: scenes[4].end },
      { id: 't04-gunsmith-tasks-maps', from: scenes[5].start, to: scenes[7].end },
      { id: 't05-iteminfo', from: scenes[8].start, to: scenes[8].end },
      { id: 't06-minimap', from: scenes[9].start, to: scenes[9].end },
      { id: 't07-squad', from: scenes[10].start, to: scenes[10].end },
      { id: 't08-bosses', from: scenes[11].start, to: scenes[11].end },
      { id: 't09a-flea-traders', from: scenes[12].start, to: scenes[13].end },
      { id: 't09b-ballistics', from: scenes[14].start, to: scenes[14].end },
      { id: 't09c-themes-update', from: scenes[15].start, to: scenes[15].end },
      { id: 't09d-improve-bug', from: scenes[16].start, to: scenes[17].end },
      { id: 't10-closing', from: scenes[18].start, to: scenes[20].end },
    ],
  }
}

if (process.argv[1]?.endsWith('schedule.mjs')) {
  const { scenes, total } = schedule(process.argv[2] ?? 'ru')
  for (const scene of Object.values(scenes)) console.log(scene.n, scene.start.toFixed(2), '→ voice', scene.voice.toFixed(2), '→ end', scene.end.toFixed(2), '| phrases', scene.phrases.map((p) => p.toFixed(2)).join(' '))
  console.log('total', total.toFixed(2))
  for (const take of takes(process.argv[2] ?? 'ru').list) console.log(take.id, take.from.toFixed(2), take.to.toFixed(2), (take.to - take.from).toFixed(2))
}
