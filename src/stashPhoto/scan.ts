import { detectGrid, type StashGrid } from './grid'
import { countFinds, matchStash, type PhotoCandidate, type PhotoFind } from './match'
import { crop, sampleQuad, type Rgba } from './raster'
import { busyness, fingerprint } from './signature'

/**
 * «Синхронизация по фото» (owner, 17.10.2026): a phone photo of the stash on the screen → the wanted items it shows.
 * The whole job runs here, on the phone, on the pixels in memory: the photo is never uploaded or kept (owner: «на
 * сервере эти фото не должны храниться»). Steps: the grid (grid.ts), every busy cell's picture against the wanted items'
 * inventory pictures (signature.ts), the game's own label on each item read by OCR when the reader is available, both
 * weighed together (match.ts).
 */
export type ScanStage = 'grid' | 'labels' | 'pictures'

export interface ScanOptions {
  /** OCR of label strips, one text per strip in the same order; without it the pictures decide alone. */
  readLabels?: (strips: Rgba[]) => Promise<string[]>
  catalogNames?: readonly string[]
  onStage?: (stage: ScanStage) => void
}

export type ScanResult =
  | { ok: true; grid: { columns: number; rows: number }; finds: PhotoFind[]; items: ReturnType<typeof countFinds>; labelsRead: boolean }
  | { ok: false; reason: 'grid' }

/** A flat cell: no item (brightness spread of its middle under this). */
const EMPTY_SPREAD = 9
/** Label strips are read from the cell straightened at this size (as tall as the game's labels at 1440p, ×2). */
const LABEL_CELL = 126

/** The top strip of a cell where the game prints the item's short name (its right part: names are right-aligned). */
export function labelStrip(image: Rgba, grid: StashGrid, col: number, row: number): Rgba {
  const cell = sampleQuad(image, grid.quad(col, row), LABEL_CELL, LABEL_CELL)
  return crop(cell, LABEL_CELL * 0.12, 1, LABEL_CELL * 0.86, LABEL_CELL * 0.24)
}

export async function scanStashPhoto(image: Rgba, candidates: PhotoCandidate[], options: ScanOptions = {}): Promise<ScanResult> {
  options.onStage?.('grid')
  const grid = detectGrid(image)
  if (!grid) return { ok: false, reason: 'grid' }
  const empty = new Set<string>()
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.columns; col += 1) {
      if (busyness(sampleQuad(image, grid.quad(col, row), 32, 32)) < EMPTY_SPREAD) empty.add(`${col},${row}`)
    }
  }
  const labels = new Map<string, string>()
  let labelsRead = false
  if (options.readLabels) {
    options.onStage?.('labels')
    const keys: string[] = []
    const strips: Rgba[] = []
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.columns; col += 1) {
        if (empty.has(`${col},${row}`)) continue
        keys.push(`${col},${row}`)
        strips.push(labelStrip(image, grid, col, row))
      }
    }
    try {
      const texts = await options.readLabels(strips)
      keys.forEach((key, index) => labels.set(key, texts[index] ?? ''))
      labelsRead = true
    } catch { /* no OCR on this phone: the pictures decide */ }
  }
  options.onStage?.('pictures')
  const prints = new Map<string, ReturnType<typeof fingerprint>>()
  const finds = matchStash({
    columns: grid.columns,
    rows: grid.rows,
    empty,
    labels,
    candidates,
    catalogNames: options.catalogNames,
    fingerprintAt: (col, row, width, height) => {
      const key = `${col},${row},${width},${height}`
      let print = prints.get(key)
      if (!print) {
        print = fingerprint(sampleQuad(image, grid.quad(col, row, width, height), 64 * width, 64 * height), width, height)
        prints.set(key, print)
      }
      return print
    },
  })
  return { ok: true, grid: { columns: grid.columns, rows: grid.rows }, finds, items: countFinds(finds), labelsRead }
}
