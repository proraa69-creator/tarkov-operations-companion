// @vitest-environment node
/**
 * The item key on crops of real lookups the app logged (players' screens, 1440p, Oct–Nov 2026): long names the game
 * wraps onto two lines, a «WD-40» read with slashes, an inventory cell once taken for a tooltip, and items found by
 * their picture against the picture index of the whole catalog (public/item-signatures.bin).
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { screenPicture } from './iconMatch'
import { findItemFrames } from './itemCell'
import { rankByIndex } from './pictureIndex'
import { decodeSignatureIndex, SIGNATURE_INDEX_FILE } from './signatureIndex'
import { findTooltipAtScales, ocrVariants, TOOLTIP_OCR_PARAMETERS, TOOLTIP_SCALES, type Bitmap } from './tooltipDetect'
import { createTooltipMatcher, type ItemNameVariant } from './tooltipMatch'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default
const { createWorker } = require('tesseract.js') as { createWorker: (langs: string, oem: number, options: Record<string, unknown>) => Promise<{ setParameters: (params: Record<string, string>) => Promise<unknown>; recognize: (image: Buffer) => Promise<{ data: { text?: string } }>; terminate: () => Promise<unknown> }> }

const root = join(__dirname, '../..')
const fixtures = join(__dirname, '__fixtures__/item-lookup-logged')
/** The players' screen: 1440p (one 1080p pixel = 4/3 px). */
const UNIT = 4 / 3

async function load(file: string): Promise<Bitmap> {
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

/** The screen's own scale first, then the others (the order the app tries them in when nothing is remembered). */
const SCALES = [1, ...TOOLTIP_SCALES.filter((factor) => factor !== 1)]

/** Tooltip crops (the box with 6 px around it) and where the cursor was, in the crop. */
const TOOLTIPS = [
  { file: 'vepr-two-lines.png', cursor: { x: -10, y: 89 }, id: '5c501a4d2e221602b412b540' },
  { file: 'bender-two-lines.png', cursor: { x: -9, y: 87 }, id: '61714eec290d254f5e6b2ffc' },
  { file: 'osprey-two-lines.png', cursor: { x: -11, y: 88 }, id: '60a3c70cde5f453f634816a3' },
  { file: 'wd40.png', cursor: { x: -12, y: 66 }, id: '590c5bbd86f774785762df04' },
  // A trader's screen (report 183): the name over a yellow price row «₽ 42 344».
  { file: 'trader-loot-lord.png', cursor: { x: -10, y: 85 }, id: '60b0f7057897d47c5b04ab94' },
]

/** The catalog's names around these items, look-alikes and presets included (json.tarkov.dev, 15.11.2026). */
const CATALOG: Array<{ id: string; name: string; shortName: string; nameEn: string; shortNameEn: string }> = [
  { id: '590c31c586f774245e3141b2', name: 'Пачка гвоздей', shortName: 'Гвозди', nameEn: 'Pack of nails', shortNameEn: 'Nails' },
  { id: '590c5bbd86f774785762df04', name: 'WD-40 (100мл)', shortName: 'WD-40', nameEn: 'WD-40 (100ml)', shortNameEn: 'WD-40' },
  { id: '590c5c9f86f77477c91c36e7', name: 'WD-40 (400мл)', shortName: 'WD-40', nameEn: 'WD-40 (400ml)', shortNameEn: 'WD-40' },
  { id: '5c501a4d2e221602b412b540', name: 'Карабин Молот ВПО-101 "Вепрь-Хантер" 7.62x51', shortName: 'ВПО-101 "Вепрь-Хантер"', nameEn: 'Molot Arms VPO-101 Vepr-Hunter 7.62x51 carbine', shortNameEn: 'VPO-101' },
  { id: '5c98bf9186f7740cf708c509', name: 'Карабин Молот ВПО-101 "Вепрь-Хантер" 7.62x51 По умолчанию', shortName: 'ВПО-101 "Вепрь-Хантер" По умолчанию', nameEn: 'Molot Arms VPO-101 Vepr-Hunter 7.62x51 carbine Default', shortNameEn: 'VPO-101 Default' },
  { id: '707265736574000000000018', name: 'Карабин Молот ВПО-101 "Вепрь-Хантер" 7.62x51 СВД', shortName: 'ВПО-101 "Вепрь-Хантер" СВД', nameEn: 'Molot Arms VPO-101 Vepr-Hunter 7.62x51 carbine SVD', shortNameEn: 'VPO-101 SVD' },
  { id: '5d1b3f2d86f774253763b735', name: 'Шприц в упаковке', shortName: 'Шприц', nameEn: 'Disposable syringe', shortNameEn: 'Syringe' },
  { id: '60a3c68c37ea821725773ef5', name: 'Чехол для бронеплит CQC Osprey MK4A (Protection, MTP)', shortName: 'Osprey MK4A (P)', nameEn: 'CQC Osprey MK4A plate carrier (Protection, MTP)', shortNameEn: 'Osprey MK4A (P)' },
  { id: '60a3c70cde5f453f634816a3', name: 'Чехол для бронеплит CQC Osprey MK4A (Assault, MTP)', shortName: 'Osprey MK4A (A)', nameEn: 'CQC Osprey MK4A plate carrier (Assault, MTP)', shortNameEn: 'Osprey MK4A (A)' },
  { id: '657194c0289dc422160e08d1', name: 'Чехол для бронеплит CQC Osprey MK4A (Assault, MTP) По умолчанию', shortName: 'Osprey MK4A (A) По умолчанию', nameEn: 'CQC Osprey MK4A plate carrier (Assault, MTP) Default', shortNameEn: 'Osprey MK4A (A) Default' },
  { id: '657664ae303700411c02428c', name: 'Чехол для бронеплит CQC Osprey MK4A (Protection, MTP) По умолчанию', shortName: 'Osprey MK4A (P) По умолчанию', nameEn: 'CQC Osprey MK4A plate carrier (Protection, MTP) Default', shortNameEn: 'Osprey MK4A (P) Default' },
  { id: '61714eec290d254f5e6b2ffc', name: 'Оптический прицел 34мм Schmidt & Bender PM II 3-20x50', shortName: 'PM II 3-20x50', nameEn: 'Schmidt & Bender PM II 3-20x50 34mm riflescope', shortNameEn: 'PM II 3-20' },
  { id: '617151c1d92c473c770214ab', name: 'Оптический прицел 30мм Schmidt & Bender PM II 1-8x24', shortName: 'PM II 1-8x24', nameEn: 'Schmidt & Bender PM II 1-8x24 30mm riflescope', shortNameEn: 'PM II 1-8' },
  { id: '62850c28da09541f43158cca', name: 'Оптический прицел 34мм Schmidt & Bender PM II 5-25x56', shortName: 'PM II 5-25x56', nameEn: 'Schmidt & Bender PM II 5-25x56 34mm riflescope', shortNameEn: 'PM II 5-25' },
  { id: '60b0f7057897d47c5b04ab94', name: 'Плюшевая игрушка Loot Lord', shortName: 'Loot Lord', nameEn: 'Loot Lord plushie', shortNameEn: 'Loot Lord' },
  { id: '69774bb0a247161ff1068335', name: 'Банка утиного паштета', shortName: 'Паштет', nameEn: 'Can of duck pate', shortNameEn: 'Pâté' },
]

describe('long names the game wraps onto two lines', () => {
  it('finds the two-line box at the screen\'s own scale and gives the OCR one line', async () => {
    for (const entry of TOOLTIPS.filter((tooltip) => tooltip.file.includes('two-lines'))) {
      const image = await load(entry.file)
      const found = findTooltipAtScales(image, entry.cursor, UNIT, SCALES)
      expect(found, entry.file).not.toBeNull()
      const [first] = ocrVariants(image, found!.rect, entry.cursor, found!.unit)
      // Both lines side by side: far wider than tall (one line of text).
      expect(first!.width / first!.height, entry.file).toBeGreaterThan(10)
    }
  })

  it('never takes an inventory cell with its label for a tooltip (logged: «Гвозди» at 2×)', async () => {
    const image = await load('cell-not-tooltip.png')
    expect(findTooltipAtScales(image, { x: 37, y: 138 }, UNIT, SCALES)).toBeNull()
  })
})

describe('a trader\'s tooltip: the name over a price row (report 183, «Предмет не распознан» while selling)', () => {
  const CURSOR = { x: -10, y: 85 }
  /** The crop's rows: the name 13–28, the price 36–57, inside the frame 9–63. */
  const paint = (image: Bitmap, x0: number, x1: number, y0: number, y1: number) => {
    const from = (11 * image.width + 20) * 4
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) image.data.set(image.data.subarray(from, from + 4), (y * image.width + x) * 4)
  }

  it('finds the box and gives the OCR the name alone, one line', async () => {
    const image = await load('trader-loot-lord.png')
    const found = findTooltipAtScales(image, CURSOR, UNIT, SCALES)
    expect(found).not.toBeNull()
    const [first] = ocrVariants(image, found!.rect, CURSOR, found!.unit)
    // The name line only: about one line of text high (the price row left out).
    expect(first!.height).toBeLessThan(25 * UNIT * 4)
    // No pixel of the price row is drawn: the right part of the picture under the name's middle stays white below the text.
    expect(first!.width / first!.height).toBeGreaterThan(6)
  })

  it('a short name over a wider price row is still a tooltip', async () => {
    const image = await load('trader-loot-lord.png')
    // «Плюшевая» only: the box is as wide as before, the name ends far from its right side.
    paint(image, 100, 284, 10, 33)
    expect(findTooltipAtScales(image, CURSOR, UNIT, SCALES)).not.toBeNull()
  })

  it('a long name the game wrapped, with the price under it (three rows, ~60 px at 1080p)', async () => {
    const source = await load('trader-loot-lord.png')
    // The name's rows once more under the first: name, name, price.
    const extra = 18
    const height = source.height + extra
    const data = new Uint8Array(source.width * height * 4)
    const row = source.width * 4
    data.set(source.data.subarray(0, 31 * row), 0)
    data.set(source.data.subarray(13 * row, 31 * row), 31 * row)
    data.set(source.data.subarray(31 * row), (31 + extra) * row)
    const image = { width: source.width, height, data }
    const found = findTooltipAtScales(image, { x: CURSOR.x, y: CURSOR.y + extra }, UNIT, SCALES)
    expect(found).not.toBeNull()
    const [first] = ocrVariants(image, found!.rect, { x: CURSOR.x, y: CURSOR.y + extra }, found!.unit)
    // The two name lines side by side: one line of text for the OCR.
    expect(first!.width / first!.height).toBeGreaterThan(12)
  })
})

describe('reading logged tooltips with the app\'s OCR', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>
  const items = CATALOG.map((entry) => ({ id: entry.id, name: entry.name, shortName: entry.shortName, prices: [] }) as unknown as Item)
  const english = new Map<string, ItemNameVariant[]>(CATALOG.map((entry) => [entry.id, [{ name: entry.nameEn, shortName: entry.shortNameEn }]]))
  const match = createTooltipMatcher(items, english)

  beforeAll(async () => {
    const langPath = join(root, 'electron/tessdata')
    worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    await worker.setParameters(TOOLTIP_OCR_PARAMETERS)
  }, 60_000)
  afterAll(async () => { await worker?.terminate() })

  it('names each item from its first reading (the app logged these as «not found» or found only after 2–3 s)', async () => {
    const results: Array<{ file: string; got: string | null; read: string[] }> = []
    for (const entry of TOOLTIPS) {
      const image = await load(entry.file)
      const found = findTooltipAtScales(image, entry.cursor, UNIT, SCALES)
      const read: string[] = []
      let got: string | null = null
      for (const variant of found ? ocrVariants(image, found.rect, entry.cursor, found.unit) : []) {
        const text = ((await worker.recognize(await png(variant))).data.text ?? '').replace(/\s+/g, ' ').trim()
        read.push(text)
        got = text ? match(text)?.id ?? null : null
        if (got) break
      }
      results.push({ file: entry.file, got, read })
      expect(got, JSON.stringify({ file: entry.file, read })).toBe(entry.id)
    }
  }, 120_000)
})

describe('the picture search against the whole catalog', () => {
  const index = decodeSignatureIndex(new Uint8Array(readFileSync(join(root, 'public', SIGNATURE_INDEX_FILE))))!

  it('ships an index of the catalog items with a picture', () => {
    expect(index.items.length).toBeGreaterThan(4000)
    expect(new Set(index.items.map((item) => item.id)).size).toBe(index.items.length)
  })

  it('names items by their picture alone, and gives no wrong answer', async () => {
    const cases = [
      { file: 'stash-pate-syringe.png', cursor: { x: 80, y: 120 }, id: '69774bb0a247161ff1068335' },
      { file: 'stash-pate-syringe.png', cursor: { x: 160, y: 120 }, id: '5d1b3f2d86f774253763b735' },
    ]
    for (const entry of cases) {
      const image = await load(entry.file)
      const verdict = rankByIndex(screenPicture(image, findItemFrames(image, entry.cursor, UNIT, null), { backdrop: true }), index)
      expect(verdict.id, `${entry.file} ${JSON.stringify(verdict.nearby.slice(0, 3))}`).toBe(entry.id)
    }
  })
})
