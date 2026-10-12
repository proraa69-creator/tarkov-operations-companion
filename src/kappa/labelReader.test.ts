// @vitest-environment node
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { closeButNotIt, createLabelReader, LABELS_PER_PASS, toPgm, type LabelPicture, type PictureLine } from './labelReader'
import type { LabelStack, Raster } from './labelScan'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default

let frame: Raster
let container: { data: Buffer; width: number; height: number }

beforeAll(async () => {
  // The owner's container screenshot, as the game's 1440p picture would hold it (cells of 85 px: height 17 × 85).
  const { data, info } = await sharp(join(__dirname, '../../src/assets/guide/kappa-container.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  container = { data, width: info.width, height: info.height }
  frame = withContainers([260])
})

/**
 * A 1200 × 1445 frame with the container at the given left edges (one copy: 37 labels). Each further copy is a shade
 * lighter: the same item twice on screen is one label to read, these are different ones.
 */
function withContainers(lefts: number[], width = 1200): Raster {
  const height = 1445
  const pixels = new Uint8Array(width * height * 4)
  lefts.forEach((left, copy) => {
    for (let y = 0; y < container.height; y += 1) {
      const row = container.data.subarray(y * container.width * 4, (y + 1) * container.width * 4).map((value, index) => (index % 4 === 3 ? value : Math.min(255, value + copy)))
      pixels.set(row, ((y + 300) * width + left) * 4)
    }
  })
  return { width, height, data: pixels, order: 'rgba' }
}

/** The frame scrolled up by `rows` pixels (the stash moving under the cursor). */
function scrolled(rows: number): Raster {
  const pixels = new Uint8Array(frame.data.length)
  pixels.set(frame.data.subarray(rows * frame.width * 4))
  return { ...frame, data: pixels }
}

/** An OCR stand-in: one line per label of the picture, with the label's rows. */
const linesOf = (picture: LabelPicture, text: (index: number) => string): PictureLine[] =>
  (picture as LabelStack).bands.map((band, index) => ({ text: text(index), top: band.top + 2, bottom: band.bottom - 2 }))

describe('Collector scan: one scan reads each label once, a few dozen per call', () => {
  it('reads every label of the first frame, nothing while it stays, and only labels new on screen after scrolling', async () => {
    const calls: LabelPicture[] = []
    const reader = createLabelReader(async (picture) => { calls.push(picture); return linesOf(picture, (index) => `part ${index}`) })
    const first = await reader.readFrame(frame)
    expect(first.labels).toBeGreaterThanOrEqual(34)
    expect(first.read).toBe(first.labels)
    expect(first.pending).toBe(0)
    // One OCR engine, one narrow picture of stacked labels; each label's line comes back as its own line.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.width).toBeLessThan(400)
    expect(first.text.split('\n')).toHaveLength(first.labels)
    expect(first.text.split('\n')[1]).toBe('part 1')

    expect(await reader.readFrame(frame)).toEqual({ text: '', labels: 0, read: 0, pending: 0 })
    expect(calls).toHaveLength(1)

    // Scrolled by two rows of cells: the labels still on screen were read already.
    const after = await reader.readFrame(scrolled(170))
    expect(after.labels).toBeGreaterThan(0)
    expect(after.read).toBe(0)
    expect(calls).toHaveLength(1)

    // A new scan reads everything again.
    reader.reset()
    expect((await reader.readFrame(frame)).read).toBe(first.labels)
    expect(calls).toHaveLength(2)
  })

  it('reads a full stash over a few calls, even while the screen stays the same', async () => {
    const big = withContainers([0, 690, 1380], 2100)
    const reads: number[] = []
    const reader = createLabelReader(async (picture) => { reads.push((picture as LabelStack).bands.length); return linesOf(picture, () => 'x') })
    const first = await reader.readFrame(big)
    expect(first.labels).toBeGreaterThanOrEqual(100)
    expect(first.read).toBe(LABELS_PER_PASS)
    let pending = first.pending
    expect(pending).toBe(first.labels - LABELS_PER_PASS)
    while (pending) pending = (await reader.readFrame(big)).pending
    expect(reads.every((count) => count <= LABELS_PER_PASS)).toBe(true)
    expect(reads.reduce((sum, count) => sum + count, 0)).toBe(first.labels)
  })

  it('looks again, larger and bolder, at a label read close to a wanted name', async () => {
    const pictures: LabelStack[] = []
    const reader = createLabelReader(async (picture) => {
      pictures.push(picture as LabelStack)
      return linesOf(picture, () => (pictures.length === 1 ? 'Axe' : 'Axel'))
    })
    reader.reset(['Axel', 'Топор'])
    const first = await reader.readFrame(frame)
    // «Axe» is not «Axel» but close to it: nothing is reported yet, every label waits for a second look.
    expect(first.text).toBe('')
    expect(first.pending).toBe(first.labels)
    const second = await reader.readFrame(frame)
    expect(second.text.split('\n').every((line) => line === 'Axel')).toBe(true)
    expect(second.pending).toBe(0)
    expect(pictures[1]!.width).toBeGreaterThan(pictures[0]!.width)
    // Read twice at most: a third reading never comes.
    expect(await reader.readFrame(frame)).toMatchObject({ read: 0, pending: 0 })
  })

  it('reads the labels again when the reading failed', async () => {
    let fail = true
    const reader = createLabelReader(async (picture) => {
      if (fail) throw new Error('OCR busy')
      return linesOf(picture, () => 'ok')
    })
    await expect(reader.readFrame(frame)).rejects.toThrow('OCR busy')
    fail = false
    expect((await reader.readFrame(frame)).read).toBeGreaterThanOrEqual(34)
  })

  it('hands Tesseract a binary PGM', () => {
    const pgm = toPgm({ width: 3, height: 2, data: Uint8Array.from([0, 255, 0, 255, 0, 255]) })
    expect(new TextDecoder().decode(pgm.subarray(0, 11))).toBe('P5\n3 2\n255\n')
    expect([...pgm.subarray(11)]).toEqual([0, 255, 0, 255, 0, 255])
  })
})

describe('Collector scan: what is worth a second look', () => {
  const wanted = ['Axel', 'Nutsack', 'Топор', 'Loot Lord']
  it('a reading one or two letters from a wanted name, not the name itself nor anything else', () => {
    expect(closeButNotIt('Axe!', wanted)).toBe(false) // «!» is read as «l»: that is «Axel» already
    expect(closeButNotIt('Axe', wanted)).toBe(true)
    expect(closeButNotIt('Tonop', wanted)).toBe(true)
    expect(closeButNotIt('Tonon', wanted)).toBe(true)
    expect(closeButNotIt('Tanan', wanted)).toBe(false)
    expect(closeButNotIt('Axel', wanted)).toBe(false)
    expect(closeButNotIt('Nutsack', wanted)).toBe(false)
    expect(closeButNotIt('Loot Lord', wanted)).toBe(false)
    expect(closeButNotIt('Сухари', wanted)).toBe(false)
    expect(closeButNotIt('', wanted)).toBe(false)
    expect(closeButNotIt('Axe', [])).toBe(false)
  })
})
