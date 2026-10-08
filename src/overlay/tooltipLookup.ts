import { findTooltipAtScales, ocrVariants, tooltipForOcr, type Bitmap, type Rect } from './tooltipDetect.js'

/** A grab of the screen around the cursor (see TOOLTIP_CAPTURE). */
export interface TooltipShot {
  image: Bitmap
  /** Where the mouse points, in image pixels. */
  cursor: { x: number; y: number }
  /** One 1080p pixel in image pixels (screen height / 1080). */
  unit: number
}

export interface TooltipReading<Answer, Shot extends TooltipShot> {
  answer: Answer | null
  /** The last tooltip seen (null when the game showed none in time). */
  shot: Shot | null
  rect: Rect | null
  /** One 1080p pixel of the game UI where that tooltip was found (the screen's unit times the game's UI scale). */
  unit: number | null
  /** The first grab with a tooltip: taken before the app's own card could show on screen (the picture check uses it). */
  first: { shot: Shot; rect: Rect; unit: number } | null
  /** What the OCR read, for the failed-lookup log. */
  tries: string[]
  /** Grabs taken and the last one (tooltip or not), for the log of lookups that found no tooltip. */
  grabs: number
  latest: Shot | null
}

export interface TooltipLookupSteps<Answer, Shot extends TooltipShot> {
  grab: () => Promise<Shot | null>
  /** A large item may place its tooltip outside the first crop. No game input is generated. */
  grabWide?: () => Promise<Shot | null>
  recognize: (bitmap: Bitmap) => Promise<string>
  /** The item for an OCR line, or null. */
  match: (text: string) => Promise<Answer | null>
  /** A tooltip was found (e.g. show the card in its «reading…» state right there). */
  onTooltip?: (shot: Shot, rect: Rect) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const TOOLTIP_TIMING = {
  /** The game shows the name a moment after the cursor stops on an item: wait this long for it to appear. */
  appearMs: 900,
  /** A tooltip read without a match (still fading in, or the previous item's) is looked at again until then. */
  totalMs: 1800,
  /** Between grabs; finding the box takes a few ms, only a found box is read (OCR). */
  intervalMs: 60,
}

/**
 * Reads the game's name tooltip for the item under the cursor. Pressing the key right after pointing at an item
 * is normal, so the screen is grabbed again every few dozen milliseconds until the tooltip appears; only a found
 * tooltip is read. A reading without a match is not the end either: the tooltip may still be fading in, or be the
 * previous item's — a tooltip that looks different from the ones read already is read again, for a little while.
 */
export async function readGameTooltip<Answer, Shot extends TooltipShot>(steps: TooltipLookupSteps<Answer, Shot>, timing = TOOLTIP_TIMING): Promise<TooltipReading<Answer, Shot>> {
  const now = steps.now ?? (() => Date.now())
  const sleep = steps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const started = now()
  const read = new Set<string>()
  const tries: string[] = []
  let last: { shot: Shot; rect: Rect; unit: number } | null = null
  let first: { shot: Shot; rect: Rect; unit: number } | null = null
  let latest: Shot | null = null
  let grabs = 0
  let wide = false
  for (;;) {
    const shot = await (wide && steps.grabWide ? steps.grabWide() : steps.grab()).catch(() => null)
    grabs += 1
    latest = shot ?? latest
    const found = shot ? findTooltipAtScales(shot.image, shot.cursor, shot.unit) : null
    const rect = found?.rect ?? null
    if (shot && rect) {
      const key = tooltipKey(shot.image, rect)
      if (!last) steps.onTooltip?.(shot, rect)
      last = { shot, rect, unit: found!.unit }
      first ??= last
      if (!read.has(key)) {
        read.add(key)
        for (const bitmap of ocrVariants(shot.image, rect, shot.cursor, found!.unit)) {
          const text = await steps.recognize(bitmap).catch(() => '')
          tries.push(text)
          if (!text) continue
          const answer = await steps.match(text)
          if (answer) return { answer, shot, rect, unit: found!.unit, first, tries, grabs, latest }
        }
      }
    }
    const elapsed = now() - started
    if (!last && steps.grabWide && elapsed >= timing.intervalMs) wide = true
    if (elapsed >= (last ? timing.totalMs : timing.appearMs)) break
    await sleep(timing.intervalMs)
  }
  return { answer: null, shot: last?.shot ?? null, rect: last?.rect ?? null, unit: last?.unit ?? null, first, tries, grabs, latest }
}

/**
 * Second-attempt OCR inputs for a tooltip none of whose first readings named an item — ways the first pass does not
 * read it: the whole box cut to black and white at its own level (Otsu: the darkest text still counts), a larger
 * smooth copy, and each text line on its own when the box holds two (the OCR reads one line). Each reading is one or
 * more pictures whose texts are joined with a space.
 */
export function retryOcrReadings(image: Bitmap, rect: Rect, cursor: { x: number; y: number }, unit: number): Bitmap[][] {
  const mask = { x: cursor.x - 2, y: cursor.y - 2, width: Math.round(15 * unit) + 4, height: Math.round(23 * unit) + 4 }
  const levels: number[] = []
  const rows: number[][] = []
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    const row: number[] = []
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (x >= mask.x && x <= mask.x + mask.width && y >= mask.y && y <= mask.y + mask.height) continue
      const index = (y * image.width + x) * 4
      const value = (image.data[index + 2]! * 54 + image.data[index + 1]! * 183 + image.data[index]! * 19) >> 8
      levels.push(value)
      row.push(value)
    }
    rows.push(row)
  }
  if (levels.length < 16) return []
  const level = otsu(levels)
  const dark = levels.filter((value) => value < level).sort((a, b) => a - b)
  const light = levels.filter((value) => value >= level).sort((a, b) => a - b)
  const background = dark[Math.floor(dark.length / 2)] ?? 20
  const peak = Math.max(background + 60, light[Math.floor(light.length * 0.9)] ?? 200)
  const span = peak - background
  // tooltipForOcr maps `background` to white and `peak` to black; cut where the Otsu level lands.
  const cut = Math.round(255 - (level - background) * 255 / span)
  const scale = Math.max(2, Math.min(5, Math.round(4 / unit)))
  const readings: Bitmap[][] = [
    [tooltipForOcr(image, rect, scale, background, span, { mask, threshold: cut })],
    [tooltipForOcr(image, rect, Math.min(6, scale + 2), background, span, { mask })],
  ]
  // Text lines: runs of rows holding bright pixels, a little apart.
  const lines: Array<{ from: number; to: number }> = []
  rows.forEach((row, index) => {
    const lit = row.filter((value) => value >= level).length >= Math.max(2, row.length * 0.01)
    const previous = lines.at(-1)
    if (!lit) return
    if (previous && index - previous.to <= Math.max(1, Math.round(unit))) previous.to = index
    else lines.push({ from: index, to: index })
  })
  const tall = lines.filter((line) => line.to - line.from + 1 >= 4 * unit)
  if (tall.length >= 2) {
    const pad = Math.max(2, Math.round(3 * unit))
    readings.push(tall.slice(0, 3).map((line) => {
      const y = Math.max(rect.y, rect.y + line.from - pad)
      const bottom = Math.min(rect.y + rect.height, rect.y + line.to + 1 + pad)
      return tooltipForOcr(image, { x: rect.x, y, width: rect.width, height: bottom - y }, scale, background, span, { mask, threshold: cut })
    }))
  }
  return readings
}

/** The level that best splits the values into two groups (Otsu's method). */
function otsu(values: number[]) {
  const histogram = new Array<number>(256).fill(0)
  for (const value of values) histogram[value]! += 1
  let sum = 0
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level]!
  let below = 0, belowSum = 0, best = 128, bestSpread = -1
  for (let level = 0; level < 256; level += 1) {
    below += histogram[level]!
    if (!below) continue
    const above = values.length - below
    if (!above) break
    belowSum += level * histogram[level]!
    const spread = below * above * (belowSum / below - (sum - belowSum) / above) ** 2
    if (spread > bestSpread) { bestSpread = spread; best = level + 1 }
  }
  return best
}

/** Where readings found only by the second attempt are kept: what the OCR read → the item it turned out to be. */
export interface LookupMemoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export const LOOKUP_MEMORY = {
  key: 'raidos.itemLookupMemory.v1',
  /** Readings kept; the least recently used go first. */
  limit: 500,
  /** Shorter readings (folded) are too easily another item's too. */
  minLength: 5,
}

/**
 * The second attempt's findings, so that the same reading names the item at once next time. One list for the app
 * (not per game mode: names are the same). Keys are folded readings (see foldTooltipText); storage may be missing or
 * failing (private window, full) — then the memory simply lasts until the app closes.
 */
export function createLookupMemory(storage: () => LookupMemoryStorage | null | undefined, fold: (text: string) => string, limits = LOOKUP_MEMORY) {
  let entries: Map<string, string> | null = null
  const load = () => {
    if (entries) return entries
    entries = new Map()
    try {
      const saved = JSON.parse(storage()?.getItem(limits.key) ?? '[]') as unknown
      if (Array.isArray(saved)) {
        for (const pair of saved) if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') entries.set(pair[0], pair[1])
      }
    } catch { /* unreadable: start empty */ }
    return entries
  }
  const save = () => {
    try { storage()?.setItem(limits.key, JSON.stringify([...load()])) } catch { /* storage unavailable or full */ }
  }
  return {
    /**
     * The item id remembered for this reading (kept fresh), or null. `valid`: whether that item may still be the
     * answer (it is in the catalog, the reading still reads like it) — a remembered reading that no longer is, is
     * dropped.
     */
    recall(text: string, valid: (id: string) => boolean = () => true): string | null {
      const key = fold(text)
      const map = load()
      const id = map.get(key)
      if (id === undefined) return null
      map.delete(key)
      if (valid(id)) map.set(key, id)
      save()
      return map.has(key) ? id : null
    },
    /** Remembers these readings as this item — those long enough and `plausible` (reading like the item's name). */
    remember(texts: string[], id: string, plausible: (text: string) => boolean = () => true) {
      const map = load()
      let changed = false
      for (const text of texts) {
        const key = fold(text)
        if (key.replace(/ /g, '').length < limits.minLength || !plausible(text)) continue
        map.delete(key)
        map.set(key, id)
        changed = true
      }
      while (map.size > limits.limit) map.delete(map.keys().next().value!)
      if (changed) save()
    },
  }
}

/** Box size and its coarse brightness pattern: the same tooltip again, or a new (or brighter) one. */
export function tooltipKey(image: Bitmap, rect: Rect) {
  const cells: number[] = []
  const columns = 12, rows = 3
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0, count = 0
      const x0 = rect.x + Math.floor(column * rect.width / columns), x1 = rect.x + Math.floor((column + 1) * rect.width / columns)
      const y0 = rect.y + Math.floor(row * rect.height / rows), y1 = rect.y + Math.floor((row + 1) * rect.height / rows)
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (y * image.width + x) * 4
          sum += (image.data[index + 2]! * 54 + image.data[index + 1]! * 183 + image.data[index]! * 19) >> 8
          count += 1
        }
      }
      cells.push(count ? Math.round(sum / count / 6) : 0)
    }
  }
  return `${rect.width}x${rect.height}:${cells.join('.')}`
}
