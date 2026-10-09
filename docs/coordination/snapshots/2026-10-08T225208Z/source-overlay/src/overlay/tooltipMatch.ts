import type { Item } from '../domain/types'

/** The item's name in another language of the game (the tooltip shows the game's language, not the app's). */
export interface ItemNameVariant { name?: string; shortName?: string }

interface Entry {
  item: Item
  /** Folded text compared with the OCR line. */
  text: string
  /** The same with look-alike digits merged (see looseDigits). */
  loose: string
  /** The numbers in the name ("556", "45", "10"), sorted. */
  numbers: string
  /** The numbers with look-alike digits merged, one by one and sorted — compared with the tooltip's. */
  looseNumbers: string[]
  short: boolean
  /** Stable item identity; different items can have identical display names. */
  key: string
}

/** An item the line may name and how well (1 = the name read exactly), for the second attempt (image check). */
export interface TooltipCandidate { item: Item; score: number }

export interface TooltipMatcher {
  /** The item the tooltip names, or null when unsure. */
  (ocrText: string): Item | null
  /** The k items whose names read most like the line, best first: no minimum score and no rival check. */
  rank: (ocrText: string, k: number) => TooltipCandidate[]
}

const MIN_SCORE = 0.8
const CANDIDATES = 80
/** Score cost of each number read in addition to, or missing from, a name (an OCR slip, not another item). */
const NUMBER_SLIP = 0.02
/** Names whose numbers disagree with the line still rank for the picture check, this far behind (never answered by text). */
const NUMBER_CONFLICT = 0.1

/** OCR mixes look-alike Cyrillic and Latin letters, so both sides are folded to one alphabet (digits stay digits). */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i',
}

/** Lower case, one alphabet, punctuation to spaces — but decimal points inside numbers ("5.56", "0.6") are kept. */
export function foldName(value: string) {
  return value
    .toLowerCase()
    .replace(/[авекмнорстухёі]/g, (char) => HOMOGLYPHS[char] ?? char)
    // Symbols the OCR puts for letters or digits of the game's font.
    .replace(/[@®]/g, 'o')
    .replace(/\$/g, 's')
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Typical OCR slips inside numbers: "1O" → "10", "l2" → "12", "2o-round" → "20-round", "HP 2.O" → "HP 2.0". Only a
 * look-alike letter standing between a digit and the end of a word (or between two digits) is changed, so "6Б43" or
 * "M4A1" stay.
 */
export function repairOcrNumbers(value: string) {
  const digit: Record<string, string> = { o: '0', O: '0', о: '0', О: '0', '@': '0', '®': '0', l: '1', I: '1', '|': '1', i: '1' }
  let text = value
  for (let pass = 0; pass < 2; pass += 1) {
    text = text
      .replace(/(\d[.,]?)([oOоО@®lI|i])(?=\d|[^\p{L}\p{N}]|$)/gu, (_, d: string, c: string) => d + digit[c]!)
      .replace(/(^|[^\p{L}\p{N}])([oOоО@®lI|i])(?=\d)/gu, (_, before: string, c: string) => before + digit[c]!)
  }
  return text
}

/** OCR drops the decimal point now and then ("5.56" → "556"): numbers are compared without it. */
const numberList = (folded: string) => (folded.match(/\d+(?:\.\d+)?/g) ?? []).map((value) => value.replace('.', '')).sort()
const numbersOf = (folded: string) => numberList(folded).join(' ')

/** The values of `list` left after taking out those of `other`, one for one (multiset difference). */
function without(list: string[], other: string[]) {
  const rest = [...other]
  return list.filter((value) => {
    const at = rest.indexOf(value)
    if (at < 0) return true
    rest.splice(at, 1)
    return false
  })
}

/** The OCR line folded the way the names are (see foldName) — also the key under which a line is remembered. */
export function foldTooltipText(ocrText: string) {
  return foldName(repairOcrNumbers(ocrText))
}

/**
 * The OCR splits a decimal number now and then ("7. 62x54R", "5 .45x39"): the line with it joined again, or null when
 * there is nothing to join. Only a second reading — a space before the point is also how calibres are written
 * ("Ротор 43 .366 ТКМ", "M1911A1 .45 ACP").
 */
function joinedDecimals(ocrText: string) {
  const joined = ocrText.replace(/(\d)\s*([.,])\s*(?=\d)/g, '$1$2')
  return joined === ocrText ? null : foldTooltipText(joined)
}

/**
 * The digits of the line, without those of numbers read in addition to the name's («D0rm room 110 key»: 110, not 0110)
 * — `extra` holds loose values, found on the loose line, whose characters stand where the line's do (looseDigits).
 */
function digitsWithout(line: string, loose: string, extra: string[]) {
  const skip = [...extra]
  let digits = ''
  for (const found of loose.matchAll(/\d+(?:\.\d+)?/g)) {
    const at = skip.indexOf(found[0].replace('.', ''))
    if (at >= 0) { skip.splice(at, 1); continue }
    digits += line.slice(found.index, found.index + found[0].length).replace(/\D/g, '')
  }
  return digits
}

/**
 * Different items with one and the same name (e.g. two «Пачка патронов 5.45x39мм БП гс (120 штук)» ids) cannot be
 * told apart by the tooltip. The card is mostly about the price, so: the only one with a market price (flea or
 * trader), the first one when all priced ones cost the same — or none, rather than maybe the wrong price.
 */
export function pickSameName(items: Item[]): Item | null {
  const quote = (item: Item) => {
    const traders = (item.prices ?? []).filter((price) => price.source !== 'Барахолка' && price.source !== 'Базовая цена' && price.price > 0)
    return { flea: item.fleaPrice ?? 0, trader: Math.max(0, ...traders.map((price) => price.price)) }
  }
  const priced = items.map((item) => ({ item, ...quote(item) })).filter((entry) => entry.flea > 0 || entry.trader > 0)
  if (!priced.length) return null
  const first = priced[0]!
  return priced.every((entry) => entry.flea === first.flea && entry.trader === first.trader) ? first.item : null
}

/**
 * What the OCR mixes up in the game's font (measured on it): a square 0 reads as 8, 9, 6 or @, a flat-topped 3 as
 * 5, a digit as a look-alike letter ("SA58" → "SAS8", "6Б2" → "662", "74" → "7Д"). Both the tooltip line and every
 * name are folded the same way — look-alike digits merged, look-alike letters next to a digit taken for that digit —
 * so the comparison ignores exactly these slips and nothing else. An item with a twin that differs only in such
 * digits (room 220 and room 228 keys) is then never answered from a guess (see the rival check).
 */
const DIGIT_LIKE: Record<string, string> = {
  o: '0', q: '0', б: '0', b: '0', g: '0', s: '3', з: '3', д: '4', ч: '4', l: '1', i: '1', '|': '1', '!': '1',
}
const DIGIT_CLASS: Record<string, string> = { 0: '0', 6: '0', 8: '0', 9: '0', 3: '3', 5: '3' }

export function looseDigits(folded: string) {
  const chars = [...folded]
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < chars.length; index += 1) {
      const digit = DIGIT_LIKE[chars[index]!]
      if (digit && (/\d/.test(chars[index - 1] ?? '') || /\d/.test(chars[index + 1] ?? ''))) chars[index] = digit
    }
  }
  return chars.map((char) => DIGIT_CLASS[char] ?? char).join('')
}

/** What each digit of the game font gets read as, besides itself (measured, see scripts/item-lookup-bench.mjs). */
const READ_AS: Record<string, string> = { 0: '869', 3: '5', 6: '8', 9: '8' }

/** Whether the OCR may have read these digits for the name's digits (unknown when a digit went missing: yes). */
function couldReadAs(name: string, read: string) {
  if (name.length !== read.length) return true
  for (let index = 0; index < name.length; index += 1) {
    if (name[index] !== read[index] && !READ_AS[name[index]!]?.includes(read[index]!)) return false
  }
  return true
}

function trigrams(value: string) {
  const padded = ` ${value} `
  const grams = new Set<string>()
  for (let index = 0; index < padded.length - 2; index += 1) grams.add(padded.slice(index, index + 3))
  return grams
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]!
}

/** Similarity of the name to its best-matching stretch of the OCR line (OCR adds noise around it). */
function partialSimilarity(name: string, line: string) {
  if (line.length <= name.length) return 1 - levenshtein(name, line) / name.length
  let best = Infinity
  for (let start = 0; start <= line.length - name.length; start += 1) {
    best = Math.min(best, levenshtein(name, line.slice(start, start + name.length)))
    if (best === 0) break
  }
  return 1 - best / name.length
}

/**
 * The item whose name the game's tooltip shows. The tooltip holds exactly one name — the full one, in the game's
 * language (Russian or English), sometimes the short one — so the whole OCR line is compared with whole names:
 * - a number read in place of another is another item: "10-round" never matches a "20-round" magazine, "5.45x39"
 *   never "5.56x45". A number read in addition or lost (a letter taken for a digit: «3абрало», «Ф0РТ», «p1ate»; a
 *   digit taken for a letter: «GEN MЗ») is an OCR slip that costs a little — long names hold many such letters;
 * - a short name only counts when it is the whole line and belongs to one item ("PM" is a pistol and a magazine);
 * - when two different items score about the same, the answer is nothing rather than a guess.
 */
export function createTooltipMatcher(items: Item[], alternates?: ReadonlyMap<string, ItemNameVariant[]>): TooltipMatcher {
  const entries: Entry[] = []
  const exact = new Map<string, number[]>()
  const index = new Map<string, number[]>()
  for (const item of items) {
    const key = item.id
    const seen = new Set<string>()
    for (const variant of [{ name: item.name, shortName: item.shortName }, ...(alternates?.get(item.id) ?? [])]) {
      for (const [raw, short] of [[variant.name, false], [variant.shortName, true]] as const) {
        const text = foldName(raw ?? '')
        if (text.length < 2 || seen.has(text)) continue
        seen.add(text)
        const numbers = numbersOf(text)
        const loose = looseDigits(text)
        const id = entries.push({ item, text, loose, numbers, looseNumbers: numberList(loose), short, key }) - 1
        const bucket = exact.get(text)
        if (bucket) bucket.push(id)
        else exact.set(text, [id])
        for (const gram of trigrams(text)) {
          const list = index.get(gram)
          if (list) list.push(id)
          else index.set(gram, [id])
        }
      }
    }
  }

  const twins = new Map<string, Entry[]>()
  for (const entry of entries) {
    const list = twins.get(entry.loose)
    if (list) list.push(entry)
    else twins.set(entry.loose, [entry])
  }

  /**
   * The item among twins that differ only in look-alike digits (room 220 and 228 keys) that the digits read can
   * come from — the OCR turns a 0 into an 8 but not the other way round — or null when that is still more than one.
   */
  const settleTwins = (chosen: Entry, digits: string) => {
    const group = twins.get(chosen.loose)!.filter((entry) => entry.short === chosen.short)
    if (group.every((entry) => entry.key === chosen.key)) return chosen.item
    const possible = group.filter((entry) => couldReadAs(entry.text.replace(/\D/g, ''), digits))
    const keys = new Set(possible.map((entry) => entry.key))
    if (keys.size === 1) return possible[0]!.item
    // Not twins but one full name of several items (since the identity key became the id): see pickSameName.
    // A short name shared by several items still names none of them.
    if (!chosen.short && possible.every((entry) => entry.text === chosen.text)) {
      return pickSameName([...new Map(possible.map((entry) => [entry.key, entry.item])).values()])
    }
    return null
  }

  /** One item for these entries, or null when they are different items. */
  const single = (ids: number[]) => {
    const first = entries[ids[0]!]!
    return ids.every((id) => entries[id]!.key === first.key) ? first.item : null
  }

  /**
   * OCR slips between a name and the line: edits with look-alike digits forgiven, or plain edits when fewer — a
   * stray digit makes its neighbours digit-like on the line's side only («И3олента»: one slip, not two).
   */
  const slipsOf = (entry: Entry, line: string, loose: string) => Math.min(levenshtein(entry.loose, loose), levenshtein(entry.text, line))

  /** Every name sharing trigrams with the line, scored by how well it reads as the line (see match). */
  const score = (line: string) => {
    const loose = looseDigits(line)
    const numbers = numbersOf(line)
    const looseNumbers = numberList(loose)
    const hits = new Map<number, number>()
    for (const gram of trigrams(line)) for (const id of index.get(gram) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1)
    const scored: Array<{ entry: Entry; score: number; slips: number; extra: string[] }> = []
    // Names ruled out by their numbers, and how close their text is: when the OCR read a digit of the model as
    // another ("MP7" read "MP1"), the true item is among these, and a sibling without that digit ("MPX") must not win.
    const otherNumbers: Array<{ entry: Entry; slips: number }> = []
    for (const [id] of [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES)) {
      const entry = entries[id]!
      // A number read in addition or missing is an OCR slip; a number read in place of another (10 ↔ 20,
      // 5.45 ↔ 5.56) is another item. A short name keeps its numbers exactly.
      const extra = without(looseNumbers, entry.looseNumbers)
      const missing = without(entry.looseNumbers, looseNumbers)
      if ((extra.length && missing.length) || (entry.short && (extra.length || missing.length))) {
        if (!entry.short) otherNumbers.push({ entry, slips: slipsOf(entry, line, loose) })
        continue
      }
      // A short name must be read (almost) whole — a slip in a 3-letter name is another name.
      if (entry.short && (entry.text.length < 6 || Math.abs(entry.text.length - line.length) > 1)) continue
      const length = Math.max(entry.loose.length, loose.length)
      let slips = slipsOf(entry, line, loose)
      let score = 1 - slips / length
      // OCR may add a stray character or two around the name: allow the name inside a slightly longer line.
      if (!entry.short && loose.length > entry.loose.length && loose.length - entry.loose.length <= 4) {
        const inner = partialSimilarity(entry.loose, loose) - 0.03
        if (inner > score) { score = inner; slips = Math.round((1 - inner - 0.03) * entry.loose.length) + 1 }
      }
      const penalty = (entry.short ? 0.04 : 0) + (entry.numbers === numbers ? 0 : 0.01) + NUMBER_SLIP * (extra.length + missing.length)
      scored.push({ entry, score: score - penalty, slips, extra })
    }
    scored.sort((a, b) => b.score - a.score || a.slips - b.slips)
    return { loose, scored, otherNumbers }
  }

  const matchLine = (line: string): Item | null => {
    if (line.length < 2) return null
    const hit = exact.get(line)
    if (hit) {
      // A full name wins over short names that happen to read the same. A one- or two-letter short name is
      // too easily misread into another ("GT" → "SS"): the full name is needed for those.
      const full = hit.filter((id) => !entries[id]!.short)
      if (!full.length && line.replace(/ /g, '').length < 3) return null
      if (!full.length && !single(hit)) return null
      return settleTwins(entries[(full.length ? full : hit)[0]!]!, line.replace(/\D/g, ''))
    }
    const { loose, scored, otherNumbers } = score(line)
    const best = scored[0]
    if (!best || best.score < MIN_SCORE) return null
    // Two different items read about equally well are a coin toss: answer nothing rather than maybe the wrong
    // one. The runner-up must need clearly more OCR slips (one more when the best needs none, more when the
    // reading is noisier), and a twin differing only in look-alike digits never loses to a guess.
    const rival = scored.find((candidate) => candidate.entry.key !== best.entry.key && candidate.entry.loose !== best.entry.loose)
    if (rival && rival.slips - best.slips < 1 + Math.floor(best.slips / 4)) return null
    if (best.slips > 0 && otherNumbers.some((other) => other.entry.key !== best.entry.key && other.slips <= best.slips)) return null
    return settleTwins(best.entry, digitsWithout(line, loose, best.extra))
  }

  /** The line as read, then (if that names nothing) with split decimals joined. */
  const readings = (ocrText: string) => {
    const joined = joinedDecimals(ocrText)
    return joined ? [foldTooltipText(ocrText), joined] : [foldTooltipText(ocrText)]
  }

  function match(ocrText: string): Item | null {
    for (const line of readings(ocrText)) {
      const item = matchLine(line)
      if (item) return item
    }
    return null
  }

  function rank(ocrText: string, k: number): TooltipCandidate[] {
    const best = new Map<string, TooltipCandidate>()
    const add = (entry: Entry, value: number) => {
      const known = best.get(entry.key)
      if (!known || known.score < value) best.set(entry.key, { item: entry.item, score: value })
    }
    for (const line of readings(ocrText)) {
      if (line.length < 2 || k <= 0) continue
      // A short name several items share («ПМ») is exactly what the picture can settle.
      for (const id of exact.get(line) ?? []) add(entries[id]!, entries[id]!.short ? 0.96 : 1)
      const { loose, scored, otherNumbers } = score(line)
      for (const candidate of scored) add(candidate.entry, candidate.score)
      for (const other of otherNumbers) add(other.entry, 1 - other.slips / Math.max(other.entry.loose.length, loose.length) - NUMBER_CONFLICT)
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(0, k))
  }

  return Object.assign(match, { rank })
}
