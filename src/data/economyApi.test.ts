import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphqlCalls: string[] = []
const cache = new Map<string, unknown>()
let answer: (query: string) => unknown = () => ({})

vi.mock('./tarkovApi', () => ({
  tarkovGraphql: vi.fn(async (query: string) => { graphqlCalls.push(query); return { data: answer(query) } }),
}))
vi.mock('./gameDataCache', () => ({
  readGameCache: vi.fn(async (key: string) => cache.get(key)),
  writeGameCache: vi.fn(async (key: string, value: unknown) => { cache.set(key, value) }),
}))

const { economyQueries, fetchEconomySnapshot, fetchPriceHistory, parseEconomyResponse, SeasonPricesUnavailable } = await import('./economyApi')
const { bestSell, cheapestBuy, fleaPrice } = await import('../domain/economy')

/** One GPU priced differently per mode, so a mix-up would show. */
const pricesFor = (query: string) => {
  const pve = /gameMode: pve/.test(query)
  if (/\bbarters\(/.test(query)) return { barters: [{ id: 'b1', level: 1, trader: { id: 't', name: 'Механик' }, requiredItems: [{ item: { id: 'gpu' }, count: 1 }], rewardItems: [{ item: { id: 'gpu' }, count: 1 }] }] }
  if (/\bcrafts\(/.test(query)) return { crafts: [] }
  return {
    fleaMarket: { enabled: true, sellOfferFeeRate: 0.03, sellRequirementFeeRate: 0.03 },
    items: [{ id: 'gpu', name: 'Видеокарта', shortName: 'GPU', basePrice: 100000, lastLowPrice: pve ? 410000 : 600000, avg24hPrice: pve ? 430000 : 640000, types: [], buyFor: [], sellFor: [] }],
  }
}

beforeEach(() => {
  graphqlCalls.length = 0
  cache.clear()
  answer = pricesFor
})

describe('economy data per mode', () => {
  it('every query of a mode asks tarkov.dev for that mode only', () => {
    for (const [gameMode, other] of [['regular', 'pve'], ['pve', 'regular']] as const) {
      const text = Object.values(economyQueries(gameMode, 'ru')).join('\n')
      expect(text.match(/gameMode: \w+/g)?.every((entry) => entry === `gameMode: ${gameMode}`)).toBe(true)
      expect(text).not.toContain(`gameMode: ${other}`)
    }
  })

  it('PvP and PvE snapshots are fetched and cached apart; a cached copy of another mode is never served', async () => {
    const pvp = await fetchEconomySnapshot('pvp', 'ru')
    const pve = await fetchEconomySnapshot('pve', 'ru')
    expect([pvp.mode, pvp.items.gpu?.lastLowPrice]).toEqual(['pvp', 600000])
    expect([pve.mode, pve.items.gpu?.lastLowPrice]).toEqual(['pve', 410000])
    expect([...cache.keys()]).toEqual(['tarkov-operations-economy-v1-pvp-ru', 'tarkov-operations-economy-v1-pve-ru'])
    expect(graphqlCalls.slice(0, 3).every((query) => !/gameMode: pve/.test(query))).toBe(true)
    expect(graphqlCalls.slice(3).every((query) => /gameMode: pve/.test(query))).toBe(true)

    // Offline: a PvE snapshot sitting under the PvP key (e.g. written by an old build) is refused.
    cache.set('tarkov-operations-economy-v1-pvp-ru', pve)
    answer = () => { throw new Error('offline') }
    await expect(fetchEconomySnapshot('pvp', 'ru')).rejects.toThrow('offline')
    await expect(fetchEconomySnapshot('pve', 'ru')).resolves.toMatchObject({ mode: 'pve', source: 'cache' })
  })

  it('Season asks nothing and says there are no separate Season prices (no PvP or PvE prices as Season ones)', async () => {
    await expect(fetchEconomySnapshot('seasonal', 'ru')).rejects.toBeInstanceOf(SeasonPricesUnavailable)
    await expect(fetchPriceHistory('gpu', 'seasonal')).rejects.toBeInstanceOf(SeasonPricesUnavailable)
    expect(graphqlCalls).toEqual([])
    answer = () => ({ historicalItemPrices: [] })
    await fetchPriceHistory('gpu', 'pve', 7)
    expect(graphqlCalls).toEqual(['{ historicalItemPrices(id: "gpu", days: 7, gameMode: pve) { price priceMin timestamp } }'])
  })
})

describe('economy flea price', () => {
  const snapshot = parseEconomyResponse({ items: [
    { id: 'now', basePrice: 21000, lastLowPrice: 36500, low24hPrice: 35000, avg24hPrice: 41000, types: [], buyFor: [], sellFor: [] },
    { id: 'quiet', basePrice: 5000, low24hPrice: 61000, avg24hPrice: 90000, types: [], buyFor: [], sellFor: [] },
  ] }, 'pvp')

  it('is the cheapest current offer, else the 24-hour average (flagged) — never the day\'s past minimum', () => {
    expect(fleaPrice(snapshot.items.now!)).toBe(36500)
    expect(fleaPrice(snapshot.items.quiet!)).toBe(90000)
    expect(cheapestBuy(snapshot.items.quiet, { fleaEnabled: true })).toEqual({ source: 'Барахолка', kind: 'flea', unitPrice: 90000, average: true })
    expect(bestSell(snapshot.items.now, { fleaEnabled: true })?.average).toBeUndefined()
  })
})
