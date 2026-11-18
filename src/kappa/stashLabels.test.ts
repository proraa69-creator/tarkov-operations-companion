// @vitest-environment node
/**
 * The stash scan on the owner's own stash (owner, 19.11.2026, Season: «плохо сканирует экран, находит не все предметы.
 * Например, КШС… на экране он есть»). The frame: the stash around the cursor at 3440×1440 (cells of 85 px), as the item
 * lookup logged it on 15.11.2026. Measured before the fix: «КШС» read «KLUC» or «KWC» and matched nothing; «SE-5»,
 * «SSVFK», «ПБС-1» not found as labels at all (their letters fell apart); «CBAC пер.» taken out as a print on a picture;
 * «Survil2» not Surv12.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { countScreenItems } from '../stashScan/screenSync'
import { screenEntries } from './collector'
import { labelFold, labelScore } from './collectorMatch'
import { createLabelReader, type PictureLine } from './labelReader'
import { labelBoxes, type Raster } from './labelScan'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default
const { createWorker } = require('tesseract.js') as { createWorker: (langs: string, oem: number, options: Record<string, unknown>) => Promise<{ setParameters: (params: Record<string, string>) => Promise<unknown>; recognize: (image: Buffer, options: object, output: object) => Promise<{ data: { blocks?: Array<{ paragraphs: Array<{ lines: Array<{ text: string; bbox: { y0: number; y1: number } }> }> }> } }>; terminate: () => Promise<unknown> }> }

const root = join(__dirname, '../..')
const catalog = JSON.parse(readFileSync(join(__dirname, '__fixtures__/stash-items.json'), 'utf8')) as Item[]
const byLabel = (label: string) => catalog.find((item) => item.shortName === label)!

let stash: Raster

beforeAll(async () => {
  const { data, info } = await sharp(join(__dirname, '__fixtures__/stash-1440p.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  stash = { width: info.width, height: info.height, data: new Uint8Array(data), order: 'rgba' }
})

/** The stash where it was on the game's 3440×1440 picture, the rest of the picture dark (the reader sizes cells by it). */
function gamePicture(): Raster {
  const width = 3440, height = 1440, left = 900, top = 400
  const data = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p += 1) data.set([8, 10, 12, 255], p * 4)
  for (let y = 0; y < stash.height; y += 1) data.set(stash.data.subarray(y * stash.width * 4, (y + 1) * stash.width * 4), ((y + top) * width + left) * 4)
  return { width, height, data, order: 'rgba' }
}

describe('stash labels: the strips', () => {
  it('finds a label whose letters fall apart («SE-5», «SSVFK», «ПБС-1») whole', () => {
    const boxes = labelBoxes(stash, 85)
    const at = (x: number, y: number) => boxes.find((box) => box.x <= x && x < box.x + box.width && box.y <= y && y < box.y + box.height)
    // «SE-5»: «SE», «-» and «5» are pieces of their own; one strip from the S to the 5.
    const se5 = at(414, 455)!
    expect(se5).toBeDefined()
    expect(se5.x).toBeLessThanOrEqual(413)
    expect(se5.x + se5.width).toBeGreaterThanOrEqual(445)
    // «SSVFK» from its first S, «ПБС-1» to its 1, «GRAL-S» to its S.
    expect(at(573, 455)?.x).toBeLessThanOrEqual(572)
    expect(at(330, 539)!.x + at(330, 539)!.width).toBeGreaterThanOrEqual(360)
    expect(at(150, 203)!.x + at(150, 203)!.width).toBeGreaterThanOrEqual(192)
    // Not the round «found in raid» marks with the icon beside them, nor a long line of the tooltip's letters with art.
    expect(boxes.every((box) => box.height <= 16)).toBe(true)
  })
})

describe('stash labels: matching what OCR reads', () => {
  const entries = screenEntries(new Map(catalog.map((item) => [item.id, 1])), catalog)
  // Labels, once each (the cartridge and its pack are both «ЭКО»).
  const found = (text: string) => [...new Set([...countScreenItems(entries, text).keys()].map((id) => catalog.find((item) => item.id === id)!.shortName))]

  it('reads «КШС» as Tesseract writes it: «KLUC», «KWC»', () => {
    expect(labelFold('КШС')).toBe(labelFold('KLUC'))
    expect(labelScore(byLabel('КШС'), 'KWC')).toBe(0.9)
    expect(labelScore(byLabel('КШС'), 'KLLIC')).toBe(0.9)
    expect(found('KLUC\nKWC')).toEqual(['КШС'])
  })

  it('takes 1 for l or i, Э for 3, п for n', () => {
    expect(found('Survil2')).toEqual(['Surv12'])
    expect(found('3KO')).toEqual(['ЭКО'])
    expect(found('CBAC nep.')).toEqual(['СВДС пер.'])
  })

  it('keeps a label\'s own word in capitals («СВДС пер.»), still not a brand printed on a picture', () => {
    expect(found('CBAC пер.')).toEqual(['СВДС пер.'])
    expect(found('SALEWA')).toEqual([])
    expect(found('Salewa')).toEqual(['Salewa'])
  })

  it('gives a label of several words to the item it names whole', () => {
    expect(found('TK FAST MT')).toEqual(['TK FAST MT'])
    expect(found('FAST MT')).toEqual(['FAST MT'])
  })

  it('does not stretch the short names: two or three letters only whole', () => {
    expect(labelScore(byLabel('КШС'), 'KUC')).toBe(0)
    expect(labelScore(byLabel('КШС'), 'KLUCK')).toBe(0)
  })
})

describe('stash labels: the scan reads them', () => {
  let worker: Awaited<ReturnType<typeof createWorker>>
  beforeAll(async () => {
    const langPath = join(root, 'electron/tessdata')
    worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    // The app's settings (electron/collectorScan.ts).
    await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' })
  }, 60_000)
  afterAll(async () => { await worker?.terminate() })

  it('finds «КШС» and the other items of the owner\'s stash with the app\'s own steps', async () => {
    const reader = createLabelReader(async (picture) => {
      const pgm = Buffer.concat([Buffer.from(`P5\n${picture.width} ${picture.height}\n255\n`, 'ascii'), Buffer.from(picture.data)])
      const result = await worker.recognize(pgm, {}, { blocks: true })
      return (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
        .map((line): PictureLine => ({ text: line.text, top: line.bbox.y0, bottom: line.bbox.y1 }))
    })
    reader.reset(catalog.map((item) => item.shortName ?? ''))
    const frame = gamePicture()
    const texts: string[] = []
    for (let pass = 0; pass < 5; pass += 1) {
      const reading = await reader.readFrame(frame)
      texts.push(reading.text)
      if (!reading.pending) break
    }
    const text = texts.join('\n')
    const entries = screenEntries(new Map(catalog.map((item) => [item.id, 1])), catalog)
    const seen = [...new Set([...countScreenItems(entries, text).keys()].map((id) => catalog.find((item) => item.id === id)!.shortName!))]
    const visible = ['КШС', 'SE-5', 'SSVFK', 'ПБС-1', 'GRAL-S', 'Surv12', 'ЭКО', 'СВДС пер.', 'TK FAST MT', 'СП-5', 'AFAK', 'Евро', 'Аленка', 'Певко', 'MIAD', 'Флешка', 'Пропитал', 'РК-1', 'ОСкоп', 'BGV-QDK', 'MOE RBP', 'TCS 20', 'ЭП подс.']
    expect(seen.filter((label) => !visible.includes(label!)), text).toEqual([])
    expect(seen, text).toContain('КШС')
    // Measured 23/23 when written; a little room for Tesseract version differences.
    expect(seen.length, `missed: ${visible.filter((label) => !seen.includes(label)).join(', ')}\n${text}`).toBeGreaterThanOrEqual(visible.length - 2)
  }, 120_000)
})
