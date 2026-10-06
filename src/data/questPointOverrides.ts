import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerApp } from '../app/buildEdition'
import type { MapMarker, Quest } from '../domain/types'

/**
 * Quest map points the owner corrected by hand (server/src/routes/questPoints.ts), e.g. after a bug report. Every
 * player's map applies them on top of the catalog / story points (DataProvider → `data.markers`, so the map, the quest
 * window and the minimap overlay all get them):
 * - `move`: the point with that marker id is drawn at x / z (on `floor`, absent = main level);
 * - `hide`: the point is not drawn;
 * - `add`: an extra point of the quest (of `objectiveId` / story `stageIndex` when given).
 * The same in every game mode: quest and zone ids do not depend on the mode.
 * Positions are game metres: the marker sits at [z, x], like every catalog marker (src/data/mapProjection.ts).
 */
export type QuestPointKind = 'move' | 'add' | 'hide'

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
  /** Owner app only (the public list has no note / author). */
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
    const row = entry as Partial<QuestPointOverride>
    if (typeof row.id !== 'string' || typeof row.questId !== 'string' || typeof row.mapId !== 'string') return []
    if (row.kind !== 'move' && row.kind !== 'add' && row.kind !== 'hide') return []
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
      kind: row.kind,
      ...(typeof row.note === 'string' && row.note ? { note: row.note } : {}),
      ...(typeof row.updatedBy === 'string' ? { updatedBy: row.updatedBy } : {}),
      ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
    }]
  })
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

/** The catalog markers with the owner's quest point corrections applied. */
export function withQuestPointOverrides(markers: MapMarker[], overrides: QuestPointOverride[], quests: Quest[] = []): MapMarker[] {
  if (!overrides.length) return markers
  const byMarker = new Map(overrides.filter((entry) => entry.kind !== 'add' && entry.markerId).map((entry) => [entry.markerId!, entry]))
  const kept: MapMarker[] = []
  for (const marker of markers) {
    const override = marker.questId ? byMarker.get(marker.id) : undefined
    if (!override) { kept.push(marker); continue }
    if (override.kind === 'hide') continue
    kept.push(movedMarker(marker, override))
  }
  const added = overrides.filter((entry) => entry.kind === 'add')
  if (!added.length) return kept
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const byQuest = new Map<string, MapMarker[]>()
  for (const marker of markers) if (marker.questId) byQuest.set(marker.questId, [...(byQuest.get(marker.questId) ?? []), marker])
  return [...kept, ...added.map((entry) => addedPointMarker(entry, byQuest.get(entry.questId) ?? [], questsById.get(entry.questId)))]
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
  const save = useCallback(async (input: QuestPointInput) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parseQuestPointOverrides(await request('PUT', '/v1/accounts/me/admin/quest-points', input)))
  }, [store])
  const reset = useCallback(async (id: string) => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    store(parseQuestPointOverrides(await request('POST', `/v1/accounts/me/admin/quest-points/${id}/remove`)))
  }, [store])
  return { save, reset }
}
