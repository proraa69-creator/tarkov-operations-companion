import { tarkovGraphql } from './tarkovApi'
import { readGameCache, writeGameCache } from './gameDataCache'
import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { DEFAULT_OFFER_FEE_RATE, DEFAULT_REQUIREMENT_FEE_RATE } from '../domain/fleaFee'

/**
 * Barters, hideout crafts and per-mode prices from the tarkov.dev GraphQL API (https://api.tarkov.dev/graphql,
 * schema: https://github.com/the-hideout/tarkov-api). The JSON catalog (catalogSource.ts) has no barters/crafts
 * and no buy offers, so the economy pages load this separately and cache it per mode and language.
 */
export const ECONOMY_GRAPHQL_URL = 'https://api.tarkov.dev/graphql'
const CACHE_PREFIX = 'tarkov-operations-economy-v1'
/** An offline copy of barters and crafts is shown for at most this long (never past the entitlement in the players' app). */
const ECONOMY_CACHE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * GraphQL `GameMode` per app mode. tarkov.dev's GraphQL enum has `regular` and `pve`; it has no separate Season
 * value, so Season returns null and the pages say so instead of showing PvP prices as Season prices (CLAUDE.md:
 * PvP, PvE and Season stay separate).
 */
export function graphqlGameMode(mode: RaidMode): 'regular' | 'pve' | null {
  if (mode === 'pvp') return 'regular'
  if (mode === 'pve') return 'pve'
  return null
}

export interface TaskRef { id: string; name: string }

export interface VendorPrice {
  source: string
  /** tarkov.dev trader id; absent for the flea market. */
  traderId?: string
  kind: 'flea' | 'trader'
  /** Price in roubles (tarkov.dev `priceRUB`). */
  price: number
  minTraderLevel?: number
  taskUnlock?: TaskRef
  buyLimit?: number
}

export interface EconomyItem {
  id: string
  name: string
  shortName: string
  iconUrl?: string
  basePrice: number
  avg24hPrice?: number
  low24hPrice?: number
  lastLowPrice?: number
  /** tarkov.dev `types` contains `noFlea`: the item cannot be listed on the flea market. */
  noFlea: boolean
  buyFor: VendorPrice[]
  sellFor: VendorPrice[]
}

export interface ItemCount { itemId: string; count: number }

export interface Barter {
  id: string
  traderId: string
  traderName: string
  traderNormalizedName?: string
  level: number
  taskUnlock?: TaskRef
  buyLimit?: number
  requiredItems: ItemCount[]
  rewardItems: ItemCount[]
}

export interface Craft {
  id: string
  stationId: string
  stationName: string
  stationNormalizedName?: string
  level: number
  /** Seconds. */
  duration: number
  taskUnlock?: TaskRef
  requiredItems: ItemCount[]
  rewardItems: ItemCount[]
}

export interface EconomySnapshot {
  mode: RaidMode
  items: Record<string, EconomyItem>
  barters: Barter[]
  crafts: Craft[]
  flea: { enabled: boolean; offerFeeRate: number; requirementFeeRate: number }
  loadedAt: string
  source?: 'live' | 'cache'
}

export interface PricePoint { timestamp: number; price: number; priceMin?: number }

const VENDOR_FIELDS = `priceRUB vendor { name normalizedName ... on TraderOffer { trader { id } minTraderLevel buyLimit taskUnlock { id name } } }`
const COUNT_FIELDS = 'item { id } count'

/** One request for everything the barter and craft pages need. Enum values are inlined (no variable types). */
export function economyQuery(gameMode: 'regular' | 'pve', lang: AppLocale): string {
  return `{
  fleaMarket(gameMode: ${gameMode}) { enabled sellOfferFeeRate sellRequirementFeeRate }
  items(gameMode: ${gameMode}, lang: ${lang}) {
    id name shortName iconLink basePrice avg24hPrice low24hPrice lastLowPrice types
    buyFor { ${VENDOR_FIELDS} }
    sellFor { ${VENDOR_FIELDS} }
  }
  barters(gameMode: ${gameMode}, lang: ${lang}) {
    id level buyLimit
    trader { id name normalizedName }
    taskUnlock { id name }
    requiredItems { ${COUNT_FIELDS} }
    rewardItems { ${COUNT_FIELDS} }
  }
  crafts(gameMode: ${gameMode}, lang: ${lang}) {
    id level duration
    station { id name normalizedName }
    taskUnlock { id name }
    requiredItems { ${COUNT_FIELDS} }
    rewardItems { ${COUNT_FIELDS} }
  }
}`
}

export function priceHistoryQuery(itemId: string, gameMode: 'regular' | 'pve', days = 30): string {
  return `{ historicalItemPrices(id: ${JSON.stringify(itemId)}, days: ${Math.max(1, Math.round(days))}, gameMode: ${gameMode}) { price priceMin timestamp } }`
}

type Json = Record<string, unknown>
const asRecord = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const asArray = (value: unknown): Json[] => Array.isArray(value) ? value.map(asRecord) : []
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const num = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}
const positive = (value: unknown) => { const parsed = num(value); return parsed && parsed > 0 ? parsed : undefined }
const task = (value: unknown): TaskRef | undefined => {
  const record = asRecord(value)
  return text(record.id) ? { id: text(record.id), name: text(record.name, text(record.id)) } : undefined
}

function vendorPrice(entry: Json): VendorPrice | null {
  const vendor = asRecord(entry.vendor)
  const price = positive(entry.priceRUB)
  if (!price) return null
  const traderId = text(asRecord(vendor.trader).id)
  const flea = text(vendor.normalizedName) === 'flea-market' || !traderId
  return {
    source: text(vendor.name, flea ? 'Барахолка' : 'Торговец'),
    traderId: flea ? undefined : traderId,
    kind: flea ? 'flea' : 'trader',
    price,
    minTraderLevel: flea ? undefined : num(vendor.minTraderLevel),
    taskUnlock: flea ? undefined : task(vendor.taskUnlock),
    buyLimit: flea ? undefined : positive(vendor.buyLimit),
  }
}

const counts = (value: unknown): ItemCount[] => asArray(value)
  .map((entry) => ({ itemId: text(asRecord(entry.item).id), count: num(entry.count) ?? 1 }))
  .filter((entry) => entry.itemId)

/** GraphQL `data` → snapshot. Pure, so it is tested against a recorded-shape fixture. */
export function parseEconomyResponse(data: unknown, mode: RaidMode, loadedAt = new Date().toISOString()): EconomySnapshot {
  const root = asRecord(data)
  const flea = asRecord(root.fleaMarket)
  const items: Record<string, EconomyItem> = {}
  for (const entry of asArray(root.items)) {
    const id = text(entry.id)
    if (!id) continue
    const types = Array.isArray(entry.types) ? entry.types.map(String) : []
    items[id] = {
      id,
      name: text(entry.name, id),
      shortName: text(entry.shortName, text(entry.name, id)),
      iconUrl: text(entry.iconLink) || undefined,
      basePrice: num(entry.basePrice) ?? 0,
      avg24hPrice: positive(entry.avg24hPrice),
      low24hPrice: positive(entry.low24hPrice),
      lastLowPrice: positive(entry.lastLowPrice),
      noFlea: types.includes('noFlea'),
      buyFor: asArray(entry.buyFor).map(vendorPrice).filter((quote): quote is VendorPrice => quote !== null),
      sellFor: asArray(entry.sellFor).map(vendorPrice).filter((quote): quote is VendorPrice => quote !== null),
    }
  }
  const barters: Barter[] = asArray(root.barters).map((entry, index) => {
    const trader = asRecord(entry.trader)
    return {
      id: text(entry.id, `barter-${index}`),
      traderId: text(trader.id),
      traderName: text(trader.name, 'Торговец'),
      traderNormalizedName: text(trader.normalizedName) || undefined,
      level: num(entry.level) ?? 1,
      taskUnlock: task(entry.taskUnlock),
      buyLimit: positive(entry.buyLimit),
      requiredItems: counts(entry.requiredItems),
      rewardItems: counts(entry.rewardItems),
    }
  }).filter((barter) => barter.rewardItems.length > 0)
  const crafts: Craft[] = asArray(root.crafts).map((entry, index) => {
    const station = asRecord(entry.station)
    return {
      id: text(entry.id, `craft-${index}`),
      stationId: text(station.id),
      stationName: text(station.name, 'Станция'),
      stationNormalizedName: text(station.normalizedName) || undefined,
      level: num(entry.level) ?? 1,
      duration: num(entry.duration) ?? 0,
      taskUnlock: task(entry.taskUnlock),
      requiredItems: counts(entry.requiredItems),
      rewardItems: counts(entry.rewardItems),
    }
  }).filter((craft) => craft.rewardItems.length > 0)
  return {
    mode,
    items,
    barters,
    crafts,
    flea: {
      enabled: flea.enabled !== false,
      offerFeeRate: num(flea.sellOfferFeeRate) ?? DEFAULT_OFFER_FEE_RATE,
      requirementFeeRate: num(flea.sellRequirementFeeRate) ?? DEFAULT_REQUIREMENT_FEE_RATE,
    },
    loadedAt,
  }
}

export function parsePriceHistory(data: unknown): PricePoint[] {
  return asArray(asRecord(data).historicalItemPrices)
    .map((entry) => ({ timestamp: num(entry.timestamp) ?? Date.parse(text(entry.timestamp)), price: num(entry.price) ?? 0, priceMin: positive(entry.priceMin) }))
    .filter((point) => Number.isFinite(point.timestamp) && point.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp)
}

/** Through the server's data gateway in the players' app (src/data/tarkovApi.ts, docs/subscription-protection.md). */
async function graphql(query: string): Promise<unknown> {
  const body = await tarkovGraphql(query)
  if (!body.data) throw new Error(body.errors?.[0]?.message ?? 'tarkov.dev: пустой ответ')
  return body.data
}

export class SeasonPricesUnavailable extends Error {
  constructor() { super('Для Сезона tarkov.dev не публикует отдельные цены бартеров и крафтов') }
}

export async function fetchEconomySnapshot(mode: RaidMode, locale: AppLocale): Promise<EconomySnapshot> {
  const gameMode = graphqlGameMode(mode)
  if (!gameMode) throw new SeasonPricesUnavailable()
  const cacheKey = `${CACHE_PREFIX}-${mode}-${locale}`
  try {
    const snapshot = parseEconomyResponse(await graphql(economyQuery(gameMode, locale)), mode)
    if (!snapshot.barters.length && !snapshot.crafts.length) throw new Error('tarkov.dev: нет бартеров и крафтов')
    await writeGameCache(cacheKey, snapshot, ECONOMY_CACHE_MS)
    return { ...snapshot, source: 'live' }
  } catch (error) {
    const cached = await readGameCache<EconomySnapshot>(cacheKey)
    if (cached?.mode === mode) return { ...cached, source: 'cache' }
    throw error
  }
}

export async function fetchPriceHistory(itemId: string, mode: RaidMode, days = 30): Promise<PricePoint[]> {
  const gameMode = graphqlGameMode(mode)
  if (!gameMode) throw new SeasonPricesUnavailable()
  return parsePriceHistory(await graphql(priceHistoryQuery(itemId, gameMode, days)))
}
