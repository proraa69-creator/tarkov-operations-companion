import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FleaPixels } from './fleaDigits'
import { DOLLARS_ID, EUROS_ID, wholeCondition, fleaFilterAllows, fleaFilterChips, fleaLayout, fleaModeFromLabel, fleaRates, fleaRowCount, fleaScreenState, fleaSightings, inRoubles, isTraderRow, readFleaPrice, readFleaPrices, type FleaPrice, type FleaRow } from './fleaScreen'

/**
 * The owner's flea screenshots of 18.11.2026 (1920×1080; only the parts the reader looks at kept, the rest black — see
 * scripts/make-flea-fixtures.mjs) with the prices they show. The digit samples (fleaDigitShapes.ts) were learnt from all
 * but HELD_OUT (scripts/build-flea-digits.mjs): those PvP and Season frames are read here by samples that never saw them.
 */
const HELD_OUT = ['pvp-locked-banner', 'season-weapons', 'season-info', 'season-ammo', 'season-short']
const dir = join(__dirname, '__fixtures__', 'flea')
type Label = null | 'dim' | 'banner' | { value: number; currency: string }
const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as Record<string, { mode: string; rows: Label[] }>
const sharp = createRequire(import.meta.url)('sharp') as (input: string | Buffer, options?: object) => {
  removeAlpha(): { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }> } }
  resize(width: number, height: number, options?: object): { png(): { toBuffer(): Promise<Buffer> } }
}
const frames = new Map<string, FleaPixels>()

async function decode(input: string | Buffer): Promise<FleaPixels> {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data, channels: 3, bgr: false }
}

beforeAll(async () => {
  for (const name of Object.keys(labels)) frames.set(name, await decode(join(dir, `${name}.webp`)))
})

/** Each labelled row's reading: right (sure and equal), unsure, or WRONG (sure and different) — never allowed. */
function check(name: string, readings: FleaPrice[]) {
  const outcome = { right: 0, unsure: 0, wrong: [] as string[], rows: 0 }
  labels[name]!.rows.forEach((label, row) => {
    const reading = readings[row]!
    if (label === null) { expect(reading.kind, `${name} row ${row}`).toBe('empty'); return }
    if (label === 'dim' || label === 'banner') { expect(reading.kind, `${name} row ${row}`).toBe(label); return }
    outcome.rows += 1
    if (reading.kind !== 'price' || !reading.sure) { outcome.unsure += 1; return }
    if (reading.value === label.value && reading.currency === label.currency) outcome.right += 1
    else outcome.wrong.push(`row ${row}: ${label.value} ${label.currency} read ${reading.value} ${reading.currency}`)
  })
  return outcome
}

describe('flea prices from the shapes of their digits', () => {
  it('never reads a price wrong for sure, on any frame', () => {
    for (const name of Object.keys(labels)) expect(check(name, readFleaPrices(frames.get(name)!)).wrong, name).toEqual([])
  })

  it('reads every price of the frames the samples were learnt from', () => {
    let right = 0, rows = 0
    for (const name of Object.keys(labels).filter((entry) => !HELD_OUT.includes(entry))) {
      const outcome = check(name, readFleaPrices(frames.get(name)!))
      right += outcome.right
      rows += outcome.rows
    }
    expect(rows).toBe(108)
    expect(right).toBe(108)
  })

  it('reads every price of the PvP and Season frames the samples never saw', () => {
    let right = 0, rows = 0
    for (const name of HELD_OUT) {
      const outcome = check(name, readFleaPrices(frames.get(name)!))
      right += outcome.right
      rows += outcome.rows
    }
    expect(rows).toBe(37)
    expect(right).toBe(37)
  })

  it('tells the currencies by their signs', () => {
    const first = (name: string) => readFleaPrices(frames.get(name)!)[0]
    expect(first('pve-usd')).toMatchObject({ kind: 'price', value: 100, currency: '$', sure: true })
    expect(first('pve-eur')).toMatchObject({ kind: 'price', value: 150, currency: '€', sure: true })
    expect(first('pve-keys')).toMatchObject({ kind: 'price', value: 1000, currency: '₽', sure: true })
  })

  it('reads a 3440×1440 screen too: the game\'s 16:9 menus in the middle, everything ×4/3', async () => {
    const scaled = await sharp(join(dir, 'pve-keys.webp')).resize(2560, 1440, { kernel: 'cubic' }).png().toBuffer()
    const wide = await decode(await (sharp as unknown as (options: object) => { composite(parts: object[]): { png(): { toBuffer(): Promise<Buffer> } } })({ create: { width: 3440, height: 1440, channels: 3, background: '#000' } })
      .composite([{ input: scaled, left: 440, top: 0 }]).png().toBuffer())
    const layout = fleaLayout(wide)
    expect(layout).toEqual({ left: 440, top: 0, unit: 4 / 3 })
    expect(fleaScreenState(wide, layout)).toEqual({ open: true, ascending: true, atTop: true, locked: false })
    const readings = Array.from({ length: 12 }, (_, row) => readFleaPrice(wide, row, layout))
    const outcome = check('pve-keys', readings)
    expect(outcome.wrong).toEqual([])
    // A frame resampled to this size, not the game drawn at it: a real 3440×1440 frame is still to be checked.
    expect(outcome.right).toBe(12)
  })
})

describe('the flea screen itself', () => {
  it('is open, cheapest first and at the list\'s start on every frame; locked only behind the level-15 banner', () => {
    for (const [name, pixels] of frames) {
      expect(fleaScreenState(pixels), name).toEqual({ open: true, ascending: true, atTop: true, locked: name === 'pvp-locked-banner' })
    }
  })

  it('is no flea at all on another screen', () => {
    const black: FleaPixels = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 3), channels: 3, bgr: false }
    expect(fleaScreenState(black)).toEqual({ open: false, ascending: false, atTop: false, locked: false })
  })

  it('sees the dearest first (the chevron turned down) and a list scrolled down', () => {
    const source = frames.get('pve-keys')!
    const data = Uint8Array.from(source.data as Uint8Array)
    const pixels: FleaPixels = { ...source, data }
    // The chevron upside down.
    const copy = Uint8Array.from(data)
    for (let y = 112; y < 132; y += 1) for (let x = 1424; x < 1446; x += 1) for (let c = 0; c < 3; c += 1) data[(y * 1920 + x) * 3 + c] = copy[((243 - y) * 1920 + x) * 3 + c]!
    // The scrollbar's thumb further down.
    for (let y = 140; y < 1020; y += 1) for (let x = 1862; x < 1880; x += 1) for (let c = 0; c < 3; c += 1) data[(y * 1920 + x) * 3 + c] = y > 400 && y < 600 && x >= 1868 && x <= 1873 ? 184 : 0
    expect(fleaScreenState(pixels)).toMatchObject({ open: true, ascending: false, atTop: false })
  })

  it('finds the filter chips by their «×» boxes, and lets through only those that keep the cheapest offer on top', () => {
    const at = (name: string) => fleaFilterChips(frames.get(name)!, fleaLayout(frames.get(name)!)).map((chip) => [chip.x, chip.width])
    expect(at('pve-keys')).toEqual([[608, 102], [726, 129]])
    expect(at('season-weapons')).toEqual([[608, 102], [726, 129]])
    expect(at('pve-eur')).toEqual([[608, 102], [725, 108]])
    // As the app's engine read each chip on the owner's 34 frames.
    for (const chip of ['Сост. от 100', 'Сост. от 108', 'Кроме бартера', 'Кроме бартера.']) expect(fleaFilterAllows(chip), chip).toBe(true)
    for (const chip of ['Валюта EUR', 'Валюта USD', 'Валюта GP', 'Цена от 1000', '']) expect(fleaFilterAllows(chip), chip).toBe(false)
  })

  it('has 12 rows above the menu bar at 1080p', () => {
    expect(fleaRowCount()).toBe(12)
  })
})

describe('the mode the version line names (only a check of the mode the app follows)', () => {
  it('reads the OCR of the owner\'s frames', () => {
    expect(fleaModeFromLabel('1.3.0.2.48779 | PvE')).toBe('pve')
    expect(fleaModeFromLabel('1.3.0.2.48779 | PvP S')).toBe('seasonal')
    expect(fleaModeFromLabel("1,3.0.2.48779'| PvP. S ~")).toBe('seasonal')
    expect(fleaModeFromLabel('1,3.0:2.48779.| PvP:S —')).toBe('seasonal')
    expect(fleaModeFromLabel('1.3.0.2.48779')).toBe('pvp')
    expect(fleaModeFromLabel('')).toBeNull()
    expect(fleaModeFromLabel('ГЛАВНОЕ МЕНЮ')).toBeNull()
  })

  it('reads them as the app engine does, Russian and English at once: «РУЕ», «РУР 5»', () => {
    expect(fleaModeFromLabel('1.5.0.2.48779 РУЕ')).toBe('pve')
    expect(fleaModeFromLabel('1.5.0.2.48779 РУР 5')).toBe('seasonal')
    expect(fleaModeFromLabel('1.5.0.2.48779')).toBe('pvp')
    // Something after the version that is none of the three: no check at all, never plain PvP.
    expect(fleaModeFromLabel('1.5.0.2.48779 РУ')).toBeNull()
    expect(fleaModeFromLabel(': / wrypmvupoc')).toBeNull()
  })
})

describe('the lowest price of each item on the list', () => {
  const price = (value: number, currency: '₽' | '$' | '€' | 'GP' = '₽', sure = true): FleaPrice => ({ kind: 'price', value, currency, sure, digits: String(value) })
  const player = (itemId: string | null, value: number, info = 'Всего 1', extra: Partial<FleaRow> = {}): FleaRow => ({ price: price(value), seller: 'SakurabaEmaa', info, itemId, ...extra })
  const trader = (itemId: string, value: number): FleaRow => ({ price: price(value), seller: 'Прапор', info: 'Всего 1645000 (лимит 6) ⚒ 100/100', itemId })

  it('takes each item\'s first player\'s offer, passing over the traders\' rows', () => {
    const result = fleaSightings([trader('flare', 2927), trader('smoke', 4585), player('shovel', 7332, 'Всего 1 ⚒ 65/65'), player('shovel', 7333), player('knife', 7777, 'Всего 1 ⚒ 40/40'), { price: { kind: 'empty' }, seller: '', info: '', itemId: null }])
    expect(result.sightings).toEqual([{ itemId: 'shovel', price: 7332, row: 2 }, { itemId: 'knife', price: 7777, row: 4 }])
    expect(result.stoppedAt).toEqual({ row: 5, reason: 'end' })
  })

  it('stops at the first row it cannot read for sure: a lower price of a later item could hide there', () => {
    expect(fleaSightings([player('a', 100), { ...player('b', 120), price: price(120, '₽', false) }, player('c', 130)])).toEqual({ sightings: [{ itemId: 'a', price: 100, row: 0 }], stoppedAt: { row: 1, reason: 'unsure' } })
    expect(fleaSightings([player('a', 100), player(null, 120), player('c', 130)]).stoppedAt).toEqual({ row: 1, reason: 'unknown-item' })
    expect(fleaSightings([player('a', 100), { ...player('b', 120), price: { kind: 'dim' } }, player('c', 130)]).stoppedAt).toEqual({ row: 1, reason: 'dim' })
    expect(fleaSightings([{ price: { kind: 'banner' }, seller: '', info: '', itemId: null }, player('a', 100)])).toEqual({ sightings: [], stoppedAt: { row: 0, reason: 'banner' } })
  })

  it('passes over a dim trader\'s row (a level not reached) and keeps reading', () => {
    const dimTrader: FleaRow = { price: { kind: 'dim' }, seller: 'Миротворец', info: 'Всего 380000 (лимит 3)', itemId: null }
    expect(fleaSightings([dimTrader, player('a', 100)]).sightings).toEqual([{ itemId: 'a', price: 100, row: 1 }])
  })

  it('gives no price for an item first offered worn, or of the kinds whose copies differ', () => {
    const rows = [
      player('juice', 14444, 'Всего 1 Ж 30/40'), player('juice', 16666, 'Всего 9 Ж 40/40'),
      player('m4', 50000, 'Всего 1 ⚒ 100/100'),
      player('tape', 6000),
    ]
    expect(fleaSightings(rows, (id) => id === 'm4').sightings).toEqual([{ itemId: 'tape', price: 6000, row: 3 }])
  })

  it('gives every price in roubles: dollars and euros at the rate of the game, nothing without one', () => {
    const rows = [
      { ...player('soap', 200), price: price(200, '€') }, player('soap', 30000),
      { ...player('salt', 150), price: price(150, '$') },
      { ...player('coin', 3), price: price(3, 'GP') },
      player('tape', 6000),
    ]
    const rates = { '$': 140, '€': 190 }
    expect(fleaSightings(rows, undefined, rates).sightings).toEqual([
      { itemId: 'soap', price: 38000, row: 0, listed: { value: 200, currency: '€' } },
      { itemId: 'salt', price: 21000, row: 2, listed: { value: 150, currency: '$' } },
      { itemId: 'tape', price: 6000, row: 4 },
    ])
    // No rate known yet (no catalog): the soap's cheapest offer in roubles is unknown — not the 30 000 ₽ below it.
    expect(fleaSightings(rows).sightings).toEqual([{ itemId: 'tape', price: 6000, row: 4 }])
  })

  it('takes the rates of the game from what the traders ask for the money, not from the handbook', () => {
    // json.tarkov.dev 18.11.2026: Peacekeeper's dollar 168 ₽, Skier's euro 188 ₽ (the handbook's: 122 ₽ and 132 ₽).
    const items = [
      { id: DOLLARS_ID, buyFor: [{ vendor: { normalizedName: 'peacekeeper' }, priceRUB: 168 }, { vendor: { normalizedName: 'flea-market' }, priceRUB: 150 }] },
      { id: EUROS_ID, buyFor: [{ vendor: { normalizedName: 'skier' }, priceRUB: 188 }] },
    ]
    expect(fleaRates(items)).toEqual({ '$': 168, '€': 188 })
    expect(fleaRates([])).toEqual({})
    expect(fleaRates([{ id: EUROS_ID, buyFor: [{ vendor: { normalizedName: 'skier' }, priceRUB: 0 }, null] }, null])).toEqual({})
    expect(inRoubles(317, '€', { '€': 190.4 })).toBe(60357)
    expect(inRoubles(5, 'GP', { '$': 140, '€': 190 })).toBeNull()
  })

  it('agrees with the order of the flea itself: on a Season frame of the owner 336 € lies between 61 666 ₽ and 65 420 ₽', () => {
    const rows = labels['season-info']!.rows
    expect(rows.slice(8, 11)).toEqual([{ value: 61666, currency: '₽' }, { value: 336, currency: '€' }, { value: 65420, currency: '₽' }])
    // So the game's euro was 183.5–194.7 ₽ that day in Season: Skier's 188 ₽ fits, the handbook's 132 ₽ does not.
    expect(61666 / 336).toBeLessThan(188)
    expect(65420 / 336).toBeGreaterThan(188)
    expect(61666 / 336).toBeGreaterThan(132)
  })

  it('knows the traders by name or by their «(лимит N)»', () => {
    for (const name of ['Прапор', 'Егерь', 'Лыжник', 'Механик', 'Миротворец', 'Барахольщик', 'Терапевт', 'Реф', 'Prapor', 'Jaeger']) expect(isTraderRow(name, ''), name).toBe(true)
    expect(isTraderRow('Unknown_SELLER', 'Всего 2440000 (лимит 6)')).toBe(true)
    expect(isTraderRow('SakurabaEmaa', 'Всего 1 ⚒ 65/65')).toBe(false)
  })

  it('knows them beside their level badge, by «(лимит N)» read badly, and by their stock', () => {
    for (const seller of ['99 Прапор', 'EF Прапор', 'Егерь Е:', 'Реф AK', '№ Механик №', 'Барахольщик има']) expect(isTraderRow(seller, ''), seller).toBe(true)
    expect(isTraderRow('Pech', 'Всего 1285088 ar')).toBe(true)
    expect(isTraderRow('x', 'Всего 5790000 (numut 249)')).toBe(true)
    expect(isTraderRow('x', 'Всего 1770008 (rum 12)')).toBe(true)
    // A nickname with a trader in it is a player.
    expect(isTraderRow('Prapor_fan', 'Всего 1')).toBe(false)
    expect(isTraderRow('Прапорщик', 'Всего 2 ⚒ 40/40')).toBe(false)
    expect(isTraderRow('ТерапевтПВЕ', 'Всего 24')).toBe(false)
  })

  it('takes a condition for whole when its two numbers agree but for a 0 read as 8, 9 or 6', () => {
    for (const info of ['Всего1 Ж 40/48', 'Всего1 Ж 49/40', 'Всего1 Ж 100/190', 'Всего1 Ж 180/100', 'Всего 8', 'Всего1 Ж 85/85']) expect(wholeCondition(info), info).toBe(true)
    for (const info of ['Всего1 Ж 30/40', 'Всего1 Ж 90/980', 'Всего 4 Ж 358/38', 'Всего1 Ж 60/100']) expect(wholeCondition(info), info).toBe(false)
  })
})
