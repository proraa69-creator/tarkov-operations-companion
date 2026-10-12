// @vitest-environment node
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLabelReader, toPgm, type LabelPicture } from './labelReader'
import type { Raster } from './labelScan'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default

let frame: Raster

beforeAll(async () => {
  // The owner's container screenshot, as the game's 1440p picture would hold it (cells of 85 px: height 17 × 85).
  const { data, info } = await sharp(join(__dirname, '../../src/assets/guide/kappa-container.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const width = 1200, height = 1445
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < info.height; y += 1) pixels.set(data.subarray(y * info.width * 4, (y + 1) * info.width * 4), ((y + 300) * width + 260) * 4)
  frame = { width, height, data: pixels, order: 'rgba' }
})

/** The frame scrolled up by `rows` pixels (the stash moving under the cursor). */
function scrolled(rows: number): Raster {
  const pixels = new Uint8Array(frame.data.length)
  pixels.set(frame.data.subarray(rows * frame.width * 4))
  return { ...frame, data: pixels }
}

describe('Collector scan: one scan reads each label once', () => {
  it('reads every label of the first frame, nothing while it stays, and only labels new on screen after scrolling', async () => {
    const calls: LabelPicture[][] = []
    const reader = createLabelReader(async (pictures) => { calls.push(pictures); return pictures.map((_, index) => `part ${index}`) })
    const first = await reader.readFrame(frame)
    expect(first.labels).toBeGreaterThanOrEqual(34)
    expect(first.read).toBe(first.labels)
    // Many labels: split between both OCR engines, each a narrow picture of stacked labels.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)
    expect(calls[0]!.every((picture) => picture.width < 400)).toBe(true)
    expect(first.text).toBe('part 0\npart 1')

    expect(await reader.readFrame(frame)).toEqual({ text: '', labels: first.labels, read: 0 })
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

  it('reads the labels again when the reading failed', async () => {
    let fail = true
    const reader = createLabelReader(async (pictures) => {
      if (fail) throw new Error('OCR busy')
      return pictures.map(() => 'ok')
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
