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
  /** The numbers with look-alike digits merged — they must match the tooltip's. */
  looseNumbers: string
  short: boolean
  /** The item's full name (folded), to tell different items from the same item under two names. */
  key: string
}

const MIN_SCORE = 0.8
const CANDIDATES = 80

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
 * Typical OCR slips inside numbers: "1O" → "10", "l2" → "12", "2o-round" → "20-round". Only a look-alike letter
 * standing between a digit and the end of a word (or between two digits) is changed, so "6Б43" or "M4A1" stay.
 */
export function repairOcrNumbers(value: string) {
  const digit: Record<string, string> = { o: '0', O: '0', о: '0', О: '0', '@': '0', '®': '0', l: '1', I: '1', '|': '1', i: '1' }
  let text = value
  for (let pass = 0; pass < 2; pass += 1) {
    text = text
      .replace(/(\d)([oOоО@®lI|i])(?=\d|[^\p{L}\p{N}]|$)/gu, (_, d: string, c: string) => d + digit[c]!)
      .replace(/(^|[^\p{L}\p{N}])([oOоО@®lI|i])(?=\d)/gu, (_, before: string, c: string) => before + digit[c]!)
  }
  return text
}

/** OCR drops the decimal point now and then ("5.56" → "556"): numbers are compared without it. */
const numbersOf = (folded: string) => (folded.match(/\d+(?:\.\d+)?/g) ?? []).map((value) => value.replace('.', '')).sort().join(' ')

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
 * - numbers are strict: "10-round" never matches a "20-round" magazine, "5.45x39" never "5.56x45";
 * - a short name only counts when it is the whole line and belongs to one item ("PM" is a pistol and a magazine);
 * - when two different items score about the same, the answer is nothing rather than a guess.
 */
export function createTooltipMatcher(items: Item[], alternates?: ReadonlyMap<string, ItemNameVariant[]>) {
  const entries: Entry[] = []
  const exact = new Map<string, number[]>()
  const index = new Map<string, number[]>()
  for (const item of items) {
    const key = foldName(item.name ?? '')
    const seen = new Set<string>()
    for (const variant of [{ name: item.name, shortName: item.shortName }, ...(alternates?.get(item.id) ?? [])]) {
      for (const [raw, short] of [[variant.name, false], [variant.shortName, true]] as const) {
        const text = foldName(raw ?? '')
        if (text.length < 2 || seen.has(text)) continue
        seen.add(text)
        const numbers = numbersOf(text)
        const loose = looseDigits(text)
        const id = entries.push({ item, text, loose, numbers, looseNumbers: numbersOf(loose), short, key }) - 1
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
    return keys.size === 1 ? possible[0]!.item : null
  }

  /** One item for these entries, or null when they are different items. */
  const single = (ids: number[]) => {
    const first = entries[ids[0]!]!
    return ids.every((id) => entries[id]!.key === first.key) ? first.item : null
  }

  return function match(ocrText: string): Item | null {
    const line = foldName(repairOcrNumbers(ocrText))
    if (line.length < 2) return null
    const loose = looseDigits(line)
    const digits = line.replace(/\D/g, '')
    const hit = exact.get(line)
    if (hit) {
      // A full name wins over short names that happen to read the same. A one- or two-letter short name is
      // too easily misread into another ("GT" → "SS"): the full name is needed for those.
      const full = hit.filter((id) => !entries[id]!.short)
      if (!full.length && line.replace(/ /g, '').length < 3) return null
      const found = single(full.length ? full : hit)
      return found && settleTwins(entries[(full.length ? full : hit)[0]!]!, digits)
    }
    const numbers = numbersOf(line)
    const looseNumbers = numbersOf(loose)
    const hits = new Map<number, number>()
    for (const gram of trigrams(line)) for (const id of index.get(gram) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1)
    const scored: Array<{ entry: Entry; score: number; slips: number }> = []
    // Names ruled out by their numbers, and how close their text is: when the OCR lost a digit of the model
    // ("MP9" read "MPS"), the true item is among these, and a sibling without that digit ("MPX") must not win.
    const otherNumbers: Array<{ entry: Entry; slips: number }> = []
    for (const [id] of [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES)) {
      const entry = entries[id]!
      if (entry.looseNumbers !== looseNumbers) {
        if (!entry.short) otherNumbers.push({ entry, slips: levenshtein(entry.loose, loose) })
        continue
      }
      // A short name must be read (almost) whole — a slip in a 3-letter name is another name.
      if (entry.short && (entry.text.length < 6 || Math.abs(entry.text.length - line.length) > 1)) continue
      const length = Math.max(entry.loose.length, loose.length)
      let slips = levenshtein(entry.loose, loose)
      let score = 1 - slips / length
      // OCR may add a stray character or two around the name: allow the name inside a slightly longer line.
      if (!entry.short && loose.length > entry.loose.length && loose.length - entry.loose.length <= 4) {
        const inner = partialSimilarity(entry.loose, loose) - 0.03
        if (inner > score) { score = inner; slips = Math.round((1 - inner - 0.03) * entry.loose.length) + 1 }
      }
      scored.push({ entry, score: score - (entry.short ? 0.04 : 0) - (entry.numbers === numbers ? 0 : 0.01), slips })
    }
    scored.sort((a, b) => b.score - a.score || a.slips - b.slips)
    const best = scored[0]
    if (!best || best.score < MIN_SCORE) return null
    // Two different items read about equally well are a coin toss: answer nothing rather than maybe the wrong
    // one. The runner-up must need clearly more OCR slips (one more when the best needs none, more when the
    // reading is noisier), and a twin differing only in look-alike digits never loses to a guess.
    const rival = scored.find((candidate) => candidate.entry.key !== best.entry.key && candidate.entry.loose !== best.entry.loose)
    if (rival && rival.slips - best.slips < 1 + Math.floor(best.slips / 4)) return null
    if (best.slips > 0 && otherNumbers.some((other) => other.entry.key !== best.entry.key && other.slips <= best.slips)) return null
    return settleTwins(best.entry, digits)
  }
}
