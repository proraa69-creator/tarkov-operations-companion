// @vitest-environment node
/**
 * The whole item-info pipeline on rendered game-like screens: find the tooltip → prepare it → Tesseract (the app's
 * settings and language data) → match against a catalog slice full of look-alikes (magazines differing in capacity,
 * dorm keys 204/220/228, «PM» pistol and magazine…). The pictures come from scripts/item-lookup-bench.mjs --export
 * (Bender font, 1080p and 1440p, Russian and English names, big items, the mouse arrow over the tooltip).
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { findTooltip, ocrVariants, TOOLTIP_OCR_PARAMETERS, type Bitmap } from './tooltipDetect'
import { createTooltipMatcher, type ItemNameVariant } from './tooltipMatch'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default
const { createWorker } = require('tesseract.js') as { createWorker: (langs: string, oem: number, options: Record<string, unknown>) => Promise<{ setParameters: (params: Record<string, string>) => Promise<unknown>; recognize: (image: Buffer) => Promise<{ data: { text?: string } }>; terminate: () => Promise<unknown> }> }

const root = join(__dirname, '../..')
const fixtures = join(__dirname, '__fixtures__/item-lookup')
interface Case { file: string; id: string; text: string; lang: string; short: boolean; cursor: { x: number; y: number }; unit: number }
interface Entry { id: string; name: string; shortName: string; nameEn: string; shortNameEn: string }
const cases = JSON.parse(readFileSync(join(fixtures, 'cases.json'), 'utf8')) as Case[]
const catalog = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as Entry[]

async function loadBitmap(file: string): Promise<Bitmap> {
  const { data, info } = await sharp(join(fixtures, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bgra = new Uint8Array(data.length)
  for (let index = 0; index < data.length; index += 4) { bgra[index] = data[index + 2]!; bgra[index + 1] = data[index + 1]!; bgra[index + 2] = data[index]!; bgra[index + 3] = 255 }
  return { width: info.width, height: info.height, data: bgra }
}

async function png(bitmap: Bitmap) {
  const rgba = Buffer.alloc(bitmap.data.length)
  for (let index = 0; index < rgba.length; index += 4) { rgba[index] = bitmap.data[index + 2]!; rgba[index + 1] = bitmap.data[index + 1]!; rgba[index + 2] = bitmap.data[index]!; rgba[index + 3] = 255 }
  return sharp(rgba, { raw: { width: bitmap.width, height: bitmap.height, channels: 4 } }).png().toBuffer()
}

describe('item info lookup on game-like screens', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>
  const items = catalog.map((entry) => ({ id: entry.id, name: entry.name, shortName: entry.shortName }) as Item)
  const english = new Map<string, ItemNameVariant[]>(catalog.map((entry) => [entry.id, [{ name: entry.nameEn, shortName: entry.shortNameEn }]]))
  const match = createTooltipMatcher(items, english)

  beforeAll(async () => {
    const langPath = join(root, 'electron/tessdata')
    worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    await worker.setParameters(TOOLTIP_OCR_PARAMETERS)
  }, 60_000)
  afterAll(async () => { await worker?.terminate() })

  it('finds, reads and names the hovered item — and never names a wrong one', async () => {
    const results: Array<{ file: string; expected: string | null; got: string | null; read: string[] }> = []
    for (const entry of cases) {
      const image = await loadBitmap(entry.file)
      const rect = findTooltip(image, entry.cursor, entry.unit)
      const read: string[] = []
      let got: string | null = null
      if (rect) {
        for (const variant of ocrVariants(image, rect, entry.cursor, entry.unit)) {
          const text = ((await worker.recognize(await png(variant))).data.text ?? '').replace(/\s+/g, ' ').trim()
          read.push(text)
          const item = text ? match(text) : null
          if (item) { got = item.id; break }
        }
      }
      // A short name several items share («СВ-98»: the rifle and its magazine) must give no answer.
      const owners = catalog.filter((item) => [item.shortName, item.shortNameEn].some((name) => name.toLowerCase() === entry.text.toLowerCase()))
      results.push({ file: entry.file, expected: entry.short && owners.length > 1 ? null : entry.id, got, read })
    }
    const wrong = results.filter((result) => result.got && result.got !== result.expected)
    const correct = results.filter((result) => result.got === result.expected)
    expect(wrong).toEqual([])
    // Measured 35/35 when written; a little room for Tesseract version differences.
    expect(correct.length, JSON.stringify(results.filter((result) => result.got !== result.expected), null, 1)).toBeGreaterThanOrEqual(Math.ceil(cases.length * 0.9))
  }, 180_000)
})
