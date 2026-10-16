import { changedArea, cropLabel, labelBoxes, labelScale, stackCrops, stripKey, subRaster, tilePrint, type Raster, type TilePrint } from './labelScan.js'

export interface LabelPicture { width: number; height: number; data: Uint8Array }
/** One line OCR found in a picture: its text and the rows it covers. */
export interface PictureLine { text: string; top: number; bottom: number }
export interface FrameReading {
  /** OCR text of the labels read now, one label per line (empty when nothing new was on screen). */
  text: string
  /** Labels found in the part of the screen that changed, and how many labels were read now. */
  labels: number
  read: number
  /** Labels found but not read yet: the next calls read them, even if the screen stays the same. */
  pending: number
}

/** At most this many labels are read per call (one OCR engine): a full stash is read over a few calls, never in one long burst. */
export const LABELS_PER_PASS = 40
/** A scan of a huge stash forgets what it read rather than grow without end. */
const MAX_KEYS = 5000
const MAX_QUEUE = 600

interface Pending { key: string; crop: Raster; height: number; second?: boolean }

/**
 * One Collector scan's memory (electron/collectorScan.ts). Owner, 13.10.2026: «не находит предметы опять и тупить
 * начинает» — so each call does little, and a misread label gets a second look:
 *   - only the part of the screen that changed is searched for labels (the cursor, a tooltip: a small box);
 *   - each label is read once per scan (its pixels are its key), at most LABELS_PER_PASS per call, the rest next time;
 *   - a label read as something close to a wanted name but not it («Axe» for «Axel», «Tonon» for «Топор») is read
 *     once more, larger and bolder.
 * `read` gets one picture of stacked labels and answers the OCR lines with their rows.
 */
export function createLabelReader(read: (picture: LabelPicture) => Promise<PictureLine[]>) {
  let seen = new Set<string>()
  let queue: Pending[] = []
  let names: string[] = []
  let lastTiles: TilePrint | null = null
  return {
    /** A new scan: everything on screen is read again. `wanted`: the names a second look is worth for. */
    reset(wanted: string[] = []) {
      seen = new Set()
      queue = []
      names = wanted
      lastTiles = null
    },
    async readFrame(frame: Raster): Promise<FrameReading> {
      // The inventory cell is about a 17th of the game's height in every resolution (63 px at 1080p, 85 at 1440p).
      const cell = Math.round(frame.height / 17)
      const tiles = tilePrint(frame)
      const area = changedArea(lastTiles, tiles, Math.round(cell * 1.5))
      lastTiles = tiles
      let labels = 0
      if (area) {
        const boxes = labelBoxes(subRaster(frame, area), cell).map((box) => ({ ...box, x: box.x + area.x, y: box.y + area.y }))
        labels = boxes.length
        // The search is the longest step on the main process: let waiting work (windows, other requests) run after it.
        await new Promise((resolve) => setTimeout(resolve, 0))
        // The padding the OCR picture takes around a label: 3 px at 1440p, 2 at 1080p.
        const pad = Math.max(2, Math.round(cell * 0.035))
        const queued = new Set(queue.map((entry) => entry.key))
        for (const box of boxes) {
          const key = stripKey(frame, box, pad)
          if (seen.has(key) || queued.has(key) || queue.length >= MAX_QUEUE) continue
          queued.add(key)
          queue.push({ key, crop: cropLabel(frame, box, pad), height: box.height })
        }
      }
      if (!queue.length) return { text: '', labels, read: 0, pending: 0 }
      const batch = queue.slice(0, LABELS_PER_PASS)
      const texts = new Map<Pending, string>()
      // First readings and second looks are separate pictures: a second look is larger and bolder.
      for (const group of [batch.filter((entry) => !entry.second), batch.filter((entry) => entry.second)]) {
        if (!group.length) continue
        const scale = labelScale(group.map((entry) => ({ x: 0, y: 0, width: 0, height: entry.height })))
        const second = group[0]!.second === true
        const stack = stackCrops(group.map((entry) => entry.crop), second ? Math.min(5, scale + 1) : scale, second ? { threshold: 80 } : {})
        const lines = await read(stack)
        group.forEach((entry, index) => texts.set(entry, linesIn(lines, stack.bands[index]!).join(' ')))
      }
      // Only once read: a failed pass leaves the labels to the next one.
      queue = queue.slice(batch.length)
      if (seen.size + batch.length > MAX_KEYS) seen = new Set()
      const out: string[] = []
      for (const entry of batch) {
        const text = texts.get(entry) ?? ''
        if (!entry.second && closeButNotIt(text, names)) { queue.unshift({ ...entry, second: true }); continue }
        seen.add(entry.key)
        if (text.trim()) out.push(text.trim())
      }
      return { text: out.join('\n'), labels, read: batch.length, pending: queue.length }
    },
  }
}

/** The OCR lines whose middle lies within a label's rows (with half the gap around it). */
function linesIn(lines: PictureLine[], band: { top: number; bottom: number }) {
  const slack = 14
  return lines.filter((line) => {
    const middle = (line.top + line.bottom) / 2
    return middle >= band.top - slack && middle <= band.bottom + slack
  }).map((line) => line.text.trim()).filter(Boolean)
}

/** Look-alike Cyrillic and Latin letters folded to one alphabet, lower case, letters and digits only. */
const LOOK_ALIKE: Record<string, string> = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', ё: 'e', '0': 'o', '|': 'l', '!': 'l' }
function fold(value: string) {
  return value.toLowerCase().replace(/[авекмнорстухё0|!]/g, (char) => LOOK_ALIKE[char] ?? char).replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim()
}

/** A reading near a wanted name that is not that name: worth a second look. */
export function closeButNotIt(text: string, wanted: string[]) {
  const reading = fold(text)
  if (!reading || !wanted.length) return false
  const words = reading.split(' ')
  let close = false
  for (const name of wanted.map(fold)) {
    if (name.length < 3) continue
    if (reading === name || words.includes(name) || (name.includes(' ') && reading.includes(name))) return false
    const parts = name.includes(' ') ? [reading] : words
    for (const word of parts) {
      if (Math.abs(word.length - name.length) > 2) continue
      // One letter off in a short name, two in a name of five to seven letters, three in a longer one.
      if (editDistance(word, name) <= Math.max(1, Math.min(3, Math.round(name.length / 3)))) close = true
    }
  }
  return close
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]!
}

/** Tesseract takes a binary PGM as is: no PNG encoding of the label picture. */
export function toPgm(picture: LabelPicture) {
  const header = new TextEncoder().encode(`P5\n${picture.width} ${picture.height}\n255\n`)
  const out = new Uint8Array(header.length + picture.data.length)
  out.set(header)
  out.set(picture.data, header.length)
  return out
}
