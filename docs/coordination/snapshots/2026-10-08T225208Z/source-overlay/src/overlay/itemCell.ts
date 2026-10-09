/**
 * Where the hovered item lies in a screen grab, for the picture check of the second attempt (see iconMatch.ts).
 *
 * The inventory is a grid of cells (63 px at 1080p) separated by thin lines; an item covers the lines inside its own
 * cells and has a thin frame on the grid lines around them. So the grid is found from the thin lines around the
 * cursor, and the item spreads from the cell under the cursor as far as no line separates the next cell. When no grid
 * shows, the single cell-sized square around the cursor is all there is (`grid: false`).
 *
 * Everything is in image pixels; `unit` is one 1080p pixel of the game UI (as found for the tooltip). Pure.
 */
import type { Bitmap, Rect } from './tooltipDetect.js'

/** Inventory cell pitch at 1080p (see also tooltipDetect: a tooltip is never as tall as a cell). */
export const CELL_PITCH = 63
/** Largest item checked, in cells (cases and backpacks are bigger, but those are found by their names). */
const MAX_CELLS = 6
/** A line differs at least this much (brightness 0–255) from the pixels a little to both sides of it… */
const LINE_CONTRAST = 10
/** …and at most this much from its neighbours along the line. */
const LINE_EVEN = 6
/** Share of a cell border that must be thin line for the cells to belong to different items… */
const LINE_SHARE = 0.5
/** …or that must be an even edge at least (a frame next to a picture about as light as itself). */
const EDGE_SHARE = 0.85
/** Line pixel kinds (see findItemCell). */
const THIN = 2, EDGE = 1
/** Share of a border that must be visible (not under the tooltip or the cursor) to judge it. */
const VISIBLE_SHARE = 0.2
/** The grid's offset must collect this many times the line pixels of a typical (median) offset to be trusted. */
const GRID_CONTRAST = 2.2
/** The mouse arrow drawn over the scene: about 13×21 px from the hotspot (as in tooltipDetect). */
const CURSOR_BOX = { width: 15, height: 23 }
/** The short name (top right) and the count / durability (bottom right) printed over the item's picture: strip height… */
const LABEL_HEIGHT = 14
/** …light grey text (each channel at least this bright, channels this close)… */
const TEXT_LIGHT = 150
const TEXT_GREY = 48
/** …with gaps between letters and words of at most this (1080p px). */
const TEXT_GAP = 5

/** One reading of where the item lies. */
export interface ItemLayout {
  /** The item's picture area inside its frame. */
  rect: Rect
  /** Its size in cells (as on screen: a rotated item is wider than tall the other way round). */
  cols: number
  rows: number
  /** Parts of `rect` (and around it) to leave out of the picture: cursor, tooltip, short-name label, counter. */
  covered: Rect[]
}

export interface ItemCell {
  /**
   * Where the item lies — usually one layout. A border hidden under the tooltip may or may not be the item's edge: then
   * a second layout reaches across it to the next visible line. Each candidate is compared with the one of its size.
   */
  layouts: ItemLayout[]
  /** False when no inventory grid was found: the one layout is then just the cell-sized square around the cursor. */
  grid: boolean
}

/** Brightness at a pixel of the part of the grab the search can reach, worked out when first needed (a 4K grab is large). */
function luminance(image: Bitmap, area: Rect) {
  const light = new Int16Array(area.width * area.height).fill(-1)
  return (x: number, y: number) => {
    const cell = (y - area.y) * area.width + x - area.x
    let value = light[cell]!
    if (value < 0) {
      const index = (y * image.width + x) * 4
      value = light[cell] = (image.data[index + 2]! * 54 + image.data[index + 1]! * 183 + image.data[index]! * 19) >> 8
    }
    return value
  }
}

const inside = (rect: Rect, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height

/**
 * The hovered item's area, cells and covered parts. `tooltip` is the tooltip box found in the same grab (inside its
 * frame), if any.
 */
export function findItemCell(image: Bitmap, cursor: { x: number; y: number }, unit: number, tooltip?: Rect | null): ItemCell {
  const pitch = CELL_PITCH * unit
  const reach = Math.max(2, Math.round(2 * unit))
  const blocked: Rect[] = [{ x: cursor.x - 2, y: cursor.y - 2, width: Math.round(CURSOR_BOX.width * unit) + 4, height: Math.round(CURSOR_BOX.height * unit) + 4 }]
  if (tooltip) blocked.push({ x: tooltip.x - reach - 1, y: tooltip.y - reach - 1, width: tooltip.width + 2 * reach + 2, height: tooltip.height + 2 * reach + 2 })
  const hidden = (x: number, y: number) => blocked.some((rect) => inside(rect, x, y))
  // Only the reach of the search is looked at: the item's farthest border, or the grid window around the cursor.
  const around = Math.ceil((MAX_CELLS + 1) * pitch)
  const view = clip({ x: Math.round(cursor.x) - around, y: Math.round(cursor.y) - around, width: around * 2 + 1, height: around * 2 + 1 }, image.width, image.height)
  const at = luminance(image, view)
  const width = view.x + view.width, height = view.y + view.height

  // Frames and grid lines are drawn in one colour: a line pixel is even with its neighbours along the line. A thin one
  // ('thin') is also set off from the pixels `reach` away on both sides (lighter, darker, or between a dark cell and a
  // bright picture); next to a picture as light as the frame, only from one side ('edge'). Inside a picture neither
  // flat areas nor the inside of a shape are thin, and small details are not even.
  const line = (value: number, previous: number, next: number, before: number, after: number) => {
    if (Math.abs(value - previous) > LINE_EVEN || Math.abs(value - next) > LINE_EVEN) return 0
    const sides = Number(Math.abs(value - before) >= LINE_CONTRAST) + Number(Math.abs(value - after) >= LINE_CONTRAST)
    return sides === 2 ? THIN : sides === 1 ? EDGE : 0
  }
  const verticalLine = (x: number, y: number) => {
    if (x - reach < view.x || x + reach >= width || y - 1 < view.y || y + 1 >= height) return 0
    return line(at(x, y), at(x, y - 1), at(x, y + 1), at(x - reach, y), at(x + reach, y))
  }
  const horizontalLine = (x: number, y: number) => {
    if (y - reach < view.y || y + reach >= height || x - 1 < view.x || x + 1 >= width) return 0
    return line(at(x, y), at(x - 1, y), at(x + 1, y), at(x, y - reach), at(x, y + reach))
  }

  const grid = findGrid(view, cursor, pitch, verticalLine, horizontalLine, hidden)
  if (!grid) {
    const size = Math.round(pitch)
    const rect = clip({ x: Math.round(cursor.x - size / 2), y: Math.round(cursor.y - size / 2), width: size, height: size }, image.width, image.height)
    return { layouts: [{ rect, cols: 1, rows: 1, covered: coveredParts(image, rect, blocked, unit) }], grid: false }
  }

  const lineX = (index: number) => Math.round(grid.x + index * pitch)
  const lineY = (index: number) => Math.round(grid.y + index * pitch)
  // A border is a line when much of it is thin line or nearly all of it an even edge (±1 px: the pitch is not a whole
  // number at every scale).
  const border = (vertical: boolean, position: number, from: number, to: number) => {
    let seen = 0, thin = 0, even = 0
    for (let along = from + 1; along < to; along += 1) {
      const x = vertical ? position : along, y = vertical ? along : position
      if (x < view.x || y < view.y || x >= width || y >= height || hidden(x, y)) continue
      seen += 1
      const kind = Math.max(...(vertical ? [x - 1, x, x + 1].map((value) => verticalLine(value, y)) : [y - 1, y, y + 1].map((value) => horizontalLine(x, value))))
      if (kind === THIN) thin += 1
      if (kind) even += 1
    }
    if (seen < (to - from) * VISIBLE_SHARE) return 'hidden'
    return thin >= seen * LINE_SHARE || even >= seen * EDGE_SHARE ? 'line' : 'open'
  }
  // The cell under the cursor, then as far as no line separates the next one; `across`: also past hidden borders
  // (up to the next visible line).
  const spread = (start: { left: number; right: number; top: number; bottom: number }, across: boolean) => {
    let { left, right, top, bottom } = start
    const goes = (state: string) => state === 'open' || (across && state === 'hidden')
    for (let pass = 0; pass < 2; pass += 1) {
      while (right - left < MAX_CELLS && lineX(right + 1) < width && goes(border(true, lineX(right), lineY(top), lineY(bottom)))) right += 1
      while (right - left < MAX_CELLS && lineX(left - 1) >= view.x && goes(border(true, lineX(left), lineY(top), lineY(bottom)))) left -= 1
      while (bottom - top < MAX_CELLS && lineY(bottom + 1) < height && goes(border(false, lineY(bottom), lineX(left), lineX(right)))) bottom += 1
      while (bottom - top < MAX_CELLS && lineY(top - 1) >= view.y && goes(border(false, lineY(top), lineX(left), lineX(right)))) top -= 1
    }
    return { left, right, top, bottom }
  }
  const column = Math.floor((cursor.x - grid.x) / pitch)
  const row = Math.floor((cursor.y - grid.y) / pitch)
  const sure = spread({ left: column, right: column + 1, top: row, bottom: row + 1 }, false)
  const across = spread(sure, true)
  const layout = ({ left, right, top, bottom }: typeof sure): ItemLayout => {
    // Inside the frame.
    const rect = clip({ x: lineX(left) + reach, y: lineY(top) + reach, width: lineX(right) - lineX(left) - 2 * reach + 1, height: lineY(bottom) - lineY(top) - 2 * reach + 1 }, image.width, image.height)
    return { rect, cols: right - left, rows: bottom - top, covered: coveredParts(image, rect, blocked, unit) }
  }
  const same = across.left === sure.left && across.right === sure.right && across.top === sure.top && across.bottom === sure.bottom
  return { layouts: same ? [layout(sure)] : [layout(sure), layout(across)], grid: true }
}

function clip(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y)
  return { x, y, width: Math.max(0, Math.min(width, rect.x + rect.width) - x), height: Math.max(0, Math.min(height, rect.y + rect.height) - y) }
}

/** The cursor and tooltip boxes plus the text the game prints over the item picture: short name, count. */
function coveredParts(image: Bitmap, rect: Rect, blocked: Rect[], unit: number): Rect[] {
  const strip = Math.min(Math.round(LABEL_HEIGHT * unit), Math.floor(rect.height / 3))
  const room = Math.max(1, Math.round(2 * unit))
  const parts = [...blocked]
  // The short name at the top right, the count / durability at the bottom right: from where the text starts.
  for (const y of [rect.y, rect.y + rect.height - strip]) {
    const start = textStart(image, { x: rect.x, y, width: rect.width, height: strip }, unit)
    if (start >= 0) parts.push({ x: start - room, y, width: rect.x + rect.width - start + room, height: strip })
  }
  return parts
}

/**
 * Where right-aligned light text starts in a strip of the picture, read from the strip's right end leftwards with the
 * gaps between letters and words bridged; -1 when no text shows near the right end. A light part of the picture right
 * next to the text only makes the left-out part longer.
 */
function textStart(image: Bitmap, strip: Rect, unit: number) {
  const gap = Math.max(2, Math.round(TEXT_GAP * unit))
  const right = strip.x + strip.width - 1
  let start = -1
  for (let x = right; x >= strip.x; x -= 1) {
    let text = false
    for (let y = strip.y; y < strip.y + strip.height && !text; y += 1) {
      const index = (y * image.width + x) * 4
      const b = image.data[index]!, g = image.data[index + 1]!, r = image.data[index + 2]!
      text = Math.min(r, g, b) >= TEXT_LIGHT && Math.max(r, g, b) - Math.min(r, g, b) <= TEXT_GREY
    }
    if (text) start = x
    else if ((start >= 0 ? start : right) - x > (start >= 0 ? gap : gap * 3)) break
  }
  return start
}

/**
 * The grid's origin (a line crossing) from the thin lines around the cursor: the pitch is known, the offset is the one
 * where line columns (rows) recur every pitch clearly more than elsewhere. Null when the lines do not stand out.
 */
function findGrid(view: Rect, cursor: { x: number; y: number }, pitch: number, verticalLine: (x: number, y: number) => number, horizontalLine: (x: number, y: number) => number, hidden: (x: number, y: number) => boolean) {
  const span = Math.round(pitch * 3)
  const x0 = Math.max(view.x, Math.round(cursor.x - span)), x1 = Math.min(view.x + view.width - 1, Math.round(cursor.x + span))
  const y0 = Math.max(view.y, Math.round(cursor.y - span)), y1 = Math.min(view.y + view.height - 1, Math.round(cursor.y + span))
  if (x1 - x0 < pitch * 1.5 || y1 - y0 < pitch * 1.5) return null
  const columns = new Float32Array(x1 - x0 + 1)
  const rows = new Float32Array(y1 - y0 + 1)
  // A pixel every two game pixels along the line is plenty (lines are continuous); across it, every pixel.
  const step = Math.max(2, Math.round(2 * pitch / CELL_PITCH))
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += 1) if (!hidden(x, y) && verticalLine(x, y) === THIN) columns[x - x0]! += 1
  for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += 1) if (!hidden(x, y) && horizontalLine(x, y) === THIN) rows[y - y0]! += 1
  const x = combPhase(columns, pitch, (y1 - y0 + 1) / step)
  const y = combPhase(rows, pitch, (x1 - x0 + 1) / step)
  return x == null || y == null ? null : { x: x0 + x, y: y0 + y }
}

/**
 * The offset (0…pitch) whose every-pitch samples (±1 px) hold the most line pixels — if the lines run along a fair
 * part of the window (`samples` = pixels checked per column) and clearly beat a typical offset.
 */
function combPhase(profile: Float32Array, pitch: number, samples: number) {
  const steps = Math.floor((profile.length - 1) / pitch)
  if (steps < 1) return null
  const comb = (phase: number, slack: number) => {
    let score = 0, count = 0
    for (let step = 0; step <= steps; step += 1) {
      const at = Math.round(phase + step * pitch)
      if (at < 0 || at >= profile.length) continue
      score += slack ? Math.max(profile[at]!, profile[at - 1] ?? 0, profile[at + 1] ?? 0) : profile[at]!
      count += 1
    }
    return score / Math.max(1, count)
  }
  const scores = Array.from({ length: Math.ceil(pitch) }, (_, phase) => comb(phase, 1))
  const best = scores.indexOf(Math.max(...scores))
  const typical = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)]!
  if (scores[best]! < Math.max(samples * 0.2, typical * GRID_CONTRAST)) return null
  // The ±1 px slack makes neighbouring offsets tie: the line itself is where the exact comb peaks.
  return [best - 1, best, best + 1].reduce((top, phase) => (comb(phase, 0) > comb(top, 0) ? phase : top), best)
}
