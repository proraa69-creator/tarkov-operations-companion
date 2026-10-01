import type { AppDataset, GameMap, HideoutStation, Item, Quest, RaidMode, Trader } from '../domain/types'
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
}

export async function fetchLiveCatalog(mode: RaidMode, locale: AppLocale = 'ru'): Promise<AppDataset> {
  const upstreamMode = mode === 'pve' ? 'pve' : mode === 'seasonal' ? 'pvp-season' : 'regular'
  const [tasks, items, maps, traders, hideout, mapConfigs, wiki] = await Promise.all([
    fetchTranslated(upstreamMode, 'tasks', locale),
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

async function fetchTranslated(mode: string, endpoint: string, locale: AppLocale): Promise<JsonRecord> {
  const path = `${mode}/${endpoint}`
  const [base, translations] = await Promise.all([
    fetchEnvelope(`${BASE_URL}/${path}`),
    fetchEnvelope(`${BASE_URL}/${path}_${locale}`),
  ])
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
    return value
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
  return text(presetEntry.image512pxLink) || text(inline.image512pxLink) || text(presetEntry.gridImageLink) || text(inline.gridImageLink)
    || text(presetEntry.iconLink) || text(inline.iconLink) || `https://assets.tarkov.dev/${presetId}-512.webp`
}

function adaptItems(root: JsonRecord, traders: Map<string, Trader>, mode: RaidMode): Item[] {
  const rawItems = asRecord(root.items)
  return recordValues(rawItems).map((entry) => {
    const types = strings(entry.types)
    const properties = asRecord(entry.properties)
    const prices = asArray(entry.sellToTrader).map((quote) => ({
      source: traders.get(text(quote.trader))?.name ?? 'Торговец',
      price: number(quote.priceRUB ?? quote.price),
      mode,
      updatedAt: text(entry.updated, new Date().toISOString()),
    })).filter((quote) => quote.price > 0)
    const fleaPrice = number(entry.avg24hPrice)
    if (fleaPrice > 0) prices.unshift({ source: 'Барахолка', price: fleaPrice, mode, updatedAt: text(entry.updated, new Date().toISOString()) })
    if (!prices.length) prices.push({ source: 'Базовая цена', price: number(entry.basePrice), mode, updatedAt: text(entry.updated, new Date().toISOString()) })

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
      fleaPrice: fleaPrice || undefined,
      wikiLink: text(entry.wikiLink) || undefined,
      types,
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
      ...(Array.isArray(objective.requiredKeys) ? objective.requiredKeys.flat(Infinity).filter((id): id is string => typeof id === 'string') : []),
    ]).filter(Boolean)
    const keyGroups = asArray(entry.neededKeys)
    const requiredKeys = keyGroups.flatMap((group) => strings(group.keys))
    const raidRequirements: NonNullable<Quest['raidRequirements']> = objectives.flatMap((objective) => {
      const type = text(objective.type).toLowerCase()
      const purpose: NonNullable<Quest['raidRequirements']>[number]['purpose'] = type.includes('mark') ? 'mark' : type.includes('plant') || type.includes('place') ? 'place' : type.includes('give') ? 'handover' : type.includes('find') ? 'find' : 'bring'
      const itemIds = [...new Set([...strings(objective.items), text(objective.item), text(objective.markerItem)].filter(Boolean))]
      return itemIds.map((itemId) => ({ itemId, count: number(objective.count) || 1, purpose, mapIds: strings(objective.maps).map((id) => maps.get(id)).filter((id): id is string => Boolean(id)) }))
    })
    for (const group of keyGroups) for (const itemId of strings(group.keys)) raidRequirements.push({ itemId, count: 1, purpose: 'key', mapIds: maps.get(text(group.map)) ? [maps.get(text(group.map))!] : [] })
    const rewardItems = asArray(asRecord(entry.finishRewards).items)
    const rewards = [
      number(entry.experience) ? `${number(entry.experience).toLocaleString('ru-RU')} опыта` : '',
      ...rewardItems.slice(0, 5).map((reward) => {
        const item = items.get(text(reward.item))
        return `${item?.name ?? text(reward.item)} × ${number(reward.count) || 1}`
      }),
    ].filter(Boolean)
    const objectiveMapIds = objectives.flatMap((objective) => {
      const listed = strings(objective.maps)
      return listed.length ? listed : asArray(objective.zones).map((zone) => text(zone.map)).filter(Boolean)
    })
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
      const requirements = asArray(level.itemRequirements).map((requirement) => {
        const item = items.get(text(requirement.item))
        const fir = asRecord(requirement.attributes).foundInRaid === true ? ' (найти в рейде)' : ''
        return `${item?.name ?? text(requirement.item)} × ${number(requirement.count) || 1}${fir}`
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
