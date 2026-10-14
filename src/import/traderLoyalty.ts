/**
 * Trader loyalty levels from the game's traders' screen (owner, 13.10.2026: «в левой верхней части экрана можешь брать
 * актуальные уровни торговцев, написаные римскими цифрами, 4 уровень это рисунок короны», with two screenshots). Each
 * portrait carries a light badge in its top left corner with a dark glyph: «I», «II», «III» or a crown (IV).
 *
 * Where: the traders' names under the portraits (the whole-screen pass's words) give each card's centre and the step
 * between cards; the badge sits 0.01–0.21 of that step right of the card's left edge and 0.79 of it above the name's
 * middle (measured on both screenshots, 2000 px and 1566 px wide). What: the glyph's shape, not OCR — a crown is narrow at
 * the top (the middle point) and wide at the base, numerals are one to three vertical strokes.
 */
import type { OcrWordBox, PaneRect } from './storyPaneLayout.js'

/** The names under the portraits (Russian and English interface) and the app's trader keys (src/gunsmith/traderLevels.ts). */
export const TRADER_SCREEN_NAMES: Record<string, string> = {
  прапор: 'prapor', терапевт: 'therapist', скупщик: 'fence', лыжник: 'skier', миротворец: 'peacekeeper',
  механик: 'mechanic', барахольщик: 'ragman', егерь: 'jaeger', реф: 'ref',
  prapor: 'prapor', therapist: 'therapist', fence: 'fence', skier: 'skier', peacekeeper: 'peacekeeper',
  mechanic: 'mechanic', ragman: 'ragman', jaeger: 'jaeger', ref: 'ref',
}

/** Card step / interface height on the owner's screenshot (97 px at 837 px): used when only one name was read. */
const STEP_PER_UNIT = 0.1165

export interface TraderBadge { key: string; rect: PaneRect }

const middle = (box: OcrWordBox['bbox']) => ({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })

/**
 * Each trader whose name the pass read, with the rectangle of its badge. Names at another height than most (a quest
 * text mentioning «Прапор») are left out.
 */
export function traderBadgeRects(words: OcrWordBox[], size: { width: number; height: number }): TraderBadge[] {
  const named = words
    .map((word) => ({ key: TRADER_SCREEN_NAMES[word.text.toLowerCase().replace(/[^a-zа-яё]/gi, '')], ...middle(word.bbox), height: word.bbox.y1 - word.bbox.y0 }))
    .filter((entry): entry is { key: string; x: number; y: number; height: number } => Boolean(entry.key))
  if (!named.length) return []
  // The strip: the names on the row most of them share.
  const row = [...named].sort((a, b) => a.y - b.y)[Math.floor(named.length / 2)]!.y
  const strip = named.filter((entry) => Math.abs(entry.y - row) <= Math.max(6, entry.height)).sort((a, b) => a.x - b.x)
  const unique = strip.filter((entry, index) => strip.findIndex((other) => other.key === entry.key) === index)
  const steps = unique.slice(1).map((entry, index) => entry.x - unique[index]!.x).filter((step) => step > 0).sort((a, b) => a - b)
  const unit = Math.min(size.height, size.width * 9 / 16)
  const step = steps.length ? steps[Math.floor(steps.length / 2)]! : unit * STEP_PER_UNIT
  return unique.map(({ key, x, y }) => {
    const left = Math.round(x - 0.4325 * step)
    const top = Math.round(y - 0.79 * step)
    const side = Math.round(0.2 * step)
    if (left < 0 || top < 0 || left + side > size.width || top + side > size.height || side < 8) return null
    return { key, rect: { x: left, y: top, width: side, height: side } }
  }).filter((badge): badge is TraderBadge => Boolean(badge))
}

/** Runs of `true` in a row of flags: [start, end] pairs. */
function runs(flags: boolean[]) {
  const found: Array<[number, number]> = []
  let start = -1
  flags.forEach((flag, index) => {
    if (flag && start < 0) start = index
    if (!flag && start >= 0) { found.push([start, index - 1]); start = -1 }
  })
  if (start >= 0) found.push([start, flags.length - 1])
  return found
}

/**
 * The loyalty level a badge shows (grey pixels, row by row): 1–3 for «I»–«III», 4 for the crown, null when it is not a
 * clear badge (another screen, a portrait without one, a picture in between).
 */
export function classifyLoyaltyBadge(gray: ArrayLike<number>, width: number, height: number): 1 | 2 | 3 | 4 | null {
  const at = (x: number, y: number) => gray[y * width + x]!
  let max = 0
  for (let index = 0; index < width * height; index += 1) max = Math.max(max, gray[index]!)
  if (max < 120) return null
  const light = max * 0.8
  const dark = max * 0.6
  // The badge's light top above the glyph: the first band of at least two rows that are light almost across.
  const lightCount = (y: number, from = 0, to = width - 1) => {
    let count = 0
    for (let x = from; x <= to; x += 1) if (at(x, y) >= light) count += 1
    return count
  }
  const topRows = runs(Array.from({ length: height }, (_, y) => lightCount(y) >= width * 0.6)).find(([start, end]) => end - start >= 1)
  if (!topRows) return null
  // Its width: the columns light in its first two rows (the glyph starts lower and would split the columns).
  const span = runs(Array.from({ length: width }, (_, x) => at(x, topRows[0]) >= light && at(x, topRows[0] + 1) >= light))
    .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]
  if (!span || span[1] - span[0] + 1 < width * 0.35) return null
  const [x0, x1] = span
  // The badge is about square; the glyph is what is dark between light pixels of the badge in the same row.
  const y0 = topRows[0], y1 = Math.min(height - 1, topRows[0] + (x1 - x0))
  const glyph = (x: number, y: number) => {
    if (at(x, y) >= dark) return false
    let left = false, right = false
    for (let other = x0; other < x && !left; other += 1) left = at(other, y) >= light
    for (let other = x1; other > x && !right; other -= 1) right = at(other, y) >= light
    return left && right
  }
  let gx0 = Infinity, gx1 = -1, gy0 = Infinity, gy1 = -1
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    if (!glyph(x, y)) continue
    gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y)
  }
  if (gx1 < 0) return null
  const glyphWidth = gx1 - gx0 + 1, glyphHeight = gy1 - gy0 + 1
  if (glyphHeight < 5) return null
  const coverage = (fromRow: number, toRow: number) => {
    let covered = 0
    for (let x = gx0; x <= gx1; x += 1) {
      let any = false
      for (let y = fromRow; y <= toRow && !any; y += 1) any = glyph(x, y)
      if (any) covered += 1
    }
    return covered / glyphWidth
  }
  const edge = Math.max(1, Math.round(glyphHeight * 0.15))
  const top = coverage(gy0, gy0 + edge - 1)
  const bottom = coverage(gy1 - edge + 1, gy1)
  // The crown: its middle point alone at the top, its base across the whole width.
  if (glyphWidth >= glyphHeight * 0.75 && top <= 0.35 && bottom >= 0.7) return 4
  // Numerals: the strokes across the middle (the serifs are at the top and the bottom only).
  const from = gy0 + Math.round(glyphHeight * 0.35), to = gy0 + Math.round(glyphHeight * 0.65)
  const strokes = runs(Array.from({ length: glyphWidth }, (_, index) => {
    let count = 0
    for (let y = from; y <= to; y += 1) if (glyph(gx0 + index, y)) count += 1
    return count >= (to - from + 1) * 0.6
  }))
  if (strokes.length < 1 || strokes.length > 3) return null
  // A stroke is thin: a wide dark block is not a numeral.
  if (strokes.some(([start, end]) => end - start + 1 > Math.max(3, glyphHeight * 0.3))) return null
  return strokes.length as 1 | 2 | 3
}

/** Levels two frames agree on (the badge can be in between two pictures for a moment). */
export function confirmLoyalty(current: Record<string, number>, previous: Record<string, number>) {
  return Object.fromEntries(Object.entries(current).filter(([key, level]) => previous[key] === level))
}
