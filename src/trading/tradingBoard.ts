import type { HideoutStation, Item, ModeProgress, RaidMode } from '../domain/types'
import { fleaMarketFee, type FleaFeeOptions } from '../domain/fleaFee'
import { fleaQuote, traderQuotes } from '../domain/itemPrices'
import { estimateFrom, openAtLevel, reliabilityOf, swingOf, tradingSignal, tradingStale, type TradingEstimate, type TradingRow, type TradingSignal, type TradingSnapshot, type TradingWindow } from '../domain/trading'

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
    const quote = fleaQuote(item, mode)
    const current = quote && quote.basis !== 'avg-24h' ? quote.price : undefined
    const trader = traderQuotes(item, mode)[0]
    const traderPrice = trader?.price ?? 0
    const window = period === 3 && row.w3 ? row.w3 : row.w7
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

/** A listing at `ask`: the fee and what is left. */
export function listing(row: Pick<TradingRow, 'base'>, ask: number, fee: Omit<FleaFeeOptions, 'count'>) {
  const listingFee = fleaMarketFee(row.base, ask, fee)
  return { fee: listingFee, net: ask - listingFee }
}

/** Which signals are worth interrupting the player for: big enough and, for a listing, with a past that paid. */
export function notifiable(rows: readonly BoardRow[], minProfit: number): BoardRow[] {
  return rows
    .filter((entry) => entry.signal && entry.signal.profit >= minProfit && (entry.signal.route === 'trader' || entry.reliability >= 0.8))
    .sort((a, b) => b.signal!.profit - a.signal!.profit)
}
