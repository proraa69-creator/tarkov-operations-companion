/**
 * Finds the game's own item-name tooltip in a screen grab around the cursor. EFT shows it after a short
 * hover: a near-black box with a thin light-grey frame and one line of light text (the full item name).
 * Reading only that box gives the exact name — neighbouring cell labels never get in the way.
 */
export interface Bitmap { width: number; height: number; /** 4 bytes per pixel, BGRA (Windows / Electron order). */ data: Uint8Array }
export interface Rect { x: number; y: number; width: number; height: number }

/** Frame pixels: a light, grey (unsaturated) line. */
const FRAME_MIN = 62
const FRAME_MAX = 235
const GREY_SPREAD = 28
/** Inside the box: dark background, some bright text. */
const INSIDE_MAX_MEAN = 70
const TEXT_MIN = 110
/** The box background right inside the frame. */
const INSIDE_DARK = 48

function luminance(data: Uint8Array, index: number) {
  return (data[index + 2]! * 54 + data[index + 1]! * 183 + data[index]! * 19) >> 8
}

function isFrame(data: Uint8Array, index: number) {
  const b = data[index]!, g = data[index + 1]!, r = data[index + 2]!
  const light = luminance(data, index)
  return light >= FRAME_MIN && light <= FRAME_MAX && Math.max(r, g, b) - Math.min(r, g, b) <= GREY_SPREAD
}

interface Run { y: number; x0: number; x1: number }

/**
 * The tooltip box nearest to the cursor (inside the frame, in image pixels), or null.
 * `unit` is the size of one 1080p pixel in the image (screen height / 1080).
 */
export function findTooltip(image: Bitmap, cursor: { x: number; y: number }, unit = 1): Rect | null {
  const { width, height, data } = image
  const minWidth = Math.round(44 * unit)
  const minHeight = Math.round(18 * unit)
  const maxHeight = Math.round(90 * unit)
  // Horizontal frame edges: long runs of frame pixels on one row with the dark inside of the box right
  // below (top edge) or right above (bottom edge) — other light lines on screen do not qualify.
  const inset = Math.max(2, Math.round(2 * unit))
  const edgeRuns = (inside: number) => {
    const runs: Run[] = []
    for (let y = 0; y < height; y += 1) {
      const insideY = y + inside
      if (insideY < 0 || insideY >= height) continue
      let start = -1
      for (let x = 0; x <= width; x += 1) {
        const edge = x < width && isFrame(data, (y * width + x) * 4) && luminance(data, (insideY * width + x) * 4) <= INSIDE_DARK
        if (edge && start < 0) start = x
        else if (!edge && start >= 0) {
          if (x - start >= minWidth) runs.push({ y, x0: start, x1: x - 1 })
          start = -1
        }
      }
    }
    return runs
  }
  const tops = edgeRuns(inset)
  const bottoms = edgeRuns(-inset)
  if (!tops.length || !bottoms.length) return null
  const tolerance = Math.max(3, Math.round(3 * unit))
  let best: { rect: Rect; score: number } | null = null
  for (const top of tops) {
    for (const bottom of bottoms) {
      const gap = bottom.y - top.y
      if (gap < minHeight || gap > maxHeight) continue
      // The edges may run on into other lines of the UI (a grid line touching the box): pair by overlap and
      // find the box's own sides inside it.
      const overlap0 = Math.max(top.x0, bottom.x0)
      const overlap1 = Math.min(top.x1, bottom.x1)
      if (overlap1 - overlap0 < minWidth || overlap1 - overlap0 < 0.8 * Math.min(top.x1 - top.x0, bottom.x1 - bottom.x0)) continue
      const x0 = findSide(image, overlap0, top.y, bottom.y, tolerance)
      const x1 = findSide(image, overlap1, top.y, bottom.y, tolerance)
      if (x0 == null || x1 == null || x1 - x0 < minWidth) continue
      const inner = { x: x0 + 2, y: top.y + 2, width: x1 - x0 - 3, height: gap - 3 }
      if (inner.width < minWidth / 2 || inner.height < minHeight / 2 || !looksLikeText(image, inner)) continue
      // Nearest to the cursor wins (the tooltip hugs it); boxes far away are other panels.
      const dx = Math.max(0, x0 - cursor.x, cursor.x - x1)
      const dy = Math.max(0, top.y - cursor.y, cursor.y - bottom.y)
      const score = Math.hypot(dx, dy * 1.5)
      if (!best || score < best.score) best = { rect: inner, score }
    }
  }
  return best && best.score <= 260 * unit ? best.rect : null
}

/** The frame column nearest to x (searching a few pixels both ways) along the box height, or null. */
function findSide(image: Bitmap, x: number, y0: number, y1: number, tolerance: number) {
  const radius = tolerance * 3 + 4
  for (let offset = 0; offset <= radius; offset += 1) {
    for (const column of offset ? [x - offset, x + offset] : [x]) {
      if (column >= 0 && column < image.width && sideIsFrame(image, column, y0, y1, 0)) return column
    }
  }
  return null
}

/** A vertical frame edge at column x (±tolerance) along most of the box height. */
function sideIsFrame(image: Bitmap, x: number, y0: number, y1: number, tolerance: number) {
  let hits = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let dx = -tolerance; dx <= tolerance; dx += 1) {
      const column = x + dx
      if (column >= 0 && column < image.width && isFrame(image.data, (y * image.width + column) * 4)) { hits += 1; break }
    }
  }
  return hits >= (y1 - y0 + 1) * 0.8
}

/** Dark background with a band of bright text pixels — not an empty grid cell or an item picture. */
function looksLikeText(image: Bitmap, rect: Rect) {
  let sum = 0
  let bright = 0
  let count = 0
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const light = luminance(image.data, (y * image.width + x) * 4)
      sum += light
      if (light >= TEXT_MIN) bright += 1
      count += 1
    }
  }
  if (!count) return false
  const share = bright / count
  return sum / count <= INSIDE_MAX_MEAN && share >= 0.002 && share <= 0.4
}

/**
 * The tooltip text as black on white, upscaled — what the OCR reads best. Returns BGRA pixels.
 */
export function tooltipForOcr(image: Bitmap, rect: Rect, scale = 3): Bitmap {
  const width = rect.width * scale
  const height = rect.height * scale
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sy = rect.y + Math.floor(y / scale)
    for (let x = 0; x < width; x += 1) {
      const sx = rect.x + Math.floor(x / scale)
      const light = luminance(image.data, (sy * image.width + sx) * 4)
      // Stretch: the dark background goes white, the light text black.
      const value = 255 - Math.max(0, Math.min(255, Math.round((light - 45) * 255 / 150)))
      const index = (y * width + x) * 4
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
      data[index + 3] = 255
    }
  }
  return { width, height, data }
}
