/**
 * The exits the game lists for this raid (report №105, owner 09.11.2026: «при двойном нажатии О… появляется окно выходов.
 * Тебе нужно читать эти выходы и сопоставлять с нашими… подсвечивай их зеленым… остальные приглуши, но их должен показывать…
 * до конца этого рейда»). The PC app reads the game's top-right list after a double O (electron/extractsReader.ts) and
 * sends the text; here it is parsed and matched with the map's exit points. Transits are left out (they are always the
 * same); the armored train and the paid car exits are neither lit nor dimmed (when the train comes is unknown, the car
 * costs money).
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

/** The exit names of the game's list, in its order (the header and the transits left out). */
export function parseExtractList(text: string): string[] {
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(TIMER, '')
    const space = line.search(/\s/)
    if (space < 4) continue
    const word = line.slice(0, space)
    if (TRANSIT_WORD.test(word) || !EXIT_WORD.test(word)) continue
    const name = line.slice(space).trim()
    if (name.length >= 2 && !names.includes(name)) names.push(name)
  }
  return names
}

/** Letters and digits only, lower case, ё as е, Latin look-alikes as Cyrillic: «Д-2» = «д2», «ZB-1011» = «zb1011». */
export function exitKey(name: string) {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\((совм|co-?op)\.?\)/g, '').replace(/[^a-zа-я0-9]/g, '')
}

/** The armored train and the paid car exits: not lit, not dimmed. */
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
    const key = exitKey(name)
    if (key.length < 2) continue
    let best: { id: string; score: number } | null = null
    for (const exit of exits) {
      for (const title of exit.titles) {
        const score = likeness(key, exitKey(title))
        if (!best || score > best.score) best = { id: exit.id, score }
      }
    }
    if (best && best.score >= (key.length <= 4 ? 0.99 : 0.72)) { listed.add(best.id); continue }
    // A short name with one letter misread («Д-2» read as «1-2»): the one exit of that length a single letter away.
    if (key.length <= 4) {
      const near = exits.filter((exit) => exit.titles.some((title) => {
        const other = exitKey(title)
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

/** What the PC app read last: the names and when, for the raid then running. */
export interface RaidExtractsReading { names: string[]; at: number }

let reading: RaidExtractsReading | null = null
const listeners = new Set<() => void>()

/** A new reading from the game (desktop bridge); an empty list never replaces a good one. */
export function setRaidExtracts(next: RaidExtractsReading | null) {
  if (next && !next.names.length) return
  reading = next
  for (const listener of listeners) listener()
}

export function useRaidExtracts() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => reading, () => reading)
}

/**
 * The exits to light and to dim on the map, for a reading of the raid running now (`raidSince`: its start by the logs;
 * a reading from an earlier raid counts for nothing). Null: nothing read for this raid.
 */
export function exitHighlights(current: RaidExtractsReading | null, raidSince: number | undefined, exits: readonly (ExitPoint & { title: string })[]) {
  if (!current || raidSince === undefined || current.at < raidSince) return null
  const listed = matchListedExits(current.names, exits)
  if (!listed.size) return null
  const lit = new Set<string>()
  const dim = new Set<string>()
  for (const exit of exits) {
    if (isUncertainExit(exit.title)) continue
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
      setRaidExtracts({ names: parseExtractList(value.text), at: typeof value.at === 'number' ? value.at : Date.now() })
    })
  }, [])
  return null
}
