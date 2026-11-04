import { describe, expect, it } from 'vitest'
import { fleaMarketFee } from './fleaFee'
import { backtest, breakEvenAsk, estimateFrom, fleaNet, hasDurability, openAtLevel, pickRows, swingOf, tradingKind, tradingRow, tradingSignal, tradingStale, worthwhile, type PriceScan, type TradingItemInput, type TradingRow } from './trading'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-11-05T00:00:00Z')
const fee = { offerFeeRate: 0.05, requirementFeeRate: 0.05 }

/** A month of scans every 2 hours, the newest at NOW: `floorAt(index from the oldest)` gives each cheapest offer. */
function month(floorAt: (index: number, count: number) => number, offers: number | ((index: number) => number) = 20): PriceScan[] {
  const count = 30 * 12
  return Array.from({ length: count }, (_, index) => ({
    timestamp: NOW - (count - 1 - index) * 2 * HOUR,
    floor: floorAt(index, count),
    offers: typeof offers === 'number' ? offers : offers(index),
  }))
}
/** A daily dip to 60 000 from 100 000: what the scheme is for. */
const swinging = () => month((index) => index % 12 < 2 ? 60_000 : 100_000)
const item = (patch: Partial<TradingItemInput> = {}): TradingItemInput => ({ id: 'item', base: 100_000, level: 0, slots: 1, types: ['barter'], traderPrices: [], scans: swinging(), ...patch })

const row = (patch: Partial<TradingRow> = {}): TradingRow => ({
  id: 'item', base: 100_000, level: 0, slots: 1, kind: 'barter',
  w7: { min: 50_000, max: 150_000, p10: 60_000, p50: 100_000, p90: 140_000, offers: 20, scans: 84 },
  buyBelow: 60_000, sellAbove: 130_000,
  backtest: { signals: 10, wins: 9, avgProfit: 20_000, medianProfit: 21_000, medianHours: 10 },
  traderShare: 0, trend: 0, series: [], ...patch,
})

describe('the list of items', () => {
  it('takes an item that swings, with its lows and highs', () => {
    const result = tradingRow(item(), fee, NOW)!
    expect(result.w7.min).toBe(60_000)
    expect(result.w7.max).toBe(100_000)
    expect(result.buyBelow).toBe(60_000)
    expect(result.w3?.max).toBe(100_000)
    expect(result.backtest.signals).toBeGreaterThan(10)
    expect(result.series.length).toBeGreaterThan(70)
  })

  it('leaves out an item not profitable even from the lowest to the highest (owner: «смысла тогда нету»)', () => {
    // A base price far above the market: the fee takes more than the whole swing.
    expect(tradingRow(item({ base: 2_000_000 }), fee, NOW)).toBeNull()
    expect(tradingRow(item({ scans: month(() => 100_000) }), fee, NOW)).toBeNull()
  })

  it('leaves out a thin market and an item too cheap to bother', () => {
    expect(tradingRow(item({ scans: month((index) => index % 12 < 2 ? 60_000 : 100_000, 4) }), fee, NOW)).toBeNull()
    expect(tradingRow(item({ base: 2000, scans: month((index) => index % 12 < 2 ? 1500 : 2500) }), fee, NOW)).toBeNull()
  })

  it('does not count a scan with one or two offers: a lone listing is no price', () => {
    const scans = month((index) => index === 355 ? 4_500_000 : index % 12 < 2 ? 60_000 : 100_000, (index) => index === 355 ? 1 : 20)
    expect(tradingRow(item({ scans }), fee, NOW)!.w7.max).toBe(100_000)
  })

  it('leaves out an item whose history stopped', () => {
    expect(tradingRow(item({ scans: swinging().map((scan) => ({ ...scan, timestamp: scan.timestamp - 3 * DAY })) }), fee, NOW)).toBeNull()
  })

  it('keeps the kinds apart', () => {
    expect(tradingKind(['keys'])).toBe('key')
    expect(tradingKind(['rig', 'wearable'])).toBe('gear')
    expect(tradingKind(['barter'])).toBe('barter')
    expect(tradingKind(['meds'])).toBe('other')
  })
})

describe('durability (owner: «не рассматривай и не добавляй их в систему»)', () => {
  it('leaves out what wears: by its properties or by what it is', () => {
    expect(hasDurability({ types: ['armor', 'wearable'], properties: { durability: 80 } })).toBe(true)
    expect(hasDurability({ types: ['rig', 'wearable'], properties: { durability: 212 } })).toBe(true)
    expect(hasDurability({ types: ['glasses', 'wearable'], properties: { durability: 40 } })).toBe(true)
    expect(hasDurability({ types: ['gun', 'wearable'], properties: { maxDurability: 100 } })).toBe(true)
    expect(hasDurability({ types: ['preset'] })).toBe(true)
    expect(hasDurability({ types: ['armorPlate'] })).toBe(true)
    expect(hasDurability({ types: ['helmet', 'wearable'], properties: {} })).toBe(true)
  })

  it('keeps what does not: a chest rig, sunglasses, a knife, a key, a medkit, barter', () => {
    expect(hasDurability({ types: ['rig', 'wearable'], properties: { capacity: 12 } })).toBe(false)
    expect(hasDurability({ types: ['glasses', 'wearable'], properties: { durability: 0 } })).toBe(false)
    expect(hasDurability({ types: ['wearable'] })).toBe(false)
    expect(hasDurability({ types: ['keys'], properties: { uses: 20 } })).toBe(false)
    expect(hasDurability({ types: ['meds'], properties: { hitpoints: 400, uses: 1 } })).toBe(false)
    expect(hasDurability({ types: ['mods'], properties: { durabilityBurnFactor: 0.9 } })).toBe(false)
    expect(hasDurability({ types: ['barter'] })).toBe(false)
    expect(hasDurability({})).toBe(false)
  })
})

describe('the past month', () => {
  it('buys at the next scan, not at the price of the signal: the cheap offer is gone by then', () => {
    const scans = month((index) => index % 12 === 0 ? 60_000 : 100_000)
    const past = backtest(scans, 100_000, 0, fee)
    expect(past.signals).toBeGreaterThan(10)
    // A dip of one scan: by the next scan the price is back and nothing is left to earn.
    expect(past.medianProfit).toBeLessThanOrEqual(0)
    // A dip of two scans can still be caught.
    const longer = backtest(swinging(), 100_000, 0, fee)
    expect(longer.medianProfit).toBeGreaterThan(0)
    expect(longer.wins).toBeGreaterThan(longer.signals / 2)
  })

  it('counts a sale at the selling zone, not at a jump over it', () => {
    const steady = backtest(swinging(), 100_000, 0, fee)
    const jumpy = backtest(month((index) => index % 12 < 2 ? 60_000 : index % 12 === 2 ? 900_000 : 100_000), 100_000, 0, fee)
    expect(jumpy.medianProfit).toBeLessThan(fleaNet(100_000, 900_000, fee) - 60_000)
    expect(steady.signals).toBeGreaterThan(0)
  })

  it('sells to a trader at once when he pays more than a listing leaves', () => {
    const past = backtest(swinging(), 100_000, 90_000, fee)
    expect(past.medianHours).toBe(0)
    expect(past.wins).toBe(past.signals)
    expect(past.medianProfit).toBe(30_000)
  })

  it('says nothing without a week to judge by', () => {
    expect(backtest(month(() => 100_000).slice(-40), 100_000, 0, fee)).toEqual({ signals: 0, wins: 0, avgProfit: 0, medianProfit: 0, medianHours: 0 })
  })
})

describe('signals', () => {
  it('buy: the price is at its low and worth it, with what it should earn after the fee', () => {
    const signal = tradingSignal(row(), 55_000, 0, fee)!
    expect(signal.kind).toBe('buy')
    expect(signal.route).toBe('flea')
    const ask = Math.round(130_000 * 0.99)
    expect(signal.sellAt).toBe(ask)
    expect(signal.fee).toBe(fleaMarketFee(100_000, ask, fee))
    expect(signal.profit).toBe(ask - fleaMarketFee(100_000, ask, fee) - 55_000)
  })

  it('buy: a price under what a trader pays needs no waiting', () => {
    const signal = tradingSignal(row({ sellAbove: 95_000 }), 80_000, 100_000, fee)!
    expect(signal).toMatchObject({ kind: 'buy', route: 'trader', profit: 20_000 })
    // A copper under the trader is not worth the click (owner: «разница будет небольшая, копеечная»).
    expect(tradingSignal(row({ sellAbove: 200_000 }), 99_900, 100_000, fee)).toBeNull()
  })

  it('buy: a sure profit at a trader stands even when a listing might pay more and the price is no low', () => {
    expect(tradingSignal(row(), 95_000, 100_000, fee)).toMatchObject({ kind: 'buy', route: 'trader', profit: 5_000 })
  })

  it('sell: the price is at its high and pays over the buying zone after the fee', () => {
    const signal = tradingSignal(row(), 135_000, 0, fee)!
    expect(signal.kind).toBe('sell')
    expect(signal.net).toBe(signal.sellAt! - signal.fee!)
    expect(signal.profit).toBe(signal.net! - 60_000)
  })

  it('no sell signal when a trader pays more than the listing would leave', () => {
    expect(tradingSignal(row(), 135_000, 125_000, fee)).toBeNull()
  })

  it('none in the middle of the range', () => {
    expect(tradingSignal(row(), 100_000, 0, fee)).toBeNull()
  })

  it('none on the flea route for an item whose past dips did not pay', () => {
    expect(tradingSignal(row({ backtest: { signals: 10, wins: 5, avgProfit: 100, medianProfit: 50, medianHours: 40 } }), 55_000, 0, fee)).toBeNull()
    expect(tradingSignal(row({ backtest: { signals: 2, wins: 2, avgProfit: 100, medianProfit: 50, medianHours: 40 } }), 55_000, 0, fee)).toBeNull()
  })

  it('none for a flat item: its lowest tenth is no fall at all', () => {
    const flat = row({ w7: { min: 95_000, max: 105_000, p10: 96_000, p50: 100_000, p90: 104_000, offers: 20, scans: 84 }, buyBelow: 96_000, sellAbove: 200_000 })
    expect(tradingSignal(flat, 95_000, 0, fee)).toBeNull()
  })

  it('none without a price', () => {
    expect(tradingSignal(row(), 0, 0, fee)).toBeNull()
  })

  it('the Intelligence Center lowers the fee in the estimate', () => {
    const plain = estimateFrom(row(), 60_000, 0, fee)
    const center = estimateFrom(row(), 60_000, 0, { ...fee, intelCenterLevel: 3 })
    expect(center.profit).toBeGreaterThan(plain.profit)
    expect(center.fee).toBe(Math.round(plain.fee! * 0.7))
  })

  it('statistics a day and a half old are not used', () => {
    expect(tradingStale({ builtAt: new Date(NOW - 35 * HOUR).toISOString() }, NOW)).toBe(false)
    expect(tradingStale({ builtAt: new Date(NOW - 37 * HOUR).toISOString() }, NOW)).toBe(true)
    expect(tradingStale({ builtAt: 'broken' }, NOW)).toBe(true)
  })
})

describe('the character level', () => {
  it('the market opens at 15, an item may ask for more, both to buy and to list', () => {
    expect(openAtLevel(0, 14)).toBe(false)
    expect(openAtLevel(0, 15)).toBe(true)
    expect(openAtLevel(25, 15)).toBe(false)
    expect(openAtLevel(25, 25)).toBe(true)
  })

  it('every level finds its own best items in what is sent', () => {
    const rows = Array.from({ length: 400 }, (_, index) => row({
      id: `item-${index}`,
      level: index < 150 ? 0 : 40,
      // The dearest items open only at level 40: a single ranking would leave level 15 with nothing.
      backtest: { signals: 10, wins: 9, avgProfit: 1, medianProfit: index, medianHours: 1 },
    }))
    const picked = pickRows(rows)
    expect(picked.filter((entry) => openAtLevel(entry.level, 15)).length).toBe(100)
    expect(picked.filter((entry) => openAtLevel(entry.level, 40)).length).toBeGreaterThanOrEqual(100)
    expect(new Set(picked.map((entry) => entry.id)).size).toBe(picked.length)
  })
})

describe('sums', () => {
  it('a listing is 1% under the lowest price, minus the fee', () => {
    const ask = Math.round(50_000 * 0.99)
    expect(fleaNet(68_000, 50_000, fee)).toBe(ask - fleaMarketFee(68_000, ask, fee))
  })

  it('profit worth acting on: at least 1 000 ₽ and 5% of the price', () => {
    expect(worthwhile(999, 1000)).toBe(false)
    expect(worthwhile(1000, 1000)).toBe(true)
    expect(worthwhile(4999, 100_000)).toBe(false)
    expect(worthwhile(5000, 100_000)).toBe(true)
  })

  it('the swing is the usual range against the usual price', () => {
    expect(swingOf({ min: 1, max: 999, p10: 50, p50: 100, p90: 150, offers: 5, scans: 40 })).toBe(1)
  })

  it('the lowest listing that loses nothing', () => {
    const ask = breakEvenAsk(68_000, 40_000, fee)!
    expect(ask - fleaMarketFee(68_000, ask, fee)).toBeGreaterThanOrEqual(40_000)
    expect(ask - 1 - fleaMarketFee(68_000, ask - 1, fee)).toBeLessThan(40_000)
  })

  it('no listing returns a price far above what the fee allows', () => {
    // The fee grows faster than the price from a point on: for a very cheap base there is a ceiling.
    expect(breakEvenAsk(10, 100_000_000, fee)).toBeNull()
  })
})
