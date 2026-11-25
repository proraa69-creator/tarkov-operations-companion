import type { Item } from '../domain/types'
import { gameItemNames } from '../data/gameNames'
import { labelNames, withoutPrintedCaps } from '../kappa/collector'
import { levenshtein, normalizeOcr } from '../overlay/itemMatch'

/**
 * Which keys the label lines of a «Найти ключи» pass show (report 236, 25.11.2026: «Ключ РБ-СТ» was found, the player has
 * none; measured on the offline stash of all 241 keys of SPT, src/quests/keyScanFrames.test.ts). Key labels are codes one
 * letter or digit apart («Общ 110» and «Общ 118», «РБ-ПСП2» and «РБ-ПСВ2», «Сан203 З» and «Сан205 З»), and the stash's
 * matching (countScreenItems: a word, or a near stretch, anywhere in a line) took them for one another: «Hoc 33.» was
 * «С-3», «АЗС офис» the key «Офис», «Общ 164» the key «Общ 118». Here:
 *   - a line is matched whole: one label, or two labels of cells side by side read as one line («Туалет Мастерск.»);
 *   - its digits must be the label's; letters may be one off (two in a label of nine letters or more), never in a label of
 *     three or fewer;
 *   - a label cut at its cell's edge («Сан321 се» for «Сан321 сейф») counts when only one key's label starts so;
 *   - a reading two keys fit, a label several keys share («Сейф»), other items carry too («Авто», «Завод» — the car kit,
 *     the map) or that starts another key's label («Офис» of «Офис TerraGroup»): no key. Those are told by the tooltip's
 *     full name only;
 *   - the game's digits OCR reads for others: an «8» may be the slashed zero, a «5» a three — a reading that fits a key of
 *     such a pair both ways («Общ 118» / «Общ 110», «Общ 105» / «Общ 103») is no key.
 */
export interface KeyMatcher {
  /** Pieces of each key the lines show: one line, one piece (two for a line of two labels). */
  count(text: string): Map<string, number>
  /** The key one line shows, or null (for the study of every key, keyScanFrames.test.ts). */
  line(text: string): string[]
  /**
   * The labels these lines show that several keys carry, with those keys («Времянка»: «Ключ от времянки» and «Ключ от
   * времянки трейлерного парка» — the same label and the same picture in the game): no key until the tooltip's full name
   * tells which (owner, 25.11.2026: «проводи тесты и обучение до тех пор пока не научишь определять в точности ключи»).
   */
  shared(text: string): Array<{ label: string; ids: string[] }>
}

interface Name { id: string; shape: string; digits: string; letters: number; full: boolean }
interface Reading { shape: string; digits: string }

/** What OCR writes for the game's own glyphs: the slashed zero as @ or Ø, the «Б» of «РБ-» as 5, 6 or Е. */
function rawFix(value: string) {
  return value.replace(/[@Øø]/g, '0').replace(/^\s*[РрPp]\s*[56ЕEеe8]\s*-/u, 'РБ-')
}

/** OCR's look-alikes folded, both sides: letters and digits the game's labels are read for each other made one. */
export function keyShape(value: string) {
  return normalizeOcr(rawFix(value).replace(/[|!]/g, 'l'))
    .replace(/[шщw]/g, 'w')
    .replace(/й/g, 'и')
    .replace(/[эз]/g, '3')
    .replace(/б/g, '6')
    .replace(/п/g, 'n')
    .replace(/г/g, 'r')
    .replace(/[il]/g, '1')
    .replace(/o/g, '0')
}

/** Letters OCR gives for a digit beside other digits («11O», «1З»). */
const DIGIT_LIKE: Record<string, string> = { o: '0', O: '0', о: '0', О: '0', l: '1', I: '1', i: '1', '|': '1', з: '3', З: '3', э: '3', Э: '3', б: '6', Б: '6' }

/**
 * The digits of a label or a reading, in order: the digits, and look-alike letters standing next to one. A last letter alone
 * («Сан104 З») stays a letter, even read as 3. Letters elsewhere never count («Сэн219 3» has the digits of «Сан219 З»).
 */
export function keyDigits(value: string) {
  const text = rawFix(value).trim().replace(/\s+[3зЗэЭ]$/u, '')
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (char >= '0' && char <= '9') { out += char; continue }
    const as = DIGIT_LIKE[char]
    if (as && (/[0-9]/.test(text[index - 1] ?? '') || /[0-9]/.test(text[index + 1] ?? ''))) out += as
  }
  return out
}

const lettersOf = (shape: string) => shape.replace(/ /g, '').length

/** The reading's digits may stand for the label's: the same, or an 8 read for the slashed zero, a 5 for a three. */
function digitsMayBe(reading: string, label: string) {
  if (reading.length !== label.length) return false
  for (let index = 0; index < reading.length; index += 1) {
    const r = reading[index]!, l = label[index]!
    if (r !== l && !(r === '8' && l === '0') && !(r === '5' && l === '3')) return false
  }
  return true
}

/** How well one reading fits a name (0: not at all). `loose`: the digits as digitsMayBe takes them. */
function fit(reading: Reading, name: Name, loose = false): number {
  const sameDigits = loose ? digitsMayBe(reading.digits, name.digits) : reading.digits === name.digits
  if (reading.shape === name.shape) return name.full ? 0.98 : 1
  if (!sameDigits && !name.digits.startsWith(reading.digits)) return 0
  if (name.full) {
    if (!sameDigits) return 0
    const allowed = Math.max(2, Math.round(name.shape.length * 0.08))
    return levenshtein(reading.shape, name.shape) <= allowed ? 0.93 : 0
  }
  if (sameDigits && name.letters >= 4) {
    const allowed = name.letters >= 9 ? 2 : 1
    const distance = levenshtein(reading.shape, name.shape)
    if (distance <= allowed) return 0.9 - distance * 0.02
  }
  // Cut at the cell's edge: the label's start, most of it (its digits as far as they go).
  const letters = lettersOf(reading.shape)
  if (letters >= 4 && letters < name.letters && letters >= name.letters * 0.5 && name.digits.startsWith(reading.digits)) {
    const start = name.shape.slice(0, reading.shape.length)
    if (start === reading.shape || (letters >= 7 && levenshtein(start, reading.shape) <= 1)) return 0.8
  }
  return 0
}

export function createKeyMatcher(keys: Item[], items: Item[]): KeyMatcher {
  // Labels other items carry too (another key, the car kit «Авто», the map «Завод»): no proof of one key.
  const carriers = new Map<string, Set<string>>()
  for (const item of items) {
    for (const label of labelNames(item)) {
      const shape = keyShape(label)
      if (!shape) continue
      const set = carriers.get(shape) ?? new Set<string>()
      set.add(item.id)
      carriers.set(shape, set)
    }
  }
  const names: Name[] = []
  // Key labels that prove nothing (shared): a reading of one is no key — nor the start of a longer label («Завод», «Заводская»).
  const shared = new Set<string>()
  const labels = keys.flatMap((key) => labelNames(key).map((label) => ({ key, label, shape: keyShape(label) }))).filter(({ shape }) => shape)
  // The labels two keys or more carry: the player is asked to hover them (sharedOf).
  const keysOfLabel = new Map<string, { label: string; ids: Set<string> }>()
  for (const { key, label, shape } of labels) {
    const entry = keysOfLabel.get(shape) ?? { label, ids: new Set<string>() }
    entry.ids.add(key.id)
    keysOfLabel.set(shape, entry)
  }
  for (const [shape, entry] of keysOfLabel) if (entry.ids.size < 2) keysOfLabel.delete(shape)
  for (const { key, label, shape } of labels) {
    // A label of digits alone would be any counter on screen (its letters, not its shape: «ЗБ-014» folds to digits);
    // a label other items carry; one that is the first word of another key's label («Офис», «Офис TerraGroup»: a reading
    // that lost the second word would be the short key).
    if (!/\p{L}/u.test(label) || (carriers.get(shape)?.size ?? 0) > 1 || labels.some((other) => other.key.id !== key.id && other.shape.startsWith(`${shape} `))) {
      shared.add(shape)
      continue
    }
    names.push({ id: key.id, shape, digits: keyDigits(label), letters: lettersOf(shape), full: false })
  }
  for (const key of keys) {
    for (const full of new Set([key.name, gameItemNames(key.id)?.name].filter((value): value is string => Boolean(value)))) {
      const shape = keyShape(full)
      if (lettersOf(shape) >= 8) names.push({ id: key.id, shape, digits: keyDigits(full), letters: lettersOf(shape), full: true })
    }
  }

  /** The one key a reading is, or null: the best fit, unless another key fits as well or fits it with the digits OCR mixes up. */
  function one(raw: string): string | null {
    const reading = { shape: keyShape(raw), digits: keyDigits(raw) }
    if (!reading.shape || shared.has(reading.shape)) return null
    let best: Name | null = null, bestScore = 0
    for (const name of names) {
      const score = fit(reading, name)
      if (score > bestScore) { best = name; bestScore = score }
    }
    if (!best) return null
    const confusable = !best.full && /[85]/.test(reading.digits)
    for (const name of names) {
      if (name.id === best.id) continue
      const score = fit(reading, name)
      // A label read exactly wins; a near or cut reading another key fits as well is no key.
      if (score > 0) {
        if (bestScore < 1 || score >= bestScore - 0.001) return null
        continue
      }
      // Another key the reading fits once an 8 is taken for the slashed zero or a 5 for a three.
      if (confusable && fit(reading, name, true) > 0) return null
    }
    return best.id
  }

  function line(text: string): string[] {
    const raw = withoutPrintedCaps(text, undefined).trim()
    if (!keyShape(raw)) return []
    const whole = one(raw)
    if (whole) return [whole]
    // Two labels of cells side by side, read as one line.
    const words = raw.split(/\s+/)
    for (let cut = 1; cut < words.length; cut += 1) {
      const left = one(words.slice(0, cut).join(' ')), right = one(words.slice(cut).join(' '))
      if (left && right && left !== right) return [left, right]
    }
    return []
  }

  /** A label several keys carry in this line (alone, or one of two labels of cells side by side). */
  function sharedOf(text: string): Array<{ label: string; ids: string[] }> {
    const raw = withoutPrintedCaps(text, undefined).trim()
    const words = raw.split(/\s+/)
    const parts = [raw, ...words.flatMap((_, cut) => (cut ? [words.slice(0, cut).join(' '), words.slice(cut).join(' ')] : []))]
    const out = new Map<string, { label: string; ids: string[] }>()
    for (const part of parts) {
      const entry = keysOfLabel.get(keyShape(part))
      if (entry) out.set(entry.label, { label: entry.label, ids: [...entry.ids] })
    }
    return [...out.values()]
  }

  return {
    line,
    count(text: string) {
      const seen = new Map<string, number>()
      for (const row of text.split(/\r?\n/)) for (const id of line(row)) seen.set(id, (seen.get(id) ?? 0) + 1)
      return seen
    },
    shared(text: string) {
      const out = new Map<string, { label: string; ids: string[] }>()
      for (const row of text.split(/\r?\n/)) for (const entry of sharedOf(row)) out.set(entry.label, entry)
      return [...out.values()]
    },
  }
}
