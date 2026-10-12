import { framePrint, labelBoxes, labelScale, samePrint, stackLabels, stripKey, type Box, type Raster } from './labelScan.js'

export interface LabelPicture { width: number; height: number; data: Uint8Array }
export interface FrameReading {
  /** OCR text of the labels read now (empty when nothing new was on screen). */
  text: string
  /** Labels on screen, and how many of them were read now (the rest were read before in this scan). */
  labels: number
  read: number
}

/** Below this many new labels one OCR engine reads them all; above, they are split between the engines. */
const SPLIT_FROM = 16
/** A scan of a huge stash forgets what it read rather than grow without end. */
const MAX_KEYS = 5000

/**
 * One Collector scan's memory (electron/collectorScan.ts): nothing is done while the frame stays the same, and each
 * label is read once — scrolling the stash reads only the rows that came into view. `read` gets the label pictures
 * (one per OCR engine, read in parallel) and answers their text.
 */
export function createLabelReader(read: (pictures: LabelPicture[]) => Promise<string[]>, engines = 2) {
  let seen = new Set<string>()
  let lastPrint: Uint8Array | null = null
  let lastLabels = 0
  return {
    reset() {
      seen = new Set()
      lastPrint = null
      lastLabels = 0
    },
    async readFrame(frame: Raster): Promise<FrameReading> {
      const print = framePrint(frame)
      if (samePrint(lastPrint, print)) return { text: '', labels: lastLabels, read: 0 }
      // The inventory cell is about a 17th of the game's height in every resolution (63 px at 1080p, 85 at 1440p).
      const boxes = labelBoxes(frame, Math.round(frame.height / 17))
      const scale = labelScale(boxes)
      // The padding grows with the labels (the picture enlarges them less): 3 px at 1440p.
      const pad = Math.max(2, Math.round(9 / scale))
      const fresh: Array<{ box: Box; key: string }> = []
      for (const box of boxes) {
        const key = stripKey(frame, box, pad)
        if (!seen.has(key)) fresh.push({ box, key })
      }
      lastLabels = boxes.length
      if (!fresh.length) {
        lastPrint = print
        return { text: '', labels: boxes.length, read: 0 }
      }
      const parts = fresh.length < SPLIT_FROM ? [fresh] : split(fresh, engines)
      const texts = await read(parts.map((part) => stackLabels(frame, part.map((entry) => entry.box), scale, pad)))
      // Only once read: a failed pass leaves the frame and its labels to the next one.
      if (seen.size + fresh.length > MAX_KEYS) seen = new Set()
      for (const entry of fresh) seen.add(entry.key)
      lastPrint = print
      return { text: texts.join('\n'), labels: boxes.length, read: fresh.length }
    },
  }
}

/** In reading order, cut into `count` runs of about the same size. */
function split<T>(list: T[], count: number) {
  const size = Math.ceil(list.length / Math.max(1, count))
  return Array.from({ length: Math.max(1, count) }, (_, index) => list.slice(index * size, (index + 1) * size)).filter((part) => part.length)
}

/** Tesseract takes a binary PGM as is: no PNG encoding of the label picture. */
export function toPgm(picture: LabelPicture) {
  const header = new TextEncoder().encode(`P5\n${picture.width} ${picture.height}\n255\n`)
  const out = new Uint8Array(header.length + picture.data.length)
  out.set(header)
  out.set(picture.data, header.length)
  return out
}
