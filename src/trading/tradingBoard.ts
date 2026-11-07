import type { HideoutStation, Item, ModeProgress, RaidMode } from '../domain/types'
import type { FleaFeeOptions } from '../domain/fleaFee'
import { fleaQuote, fleaRenewedAt, traderQuotes } from '../domain/itemPrices'
import { uiText } from '../i18n/renderText'
import { estimateFrom, MAX_TRADER_SALE_GAP, MIN_TRADER_SALE_PROFIT, openAtLevel, reliabilityOf, swingOf, tradingSignal, tradingStale, windowPays, type TradingEstimate, type TradingRow, type TradingSignal, type TradingSnapshot, type TradingTraderItem, type TradingWindow } from '../domain/trading'

export type TradingPeriod = 3 | 7

/**
 * Older than this a price is not shown (owner, 06.11.2026: «Если цены сильно старые, тогда не нужно показывать… потому что это не
 * актуально»). See docs/trading.md, «The order», for what it rests on.
 */
export const MAX_PRICE_AGE_MS = 60 * 60_000
/**
 * So young a price is lit green (owner: «подсвечиваю ее зеленым»). A new scan comes every 10 minutes; PvP's route is cached up to 5
 * more (measured 06.11.2026): so the newest scan stays lit until the next one reaches the app.
 */
export const JUST_RENEWED_MS = 15 * 60_000
const MINUTE_MS = 60_000

/** `clock`: the moment to hold prices against. The page takes it from the server's file, so a wrong clock on the player's computer hides nothing. */
export const priceTooOld = (renewedAt: number | undefined, clock: number) => renewedAt !== undefined && clock - renewedAt > MAX_PRICE_AGE_MS
export const justRenewed = (renewedAt: number | undefined, clock: number) => renewedAt !== undefined && clock - renewedAt <= JUST_RENEWED_MS

const compareValues = (left: number | string, right: number | string) => {
  if (typeof left === 'string' || typeof right === 'string') return String(left).localeCompare(String(right), undefined, { numeric: true })
  return left === right ? 0 : left < right ? -1 : 1
}

/** Lower first, `dir` −1 turns it round. A row with no value stays last either way; equal ones keep the order they came in. */
export function sortByValue<T>(rows: readonly T[], valueOf: (row: T) => number | string | undefined, dir: 1 | -1 = 1): T[] {
  return rows
    .map((row) => ({ row, value: valueOf(row) }))
    .sort((a, b) => {
      if (a.value === undefined || b.value === undefined) return a.value === b.value ? 0 : a.value === undefined ? 1 : -1
      return compareValues(a.value, b.value) * dir
    })
    .map((entry) => entry.row)
}

/**
 * The order of every list here until a heading is clicked. Owner, 06.11.2026: «Показывай не по выгоде, а показывай по актуальности
 * цены. То есть насколько актуальна цена, настолько и выше предмет». By the whole minute, as the column reads; within a minute, one
 * scan of the market, the bigger sum first. No time, no offers now: last. It moves only when a price is renewed, not as time passes.
 */
export function freshestFirst<T>(rows: readonly T[], renewedAtOf: (row: T) => number | undefined, worthOf: (row: T) => number, dir: 1 | -1 = 1): T[] {
  const byWorth = sortByValue(rows, (row) => -worthOf(row))
  return sortByValue(byWorth, (row) => { const at = renewedAtOf(row); return at === undefined ? undefined : -Math.floor(at / MINUTE_MS) }, dir)
}

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
  /** When the price now was last renewed (ms). */
  renewedAt?: number
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
  /** What to hold the prices' age against (see `priceTooOld`), `now` when not given. */
  priceClock?: number
}): BoardRow[] {
  const { snapshot, items, mode, period, fee, playerLevel, now, priceClock = now } = input
  const stale = tradingStale(snapshot, now)
  return snapshot.rows.flatMap((row) => {
    const item = items.get(row.id)
    if (!item || (playerLevel !== undefined && !openAtLevel(row.level, playerLevel))) return []
    const current = currentPrice(item, mode)
    const renewedAt = current !== undefined ? fleaRenewedAt(item, mode) : undefined
    if (priceTooOld(renewedAt, priceClock)) return []
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
      ...(renewedAt !== undefined ? { renewedAt } : {}),
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
export interface TraderSale { item: Item; price: number; traderName: string; traderPrice: number; profit: number; renewedAt?: number }

/**
 * Owner, 05.11.2026: «золотое яйцо… продать торговцу 30 тысяч, а на барахолке оно сейчас там 20 тысяч. Ты покупаешь на барахолке и
 * перепродаешь торговцу. Ищи такие предметы и показывай списки». The freshest price first, within one scan the most profit, and no
 * price too old to trust. Only this mode's quotes, only what the market lets this character buy.
 */
export function traderSales(input: { candidates: readonly TradingTraderItem[]; items: ReadonlyMap<string, Item>; mode: RaidMode; playerLevel?: number; clock: number }): TraderSale[] {
  const { candidates, items, mode, playerLevel, clock } = input
  const deals = candidates.flatMap((candidate): TraderSale[] => {
    const item = items.get(candidate.id)
    if (!item || (playerLevel !== undefined && !openAtLevel(candidate.level, playerLevel))) return []
    const price = currentPrice(item, mode)
    const trader = traderOffer(item, mode)
    if (price === undefined || !trader) return []
    const profit = trader.price - price
    if (profit < MIN_TRADER_SALE_PROFIT || price * MAX_TRADER_SALE_GAP < trader.price) return []
    const renewedAt = fleaRenewedAt(item, mode)
    if (priceTooOld(renewedAt, clock)) return []
    return [{ item, price, traderName: trader.source, traderPrice: trader.price, profit, ...(renewedAt !== undefined ? { renewedAt } : {}) }]
  })
  return sortSales(deals, { key: 'fresh', dir: 1 })
}

export type TradingSortKey = 'fresh' | 'name' | 'min' | 'now' | 'max' | 'sales'
export interface TableSort<K extends string = string> { key: K; dir: 1 | -1 }
export type TradingSort = TableSort<TradingSortKey>

/**
 * What a click on a heading sorts by (owner, 05.11.2026: «нажимаю на минимум, и он начинает показывать… у каких предметов самая
 * минимальная цена сейчас»): «Минимум» the items now closest to their low, «Максимум» closest to their high, «Сейчас» the price
 * itself. Lower comes first; a second click turns it round. An item with no offers now stays last either way. Until a click: `fresh`.
 */
const sortValue: Record<Exclude<TradingSortKey, 'fresh'>, (row: BoardRow) => number | string | undefined> = {
  name: (row) => uiText(row.item.name),
  min: (row) => row.current === undefined ? undefined : (row.current - row.window.min) / row.window.min,
  now: (row) => row.current,
  max: (row) => row.current === undefined ? undefined : (row.window.max - row.current) / row.window.max,
  sales: (row) => -(row.reliability * 1000 + row.row.backtest.signals),
}

/** Within one minute, one scan of the market: the signal's profit, without a signal the wider swing. */
const rowWorth = (row: BoardRow) => row.signal?.profit ?? row.swing

export function sortRows(rows: readonly BoardRow[], sort: TradingSort): BoardRow[] {
  return sort.key === 'fresh' ? freshestFirst(rows, (row) => row.renewedAt, rowWorth, sort.dir) : sortByValue(rows, sortValue[sort.key], sort.dir)
}

/** The two lists of signals: the freshest first, within one scan the bigger profit. */
export const signalsFirst = (rows: readonly BoardRow[]) => freshestFirst(rows, (row) => row.renewedAt, rowWorth)

export type SaleSortKey = 'fresh' | 'name' | 'price' | 'trader' | 'pays' | 'profit'

/** «Продажа торговцам» by a heading: the cheapest, the highest pay, the most profit first; names by the alphabet. */
const saleValue: Record<Exclude<SaleSortKey, 'fresh'>, (sale: TraderSale) => number | string> = {
  name: (sale) => uiText(sale.item.name),
  price: (sale) => sale.price,
  trader: (sale) => uiText(sale.traderName),
  pays: (sale) => -sale.traderPrice,
  profit: (sale) => -sale.profit,
}

export function sortSales(sales: readonly TraderSale[], sort: TableSort<SaleSortKey>): TraderSale[] {
  return sort.key === 'fresh' ? freshestFirst(sales, (sale) => sale.renewedAt, (sale) => sale.profit, sort.dir) : sortByValue(sales, saleValue[sort.key], sort.dir)
}

/** Which signals are worth interrupting the player for: big enough and, for a listing, with a past that paid. */
export function notifiable(rows: readonly BoardRow[], minProfit: number): BoardRow[] {
  return rows
    .filter((entry) => entry.signal && entry.signal.profit >= minProfit && (entry.signal.route === 'trader' || entry.reliability >= 0.8))
    .sort((a, b) => b.signal!.profit - a.signal!.profit)
}
