import { levenshtein, normalizeOcr } from '../overlay/itemMatch'
import { likeness, type PictureFingerprint } from './signature'

/** An item the photo is searched for: only the wanted ones (the Collector's, the hideout's), never the whole catalog. */
export interface PhotoCandidate {
  id: string
  shortName: string
  /** Size in cells. */
  width: number
  height: number
  fingerprint: PictureFingerprint
}

export interface PhotoFind {
  id: string
  col: number
  row: number
  width: number
  height: number
  /** Combined certainty (picture + label), about 0.45 … 1. */
  score: number
  picture: number
  /** How well the label read under the item matches its short name (0 when nothing was read). */
  label: number
  /** Worth a look before it is counted: unticked by default in the list. */
  doubtful: boolean
}

const squash = (text: string) => normalizeOcr(text).replace(/\s+/g, '')

/**
 * How well the text read from a label strip matches an item's short name, 0–1. A label is often cut at the cell's edge,
 * so the start of the name counts too (a little less).
 */
export function labelSimilarity(text: string, name: string): number {
  const a = squash(text), b = squash(name)
  if (a.length < 2 || !b) return 0
  let best = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  if (a.length < b.length && a.length >= 3) best = Math.max(best, 1 - levenshtein(a, b.slice(0, a.length)) / a.length - 0.1)
  // The name inside a longer reading (a stray mark or the next label glued on).
  if (b.length >= 4 && a.includes(b)) best = Math.max(best, 0.9)
  return Math.max(0, best)
}

/** Below this the best match of a busy cell is not counted at all. */
export const MIN_SCORE = 0.45
/** At or above this (with a label that agrees or a clear picture) the find is ticked by default. */
export const SURE_SCORE = 0.6

export interface MatchInput {
  columns: number
  rows: number
  /** Cells that hold nothing (flat). */
  empty: ReadonlySet<string>
  /** The fingerprint of the cells from (col, row), w × h big. */
  fingerprintAt: (col: number, row: number, width: number, height: number) => PictureFingerprint
  /** OCR text of each cell's label strip, by "col,row". */
  labels: ReadonlyMap<string, string>
  candidates: PhotoCandidate[]
  /** Short names of every catalog item: a label that clearly names an item not searched for vetoes the wanted look-alike. */
  catalogNames?: readonly string[]
}

const cellKey = (col: number, row: number) => `${col},${row}`

/**
 * Every wanted item tried at every place it fits; the best pairs taken first, no two on the same cell. The label sits at
 * the top right of an item, so a w × h item at (col, row) is read from the cell (col + w − 1, row).
 */
export function matchStash(input: MatchInput): PhotoFind[] {
  const sizes = [...new Set(input.candidates.map((candidate) => `${candidate.width}x${candidate.height}`))].map((size) => size.split('x').map(Number) as [number, number])
  const options: PhotoFind[] = []
  const vetoCache = new Map<string, { name: string; similarity: number } | null>()
  const strongestOther = (text: string) => {
    if (vetoCache.has(text)) return vetoCache.get(text)!
    let best: { name: string; similarity: number } | null = null
    for (const name of input.catalogNames ?? []) {
      const similarity = labelSimilarity(text, name)
      if (!best || similarity > best.similarity) best = { name, similarity }
    }
    vetoCache.set(text, best)
    return best
  }
  for (const [width, height] of sizes) {
    for (let row = 0; row + height <= input.rows; row += 1) {
      for (let col = 0; col + width <= input.columns; col += 1) {
        let flat = false
        for (let dy = 0; dy < height && !flat; dy += 1) for (let dx = 0; dx < width; dx += 1) if (input.empty.has(cellKey(col + dx, row + dy))) { flat = true; break }
        if (flat) continue
        const print = input.fingerprintAt(col, row, width, height)
        const text = input.labels.get(cellKey(col + width - 1, row)) ?? ''
        const readable = squash(text).length >= 3
        const other = readable ? strongestOther(text) : null
        for (const candidate of input.candidates) {
          if (candidate.width !== width || candidate.height !== height) continue
          const picture = likeness(print, candidate.fingerprint)
          const label = labelSimilarity(text, candidate.shortName)
          // The label clearly names another item: not this one, however alike the pictures.
          if (other && other.similarity >= 0.85 && other.similarity > label + 0.15 && squash(other.name) !== squash(candidate.shortName)) continue
          // A label read that does not fit, under a picture only somewhat alike: another item.
          if (readable && label < 0.35 && picture < 0.75) continue
          const score = label > 0 ? picture + 0.8 * (label - 0.5) : picture - 0.05
          if (score < MIN_SCORE) continue
          // Without a label that agrees the picture alone decides, and a photo's colours fool it: left for the player to tick.
          const doubtful = score < SURE_SCORE || label === 0 || (label < 0.7 && picture < 0.7)
          options.push({ id: candidate.id, col, row, width, height, score, picture, label, doubtful })
        }
      }
    }
  }
  options.sort((a, b) => b.score - a.score)
  const taken = new Set<string>()
  const finds: PhotoFind[] = []
  for (const option of options) {
    const cells: string[] = []
    for (let dy = 0; dy < option.height; dy += 1) for (let dx = 0; dx < option.width; dx += 1) cells.push(cellKey(option.col + dx, option.row + dy))
    if (cells.some((cell) => taken.has(cell))) continue
    cells.forEach((cell) => taken.add(cell))
    finds.push(option)
  }
  return finds.sort((a, b) => a.row - b.row || a.col - b.col)
}

/** The finds summed per item: how many of each the photo shows, and whether any of them is doubtful. */
export function countFinds(finds: PhotoFind[]): Array<{ id: string; count: number; doubtful: boolean; score: number }> {
  const byId = new Map<string, { id: string; count: number; doubtful: boolean; score: number }>()
  for (const find of finds) {
    const entry = byId.get(find.id) ?? { id: find.id, count: 0, doubtful: true, score: 0 }
    entry.count += 1
    // One sure sighting makes the item sure.
    entry.doubtful = entry.doubtful && find.doubtful
    entry.score = Math.max(entry.score, find.score)
    byId.set(find.id, entry)
  }
  return [...byId.values()].sort((a, b) => b.score - a.score)
}
