import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import type { Barter, Craft, EconomyItem, EconomySnapshot, ItemCount, PricePoint, TaskRef, VendorPrice } from './economyApi'
export type { PricePoint } from './economyApi'

type Json = Record<string, unknown>

export interface MinutePrice {
  lastLowPrice?: number
  avg24hPrice?: number
  low24hPrice?: number
  noFlea?: boolean
}

export interface MinutePriceSnapshot {
  mode?: string
  updatedAt?: string
  fleaMarket?: { enabled?: boolean; sellOfferFeeRate?: number; sellRequirementFeeRate?: number }
  items?: Record<string, MinutePrice>
}

export interface TarkovJsonBundle {
  items: unknown
  mode?: RaidMode
  names?: unknown
  traders?: unknown
  barters?: unknown
  crafts?: unknown
  maps?: unknown
  prices?: unknown
  imageBaseUrl?: string
}

const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const array = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : []
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const positive = (value: unknown) => { const parsed = number(value); return parsed !== undefined && parsed > 0 ? parsed : undefined }

export const unwrapTarkovData = (value: unknown): unknown => {
  const root = object(value)
  return root.data === undefined ? value : root.data
}

export function tarkovRecords(value: unknown, key?: string): Json[] {
  const root = unwrapTarkovData(value)
  const selected = key && object(root)[key] !== undefined ? object(root)[key] : root
  if (Array.isArray(selected)) return selected.map(object)
  return Object.values(object(selected)).map(object)
}

const dictionary = (value: unknown, key?: string) => Object.fromEntries(tarkovRecords(value, key).flatMap((row) => text(row.id) ? [[text(row.id), row]] : []))

function localized(names: Json, id: string, field: 'Name' | 'ShortName' | 'Description', fallback = '') {
  return text(names[`${id} ${field}`], fallback)
}

function localImage(base: string, id: string, kind: 'icon' | 'grid') {
  return `${base.replace(/\/$/, '')}/${id}-${kind}.webp`
}

function modeKey(mode: RaidMode) {
  return mode === 'pvp' ? 'regular' : mode === 'seasonal' ? 'pvp-season' : 'pve'
}

function normalizeMinutePrices(value: unknown, mode: RaidMode): MinutePriceSnapshot {
  const root = object(unwrapTarkovData(value)) as MinutePriceSnapshot
  if (root.mode && root.mode !== modeKey(mode)) return {}
  return root
}

function itemRef(id: unknown, items: Record<string, Json>) {
  const key = text(id)
  return key ? { id: key, ...(items[key] ? { name: text(items[key].name, key), shortName: text(items[key].shortName, text(items[key].name, key)) } : {}) } : {}
}

function taskRef(id: unknown, names: Json): TaskRef | undefined {
  const key = text(id)
  return key ? { id: key, name: localized(names, key, 'Name', key) } : undefined
}

function counts(value: unknown): ItemCount[] {
  return array(value).flatMap((entry) => {
    const id = text(entry.item)
    return id ? [{ itemId: id, count: number(entry.count) ?? 1 }] : []
  })
}

function traderVendor(traderId: string, traders: Record<string, Json>, row: Json) {
  const trader = traders[traderId] ?? {}
  return {
    name: text(trader.name, traderId || 'Trader'),
    normalizedName: text(trader.normalizedName, traderId),
    minTraderLevel: number(row.minTraderLevel),
    buyLimit: positive(row.buyLimit),
    taskUnlock: text(row.taskUnlock) ? { id: text(row.taskUnlock), name: text(row.taskUnlock) } : undefined,
    trader: traderId ? { id: traderId, imageLink: text(trader.imageLink) || undefined } : undefined,
  }
}

function legacyOffers(item: Json, traders: Record<string, Json>, price?: MinutePrice) {
  const lastLowPrice = positive(price?.lastLowPrice) ?? positive(item.lastLowPrice)
  const avg24hPrice = positive(price?.avg24hPrice) ?? positive(item.avg24hPrice)
  const buyFor: Json[] = []
  if (lastLowPrice ?? avg24hPrice) buyFor.push({ priceRUB: lastLowPrice ?? avg24hPrice, vendor: { name: 'Flea Market', normalizedName: 'flea-market' } })
  for (const row of array(item.buyFromTrader)) {
    const traderId = text(row.trader)
    const priceRUB = positive(row.priceRUB)
    if (traderId && priceRUB) buyFor.push({ priceRUB, vendor: traderVendor(traderId, traders, row) })
  }
  const sellFor = array(item.sellToTrader).flatMap((row) => {
    const traderId = text(row.trader)
    const priceRUB = positive(row.priceRUB)
    return traderId && priceRUB ? [{ priceRUB, vendor: traderVendor(traderId, traders, row) }] : []
  })
  return { buyFor, sellFor }
}

function legacyProperties(value: unknown, items: Record<string, Json>, names: Json, imageBase: string): Json {
  const row = object(value)
  const type = text(row.propertiesType)
  const slots = array(row.slots).map((slot) => ({
    id: text(slot.id), nameId: text(slot.nameId), name: text(slot.name, text(slot.nameId)), required: slot.required === true,
    filters: { allowedItems: (Array.isArray(object(slot.filters).allowedItems) ? object(slot.filters).allowedItems as unknown[] : []).map((entry) => itemRef(typeof entry === 'string' ? entry : object(entry).id, items)) },
  }))
  const presetId = text(row.defaultPreset)
  const preset = items[presetId]
  const defaultPreset = presetId ? {
    id: presetId,
    name: localized(names, presetId, 'Name', text(preset?.name, presetId)),
    image512pxLink: localImage(imageBase, presetId, 'grid'),
    inspectImageLink: localImage(imageBase, presetId, 'grid'),
    gridImageLink: localImage(imageBase, presetId, 'grid'),
    width: number(preset?.width), height: number(preset?.height),
    containsItems: array(preset?.containsItems).map((entry) => ({ item: itemRef(entry.item, items), count: number(entry.count) ?? 1 })),
  } : undefined
  return {
    ...row,
    ...(type ? { __typename: type } : {}),
    ...(slots.length ? { slots } : {}),
    ...(text(row.defaultAmmo) ? { defaultAmmo: itemRef(row.defaultAmmo, items) } : {}),
    ...(defaultPreset ? { defaultPreset } : {}),
  }
}

/** JSON item catalog converted to the bounded GraphQL item shape used by released Raid OS builds. */
export function buildLegacyItems(bundle: TarkovJsonBundle): Json[] {
  const itemRoot = object(unwrapTarkovData(bundle.items))
  const items = dictionary(itemRoot.items)
  const names = object(unwrapTarkovData(bundle.names))
  const traders = dictionary(bundle.traders, 'traders')
  const prices = object(normalizeMinutePrices(bundle.prices, bundle.mode ?? 'pvp').items)
  const categories = dictionary(itemRoot.itemCategories)
  const imageBase = bundle.imageBaseUrl ?? 'https://raidos.app/v1/item-images'
  return Object.values(items).map((item) => {
    const id = text(item.id)
    const price = object(prices[id]) as MinutePrice
    const categoryId = Array.isArray(item.categories) ? text(item.categories[0]) : ''
    const category = categories[categoryId]
    return {
      ...item,
      name: localized(names, id, 'Name', text(item.name, id)),
      shortName: localized(names, id, 'ShortName', text(item.shortName, text(item.name, id))),
      description: localized(names, id, 'Description', text(item.description)),
      iconLink: localImage(imageBase, id, 'icon'),
      gridImageLink: localImage(imageBase, id, 'grid'),
      image512pxLink: localImage(imageBase, id, 'grid'),
      inspectImageLink: localImage(imageBase, id, 'grid'),
      category: category ? { id: categoryId, name: text(category.name, categoryId), normalizedName: text(category.normalizedName, categoryId) } : undefined,
      categories: (Array.isArray(item.categories) ? item.categories : []).map((entry) => ({ id: text(entry) })).filter((entry) => entry.id),
      conflictingItems: (Array.isArray(item.conflictingItems) ? item.conflictingItems : []).map((entry) => itemRef(entry, items)),
      lastLowPrice: positive(price.lastLowPrice) ?? positive(item.lastLowPrice),
      avg24hPrice: positive(price.avg24hPrice) ?? positive(item.avg24hPrice),
      low24hPrice: positive(price.low24hPrice) ?? positive(item.low24hPrice),
      ...legacyOffers(item, traders, price),
      properties: legacyProperties(item.properties, items, names, imageBase),
    }
  })
}

export function buildLegacyAmmo(bundle: TarkovJsonBundle): Json[] {
  return buildLegacyItems(bundle).filter((item) => Array.isArray(item.types) && item.types.includes('ammo')).flatMap((item) => {
    const properties = object(item.properties)
    if (!text(properties.caliber) || number(properties.damage) === undefined || number(properties.penetrationPower) === undefined) return []
    return [{ item, ...properties }]
  })
}

function vendorPrice(row: Json, traders: Record<string, Json>, names: Json, kind: 'buy' | 'sell'): VendorPrice | null {
  const traderId = text(row.trader)
  const price = positive(row.priceRUB)
  if (!traderId || !price) return null
  const trader = traders[traderId] ?? {}
  return {
    source: text(trader.name, traderId), traderId, kind: 'trader', price,
    minTraderLevel: kind === 'buy' ? number(row.minTraderLevel) : undefined,
    taskUnlock: kind === 'buy' ? taskRef(row.taskUnlock, names) : undefined,
    buyLimit: kind === 'buy' ? positive(row.buyLimit) : undefined,
  }
}

/** Complete client economy snapshot from mirrored JSON plus a same-mode minute price generation. */
export function buildEconomySnapshot(bundle: TarkovJsonBundle, mode: RaidMode, locale: AppLocale, loadedAt = new Date().toISOString()): EconomySnapshot {
  const itemRoot = object(unwrapTarkovData(bundle.items))
  const rawItems = dictionary(itemRoot.items)
  const names = object(unwrapTarkovData(bundle.names))
  const traders = dictionary(bundle.traders, 'traders')
  const minute = normalizeMinutePrices(bundle.prices, mode)
  const imageBase = bundle.imageBaseUrl ?? 'https://raidos.app/v1/item-images'
  const items: Record<string, EconomyItem> = {}
  for (const row of Object.values(rawItems)) {
    const id = text(row.id)
    if (!id) continue
    const quote = minute.items?.[id]
    const lastLowPrice = positive(quote?.lastLowPrice) ?? positive(row.lastLowPrice)
    const avg24hPrice = positive(quote?.avg24hPrice) ?? positive(row.avg24hPrice)
    const flea = lastLowPrice ?? avg24hPrice
    const buyFor = array(row.buyFromTrader).map((entry) => vendorPrice(entry, traders, names, 'buy')).filter((entry): entry is VendorPrice => entry !== null)
    if (flea) buyFor.unshift({ source: 'Flea Market', kind: 'flea', price: flea })
    const sellFor = array(row.sellToTrader).map((entry) => vendorPrice(entry, traders, names, 'sell')).filter((entry): entry is VendorPrice => entry !== null)
    items[id] = {
      id, name: localized(names, id, 'Name', text(row.name, id)), shortName: localized(names, id, 'ShortName', text(row.shortName, text(row.name, id))),
      iconUrl: localImage(imageBase, id, 'icon'), basePrice: number(row.basePrice) ?? 0,
      avg24hPrice, low24hPrice: positive(quote?.low24hPrice) ?? positive(row.low24hPrice), lastLowPrice,
      noFlea: quote?.noFlea === true || (Array.isArray(row.types) && row.types.includes('noFlea')), buyFor, sellFor,
    }
  }
  const barters: Barter[] = tarkovRecords(bundle.barters, 'barters').flatMap((row, index) => {
    const reward = object(row.offeredItem)
    const rewardId = text(reward.item)
    const traderId = text(row.trader)
    if (!rewardId || !traderId) return []
    const trader = traders[traderId] ?? {}
    return [{ id: text(row.id, `barter-${index}`), traderId, traderName: text(trader.name, localized(names, traderId, 'Name', traderId)), traderNormalizedName: text(trader.normalizedName) || undefined, level: number(row.minTraderLevel) ?? 1, taskUnlock: taskRef(row.taskUnlock, names), buyLimit: positive(row.buyLimit), requiredItems: counts(row.requiredItems), rewardItems: [{ itemId: rewardId, count: number(reward.count) ?? 1 }] }]
  })
  const crafts: Craft[] = tarkovRecords(bundle.crafts, 'crafts').flatMap((row, index) => {
    const product = object(row.productItem)
    const productId = text(product.item)
    if (!productId) return []
    const stationId = text(row.station)
    return [{ id: text(row.id, `craft-${index}`), stationId, stationName: localized(names, stationId, 'Name', stationId || 'Hideout'), level: number(row.level) ?? 1, duration: number(row.duration) ?? 0, taskUnlock: taskRef(row.taskUnlock, names), requiredItems: counts(row.requiredItems), rewardItems: [{ itemId: productId, count: number(product.count) ?? 1 }] }]
  })
  const flea = minute.fleaMarket ?? object(itemRoot.fleaMarket)
  return { mode, items, barters, crafts, flea: { enabled: flea.enabled !== false, offerFeeRate: number(flea.sellOfferFeeRate) ?? 0.05, requirementFeeRate: number(flea.sellRequirementFeeRate) ?? 0.05 }, loadedAt, source: 'live' }
}

export function buildLegacyTraders(bundle: TarkovJsonBundle) {
  return tarkovRecords(bundle.traders, 'traders').map((row) => ({ id: text(row.id), name: text(row.name), normalizedName: text(row.normalizedName), resetTime: row.resetTime, imageLink: row.imageLink }))
}

export function buildLegacyBarters(bundle: TarkovJsonBundle, mode: RaidMode = 'pvp', locale: AppLocale = 'ru') {
  const snapshot = buildEconomySnapshot(bundle, mode, locale)
  return snapshot.barters.map((row) => ({ ...row, trader: { id: row.traderId, name: row.traderName, normalizedName: row.traderNormalizedName }, requiredItems: row.requiredItems.map((entry) => ({ item: { id: entry.itemId }, count: entry.count })), rewardItems: row.rewardItems.map((entry) => ({ item: { id: entry.itemId }, count: entry.count })) }))
}

export function buildLegacyCrafts(bundle: TarkovJsonBundle, mode: RaidMode = 'pvp', locale: AppLocale = 'ru') {
  const snapshot = buildEconomySnapshot(bundle, mode, locale)
  return snapshot.crafts.map((row) => ({ ...row, station: { id: row.stationId, name: row.stationName, normalizedName: row.stationNormalizedName }, requiredItems: row.requiredItems.map((entry) => ({ item: { id: entry.itemId }, count: entry.count })), rewardItems: row.rewardItems.map((entry) => ({ item: { id: entry.itemId }, count: entry.count })) }))
}

export function buildLegacyBosses(bundle: TarkovJsonBundle): Json[] {
  const root = object(unwrapTarkovData(bundle.maps))
  const mobs = dictionary(root.mobs)
  const imageBase = bundle.imageBaseUrl ?? 'https://raidos.app/v1/item-images'
  const bossIds = new Set<string>()
  for (const map of Object.values(dictionary(root.maps))) for (const boss of array(map.bosses)) {
    const id = text(boss.mob)
    if (id) bossIds.add(id)
  }
  return [...bossIds].map((id) => mobs[id]).filter(Boolean).map((mob) => ({
    ...mob,
    imagePortraitLink: undefined,
    normalizedName: text(mob.normalizedName, text(mob.id)),
    health: mob.health ?? { max: 0 },
    equipment: array(mob.equipment).map((entry) => {
      const item = object(entry.item)
      const itemId = text(item.id)
      const properties = object(item.properties)
      const preset = object(properties.defaultPreset)
      const presetId = text(preset.id)
      return {
        ...entry,
        item: {
          ...item,
          iconLink: itemId ? localImage(imageBase, itemId, 'icon') : undefined,
          properties: {
            ...properties,
            defaultPreset: Object.keys(preset).length ? {
              ...preset,
              iconLink: presetId ? localImage(imageBase, presetId, 'icon') : undefined,
            } : properties.defaultPreset,
          },
        },
      }
    }),
  }))
}

export function normalizePriceHistory(value: unknown): PricePoint[] {
  const root = object(unwrapTarkovData(value))
  const rows = Array.isArray(root.prices) ? array(root.prices) : Array.isArray(root.historicalItemPrices) ? array(root.historicalItemPrices) : Array.isArray(unwrapTarkovData(value)) ? array(unwrapTarkovData(value)) : []
  return rows.map((row) => ({ timestamp: number(row.timestamp) ?? Date.parse(text(row.timestamp)), price: number(row.price) ?? 0, priceMin: positive(row.priceMin) })).filter((row) => Number.isFinite(row.timestamp) && row.price > 0).sort((a, b) => a.timestamp - b.timestamp)
}
