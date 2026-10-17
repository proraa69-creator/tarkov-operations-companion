import { grayOf, type Quad, type Rgba } from './raster'

/**
 * The stash grid in a photo of the screen (owner, 17.10.2026: «синхронизация по фото»). The inventory is a grid of
 * evenly spaced thin lines, so:
 *   1. in a few horizontal bands of the photo, the brightness steps between neighbouring columns are summed — the grid's
 *      vertical lines stand out as peaks, evenly spaced; likewise the horizontal lines in vertical bands;
 *   2. the longest evenly spaced run of peaks in a band is the grid there; two bands far apart give each line twice;
 *   3. a photo taken a little from the side or from below makes the lines lean and the cells shrink with distance: each
 *      line is drawn through its two positions, so every cell becomes its own quadrilateral.
 * Pure: the RGBA pixels in, line positions out.
 */
export interface StashGrid {
  columns: number
  rows: number
  /** Corners of the cells from column `col`, row `row`, `width` × `height` cells big. */
  quad(col: number, row: number, width?: number, height?: number): Quad
  /** The cell pitch in photo pixels (about), for the sizes of what is cut out. */
  pitch: number
}

/** One band across the lines: where it lies, the grid lines found in it and how much they stand out. */
interface Band { at: number; lines: number[]; contrast: number }

/** How much stronger than the band's typical brightness step a grid line is at least. */
const MIN_CONTRAST = 1.8

/** Strongest positions of `signal` between `lo` and `hi`, at least `spacing` apart. */
export function peaksOf(signal: Float32Array, lo: number, hi: number, spacing: number, count: number): number[] {
  let top = 0
  for (let index = lo; index <= hi; index += 1) top = Math.max(top, signal[index] ?? 0)
  // Flat stretches are not lines: only steps of a fifth of the strongest count.
  const order = [...signal.keys()].filter((index) => index >= lo && index <= hi && signal[index]! >= top * 0.2).sort((a, b) => signal[b]! - signal[a]!)
  const picked: number[] = []
  for (const index of order) {
    if (picked.every((other) => Math.abs(index - other) >= spacing)) picked.push(index)
    if (picked.length >= count) break
  }
  return picked.sort((a, b) => a - b)
}

/** The longest run of lines about evenly spaced (within 15 % of their pitch), the pitch between `minPitch` and `maxPitch`. */
export function evenRun(lines: number[], minPitch: number, maxPitch: number): number[] {
  let best: number[] = []
  for (let start = 0; start < lines.length; start += 1) {
    for (let second = start + 1; second < lines.length; second += 1) {
      const pitch0 = lines[second]! - lines[start]!
      if (pitch0 < minPitch) continue
      if (pitch0 > maxPitch) break
      const run = [lines[start]!, lines[second]!]
      for (const next of lines.slice(second + 1)) {
        const pitch = (run[run.length - 1]! - run[0]!) / (run.length - 1)
        const gap = next - run[run.length - 1]!
        if (Math.abs(gap - pitch) <= pitch * 0.15) run.push(next)
        else if (gap > pitch * 1.15) break
      }
      if (run.length > best.length) best = run
    }
  }
  return best
}

/** Lines the peak list missed at the ends of a run (the last row is often faint): a local peak where the next line should be. */
function extendRun(run: number[], signal: Float32Array, limit: number, faint = 0.35): number[] {
  if (run.length < 3) return run
  const out = [...run]
  const strength = [...out].map((at) => signal[at]!).sort((a, b) => a - b)[Math.floor(out.length / 2)]!
  const step = (forward: boolean) => {
    const last = forward ? out.slice(-3) : out.slice(0, 3).reverse()
    const pitch = Math.abs(last[0]! - last[last.length - 1]!) / (last.length - 1)
    const expected = forward ? out[out.length - 1]! + pitch : out[0]! - pitch
    let at = -1, value = 0
    for (let x = Math.round(expected - pitch * 0.2); x <= Math.round(expected + pitch * 0.2); x += 1) {
      if (x < 0 || x >= limit) continue
      if (signal[x]! > value) { value = signal[x]!; at = x }
    }
    if (at < 0 || value < strength * faint) return false
    if (forward) out.push(at)
    else out.unshift(at)
    return true
  }
  for (let guard = 0; guard < 40 && step(true); guard += 1) { /* next line below / right */ }
  for (let guard = 0; guard < 40 && step(false); guard += 1) { /* next line above / left */ }
  return out
}

function bandsOf(gray: Float32Array, width: number, height: number, vertical: boolean): Band[] {
  // vertical === true: lines running up and down (columns), found in horizontal bands.
  const along = vertical ? width : height
  const across = vertical ? height : width
  const half = Math.max(8, Math.round(across * 0.06))
  const minPitch = Math.max(12, along / 45), maxPitch = along / 4
  const bands: Band[] = []
  for (const share of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const center = Math.round(across * share)
    const from = Math.max(0, center - half), to = Math.min(across - 1, center + half)
    const signal = new Float32Array(along)
    for (let t = from; t < to; t += 1) {
      for (let s = 0; s < along - 1; s += 1) {
        const a = vertical ? gray[t * width + s]! : gray[s * width + t]!
        const b = vertical ? gray[t * width + s + 1]! : gray[(s + 1) * width + t]!
        signal[s] = signal[s]! + Math.abs(b - a)
      }
    }
    // Rows may run on into the empty part of the stash below the items (empty cells cost nothing), so faint row lines
    // are kept; columns stop where the stash does (beyond it is other interface).
    const faint = vertical ? 0.35 : 0.2
    // A sharp line gives two steps (into it and out of it): a 3-pixel sum makes them one peak in the middle.
    const raw = signal.slice()
    for (let s = 1; s < along - 1; s += 1) signal[s] = raw[s - 1]! + raw[s]! + raw[s + 1]!
    const lines = extendRun(trimRun(extendRun(evenRun(peaksOf(signal, 2, along - 3, minPitch * 0.8, 80), minPitch, maxPitch), signal, along, faint), signal, vertical ? 0.45 : 0.25), signal, along, faint)
    // Grid lines stand out of the band: a run no stronger than the band's typical step is a texture, not a grid.
    const typical = median([...signal])
    const contrast = median(lines.map((at) => signal[at]!)) / Math.max(1e-6, typical)
    bands.push({ at: (from + to) / 2, lines: contrast >= MIN_CONTRAST ? lines : [], contrast })
  }
  // Bands crossing item pictures can find a false, regular-looking run: only runs that are even (gaps within a few per
  // cent) and agree on the pitch with the other bands count.
  const good = bands.filter((band) => band.lines.length >= 4 && gapSpread(band.lines) <= 0.06)
  const pitches = good.map((band) => pitchOf(band.lines)).sort((a, b) => a - b)
  const usual = pitches[Math.floor(pitches.length / 2)] ?? 0
  return good.filter((band) => Math.abs(pitchOf(band.lines) - usual) <= usual * 0.15)
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
const gapsOf = (lines: number[]) => lines.slice(1).map((at, index) => at - lines[index]!)
export const pitchOf = (lines: number[]) => median(gapsOf(lines))
/**
 * How uneven the gaps are, relative to the pitch: each gap against its neighbours, so the steady shrinking of the cells
 * with distance (the photo taken from below) is not unevenness.
 */
export function gapSpread(lines: number[]) {
  const gaps = gapsOf(lines), pitch = median(gaps)
  if (gaps.length < 3 || !pitch) return gaps.length ? 0 : 1
  let sum = 0
  for (let i = 1; i < gaps.length - 1; i += 1) sum += (gaps[i]! - (gaps[i - 1]! + gaps[i + 1]!) / 2) ** 2
  return Math.sqrt(sum / (gaps.length - 2)) / pitch
}

/** Ends of a run that do not belong: a gap off its neighbour by more than 12 %, or a line much fainter than the rest. */
function trimRun(run: number[], signal: Float32Array, faint = 0.45): number[] {
  const out = [...run]
  const strength = median(out.map((at) => signal[at]!))
  const off = (gap: number, next: number) => Math.abs(gap - next) > next * 0.12
  while (out.length > 3 && (off(out[1]! - out[0]!, out[2]! - out[1]!) || signal[out[0]!]! < strength * faint)) out.shift()
  while (out.length > 3) {
    const n = out.length
    if (!(off(out[n - 1]! - out[n - 2]!, out[n - 2]! - out[n - 3]!) || signal[out[n - 1]!]! < strength * faint)) break
    out.pop()
  }
  return out
}

/** Positions of one grid line in the bands that saw it: [band position across the lines, line position]. */
type Track = Array<[number, number]>

/**
 * Every grid line followed through all the good bands (a curved monitor bends the lines, so two bands are not enough):
 * the band seeing the most lines is the reference, each other band is matched to it by the shift with the smallest
 * median offset (a lean is well under half a cell), and its lines join the tracks they fall on.
 */
function trackLines(bands: Band[], across: number): Track[] | null {
  if (!bands.length) return null
  const reference = [...bands].sort((a, b) => b.lines.length - a.lines.length || Math.abs(a.at - across / 2) - Math.abs(b.at - across / 2))[0]!
  const pitch = pitchOf(reference.lines)
  // Tracks by index relative to the reference's first line.
  const tracks = new Map<number, Track>()
  reference.lines.forEach((at, index) => tracks.set(index, [[reference.at, at]]))
  const others = bands.filter((band) => band !== reference).sort((a, b) => Math.abs(a.at - reference.at) - Math.abs(b.at - reference.at))
  for (const band of others) {
    // Where this band's lines are expected: each known track extended to this band by its own lean (or the nearest's).
    let best: { shift: number; offset: number; count: number } | null = null
    for (let shift = -band.lines.length + 2; shift <= reference.lines.length - 2; shift += 1) {
      const offsets: number[] = []
      band.lines.forEach((at, j) => {
        const track = tracks.get(j + shift)
        if (track) offsets.push(at - positionAt(track, band.at, tracks))
      })
      if (offsets.length < 3) continue
      const offset = Math.abs(median(offsets))
      if (!best || offset < best.offset - 1e-6 || (Math.abs(offset - best.offset) < 1e-6 && offsets.length > best.count)) best = { shift, offset, count: offsets.length }
    }
    if (!best || best.offset > pitch * 0.35) continue
    band.lines.forEach((at, j) => {
      const track = tracks.get(j + best.shift) ?? []
      track.push([band.at, at])
      track.sort((a, b) => a[0] - b[0])
      tracks.set(j + best.shift, track)
    })
  }
  // With three bands or more, a line at the ends seen in one band only is a false one (other interface past the stash).
  const supported = (key: number) => bands.length < 3 || (tracks.get(key)?.length ?? 0) >= 2
  let keys = [...tracks.keys()].sort((a, b) => a - b)
  while (keys.length && !supported(keys[0]!)) keys = keys.slice(1)
  while (keys.length && !supported(keys[keys.length - 1]!)) keys = keys.slice(0, -1)
  // Only a run of consecutive lines makes a grid.
  const run: Track[] = []
  for (const key of keys) {
    if (run.length && !tracks.has(key - 1)) break
    if (!tracks.has(key)) continue
    run.push(tracks.get(key)!)
  }
  return run.length >= 4 ? run : null
}

/** A track's line position at `at` (across the lines): piecewise linear through its points; a line seen once leans like its nearest neighbour seen twice. */
function positionAt(track: Track, at: number, all: Map<number, Track> | Track[]): number {
  if (track.length >= 2) {
    let i = 1
    while (i < track.length - 1 && track[i]![0] < at) i += 1
    const [a0, p0] = track[i - 1]!, [a1, p1] = track[i]!
    return p0 + (p1 - p0) * (at - a0) / (a1 - a0)
  }
  const [a0, p0] = track[0]!
  let lean = 0, distance = Infinity
  for (const other of all.values()) {
    if (other.length < 2) continue
    const near = Math.abs(positionAt(other, a0, all) - p0)
    if (near < distance) { distance = near; lean = (other[other.length - 1]![1] - other[0]![1]) / (other[other.length - 1]![0] - other[0]![0]) }
  }
  return p0 + lean * (at - a0)
}

/** The grid of the photo, or null when no evenly spaced lines cross it both ways (not a stash, too blurred, too skewed). */
export function detectGrid(image: Rgba): StashGrid | null {
  const gray = grayOf(image)
  const columns = trackLines(bandsOf(gray, image.width, image.height, true), image.height)
  const rows = trackLines(bandsOf(gray, image.width, image.height, false), image.width)
  if (!columns || !rows) return null
  const colX = (i: number, y: number) => positionAt(columns[i]!, y, columns)
  const rowY = (j: number, x: number) => positionAt(rows[j]!, x, rows)
  const corner = (i: number, j: number): [number, number] => {
    let x = columns[i]![0]![1]
    let y = rowY(j, x)
    for (let pass = 0; pass < 5; pass += 1) { x = colX(i, y); y = rowY(j, x) }
    return [x, y]
  }
  const nc = columns.length - 1, nr = rows.length - 1
  const pitchX = Math.abs(corner(nc, 0)[0] - corner(0, 0)[0]) / nc, pitchY = Math.abs(corner(0, nr)[1] - corner(0, 0)[1]) / nr
  // Stash cells are square: lines that make long thin cells are not the stash grid.
  if (Math.abs(pitchX - pitchY) > Math.max(pitchX, pitchY) * 0.3) return null
  const pitch = (pitchX + pitchY) / 2
  return {
    columns: nc,
    rows: nr,
    pitch,
    quad: (col, row, width = 1, height = 1) => [corner(col, row), corner(col + width, row), corner(col + width, row + height), corner(col, row + height)],
  }
}
