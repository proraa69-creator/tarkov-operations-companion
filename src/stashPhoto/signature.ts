import { grayOf, resizeArea, type Rgba } from './raster'

/**
 * A small fingerprint of an item picture that survives a phone photo of the screen: the colours of a 16 px-per-cell
 * thumbnail, each channel brought to mean 0 and spread 1 (the camera's white balance and the screen's brightness drop
 * out), and the brightness steps of a 9×8-per-cell thumbnail (the shape). The game's label strip at the top of the item
 * and the «найдено в рейде» tick in its corner are left out: they are not the picture.
 */
export interface PictureFingerprint {
  /** Normalised colours of the kept pixels, r g b in a row. */
  colours: Float32Array
  /** -1 / 0 / 1: darker, same, lighter to the right. */
  steps: Int8Array
}

const PER_CELL = 16
/** The label strip: the top fifth of the top cell. */
const LABEL_ROWS = 4
const TICK = 4

/** `image` is the item at `cellsWide` × `cellsHigh` cells (any resolution). */
export function fingerprint(image: Rgba, cellsWide: number, cellsHigh: number): PictureFingerprint {
  const width = PER_CELL * cellsWide, height = PER_CELL * cellsHigh
  const small = resizeArea(image, width, height)
  const kept: number[] = []
  for (let y = 0; y < height; y += 1) {
    if (y < LABEL_ROWS) continue
    for (let x = 0; x < width; x += 1) {
      if (y >= height - TICK && x >= width - TICK) continue
      const i = (y * width + x) * 4
      kept.push(small.data[i]!, small.data[i + 1]!, small.data[i + 2]!)
    }
  }
  const colours = new Float32Array(kept.length)
  for (let ch = 0; ch < 3; ch += 1) {
    let sum = 0, count = 0
    for (let i = ch; i < kept.length; i += 3) { sum += kept[i]!; count += 1 }
    const mean = sum / count
    let spread = 0
    for (let i = ch; i < kept.length; i += 3) spread += (kept[i]! - mean) ** 2
    const sd = Math.sqrt(spread / count) + 1e-6
    for (let i = ch; i < kept.length; i += 3) colours[i] = (kept[i]! - mean) / sd
  }
  const stepsWide = 9 * cellsWide, stepsHigh = 8 * cellsHigh
  const shape = grayOf(resizeArea(image, stepsWide, stepsHigh))
  const steps = new Int8Array((stepsWide - 1) * stepsHigh)
  for (let y = 0; y < stepsHigh; y += 1) {
    for (let x = 0; x < stepsWide - 1; x += 1) steps[y * (stepsWide - 1) + x] = Math.sign(shape[y * stepsWide + x + 1]! - shape[y * stepsWide + x]!)
  }
  return { colours, steps }
}

/** How alike two fingerprints of the same size are: about 1 for the same picture, around 0 for unrelated ones. */
export function likeness(a: PictureFingerprint, b: PictureFingerprint): number {
  if (a.colours.length !== b.colours.length || a.steps.length !== b.steps.length) return -1
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.colours.length; i += 1) { dot += a.colours[i]! * b.colours[i]!; na += a.colours[i]! ** 2; nb += b.colours[i]! ** 2 }
  const cosine = dot / (Math.sqrt(na * nb) + 1e-6)
  let same = 0
  for (let i = 0; i < a.steps.length; i += 1) if (a.steps[i] === b.steps[i]) same += 1
  return 0.7 * cosine + 0.3 * (2 * same / a.steps.length - 1)
}

/** How busy a cell is (brightness spread of its middle): an empty stash cell is flat. */
export function busyness(cell: Rgba): number {
  const gray = grayOf(cell)
  let sum = 0, count = 0
  const x0 = Math.floor(cell.width * 0.15), x1 = Math.ceil(cell.width * 0.85), y0 = Math.floor(cell.height * 0.15), y1 = Math.ceil(cell.height * 0.85)
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { sum += gray[y * cell.width + x]!; count += 1 }
  const mean = sum / count
  let spread = 0
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) spread += (gray[y * cell.width + x]! - mean) ** 2
  return Math.sqrt(spread / count)
}
