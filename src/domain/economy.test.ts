import { describe, expect, it } from 'vitest'
import fixture from '../test/fixtures/economy-graphql.json'
import { economyQuery, graphqlGameMode, parseEconomyResponse, parsePriceHistory, priceHistoryQuery } from '../data/economyApi'
import { barterRows, bestSell, cheapestBuy, craftRows, formatDuration, FUEL_UNITS_PER_HOUR, fuelCostPerHour, matchesSearch, profitOf, sortByNumber } from './economy'
import { fleaMarketFee } from './fleaFee'

const snapshot = parseEconomyResponse(fixture, 'pvp', '2026-10-01T00:00:00.000Z')
const all = { fleaEnabled: true }
const GPU = '57347ca924597744596b4e71'
const SALEWA = '544fb45d4bdc2dee738b4568'
const LEDX = '5c0530ee86f774697952d952'
const TUSHONKA = '57347da92459774491567cf5'
const PRAPOR = '54cb50c76803fa8b248b4571'
const THERAPIST = '54cb57776803fa99248b456e'

describe('economy GraphQL adapter', () => {
  it('maps app modes to tarkov.dev game modes and keeps Season separate', () => {
    expect(graphqlGameMode('pvp')).toBe('regular')
    expect(graphqlGameMode('pve')).toBe('pve')
    expect(graphqlGameMode('seasonal')).toBeNull()
    expect(economyQuery('pve', 'en')).toContain('barters(gameMode: pve, lang: en)')
    expect(economyQuery('regular', 'ru')).toContain('crafts(gameMode: regular, lang: ru)')
    expect(priceHistoryQuery('abc', 'pve', 7)).toBe('{ historicalItemPrices(id: "abc", days: 7, gameMode: pve) { price priceMin timestamp } }')
  })

  it('parses items, vendor offers, barters and crafts', () => {
    expect(Object.keys(snapshot.items)).toHaveLength(12)
    expect(snapshot.items[LEDX].noFlea).toBe(true)
    expect(snapshot.items[SALEWA].buyFor).toContainEqual({ source: 'Терапевт', traderId: THERAPIST, kind: 'trader', price: 23000, minTraderLevel: 1, taskUnlock: undefined, buyLimit: undefined })
    expect(snapshot.items[SALEWA].buyFor.find((quote) => quote.kind === 'flea')).toBeTruthy()
    expect(snapshot.barters).toHaveLength(6)
    expect(snapshot.barters[1]).toMatchObject({ traderName: 'Терапевт', level: 3, buyLimit: 1, taskUnlock: { id: 't-amb', name: 'Снова скорая' } })
    expect(snapshot.crafts[0]).toMatchObject({ stationName: 'Медблок', level: 1, duration: 4800 })
    expect(snapshot.flea).toEqual({ enabled: true, offerFeeRate: 0.03, requirementFeeRate: 0.03 })
  })

  it('parses and orders price history points', () => {
    const points = parsePriceHistory({ historicalItemPrices: [{ price: 2, timestamp: '2000' }, { price: 1, priceMin: 1, timestamp: '1000' }, { price: 0, timestamp: '3000' }] })
    expect(points).toEqual([{ timestamp: 1000, price: 1, priceMin: 1 }, { timestamp: 2000, price: 2, priceMin: undefined }])
  })
})

describe('buy and sell prices', () => {
  it('buys from the cheapest source the player can use', () => {
    expect(cheapestBuy(snapshot.items[TUSHONKA], all)).toEqual({ source: 'Егерь', kind: 'trader', unitPrice: 9000 })
    expect(cheapestBuy(snapshot.items[SALEWA], all)).toEqual({ source: 'Терапевт', kind: 'trader', unitPrice: 23000 })
    // Prapor sells the fuel tank at LL2 for 75k; at LL1 only the flea (90k) is left.
    const fuel = snapshot.items['5d1b371186f774253763a656']
    expect(cheapestBuy(fuel, all)?.unitPrice).toBe(75000)
    expect(cheapestBuy(fuel, { fleaEnabled: true, traderLevels: { [PRAPOR]: 1 } })?.unitPrice).toBe(90000)
    expect(cheapestBuy(fuel, { fleaEnabled: true, defaultTraderLevel: 1 })?.kind).toBe('flea')
  })

  it('never buys or sells flea-banned items on the flea', () => {
    expect(cheapestBuy(snapshot.items[LEDX], all)).toBeNull()
    expect(bestSell(snapshot.items[LEDX], all)).toEqual({ source: 'Терапевт', kind: 'trader', unitPrice: 611000 })
  })

  it('sells on the flea net of the fee when that beats traders', () => {
    const gpu = snapshot.items[GPU]
    const fee = fleaMarketFee(100000, 600000)
    expect(bestSell(gpu, all)).toEqual({ source: 'Барахолка', kind: 'flea', unitPrice: 600000 - fee, fee })
    expect(bestSell(gpu, { fleaEnabled: false })).toEqual({ source: 'Терапевт', kind: 'trader', unitPrice: 124000 })
  })
})

describe('barter profit', () => {
  const rows = barterRows(snapshot, all)
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))

  it('compares input cost with output value', () => {
    const salewaValue = 29600 - fleaMarketFee(21000, 29600)
    expect(byId.b1.cost).toBe(18000)
    expect(byId.b1.value).toBe(salewaValue)
    expect(byId.b1.profit).toBe(salewaValue - 18000)
    expect(byId.b1.percent).toBeCloseTo(((salewaValue - 18000) / 18000) * 100, 6)
    // GPU (flea 600k) → LEDX (flea-banned, Therapist 611k)
    expect(byId.b2).toMatchObject({ cost: 600000, value: 611000, profit: 11000, buyLimit: 1, taskUnlock: { name: 'Снова скорая' } })
  })

  it('leaves the profit empty when an input has no price', () => {
    expect(byId.b3.cost).toBeNull()
    expect(byId.b3.profit).toBeNull()
  })

  it('marks barters above the known trader level as locked', () => {
    const limited = barterRows(snapshot, { fleaEnabled: true, traderLevels: { [THERAPIST]: 2 } })
    expect(limited.find((row) => row.id === 'b2')?.locked).toBe(true)
    expect(limited.find((row) => row.id === 'b1')?.locked).toBe(false)
    expect(rows.every((row) => !row.locked)).toBe(true)
  })

  it('profitOf handles zero cost', () => {
    expect(profitOf(0, 100)).toEqual({ cost: 0, value: 100, profit: 100, percent: null })
  })
})

describe('craft profit', () => {
  it('computes profit per hour and adds fuel for powered stations', () => {
    const fuelPerHour = fuelCostPerHour(snapshot.items, all)
    // Cheapest fuel unit: expeditionary tank from Prapor 75k / 60 = 1250 (metal tank 160k / 100 = 1600).
    expect(fuelPerHour).toBeCloseTo(1250 * FUEL_UNITS_PER_HOUR, 6)
    const plain = craftRows(snapshot, all)
    const fueled = craftRows(snapshot, { ...all, fuelPerHour })
    const moonshine = plain.find((row) => row.id === 'c2')!
    const value = 320000 - fleaMarketFee(40000, 320000)
    expect(moonshine.cost).toBe(25000 + 8000)
    expect(moonshine.value).toBe(value)
    expect(moonshine.profitPerHour).toBeCloseTo((value - 33000) / (12000 / 3600), 6)
    const moonshineFuel = fueled.find((row) => row.id === 'c2')!
    expect(moonshineFuel.fuelCost).toBe(Math.round(fuelPerHour! * 12000 / 3600))
    expect(moonshineFuel.profit).toBe(moonshine.profit! - moonshineFuel.fuelCost)
    expect(fueled.find((row) => row.id === 'c5')?.profit).toBeNull()
  })

  it('locks crafts above a known station level only', () => {
    const rows = craftRows(snapshot, { ...all, stationLevels: { '5d484fc0654e76006657e0ab': 2 } })
    expect(rows.find((row) => row.id === 'c5')?.locked).toBe(true)
    expect(rows.find((row) => row.id === 'c6')?.locked).toBe(false)
    expect(rows.find((row) => row.id === 'c1')?.locked).toBe(false)
  })

  it('formats durations', () => {
    expect(formatDuration(4800)).toBe('1 ч 20 мин')
    expect(formatDuration(600)).toBe('10 мин')
  })
})

describe('sorting and search', () => {
  it('sorts by number with missing values last in both directions', () => {
    const rows = [{ id: 'a', v: 5 }, { id: 'b', v: null }, { id: 'c', v: -2 }, { id: 'd', v: 5 }, { id: 'e', v: 9 }]
    expect(sortByNumber(rows, (row) => row.v).map((row) => row.id)).toEqual(['e', 'a', 'd', 'c', 'b'])
    expect(sortByNumber(rows, (row) => row.v, 'asc').map((row) => row.id)).toEqual(['c', 'a', 'd', 'e', 'b'])
  })

  it('ranks the fixture barters by profit', () => {
    const ranked = sortByNumber(barterRows(snapshot, all), (row) => row.profit).map((row) => row.id)
    expect(ranked.at(-1)).toBe('b3')
    expect(ranked[0]).toBe('b5')
  })

  it('matches item names, short names and extra fields case-insensitively', () => {
    const row = barterRows(snapshot, all).find((entry) => entry.id === 'b1')!
    expect(matchesSearch('salewa', row.outputs)).toBe(true)
    expect(matchesSearch('ТУШЁН', row.inputs)).toBe(true)
    expect(matchesSearch('терапевт', [], row.traderName)).toBe(true)
    expect(matchesSearch('ledx', [...row.inputs, ...row.outputs])).toBe(false)
  })
})
