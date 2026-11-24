import { describe, expect, it } from 'vitest'
import type { Item, RaidMode } from '../domain/types'
import type { TradingRow, TradingSnapshot } from '../domain/trading'
import { boardRows, feeOptionsFor, freshestFirst, justRenewed, knownLevel, MAX_PRICE_AGE_MS, notifiable, priceTooOld, signalsFirst, sortRows, sortSales, traderSales } from './tradingBoard'

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

describe('the order (owner, 06.11.2026: «насколько актуальна цена, настолько и выше предмет»)', () => {
  const ORIGIN = Date.parse('2026-11-06T08:00:30Z')
  const ago = (minutes: number) => ORIGIN - minutes * 60_000
  type Row = [string, number | undefined, number]
  const order = (rows: Row[], dir: 1 | -1 = 1) => freshestFirst(rows, (entry) => entry[1], (entry) => entry[2], dir).map((entry) => entry[0])

  it('the fresher price goes higher, whatever it earns: not 60 000 but 10 000 can stand on top', () => {
    expect(order([['old-big', ago(40), 60_000], ['fresh-small', ago(3), 10_000], ['middle', ago(20), 30_000]])).toEqual(['fresh-small', 'middle', 'old-big'])
  })

  it('by the whole minute, as the column reads; within one scan the bigger sum', () => {
    expect(order([['small', ago(3), 100], ['big', ago(3) + 20_000, 90_000], ['older', ago(4), 900_000]])).toEqual(['big', 'small', 'older'])
  })

  it('no time: last, and turned round too; with no times at all the sums decide, as before', () => {
    expect(order([['none', undefined, 900_000], ['timed', ago(50), 1]])).toEqual(['timed', 'none'])
    expect(order([['none', undefined, 900_000], ['old', ago(50), 1], ['fresh', ago(1), 1]], -1)).toEqual(['old', 'fresh', 'none'])
    expect(order([['small', undefined, 1], ['big', undefined, 2]])).toEqual(['big', 'small'])
  })

  it('too old to show: over an hour, against the clock given; no time cannot be judged and stays', () => {
    expect(MAX_PRICE_AGE_MS).toBe(3_600_000)
    expect(priceTooOld(ago(60), ORIGIN)).toBe(false)
    expect(priceTooOld(ago(61), ORIGIN)).toBe(true)
    expect(priceTooOld(undefined, ORIGIN)).toBe(false)
  })

  it('lit green: the newest scan, not the one before it', () => {
    expect(justRenewed(ago(15), ORIGIN)).toBe(true)
    expect(justRenewed(ago(16), ORIGIN)).toBe(false)
    expect(justRenewed(undefined, ORIGIN)).toBe(false)
    expect(justRenewed(ORIGIN + 60_000, ORIGIN)).toBe(true)
  })

  const timed = (id: string, flea: number, minutesAgo: number, trader?: number): Item => {
    const entry = item(id, flea, 'pvp', undefined, trader)
    entry.prices[0]!.updatedAt = new Date(ago(minutesAgo)).toISOString()
    return entry
  }
  const list = (rows: TradingRow[], items: Item[]) => board(rows, items, { now: ORIGIN })

  it('the list: a signal lifts nothing over a fresher price; no offers now stand last', () => {
    const rows = list(
      [row('dip-old'), row('flat-fresh'), row('dip-fresh'), row('no-offers')],
      [timed('dip-old', 55_000, 40), timed('flat-fresh', 100_000, 3), timed('dip-fresh', 55_000, 3), item('no-offers')],
    )
    expect(rows.find((entry) => entry.row.id === 'dip-old')?.signal).not.toBeNull()
    expect(rows.find((entry) => entry.row.id === 'flat-fresh')?.signal).toBeNull()
    expect(sortRows(rows, { key: 'fresh', dir: 1 }).map((entry) => entry.row.id)).toEqual(['dip-fresh', 'flat-fresh', 'dip-old', 'no-offers'])
    expect(sortRows(rows, { key: 'fresh', dir: -1 }).map((entry) => entry.row.id)).toEqual(['dip-old', 'dip-fresh', 'flat-fresh', 'no-offers'])
  })

  it('a price too old is off the list and gives no signal, so no message either; no offers stay', () => {
    const rows = list([row('old'), row('fresh'), row('no-offers')], [timed('old', 55_000, 61), timed('fresh', 55_000, 3), item('no-offers')])
    expect(rows.map((entry) => entry.row.id)).toEqual(['fresh', 'no-offers'])
    expect(notifiable(rows, 1).map((entry) => entry.row.id)).toEqual(['fresh'])
  })

  it('a wrong clock on the player\'s computer hides nothing: the age is held against the server\'s time', () => {
    const items = new Map([['a', timed('a', 55_000, 3)]])
    const input = { snapshot: snapshot([row('a')]), items, mode: 'pvp' as const, period: 7 as const, fee }
    expect(boardRows({ ...input, now: ORIGIN + 5 * 3_600_000, priceClock: ORIGIN })).toHaveLength(1)
    expect(boardRows({ ...input, now: ORIGIN + 5 * 3_600_000 })).toHaveLength(0)
  })

  it('a click on a heading is the player\'s own order, the time takes no part', () => {
    const rows = list([row('dear'), row('cheap')], [timed('dear', 100_000, 3), timed('cheap', 55_000, 40)])
    expect(sortRows(rows, { key: 'now', dir: 1 }).map((entry) => entry.row.id)).toEqual(['cheap', 'dear'])
    expect(sortRows(rows, { key: 'now', dir: -1 }).map((entry) => entry.row.id)).toEqual(['dear', 'cheap'])
    expect(sortRows(rows, { key: 'name', dir: 1 }).map((entry) => entry.row.id)).toEqual(['cheap', 'dear'])
  })

  it('the time of this mode only', () => {
    const other = timed('a', 55_000, 3)
    other.prices[0]!.mode = 'pve'
    expect(board([row('a')], [other], { mode: 'pvp', now: ORIGIN })[0]!.renewedAt).toBeUndefined()
    expect(board([row('a')], [other], { mode: 'pve', now: ORIGIN })[0]!.renewedAt).toBe(ago(3))
  })

  it('the signals: the freshest first, within one scan the bigger profit', () => {
    const rows = list([row('old'), row('small'), row('big')], [timed('old', 50_000, 40), timed('small', 59_000, 3), timed('big', 55_000, 3)])
    expect(signalsFirst(rows).map((entry) => entry.row.id)).toEqual(['big', 'small', 'old'])
  })

  describe('«Продажа торговцам»', () => {
    const sell = (items: Item[]) => traderSales({ candidates: items.map((entry) => ({ id: entry.id, level: 0 })), items: new Map(items.map((entry) => [entry.id, entry])), mode: 'pvp', clock: ORIGIN })
    const ids = (sales: ReturnType<typeof sell>) => sales.map((sale) => sale.item.id)

    it('the freshest first, a small sum over an older big one; too old is out', () => {
      const sales = sell([timed('old-big', 20_000, 40, 90_000), timed('fresh-small', 20_000, 3, 21_000), timed('too-old', 20_000, 61, 90_000)])
      expect(ids(sales)).toEqual(['fresh-small', 'old-big'])
      expect(sales[0]!.renewedAt).toBe(ago(3))
    })

    it('by any heading: the first click the most profit, the highest pay, the cheapest, the alphabet; the second turns it round', () => {
      const sales = sell([timed('a', 30_000, 3, 40_000), timed('b', 10_000, 5, 12_000), timed('c', 20_000, 4, 50_000)])
      expect(ids(sortSales(sales, { key: 'profit', dir: 1 }))).toEqual(['c', 'a', 'b'])
      expect(ids(sortSales(sales, { key: 'profit', dir: -1 }))).toEqual(['b', 'a', 'c'])
      expect(ids(sortSales(sales, { key: 'pays', dir: 1 }))).toEqual(['c', 'a', 'b'])
      expect(ids(sortSales(sales, { key: 'price', dir: 1 }))).toEqual(['b', 'c', 'a'])
      expect(ids(sortSales(sales, { key: 'name', dir: -1 }))).toEqual(['c', 'b', 'a'])
      const named = sales.map((sale, at) => ({ ...sale, traderName: ['Прапор', 'Егерь', 'Терапевт'][at]! }))
      expect(sortSales(named, { key: 'trader', dir: 1 }).map((sale) => sale.traderName)).toEqual(['Егерь', 'Прапор', 'Терапевт'])
    })
  })
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
    clock: NOW,
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
