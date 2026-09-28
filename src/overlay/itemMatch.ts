import type { Item } from '../domain/types'

interface Entry {
  item: Item
  text: string
  short: boolean
}

const MIN_SCORE = 0.72
const CANDIDATES = 30

/** OCR mixes look-alike Cyrillic and Latin letters, so both sides are folded to one alphabet. */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', ё: 'e', '0': 'o',
}

export function normalizeOcr(value: string) {
  return value
    .toLowerCase()
    .replace(/[авекмнорстухё0]/g, (char) => HOMOGLYPHS[char] ?? char)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

export function createItemMatcher(items: Item[]) {
  const entries: Entry[] = []
  const index = new Map<string, number[]>()
  for (const item of items) {
    for (const [value, short] of [[item.name, false], [item.shortName, true]] as const) {
      const text = normalizeOcr(value ?? '')
      if (text.length < 2 || (short && text === normalizeOcr(item.name))) continue
      const id = entries.push({ item, text, short }) - 1
      for (const gram of trigrams(text)) {
        const bucket = index.get(gram)
        if (bucket) bucket.push(id)
        else index.set(gram, [id])
      }
    }
  }

  return function match(ocrText: string): Item | null {
    const lines = ocrText.split(/\r?\n/).map(normalizeOcr).filter((line) => line.length >= 2)
    let best: { item: Item; score: number; length: number } | null = null
    for (const line of lines) {
      const hits = new Map<number, number>()
      for (const gram of trigrams(line)) {
        for (const id of index.get(gram) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1)
      }
      const candidates = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES)
      for (const [id] of candidates) {
        const entry = entries[id]!
        let score: number
        if (entry.short) {
          // Short names are only trusted as a whole word on the line.
          const words = line.split(' ')
          score = line === entry.text ? 0.9 : entry.text.length >= 3 && words.includes(entry.text) ? 0.76 : 0
        } else if (!entry.text.includes(' ') && entry.text.length < 8) {
          // One short word must match a whole OCR word, not the start of a longer one.
          score = Math.max(0, ...line.split(' ').map((word) => 1 - levenshtein(word, entry.text) / Math.max(word.length, entry.text.length)))
        } else {
          score = partialSimilarity(entry.text, line)
          // A short OCR fragment of a long name is weak evidence.
          if (line.length < entry.text.length * 0.6) score *= line.length / (entry.text.length * 0.6)
        }
        if (score >= MIN_SCORE && (!best || score > best.score + 0.001 || (Math.abs(score - best.score) <= 0.001 && entry.text.length > best.length))) {
          best = { item: entry.item, score, length: entry.text.length }
        }
      }
    }
    return best?.item ?? null
  }
}

/**
 * Best similarity (0–1) of the item's name or short name anywhere in a block of OCR text.
 * Used to tick off several known items on one screen, unlike the matcher that returns one item.
 */
export function itemTextScore(item: Item, ocrText: string) {
  let best = 0
  const names = [[item.name, false], [item.shortName, true]] as const
  const lines = ocrText.split(/\r?\n/).map(normalizeOcr).filter((line) => line.length >= 2)
  for (const [raw, short] of names) {
    const name = normalizeOcr(raw ?? '')
    if (name.length < 3) continue
    for (const line of lines) {
      let score: number
      if (short) score = line === name ? 0.9 : line.split(' ').includes(name) ? 0.76 : 0
      else if (!name.includes(' ') && name.length < 8) score = Math.max(0, ...line.split(' ').map((word) => 1 - levenshtein(word, name) / Math.max(word.length, name.length)))
      else score = partialSimilarity(name, line) * (line.length < name.length * 0.6 ? line.length / (name.length * 0.6) : 1)
      if (score > best) best = score
    }
  }
  return best
}

export const ITEM_TEXT_MIN_SCORE = MIN_SCORE
