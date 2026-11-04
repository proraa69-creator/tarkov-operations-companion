import { fleaMarketFee, type FleaFeeOptions } from './fleaFee'

/**
 * «Торговля» in «Экономика» (owner, 05.11.2026: «Купить дешевле, продать дороже»): which flea items swing hard enough to
 * earn on, what the swing has paid in the past, and when a price is low or high right now. Pure, shared by the server
 * (it builds the statistics rarely, services/tradingStats.ts) and the app (it holds them against the current price).
 *
 * What the numbers are, checked on the real history of 05.11.2026 (docs/trading.md):
 * - a scan's `priceMin` is the cheapest offer at that moment: what one could really buy at, and the price to undercut
 *   to sell. Never the scan's average `price` or the 24-hour high, which are pulled up by offers nobody takes;
 * - a scan with one or two offers says nothing about the market (a key at 4 500 000 ₽ when the only other seller left):
 *   it is left out;
 * - prices arrive up to ~1.5 hours late (tarkov.dev scans items in turn), so the past is judged as if the player buys at
 *   the NEXT scan: the buying price of a signal is usually gone by then, and that halves what the scheme earns.
 *
 * Everything here is an estimate from history, not a promise: nothing says a listing will find a buyer.
 */
export const LONE_LISTING_OFFERS = 2
/** The cheapest tenth of a week's scans is the buying zone, the dearest 15% the selling zone. */
export const BUY_QUANTILE = 0.1
export const SELL_QUANTILE = 0.85
/** A listing has to be the cheapest to sell: 1% under the current lowest offer. */
export const UNDERCUT = 0.01
export const MIN_PROFIT_ROUBLES = 1000
export const MIN_PROFIT_SHARE = 0.05
export const MIN_MEDIAN_OFFERS = 5
export const MIN_PRICE = 3000
/** A flea signal needs the price this far from the week's usual one: a flat item's «lowest tenth» is no fall at all. */
export const MIN_MOVE = 0.1
/** A floor under a trader's price by at least this much is worth the click. */
const TRADER_MARGIN_ROUBLES = 500
const TRADER_MARGIN_SHARE = 0.02

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** What a player can sensibly wait for after buying. */
const HOLD_MS = 48 * HOUR
/** One dip is one signal, however many scans it lasts. */
const SIGNAL_COOLDOWN_MS = 24 * HOUR
const PRIOR_WINDOW_MS = 7 * DAY
const HISTORY_MS = 37 * DAY
const MIN_PRIOR_SCANS = 40
const MIN_WEEK_SCANS = 30

export interface PriceScan { timestamp: number; floor: number; offers?: number }

/** One period's cheapest offers, outliers shown as they were: `min` and `max` are what was seen, p10/p90 what is usual. */
export interface TradingWindow { min: number; max: number; p10: number; p50: number; p90: number; offers: number; scans: number }

export interface TradingBacktest {
  /** Dips of the last month that looked worth buying at the time, judged by what was known then. */
  signals: number
  /** Ended in profit: bought at the next scan, sold in the selling zone within 48 hours or at the end of them. */
  wins: number
  avgProfit: number
  /** The usual result of one dip: an average is carried by a few lucky ones. */
  medianProfit: number
  medianHours: number
}

/** One item of one mode: the numbers a player reads, with no names (the app has them in its language). */
export interface TradingRow {
  id: string
  base: number
  /** The character level this item opens at on the flea market (0: with the market itself). */
  level: number
  slots: number
  kind: TradingKind
  w3?: TradingWindow
  w7: TradingWindow
  buyBelow: number
  sellAbove: number
  backtest: TradingBacktest
  /** Share of the week's scans in which the cheapest offer was under what a trader pays. */
  traderShare: number
  /** The last day against the week: −0.2 means 20% below the usual price. */
  trend: number
  /** Cheapest and dearest time of day, the start of a 2-hour UTC bucket: only where the difference is real. */
  hours?: { cheap: number; dear: number; effect: number }
  /** The week's cheapest offers, oldest first, one per scan. */
  series: number[]
}

export type TradingKind = 'barter' | 'key' | 'gear' | 'weapon' | 'other'

export interface TradingSnapshot {
  format: 1
  mode: 'regular' | 'pve' | 'pvp-season'
  builtAt: string
  /** Items looked at / that passed the profit checks (the rows are the best of those). */
  analyzed: number
  eligible: number
  fee: { offerFeeRate: number; requirementFeeRate: number }
  rows: TradingRow[]
}

export interface TradingItemInput {
  id: string
  base: number
  level: number
  slots: number
  types: readonly string[]
  /** What the traders pay (the best is used). */
  traderPrices: readonly number[]
  scans: readonly PriceScan[]
}

export function tradingKind(types: readonly string[]): TradingKind {
  if (types.includes('keys')) return 'key'
  if (types.includes('gun')) return 'weapon'
  if (['armor', 'rig', 'helmet', 'backpack', 'wearable', 'headphones', 'glasses'].some((type) => types.includes(type))) return 'gear'
  if (types.includes('barter')) return 'barter'
  return 'other'
}

const ascending = (values: readonly number[]) => [...values].sort((a, b) => a - b)
const quantile = (sorted: readonly number[], share: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))))]!

/** A profit worth acting on for this price. */
export const worthwhile = (profit: number, price: number) => profit >= Math.max(MIN_PROFIT_ROUBLES, price * MIN_PROFIT_SHARE)

/** What is left of selling at this floor: listed 1% under it, minus the listing fee. */
export function fleaNet(base: number, floor: number, fee: Omit<FleaFeeOptions, 'count'>) {
  const ask = Math.round(floor * (1 - UNDERCUT))
  return ask - fleaMarketFee(base, ask, fee)
}

function windowOf(scans: readonly PriceScan[]): TradingWindow {
  const floors = ascending(scans.map((scan) => scan.floor))
  const offers = ascending(scans.map((scan) => scan.offers ?? 0))
  return { min: floors[0]!, max: floors[floors.length - 1]!, p10: quantile(floors, 0.1), p50: quantile(floors, 0.5), p90: quantile(floors, 0.9), offers: quantile(offers, 0.5), scans: scans.length }
}

/**
 * The past month as if this scheme had been followed, knowing only what was known then: a floor in the buying zone of the
 * week before it, the expected profit worth it → the player buys at the next scan and sells at the first floor in that
 * week's selling zone within 48 hours, else at the end of them; to a trader when he pays more. A sale in the zone counts
 * at the zone's price, not at the jump that crossed it: one lone dear listing must not make an item look like a gold mine.
 */
export function backtest(scans: readonly PriceScan[], base: number, trader: number, fee: Omit<FleaFeeOptions, 'count'>): TradingBacktest {
  const end = scans[scans.length - 1]?.timestamp ?? 0
  const profits: number[] = []
  const hours: number[] = []
  let notBefore = 0
  let from = 0
  for (let at = 0; at < scans.length - 1; at += 1) {
    const scan = scans[at]!
    if (scan.timestamp < scans[0]!.timestamp + PRIOR_WINDOW_MS || scan.timestamp < notBefore) continue
    if (scan.timestamp > end - HOLD_MS) break
    while (scans[from]!.timestamp < scan.timestamp - PRIOR_WINDOW_MS) from += 1
    if (at - from < MIN_PRIOR_SCANS) continue
    const prior = ascending(scans.slice(from, at).map((entry) => entry.floor))
    const buyBelow = quantile(prior, BUY_QUANTILE)
    if (scan.floor > buyBelow) continue
    const target = fleaNet(base, quantile(prior, SELL_QUANTILE), fee)
    if (!worthwhile(Math.max(target, trader) - scan.floor, scan.floor)) continue
    notBefore = scan.timestamp + SIGNAL_COOLDOWN_MS
    const buy = scans[at + 1]!.floor
    let sale: number | undefined
    let held = HOLD_MS / HOUR
    if (trader >= target) { sale = trader; held = 0 }
    else {
      let last: number | undefined
      for (let next = at + 2; next < scans.length && scans[next]!.timestamp <= scan.timestamp + HOLD_MS; next += 1) {
        last = fleaNet(base, scans[next]!.floor, fee)
        if (last >= target) { sale = target; held = (scans[next]!.timestamp - scan.timestamp) / HOUR; break }
      }
      // No scan after buying (a gap in the history): nothing can be said about this one.
      if (sale === undefined) {
        if (last === undefined) continue
        sale = Math.max(last, trader)
      }
    }
    profits.push(sale - buy)
    hours.push(held)
  }
  if (!profits.length) return { signals: 0, wins: 0, avgProfit: 0, medianProfit: 0, medianHours: 0 }
  return {
    signals: profits.length,
    wins: profits.filter((profit) => profit > 0).length,
    avgProfit: Math.round(profits.reduce((sum, profit) => sum + profit, 0) / profits.length),
    medianProfit: Math.round(quantile(ascending(profits), 0.5)),
    medianHours: quantile(ascending(hours), 0.5),
  }
}

/** The time of day a floor is usually lowest and highest, when the difference is at least 10% of the price. */
function hourPattern(scans: readonly PriceScan[]): TradingRow['hours'] {
  const buckets: number[][] = Array.from({ length: 12 }, () => [])
  for (const scan of scans) buckets[Math.floor(new Date(scan.timestamp).getUTCHours() / 2)]!.push(scan.floor)
  const medians = buckets.map((floors) => floors.length >= 4 ? quantile(ascending(floors), 0.5) : undefined)
  const known = medians.flatMap((median, bucket) => median === undefined ? [] : [{ median, bucket }])
  if (known.length < 8) return undefined
  const cheap = known.reduce((best, entry) => entry.median < best.median ? entry : best)
  const dear = known.reduce((best, entry) => entry.median > best.median ? entry : best)
  const overall = quantile(ascending(scans.map((scan) => scan.floor)), 0.5)
  const effect = (dear.median - cheap.median) / overall
  return effect >= 0.1 ? { cheap: cheap.bucket * 2, dear: dear.bucket * 2, effect: Math.round(effect * 100) / 100 } : undefined
}

/**
 * The row of one item, or null when it is not worth a look: too few scans, too few sellers, too cheap, or not profitable
 * even when bought at the week's lowest and sold at its highest (owner: «смысла тогда нету этот предмет вообще
 * рассматривать»), or unprofitable in the past month's dips.
 */
export function tradingRow(input: TradingItemInput, fee: Omit<FleaFeeOptions, 'count'>, now: number): TradingRow | null {
  if (!(input.base > 0)) return null
  const clean = input.scans.filter((scan) => scan.floor > 0 && (scan.offers === undefined || scan.offers > LONE_LISTING_OFFERS))
    .filter((scan) => scan.timestamp >= now - HISTORY_MS)
  const newest = clean[clean.length - 1]?.timestamp
  if (newest === undefined || newest < now - 2 * DAY) return null
  const week = clean.filter((scan) => scan.timestamp >= newest - 7 * DAY)
  if (week.length < MIN_WEEK_SCANS) return null
  const w7 = windowOf(week)
  if (w7.p50 < MIN_PRICE || w7.offers < MIN_MEDIAN_OFFERS) return null
  const floors = ascending(week.map((scan) => scan.floor))
  const buyBelow = quantile(floors, BUY_QUANTILE)
  const sellAbove = quantile(floors, SELL_QUANTILE)
  const trader = Math.max(0, ...input.traderPrices)
  // The owner's test: at the very lowest and at the best the week offered, is there anything at all?
  const bestNet = floors.reduce((best, floor) => Math.max(best, fleaNet(input.base, floor, fee)), trader)
  if (!worthwhile(bestNet - w7.min, w7.min)) return null
  // The same with the usual lows and highs: a one-off cannot carry an item into the list.
  if (!worthwhile(Math.max(fleaNet(input.base, sellAbove, fee), trader) - buyBelow, buyBelow)) return null
  const past = backtest(clean, input.base, trader, fee)
  if (past.signals < 3 || past.wins / past.signals < 0.5 || past.avgProfit <= 0 || past.medianProfit <= 0) return null
  const threeDays = clean.filter((scan) => scan.timestamp >= newest - 3 * DAY)
  const lastDay = ascending(clean.filter((scan) => scan.timestamp >= newest - DAY).map((scan) => scan.floor))
  const margin = Math.max(TRADER_MARGIN_ROUBLES, trader * TRADER_MARGIN_SHARE)
  const hours = hourPattern(clean)
  return {
    id: input.id,
    base: input.base,
    level: input.level,
    slots: input.slots,
    kind: tradingKind(input.types),
    ...(threeDays.length >= 12 ? { w3: windowOf(threeDays) } : {}),
    w7,
    buyBelow,
    sellAbove,
    backtest: past,
    traderShare: Math.round((week.filter((scan) => trader - scan.floor >= margin).length / week.length) * 100) / 100,
    trend: lastDay.length ? Math.round(((quantile(lastDay, 0.5) - w7.p50) / w7.p50) * 100) / 100 : 0,
    ...(hours ? { hours } : {}),
    series: week.map((scan) => scan.floor),
  }
}

/** How wide a period's usual range is, against its usual price. */
export const swingOf = (window: TradingWindow) => (window.p90 - window.p10) / window.p50

/** The market itself opens at this level; an item may ask for more (tarkov.dev `minLevelForFlea`). */
export const MARKET_LEVEL = 15
/** The levels at which the market opens more items. */
const LEVEL_GATES = [MARKET_LEVEL, 20, 25, 30, 35, 40]

/** Whether the market lets this character buy and list the item. */
export const openAtLevel = (itemLevel: number, playerLevel: number) => playerLevel >= Math.max(MARKET_LEVEL, itemLevel)

/**
 * The rows to send: at every level the market opens more items, those that earned most in the past and those that swing
 * hardest among what a player of that level can trade (owner, 05.11.2026: only what is open to him is shown, so a list
 * made for level 40 would leave a level 15 player almost nothing).
 */
export function pickRows(rows: readonly TradingRow[], perLevel = 100): TradingRow[] {
  const kept = new Map<string, TradingRow>()
  for (const gate of LEVEL_GATES) {
    const open = rows.filter((row) => openAtLevel(row.level, gate))
    const byProfit = [...open].sort((a, b) => b.backtest.medianProfit - a.backtest.medianProfit).slice(0, Math.round(perLevel * 2 / 3))
    const taken = new Set(byProfit.map((row) => row.id))
    const bySwing = [...open].sort((a, b) => swingOf(b.w7) - swingOf(a.w7)).filter((row) => !taken.has(row.id)).slice(0, perLevel - byProfit.length)
    for (const row of [...byProfit, ...bySwing]) kept.set(row.id, row)
  }
  return [...kept.values()].sort((a, b) => swingOf(b.w7) - swingOf(a.w7))
}

export type SignalKind = 'buy' | 'sell'
export type SignalRoute = 'trader' | 'flea'

export interface TradingSignal {
  kind: SignalKind
  route: SignalRoute
  /** The price it is read at: the cheapest offer now. */
  price: number
  /** Estimated profit per item (buy: from this price; sell: over the buying zone). */
  profit: number
  /** Flea route: the floor to wait for, the fee at it, what is left. */
  sellAt?: number
  fee?: number
  net?: number
}

export interface TradingEstimate {
  /** The sale that leaves more when bought at `buyPrice`: a trader at once, or the flea market in the selling zone. */
  route: SignalRoute
  profit: number
  sellAt?: number
  fee?: number
  net?: number
}

/** What buying at this price should earn: the better of a trader now and a listing once the floor is in the selling zone. */
export function estimateFrom(row: Pick<TradingRow, 'base' | 'sellAbove'>, buyPrice: number, trader: number, fee: Omit<FleaFeeOptions, 'count'>): TradingEstimate {
  const ask = Math.round(row.sellAbove * (1 - UNDERCUT))
  const listingFee = fleaMarketFee(row.base, ask, fee)
  const net = ask - listingFee
  if (trader >= net) return { route: 'trader', profit: trader - buyPrice }
  return { route: 'flea', profit: net - buyPrice, sellAt: ask, fee: listingFee, net }
}

/** How often the past dips of this item paid off. */
export const reliabilityOf = (past: TradingBacktest) => past.signals ? past.wins / past.signals : 0
export type ReliabilityTier = 'high' | 'medium' | 'low'
export const reliabilityTier = (past: TradingBacktest): ReliabilityTier => {
  const share = reliabilityOf(past)
  return share >= 0.8 ? 'high' : share >= 0.6 ? 'medium' : 'low'
}

/**
 * The signal of one item at the current price, or null. A floor under a trader's price needs no history to trust, only a
 * fresh price; the flea route needs a past that paid off at least 3 times in 5.
 */
export function tradingSignal(row: TradingRow, current: number, trader: number, fee: Omit<FleaFeeOptions, 'count'>): TradingSignal | null {
  if (!(current > 0)) return null
  const margin = Math.max(TRADER_MARGIN_ROUBLES, trader * TRADER_MARGIN_SHARE)
  const estimate = estimateFrom(row, current, trader, fee)
  const atOnce: TradingSignal | null = trader > 0 && trader - current >= margin ? { kind: 'buy', route: 'trader', price: current, profit: trader - current } : null
  if (atOnce && atOnce.profit >= estimate.profit) return atOnce
  const trusted = reliabilityOf(row.backtest) >= 0.6 && row.backtest.signals >= 3
  if (current <= row.buyBelow && current <= row.w7.p50 * (1 - MIN_MOVE) && trusted && worthwhile(estimate.profit, current)) {
    return { kind: 'buy', route: estimate.route, price: current, profit: estimate.profit, ...(estimate.route === 'flea' ? { sellAt: estimate.sellAt, fee: estimate.fee, net: estimate.net } : {}) }
  }
  // A listing might pay more, but the price is no low: the sure profit at a trader still stands.
  if (atOnce) return atOnce
  if (current >= row.sellAbove && current >= row.w7.p50 * (1 + MIN_MOVE) && trusted) {
    const ask = Math.round(current * (1 - UNDERCUT))
    const listingFee = fleaMarketFee(row.base, ask, fee)
    const net = ask - listingFee
    if (net > trader && worthwhile(net - row.buyBelow, row.buyBelow)) return { kind: 'sell', route: 'flea', price: current, profit: net - row.buyBelow, sellAt: ask, fee: listingFee, net }
  }
  return null
}

/** The lowest listing that does not lose money on an item bought at `paid` (the fee grows with the price, so it is searched). */
export function breakEvenAsk(base: number, paid: number, fee: Omit<FleaFeeOptions, 'count'>): number | null {
  let low = Math.max(1, Math.round(paid))
  let high = low * 8
  const net = (ask: number) => ask - fleaMarketFee(base, ask, fee)
  if (net(low) >= paid) {
    // Rarely: the fee is small enough already at the price paid.
    return low
  }
  // The net rises and later falls: the best listing has to be above what was paid, or there is none.
  let top = low
  for (let ask = low; ask <= high; ask = Math.ceil(ask * 1.1)) if (net(ask) > net(top)) top = ask
  if (net(top) < paid) return null
  high = top
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (net(middle) >= paid) high = middle
    else low = middle
  }
  return high
}

export const STALE_AFTER_MS = 36 * HOUR

/** Statistics older than this are not used for signals: the server has stopped refreshing them. */
export const tradingStale = (snapshot: Pick<TradingSnapshot, 'builtAt'>, now: number) => {
  const at = Date.parse(snapshot.builtAt)
  return !Number.isFinite(at) || now - at > STALE_AFTER_MS
}
