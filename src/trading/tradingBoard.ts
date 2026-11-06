import type { HideoutStation, Item, ModeProgress, RaidMode } from '../domain/types'
import type { FleaFeeOptions } from '../domain/fleaFee'
import { fleaQuote, traderQuotes } from '../domain/itemPrices'
import { estimateFrom, MAX_TRADER_SALE_GAP, MIN_TRADER_SALE_PROFIT, openAtLevel, reliabilityOf, swingOf, tradingSignal, tradingStale, windowPays, type TradingEstimate, type TradingRow, type TradingSignal, type TradingSnapshot, type TradingTraderItem, type TradingWindow } from '../domain/trading'

export type TradingPeriod = 3 | 7

/** One row as the page and the notifications read it: the statistics held against this moment's prices. */
export interface BoardRow {
  row: TradingRow
  item: Item
  window: TradingWindow
  swing: number
  /** The cheapest offer now; missing when the only figure is the 24-hour average (no offer to buy). */
  current?: number
  /** Against the week's usual price: −0.2 is 20% below. */
  move?: number
  traderName?: string
  traderPrice: number
  /** What a dip of the usual size earns: bought in the buying zone. */
  estimate: TradingEstimate
  /** The same per rouble spent and per cell of the stash. */
  roi: number
  perSlot: number
  signal: TradingSignal | null
  reliability: number
}

/** The character's level in this mode, when it is really known: a new profile just says 1. */
export function knownLevel(progress: Pick<ModeProgress, 'playerLevel' | 'levelAnchor'>): number | undefined {
  return progress.levelAnchor || progress.playerLevel > 1 ? progress.playerLevel : undefined
}

/** The player's fee: the mode's rates, 30% off with the Intelligence Center at level 3 (the skill's share is not known). */
export function feeOptionsFor(snapshot: Pick<TradingSnapshot, 'fee'>, hideout: readonly HideoutStation[], levels: Readonly<Record<string, number>>): Omit<FleaFeeOptions, 'count'> {
  const station = hideout.find((entry) => entry.normalizedName === 'intelligence-center')
  return { ...snapshot.fee, intelCenterLevel: station ? levels[station.id] ?? 0 : 0 }
}

/** The cheapest offer of this mode now; nothing when the only figure is the 24-hour average: there is no offer to buy. */
export function currentPrice(item: Item, mode: RaidMode): number | undefined {
  const quote = fleaQuote(item, mode)
  return quote && quote.basis !== 'avg-24h' ? quote.price : undefined
}

/** The trader who pays most for it in this mode. */
export const traderOffer = (item: Item, mode: RaidMode) => traderQuotes(item, mode)[0]

export function boardRows(input: {
  snapshot: TradingSnapshot
  items: ReadonlyMap<string, Item>
  mode: RaidMode
  period: TradingPeriod
  fee: Omit<FleaFeeOptions, 'count'>
  /** Known: only what the market lets this character buy and list (owner, 05.11.2026). Unknown: nothing can be judged. */
  playerLevel?: number
  now: number
}): BoardRow[] {
  const { snapshot, items, mode, period, fee, playerLevel, now } = input
  const stale = tradingStale(snapshot, now)
  return snapshot.rows.flatMap((row) => {
    const item = items.get(row.id)
    if (!item || (playerLevel !== undefined && !openAtLevel(row.level, playerLevel))) return []
    const current = currentPrice(item, mode)
    const trader = traderOffer(item, mode)
    const traderPrice = trader?.price ?? 0
    const window = period === 3 && row.w3 ? row.w3 : row.w7
    // What the row shows must itself pay for the fee: a week can pass while its last three days are flat.
    if (!windowPays(row.base, window, fee)) return []
    const estimate = estimateFrom(row, row.buyBelow, traderPrice, fee)
    return [{
      row,
      item,
      window,
      swing: swingOf(window),
      ...(current !== undefined ? { current, move: (current - row.w7.p50) / row.w7.p50 } : {}),
      ...(trader ? { traderName: trader.source } : {}),
      traderPrice,
      estimate,
      roi: estimate.profit / row.buyBelow,
      perSlot: estimate.profit / Math.max(1, row.slots),
      signal: current !== undefined && !stale ? tradingSignal(row, current, traderPrice, fee) : null,
      reliability: reliabilityOf(row.backtest),
    }]
  })
}

/** One deal of «Продажа торговцам»: buy on the market now, sell to the trader who pays most. Neither has a fee. */
export interface TraderSale { item: Item; price: number; traderName: string; traderPrice: number; profit: number }

/**
 * Owner, 05.11.2026: «золотое яйцо… продать торговцу 30 тысяч, а на барахолке оно сейчас там 20 тысяч. Ты покупаешь на барахолке и
 * перепродаешь торговцу. Ищи такие предметы и показывай списки». Most profit first, as the player's proposal asks. Only this
 * mode's quotes, only what the market lets this character buy.
 */
export function traderSales(input: { candidates: readonly TradingTraderItem[]; items: ReadonlyMap<string, Item>; mode: RaidMode; playerLevel?: number }): TraderSale[] {
  const { candidates, items, mode, playerLevel } = input
  return candidates.flatMap((candidate): TraderSale[] => {
    const item = items.get(candidate.id)
    if (!item || (playerLevel !== undefined && !openAtLevel(candidate.level, playerLevel))) return []
    const price = currentPrice(item, mode)
    const trader = traderOffer(item, mode)
    if (price === undefined || !trader) return []
    const profit = trader.price - price
    if (profit < MIN_TRADER_SALE_PROFIT || price * MAX_TRADER_SALE_GAP < trader.price) return []
    return [{ item, price, traderName: trader.source, traderPrice: trader.price, profit }]
  }).sort((a, b) => b.profit - a.profit)
}

export type TradingSortKey = 'swing' | 'min' | 'now' | 'max' | 'sales'
export interface TradingSort { key: TradingSortKey; dir: 1 | -1 }

/**
 * What a click on a heading sorts by (owner, 05.11.2026: «нажимаю на минимум, и он начинает показывать… у каких предметов самая
 * минимальная цена сейчас»): «Минимум» the items now closest to their low, «Максимум» closest to their high, «Сейчас» the price
 * itself. Lower comes first; a second click turns it round. An item with no offers now stays last either way.
 */
const sortValue: Record<TradingSortKey, (row: BoardRow) => number | undefined> = {
  swing: (row) => -row.swing,
  min: (row) => row.current === undefined ? undefined : (row.current - row.window.min) / row.window.min,
  now: (row) => row.current,
  max: (row) => row.current === undefined ? undefined : (row.window.max - row.current) / row.window.max,
  sales: (row) => -(row.reliability * 1000 + row.row.backtest.signals),
}

export function sortRows(rows: readonly BoardRow[], sort: TradingSort): BoardRow[] {
  const value = sortValue[sort.key]
  return [...rows].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1
    return (left - right) * sort.dir
  })
}

/** Which signals are worth interrupting the player for: big enough and, for a listing, with a past that paid. */
export function notifiable(rows: readonly BoardRow[], minProfit: number): BoardRow[] {
  return rows
    .filter((entry) => entry.signal && entry.signal.profit >= minProfit && (entry.signal.route === 'trader' || entry.reliability >= 0.8))
    .sort((a, b) => b.signal!.profit - a.signal!.profit)
}
