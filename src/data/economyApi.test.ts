import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphqlCalls: string[] = []
const jsonCalls: string[] = []
const cache = new Map<string, unknown>()
let answer: (query: string) => unknown = () => ({})
let jsonOffline = false

vi.mock('./tarkovApi', () => ({
  tarkovGraphql: vi.fn(async (query: string) => { graphqlCalls.push(query); return { data: answer(query) } }),
  usesDataGateway: vi.fn(() => true),
  gatewayRequest: vi.fn(async (_method: string, path: string) => path.includes('/price-history/')
    ? { points: [{ timestamp: Date.now(), price: 123 }] }
    : { mode: path.endsWith('/pve') ? 'pve' : path.endsWith('/pvp') ? 'regular' : 'pvp-season', fleaMarket: { enabled: true }, items: { gpu: { lastLowPrice: path.endsWith('/pve') ? 420000 : path.endsWith('/pvp') ? 610000 : 777000, avg24hPrice: 800000 } } }),
  tarkovJson: vi.fn(async (path: string) => {
    if (jsonOffline) throw new Error('offline')
    jsonCalls.push(path)
    const mode = path.split('/')[0]!
    const endpoint = path.split('/')[1]!
    if (endpoint === 'items') return { data: { items: { gpu: { id: 'gpu', basePrice: 100000, lastLowPrice: mode === 'pve' ? 400000 : mode === 'pvp-season' ? 700000 : 600000, types: [] } }, fleaMarket: { enabled: true } } }
    if (endpoint === 'items_ru' || endpoint === 'items_en') return { data: { 'gpu Name': 'Видеокарта', 'gpu ShortName': 'GPU' } }
    if (endpoint === 'traders') return { data: { traders: { mechanic: { id: 'mechanic', name: 'Механик', normalizedName: 'mechanic' } } } }
    if (endpoint === 'traders_ru' || endpoint === 'traders_en' || endpoint.startsWith('hideout_')) return { data: {} }
    if (endpoint === 'barters') return { data: [{ id: `${mode}-barter`, trader: 'mechanic', minTraderLevel: 1, requiredItems: [{ item: 'gpu', count: 1 }], offeredItem: { item: 'gpu', count: 2 } }] }
    if (endpoint === 'crafts') return { data: [{ id: `${mode}-craft`, station: 'workbench', level: 1, duration: 10, requiredItems: [{ item: 'gpu', count: 1 }], productItem: { item: 'gpu', count: 1 } }] }
    if (endpoint === 'maps') return { data: { maps: {}, mobs: {} } }
    throw new Error(`Unexpected ${path}`)
  }),
}))
vi.mock('./gameDataCache', () => ({
  readGameCache: vi.fn(async (key: string) => cache.get(key)),
  writeGameCache: vi.fn(async (key: string, value: unknown) => { cache.set(key, value) }),
}))

const { economyQueries, fetchEconomySnapshot, fetchPriceHistory, parseEconomyResponse } = await import('./economyApi')
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
  jsonCalls.length = 0
  cache.clear()
  answer = pricesFor
  jsonOffline = false
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
    expect([pvp.mode, pvp.items.gpu?.lastLowPrice]).toEqual(['pvp', 610000])
    expect([pve.mode, pve.items.gpu?.lastLowPrice]).toEqual(['pve', 420000])
    expect([...cache.keys()]).toEqual(['tarkov-operations-economy-v1-pvp-ru', 'tarkov-operations-economy-v1-pve-ru'])
    expect(jsonCalls.slice(0, 8).every((path) => path.startsWith('regular/'))).toBe(true)
    expect(jsonCalls.slice(8).every((path) => path.startsWith('pve/'))).toBe(true)

    // Offline: a PvE snapshot sitting under the PvP key (e.g. written by an old build) is refused.
    cache.set('tarkov-operations-economy-v1-pvp-ru', pve)
    jsonOffline = true
    await expect(fetchEconomySnapshot('pvp', 'ru')).rejects.toThrow('offline')
    await expect(fetchEconomySnapshot('pve', 'ru')).resolves.toMatchObject({ mode: 'pve', source: 'cache' })
  })

  it('Season uses its own mirrored JSON prices, barters and crafts without a PvP/PvE GraphQL request', async () => {
    const season = await fetchEconomySnapshot('seasonal', 'ru')
    expect(season).toMatchObject({ mode: 'seasonal', items: { gpu: { lastLowPrice: 777000 } } })
    expect([season.barters.length, season.crafts.length]).toEqual([1, 1])
    await expect(fetchPriceHistory('gpu', 'seasonal')).resolves.toHaveLength(1)
    expect(graphqlCalls).toEqual([])
    await fetchPriceHistory('gpu', 'pve', 7)
    expect(graphqlCalls).toEqual([])
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
