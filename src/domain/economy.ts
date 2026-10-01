import type { Barter, Craft, EconomyItem, EconomySnapshot, ItemCount, TaskRef } from '../data/economyApi'
import { fleaMarketFee, type FleaFeeOptions } from './fleaFee'

/**
 * Profit math for the «Экономика» pages. Pure functions over an EconomySnapshot of ONE game mode
 * (PvP and PvE snapshots are loaded and cached separately, never mixed).
 */

export interface PriceContext {
  fleaEnabled: boolean
  feeOptions?: Omit<FleaFeeOptions, 'count'>
  /** Highest loyalty level per trader id the player has. Missing trader → `defaultTraderLevel`. */
  traderLevels?: Record<string, number>
  /** Applied to traders not in `traderLevels`; 4 (max) means every offer is available. */
  defaultTraderLevel?: number
}

export interface PriceChoice {
  source: string
  kind: 'flea' | 'trader'
  /** Per unit, roubles. */
  unitPrice: number
  /** For a flea sale: the listing fee per unit, already subtracted from unitPrice. */
  fee?: number
}

/** Current flea price used for both buying and selling: the lowest live offer, else the 24h average. */
export function fleaPrice(item: EconomyItem): number | undefined {
  return item.lastLowPrice ?? item.low24hPrice ?? item.avg24hPrice
}

function traderLevelAllows(traderId: string | undefined, minLevel: number | undefined, context: PriceContext) {
  if (!traderId || !minLevel) return true
  const level = context.traderLevels?.[traderId] ?? context.defaultTraderLevel ?? 4
  return minLevel <= level
}

/** Cheapest way to obtain one unit: flea (unless flea-banned/disabled) or a trader offer the player can use. */
export function cheapestBuy(item: EconomyItem | undefined, context: PriceContext): PriceChoice | null {
  if (!item) return null
  const options: PriceChoice[] = []
  const flea = fleaPrice(item)
  if (context.fleaEnabled && !item.noFlea && flea) options.push({ source: 'Барахолка', kind: 'flea', unitPrice: flea })
  for (const offer of item.buyFor) {
    if (offer.kind !== 'trader') continue
    if (!traderLevelAllows(offer.traderId, offer.minTraderLevel, context)) continue
    options.push({ source: offer.source, kind: 'trader', unitPrice: offer.price })
  }
  return options.sort((a, b) => a.unitPrice - b.unitPrice)[0] ?? null
}

/** Best value of one unit when sold: flea price minus fee (unless flea-banned) or the best trader buy-back. */
export function bestSell(item: EconomyItem | undefined, context: PriceContext, count = 1): PriceChoice | null {
  if (!item) return null
  const options: PriceChoice[] = []
  const flea = fleaPrice(item)
  if (context.fleaEnabled && !item.noFlea && flea) {
    const fee = fleaMarketFee(item.basePrice, flea, { ...context.feeOptions, count: Math.max(1, count) }) / Math.max(1, count)
    options.push({ source: 'Барахолка', kind: 'flea', unitPrice: flea - fee, fee })
  }
  for (const quote of item.sellFor) {
    if (quote.kind === 'trader') options.push({ source: quote.source, kind: 'trader', unitPrice: quote.price })
  }
  return options.sort((a, b) => b.unitPrice - a.unitPrice)[0] ?? null
}

export interface PricedLine {
  itemId: string
  name: string
  shortName: string
  iconUrl?: string
  count: number
  choice: PriceChoice | null
  total: number | null
}

function priceLines(lines: ItemCount[], items: Record<string, EconomyItem>, pick: (item: EconomyItem | undefined, count: number) => PriceChoice | null): PricedLine[] {
  return lines.map(({ itemId, count }) => {
    const item = items[itemId]
    const choice = pick(item, count)
    return {
      itemId,
      name: item?.name ?? itemId,
      shortName: item?.shortName ?? itemId,
      iconUrl: item?.iconUrl,
      count,
      choice,
      total: choice ? Math.round(choice.unitPrice * count) : null,
    }
  })
}

const sum = (lines: PricedLine[]) => lines.every((line) => line.total !== null) ? lines.reduce((total, line) => total + (line.total ?? 0), 0) : null

export interface ProfitResult {
  cost: number | null
  value: number | null
  profit: number | null
  /** Profit as a percentage of the cost. */
  percent: number | null
}

export function profitOf(cost: number | null, value: number | null): ProfitResult {
  if (cost === null || value === null) return { cost, value, profit: null, percent: null }
  const profit = value - cost
  return { cost, value, profit, percent: cost > 0 ? (profit / cost) * 100 : null }
}

export interface BarterRow extends ProfitResult {
  id: string
  traderId: string
  traderName: string
  level: number
  taskUnlock?: TaskRef
  buyLimit?: number
  inputs: PricedLine[]
  outputs: PricedLine[]
  /** The player's trader level is known and lower than the barter needs. */
  locked: boolean
}

export function barterRows(snapshot: EconomySnapshot, context: PriceContext): BarterRow[] {
  return snapshot.barters.map((barter: Barter) => {
    const inputs = priceLines(barter.requiredItems, snapshot.items, (item) => cheapestBuy(item, context))
    const outputs = priceLines(barter.rewardItems, snapshot.items, (item, count) => bestSell(item, context, count))
    return {
      id: barter.id,
      traderId: barter.traderId,
      traderName: barter.traderName,
      level: barter.level,
      taskUnlock: barter.taskUnlock,
      buyLimit: barter.buyLimit,
      inputs,
      outputs,
      locked: !traderLevelAllows(barter.traderId, barter.level, context),
      ...profitOf(sum(inputs), sum(outputs)),
    }
  })
}

/**
 * Generator fuel. Escape from Tarkov wiki «Generator»: one fuel resource unit burns every ~14 min 47 s,
 * i.e. a 60-unit Expeditionary fuel tank lasts ≈ 14 h 47 min and a 100-unit Metal fuel tank ≈ 24 h 38 min
 * (without the Solar power module, which halves consumption). Resource sizes are the in-game tank capacities.
 */
export const FUEL_UNITS_PER_HOUR = 3600 / 887
export const FUEL_ITEMS: Array<{ id: string; units: number }> = [
  { id: '5d1b371186f774253763a656', units: 60 }, // Expeditionary fuel tank
  { id: '5d1b36a186f7742523398433', units: 100 }, // Metal fuel tank
]
/** Stations that keep producing without power (everything else stops when the generator is off). */
export const UNPOWERED_STATIONS = new Set(['cultist-circle'])

export function fuelCostPerHour(items: Record<string, EconomyItem>, context: PriceContext, solarPower = false): number | null {
  const perUnit = FUEL_ITEMS
    .map(({ id, units }) => { const buy = cheapestBuy(items[id], context); return buy ? buy.unitPrice / units : null })
    .filter((value): value is number => value !== null)
  if (!perUnit.length) return null
  return Math.min(...perUnit) * FUEL_UNITS_PER_HOUR * (solarPower ? 0.5 : 1)
}

export interface CraftRow extends ProfitResult {
  id: string
  stationId: string
  stationName: string
  level: number
  duration: number
  taskUnlock?: TaskRef
  inputs: PricedLine[]
  outputs: PricedLine[]
  fuelCost: number
  profitPerHour: number | null
  /** The station level is known (Hideout page) and below what this craft needs. */
  locked: boolean
}

export interface CraftContext extends PriceContext {
  /** Per-hour fuel cost to add to powered crafts; 0/undefined = ignore fuel. */
  fuelPerHour?: number | null
  /** Station levels from the Hideout page (app state). Missing station → unknown (not locked). */
  stationLevels?: Record<string, number>
}

export function craftRows(snapshot: EconomySnapshot, context: CraftContext): CraftRow[] {
  return snapshot.crafts.map((craft: Craft) => {
    const inputs = priceLines(craft.requiredItems, snapshot.items, (item) => cheapestBuy(item, context))
    const outputs = priceLines(craft.rewardItems, snapshot.items, (item, count) => bestSell(item, context, count))
    const hours = craft.duration / 3600
    const powered = !UNPOWERED_STATIONS.has(craft.stationNormalizedName ?? '')
    const fuelCost = powered && context.fuelPerHour ? Math.round(context.fuelPerHour * hours) : 0
    const inputCost = sum(inputs)
    const result = profitOf(inputCost === null ? null : inputCost + fuelCost, sum(outputs))
    const known = context.stationLevels?.[craft.stationId]
    return {
      id: craft.id,
      stationId: craft.stationId,
      stationName: craft.stationName,
      level: craft.level,
      duration: craft.duration,
      taskUnlock: craft.taskUnlock,
      inputs,
      outputs,
      fuelCost,
      locked: known !== undefined && known < craft.level,
      ...result,
      profitPerHour: result.profit !== null && hours > 0 ? result.profit / hours : null,
    }
  })
}

export type SortDirection = 'asc' | 'desc'

/** Sort by a numeric field; rows without a value (missing prices) always go last. Stable for equal values. */
export function sortByNumber<T>(rows: T[], value: (row: T) => number | null | undefined, direction: SortDirection = 'desc'): T[] {
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      const aMissing = a.key === null || a.key === undefined || Number.isNaN(a.key)
      const bMissing = b.key === null || b.key === undefined || Number.isNaN(b.key)
      if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1
      const diff = (a.key as number) - (b.key as number)
      return diff === 0 ? a.index - b.index : direction === 'asc' ? diff : -diff
    })
    .map(({ row }) => row)
}

export function matchesSearch(query: string, lines: PricedLine[], ...extra: string[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [...lines.flatMap((line) => [line.name, line.shortName]), ...extra].some((value) => value.toLowerCase().includes(needle))
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours ? `${hours} ч ${String(minutes).padStart(2, '0')} мин` : `${minutes} мин`
}
