import { get, set } from 'idb-keyval'
import type { AppDataset, GameMap, HideoutStation, Item, Quest, RaidMode, Trader } from '../domain/types'
import { maps as curatedMaps } from './demo'
import { fetchMapRenderingConfigs } from './mapConfigClient'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'

const BASE_URL = 'https://json.tarkov.dev'
const CACHE_PREFIX = 'tarkov-operations-catalog-v3'
const REQUEST_TIMEOUT = 45_000

type JsonRecord = Record<string, unknown>

interface Envelope {
  data: unknown
}

export async function fetchTarkovCatalog(mode: RaidMode): Promise<AppDataset> {
  const cacheKey = `${CACHE_PREFIX}-${mode}-ru`
  try {
    const dataset = await fetchLiveCatalog(mode)
    await set(cacheKey, dataset)
    return dataset
  } catch (error) {
    const cached = await get<AppDataset>(cacheKey)
    if (cached) {
      return {
        ...cached,
        metadata: { ...cached.metadata!, source: 'cache', loadedAt: cached.metadata?.loadedAt ?? new Date().toISOString() },
      }
    }
    throw error
  }
}

async function fetchLiveCatalog(mode: RaidMode): Promise<AppDataset> {
  const upstreamMode = mode === 'pve' ? 'pve' : 'regular'
  const [tasks, items, maps, traders, hideout, mapConfigs] = await Promise.all([
    fetchTranslated(upstreamMode, 'tasks'),
    fetchTranslated(upstreamMode, 'items'),
    fetchTranslated(upstreamMode, 'maps'),
    fetchTranslated(upstreamMode, 'traders'),
    fetchTranslated(upstreamMode, 'hideout'),
    fetchMapRenderingConfigs().catch(() => new Map<string, Partial<GameMap>>()),
  ])

  const traderRows = adaptTraders(traders)
  const traderById = new Map(traderRows.map((trader) => [trader.id, trader]))
  const itemRows = adaptItems(items, traderById, mode)
  const itemById = new Map(itemRows.map((item) => [item.id, item]))
  const mapRows = adaptMaps(maps, mapConfigs)
  const mapNameById = buildMapNameIndex(maps)
  const questRows = adaptTasks(tasks, traderById, itemById, mapNameById)
  const hideoutRows = adaptHideout(hideout, itemById)
  const markers = adaptLiveMapMarkers(maps, tasks, { maps: mapRows, mapNameByApiId: mapNameById, quests: questRows, items: itemById })

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

async function fetchTranslated(mode: string, endpoint: string): Promise<JsonRecord> {
  const path = `${mode}/${endpoint}`
  const [base, translations] = await Promise.all([
    fetchEnvelope(`${BASE_URL}/${path}`),
    fetchEnvelope(`${BASE_URL}/${path}_ru`),
  ])
  const dictionary = asRecord(translations.data)
  return asRecord(translateDeep(base.data, dictionary))
}

async function fetchEnvelope(url: string): Promise<Envelope> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    const value = await response.json() as Envelope
    if (!value || typeof value !== 'object' || !('data' in value)) throw new Error(`${url}: invalid envelope`)
    return value
  } finally {
    window.clearTimeout(timeout)
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
  })).filter((trader) => trader.id)
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
      taskId: text(requirement.task),
      allowedStatuses: strings(requirement.status).map((status) => status === 'completed' ? 'complete' : status) as Array<'complete' | 'failed' | 'active'>,
    })).filter((requirement) => requirement.taskId)
    const objectiveItems = objectives.flatMap((objective) => [
      ...strings(objective.items),
      text(objective.item),
      text(objective.markerItem),
      ...asArray(objective.requiredKeys).flatMap((group) => strings(group)),
    ]).filter(Boolean)
    const rewardItems = asArray(asRecord(entry.finishRewards).items)
    const rewards = [
      number(entry.experience) ? `${number(entry.experience).toLocaleString('ru-RU')} опыта` : '',
      ...rewardItems.slice(0, 5).map((reward) => {
        const item = items.get(text(reward.item))
        return `${item?.name ?? text(reward.item)} × ${number(reward.count) || 1}`
      }),
    ].filter(Boolean)
    const objectiveMapIds = objectives.flatMap((objective) => strings(objective.maps))
    const rawMapId = text(entry.map) || objectiveMapIds[0]
    return {
      id: text(entry.id),
      normalizedName: text(entry.normalizedName),
      name: text(entry.name, 'Неизвестное задание'),
      trader: traders.get(text(entry.trader))?.name ?? 'Неизвестный торговец',
      mapId: maps.get(rawMapId),
      level: Math.max(1, number(entry.minPlayerLevel)),
      kappa: Boolean(entry.kappaRequired),
      description: `Задание от торговца ${traders.get(text(entry.trader))?.name ?? 'неизвестно'}.`,
      objectives: objectives.map((objective) => text(objective.description)).filter(Boolean),
      objectiveIds: objectives.map((objective) => text(objective.id)).filter(Boolean),
      rewards,
      requiredItems: [...new Set(objectiveItems)],
      previous: requirements.map((requirement) => requirement.taskId),
      requirements,
      faction: text(entry.factionName),
      experience: number(entry.experience),
      wikiLink: text(entry.wikiLink) || undefined,
      imageUrl: text(entry.taskImageLink) || undefined,
    } satisfies Quest
  }).filter((quest) => quest.id)
}

function adaptMaps(root: JsonRecord, mapConfigs: Map<string, Partial<GameMap>>): GameMap[] {
  const rawMaps = asRecord(root.maps)
  const live = recordValues(rawMaps)
  const byName = new Map(live.map((entry) => [text(entry.normalizedName), entry]))
  const merged = curatedMaps.map((map) => {
    const row = byName.get(map.id)
    const config = mapConfigs.get(map.id) ?? {}
    if (!row) return map
    return {
      ...map,
      ...config,
      name: text(row.name, map.name),
      subtitle: text(row.description, map.subtitle),
      raidTime: number(row.raidDuration) || map.raidTime,
      players: text(row.players, map.players),
      markerCount: asArray(row.extracts).length + asArray(row.transits).length + asArray(row.spawns).length + asArray(row.bosses).length + asArray(row.lootContainers).length + asArray(row.lootLoose).length,
    }
  })
  const known = new Set(merged.map((map) => map.id))
  for (const [index, row] of live.entries()) {
    const id = text(row.normalizedName)
    if (!id || known.has(id)) continue
    const config = mapConfigs.get(id) ?? {}
    merged.push({
      id,
      name: text(row.name, id),
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

function adaptHideout(root: JsonRecord, items: Map<string, Item>): HideoutStation[] {
  return recordValues(root).map((entry) => {
    const levels = asArray(entry.levels)
    const next = levels[0] ?? {}
    const requirements = asArray(next.itemRequirements).slice(0, 6).map((requirement) => {
      const item = items.get(text(requirement.item))
      return `${item?.name ?? text(requirement.item)} × ${number(requirement.count) || 1}`
    })
    const bonuses = asArray(next.bonuses).map((bonus) => text(bonus.name)).filter(Boolean)
    return {
      id: text(entry.id),
      name: text(entry.name, text(entry.normalizedName, 'Станция')),
      level: 0,
      maxLevel: levels.length,
      status: 'locked',
      requirements,
      bonus: bonuses.slice(0, 2).join(' · ') || 'Бонусы открываются после постройки',
      imageUrl: text(entry.imageLink) || undefined,
    } satisfies HideoutStation
  }).filter((station) => station.id)
}

function buildMapNameIndex(root: JsonRecord) {
  return new Map(recordValues(asRecord(root.maps)).map((entry) => [text(entry.id), text(entry.normalizedName)]))
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
