import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import type { AppDataset, MapMarker, MarkerHint, MarkerType, Quest, QuestPointHint } from '../domain/types'
import { isQuestIcon, isQuestPointIcon, QUEST_POINT_ITEM_ID, QUEST_POINT_ITEMS_MAX, QUEST_POINT_PHOTO_ID, QUEST_POINT_PHOTO_LIMITS, type QuestPointIcon } from '../shared/questPointConstructor'

/**
 * Quest map points the owner corrected by hand (server/src/routes/questPoints.ts), e.g. after a bug report. Every
 * player's map applies them on top of the catalog / story points (DataProvider → `data.markers`, so the map, the quest
 * window and the minimap overlay all get them):
 * - `move`: the point with that marker id is drawn at x / z (on `floor`, absent = main level);
 * - `hide`: the point is not drawn;
 * - `add`: an extra point of the quest (of `objectiveId` / story `stageIndex` when given);
 * - `describe`: the point stays where it is and only gets a description.
 * Every point may carry a description for players «где и что искать» (owner, 15.10.2026: `title` / `description`, RU and
 * optionally EN): the map tooltip, the quest card and the quest page show it. The `note` is the owner's own remark.
 * The same in every game mode: quest and zone ids do not depend on the mode.
 * Positions are game metres: the marker sits at [z, x], like every catalog marker (src/data/mapProjection.ts).
 *
 * The point constructor (owner, 16.10.2026: «ставлю точку … можно выбрать любую эмблему … добавить предмет из каталога
 * или фотографию»): a point may carry an emblem (`icon`, one of the map's layers), catalog items to look for (`itemIds`)
 * and photos (`photoIds`, src/data/questPointPhotos.ts). An added point of no quest (`questId` '', a «free» point: an
 * extract, a transit, loot…) is drawn with its emblem in that layer. A point's `objectiveId` / `stageIndex` is where it
 * belongs; for an original point the owner may change it too.
 */
export type QuestPointKind = 'move' | 'add' | 'hide' | 'describe'
const KINDS: readonly QuestPointKind[] = ['move', 'add', 'hide', 'describe']
export const QUEST_POINT_TITLE_MAX = 80
export const QUEST_POINT_DESCRIPTION_MAX = 500

export interface QuestPointOverride {
  id: string
  /** '' on a free point (an added point of no quest; the server leaves the field out). */
  questId: string
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  mapId: string
  x: number
  z: number
  floor?: string
  kind: QuestPointKind
  /** For every player: a short title and «где и что искать» (RU; EN optional). */
  title?: string
  titleEn?: string
  description?: string
  descriptionEn?: string
  /** The emblem it is drawn with (absent: the quest's own). */
  icon?: QuestPointIcon
  /** Catalog items to look for here, and photos of the place. */
  itemIds?: string[]
  photoIds?: string[]
  /** Owner app only (the public list has no note / author): the owner's own remark, never shown to players. */
  note?: string
  updatedBy?: string
  updatedAt?: string
}

export type QuestPointInput = Omit<QuestPointOverride, 'id' | 'updatedBy' | 'updatedAt'> & { id?: string }

export const OWNER_QUEST_POINT_SOURCE = 'owner-quest-point'
const ADDED_PREFIX = 'owner-quest-'
export const OVERRIDES_KEY = ['quest-point-overrides'] as const
/** One shared empty list, so the dataset keeps its identity while nothing is corrected. */
const NONE: QuestPointOverride[] = []

export function parseQuestPointOverrides(answer: unknown): QuestPointOverride[] {
  const list = (answer as { overrides?: unknown } | null)?.overrides
  if (!Array.isArray(list)) return []
  return list.flatMap((entry): QuestPointOverride[] => {
    const row = (entry ?? {}) as Partial<QuestPointOverride>
    if (typeof row.id !== 'string' || typeof row.mapId !== 'string') return []
    if (!KINDS.includes(row.kind as QuestPointKind)) return []
    const icon = isQuestPointIcon(row.icon) ? row.icon : undefined
    // A free point: added, with an emblem that is not a quest's.
    const questId = typeof row.questId === 'string' && row.questId ? row.questId : ''
    if (!questId && (row.kind !== 'add' || !icon || isQuestIcon(icon))) return []
    if (row.kind !== 'add' && typeof row.markerId !== 'string') return []
    if (!Number.isFinite(row.x) || !Number.isFinite(row.z)) return []
    const itemIds = idsOf(row.itemIds, QUEST_POINT_ITEM_ID, QUEST_POINT_ITEMS_MAX)
    const photoIds = idsOf(row.photoIds, QUEST_POINT_PHOTO_ID, QUEST_POINT_PHOTO_LIMITS.perPoint)
    return [{
      id: row.id,
      questId,
      ...(typeof row.markerId === 'string' && row.markerId ? { markerId: row.markerId } : {}),
      ...(typeof row.objectiveId === 'string' && row.objectiveId ? { objectiveId: row.objectiveId } : {}),
      ...(Number.isInteger(row.stageIndex) ? { stageIndex: Number(row.stageIndex) } : {}),
      mapId: row.mapId,
      x: Number(row.x),
      z: Number(row.z),
      ...(typeof row.floor === 'string' && row.floor ? { floor: row.floor } : {}),
      kind: row.kind as QuestPointKind,
      ...textOf(row, 'title'), ...textOf(row, 'titleEn'), ...textOf(row, 'description'), ...textOf(row, 'descriptionEn'),
      ...(icon ? { icon } : {}),
      ...(itemIds.length ? { itemIds } : {}),
      ...(photoIds.length ? { photoIds } : {}),
      ...(typeof row.note === 'string' && row.note ? { note: row.note } : {}),
      ...(typeof row.updatedBy === 'string' ? { updatedBy: row.updatedBy } : {}),
      ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    }]
  })
}

const idsOf = (value: unknown, pattern: RegExp, max: number) => (Array.isArray(value)
  ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && pattern.test(entry)))].slice(0, max)
  : [])

const textOf = (row: Partial<QuestPointOverride>, key: 'title' | 'titleEn' | 'description' | 'descriptionEn') => {
  const value = row[key]
  return typeof value === 'string' && value.trim() ? { [key]: value } : {}
}

/** The single override in a write's answer (`{ override, overrides }`), if any. */
export function parseSavedQuestPoint(answer: unknown): QuestPointOverride | undefined {
  const override = (answer as { override?: unknown } | null)?.override
  return override && typeof override === 'object' ? parseQuestPointOverrides({ overrides: [override] })[0] : undefined
}

/** Whether a correction carries a description for players (a text, items to look for or photos). */
export const hasPointText = (entry: Pick<QuestPointOverride, 'title' | 'titleEn' | 'description' | 'descriptionEn' | 'itemIds' | 'photoIds'> | undefined) =>
  Boolean(entry && (entry.title || entry.titleEn || entry.description || entry.descriptionEn || entry.itemIds?.length || entry.photoIds?.length))

/** The point's title and description in the app's language (English falls back to the Russian text). */
function pointTexts(entry: QuestPointOverride, lang: 'ru' | 'en') {
  const title = (lang === 'en' ? entry.titleEn || entry.title : entry.title || entry.titleEn)?.trim()
  const text = (lang === 'en' ? entry.descriptionEn || entry.description : entry.description || entry.descriptionEn)?.trim()
  return { title, text }
}

/** The description for players in the app's language, with the point's items (ids) and photos. */
export function pointHintOf(entry: QuestPointOverride, lang: 'ru' | 'en' = 'ru'): MarkerHint | undefined {
  const { title, text } = pointTexts(entry, lang)
  const extra = { ...(entry.itemIds?.length ? { itemIds: entry.itemIds } : {}), ...(entry.photoIds?.length ? { photoIds: entry.photoIds } : {}) }
  return title || text || extra.itemIds || extra.photoIds ? { ...(title ? { title } : {}), ...(text ? { text } : {}), ...extra } : undefined
}

const withHint = (marker: MapMarker, entry: QuestPointOverride, lang: 'ru' | 'en'): MapMarker => {
  const hint = pointHintOf(entry, lang)
  return hint ? { ...marker, hint } : marker
}

/** The added point's override id behind a marker drawn from it, if any. */
export const addedOverrideIdOf = (marker: MapMarker) => (marker.source === OWNER_QUEST_POINT_SOURCE ? marker.id.slice(ADDED_PREFIX.length) : undefined)

/**
 * Marker of a point the owner added. Its text is the objective / story stage it belongs to (the quest's other points of
 * that goal first, else the quest's own objective or stage — never simply the quest's first one: owner, 16.10.2026: «при
 * установке точки, пишется самый первый этап и не меняется»); a point of no goal says nothing but what the owner wrote,
 * unless the quest has a single objective. The emblem is the point's own, else the quest's other points'.
 */
export function addedPointMarker(override: QuestPointOverride, siblings: MapMarker[], quest?: Pick<Quest, 'name' | 'trader' | 'level' | 'objectives' | 'description' | 'stages' | 'objectiveDetails' | 'objectiveIds'>): MapMarker {
  const sameGoal = siblings.find((marker) => (override.objectiveId && marker.objectiveId === override.objectiveId) || (override.stageIndex != null && marker.stageIndex === override.stageIndex))
  const template = sameGoal ?? siblings.find((marker) => marker.mapId === override.mapId) ?? siblings[0]
  const stage = override.stageIndex != null ? quest?.stages?.[override.stageIndex] : undefined
  const objective = override.objectiveId ? quest?.objectiveDetails?.find((entry) => entry.id === override.objectiveId) : undefined
  const objectiveLine = objective ? undefined : objectiveLineOf(override.objectiveId, quest)
  const goalText = override.objectiveId || override.stageIndex != null
    ? sameGoal?.description ?? objective?.description ?? objectiveLine ?? stage?.description ?? stage?.title
    : onlyObjective(quest)
  const icon = override.icon && isQuestIcon(override.icon) ? override.icon : undefined
  return {
    id: `${ADDED_PREFIX}${override.id}`,
    mapId: override.mapId,
    type: 'quest',
    layerId: icon ?? (template?.layerId === 'quest.item' ? 'quest.item' : 'quest.zone'),
    title: quest?.name ?? template?.title ?? '',
    description: goalText ?? '',
    position: [override.z, override.x],
    ...(override.floor ? { floor: override.floor } : {}),
    questId: override.questId,
    ...(override.objectiveId ? { objectiveId: override.objectiveId } : {}),
    ...(override.stageIndex != null ? { stageIndex: override.stageIndex } : {}),
    ...(sameGoal?.itemId ? { itemId: sameGoal.itemId } : {}),
    meta: template?.meta ?? (quest ? `${quest.trader} · ур. ${quest.level}` : undefined),
    source: OWNER_QUEST_POINT_SOURCE,
  }
}

/** The quest's line of an objective by its id (quests with `objectiveIds` but no structured objectives). */
function objectiveLineOf(objectiveId: string | undefined, quest?: Pick<Quest, 'objectives' | 'objectiveIds'>) {
  if (!objectiveId || !quest?.objectiveIds) return undefined
  const index = quest.objectiveIds.indexOf(objectiveId)
  return index >= 0 ? quest.objectives[index] : undefined
}

/** A quest with exactly one objective (or one stage): its text; otherwise nothing. */
function onlyObjective(quest?: Pick<Quest, 'objectives' | 'stages'>) {
  if (quest?.stages?.length) return quest.stages.length === 1 ? quest.stages[0].description || quest.stages[0].title : undefined
  return quest?.objectives.length === 1 ? quest.objectives[0] : undefined
}

/** How a free point's emblem is typed on the map (a boss emblem stays out of «Расставить боссов»). */
const TYPE_OF_ICON: Record<QuestPointIcon, MarkerType> = {
  'quest.zone': 'quest', 'quest.item': 'quest', 'extract.pmc': 'extract', 'extract.scav': 'extract', 'extract.coop': 'extract', transit: 'extract',
  key: 'key', boss: 'landmark', hazard: 'danger', 'loot.valuable': 'cache', 'loot.weapon': 'cache', 'loot.medical': 'cache', 'loot.provision': 'cache',
  'loot.technical': 'cache', 'loot.container': 'cache', 'loot.documents': 'cache', landmark: 'landmark',
}

/** Marker of a free point (no quest): its emblem's layer, the owner's title and description, its items and photos. */
export function freePointMarker(override: QuestPointOverride, lang: 'ru' | 'en' = 'ru'): MapMarker {
  const icon = override.icon ?? 'landmark'
  const { title, text } = pointTexts(override, lang)
  const extra = { ...(override.itemIds?.length ? { itemIds: override.itemIds } : {}), ...(override.photoIds?.length ? { photoIds: override.photoIds } : {}) }
  return {
    id: `${ADDED_PREFIX}${override.id}`,
    mapId: override.mapId,
    type: TYPE_OF_ICON[icon],
    layerId: icon,
    title: title ?? '',
    description: text ?? '',
    position: [override.z, override.x],
    ...(override.floor ? { floor: override.floor } : {}),
    ...(icon.startsWith('extract.') ? { extractFaction: icon === 'extract.scav' ? 'scav' as const : icon === 'extract.coop' ? 'coop' as const : 'pmc' as const } : {}),
    ...(extra.itemIds || extra.photoIds ? { hint: extra } : {}),
    source: OWNER_QUEST_POINT_SOURCE,
  }
}

/** The catalog markers with the owner's quest point corrections applied (descriptions in `lang`). */
export function withQuestPointOverrides(markers: MapMarker[], overrides: QuestPointOverride[], quests: Quest[] = [], lang: 'ru' | 'en' = 'ru'): MapMarker[] {
  if (!overrides.length) return markers
  const byMarker = new Map(overrides.filter((entry) => entry.kind !== 'add' && entry.markerId).map((entry) => [entry.markerId!, entry]))
  const kept: MapMarker[] = []
  for (const marker of markers) {
    const override = marker.questId ? byMarker.get(marker.id) : undefined
    if (!override) { kept.push(marker); continue }
    if (override.kind === 'hide') continue
    kept.push(withHint(withGoal(override.kind === 'describe' ? marker : movedMarker(marker, override), override), override, lang))
  }
  const added = overrides.filter((entry) => entry.kind === 'add')
  if (!added.length) return kept
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const byQuest = new Map<string, MapMarker[]>()
  for (const marker of markers) if (marker.questId) byQuest.set(marker.questId, [...(byQuest.get(marker.questId) ?? []), marker])
  return [...kept, ...added.map((entry) => (entry.questId
    ? withHint(addedPointMarker(entry, byQuest.get(entry.questId) ?? [], questsById.get(entry.questId)), entry, lang)
    : freePointMarker(entry, lang)))]
}

/**
 * An original point the owner moved to another objective / story stage (the constructor's point settings): it counts
 * there. The quest's emblem may switch between a zone and an item.
 */
function withGoal(marker: MapMarker, override: QuestPointOverride): MapMarker {
  const objectiveId = override.objectiveId && override.objectiveId !== marker.objectiveId ? override.objectiveId : undefined
  const stageIndex = override.stageIndex != null && override.stageIndex !== marker.stageIndex ? override.stageIndex : undefined
  const layerId = override.icon && isQuestIcon(override.icon) && override.icon !== marker.layerId ? override.icon : undefined
  if (!objectiveId && stageIndex == null && !layerId) return marker
  return { ...marker, ...(objectiveId ? { objectiveId } : {}), ...(stageIndex != null ? { stageIndex } : {}), ...(layerId ? { layerId } : {}) }
}

/**
 * The quests with the descriptions of their points (`pointHints`), for the quest card under the map and the quest page:
 * «Где искать: …» under the objective / stage the point belongs to. The same dataset object when no point has one.
 */
export function withQuestPointHints(dataset: AppDataset): AppDataset {
  const resolved = withHintItems(dataset)
  const byQuest = new Map<string, QuestPointHint[]>()
  for (const marker of resolved.markers) {
    const found = marker.hint
    if (!marker.questId || !found || (!found.text && !found.title && !found.items?.length && !found.photoIds?.length)) continue
    const hint: QuestPointHint = {
      markerId: marker.id, mapId: marker.mapId, text: found.text ?? '',
      ...(found.title ? { title: found.title } : {}),
      ...(marker.objectiveId ? { objectiveId: marker.objectiveId } : {}),
      ...(marker.stageIndex != null ? { stageIndex: marker.stageIndex } : {}),
      ...(found.items?.length ? { items: found.items } : {}),
      ...(found.photoIds?.length ? { photoIds: found.photoIds } : {}),
    }
    byQuest.set(marker.questId, [...(byQuest.get(marker.questId) ?? []), hint])
  }
  if (!byQuest.size) return resolved
  return { ...resolved, quests: resolved.quests.map((quest) => (byQuest.has(quest.id) ? { ...quest, pointHints: byQuest.get(quest.id) } : quest)) }
}

/** The points' catalog items named and pictured from the catalog (an item the catalog lacks is left out). */
function withHintItems(dataset: AppDataset): AppDataset {
  if (!dataset.markers.some((marker) => marker.hint?.itemIds?.length)) return dataset
  const items = new Map((dataset.items ?? []).map((item) => [item.id, item]))
  return {
    ...dataset,
    markers: dataset.markers.map((marker) => {
      const ids = marker.hint?.itemIds
      if (!ids?.length) return marker
      const found = ids.flatMap((id) => {
        const item = items.get(id)
        return item ? [{ itemId: item.id, name: item.name, ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}) }] : []
      })
      return { ...marker, hint: { ...marker.hint, items: found } }
    }),
  }
}

/** A catalog point at the owner's place: its area outline (if any) moves along with it. */
function movedMarker(marker: MapMarker, override: QuestPointOverride): MapMarker {
  const dz = override.z - marker.position[0]
  const dx = override.x - marker.position[1]
  const rest: MapMarker = { ...marker }
  delete rest.height
  delete rest.heightRange
  delete rest.floor
  return {
    ...rest,
    mapId: override.mapId,
    position: [override.z, override.x],
    ...(marker.outline && override.mapId === marker.mapId ? { outline: marker.outline.map(([z, x]): [number, number] => [z + dz, x + dx]) } : { outline: undefined }),
    ...(override.floor ? { floor: override.floor } : {}),
  }
}

/** The owner's corrections (refreshed every 10 minutes); an empty list without a server. The owner app reads the notes too. */
export function useQuestPointOverrides(enabled = true) {
  const query = useQuery({
    queryKey: OVERRIDES_KEY,
    queryFn: async () => {
      const request = serviceClient()
      if (!request) return NONE
      if (isOwnerApp()) {
        try { return parseQuestPointOverrides(await request('GET', '/v1/accounts/me/admin/quest-points')) } catch { /* not the owner's session: the public list */ }
      }
      return parseQuestPointOverrides(await request('GET', '/v1/quest-points'))
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return query.data ?? NONE
}

/** Owner app only: save / reset a correction. The server refuses everybody but the owner's account. */
export function useQuestPointWriter() {
  const client = useQueryClient()
  const store = useCallback((overrides: QuestPointOverride[]) => client.setQueryData(OVERRIDES_KEY, overrides), [client])
  /** The saved correction (undefined from a server answer without it). */
  const save = useCallback(async (input: QuestPointInput) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    // A free point goes without a quest id (the server takes none).
    const body: Partial<QuestPointInput> = { ...input }
    if (!body.questId) delete body.questId
    const answer = await request('PUT', '/v1/accounts/me/admin/quest-points', body)
    store(parseQuestPointOverrides(answer))
    return parseSavedQuestPoint(answer)
  }, [store])
  const reset = useCallback(async (id: string) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parseQuestPointOverrides(await request('POST', `/v1/accounts/me/admin/quest-points/${id}/remove`)))
  }, [store])
  return { save, reset }
}
