/**
 * The sticker editor's pure parts (src/admin/stickers/StickerEditor.tsx; owner, 07.11.2026: «я загружаю фотографию,
 * фотография должна обрезаться по размеру человечка, персонажа какого-то. И я могу делать надписи разных шрифтов,
 * стилей»): where the photo sits in the sticker, the cut-out mask and the brush that fixes it, and the text layers.
 * Nothing here touches the page or a canvas, so all of it is tested without a browser (stickerLayout.test.ts).
 *
 * Coordinates: the sticker is a STICKER_SIDE × STICKER_SIDE frame; the photo (the «source», downscaled to at most
 * SOURCE_MAX_SIDE) sits in it by a `View`: source pixel (sx, sy) is frame point (x + sx × scale, y + sy × scale). The mask
 * is one byte of opacity per source pixel (255: the person, 0: cut away).
 */
import { STICKER_LIMITS } from '../../shared/supportStickers'

export const STICKER_SIDE = STICKER_LIMITS.side
/** The photo is worked on at most this big on its longest side (segmentation, the brush, the sticker's pixels). */
export const SOURCE_MAX_SIDE = 1024
/** Room left around the person when the photo is fitted into the sticker. */
export const FIT_MARGIN = 24

export interface View { scale: number; x: number; y: number }
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** The size the photo is worked on: its own, or scaled down to SOURCE_MAX_SIDE on its longest side. */
export function sourceSize(width: number, height: number, max = SOURCE_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Frame point → source pixel. */
export const frameToSource = (view: View, point: Point): Point => ({ x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale })
/** Source pixel → frame point. */
export const sourceToFrame = (view: View, point: Point): Point => ({ x: view.x + point.x * view.scale, y: view.y + point.y * view.scale })

/**
 * The view that shows `bounds` of the source (the person; the whole photo when null) as large as fits the frame with
 * `margin` around it, centred.
 */
export function fitView(sourceWidth: number, sourceHeight: number, bounds: Rect | null, frame = STICKER_SIDE, margin = FIT_MARGIN): View {
  const box = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  const room = Math.max(1, frame - margin * 2)
  const scale = room / Math.max(box.width, box.height)
  return { scale, x: frame / 2 - (box.x + box.width / 2) * scale, y: frame / 2 - (box.y + box.height / 2) * scale }
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 8

/** The view zoomed by `factor` around the frame point `center` (it stays where it is), within MIN_SCALE..MAX_SCALE. */
export function zoomAround(view: View, factor: number, center: Point): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const applied = scale / view.scale
  return { scale, x: center.x - (center.x - view.x) * applied, y: center.y - (center.y - view.y) * applied }
}

/** The view moved by (dx, dy) frame points. */
export const panView = (view: View, dx: number, dy: number): View => ({ scale: view.scale, x: view.x + dx, y: view.y + dy })

/**
 * The cut-out from the segmenter's confidence (0–255 per pixel): fully the person above `high`, cut away below `low`,
 * a soft edge between (no stair-stepped outline).
 */
export function confidenceToMask(confidence: ArrayLike<number>, low = 90, high = 165): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(confidence.length)
  const span = Math.max(1, high - low)
  for (let index = 0; index < confidence.length; index += 1) {
    const value = confidence[index]!
    mask[index] = value <= low ? 0 : value >= high ? 255 : Math.round(((value - low) / span) * 255)
  }
  return mask
}

/** A mask that keeps the whole photo (no person found: the owner cuts by hand). */
export const fullMask = (width: number, height: number) => new Uint8ClampedArray(width * height).fill(255)

/** The part of the source the mask keeps (above `threshold`); null when it keeps nothing. */
export function maskBounds(mask: ArrayLike<number>, width: number, height: number, threshold = 128): Rect | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x]! < threshold) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** How much of the source the mask keeps (0..1): a person this small or nothing at all means «not found». */
export function maskCoverage(mask: ArrayLike<number>, threshold = 128) {
  if (!mask.length) return 0
  let kept = 0
  for (let index = 0; index < mask.length; index += 1) if (mask[index]! >= threshold) kept += 1
  return kept / mask.length
}

/** The segmenter found somebody: at least this share of the photo is the person. */
export const MIN_PERSON_COVERAGE = 0.01

export type BrushMode = 'erase' | 'restore'

/**
 * One dab of the brush at source point (cx, cy) with `radius` source pixels: «Стереть» lowers the opacity, «Вернуть»
 * raises it, fully inside 70 % of the radius and softly towards its edge. Changes `mask` in place; returns the changed
 * rectangle (null when the dab is outside the photo).
 */
export function stampBrush(mask: Uint8ClampedArray, width: number, height: number, cx: number, cy: number, radius: number, mode: BrushMode, hardness = 0.7): Rect | null {
  const r = Math.max(0.5, radius)
  const left = Math.max(0, Math.floor(cx - r))
  const right = Math.min(width - 1, Math.ceil(cx + r))
  const top = Math.max(0, Math.floor(cy - r))
  const bottom = Math.min(height - 1, Math.ceil(cy + r))
  if (left > right || top > bottom) return null
  const inner = r * Math.min(1, Math.max(0, hardness))
  const soft = Math.max(0.0001, r - inner)
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (distance > r) continue
      const strength = distance <= inner ? 1 : 1 - (distance - inner) / soft
      const index = y * width + x
      const current = mask[index]!
      mask[index] = mode === 'erase' ? Math.min(current, Math.round(255 * (1 - strength))) : Math.max(current, Math.round(255 * strength))
    }
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** The smallest rectangle around both (either may be null). */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** The brush drawn from `from` to `to` (source points): dabs a third of the radius apart, so the line has no gaps. */
export function strokeBrush(mask: Uint8ClampedArray, width: number, height: number, from: Point, to: Point, radius: number, mode: BrushMode): Rect | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(length / Math.max(0.5, radius / 3)))
  let changed: Rect | null = null
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps
    changed = unionRect(changed, stampBrush(mask, width, height, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, mode))
  }
  return changed
}

/** The fonts of the words (src/admin/stickers/stickerFonts.ts bundles them; SIL Open Font License, with Cyrillic). */
export interface StickerFont { id: string; name: string; family: string; weight: number; lineHeight: number }
export const STICKER_FONTS: readonly StickerFont[] = [
  { id: 'oswald', name: 'Oswald', family: 'Raid Sticker Oswald', weight: 700, lineHeight: 1.12 },
  { id: 'montserrat', name: 'Montserrat', family: 'Raid Sticker Montserrat', weight: 900, lineHeight: 1.1 },
  { id: 'rubik-mono', name: 'Rubik Mono', family: 'Raid Sticker Rubik Mono One', weight: 400, lineHeight: 1.1 },
  { id: 'pacifico', name: 'Pacifico', family: 'Raid Sticker Pacifico', weight: 400, lineHeight: 1.35 },
  { id: 'pixel', name: 'Pixelify', family: 'Raid Sticker Pixelify Sans', weight: 700, lineHeight: 1.15 },
]
export const stickerFont = (id: string) => STICKER_FONTS.find((font) => font.id === id) ?? STICKER_FONTS[0]!

/** The canvas font of a font at `size` pixels, with a fallback that has Cyrillic too. */
export function fontCss(id: string, size: number) {
  const font = stickerFont(id)
  return `${font.weight} ${Math.round(size)}px "${font.family}", "Arial Black", Arial, sans-serif`
}

export type TextPlace = 'top' | 'bottom' | 'free'

/** A line of words over the sticker: its font, size (frame pixels), colours, outline, shadow and where it stands. */
export interface TextLayer {
  id: number
  text: string
  font: string
  size: number
  color: string
  stroke: string
  /** The outline's width in frame pixels (0: none). */
  strokeWidth: number
  shadow: boolean
  place: TextPlace
  /** The centre of the words, for 'free' (frame points). */
  x: number
  y: number
}

export const TEXT_SIZE = { min: 20, max: 140, initial: 64 } as const
export const STROKE_MAX = 16
/** The words keep this far from the sticker's edge. */
export const TEXT_MARGIN = 14
export const TEXT_MAX_CHARS = 80

let nextLayer = 1
/** A new line of words: white with a black outline, at the top first and then at the bottom. */
export function newTextLayer(existing: readonly TextLayer[], text = 'Текст'): TextLayer {
  const place: TextPlace = existing.some((layer) => layer.place === 'top') ? 'bottom' : 'top'
  return {
    id: nextLayer++, text, font: STICKER_FONTS[0]!.id, size: TEXT_SIZE.initial, color: '#ffffff', stroke: '#000000', strokeWidth: 6, shadow: true,
    place, x: STICKER_SIDE / 2, y: STICKER_SIDE / 2,
  }
}

/** A colour of the colour inputs (#rrggbb); anything else becomes `fallback`. */
export const cleanColor = (value: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback)

/**
 * The words broken into lines that fit `maxWidth` (by `measure`, the canvas's measureText): the owner's own line breaks
 * kept, a word longer than a line broken by characters.
 */
export function wrapText(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) { lines.push(''); continue }
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (measure(next) <= maxWidth) { line = next; continue }
      if (line) lines.push(line)
      // A word wider than the line: as many characters as fit, then the rest.
      let rest = word
      while (measure(rest) > maxWidth && rest.length > 1) {
        const chars = Array.from(rest)
        let cut = chars.length - 1
        while (cut > 1 && measure(chars.slice(0, cut).join('')) > maxWidth) cut -= 1
        lines.push(chars.slice(0, cut).join(''))
        rest = chars.slice(cut).join('')
      }
      line = rest
    }
    lines.push(line)
  }
  // No empty lines at the ends.
  while (lines.length > 1 && !lines[0]) lines.shift()
  while (lines.length > 1 && !lines.at(-1)) lines.pop()
  return lines
}

/** Where a text layer's lines are drawn: the centre line of each (x) and its middle (y), and the box around them all. */
export interface TextLayout { lines: string[]; x: number; ys: number[]; lineHeight: number; box: Rect }

/** Lays a text layer out in the frame: at the top or the bottom with TEXT_MARGIN, or centred on (x, y), kept inside. */
export function layoutText(layer: TextLayer, measure: (line: string) => number, frame = STICKER_SIDE): TextLayout {
  const font = stickerFont(layer.font)
  const lines = wrapText(layer.text, frame - TEXT_MARGIN * 2 - layer.strokeWidth * 2, measure)
  const lineHeight = layer.size * font.lineHeight
  const height = lineHeight * lines.length + layer.strokeWidth * 2
  const width = Math.min(frame - TEXT_MARGIN * 2, Math.max(1, ...lines.map(measure)) + layer.strokeWidth * 2)
  const half = height / 2
  const centreY = layer.place === 'top' ? TEXT_MARGIN + half
    : layer.place === 'bottom' ? frame - TEXT_MARGIN - half
      : Math.min(frame - TEXT_MARGIN - half, Math.max(TEXT_MARGIN + half, layer.y))
  const centreX = layer.place === 'free' ? Math.min(frame - TEXT_MARGIN - width / 2, Math.max(TEXT_MARGIN + width / 2, layer.x)) : frame / 2
  const first = centreY - half + layer.strokeWidth + lineHeight / 2
  return {
    lines, x: centreX, lineHeight,
    ys: lines.map((_, index) => first + index * lineHeight),
    box: { x: centreX - width / 2, y: centreY - half, width, height },
  }
}

/** The text layer under a frame point, the topmost (last drawn) first; undefined for none. */
export function textAt(layers: readonly TextLayer[], layouts: readonly TextLayout[], point: Point, slop = 10): TextLayer | undefined {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const box = layouts[index]?.box
    if (box && point.x >= box.x - slop && point.x <= box.x + box.width + slop && point.y >= box.y - slop && point.y <= box.y + box.height + slop) return layers[index]
  }
  return undefined
}

/** The order of packs or stickers with `id` moved one step (−1: up / left, +1: down / right); the same at an end. */
export function moved(ids: readonly string[], id: string, by: -1 | 1): string[] {
  const at = ids.indexOf(id)
  const to = at + by
  if (at < 0 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  next.splice(at, 1)
  next.splice(to, 0, id)
  return next
}

/** The sticker's sides tried in turn when its PNG is over STICKER_LIMITS.bytes (a busy photo compresses badly). */
export const PNG_SIDES: readonly number[] = [512, 448, 384, 320, 256]

/** The base64 of a data: URL (what the server takes). */
export const dataUrlBase64 = (url: string) => url.replace(/^data:[^,]*,/, '')

/** Offsets (unit circle) of the white outline around the cut-out: drawn this many times around it. */
export function outlineOffsets(count = 16): Point[] {
  return Array.from({ length: count }, (_, index) => ({ x: Math.cos((index / count) * Math.PI * 2), y: Math.sin((index / count) * Math.PI * 2) }))
}
