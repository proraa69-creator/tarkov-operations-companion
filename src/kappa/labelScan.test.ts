// @vitest-environment node
/**
 * The Collector scan on the owner's container screenshot (12.10.2026, 1440p: cells of 85 px; the same picture the
 * first-run guide shows): which labels are found — under the blue frames of highlighted items, on light item art —
 * and what Tesseract, with the app's settings and language data, reads from them.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { findVisibleItems } from './collector'
import { framePrint, labelBoxes, labelScale, samePrint, stackLabels, stripKey, type Raster } from './labelScan'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default
const { createWorker } = require('tesseract.js') as { createWorker: (langs: string, oem: number, options: Record<string, unknown>) => Promise<{ setParameters: (params: Record<string, string>) => Promise<unknown>; recognize: (image: Buffer) => Promise<{ data: { text?: string } }>; terminate: () => Promise<unknown> }> }

const root = join(__dirname, '../..')
const catalog = JSON.parse(readFileSync(join(__dirname, '__fixtures__/collector-items.json'), 'utf8')) as Array<{ id: string; name: string; shortName: string }>
const entries = catalog.map((entry) => ({ item: { id: entry.id, name: entry.name, shortName: entry.shortName } as Item, count: 1 }))
/** The Collector's items in the picture (by label). */
const VISIBLE = ['#FireKlean', 'Усы', 'Gingy', 'Масло', 'Яд', 'Inseq', 'RatCola', 'YMXC', 'Жетон', 'Ворон', 'Veritas', 'Axel', 'Яйцо', 'Tamatthi', 'BakeEzy', 'Viibiin', 'VHS', 'Книга', 'Loot Lord', 'BEAR Buddy', 'Пропуск']

let raster: Raster

beforeAll(async () => {
  const { data, info } = await sharp(join(root, 'src/assets/guide/kappa-container.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  raster = { width: info.width, height: info.height, data: new Uint8Array(data), order: 'rgba' }
})

describe('Collector scan: item labels', () => {
  it('finds the labels as strips of their own: not joined to frames or art, without the round marks', () => {
    const boxes = labelBoxes(raster, 85)
    // 33 item labels and the header; a couple of strips of text on item art at most.
    expect(boxes.length).toBeGreaterThanOrEqual(34)
    expect(boxes.length).toBeLessThanOrEqual(40)
    const at = (x: number, y: number) => boxes.find((box) => box.x <= x && x < box.x + box.width && box.y <= y && y < box.y + box.height)
    // «Gingy» and «Сахар» sit under the light top line of highlighted cells: two labels, not one strip with the line.
    const gingy = at(310, 44)!, sugar = at(395, 45)!
    expect(gingy).toBeDefined()
    expect(sugar).toBeDefined()
    expect(gingy).not.toBe(sugar)
    expect(gingy.width).toBeLessThan(50)
    // «BEAR Buddy» rests on the bear's light head: one strip of label height, cut out of the art.
    const bear = at(260, 546)!
    expect(bear).toBe(at(330, 546))
    expect(bear.height).toBeLessThanOrEqual(14)
    expect(bear.x).toBeGreaterThanOrEqual(250)
    // The «found in raid» marks at the cells' bottom right are not labels.
    expect(at(160, 106)).toBeUndefined()
    expect(at(244, 106)).toBeUndefined()
    expect(at(664, 694)).toBeUndefined()
  })

  it('keys a label by its pixels, wherever it is on screen', () => {
    const boxes = labelBoxes(raster, 85)
    const label = boxes.find((box) => box.width > 40)!
    // The same picture moved 7 px right and 5 px down (a scrolled stash).
    const moved = new Uint8Array(raster.data.length)
    for (let y = 5; y < raster.height; y += 1) moved.set(raster.data.subarray(((y - 5) * raster.width) * 4, ((y - 5) * raster.width + raster.width - 7) * 4), (y * raster.width + 7) * 4)
    const shifted = { ...raster, data: moved }
    expect(stripKey(shifted, { ...label, x: label.x + 7, y: label.y + 5 })).toBe(stripKey(raster, label))
    expect(stripKey(raster, { ...label, x: label.x + 1 })).not.toBe(stripKey(raster, label))
    expect(samePrint(framePrint(raster), framePrint(raster))).toBe(true)
    expect(samePrint(framePrint(raster), framePrint(shifted))).toBe(false)
    expect(samePrint(null, framePrint(raster))).toBe(false)
  })
})

describe('Collector scan: reading the labels', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>
  beforeAll(async () => {
    const langPath = join(root, 'electron/tessdata')
    worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    // The app's settings (electron/collectorScan.ts).
    await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' })
  }, 60_000)
  afterAll(async () => { await worker?.terminate() })

  it('reads every Collector item in the container in one small picture, and nothing that is not there', async () => {
    const boxes = labelBoxes(raster, 85)
    const scale = labelScale(boxes)
    expect(scale).toBe(3)
    const stack = stackLabels(raster, boxes, scale, 3)
    // A few hundred pixels wide: the whole container is one OCR pass of well under a second.
    expect(stack.width).toBeLessThan(400)
    const pgm = Buffer.concat([Buffer.from(`P5\n${stack.width} ${stack.height}\n255\n`, 'ascii'), Buffer.from(stack.data)])
    const text = (await worker.recognize(pgm)).data.text ?? ''
    const ids = findVisibleItems(entries, text)
    const found = catalog.filter((entry) => ids.includes(entry.id)).map((entry) => entry.shortName)
    expect(found.filter((name) => !VISIBLE.includes(name))).toEqual([])
    // Measured 21/21 when written; a little room for Tesseract version differences.
    expect(found.length, `missed: ${VISIBLE.filter((name) => !found.includes(name)).join(', ')}\n${text}`).toBeGreaterThanOrEqual(VISIBLE.length - 2)
  }, 120_000)
})
