/**
 * The flea market's prices read from the shapes of their digits, never by OCR (docs/flea-prices-from-players.md). The
 * owner's flea screenshots of 18.11.2026: Tesseract read at best 22 of 36 prices right, mistaking 0 for 8 and 3 for 4
 * («11 000» → «11 200»: a price close enough to pass any plausibility check). The game draws the prices in one font at one
 * size, so each digit is compared with samples of the same digit cut from the owner's frames (fleaDigitShapes.ts, made by
 * scripts/build-flea-digits.mjs): 72 of 72 right frame by frame on PvE, 141 of 155 PvP and Season rows read sure and all
 * 141 right, the rest flagged unsure. A digit not clearly one of the samples makes the whole price unsure — never a guess.
 *
 * Pure and without imports: the build script loads this file as it is (Node strips the types).
 */

/** Pixels of a screen copy: Electron's GDI copies are BGRA, decoded test frames RGB. */
export interface FleaPixels {
  width: number
  height: number
  data: ArrayLike<number>
  /** Bytes a pixel: 4 (BGRA / RGBA) or 3 (RGB / BGR). */
  channels: 3 | 4
  /** Blue first (Windows' BGRA). */
  bgr: boolean
}

/** Where the game's 16:9 menus lie on the screen and one 1080p pixel there (see storyPaneLayout.ts gameUiBox). */
export interface FleaLayout {
  left: number
  top: number
  unit: number
  /**
   * A row's height in 1080p units when it is not FLEA_LIST.rowHeight: a Japanese or Korean game's taller lines make each
   * row taller (fleaScreen.ts fleaLayout).
   */
  rowHeight?: number
}

/** The flea's list at 1080p: the first offer row's top, a row's height, and where the price column is. */
export const FLEA_LIST = {
  firstRowTop: 144,
  rowHeight: 72,
  /** Rows end above the menu bar at the bottom. */
  bottom: 1020,
  price: { left: 1335, right: 1500, top: 10, bottom: 46 },
}

/** A digit sample's size: every glyph is resampled to this before comparing. */
export const GLYPH_WIDTH = 10
export const GLYPH_HEIGHT = 16

/** Brighter than this is ink of a price (light grey on the dark row; dim «ЗАКРЫТО» rows stay below). */
const INK = 120
/** A digit is 8–14 px wide at 1080p; two touching ones (a «1» beside a «4») make one run up to ~32. */
const DIGIT_MAX_WIDTH = 16
const PAIR_MAX_WIDTH = 32
/** A digit is sure when its nearest sample is this close and the nearest of another digit clearly farther. */
export const SURE_DISTANCE = 0.11
export const SURE_MARGIN = 0.03

export function luminance(pixels: FleaPixels, x: number, y: number) {
  const index = (y * pixels.width + x) * pixels.channels
  const [r, b] = pixels.bgr ? [pixels.data[index + 2]!, pixels.data[index]!] : [pixels.data[index]!, pixels.data[index + 2]!]
  return (r * 54 + pixels.data[index + 1]! * 183 + b * 19) >> 8
}

export function colourAt(pixels: FleaPixels, x: number, y: number): [number, number, number] {
  const index = (y * pixels.width + x) * pixels.channels
  return pixels.bgr ? [pixels.data[index + 2]!, pixels.data[index + 1]!, pixels.data[index]!] : [pixels.data[index]!, pixels.data[index + 1]!, pixels.data[index + 2]!]
}

/** A 1080p point of the menus in screen pixels. */
export const screenPoint = (layout: FleaLayout, x: number, y: number) => [Math.round(layout.left + x * layout.unit), Math.round(layout.top + y * layout.unit)] as const

/** A row's top (0 = first offer) in the menus' 1080p units. */
export const fleaRowTop = (layout: FleaLayout, row: number) => FLEA_LIST.firstRowTop + row * (layout.rowHeight ?? FLEA_LIST.rowHeight)

/** The price band of a row (0 = first offer) in screen pixels. */
export function priceBand(layout: FleaLayout, row: number) {
  const top = fleaRowTop(layout, row)
  const [x0, y0] = screenPoint(layout, FLEA_LIST.price.left, top + FLEA_LIST.price.top)
  const [x1, y1] = screenPoint(layout, FLEA_LIST.price.right, top + FLEA_LIST.price.bottom)
  return { x0, y0, x1, y1 }
}

export interface PriceGlyph {
  x0: number
  x1: number
  y0: number
  y1: number
  /** GLYPH_WIDTH × GLYPH_HEIGHT, 0 (background) … 1 (ink). */
  picture: Float32Array
  /** Mean colour of its ink: the currency sign is white (₽), green ($), blue (€) or gold (GP). */
  colour: [number, number, number]
}

/**
 * The glyphs of a price band left to right — digits, then the currency sign. Runs of columns holding ink, a run as wide
 * as two digits cut at its thinnest column (the last run, the sign, never).
 */
export function priceGlyphs(pixels: FleaPixels, band: { x0: number; y0: number; x1: number; y1: number }, unit: number): PriceGlyph[] {
  const lit = (x: number, y: number) => luminance(pixels, x, y) > INK
  const columns: boolean[] = []
  for (let x = band.x0; x <= band.x1; x += 1) {
    let any = false
    for (let y = band.y0; y < band.y1 && !any; y += 1) any = lit(x, y)
    columns.push(any)
  }
  const runs: Array<[number, number]> = []
  let start = -1
  columns.forEach((any, index) => {
    if (any && start < 0) start = index
    if (!any && start >= 0) { runs.push([band.x0 + start, band.x0 + index - 1]); start = -1 }
  })
  if (start >= 0) runs.push([band.x0 + start, band.x1])
  const cut: Array<[number, number]> = []
  runs.forEach(([x0, x1], index) => {
    const width = x1 - x0 + 1
    if (index === runs.length - 1 || width <= DIGIT_MAX_WIDTH * unit || width > PAIR_MAX_WIDTH * unit) { cut.push([x0, x1]); return }
    let best = x0, least = Infinity
    for (let x = x0 + Math.round(4 * unit); x <= x1 - Math.round(4 * unit); x += 1) {
      let ink = 0
      for (let y = band.y0; y < band.y1; y += 1) if (lit(x, y)) ink += 1
      if (ink < least) { least = ink; best = x }
    }
    cut.push([x0, best - 1], [best + 1, x1])
  })
  return cut.map(([x0, x1]) => {
    let y0 = band.y1, y1 = band.y0, red = 0, green = 0, blue = 0, count = 0
    for (let x = x0; x <= x1; x += 1) {
      for (let y = band.y0; y < band.y1; y += 1) {
        if (!lit(x, y)) continue
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
        const [r, g, b] = colourAt(pixels, x, y)
        red += r; green += g; blue += b; count += 1
      }
    }
    return { x0, x1, y0, y1, picture: glyphPicture(pixels, x0, x1, y0, y1), colour: [red / count, green / count, blue / count].map(Math.round) as [number, number, number] }
  })
}

/** The glyph's box resampled (area mean) to GLYPH_WIDTH × GLYPH_HEIGHT, brightness 50…200 → 0…1. */
function glyphPicture(pixels: FleaPixels, x0: number, x1: number, y0: number, y1: number) {
  const picture = new Float32Array(GLYPH_WIDTH * GLYPH_HEIGHT)
  const width = x1 - x0 + 1, height = y1 - y0 + 1
  for (let gy = 0; gy < GLYPH_HEIGHT; gy += 1) {
    for (let gx = 0; gx < GLYPH_WIDTH; gx += 1) {
      const sx0 = x0 + gx * width / GLYPH_WIDTH, sx1 = x0 + (gx + 1) * width / GLYPH_WIDTH
      const sy0 = y0 + gy * height / GLYPH_HEIGHT, sy1 = y0 + (gy + 1) * height / GLYPH_HEIGHT
      let sum = 0, count = 0
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y += 1) {
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x += 1) {
          sum += Math.min(1, Math.max(0, (luminance(pixels, x, y) - 50) / 150))
          count += 1
        }
      }
      picture[gy * GLYPH_WIDTH + gx] = count ? sum / count : 0
    }
  }
  return picture
}

export type FleaCurrency = '₽' | '$' | '€' | 'GP'

/** The currency by its sign's colour (the owner's frames: ₽ light grey, $ green, € violet-blue, GP gold). */
export function currencyOf([r, g, b]: [number, number, number]): FleaCurrency {
  if (g > r + 25 && g > b + 15) return '$'
  if (b > r + 25 && b > g + 10) return '€'
  if (r > b + 40 && g > b + 25) return 'GP'
  return '₽'
}

export interface DigitSample { digit: number; picture: Float32Array }

export const glyphDistance = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let sum = 0
  for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index]! - b[index]!)
  return sum / a.length
}

/** A sample this close to one kept already adds nothing. */
const SAME_SAMPLE = 0.02
/** Samples kept a digit at most. */
const SAMPLES_PER_DIGIT = 16

/** The samples as text: «digit:» and 160 hex levels (0–f) per sample, «;» between; near-duplicates left out. */
export function encodeDigitShapes(samples: DigitSample[]): string {
  const kept: DigitSample[] = []
  for (const sample of samples) {
    const quantised = Float32Array.from(sample.picture, (value) => Math.round(value * 15) / 15)
    const same = kept.filter((other) => other.digit === sample.digit)
    if (same.length >= SAMPLES_PER_DIGIT || same.some((other) => glyphDistance(other.picture, quantised) < SAME_SAMPLE)) continue
    kept.push({ digit: sample.digit, picture: quantised })
  }
  kept.sort((a, b) => a.digit - b.digit)
  return kept.map((sample) => `${sample.digit}:${Array.from(sample.picture, (value) => Math.round(value * 15).toString(16)).join('')}`).join(';')
}

export function decodeDigitShapes(text: string): DigitSample[] {
  return text.split(';').filter(Boolean).map((entry) => {
    const [digit, levels] = entry.split(':')
    return { digit: Number(digit), picture: Float32Array.from(levels!, (char) => parseInt(char, 16) / 15) }
  })
}

export interface PriceDigits {
  digits: string
  /** Every digit's nearest sample is close and clearly nearer than any other digit's. */
  sure: boolean
  /** The farthest of the digits' nearest samples, and the smallest lead over another digit. */
  worst: number
  margin: number
}

/** The digits of a price's glyphs (the last glyph, the currency sign, left out). */
export function readDigits(glyphs: PriceGlyph[], samples: DigitSample[]): PriceDigits {
  let worst = 0, margin = Infinity
  const digits = glyphs.slice(0, -1).map((glyph) => {
    const nearest = new Array<number>(10).fill(Infinity)
    for (const sample of samples) nearest[sample.digit] = Math.min(nearest[sample.digit]!, glyphDistance(sample.picture, glyph.picture))
    const ranked = nearest.map((distance, digit) => ({ digit, distance })).sort((a, b) => a.distance - b.distance)
    worst = Math.max(worst, ranked[0]!.distance)
    margin = Math.min(margin, ranked[1]!.distance - ranked[0]!.distance)
    return ranked[0]!.digit
  })
  const sure = digits.length > 0 && worst <= SURE_DISTANCE && margin >= SURE_MARGIN
  return { digits: digits.join(''), sure, worst, margin: Number.isFinite(margin) ? margin : 0 }
}
