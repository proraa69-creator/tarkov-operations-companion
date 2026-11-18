import { afterEach, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import type { FleaReading, FleaReadRow } from '../import/fleaReading'
import { EUROS_ID } from '../import/fleaScreen'
import { clearScreenPrices, fleaRatesOf, noteFleaReading as note, PLAYER_PRICE_MS, screenPrices, setFleaCatalog, withScreenPrices } from './screenFleaPrices'
import type { LivePrices } from './livePrices'

const item = (id: string, name: string, extra: Partial<Item> = {}): Item => ({ id, name, shortName: name, category: 'Бартер', description: '', prices: [], ...extra })
const catalog = [
  item('tape', 'Изолента'), item('salt', 'Соль'), item('key', 'Ключ от комнаты 203', { category: 'Ключ', keyUses: 40 }), item('car', 'Ключ от автомобиля Yotota', { category: 'Ключ', keyUses: 10 }), item('m4', 'Винтовка M4A1', { category: 'Оружие' }),
]
let sentToServer: Array<[string, unknown]> = []
const noteFleaReading = (list: FleaReading, mode: Parameters<typeof note>[1]) => note(list, mode, async () => ({ '$': 140, '€': 190 }), async (to, sightings) => { sentToServer.push([to, sightings]) })
const row = (name: string, value: number, currency: '₽' | '$' | '€' = '₽', seller = 'Player', info = 'Всего 1'): FleaReadRow => ({ price: { kind: 'price', value, currency, sure: true, digits: String(value) }, seller, info, name })
const reading = (rows: FleaReadRow[], at = 1_000_000, labelMode: FleaReading['labelMode'] = 'pve'): FleaReading => ({ at, filters: [], label: '', labelMode, rows })

function useCatalog() {
  setFleaCatalog({ match: (name) => catalog.find((entry) => entry.name === name) ?? null })
}

afterEach(() => { setFleaCatalog(null); clearScreenPrices(); sentToServer = [] })

describe('flea prices from the player\'s screen', () => {
  it('go to the mode the game is in, and only when the version line does not name another', async () => {
    useCatalog()
    const list = reading([row('Изолента', 6000)])
    expect(await noteFleaReading(list, null)).toEqual({ skipped: 'mode-unknown' })
    expect(await noteFleaReading(list, 'pvp')).toEqual({ skipped: 'other-mode' })
    expect(await noteFleaReading(list, 'pve')).toMatchObject({ applied: [{ itemId: 'tape', price: 6000 }] })
    expect(screenPrices('pve', 1_000_000).get('tape')).toEqual({ price: 6000, at: 1_000_000 })
    expect(screenPrices('pvp', 1_000_000).size).toBe(0)
  })

  it('are in roubles at the game\'s rate, pass over the traders and leave out items whose copies differ', async () => {
    useCatalog()
    const result = await noteFleaReading(reading([row('Изолента', 10, '₽', '99 Прапор'), row('Ключ от комнаты 203', 3000), row('Соль', 150, '€'), row('Изолента', 7000)]), 'pve')
    expect(result).toMatchObject({ applied: [{ itemId: 'salt', price: 28500, listed: { value: 150, currency: '€' } }, { itemId: 'tape', price: 7000 }] })
  })

  it('take nothing before the catalog is there', async () => {
    expect(await noteFleaReading(reading([row('Изолента', 6000)]), 'pve')).toEqual({ skipped: 'no-catalog' })
  })

  it('stand over the server\'s for half an hour, then the server\'s again', async () => {
    useCatalog()
    await noteFleaReading(reading([row('Изолента', 6000)]), 'pve')
    const live: LivePrices = { items: new Map([['tape', { lastLowPrice: 9000, avg24hPrice: 8000, at: Math.floor(1_000_000 / 60_000) + 5 }], ['salt', { lastLowPrice: 100 }]]) }
    const over = withScreenPrices(live, 'pve', 1_000_000 + 60_000)!
    expect(over.items.get('tape')).toEqual({ lastLowPrice: 6000, avg24hPrice: 8000, at: Math.floor(1_000_000 / 60_000) })
    expect(over.items.get('salt')).toEqual({ lastLowPrice: 100 })
    expect(withScreenPrices(live, 'pve', 1_000_000 + PLAYER_PRICE_MS)).toBe(live)
    expect(withScreenPrices(live, 'pvp', 1_000_000)).toBe(live)
    // Off the server (no minute prices at all): the player's own still count.
    expect(withScreenPrices(null, 'pve', 1_000_000)?.items.get('tape')).toMatchObject({ lastLowPrice: 6000 })
  })

  it('keep the fresher of two readings of the same item', async () => {
    useCatalog()
    await noteFleaReading(reading([row('Изолента', 6000)], 2_000_000), 'pve')
    await noteFleaReading(reading([row('Изолента', 5000)], 1_500_000), 'pve')
    expect(screenPrices('pve', 2_000_000).get('tape')?.price).toBe(6000)
  })

  it('ask the rates once an hour for a mode, through the data gateway, Season as PvP', async () => {
    const queries: string[] = []
    const ask = (async (query: string) => {
      queries.push(query)
      return { data: { items: [{ id: EUROS_ID, buyFor: [{ vendor: { normalizedName: 'skier' }, priceRUB: 188 }] }] } }
    }) as unknown as Parameters<typeof fleaRatesOf>[2]
    expect(await fleaRatesOf('seasonal', 0, ask)).toEqual({ '€': 188 })
    expect(await fleaRatesOf('seasonal', 59 * 60_000, ask)).toEqual({ '€': 188 })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('gameMode: regular')
    await fleaRatesOf('pve', 0, ask)
    expect(queries[1]).toContain('gameMode: pve')
    // A gateway that fails: no rates, asked again next time.
    const failing = (async () => { throw new Error('down') }) as unknown as Parameters<typeof fleaRatesOf>[2]
    expect(await fleaRatesOf('pvp', 0, failing)).toEqual({})
    expect(await fleaRatesOf('pvp', 1, ask)).toEqual({ '€': 188 })
  })

  // Owner, 18.11.2026: «если у него 40 использований, должно быть 40… Если у него там 8 из 10 использований… не рассматриваем».
  it('take a key only offered with all its uses, as many as the catalog says it has', async () => {
    useCatalog()
    const result = await noteFleaReading(reading([
      row('Ключ от автомобиля Yotota', 1000, '₽', 'Player', 'Всего1 Ж 8/10'), row('Ключ от автомобиля Yotota', 2900, '₽', 'Player', 'Всего1 Ж 10/10'),
      row('Ключ от комнаты 203', 3000, '₽', 'Player', 'Всего1 Ж 40/48'),
    ]), 'pve')
    // The first offer of the car key is worn: its whole price is unknown (not the 2 900 ₽ below it).
    expect(result).toMatchObject({ applied: [{ itemId: 'key', price: 3000 }] })
    const short = await noteFleaReading(reading([row('Ключ от комнаты 203', 3500, '₽', 'Player', 'Всего1 Ж 10/10')], 2_000_000), 'pve')
    expect(short).toMatchObject({ applied: [] })
    const unread = await noteFleaReading(reading([row('Ключ от комнаты 203', 3500, '₽', 'Player', 'Всего 1')], 2_000_000), 'pve')
    expect(unread).toMatchObject({ applied: [] })
  })

  it('go to our server too, for the same mode: item, roubles and when seen only; the same price not again within 2 minutes', async () => {
    useCatalog()
    await noteFleaReading(reading([row('Изолента', 6000), row('Соль', 150, '€')]), 'pve')
    expect(sentToServer).toEqual([['pve', [{ itemId: 'tape', price: 6000, seenAt: 1_000_000 }, { itemId: 'salt', price: 28500, seenAt: 1_000_000 }]]])
    await noteFleaReading(reading([row('Изолента', 6000)], 1_060_000), 'pve')
    expect(sentToServer).toHaveLength(1)
    await noteFleaReading(reading([row('Изолента', 5900)], 1_070_000), 'pve')
    await noteFleaReading(reading([row('Изолента', 5900)], 1_070_000 + 2 * 60_000), 'pve')
    expect(sentToServer.slice(1)).toEqual([['pve', [{ itemId: 'tape', price: 5900, seenAt: 1_070_000 }]], ['pve', [{ itemId: 'tape', price: 5900, seenAt: 1_190_000 }]]])
    // Nothing read for sure, or another mode named on the screen: nothing sent.
    await noteFleaReading(reading([row('Изолента', 6000)], 2_000_000), 'pvp')
    expect(sentToServer).toHaveLength(3)
  })
})
