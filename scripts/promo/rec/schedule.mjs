// Global timeline of the promo: every scene is lead-in + its voice clip + tail, so the picture and the voice line up.
// Takes record spans of this timeline; the assembly places each voice clip at its scene's voice start.
import { readFileSync } from 'node:fs'
import { S } from './rec.mjs'

const LEAD = 0.35
const TAIL = 0.5
// Extra seconds a scene's picture needs beyond its voice (navigation, a hover that has to land).
const EXTRA_BEFORE = { 1: 0.6, 4: 0.0, 5: 0.3, 8: 0.2, 11: 0.4, 18: 0.3, 20: 0.2 }
// Scene 20 holds the end card after the last line long enough to read the disclaimer under it (silent).
const EXTRA_AFTER = { 1: 0.2, 5: 0.6, 7: 0.6, 10: 0.3, 11: 0.5, 13: 0.6, 19: 0.4, 20: 4.7 }

export function schedule(lang = 'ru') {
  const timing = JSON.parse(readFileSync(`${S}/promo/voice/${lang}/timing.json`, 'utf8'))
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
