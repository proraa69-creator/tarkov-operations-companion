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
import { extraGameLanguage, isGameLanguage, type GameLanguage } from '../import/gameLanguage'
import { gameWordPattern, languageWords } from '../import/gameWordPatterns'
import { foldTurkishI, letterWeight } from '../shared/cjk'
import { noteGameLanguage } from '../data/gameNamesLoader'

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

/**
 * The list's words in a German, Japanese or Chinese game (the game's localisation, src/import/gameWords.ts): «EXFIL» /
 * «脱出地点» / «撤离点» before an exit, «TRANSIT» / «移動地点» / «转移点» before a transit, the headers «Finde einen Ausgang»,
 * «Bleib im Extraktionsbereich», «Geh zum Extraktionspunkt zurück». Null in a Russian or English game.
 */
function listLanguage(language?: GameLanguage | null) {
  const words = languageWords(language)
  if (!words) return null
  const { exfil, transit, find, stay, back } = words.words.exits
  // The list's word starts a word of the line («EXFIL01», «WYJŚCIE01», «EXT.01»): no word boundary after it.
  const start = (list: readonly string[]) => new RegExp(`^(?:${list.map((word) => gameWordPattern(word).replace(/\(\?!\[\\p\{L\}\]\)$/, '')).filter(Boolean).join('|') || '(?!)'})`, 'iu')
  return {
    exit: start(exfil),
    transit: start(transit),
    header: new RegExp(words.any([...find, ...stay, ...back]), 'iu'),
    stay: new RegExp(words.any([...stay, ...back]), 'iu'),
    /** The shortest of the list's words («EXT.»): a word as short is still the list's own. */
    shortest: Math.min(...[...exfil, ...transit].map((word) => letterWeight(word)), 5),
    /** The exit word folded, for a reading with a letter wrong («NYJŚCIE01» for «WYJŚCIE01»). */
    exitFolded: exfil.map(foldListWord).filter((word) => word.length >= 5),
  }
}

/**
 * A word of the game's own list words: long enough (a Chinese character counts as two letters; the shortest of the list's
 * own words, «EXT.», as long as itself), and the word itself.
 */
const ownListWord = (word: string, pattern: RegExp, shortest = 5) => letterWeight(word) >= shortest && pattern.test(word)

/** A list word as compared letter by letter: lower case, no accents, the Turkish i as i, its number («01», «Q1») gone. */
function foldListWord(word: string) {
  return foldTurkishI(word).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/[\d@]+$|[oq][\d@]$/u, '').replace(/[^\p{L}]/gu, '')
}

/** One letter edit at most between two words. */
function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else { i += 1; j += 1 }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * The game's own exit word with one letter misread (the Polish list on a bright sky: «WYJŚCIE01» read «NYJŚCIEQ1»): a
 * word of at least five letters, one edit from it, and a number after it.
 */
const nearExitWord = (word: string, folded: readonly string[]) => {
  if (!/(?:\d|[OoQ@])\d?$|\d$/u.test(word)) return false
  const letters = foldListWord(word)
  return letters.length >= 5 && folded.some((exit) => oneEditApart(letters, exit))
}

/**
 * The exit names of the game's list, in its order (the header and the transits left out), wherever the line starts.
 * `language`: the game's — a German, Japanese or Chinese list is read by its own words too.
 */
export function parseExtractList(text: string, language?: GameLanguage | null): string[] {
  const names: string[] = []
  const own = listLanguage(language)
  for (const raw of text.split(/\r?\n/)) {
    // the header («Найдите зону выхода», «Оставайтесь в зоне выхода»): its «выхода» is no exit
    if (/(?:зон[уеы]|find|stay)/iu.test(raw) || /найдите|оставай/i.test(raw) || own?.header.test(raw)) continue
    const words = raw.trim().replace(TIMER, '').split(/\s+/)
    if (words.some((word) => listWord(word, TRANSIT_WORD) || (own && ownListWord(word, own.transit, own.shortest)))) continue
    let at = words.findIndex((word) => listWord(word, EXIT_WORD))
    if (at < 0 && own) at = words.findIndex((word) => ownListWord(word, own.exit, own.shortest))
    if (at < 0 && own) at = words.findIndex((word) => nearExitWord(word, own.exitFolded))
    if (at < 0) continue
    // The list's number may come apart from its word («撤离点 01»).
    const rest = own ? words.slice(at + 1).join(' ').replace(/^[\d@]{1,2}\s+/, '') : words.slice(at + 1).join(' ')
    const name = rest.replace(NOISE_TAIL, '').trim()
    if (name.length >= 2 && !names.includes(name)) names.push(name)
  }
  return names
}

/** The list shown while standing in an exit's zone («Оставайтесь в зоне выхода»): that exit only, never the raid's list. */
export const isStayReading = (text: string, language?: GameLanguage | null) => /остава[йи]тесь|stay in the/i.test(text) || Boolean(listLanguage(language)?.stay.test(text))

/**
 * Letters and digits only, lower case, ё as е: «Д-2» = «д2», «ZB-1011» = «zb1011». A German, Japanese or Chinese game's
 * names keep their own letters («Lagerhaus», «工厂棚屋»).
 */
export function exitKey(name: string, language?: GameLanguage | null) {
  const base = (extraGameLanguage(language) ? foldTurkishI(name) : name).toLowerCase().replace(/ё/g, 'е').replace(/\((совм|co-?op)\.?\)/g, '')
  return extraGameLanguage(language) ? foldTurkishI(base).replace(/[（(][^)）]*(?:co-?op|совм)[^)）]*[)）]/g, '').replace(/[^\p{L}\p{N}]/gu, '') : base.replace(/[^a-zа-я0-9]/g, '')
}

/** For the matching only: the letters the OCR takes for digits and back as one («ЗБ-1011» read «35-1011» or «26-1013»). */
// Latin letters drawn like Cyrillic ones are one letter for the matching: the OCR reads «ВС» of «Блокпост ВС РФ» as Latin «BC»
// now and then (the game's list read on Customs, 20.11.2026). Both the reading and the names go through it, English ones too.
const LOOKALIKE: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', p: 'р', t: 'т', x: 'х', y: 'у' }
const matchKey = (name: string, language?: GameLanguage | null) => exitKey(name, language).replace(/[abcehkmptxy]/g, (letter) => LOOKALIKE[letter]!)
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
export function matchListedExits(names: readonly string[], exits: readonly ExitPoint[], language?: GameLanguage | null): Set<string> {
  const listed = new Set<string>()
  for (const name of names) {
    const key = matchKey(name, language)
    if (key.length < 2) continue
    // every exit of the best name: a PMC's and a Scav's exit often share it («КПП МЧС»)
    let bestScore = 0
    const scores = new Map<string, number>()
    for (const exit of exits) {
      const score = Math.max(...exit.titles.map((title) => likeness(key, matchKey(title, language))))
      scores.set(exit.id, score)
      bestScore = Math.max(bestScore, score)
    }
    // Lengths weighed: a Chinese character counts as two letters (src/shared/cjk.ts).
    if (bestScore >= (letterWeight(key) <= 4 ? 0.99 : 0.72)) {
      for (const [id, score] of scores) if (score >= bestScore - 1e-9) listed.add(id)
      continue
    }
    // A short name with one letter misread («Д-2» read as «1-2»): the one exit of that length a single letter away.
    if (letterWeight(key) <= 4) {
      const near = exits.filter((exit) => exit.titles.some((title) => {
        const other = matchKey(title, language)
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
export function exitsInText(text: string, exits: readonly ExitPoint[], language?: GameLanguage | null): Set<string> {
  const found = new Set<string>()
  const own = listLanguage(language)
  for (const raw of text.split(/\r?\n/)) {
    if (/(?:зон[уеы]|find|stay)/iu.test(raw) || /найдите|оставай/i.test(raw) || own?.header.test(raw)) continue
    const words = raw.trim().replace(TIMER, '').split(/\s+/).filter(Boolean)
    if (words.some((word) => listWord(word, TRANSIT_WORD) || (own && ownListWord(word, own.transit, own.shortest)))) continue
    const line = matchKey(words.join(' '), language)
    const tokens = new Set(words.flatMap((word, at) => [matchKey(word, language), matchKey(`${word}${words[at + 1] ?? ''}`, language)]))
    for (const exit of exits) {
      if (found.has(exit.id)) continue
      if (exit.titles.some((title) => {
        const key = matchKey(title, language)
        if (letterWeight(key) < 5) return key.length >= 2 && tokens.has(key)
        if (line.includes(key)) return true
        // a long name with a letter or two misread («бункеpа» with a Latin p): a stretch of the line as long, nearly the same
        if (letterWeight(key) < 8) return false
        for (let at = 0; at + key.length - 1 <= line.length; at += 1) if (likeness(key, line.slice(at, at + key.length)) >= 0.85) return true
        return false
      })) found.add(exit.id)
    }
  }
  return found
}

/**
 * What the PC app read last: the names and when, for the raid then running; `text`: what was read, for exitsInText;
 * `language`: the game's language it was read in.
 */
export interface RaidExtractsReading { names: string[]; at: number; text?: string; language?: GameLanguage }

let reading: RaidExtractsReading | null = null
const listeners = new Set<() => void>()

/** Readings this close are of one look at the list: their names together (each read may miss a line). */
const SAME_LOOK_MS = 3 * 60_000

/** A new reading from the game (desktop bridge); an empty one never replaces a good one. */
export function setRaidExtracts(next: RaidExtractsReading | null) {
  if (next && !next.names.length && !next.text?.trim()) return
  reading = next && reading && next.at - reading.at >= 0 && next.at - reading.at < SAME_LOOK_MS
    ? { names: [...new Set([...reading.names, ...next.names])], at: next.at, text: [reading.text, next.text].filter(Boolean).join('\n'), ...(next.language ? { language: next.language } : {}) }
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
  const listed = matchListedExits(current.names, exits, current.language)
  if (current.text) for (const id of exitsInText(current.text, exits, current.language)) listed.add(id)
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
      const value = payload && typeof payload === 'object' ? payload as { text?: unknown; at?: unknown; language?: unknown } : {}
      if (typeof value.text !== 'string') return
      // The game's language (apps from 24.11.2026): its exit names are loaded for the matching (src/data/gameNamesLoader.ts).
      const language = isGameLanguage(value.language) ? value.language : undefined
      if (language) noteGameLanguage(language)
      const names = parseExtractList(value.text, language)
      // standing in an exit's zone the game lists that exit alone: it says nothing of the others
      if (names.length < 2 && isStayReading(value.text, language)) return
      setRaidExtracts({ names, at: typeof value.at === 'number' ? value.at : Date.now(), text: value.text, ...(language ? { language } : {}) })
    })
  }, [])
  return null
}
