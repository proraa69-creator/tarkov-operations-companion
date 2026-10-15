import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import type { AppDataset, MapMarker, MarkerHint, Quest, QuestPointHint } from '../domain/types'

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
 */
export type QuestPointKind = 'move' | 'add' | 'hide' | 'describe'
const KINDS: readonly QuestPointKind[] = ['move', 'add', 'hide', 'describe']
export const QUEST_POINT_TITLE_MAX = 80
export const QUEST_POINT_DESCRIPTION_MAX = 500

export interface QuestPointOverride {
  id: string
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
    if (typeof row.id !== 'string' || typeof row.questId !== 'string' || typeof row.mapId !== 'string') return []
    if (!KINDS.includes(row.kind as QuestPointKind)) return []
    if (row.kind !== 'add' && typeof row.markerId !== 'string') return []
    if (!Number.isFinite(row.x) || !Number.isFinite(row.z)) return []
    return [{
      id: row.id,
      questId: row.questId,
      ...(typeof row.markerId === 'string' && row.markerId ? { markerId: row.markerId } : {}),
      ...(typeof row.objectiveId === 'string' && row.objectiveId ? { objectiveId: row.objectiveId } : {}),
      ...(Number.isInteger(row.stageIndex) ? { stageIndex: Number(row.stageIndex) } : {}),
      mapId: row.mapId,
      x: Number(row.x),
      z: Number(row.z),
      ...(typeof row.floor === 'string' && row.floor ? { floor: row.floor } : {}),
      kind: row.kind as QuestPointKind,
      ...textOf(row, 'title'), ...textOf(row, 'titleEn'), ...textOf(row, 'description'), ...textOf(row, 'descriptionEn'),
      ...(typeof row.note === 'string' && row.note ? { note: row.note } : {}),
      ...(typeof row.updatedBy === 'string' ? { updatedBy: row.updatedBy } : {}),
      ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    }]
  })
}

const textOf = (row: Partial<QuestPointOverride>, key: 'title' | 'titleEn' | 'description' | 'descriptionEn') => {
  const value = row[key]
  return typeof value === 'string' && value.trim() ? { [key]: value } : {}
}

/** The single override in a write's answer (`{ override, overrides }`), if any. */
export function parseSavedQuestPoint(answer: unknown): QuestPointOverride | undefined {
  const override = (answer as { override?: unknown } | null)?.override
  return override && typeof override === 'object' ? parseQuestPointOverrides({ overrides: [override] })[0] : undefined
}

/** Whether a correction carries a description for players. */
export const hasPointText = (entry: Pick<QuestPointOverride, 'title' | 'titleEn' | 'description' | 'descriptionEn'> | undefined) =>
  Boolean(entry && (entry.title || entry.titleEn || entry.description || entry.descriptionEn))

/** The description for players in the app's language (English falls back to the Russian text). */
export function pointHintOf(entry: QuestPointOverride, lang: 'ru' | 'en' = 'ru'): MarkerHint | undefined {
  const title = (lang === 'en' ? entry.titleEn || entry.title : entry.title || entry.titleEn)?.trim()
  const text = (lang === 'en' ? entry.descriptionEn || entry.description : entry.description || entry.descriptionEn)?.trim()
  return title || text ? { ...(title ? { title } : {}), ...(text ? { text } : {}) } : undefined
}

const withHint = (marker: MapMarker, entry: QuestPointOverride, lang: 'ru' | 'en'): MapMarker => {
  const hint = pointHintOf(entry, lang)
  return hint ? { ...marker, hint } : marker
}

/** The added point's override id behind a marker drawn from it, if any. */
export const addedOverrideIdOf = (marker: MapMarker) => (marker.source === OWNER_QUEST_POINT_SOURCE ? marker.id.slice(ADDED_PREFIX.length) : undefined)

/** Marker of a point the owner added. Text and icon come from the quest's other points (same objective / stage first). */
export function addedPointMarker(override: QuestPointOverride, siblings: MapMarker[], quest?: Pick<Quest, 'name' | 'trader' | 'level' | 'objectives' | 'description' | 'stages'>): MapMarker {
  const sameGoal = siblings.find((marker) => (override.objectiveId && marker.objectiveId === override.objectiveId) || (override.stageIndex != null && marker.stageIndex === override.stageIndex))
  const template = sameGoal ?? siblings.find((marker) => marker.mapId === override.mapId) ?? siblings[0]
  const stage = override.stageIndex != null ? quest?.stages?.[override.stageIndex] : undefined
  return {
    id: `${ADDED_PREFIX}${override.id}`,
    mapId: override.mapId,
    type: 'quest',
    layerId: template?.layerId === 'quest.item' ? 'quest.item' : 'quest.zone',
    title: quest?.name ?? template?.title ?? '',
    description: sameGoal?.description ?? stage?.description ?? stage?.title ?? quest?.objectives[0] ?? quest?.description ?? template?.description ?? '',
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

/** The catalog markers with the owner's quest point corrections applied (descriptions in `lang`). */
export function withQuestPointOverrides(markers: MapMarker[], overrides: QuestPointOverride[], quests: Quest[] = [], lang: 'ru' | 'en' = 'ru'): MapMarker[] {
  if (!overrides.length) return markers
  const byMarker = new Map(overrides.filter((entry) => entry.kind !== 'add' && entry.markerId).map((entry) => [entry.markerId!, entry]))
  const kept: MapMarker[] = []
  for (const marker of markers) {
    const override = marker.questId ? byMarker.get(marker.id) : undefined
    if (!override) { kept.push(marker); continue }
    if (override.kind === 'hide') continue
    kept.push(withHint(override.kind === 'describe' ? marker : movedMarker(marker, override), override, lang))
  }
  const added = overrides.filter((entry) => entry.kind === 'add')
  if (!added.length) return kept
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const byQuest = new Map<string, MapMarker[]>()
  for (const marker of markers) if (marker.questId) byQuest.set(marker.questId, [...(byQuest.get(marker.questId) ?? []), marker])
  return [...kept, ...added.map((entry) => withHint(addedPointMarker(entry, byQuest.get(entry.questId) ?? [], questsById.get(entry.questId)), entry, lang))]
}

/**
 * The quests with the descriptions of their points (`pointHints`), for the quest card under the map and the quest page:
 * «Где искать: …» under the objective / stage the point belongs to. The same dataset object when no point has one.
 */
export function withQuestPointHints(dataset: AppDataset): AppDataset {
  const byQuest = new Map<string, QuestPointHint[]>()
  for (const marker of dataset.markers) {
    if (!marker.questId || !marker.hint || (!marker.hint.text && !marker.hint.title)) continue
    const hint: QuestPointHint = {
      markerId: marker.id, mapId: marker.mapId, text: marker.hint.text ?? '',
      ...(marker.hint.title ? { title: marker.hint.title } : {}),
      ...(marker.objectiveId ? { objectiveId: marker.objectiveId } : {}),
      ...(marker.stageIndex != null ? { stageIndex: marker.stageIndex } : {}),
    }
    byQuest.set(marker.questId, [...(byQuest.get(marker.questId) ?? []), hint])
  }
  if (!byQuest.size) return dataset
  return { ...dataset, quests: dataset.quests.map((quest) => (byQuest.has(quest.id) ? { ...quest, pointHints: byQuest.get(quest.id) } : quest)) }
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
    const answer = await request('PUT', '/v1/accounts/me/admin/quest-points', input)
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
