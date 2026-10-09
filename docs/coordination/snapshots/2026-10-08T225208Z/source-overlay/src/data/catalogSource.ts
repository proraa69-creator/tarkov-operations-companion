import type { AppDataset, GameMap, HideoutStation, Item, PriceQuote, Quest, RaidMode, Trader } from '../domain/types'
import { maps as curatedMaps } from './demo'
import { hideoutPosition } from './hideoutLayout'
import { canonicalMapId, MAP_DISPLAY_NAMES } from './mapIds'
import { detectAnyMapQuest } from '../progression/questLocation'
import { fetchMapRenderingConfigs } from './mapConfigClient'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { fetchWikiQuestSync, mergeStoryChapters, mergeWikiQuestCatalog, mergeWikiQuestDetails } from './wikiQuestCatalog'
import { adaptStoryQuestMarkers } from './storyQuestMarkers'
import { addMissingStoryChapters, applyCuratedStoryStages } from './storyChapters'
import type { AppLocale } from '../i18n/LocaleProvider'
import { adaptObjectiveDetails } from './objectiveDetails'

/** Live map ids that should not appear in the companion map picker. */
const BLOCKED_MAP_IDS = new Set([
  'factory-night',
  'night-factory',
  'the-lab-night',
  'laboratory-night',
  'labs-night',
  'dark-lab',
  'the-lab-dark',
  'laboratory-dark',
  'ground-zero-21',
  'ground-zero-tutorial',
])

const BLOCKED_MAP_NAME_RE = /ночн(ой|ая)\s*завод|dark\s*lab|лаборатор(ия)?\s*dark|night\s*factory/i

const BASE_URL = 'https://json.tarkov.dev'
const REQUEST_TIMEOUT = 45_000

type JsonRecord = Record<string, unknown>

interface Envelope {
  data: unknown
  /** Upstream version of the file: Last-Modified / ETag header, or a timestamp field of the envelope. */
  version?: string
}

export async function fetchLiveCatalog(mode: RaidMode, locale: AppLocale = 'ru'): Promise<AppDataset> {
  const upstreamMode = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
  const taskVersion: { version?: string } = {}
  const [tasks, items, maps, traders, hideout, mapConfigs, wiki] = await Promise.all([
    fetchTranslated(upstreamMode, 'tasks', locale, taskVersion),
    fetchTranslated(upstreamMode, 'items', locale),
    fetchTranslated(upstreamMode, 'maps', locale),
    fetchTranslated(upstreamMode, 'traders', locale),
    fetchTranslated(upstreamMode, 'hideout', locale),
    fetchMapRenderingConfigs().catch(() => new Map<string, Partial<GameMap>>()),
    // The quest wiki used for details is Russian; the English catalog keeps tarkov.dev's own English text.
    (locale === 'ru' ? fetchWikiQuestSync() : Promise.reject(new Error('ru only'))).catch(() => ({ titles: [] as string[], pages: [], storyQuests: [] })),
  ])

  const traderRows = adaptTraders(traders)
  const traderById = new Map(traderRows.map((trader) => [trader.id, trader]))
  const itemRows = adaptItems(items, traderById, mode)
  const fleaMarket = adaptFleaMarket(items)
  const itemById = new Map(itemRows.map((item) => [item.id, item]))
  const mapRows = adaptMaps(maps, mapConfigs, locale)
  const mapNameById = buildMapNameIndex(maps)
  // Story chapters come from the Russian wiki; any chapter it does not list (or all of them when it is unreachable,
  // and in the English catalog, which does not load it) is added from the curated chapter data.
  const questRows = applyCuratedStoryStages(addMissingStoryChapters(mergeStoryChapters(
    mergeWikiQuestDetails(mergeWikiQuestCatalog(adaptTasks(tasks, traderById, itemById, mapNameById), wiki.titles), wiki.pages),
    wiki.storyQuests,
  ), locale))
  const hideoutRows = adaptHideout(hideout, itemById, traderById)
  const liveMarkers = adaptLiveMapMarkers(maps, tasks, { maps: mapRows, mapNameByApiId: mapNameById, quests: questRows, items: itemById, mode })
  const markers = [...liveMarkers, ...adaptStoryQuestMarkers(questRows, mapRows, liveMarkers)]

  return {
    maps: mapRows,
    markers,
    quests: questRows,
    items: itemRows,
    hideout: hideoutRows,
    traders: traderRows,
    metadata: {
      source: 'json.tarkov.dev',
      mode,
      loadedAt: new Date().toISOString(),
      sourceUrl: `${BASE_URL}/${upstreamMode}/tasks`,
      ...(fleaMarket ? { fleaMarket } : {}),
      ...(taskVersion.version ? { sourceVersion: taskVersion.version } : {}),
      ...(taskVersion.version && Number.isFinite(Date.parse(taskVersion.version)) ? { sourceUpdatedAt: new Date(taskVersion.version).toISOString() } : {}),
      counts: {
        quests: questRows.length,
        items: itemRows.length,
        maps: mapRows.length,
        traders: traderRows.length,
        hideout: hideoutRows.length,
      },
    },
  }
}

async function fetchTranslated(mode: string, endpoint: string, locale: AppLocale, version?: { version?: string }): Promise<JsonRecord> {
  const path = `${mode}/${endpoint}`
  const [base, translations] = await Promise.all([
    fetchEnvelope(`${BASE_URL}/${path}`),
    fetchEnvelope(`${BASE_URL}/${path}_${locale}`),
  ])
  if (version && base.version) version.version = base.version
  const dictionary = asRecord(translations.data)
  return asRecord(translateDeep(base.data, dictionary))
}

async function fetchEnvelope(url: string): Promise<Envelope> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    const value = await response.json() as Envelope
    if (!value || typeof value !== 'object' || !('data' in value)) throw new Error(`${url}: invalid envelope`)
    const stamp = (value as { updated?: unknown }).updated
    const version = response.headers?.get?.('last-modified') ?? response.headers?.get?.('etag') ?? (typeof stamp === 'string' ? stamp : undefined)
    return version ? { data: value.data, version } : { data: value.data }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

function translateDeep(value: unknown, dictionary: JsonRecord): unknown {
  if (typeof value === 'string') return typeof dictionary[value] === 'string' ? dictionary[value] : value
  if (Array.isArray(value)) return value.map((entry) => translateDeep(entry, dictionary))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, translateDeep(entry, dictionary)]))
}

function adaptTraders(root: JsonRecord): Trader[] {
  return recordValues(root).map((entry, index) => ({
    id: text(entry.id),
    name: text(entry.name, 'Неизвестный торговец'),
    role: text(entry.description, 'Торговец и источник заданий'),
    loyalty: Math.max(1, asArray(entry.levels).length),
    accent: ['#7d8d68', '#789096', '#9a7d64', '#6d8793', '#8e8265', '#877064'][index % 6],
    imageUrl: text(entry.imageLink) || text(entry.avatarLink) || undefined,
  })).filter((trader) => trader.id)
}

/**
 * The whole-gun picture of a weapon: its default preset (tarkov.dev `properties.defaultPreset`, an item id in
 * json.tarkov.dev, an object in GraphQL) — that preset's 512px / grid image, or its tarkov.dev asset by id.
 */
export function presetImageFor(entry: JsonRecord, rawItems: JsonRecord): string | undefined {
  const preset = asRecord(entry.properties).defaultPreset
  const presetId = typeof preset === 'string' ? preset : text(asRecord(preset).id)
  if (!presetId || presetId === text(entry.id)) return undefined
  const presetEntry = asRecord(rawItems[presetId])
  const inline = asRecord(preset)
  const images = [presetEntry.image512pxLink, inline.image512pxLink, presetEntry.gridImageLink, inline.gridImageLink, presetEntry.iconLink, inline.iconLink]
    .map(value => text(value)).filter(value => value && !/\/unknown-item-/i.test(value))
  if (images.length) return images[0]
  // Cosmetic editions whose upstream preset still has only a placeholder. Same model's
  // standard assembly is illustrative: neither its skin nor the player's attachments are inferred.
  const standardModels: Record<string, string> = {
    '6a15ae2ae5267ba21c07f98f': '5bb2475ed4351e00853264e3', // HK 416A5 RAL 8000 -> HK 416A5
    '6a78b7f8c2016eb33e0027cd': '5cc82d76e24e8d00134b4b83', // FN P90 Scourge -> FN P90
  }
  const standard = standardModels[text(entry.id)]
  if (standard && rawItems[standard]) return presetImageFor(asRecord(rawItems[standard]), rawItems)
  return `https://assets.tarkov.dev/${presetId}-512.webp`
}

type FleaMarketInfo = NonNullable<NonNullable<AppDataset['metadata']>['fleaMarket']>

/** tarkov.dev `fleaMarket` of the items file (json.tarkov.dev `<mode>/items`): whether this mode's flea is open, and its fee rates. */
export function adaptFleaMarket(root: JsonRecord): FleaMarketInfo | undefined {
  const flea = asRecord(root.fleaMarket)
  if (!Object.keys(flea).length) return undefined
  const rate = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const offerFeeRate = rate(flea.sellOfferFeeRate)
  const requirementFeeRate = rate(flea.sellRequirementFeeRate)
  return {
    enabled: flea.enabled !== false,
    ...(offerFeeRate !== undefined ? { offerFeeRate } : {}),
    ...(requirementFeeRate !== undefined ? { requirementFeeRate } : {}),
  }
}

/**
 * Roubles a trader pays: `priceRUB`; the bare `price` only when it is in roubles. Peacekeeper pays in dollars: a quote
 * `{ price: 120, currency: 'USD' }` without `priceRUB` used to be read as 120 ₽.
 */
export function traderQuoteRub(quote: JsonRecord): number {
  const rub = number(quote.priceRUB)
  if (rub > 0) return rub
  const currency = text(quote.currency)
  return !currency || currency === 'RUB' ? number(quote.price) : 0
}

/**
 * The flea price shown to the player: the current lowest offer (`lastLowPrice`). Only when there is no current offer,
 * the 24-hour average (`avg24hPrice`), flagged so the pages can say so. The average lags the market and is pulled up by
 * expensive listings, so it sits above the cheapest offer for most items — it is not what the item costs right now.
 * Flea-banned items (`types: noFlea`) and a closed flea (`fleaMarket.enabled: false`) have no flea price.
 */
export function fleaPriceOf(entry: JsonRecord, fleaEnabled = true): { price: number; basis: 'last-low' | 'avg-24h' } | undefined {
  if (!fleaEnabled || strings(entry.types).includes('noFlea')) return undefined
  const lastLow = number(entry.lastLowPrice)
  if (lastLow > 0) return { price: lastLow, basis: 'last-low' }
  const average = number(entry.avg24hPrice)
  return average > 0 ? { price: average, basis: 'avg-24h' } : undefined
}

function adaptItems(root: JsonRecord, traders: Map<string, Trader>, mode: RaidMode): Item[] {
  const rawItems = asRecord(root.items)
  const fleaEnabled = adaptFleaMarket(root)?.enabled !== false
  return recordValues(rawItems).map((entry) => {
    const types = strings(entry.types)
    const properties = asRecord(entry.properties)
    const updatedAt = text(entry.updated, new Date().toISOString())
    // What each trader pays for the item (sell to trader), in roubles.
    const prices: PriceQuote[] = asArray(entry.sellToTrader).map((quote) => ({
      source: traders.get(text(quote.trader))?.name ?? 'Торговец',
      price: traderQuoteRub(quote),
      mode,
      updatedAt,
      kind: 'trader' as const,
    })).filter((quote) => quote.price > 0)
    const flea = fleaPriceOf(entry, fleaEnabled)
    if (flea) prices.unshift({ source: 'Барахолка', price: flea.price, mode, updatedAt, kind: 'flea', basis: flea.basis })
    const basePrice = number(entry.basePrice)
    if (!prices.length && basePrice > 0) prices.push({ source: 'Базовая цена', price: basePrice, mode, updatedAt, kind: 'base' })

    return {
      id: text(entry.id),
      normalizedName: text(entry.normalizedName),
      name: text(entry.name, 'Неизвестный предмет'),
      shortName: text(entry.shortName, text(entry.name, '—')),
      category: mapCategory(types),
      description: text(entry.description, 'Описание отсутствует.'),
      iconUrl: text(entry.iconLink) || undefined,
      presetImageUrl: types.includes('gun') ? presetImageFor(entry, rawItems) : undefined,
      weight: number(entry.weight) || undefined,
      width: number(entry.width) || undefined,
      height: number(entry.height) || undefined,
      slots: number(entry.width) && number(entry.height) ? `${number(entry.width)}×${number(entry.height)}` : undefined,
      prices,
      fleaPrice: flea?.price,
      fleaPriceBasis: flea?.basis,
      basePrice: basePrice || undefined,
      wikiLink: text(entry.wikiLink) || undefined,
      types,
      valuable: isValuableItem(entry) || undefined,
      caliber: text(properties.caliber) || text(properties.ammoType) || undefined,
      damage: number(properties.damage) || undefined,
      penetration: number(properties.penetrationPower) || number(properties.penetration) || undefined,
      armorClass: number(properties.class) || number(properties.armorClass) || undefined,
    } satisfies Item
  }).filter((item) => item.id)
}

function adaptTasks(
  root: JsonRecord,
  traders: Map<string, Trader>,
  items: Map<string, Item>,
  maps: Map<string, string>,
): Quest[] {
  const rawTasks = asRecord(root.tasks)
  return recordValues(rawTasks).map((entry) => {
    const objectives = asArray(entry.objectives)
    const requirements = asArray(entry.taskRequirements).map((requirement) => ({
      taskId: text(requirement.task) || text(asRecord(requirement.task).id) || text(requirement.taskId),
      allowedStatuses: strings(requirement.status).map((status) => status === 'completed' ? 'complete' : status).filter((status): status is 'complete' | 'failed' | 'active' => status === 'complete' || status === 'failed' || status === 'active'),
    })).map((requirement) => ({
      ...requirement,
      allowedStatuses: requirement.allowedStatuses.length ? requirement.allowedStatuses : ['complete' as const],
    })).filter((requirement) => requirement.taskId)
    const objectiveItems = objectives.flatMap((objective) => [
      ...strings(objective.items),
      text(objective.item),
      text(objective.markerItem),
      ...objectiveKeyGroups(objective).flat(),
    ]).filter(Boolean)
    const keyGroups = asArray(entry.neededKeys)
    const requiredKeys = keyGroups.flatMap((group) => strings(group.keys))
    const raidRequirements: NonNullable<Quest['raidRequirements']> = objectives.flatMap((objective) => {
      const type = text(objective.type).toLowerCase()
      const purpose: NonNullable<Quest['raidRequirements']>[number]['purpose'] = type.includes('mark') ? 'mark' : type.includes('plant') || type.includes('place') ? 'place' : type.includes('give') ? 'handover' : type.includes('find') ? 'find' : 'bring'
      const itemIds = [...new Set([...strings(objective.items), text(objective.item), text(objective.markerItem)].filter(Boolean))]
      const objectiveId = text(objective.id) || undefined
      return itemIds.map((itemId) => ({
        itemId,
        count: number(objective.count) || 1,
        purpose,
        mapIds: strings(objective.maps).map((id) => maps.get(id)).filter((id): id is string => Boolean(id)),
        foundInRaid: objective.foundInRaid === true || undefined,
        objectiveId,
        alternatives: itemIds.length,
        optional: objective.optional === true || undefined,
        minDurability: number(objective.minDurability) || undefined,
        maxDurability: number(objective.maxDurability) > 0 && number(objective.maxDurability) < 100 ? number(objective.maxDurability) : undefined,
        dogTagLevel: number(objective.dogTagLevel) || undefined,
      }))
    })
    for (const group of keyGroups) for (const itemId of strings(group.keys)) raidRequirements.push({ itemId, count: 1, purpose: 'key', mapIds: maps.get(text(group.map)) ? [maps.get(text(group.map))!] : [] })
    // Keys of the objectives themselves (tarkov.dev `requiredKeys: [[id, …], …]`: one of each inner list is needed).
    // `neededKeys` is deprecated upstream; a new quest may list its keys only here.
    for (const objective of objectives) {
      const objectiveMaps = objectivePlaceMaps(objective).map((id) => maps.get(id) ?? maps.get(canonicalMapId(id))).filter((id): id is string => Boolean(id))
      for (const group of objectiveKeyGroups(objective)) {
        for (const itemId of group) {
          if (raidRequirements.some((requirement) => requirement.purpose === 'key' && requirement.itemId === itemId)) continue
          raidRequirements.push({ itemId, count: 1, purpose: 'key', mapIds: [...new Set(objectiveMaps)], objectiveId: text(objective.id) || undefined, ...(group.length > 1 ? { alternatives: group.length } : {}) })
        }
      }
    }
    const rewardItems = asArray(asRecord(entry.finishRewards).items)
    const rewards = [
      number(entry.experience) ? `${number(entry.experience).toLocaleString('ru-RU')} опыта` : '',
      ...rewardItems.slice(0, 5).map((reward) => {
        const item = items.get(text(reward.item))
        return `${item?.name ?? text(reward.item)} × ${number(reward.count) || 1}`
      }),
    ].filter(Boolean)
    const objectiveMapIds = objectives.flatMap(objectivePlaceMaps)
    const rawMapId = text(entry.map) || objectiveMapIds[0]
    const mapIds = [...new Set([rawMapId, ...objectiveMapIds].map((id) => maps.get(id)).filter((id): id is string => Boolean(id)))]
    const name = text(entry.name, 'Неизвестное задание')
    const anyMap = detectAnyMapQuest({
      traderId: text(entry.trader),
      name,
      normalizedName: text(entry.normalizedName),
      objectives: objectives.map((objective) => ({ type: text(objective.type), description: text(objective.description) })),
      mapIds,
    })
    return {
      id: text(entry.id),
      normalizedName: text(entry.normalizedName),
      name,
      trader: traders.get(text(entry.trader))?.name ?? 'Неизвестный торговец',
      mapId: maps.get(rawMapId),
      mapIds,
      anyMap,
      level: Math.max(1, number(entry.minPlayerLevel)),
      kappa: Boolean(entry.kappaRequired),
      description: `Задание от торговца ${traders.get(text(entry.trader))?.name ?? 'неизвестно'}.`,
      objectives: objectives.map((objective) => text(objective.description)).filter(Boolean),
      objectiveIds: objectives.map((objective) => text(objective.id)).filter(Boolean),
      objectiveDetails: adaptObjectiveDetails(objectives, (id) => maps.get(id) ?? maps.get(canonicalMapId(id))),
      rewards,
      requiredItems: [...new Set([...objectiveItems, ...requiredKeys])],
      raidRequirements,
      previous: requirements.map((requirement) => requirement.taskId),
      requirements,
      faction: text(entry.factionName),
      experience: number(entry.experience),
      wikiLink: text(entry.wikiLink) || undefined,
      imageUrl: text(entry.taskImageLink) || undefined,
    } satisfies Quest
  }).filter((quest) => quest.id)
}

/** A reference given as `"id"` (json.tarkov.dev) or `{ id }` (GraphQL). */
function refId(value: unknown) {
  return text(value) || text(asRecord(value).id)
}

/**
 * Upstream map ids of one objective: its listed maps, otherwise the maps of its zones and quest-item spots
 * (a new «find the quest item» objective may list only `possibleLocations`).
 */
function objectivePlaceMaps(objective: JsonRecord): string[] {
  const listed = (Array.isArray(objective.maps) ? objective.maps : []).map(refId).filter(Boolean)
  if (listed.length) return listed
  return [...asArray(objective.zones), ...asArray(objective.possibleLocations)].map((place) => refId(place.map)).filter(Boolean)
}

/** `requiredKeys` of an objective as groups of alternatives (ids or `{ id }`); a flat list is one key per group. */
function objectiveKeyGroups(objective: JsonRecord): string[][] {
  if (!Array.isArray(objective.requiredKeys)) return []
  return objective.requiredKeys.map((group) => (Array.isArray(group) ? group : [group]).map(refId).filter(Boolean)).filter((group) => group.length > 0)
}

/**
 * Jewelry / valuables (gold chains, Roler, skulls, horse figurines, bitcoins…), by the item's categories in the data:
 * BSG category «Jewelry» (57864a3d24597754843f8721) or handbook category «Valuables» (5b47574386f77428ca22b2f1).
 * Both ids (json.tarkov.dev `categories` / `handbookCategories` / `bsgCategoryId`) and GraphQL objects are accepted.
 */
export const VALUABLE_CATEGORY_IDS: ReadonlySet<string> = new Set(['57864a3d24597754843f8721', '5b47574386f77428ca22b2f1'])
const VALUABLE_CATEGORY_NAMES = new Set(['jewelry', 'valuables'])

export function isValuableItem(entry: JsonRecord): boolean {
  const categories = [...(Array.isArray(entry.categories) ? entry.categories : []), ...(Array.isArray(entry.handbookCategories) ? entry.handbookCategories : []), entry.bsgCategoryId, entry.category, entry.bsgCategory]
  return categories.some((category) => VALUABLE_CATEGORY_IDS.has(refId(category)) || VALUABLE_CATEGORY_NAMES.has(text(asRecord(category).normalizedName)))
}

function adaptMaps(root: JsonRecord, mapConfigs: Map<string, Partial<GameMap>>, locale: AppLocale): GameMap[] {
  const rawMaps = asRecord(root.maps)
  const live = recordValues(rawMaps)
  const byName = new Map(live.map((entry) => [text(entry.normalizedName), entry]))
  const merged = curatedMaps.map((map) => {
    const row = byName.get(map.id)
    const config = mapConfigs.get(map.id) ?? {}
    if (!row) return { ...map, name: locale === 'ru' ? (MAP_DISPLAY_NAMES[map.id] ?? map.name) : map.id.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
    return {
      ...map,
      ...config,
      name: locale === 'ru' ? (MAP_DISPLAY_NAMES[map.id] ?? text(row.name, map.name)) : text(row.name, map.name),
      subtitle: map.subtitle,
      raidTime: number(row.raidDuration) || map.raidTime,
      players: text(row.players, map.players),
      markerCount: asArray(row.extracts).length + asArray(row.transits).length + asArray(row.spawns).length + asArray(row.bosses).length + asArray(row.lootContainers).length + asArray(row.lootLoose).length,
    }
  })
  const known = new Set(merged.map((map) => map.id))
  for (const [index, row] of live.entries()) {
    const id = canonicalMapId(text(row.normalizedName))
    const name = locale === 'ru' ? (MAP_DISPLAY_NAMES[id] ?? text(row.name, id)) : text(row.name, id)
    if (!id || known.has(id) || BLOCKED_MAP_IDS.has(id) || BLOCKED_MAP_IDS.has(text(row.normalizedName)) || BLOCKED_MAP_NAME_RE.test(name) || BLOCKED_MAP_NAME_RE.test(id)) continue
    const config = mapConfigs.get(id) ?? {}
    merged.push({
      id,
      name,
      subtitle: text(row.description, 'Локация Escape from Tarkov'),
      raidTime: number(row.raidDuration) || 40,
      players: text(row.players, '—'),
      difficulty: 'Высокая',
      ...config,
      accent: ['#7d8d68', '#789096', '#9a7d64'][index % 3],
      markerCount: asArray(row.extracts).length + asArray(row.transits).length + asArray(row.spawns).length + asArray(row.bosses).length + asArray(row.lootContainers).length + asArray(row.lootLoose).length,
      attribution: 'Данные карты © tarkov.dev contributors',
    })
  }
  return merged
}

function adaptHideout(root: JsonRecord, items: Map<string, Item>, traders: Map<string, Trader>): HideoutStation[] {
  const stations = recordValues(root)
  const nameById = new Map(stations.map((entry) => [text(entry.id), text(entry.name, text(entry.normalizedName, 'Станция'))]))
  return stations.map((entry, index) => {
    const levels = asArray(entry.levels)
    const normalizedName = text(entry.normalizedName)
    const normalizedLevels = levels.map((level, levelIndex) => {
      const itemRequirements = asArray(level.itemRequirements).map((requirement) => ({
        itemId: text(requirement.item) || text(asRecord(requirement.item).id),
        count: number(requirement.count) || number(requirement.quantity) || 1,
        foundInRaid: requirementFoundInRaid(requirement.attributes) || undefined,
      })).filter((requirement) => requirement.itemId)
      const requirements = itemRequirements.map((requirement) => {
        const item = items.get(requirement.itemId)
        const fir = requirement.foundInRaid ? ' (найти в рейде)' : ''
        return `${item?.name ?? requirement.itemId} × ${requirement.count}${fir}`
      })
      const stationRequirements = asArray(level.stationLevelRequirements).map((requirement) => {
        const stationName = nameById.get(text(requirement.station)) ?? text(requirement.station)
        return `${stationName} ур. ${number(requirement.level) || 1}`
      })
      const traderRequirements = asArray(level.traderRequirements).map((requirement) => {
        return `Лояльность: ${traders.get(text(requirement.trader))?.name ?? text(requirement.trader, 'торговец')} ур. ${number(requirement.level) || 1}`
      })
      const skillRequirements = asArray(level.skillRequirements).map((requirement) => {
        return `Навык ${text(requirement.name, text(requirement.skill, '—'))} ${number(requirement.level) || 1}`
      })
      const bonuses = asArray(level.bonuses).map((bonus) => `${text(bonus.name)}${bonus.value !== undefined ? `: ${number(bonus.value)}` : ''}`).filter(Boolean)
      const constructionTimeHours = number(level.constructionTime) / 3600
      return {
        level: number(level.level) || levelIndex + 1,
        requirements: [...requirements, ...traderRequirements, ...skillRequirements],
        stationRequirements,
        itemRequirements,
        bonus: [text(level.description), ...bonuses].filter(Boolean).join(' · ') || 'Новые возможности модуля',
        constructionTimeHours,
      }
    })
    const next = normalizedLevels[0]
    return {
      id: text(entry.id),
      name: text(entry.name, normalizedName || 'Станция'),
      normalizedName: normalizedName || undefined,
      level: 0,
      maxLevel: levels.length,
      status: 'locked' as const,
      requirements: [...(next?.requirements ?? []), ...(next?.stationRequirements ?? [])],
      bonus: next?.bonus ?? 'Бонусы открываются после постройки',
      imageUrl: text(entry.imageLink) || undefined,
      layout: hideoutPosition(normalizedName, index),
      levels: normalizedLevels,
    } satisfies HideoutStation
  }).filter((station) => station.id)
}

/**
 * tarkov.dev `RequirementItem.attributes` is `[{ type, name, value }]` (e.g. `{ type: 'foundInRaid', value: 'true' }`);
 * an object form `{ foundInRaid: true }` is accepted too.
 */
export function requirementFoundInRaid(attributes: unknown) {
  if (Array.isArray(attributes)) {
    return attributes.map(asRecord).some((entry) => (text(entry.type) === 'foundInRaid' || text(entry.name) === 'foundInRaid') && String(entry.value).toLowerCase() === 'true')
  }
  return asRecord(attributes).foundInRaid === true
}

function buildMapNameIndex(root: JsonRecord) {
  const index = new Map<string, string>()
  for (const entry of recordValues(asRecord(root.maps))) {
    const canonical = canonicalMapId(text(entry.normalizedName))
    if (!canonical) continue
    index.set(text(entry.id), canonical)
    index.set(text(entry.normalizedName), canonical)
    index.set(canonical, canonical)
  }
  return index
}

function mapCategory(types: string[]): Item['category'] {
  if (types.some((type) => type.includes('key'))) return 'Ключ'
  if (types.includes('ammo')) return 'Боеприпас'
  if (types.some((type) => ['gun', 'weapon', 'preset'].includes(type))) return 'Оружие'
  if (types.some((type) => type.includes('armor') || type === 'rig')) return 'Броня'
  if (types.some((type) => type.includes('med'))) return 'Медицина'
  if (types.some((type) => type === 'food' || type === 'drink')) return 'Еда'
  if (types.some((type) => type.includes('tool'))) return 'Инструмент'
  return 'Бартер'
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function recordValues(value: JsonRecord) {
  return Object.values(value).map(asRecord)
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.parseFloat(String(value)) || 0
}
