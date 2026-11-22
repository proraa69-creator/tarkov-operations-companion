/**
 * The exits the game lists for this raid (report №105, owner 09.11.2026: «при двойном нажатии О… появляется окно выходов.
 * Тебе нужно читать эти выходы и сопоставлять с нашими… подсвечивай их зеленым… остальные приглуши, но их должен показывать…
 * до конца этого рейда»). The PC app reads the game's top-right list after a double O (electron/extractsReader.ts) and
 * sends the text; here it is parsed and matched with the map's exit points. Transits are left out (they are always the
 * same). Owner, 11.11.2026: «те выходы, которые есть в этом списке, они должны светиться как обычно, а те выходы, которых
 * нету, они должны приглушаться на 50%» — every exit, the car and the train too: the list says what this raid has.
 *
 * Read from real screenshots (3440×1440, Woods and Customs): the OCR puts bits of the scenery before the first word
 * («7 ВЫХОД@2 Безопасная комната», «Se ВЫХОДА! Лагерь Диких (Совм) Е») and takes «ЗБ» for «35» or «26».
 */
import { useEffect, useSyncExternalStore } from 'react'

/**
 * A line's first word, «ВЫХОД01» / «EXFIL01» as the OCR gives it: Latin and Cyrillic look-alikes mixed, digits as letters
 * and back («BbIXO4@2», «ВЫХОДОб»). «ПЕРЕХОД» / «TRANSIT» likewise («NEPEXOQ@1»).
 */
const EXIT_WORD = /^(?:[ВB][ЫЬb][IІ]?[ХX]|EX[FР]|ЕХ[FР])/i
const TRANSIT_WORD = /^(?:[ПN][ЕE][РPR][ЕE][ХX]|TRAN)/i
/** The timer at the end: «0:39:54», «??:??:??», OCR slips like «22:72:27?». */
const TIMER = /\s+[?\d]{1,2}[:.][?\d]{2}[:.][?\d]{2}\??\s*$/

/** A word of the list's own: at least «ВЫХ0» long, so a stray «В» of the scenery is none. */
const listWord = (word: string, pattern: RegExp) => word.length >= 5 && pattern.test(word)
/** Bits of the scenery after a name: one letter, or marks and digits only («Е», «|», «Oe» stays — the matching forgives it). */
const NOISE_TAIL = /(?:\s+(?:\S|[^\p{L}\s]+))+$/u

/** The exit names of the game's list, in its order (the header and the transits left out), wherever the line starts. */
export function parseExtractList(text: string): string[] {
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    // the header («Найдите зону выхода», «Оставайтесь в зоне выхода»): its «выхода» is no exit
    if (/(?:зон[уеы]|find|stay)/iu.test(raw) || /найдите|оставай/i.test(raw)) continue
    const words = raw.trim().replace(TIMER, '').split(/\s+/)
    if (words.some((word) => listWord(word, TRANSIT_WORD))) continue
    const at = words.findIndex((word) => listWord(word, EXIT_WORD))
    if (at < 0) continue
    const name = words.slice(at + 1).join(' ').replace(NOISE_TAIL, '').trim()
    if (name.length >= 2 && !names.includes(name)) names.push(name)
  }
  return names
}

/** The list shown while standing in an exit's zone («Оставайтесь в зоне выхода»): that exit only, never the raid's list. */
export const isStayReading = (text: string) => /остава[йи]тесь|stay in the/i.test(text)

/** Letters and digits only, lower case, ё as е: «Д-2» = «д2», «ZB-1011» = «zb1011». */
export function exitKey(name: string) {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\((совм|co-?op)\.?\)/g, '').replace(/[^a-zа-я0-9]/g, '')
}

/** For the matching only: the letters the OCR takes for digits and back as one («ЗБ-1011» read «35-1011» or «26-1013»). */
// Latin letters drawn like Cyrillic ones are one letter for the matching: the OCR reads «ВС» of «Блокпост ВС РФ» as Latin «BC»
// now and then (the game's list read on Customs, 20.11.2026). Both the reading and the names go through it, English ones too.
const LOOKALIKE: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', p: 'р', t: 'т', x: 'х', y: 'у' }
const matchKey = (name: string) => exitKey(name).replace(/[abcehkmptxy]/g, (letter) => LOOKALIKE[letter]!)
  .replace(/з/g, '3').replace(/[б5]/g, '6').replace(/[оo]/g, '0').replace(/[il]/g, '1')

/** A transit to another map: never dimmed by the list (it leaves them out). */
export const isTransit = (title: string) => /^(?:переход|transit)/i.test(title.trim())

/** The armored train and the paid car exits (no longer treated apart: the list says whether this raid has them). */
export function isUncertainExit(title: string) {
  return /бронепоезд|armou?red train|v-ex|а-выход|vehicle|автомобил/i.test(title)
}

/** How alike two keys are, 0…1 (letters in order: the longest common subsequence over the longer key). */
function likeness(a: string, b: string) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.15
  const row = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = 0
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j]!
      row[j] = a[i - 1] === b[j - 1] ? previous + 1 : Math.max(row[j]!, row[j - 1]!)
      previous = kept
    }
  }
  return row[b.length]! / Math.max(a.length, b.length)
}

export interface ExitPoint { id: string; titles: readonly string[] }

/**
 * The map's exit points the list names: each read name to the closest exit by any of its names (both languages),
 * when alike enough (OCR slips a letter or two). Returns the ids of the listed exits.
 */
export function matchListedExits(names: readonly string[], exits: readonly ExitPoint[]): Set<string> {
  const listed = new Set<string>()
  for (const name of names) {
    const key = matchKey(name)
    if (key.length < 2) continue
    // every exit of the best name: a PMC's and a Scav's exit often share it («КПП МЧС»)
    let bestScore = 0
    const scores = new Map<string, number>()
    for (const exit of exits) {
      const score = Math.max(...exit.titles.map((title) => likeness(key, matchKey(title))))
      scores.set(exit.id, score)
      bestScore = Math.max(bestScore, score)
    }
    if (bestScore >= (key.length <= 4 ? 0.99 : 0.72)) {
      for (const [id, score] of scores) if (score >= bestScore - 1e-9) listed.add(id)
      continue
    }
    // A short name with one letter misread («Д-2» read as «1-2»): the one exit of that length a single letter away.
    if (key.length <= 4) {
      const near = exits.filter((exit) => exit.titles.some((title) => {
        const other = matchKey(title)
        if (other.length !== key.length) return false
        const differ = [...other].map((letter, at) => [letter, key[at]!] as const).filter(([a, b]) => a !== b)
        // a letter misread, never one number read as another («Д-3» is not «Д-2»)
        return differ.length === 1 && !(/\d/.test(differ[0]![0]) && /\d/.test(differ[0]![1]))
      }))
      if (near.length === 1) listed.add(near[0]!.id)
    }
  }
  return listed
}

/**
 * The map's exits whose names stand in the text read from the screen, wherever the list's lines begin (owner, 18.11.2026:
 * «смотрит какие выходы, и сравнивает с нашими выходами, пусть в базе держит названия выходов и если они появятся в списке
 * то подсвечивает найденные»): no «ВЫХОД01» word needed. A long name inside a line (OCR slips forgiven as in the matching
 * above); a short one («Д-2») as a whole word of it. The header and the transits' lines are left out.
 */
export function exitsInText(text: string, exits: readonly ExitPoint[]): Set<string> {
  const found = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    if (/(?:зон[уеы]|find|stay)/iu.test(raw) || /найдите|оставай/i.test(raw)) continue
    const words = raw.trim().replace(TIMER, '').split(/\s+/).filter(Boolean)
    if (words.some((word) => listWord(word, TRANSIT_WORD))) continue
    const line = matchKey(words.join(' '))
    const tokens = new Set(words.flatMap((word, at) => [matchKey(word), matchKey(`${word}${words[at + 1] ?? ''}`)]))
    for (const exit of exits) {
      if (found.has(exit.id)) continue
      if (exit.titles.some((title) => {
        const key = matchKey(title)
        if (key.length < 5) return key.length >= 2 && tokens.has(key)
        if (line.includes(key)) return true
        // a long name with a letter or two misread («бункеpа» with a Latin p): a stretch of the line as long, nearly the same
        if (key.length < 8) return false
        for (let at = 0; at + key.length - 1 <= line.length; at += 1) if (likeness(key, line.slice(at, at + key.length)) >= 0.85) return true
        return false
      })) found.add(exit.id)
    }
  }
  return found
}

/** What the PC app read last: the names and when, for the raid then running; `text`: what was read, for exitsInText. */
export interface RaidExtractsReading { names: string[]; at: number; text?: string }

let reading: RaidExtractsReading | null = null
const listeners = new Set<() => void>()

/** Readings this close are of one look at the list: their names together (each read may miss a line). */
const SAME_LOOK_MS = 3 * 60_000

/** A new reading from the game (desktop bridge); an empty one never replaces a good one. */
export function setRaidExtracts(next: RaidExtractsReading | null) {
  if (next && !next.names.length && !next.text?.trim()) return
  reading = next && reading && next.at - reading.at >= 0 && next.at - reading.at < SAME_LOOK_MS
    ? { names: [...new Set([...reading.names, ...next.names])], at: next.at, text: [reading.text, next.text].filter(Boolean).join('\n') }
    : next
  for (const listener of listeners) listener()
}

export function useRaidExtracts() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => reading, () => reading)
}

/** Without the game's logs (no raid start known) a reading counts this long: a raid is at most this. */
export const READING_WITHOUT_LOGS_MS = 50 * 60_000

/**
 * The exits to light and to dim on the map, for a reading of the raid running now (`raidSince`: its start by the logs;
 * a reading from an earlier raid counts for nothing; no logs: a reading of the last 50 minutes). Null: nothing read for
 * this raid, or a list of another map (fewer than two of its names are this map's exits).
 */
export function exitHighlights(current: RaidExtractsReading | null, raidSince: number | undefined, exits: readonly (ExitPoint & { title: string })[], now = Date.now()) {
  if (!current) return null
  if (raidSince !== undefined ? current.at < raidSince : now - current.at > READING_WITHOUT_LOGS_MS) return null
  const listed = matchListedExits(current.names, exits)
  if (current.text) for (const id of exitsInText(current.text, exits)) listed.add(id)
  // fewer than two of this map's exits: a list of another map, or nothing read (one is enough when one was listed)
  if (listed.size < 2 && !(listed.size === 1 && current.names.length === 1)) return null
  const lit = new Set<string>()
  const dim = new Set<string>()
  for (const exit of exits) {
    // transits are always the same: as they are
    if (isTransit(exit.title)) continue
    if (listed.has(exit.id)) lit.add(exit.id)
    else dim.add(exit.id)
  }
  return { lit, dim }
}

/** Desktop only (App): the game's exit list the PC app read after a double O, parsed into the store above. */
export function RaidExtractsBridge() {
  useEffect(() => {
    const subscribe = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.experimental?.onRaidExtracts
    if (!subscribe) return
    return subscribe((payload) => {
      const value = payload && typeof payload === 'object' ? payload as { text?: unknown; at?: unknown } : {}
      if (typeof value.text !== 'string') return
      const names = parseExtractList(value.text)
      // standing in an exit's zone the game lists that exit alone: it says nothing of the others
      if (names.length < 2 && isStayReading(value.text)) return
      setRaidExtracts({ names, at: typeof value.at === 'number' ? value.at : Date.now(), text: value.text })
    })
  }, [])
  return null
}
