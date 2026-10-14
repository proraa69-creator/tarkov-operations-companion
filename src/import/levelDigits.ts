/**
 * The character level's digits read from their shapes, not by OCR (player's report, 14.10.2026: «в PVE … 39 у моего ЧВК,
 * в приложении отображается 59»). The game writes the level in its own font (Bender): Tesseract reads its flat-topped «3»
 * as a «5» about every other time and its slashed «0» as an «8» or a «2», at any scale or contrast. The whole-screen pass
 * and the close-up look at the same pixels, so they often agree on such a misreading, and two frames of a screen that
 * does not move are the same pixels too. The shapes tell these digits apart: a «3» has its upper stroke on the right and
 * a «5» on the left; an «8» has a bar across its middle where a «0» has only its slash.
 *
 * Like the loyalty badges (traderLoyalty.ts): a few hundred pixels a digit, and null whenever a glyph is not a clear digit
 * (too small, touching its neighbour, a shape between two digits) — never a guess.
 */

/** Grey pixels (0–255), row by row. */
export interface GrayPicture { width: number; height: number; gray: ArrayLike<number> }
export interface PixelBox { x0: number; y0: number; x1: number; y1: number }

/** Grey pixels of a BGRA (Electron's `toBitmap`) or RGBA bitmap: the mean of the three colour channels. */
export function grayPicture(bitmap: ArrayLike<number>, width: number, height: number): GrayPicture {
  const gray = new Uint8Array(width * height)
  for (let index = 0; index < gray.length; index += 1) gray[index] = Math.round((bitmap[index * 4]! + bitmap[index * 4 + 1]! + bitmap[index * 4 + 2]!) / 3)
  return { width, height, gray }
}

/** The threshold that best splits the values in two groups (Otsu). */
function otsu(histogram: number[], total: number) {
  let sum = 0
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value]!
  let below = 0, belowSum = 0, best = -1, threshold = 128
  for (let value = 0; value < 256; value += 1) {
    below += histogram[value]!
    if (!below) continue
    const above = total - below
    if (!above) break
    belowSum += value * histogram[value]!
    const spread = below * above * (belowSum / below - (sum - belowSum) / above) ** 2
    if (spread > best) { best = spread; threshold = value }
  }
  return threshold
}

/** Runs of `true`: [start, end] pairs. */
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

/** Ink of one glyph: `width` × `height`, true where the glyph is. */
export interface GlyphMask { width: number; height: number; ink: (x: number, y: number) => boolean }

/** Where a band of the glyph has its strokes: left, right, both sides, none; null when it is not clear. */
type Side = 'left' | 'right' | 'both' | 'none'
function side(left: number, right: number): Side | null {
  const high = Math.max(left, right), low = Math.min(left, right)
  if (high < 0.22) return 'none'
  if (low <= high * 0.45 && high - low >= 0.15) return left > right ? 'left' : 'right'
  if (low >= high * 0.65 && high >= 0.2) return 'both'
  return null
}

/** An enclosed background area: its centre as fractions of the glyph's width and height. */
interface Hole { x: number; y: number }

/** Enclosed background areas of the glyph (the inside of «0», «4», «6», «8», «9»), small specks left out. */
function holes(mask: GlyphMask): Hole[] {
  const { width, height } = mask
  // One pixel of background around the glyph, so that the outside is one area.
  const w = width + 2, h = height + 2
  const seen = new Uint8Array(w * h)
  const background = (x: number, y: number) => x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1 || !mask.ink(x - 1, y - 1)
  const fill = (start: number) => {
    const stack = [start]
    seen[start] = 1
    let area = 0, sumX = 0, sumY = 0
    while (stack.length) {
      const at = stack.pop()!
      const x = at % w, y = (at - x) / w
      area += 1; sumX += x - 1; sumY += y - 1
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const next = ny * w + nx
        if (seen[next] || !background(nx, ny)) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    return { area, x: (sumX / area + 0.5) / width, y: (sumY / area + 0.5) / height }
  }
  fill(0)
  const minimum = Math.max(2, width * height * 0.006)
  const found: Hole[] = []
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const at = y * w + x
    if (seen[at] || !background(x, y)) continue
    const hole = fill(at)
    if (hole.area >= minimum) found.push({ x: hole.x, y: hole.y })
  }
  return found
}

/** Share of ink pixels in a part of the glyph (fractions of its width and height). */
function coverage(mask: GlyphMask, fromRow: number, toRow: number, fromColumn: number, toColumn: number) {
  let ink = 0, all = 0
  for (let y = Math.floor(fromRow * mask.height); y < Math.ceil(toRow * mask.height); y += 1) {
    for (let x = Math.floor(fromColumn * mask.width); x < Math.ceil(toColumn * mask.width); x += 1) {
      all += 1
      if (mask.ink(x, y)) ink += 1
    }
  }
  return all ? ink / all : 0
}

/** The longest stroke across a row of the band, as a share of the glyph's width (the bar of «8», never the slash of «0»). */
function longestAcross(mask: GlyphMask, fromRow: number, toRow: number) {
  let longest = 0
  for (let y = Math.floor(fromRow * mask.height); y < Math.ceil(toRow * mask.height); y += 1) {
    const row = runs(Array.from({ length: mask.width }, (_, x) => mask.ink(x, y)))
    for (const [start, end] of row) longest = Math.max(longest, end - start + 1)
  }
  return longest / mask.width
}

/**
 * The digit a glyph shows (its ink cut tight around it), or null when it is not a clear digit. Each digit of the game's
 * font has its own strokes in the upper and the lower half (left, right or both sides) and its own enclosed areas: «8»
 * has two stacked one above the other, the slashed «0» two side by side along its slash; «2» stands on a bar, «7» on a
 * point.
 */
export function classifyDigit(mask: GlyphMask): number | null {
  const { width, height } = mask
  if (height < 9 || width < 2) return null
  const aspect = width / height
  const enclosed = holes(mask)
  if (aspect < 0.53) {
    // «1»: narrow (its flag and foot), nothing enclosed; a bare bar («|», «l») is narrower still. Any other digit is about
    // three quarters as wide as tall.
    return aspect >= 0.3 && enclosed.length === 0 ? 1 : null
  }
  if (aspect < 0.57 || aspect > 1) return null
  const upperLeft = coverage(mask, 0.15, 0.42, 0, 0.34), upperRight = coverage(mask, 0.15, 0.42, 0.66, 1)
  const lowerLeft = coverage(mask, 0.58, 0.85, 0, 0.34), lowerRight = coverage(mask, 0.58, 0.85, 0.66, 1)
  if (enclosed.length === 2) {
    // «0» and «8»: strokes on both sides all the way down, two enclosed areas.
    if (Math.min(upperLeft, upperRight, lowerLeft, lowerRight) < 0.25) return null
    const [upper, lower] = [...enclosed].sort((a, b) => a.y - b.y) as [Hole, Hole]
    const across = lower.x - upper.x, down = lower.y - upper.y
    // «8»: one area above the other, a bar between them.
    if (Math.abs(across) <= 0.12 && down >= 0.3 && longestAcross(mask, 0.38, 0.62) >= 0.6) return 8
    // The slashed «0»: its slash (top right to bottom left) leaves one area upper left and one lower right.
    if (across >= 0.2 && down >= 0.15) return 0
    return null
  }
  const upper = side(upperLeft, upperRight)
  const lower = side(lowerLeft, lowerRight)
  if (!upper || !lower) return null
  const base = longestAcross(mask, 0.85, 1)
  const hole = enclosed[0]
  switch (`${upper}/${lower}/${enclosed.length}`) {
    case 'right/left/0': return base >= 0.7 ? 2 : null
    case 'right/right/0': return 3
    case 'right/both/1': return 4
    case 'left/right/0': return 5
    case 'left/both/1': return hole!.y > 0.5 ? 6 : null
    case 'right/none/0': return base <= 0.5 ? 7 : null
    case 'both/right/1': return hole!.y < 0.5 ? 9 : null
    default: return null
  }
}

/**
 * The number the glyphs at the end of `box` show (the level after «|» or after «LVL»), read from their shapes, when it
 * has `count` digits; null when it cannot be read: too little contrast, another count of digits, glyphs touching or of
 * different heights, a shape that is no clear digit.
 */
export function readDigitShapes(picture: GrayPicture, box: PixelBox, count: number): number | null {
  if (count < 1) return null
  const boxHeight = box.y1 - box.y0 + 1
  // A little room around the word: Tesseract's box hugs the ink.
  const x0 = Math.max(0, Math.floor(box.x0 - 2 - boxHeight * 0.06)), x1 = Math.min(picture.width - 1, Math.ceil(box.x1 + 2 + boxHeight * 0.06))
  const y0 = Math.max(0, Math.floor(box.y0 - 2 - boxHeight * 0.2)), y1 = Math.min(picture.height - 1, Math.ceil(box.y1 + 2 + boxHeight * 0.2))
  const width = x1 - x0 + 1, height = y1 - y0 + 1
  if (width < 4 || height < 9) return null
  const at = (x: number, y: number) => picture.gray[(y0 + y) * picture.width + x0 + x]!
  const histogram = new Array<number>(256).fill(0)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) histogram[at(x, y)]! += 1
  const threshold = otsu(histogram, width * height)
  // The text is the side of the threshold the border is not on (light digits on the game's dark panels, or the other way).
  let borderAbove = 0, border = 0
  for (let x = 0; x < width; x += 1) for (const y of [0, height - 1]) { border += 1; if (at(x, y) > threshold) borderAbove += 1 }
  for (let y = 0; y < height; y += 1) for (const x of [0, width - 1]) { border += 1; if (at(x, y) > threshold) borderAbove += 1 }
  const lightText = borderAbove < border / 2
  let inkSum = 0, inkCount = 0, groundSum = 0, groundCount = 0
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = at(x, y)
    if ((value > threshold) === lightText) { inkSum += value; inkCount += 1 } else { groundSum += value; groundCount += 1 }
  }
  if (!inkCount || !groundCount || Math.abs(inkSum / inkCount - groundSum / groundCount) < 40) return null
  const label = new Int32Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if ((at(x, y) > threshold) !== lightText) label[y * width + x] = -1
  // Glyphs: the connected parts of the ink (the game's digits are one stroke each and may stand closer than a column
  // apart, «47»); specks of a few pixels are not glyphs.
  const glyphs: Array<{ id: number; x0: number; x1: number; y0: number; y1: number; pixels: number }> = []
  for (let start = 0; start < label.length; start += 1) {
    if (label[start] !== 0) continue
    const id = glyphs.length + 1
    const glyph = { id, x0: width, x1: -1, y0: height, y1: -1, pixels: 0 }
    const stack = [start]
    label[start] = id
    while (stack.length) {
      const index = stack.pop()!
      const x = index % width, y = (index - x) / width
      glyph.pixels += 1
      glyph.x0 = Math.min(glyph.x0, x); glyph.x1 = Math.max(glyph.x1, x); glyph.y0 = Math.min(glyph.y0, y); glyph.y1 = Math.max(glyph.y1, y)
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (label[next] !== 0) continue
        label[next] = id
        stack.push(next)
      }
    }
    glyphs.push(glyph)
  }
  const tall = glyphs.filter((glyph) => glyph.y1 - glyph.y0 + 1 >= height * 0.3 && glyph.pixels >= 6).sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1))
  if (!tall.length) return null
  // The number: the last glyph and the ones right before it. The game's digits stand a tenth of their height apart, a
  // word space («LVL 12», «| 41») about half of it. A close neighbour of another height is a broken glyph: no reading.
  const digits = [tall.at(-1)!]
  const digitHeight = digits[0]!.y1 - digits[0]!.y0 + 1
  for (let index = tall.length - 2; index >= 0; index -= 1) {
    const glyph = tall[index]!, next = digits[0]!
    if (next.x0 - glyph.x1 - 1 > digitHeight * 0.3) break
    const glyphHeight = glyph.y1 - glyph.y0 + 1
    if (glyphHeight < digitHeight * 0.8 || glyphHeight > digitHeight * 1.25 || Math.abs(glyph.y0 - next.y0) > digitHeight * 0.2) return null
    // Parts of one broken glyph overlap far more than two digits of the game's font («47»).
    if (glyph.x1 - next.x0 + 1 > Math.min(glyph.x1 - glyph.x0 + 1, next.x1 - next.x0 + 1) * 0.3) return null
    digits.unshift(glyph)
  }
  // As many digits as the OCR reading has, or that reading is not this number («7» read for «37»).
  if (digits.length !== count) return null
  let value = 0
  for (const glyph of digits) {
    const glyphWidth = glyph.x1 - glyph.x0 + 1, glyphHeight = glyph.y1 - glyph.y0 + 1
    // Two digits run together are wider than tall.
    if (glyphWidth > glyphHeight) return null
    const digit = classifyDigit({ width: glyphWidth, height: glyphHeight, ink: (x, y) => label[(glyph.y0 + y) * width + glyph.x0 + x] === glyph.id })
    if (digit === null) return null
    value = value * 10 + digit
  }
  return value
}

/**
 * The shapes' number for each count of digits among the OCR readings `levels` (they may disagree on it, «3» and «35»):
 * the input of confirmCards / confirmTraderLevel (src/import/modeSelectScreen.ts).
 */
export function readLevelShapes(picture: GrayPicture, box: PixelBox, levels: Array<number | null | undefined>) {
  const result: Partial<Record<number, number | null>> = {}
  for (const level of levels) {
    if (typeof level !== 'number') continue
    const count = String(level).length
    if (!(count in result)) result[count] = readDigitShapes(picture, box, count)
  }
  return result
}
