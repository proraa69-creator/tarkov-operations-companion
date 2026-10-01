import { findTooltip, ocrVariants, type Bitmap, type Rect } from './tooltipDetect.js'

/** A grab of the screen around the cursor (see TOOLTIP_CAPTURE). */
export interface TooltipShot {
  image: Bitmap
  /** Where the mouse points, in image pixels. */
  cursor: { x: number; y: number }
  /** One 1080p pixel in image pixels (screen height / 1080). */
  unit: number
}

export interface TooltipReading<Answer, Shot extends TooltipShot> {
  answer: Answer | null
  /** The last tooltip seen (null when the game showed none in time). */
  shot: Shot | null
  rect: Rect | null
  /** What the OCR read, for the failed-lookup log. */
  tries: string[]
}

export interface TooltipLookupSteps<Answer, Shot extends TooltipShot> {
  grab: () => Promise<Shot | null>
  recognize: (bitmap: Bitmap) => Promise<string>
  /** The item for an OCR line, or null. */
  match: (text: string) => Promise<Answer | null>
  /** A tooltip was found (e.g. show the card in its «reading…» state right there). */
  onTooltip?: (shot: Shot, rect: Rect) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const TOOLTIP_TIMING = {
  /** The game shows the name a moment after the cursor stops on an item: wait this long for it to appear. */
  appearMs: 900,
  /** A tooltip read without a match (still fading in, or the previous item's) is looked at again until then. */
  totalMs: 1800,
  /** Between grabs; finding the box takes a few ms, only a found box is read (OCR). */
  intervalMs: 60,
}

/**
 * Reads the game's name tooltip for the item under the cursor. Pressing the key right after pointing at an item
 * is normal, so the screen is grabbed again every few dozen milliseconds until the tooltip appears; only a found
 * tooltip is read. A reading without a match is not the end either: the tooltip may still be fading in, or be the
 * previous item's — a tooltip that looks different from the ones read already is read again, for a little while.
 */
export async function readGameTooltip<Answer, Shot extends TooltipShot>(steps: TooltipLookupSteps<Answer, Shot>, timing = TOOLTIP_TIMING): Promise<TooltipReading<Answer, Shot>> {
  const now = steps.now ?? (() => Date.now())
  const sleep = steps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = now()
  const read = new Set<string>()
  const tries: string[] = []
  let last: { shot: Shot; rect: Rect } | null = null
  for (;;) {
    const shot = await steps.grab().catch(() => null)
    const rect = shot ? findTooltip(shot.image, shot.cursor, shot.unit) : null
    if (shot && rect) {
      const key = tooltipKey(shot.image, rect)
      if (!last) steps.onTooltip?.(shot, rect)
      last = { shot, rect }
      if (!read.has(key)) {
        read.add(key)
        for (const bitmap of ocrVariants(shot.image, rect, shot.cursor, shot.unit)) {
          const text = await steps.recognize(bitmap).catch(() => '')
          tries.push(text)
          if (!text) continue
          const answer = await steps.match(text)
          if (answer) return { answer, shot, rect, tries }
        }
      }
    }
    const elapsed = now() - started
    if (elapsed >= (last ? timing.totalMs : timing.appearMs)) break
    await sleep(timing.intervalMs)
  }
  return { answer: null, shot: last?.shot ?? null, rect: last?.rect ?? null, tries }
}

/** Box size and its coarse brightness pattern: the same tooltip again, or a new (or brighter) one. */
export function tooltipKey(image: Bitmap, rect: Rect) {
  const cells: number[] = []
  const columns = 12, rows = 3
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0, count = 0
      const x0 = rect.x + Math.floor(column * rect.width / columns), x1 = rect.x + Math.floor((column + 1) * rect.width / columns)
      const y0 = rect.y + Math.floor(row * rect.height / rows), y1 = rect.y + Math.floor((row + 1) * rect.height / rows)
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (y * image.width + x) * 4
          sum += (image.data[index + 2]! * 54 + image.data[index + 1]! * 183 + image.data[index]! * 19) >> 8
          count += 1
        }
      }
      cells.push(count ? Math.round(sum / count / 6) : 0)
    }
  }
  return `${rect.width}x${rect.height}:${cells.join('.')}`
}
