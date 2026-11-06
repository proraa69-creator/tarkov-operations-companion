import { describe, expect, it } from 'vitest'
import type { Item, RaidMode } from '../domain/types'
import type { TradingRow, TradingSnapshot } from '../domain/trading'
import { boardRows, feeOptionsFor, knownLevel, notifiable, traderSales } from './tradingBoard'

const NOW = Date.parse('2026-11-05T00:00:00Z')
const fee = { offerFeeRate: 0.05, requirementFeeRate: 0.05 }
const row = (id: string, level = 0, patch: Partial<TradingRow> = {}): TradingRow => ({
  id, base: 100_000, level, slots: 2, kind: 'barter',
  w7: { min: 50_000, max: 150_000, p10: 60_000, p50: 100_000, p90: 140_000, offers: 20, scans: 84 },
  w3: { min: 55_000, max: 120_000, p10: 60_000, p50: 90_000, p90: 110_000, offers: 18, scans: 36 },
  buyBelow: 60_000, sellAbove: 130_000,
  backtest: { signals: 10, wins: 9, avgProfit: 20_000, medianProfit: 21_000, medianHours: 10 },
  traderShare: 0, trend: 0, series: [], seriesFrom: NOW, seriesAt: [], ...patch,
})
const snapshot = (rows: TradingRow[], builtAt = new Date(NOW - 3_600_000).toISOString()): TradingSnapshot => ({ format: 1, mode: 'regular', builtAt, analyzed: 10, eligible: rows.length, fee, rows })
const item = (id: string, flea?: number, mode: RaidMode = 'pvp', basis?: 'avg-24h', trader?: number): Item => ({
  id, name: id, shortName: id, category: 'Бартер', description: '',
  prices: [
    ...(flea !== undefined ? [{ source: 'Барахолка', kind: 'flea' as const, mode, price: flea, updatedAt: '', ...(basis ? { basis } : {}) }] : []),
    ...(trader !== undefined ? [{ source: 'Терапевт', kind: 'trader' as const, mode, price: trader, updatedAt: '' }] : []),
  ],
} as unknown as Item)
const board = (rows: TradingRow[], items: Item[], options: { playerLevel?: number; period?: 3 | 7; mode?: RaidMode; now?: number; built?: string } = {}) => boardRows({
  snapshot: snapshot(rows, options.built),
  items: new Map(items.map((entry) => [entry.id, entry])),
  mode: options.mode ?? 'pvp',
  period: options.period ?? 7,
  fee,
  ...(options.playerLevel !== undefined ? { playerLevel: options.playerLevel } : {}),
  now: options.now ?? NOW,
})

describe('what a player sees', () => {
  it('only what the market opens at their level (owner, 05.11.2026: «опирайся на его уровень»)', () => {
    const rows = [row('open', 0), row('at-20', 20), row('at-40', 40)]
    const items = [item('open', 55_000), item('at-20', 55_000), item('at-40', 55_000)]
    expect(board(rows, items, { playerLevel: 15 }).map((entry) => entry.row.id)).toEqual(['open'])
    expect(board(rows, items, { playerLevel: 20 }).map((entry) => entry.row.id)).toEqual(['open', 'at-20'])
    expect(board(rows, items, { playerLevel: 40 }).map((entry) => entry.row.id)).toEqual(['open', 'at-20', 'at-40'])
  })

  it('nothing below the level the market itself opens at', () => {
    expect(board([row('open', 0)], [item('open', 55_000)], { playerLevel: 14 })).toEqual([])
  })

  it('everything while the level is not known, the page says so', () => {
    expect(board([row('at-40', 40)], [item('at-40', 55_000)]).map((entry) => entry.row.id)).toEqual(['at-40'])
  })

  it('a level is known from the game or above the 1 of a new profile', () => {
    expect(knownLevel({ playerLevel: 1 })).toBeUndefined()
    expect(knownLevel({ playerLevel: 15 })).toBe(15)
    expect(knownLevel({ playerLevel: 1, levelAnchor: { level: 1, at: 'x' } as never })).toBe(1)
  })

  it('the price of this mode only: PvP, PvE and Season never mix', () => {
    const [entry] = board([row('a')], [item('a', 55_000, 'pve')])
    expect(entry!.current).toBeUndefined()
    expect(entry!.signal).toBeNull()
  })

  it('no signal on a 24-hour average: there is no offer to buy', () => {
    const [entry] = board([row('a')], [item('a', 55_000, 'pvp', 'avg-24h')])
    expect(entry!.current).toBeUndefined()
    expect(entry!.signal).toBeNull()
  })

  it('no signal on statistics gone stale', () => {
    const [entry] = board([row('a')], [item('a', 55_000)], { built: new Date(NOW - 40 * 3_600_000).toISOString() })
    expect(entry!.signal).toBeNull()
  })

  it('the period changes the lows and highs shown, the zones stay the week’s', () => {
    expect(board([row('a')], [item('a', 100_000)], { period: 3 })[0]!.window.max).toBe(120_000)
    expect(board([row('a')], [item('a', 100_000)], { period: 7 })[0]!.window.max).toBe(150_000)
    expect(board([row('a')], [item('a', 100_000)], { period: 3 })[0]!.row.buyBelow).toBe(60_000)
  })

  it('an item the catalog does not know is left out', () => {
    expect(board([row('ghost')], [])).toEqual([])
  })

  it('profit per cell and per rouble', () => {
    const [entry] = board([row('a')], [item('a', 100_000)])
    expect(entry!.perSlot).toBe(entry!.estimate.profit / 2)
    expect(entry!.roi).toBe(entry!.estimate.profit / 60_000)
  })
})

describe('notifications', () => {
  it('take only big enough signals, the biggest first', () => {
    const rows = [row('small', 0, { sellAbove: 90_000, w7: { min: 50_000, max: 150_000, p10: 60_000, p50: 72_000, p90: 140_000, offers: 20, scans: 84 } }), row('big')]
    const entries = board(rows, [item('small', 60_000), item('big', 55_000)])
    expect(entries.every((entry) => entry.signal)).toBe(true)
    const small = entries.find((entry) => entry.row.id === 'small')!.signal!.profit
    const big = entries.find((entry) => entry.row.id === 'big')!.signal!.profit
    expect(big).toBeGreaterThan(small)
    expect(notifiable(entries, 0).map((entry) => entry.row.id)).toEqual(['big', 'small'])
    expect(notifiable(entries, small + 1).map((entry) => entry.row.id)).toEqual(['big'])
  })

  it('a listing needs a past that paid at least 4 times in 5; a trader’s price needs no past', () => {
    const shaky = { signals: 10, wins: 7, avgProfit: 20_000, medianProfit: 21_000, medianHours: 10 }
    expect(notifiable(board([row('a', 0, { backtest: shaky })], [item('a', 55_000)]), 0)).toEqual([])
    const trader = board([row('a', 0, { backtest: shaky, sellAbove: 95_000 })], [item('a', 80_000, 'pvp', undefined, 100_000)])
    expect(trader[0]!.signal?.route).toBe('trader')
    expect(notifiable(trader, 0)).toHaveLength(1)
  })

  it('never for what is closed at the player’s level', () => {
    expect(notifiable(board([row('at-40', 40)], [item('at-40', 55_000)], { playerLevel: 15 }), 0)).toEqual([])
  })
})

describe('the fee', () => {
  it('the mode’s rates, and the Intelligence Center’s level when the player has it', () => {
    const hideout = [{ id: 'station', normalizedName: 'intelligence-center' }] as never
    expect(feeOptionsFor({ fee }, hideout, { station: 3 }).intelCenterLevel).toBe(3)
    expect(feeOptionsFor({ fee }, hideout, {}).intelCenterLevel).toBe(0)
    expect(feeOptionsFor({ fee }, [], { station: 3 }).intelCenterLevel).toBe(0)
  })
})

describe('the list follows the period on screen', () => {
  it('a row whose last three days do not pay for the fee goes in «3 дн.» and stays in the week', () => {
    const flat = { min: 98_000, max: 102_000, p10: 99_000, p50: 100_000, p90: 101_000, offers: 20, scans: 36 }
    const items = new Map([['egg', { id: 'egg', name: 'Яйцо', shortName: 'Яйцо', prices: [] } as unknown as Item]])
    const row = { id: 'egg', base: 100_000, level: 0, slots: 1, kind: 'barter', w3: flat, w7: { min: 50_000, max: 150_000, p10: 60_000, p50: 100_000, p90: 140_000, offers: 20, scans: 84 }, buyBelow: 60_000, sellAbove: 130_000, backtest: { signals: 10, wins: 9, avgProfit: 20_000, medianProfit: 21_000, medianHours: 10 }, traderShare: 0, trend: 0, series: [], seriesFrom: 0, seriesAt: [] } as unknown as TradingRow
    const snapshot = { format: 1, mode: 'regular', builtAt: new Date().toISOString(), analyzed: 1, eligible: 1, fee: { offerFeeRate: 0.05, requirementFeeRate: 0.05 }, rows: [row] } as TradingSnapshot
    const board = (period: 3 | 7) => boardRows({ snapshot, items, mode: 'pvp', period, fee: snapshot.fee, playerLevel: 30, now: Date.now() })
    expect(board(7)).toHaveLength(1)
    expect(board(3)).toHaveLength(0)
  })
})

// Owner, 05.11.2026: «золотое яйцо… продать торговцу 30 тысяч, а на барахолке оно сейчас там 20 тысяч». The player's proposal: «от большей к меньшей выгоде».
describe('«Продажа торговцам»', () => {
  const candidate = (id: string, level = 0) => ({ id, level })
  const sales = (items: Item[], options: { playerLevel?: number; mode?: RaidMode; ids?: string[]; levels?: Record<string, number> } = {}) => traderSales({
    candidates: (options.ids ?? items.map((entry) => entry.id)).map((id) => candidate(id, options.levels?.[id] ?? 0)),
    items: new Map(items.map((entry) => [entry.id, entry])),
    mode: options.mode ?? 'pvp',
    ...(options.playerLevel !== undefined ? { playerLevel: options.playerLevel } : {}),
  })

  it('the owner\'s golden egg: bought at 20 000 ₽, sold at 30 000 ₽, no fee either way', () => {
    expect(sales([item('egg', 20_000, 'pvp', undefined, 30_000)])).toEqual([expect.objectContaining({ price: 20_000, traderName: 'Терапевт', traderPrice: 30_000, profit: 10_000 })])
  })

  it('the most profit first', () => {
    const list = sales([item('small', 50_000, 'pvp', undefined, 51_000), item('big', 20_000, 'pvp', undefined, 45_000), item('middle', 5_000, 'pvp', undefined, 12_000)])
    expect(list.map((entry) => entry.item.id)).toEqual(['big', 'middle', 'small'])
  })

  it('takes the trader who pays most', () => {
    const egg = item('egg', 20_000, 'pvp', undefined, 25_000)
    egg.prices.push({ source: 'Лыжник', kind: 'trader', mode: 'pvp', price: 40_000, updatedAt: '' })
    expect(sales([egg])[0]).toMatchObject({ traderName: 'Лыжник', traderPrice: 40_000, profit: 20_000 })
  })

  it('not what a trader pays less for, nor a difference too small to bother', () => {
    expect(sales([item('dearer', 30_000, 'pvp', undefined, 20_000), item('same', 30_000, 'pvp', undefined, 30_000), item('crumbs', 30_000, 'pvp', undefined, 30_499)])).toEqual([])
    expect(sales([item('enough', 30_000, 'pvp', undefined, 30_500)]).map((entry) => entry.item.id)).toEqual(['enough'])
  })

  it('only what the server listed: an item with wear never gets here', () => {
    const items = [item('egg', 20_000, 'pvp', undefined, 30_000), item('armor', 20_000, 'pvp', undefined, 90_000)]
    expect(sales(items, { ids: ['egg'] }).map((entry) => entry.item.id)).toEqual(['egg'])
  })

  it('a stray price is no deal: 77 ₽ for what a trader pays 3 607 ₽ for', () => {
    expect(sales([item('stray', 77, 'pvp', undefined, 3_607)])).toEqual([])
    expect(sales([item('five', 1_000, 'pvp', undefined, 5_001)])).toEqual([])
    expect(sales([item('wide', 1_000, 'pvp', undefined, 5_000)]).map((entry) => entry.item.id)).toEqual(['wide'])
  })

  it('no offer to buy: the 24-hour average is not a price, and neither is an item without a flea quote', () => {
    expect(sales([item('average', 20_000, 'pvp', 'avg-24h', 30_000), item('none', undefined, 'pvp', undefined, 30_000)])).toEqual([])
  })

  it('PvP, PvE and Season stay apart', () => {
    const pve = item('egg', 20_000, 'pve', undefined, 30_000)
    expect(sales([pve], { mode: 'pvp' })).toEqual([])
    expect(sales([pve], { mode: 'seasonal' })).toEqual([])
    expect(sales([pve], { mode: 'pve' })).toHaveLength(1)
  })

  it('only what the market opens at the player\'s level, everything while it is not known', () => {
    const items = [item('open', 20_000, 'pvp', undefined, 30_000), item('at-30', 20_000, 'pvp', undefined, 30_000)]
    const levels = { 'at-30': 30 }
    expect(sales(items, { playerLevel: 20, levels }).map((entry) => entry.item.id)).toEqual(['open'])
    expect(sales(items, { playerLevel: 30, levels })).toHaveLength(2)
    expect(sales(items, { playerLevel: 14, levels })).toEqual([])
    expect(sales(items, { levels })).toHaveLength(2)
  })
})
