/**
 * Finds the game's own item-name tooltip in a screen grab around the cursor. EFT shows it a moment after the
 * cursor stops on an item: a near-black box with a thin light-grey frame and one line of light text (the item's
 * name), left-aligned with equal padding on both sides. Reading only that box gives the exact name — neighbouring
 * cell labels never get in the way.
 *
 * Everything here is in image pixels; `unit` is the size of one 1080p pixel in the image (screen height / 1080).
 */
export interface Bitmap { width: number; height: number; /** 4 bytes per pixel, BGRA (Windows / Electron order). */ data: Uint8Array }
export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Screen area searched around the cursor, in 1080p pixels. Generous on purpose: over a large item (backpack,
 * rig, headset) the tooltip may sit at the item's corner, far from the cursor, and long names make it wide.
 */
export const TOOLTIP_CAPTURE = { left: 760, right: 820, up: 460, down: 320 }

/**
 * Tesseract settings for the tooltip line (the app and scripts/item-lookup-bench.mjs use the same): one line of
 * text; symbols that never occur in item names are ruled out, so a square 0 of the game's font is not read as "@".
 */
export const TOOLTIP_OCR_PARAMETERS = {
  tessedit_pageseg_mode: '7',
  user_defined_dpi: '300',
  tessedit_char_blacklist: '@$®©|!?[]{}~<>*§°€£¥',
}

/** Frame pixels: a light, grey (unsaturated) line. */
const FRAME_MIN = 62
const FRAME_MAX = 235
const GREY_SPREAD = 30
/** The box background right inside the frame (semi-transparent black over whatever is under it). */
const INSIDE_MAX = 72
/** How much lighter the frame is than the box right inside it. */
const FRAME_CONTRAST = 24
/** The box is one line of text: never as tall as an inventory cell (63 px at 1080p). */
const MIN_HEIGHT = 17
const MAX_HEIGHT = 56
const MIN_WIDTH = 26
/** Farthest a tooltip may be from the cursor (1080p px): over a big item it sits at the item's corner. */
const MAX_DISTANCE = 760
/** The mouse arrow drawn over the scene (when the capture includes it): about 13×21 px from the hotspot. */
const CURSOR_BOX = { width: 15, height: 23 }

function luminanceMap(image: Bitmap) {
  const { width, height, data } = image
  const light = new Uint8Array(width * height)
  const grey = new Uint8Array(width * height)
  for (let pixel = 0, index = 0; pixel < light.length; pixel += 1, index += 4) {
    const b = data[index]!, g = data[index + 1]!, r = data[index + 2]!
    const value = (r * 54 + g * 183 + b * 19) >> 8
    light[pixel] = value
    grey[pixel] = value >= FRAME_MIN && value <= FRAME_MAX && Math.max(r, g, b) - Math.min(r, g, b) <= GREY_SPREAD ? 1 : 0
  }
  return { light, grey }
}

interface Run { y: number; x0: number; x1: number }
interface Candidate { rect: Rect; score: number }

/**
 * The tooltip box nearest to the cursor (inside the frame, in image pixels), or null when the game shows none.
 * `cursor` is where the mouse points in the image; the arrow drawn there (if captured) may cover part of the box.
 */
export function findTooltip(image: Bitmap, cursor: { x: number; y: number }, unit = 1): Rect | null {
  return findTooltipPrepared(image, cursor, unit, unit, luminanceMap(image))
}

function findTooltipPrepared(image: Bitmap, cursor: { x: number; y: number }, unit: number, distanceUnit: number, maps: ReturnType<typeof luminanceMap>): Rect | null {
  const { width, height } = image
  if (width < 20 || height < 20) return null
  const { light, grey } = maps
  const minWidth = Math.round(MIN_WIDTH * unit)
  const minHeight = Math.round(MIN_HEIGHT * unit)
  const maxHeight = Math.round(MAX_HEIGHT * unit)
  const inset = Math.max(2, Math.round(2 * unit))
  // A gap in an edge (the mouse arrow crossing it) is bridged.
  const maxGap = Math.round(CURSOR_BOX.width * unit)
  const cursorMask = { x: cursor.x - 2, y: cursor.y - 2, width: Math.round(CURSOR_BOX.width * unit) + 4, height: Math.round(CURSOR_BOX.height * unit) + 4 }

  // Horizontal frame edges: runs of frame pixels on one row with the dark inside of the box right below (top
  // edge) or right above (bottom edge) — other light lines on screen do not qualify.
  const edgeRuns = (direction: 1 | -1) => {
    const runs: Run[] = []
    for (let y = 0; y < height; y += 1) {
      const insideY = y + inset * direction
      if (insideY < 0 || insideY >= height) continue
      const row = y * width, inside = insideY * width
      const masked = y >= cursorMask.y && y <= cursorMask.y + cursorMask.height
      let start = -1, last = -1
      for (let x = 0; x < width; x += 1) {
        if (grey[row + x] !== 1 || light[inside + x]! > INSIDE_MAX || light[row + x]! - light[inside + x]! < FRAME_CONTRAST) continue
        const gap = x - last - 1
        if (start >= 0 && gap > 1 && !(masked && gap <= maxGap && last + 1 <= cursorMask.x + cursorMask.width && x - 1 >= cursorMask.x)) {
          if (last - start + 1 >= minWidth) runs.push({ y, x0: start, x1: last })
          start = -1
        }
        if (start < 0) start = x
        last = x
      }
      if (start >= 0 && last - start + 1 >= minWidth) runs.push({ y, x0: start, x1: last })
    }
    return runs
  }
  const tops = edgeRuns(1)
  if (!tops.length) return null
  const bottoms = edgeRuns(-1)
  if (!bottoms.length) return null
  const bottomsByRow = new Map<number, Run[]>()
  for (const run of bottoms) {
    const list = bottomsByRow.get(run.y)
    if (list) list.push(run)
    else bottomsByRow.set(run.y, [run])
  }

  const tolerance = Math.max(3, Math.round(3 * unit))
  let best: Candidate | null = null
  const seen = new Set<string>()
  for (const top of tops) {
    for (let gap = minHeight; gap <= maxHeight; gap += 1) {
      for (const bottom of bottomsByRow.get(top.y + gap) ?? []) {
        // The edges may run on into other lines of the UI (a grid line touching the box): pair by overlap and
        // find the box's own sides inside it.
        const overlap0 = Math.max(top.x0, bottom.x0)
        const overlap1 = Math.min(top.x1, bottom.x1)
        if (overlap1 - overlap0 < minWidth || overlap1 - overlap0 < 0.8 * Math.min(top.x1 - top.x0, bottom.x1 - bottom.x0)) continue
        const aligned0 = Math.abs(top.x0 - bottom.x0) <= tolerance
        const aligned1 = Math.abs(top.x1 - bottom.x1) <= tolerance
        const x0 = findSide(light, grey, width, overlap0, top.y, bottom.y, tolerance, aligned0, inset)
        const x1 = findSide(light, grey, width, overlap1, top.y, bottom.y, tolerance, aligned1, -inset)
        if (x0 == null || x1 == null || x1 - x0 < minWidth) continue
        const key = `${x0},${x1},${top.y},${bottom.y}`
        if (seen.has(key)) continue
        seen.add(key)
        // Inside the frame (1 px at 1080p, maybe 2 px at larger resolutions; the padding leaves room to spare).
        const rect = { x: x0 + inset, y: top.y + inset, width: x1 - x0 - inset * 2 + 1, height: gap - inset * 2 + 1 }
        if (rect.width < minWidth / 2 || rect.height < minHeight / 2) continue
        const text = readTextLayout(light, width, rect, cursorMask, unit)
        if (!text) continue
        // Nearest to the cursor wins (the tooltip hugs it); boxes far away are other panels.
        const dx = Math.max(0, x0 - cursor.x, cursor.x - x1)
        const dy = Math.max(0, top.y - cursor.y, cursor.y - bottom.y)
        const score = Math.hypot(dx, dy * 1.2)
        if (!best || score < best.score) best = { rect, score }
      }
    }
  }
  return best && best.score <= MAX_DISTANCE * distanceUnit ? best.rect : null
}

/** Game UI scaling is independent of the monitor's pixel density. */
export function findTooltipAtScales(image: Bitmap, cursor: { x: number; y: number }, unit = 1) {
  if (!Number.isFinite(unit) || unit <= 0) return null
  const maps = luminanceMap(image)
  for (const factor of [1, 0.75, 1.25, 0.5, 1.5, 2]) {
    const scale = unit * factor
    const rect = findTooltipPrepared(image, cursor, scale, unit, maps)
    if (rect) return { rect, unit: scale }
  }
  return null
}

function inMask(mask: Rect, x: number, y: number) {
  return x >= mask.x && x <= mask.x + mask.width && y >= mask.y && y <= mask.y + mask.height
}

/**
 * The frame column nearest to x (searching a few pixels both ways): light, grey and lighter than the box right
 * inside it (`inward` px towards the box) along most of the box height, or null.
 */
function findSide(light: Uint8Array, grey: Uint8Array, width: number, x: number, y0: number, y1: number, tolerance: number, aligned: boolean, inward: number) {
  const radius = tolerance * 2 + 3
  // Edges ending together at the top and bottom are strong evidence already: a side partly hidden by the
  // mouse arrow is then enough.
  const need = (y1 - y0 + 1) * (aligned ? 0.45 : 0.75)
  for (let offset = 0; offset <= radius; offset += 1) {
    for (const column of offset ? [x - offset, x + offset] : [x]) {
      const inside = column + inward
      if (column < 0 || column >= width || inside < 0 || inside >= width) continue
      let hits = 0
      for (let y = y0; y <= y1; y += 1) {
        const index = y * width
        if (grey[index + column] === 1 && light[index + column]! - light[index + inside]! >= FRAME_CONTRAST) hits += 1
      }
      if (hits >= need) return column
    }
  }
  return null
}

interface TextLayout { background: number; peak: number; x0: number; x1: number; y0: number; y1: number }

/**
 * The inside of a real tooltip: an even dark background (its margins free of anything bright) and one line of
 * light text with the same padding left and right. An inventory cell (item picture), an empty cell or a
 * container header bar (text at one side of a long bar) does not look like that.
 */
function readTextLayout(light: Uint8Array, width: number, rect: Rect, cursorMask: Rect, unit: number): TextLayout | null {
  const margin = Math.max(1, Math.round(2 * unit))
  const values: number[] = []
  for (const y of [rect.y + margin, rect.y + rect.height - 1 - margin]) {
    for (let x = rect.x + margin; x < rect.x + rect.width - margin; x += 1) if (!inMask(cursorMask, x, y)) values.push(light[y * width + x]!)
  }
  if (values.length < 8) return null
  values.sort((a, b) => a - b)
  const background = values[Math.floor(values.length / 2)]!
  if (background > INSIDE_MAX) return null
  let even = 0
  // The box is drawn semi-transparent: what lies under it shows through faintly.
  for (const value of values) if (Math.abs(value - background) <= 32) even += 1
  if (even < values.length * 0.8) return null

  const threshold = Math.max(background + 50, 96)
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1, bright = 0, counted = 0, maskedLeft = false
  const peaks: number[] = []
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (inMask(cursorMask, x, y)) { if (x < rect.x + rect.width / 3) maskedLeft = true; continue }
      counted += 1
      const value = light[y * width + x]!
      if (value < threshold) continue
      bright += 1
      if (peaks.length < 4000) peaks.push(value)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (!counted || x1 < 0) return null
  const share = bright / counted
  if (share < 0.002 || share > 0.4) return null
  // Text sits inside the box, off its frame, one line high.
  const textHeight = y1 - y0 + 1
  if (y0 <= rect.y || y1 >= rect.y + rect.height - 1 || textHeight < 4 * unit || textHeight > 30 * unit) return null
  const padLeft = x0 - rect.x, padRight = rect.x + rect.width - 1 - x1
  if (padRight > 34 * unit || (!maskedLeft && (padLeft > 34 * unit || Math.abs(padLeft - padRight) > Math.max(9 * unit, rect.width * 0.12)))) return null
  peaks.sort((a, b) => a - b)
  return { background, peak: peaks[Math.floor(peaks.length * 0.9)] ?? threshold, x0, x1, y0, y1 }
}

export interface OcrOptions {
  /** Pixels to leave white (the mouse arrow over the box). */
  mask?: Rect
  /** Make the picture pure black and white at this level (0–255) after scaling; Tesseract reads the game's
   * font (Bender: flat-topped 3, square 0) noticeably better so. */
  threshold?: number
}

/**
 * The tooltip text as black on white, upscaled smoothly (bilinear — blocky pixels make the OCR take 0 for 8 and
 * 3 for 5), with a white margin. Returns BGRA pixels.
 */
export function tooltipForOcr(image: Bitmap, rect: Rect, scale = 3, black = 45, span = 150, options: OcrOptions = {}): Bitmap {
  const { mask, threshold } = options
  // Brightness of the box, stretched: the dark background goes white, the light text black.
  const tone = new Float32Array(rect.width * rect.height)
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sx = rect.x + x, sy = rect.y + y
      let value = 255
      if (!mask || !inMask(mask, sx, sy)) {
        const index = (sy * image.width + sx) * 4
        const light = (image.data[index + 2]! * 54 + image.data[index + 1]! * 183 + image.data[index]! * 19) >> 8
        value = 255 - Math.max(0, Math.min(255, (light - black) * 255 / span))
      }
      tone[y * rect.width + x] = value
    }
  }
  const pad = 4 * scale
  const width = Math.round(rect.width * scale) + pad * 2
  const height = Math.round(rect.height * scale) + pad * 2
  const data = new Uint8Array(width * height * 4).fill(255)
  const innerWidth = width - pad * 2, innerHeight = height - pad * 2
  for (let y = 0; y < innerHeight; y += 1) {
    const fy = Math.max(0, Math.min(rect.height - 1, (y + 0.5) / scale - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(rect.height - 1, y0 + 1), wy = fy - y0
    for (let x = 0; x < innerWidth; x += 1) {
      const fx = Math.max(0, Math.min(rect.width - 1, (x + 0.5) / scale - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(rect.width - 1, x0 + 1), wx = fx - x0
      const top = tone[y0 * rect.width + x0]! * (1 - wx) + tone[y0 * rect.width + x1]! * wx
      const bottom = tone[y1 * rect.width + x0]! * (1 - wx) + tone[y1 * rect.width + x1]! * wx
      let value = Math.round(top * (1 - wy) + bottom * wy)
      if (threshold != null) value = value < threshold ? 0 : 255
      const target = ((y + pad) * width + x + pad) * 4
      data[target] = value
      data[target + 1] = value
      data[target + 2] = value
    }
  }
  return { width, height, data }
}

/**
 * The tooltip prepared a few ways for OCR, the likeliest first: the contrast is set from the box's own background
 * and text brightness (the game draws the box semi-transparent, so it is lighter over a bright item picture).
 */
export function ocrVariants(image: Bitmap, rect: Rect, cursor?: { x: number; y: number }, unit = 1): Bitmap[] {
  // Brightness of just the box (the capture around it can be large).
  const box = { width: rect.width + 2, height: rect.height + 2, data: new Uint8Array((rect.width + 2) * (rect.height + 2) * 4) }
  for (let row = 0; row < box.height; row += 1) {
    const sy = Math.min(image.height - 1, Math.max(0, rect.y - 1 + row))
    const from = (sy * image.width + Math.max(0, rect.x - 1)) * 4
    box.data.set(image.data.subarray(from, Math.min(from + box.width * 4, (sy + 1) * image.width * 4)), row * box.width * 4)
  }
  const { light } = luminanceMap(box)
  const mask = cursor ? { x: cursor.x - 2, y: cursor.y - 2, width: Math.round(CURSOR_BOX.width * unit) + 4, height: Math.round(CURSOR_BOX.height * unit) + 4 } : { x: -99, y: -99, width: 0, height: 0 }
  const local = { x: 1, y: 1, width: rect.width, height: rect.height }
  const layout = readTextLayout(light, box.width, local, { ...mask, x: mask.x - rect.x + 1, y: mask.y - rect.y + 1 }, unit)
  const shifted = layout ? { ...layout, x0: layout.x0 + rect.x - 1, x1: layout.x1 + rect.x - 1, y0: layout.y0 + rect.y - 1, y1: layout.y1 + rect.y - 1 } : null
  const background = layout?.background ?? 20
  const peak = Math.max(background + 70, layout?.peak ?? 200)
  const contrast = peak - background
  // Measured on the game's font: text scaled to ~4× its 1080p size and cut to black and white reads best.
  const scale = Math.max(2, Math.min(5, Math.round(4 / unit)))
  const crop = shifted ? trim(rect, shifted, Math.round(4 * unit)) : rect
  return [
    tooltipForOcr(image, crop, scale, background + 12, Math.round(contrast * 0.85), { mask, threshold: 150 }),
    tooltipForOcr(image, crop, scale + 1, background + 8, contrast, { mask }),
    tooltipForOcr(image, crop, Math.max(2, scale - 1), background + Math.round(contrast * 0.25), Math.round(contrast * 0.6), { mask, threshold: 120 }),
  ]
}

/** The text line with a little room around it (frame remnants and the empty padding only confuse the OCR). */
function trim(rect: Rect, layout: TextLayout, room: number): Rect {
  const x = Math.max(rect.x, layout.x0 - room), y = Math.max(rect.y, layout.y0 - room)
  const right = Math.min(rect.x + rect.width - 1, layout.x1 + room), bottom = Math.min(rect.y + rect.height - 1, layout.y1 + room)
  return { x, y, width: right - x + 1, height: bottom - y + 1 }
}
