/**
 * A small perceptual signature of an item picture: the same numbers for the item's catalog icon (64 px) and for the
 * item as the game draws it in the inventory, so the two can be compared (see iconMatch.ts). Brightness steps between
 * neighbouring parts of a coarse thumbnail (a difference hash, 9×8 rightwards and 8×9 downwards) carry the shape;
 * a 4×4 mean colour carries the colours. Parts of the screen picture covered by the cursor, the tooltip or the labels
 * the game prints over items are left out on that side and in the comparison.
 *
 * Pure: raw pixels in, plain arrays out (they travel between the app's processes and into the diagnostics log).
 */

export interface Pixels {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
  /** Byte order: 'bgra' for screen grabs (Windows / Electron), 'rgba' for a canvas. */
  order: 'bgra' | 'rgba'
  /** Whether the 4th byte is transparency (an icon); screen grabs leave it undefined. */
  alpha?: boolean
}
export interface Area { x: number; y: number; width: number; height: number }

export interface PictureSignature {
  /** 128 brightness steps: '+' brighter to the right / below, '-' darker, '0' about the same, '?' covered. */
  steps: string
  /** Mean colour (r, g, b, 0–255) of a 4×4 grid, row by row; -1 where covered. */
  colors: number[]
}

export interface SignatureDistance {
  /** 0 = same picture … about 0.5 for unrelated pictures, up to 1. */
  distance: number
  /** Share of differing brightness steps where either picture has one (0–1, a half when one side is flat). */
  shape: number
  /** Mean colour difference (0–1). */
  tint: number
  /** Share of the signature visible on both sides. */
  known: number
}

/** Brightness difference (0–255, between thumbnail cells) below which a step counts as flat. */
const FLAT = 4
/** A thumbnail cell needs this share of visible pixels to count. */
const MIN_VISIBLE = 0.5
/** Fewer brightness steps than this on both pictures (nearly flat) say nothing about the shape: as unrelated. */
const MIN_INFORMATIVE = 8
/** Weight of the shape in the distance; colours make the rest. */
const SHAPE_WEIGHT = 0.7
/** Mean colour differences are small numbers: scaled to weigh like shape differences (unrelated ≈ 0.5). */
const TINT_SCALE = 2.5
/** What a transparent icon pixel stands for: the dark inventory cell behind the picture. */
const BACKDROP = 28

interface Thumbnail { width: number; height: number; red: Float32Array; green: Float32Array; blue: Float32Array; visible: Float32Array }

const inArea = (area: Area, x: number, y: number) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height

/** Per-cell sums of a grid over the picture's area, before any turn: what a thumbnail is made of. */
interface GridSums { width: number; height: number; sums: Float64Array; seen: Float64Array; all: Float64Array }

/**
 * Area-averaged grids (each width×height cells) of `area`, skipping covered pixels — all of them in one pass over the
 * pixels. A signature's three thumbnails at every turn come from just three grids (4×4, 9×8, 8×9: a quarter turn swaps
 * the last two), so the screen picture's signatures need one pass instead of nine (measured 18.11.2026: 100–200 ms of
 * the item key's picture search went here, on the main process). The sums are added in the same order as one pass per
 * thumbnail added them: the same numbers to the bit.
 */
function gridSums(image: Pixels, area: Area, covered: Area[]): [GridSums, GridSums, GridSums] {
  const grid = (width: number, height: number): GridSums => ({ width, height, sums: new Float64Array(width * height * 3), seen: new Float64Array(width * height), all: new Float64Array(width * height) })
  const out: [GridSums, GridSums, GridSums] = [grid(4, 4), grid(9, 8), grid(8, 9)]
  const [a, b, c] = out
  const { data } = image
  const [r, bl] = image.order === 'rgba' ? [0, 2] : [2, 0]
  const x0 = Math.max(0, Math.round(area.x)), y0 = Math.max(0, Math.round(area.y))
  const x1 = Math.min(image.width, Math.round(area.x + area.width)), y1 = Math.min(image.height, Math.round(area.y + area.height))
  const blocking = covered.filter((rect) => rect.x < x1 && rect.x + rect.width > x0 && rect.y < y1 && rect.y + rect.height > y0)
  // Each grid's column for every x of the area (the same for every row).
  const columns = (target: GridSums) => Int32Array.from({ length: Math.max(0, x1 - x0) }, (_, dx) => Math.min(target.width - 1, Math.floor(dx * target.width / (x1 - x0))))
  const columnA = columns(a), columnB = columns(b), columnC = columns(c)
  const rowOf = (target: GridSums, y: number) => Math.min(target.height - 1, Math.floor((y - y0) * target.height / (y1 - y0))) * target.width
  for (let y = y0; y < y1; y += 1) {
    const rowA = rowOf(a, y), rowB = rowOf(b, y), rowC = rowOf(c, y)
    const rowBlocking = blocking.filter((rect) => y >= rect.y && y < rect.y + rect.height)
    for (let x = x0; x < x1; x += 1) {
      const cellA = rowA + columnA[x - x0]!, cellB = rowB + columnB[x - x0]!, cellC = rowC + columnC[x - x0]!
      a.all[cellA]! += 1
      b.all[cellB]! += 1
      c.all[cellC]! += 1
      if (rowBlocking.length && rowBlocking.some((rect) => inArea(rect, x, y))) continue
      const pixel = (y * image.width + x) * 4
      const opacity = image.alpha ? data[pixel + 3]! / 255 : 1
      const red = data[pixel + r]! * opacity + BACKDROP * (1 - opacity)
      const green = data[pixel + 1]! * opacity + BACKDROP * (1 - opacity)
      const blue = data[pixel + bl]! * opacity + BACKDROP * (1 - opacity)
      a.sums[cellA * 3]! += red; a.sums[cellA * 3 + 1]! += green; a.sums[cellA * 3 + 2]! += blue; a.seen[cellA]! += 1
      b.sums[cellB * 3]! += red; b.sums[cellB * 3 + 1]! += green; b.sums[cellB * 3 + 2]! += blue; b.seen[cellB]! += 1
      c.sums[cellC * 3]! += red; c.sums[cellC * 3 + 1]! += green; c.sums[cellC * 3 + 2]! += blue; c.seen[cellC]! += 1
    }
  }
  return out
}

/** The width×height thumbnail after `turns` quarter turns clockwise, from the grid of the unturned picture. */
function turnedThumbnail(grid: GridSums, width: number, height: number, turns: number): Thumbnail {
  const { width: sourceWidth, height: sourceHeight, sums, seen, all } = grid
  const out: Thumbnail = { width, height, red: new Float32Array(width * height), green: new Float32Array(width * height), blue: new Float32Array(width * height), visible: new Float32Array(width * height) }
  const quarter = ((turns % 4) + 4) % 4
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Where this cell of the turned picture comes from in the source grid.
      const [sx, sy] = quarter === 0 ? [x, y] : quarter === 1 ? [y, sourceHeight - 1 - x] : quarter === 2 ? [sourceWidth - 1 - x, sourceHeight - 1 - y] : [sourceWidth - 1 - y, x]
      const cell = sy * sourceWidth + sx, target = y * width + x
      const count = seen[cell]!
      out.visible[target] = all[cell] ? count / all[cell]! : 0
      if (!count) continue
      out.red[target] = sums[cell * 3]! / count
      out.green[target] = sums[cell * 3 + 1]! / count
      out.blue[target] = sums[cell * 3 + 2]! / count
    }
  }
  return out
}

const grey = (picture: Thumbnail, cell: number) => (picture.red[cell]! * 54 + picture.green[cell]! * 183 + picture.blue[cell]! * 19) / 256

function steps(picture: Thumbnail, dx: number, dy: number) {
  let out = ''
  for (let y = 0; y + dy < picture.height; y += 1) {
    for (let x = 0; x + dx < picture.width; x += 1) {
      const a = y * picture.width + x, b = (y + dy) * picture.width + x + dx
      if (picture.visible[a]! < MIN_VISIBLE || picture.visible[b]! < MIN_VISIBLE) { out += '?'; continue }
      const step = grey(picture, b) - grey(picture, a)
      out += step > FLAT ? '+' : step < -FLAT ? '-' : '0'
    }
  }
  return out
}

/**
 * The signature of the picture in `area`. `covered`: parts to leave out (screen side); `turns`: quarter turns clockwise
 * that bring the picture into the icon's orientation.
 */
export function pictureSignature(image: Pixels, area: Area, covered: Area[] = [], turns = 0): PictureSignature {
  return pictureSignatures(image, area, covered, [turns])[0]!
}

/** The signatures of the picture in `area` at each of these turns (see pictureSignature), from one pass over its pixels. */
export function pictureSignatures(image: Pixels, area: Area, covered: Area[], turns: number[]): PictureSignature[] {
  // The thumbnails' grids before the turn: 4×4 colours, 9×8 and 8×9 steps (swapped by an odd turn).
  const [colorGrid, wide, tall] = gridSums(image, area, covered)
  return turns.map((turn) => {
    const odd = turn % 2 !== 0
    const colors = turnedThumbnail(colorGrid!, 4, 4, turn)
    const palette: number[] = []
    for (let cell = 0; cell < 16; cell += 1) {
      if (colors.visible[cell]! < MIN_VISIBLE) palette.push(-1, -1, -1)
      else palette.push(Math.round(colors.red[cell]!), Math.round(colors.green[cell]!), Math.round(colors.blue[cell]!))
    }
    return {
      steps: steps(turnedThumbnail(odd ? tall! : wide!, 9, 8, turn), 1, 0) + steps(turnedThumbnail(odd ? wide! : tall!, 8, 9, turn), 0, 1),
      colors: palette,
    }
  })
}

/**
 * Where an item's picture lies in its icon: the icon is square and the picture of a cols×rows item is fitted into it,
 * centred. A thin margin is left out on all sides (frame and background edge of the icon).
 */
export function iconArea(width: number, height: number, cols: number, rows: number): Area {
  const aspect = Math.max(0.05, cols / Math.max(1, rows))
  const fitWidth = Math.min(width, height * aspect), fitHeight = Math.min(height, width / aspect)
  const marginX = fitWidth / 32, marginY = fitHeight / 32
  return { x: (width - fitWidth) / 2 + marginX, y: (height - fitHeight) / 2 + marginY, width: fitWidth - marginX * 2, height: fitHeight - marginY * 2 }
}

export function signatureDistance(screen: PictureSignature, icon: PictureSignature): SignatureDistance {
  let differ = 0, compared = 0, informative = 0
  const length = Math.min(screen.steps.length, icon.steps.length)
  for (let index = 0; index < length; index += 1) {
    const a = screen.steps[index], b = icon.steps[index]
    if (a === '?' || b === '?') continue
    compared += 1
    // Flat on both sides tells nothing: two different items on the same background agree there.
    if (a === '0' && b === '0') continue
    informative += 1
    if (a !== b) differ += a === '0' || b === '0' ? 0.5 : 1
  }
  let tint = 0, cells = 0
  for (let cell = 0; cell + 2 < Math.min(screen.colors.length, icon.colors.length); cell += 3) {
    if (screen.colors[cell]! < 0 || icon.colors[cell]! < 0) continue
    cells += 1
    tint += (Math.abs(screen.colors[cell]! - icon.colors[cell]!) + Math.abs(screen.colors[cell + 1]! - icon.colors[cell + 1]!) + Math.abs(screen.colors[cell + 2]! - icon.colors[cell + 2]!)) / (3 * 255)
  }
  const shape = informative >= MIN_INFORMATIVE ? differ / informative : 1
  const meanTint = cells ? tint / cells : 1
  return {
    distance: SHAPE_WEIGHT * shape + (1 - SHAPE_WEIGHT) * Math.min(1, meanTint * TINT_SCALE),
    shape,
    tint: meanTint,
    known: length ? compared / length : 0,
  }
}
