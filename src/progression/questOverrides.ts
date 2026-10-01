/**
 * Local override layer over the public quest data (docs/quest-sync-spec.md, «Rights and patch safety»).
 *
 * User corrections — a note on an objective, a corrected or extra map point, a hidden wrong point — are kept apart
 * from the catalog with their source and the catalog version they were made against. A catalog refresh never
 * touches them; when the catalog version changes they are flagged for review (`isOverrideStale`), not deleted.
 */
import { useEffect, useState } from 'react'
import type { AppDataset, RaidMode } from '../domain/types'

export const QUEST_OVERRIDES_KEY = 'tarkov-quest-overrides-v1'
export const QUEST_OVERRIDES_CHANGED_EVENT = 'quest-overrides-changed'
export const MAX_OVERRIDES = 2000
export const MAX_NOTE_LENGTH = 500

export type QuestOverrideKind = 'objective-note' | 'map-point' | 'hide-point'

/** Which catalog the correction was made against. */
export interface CatalogStamp {
  source: string
  version?: string
  sourceUpdatedAt?: string
  loadedAt?: string
}

export interface QuestOverride {
  id: string
  kind: QuestOverrideKind
  taskId: string
  objectiveId?: string
  /** A correction for one mode, or for every mode (quest ids are shared between PvP, PvE and Season). */
  mode: RaidMode | 'all'
  note?: string
  /** `map-point`: game coordinates of the corrected / extra point. */
  point?: { mapId: string; x: number; y?: number; z: number; label?: string; floorHint?: string }
  /** `hide-point` (and optionally `map-point`): the catalog point this replaces. */
  pointId?: string
  source: 'user'
  createdAt: string
  updatedAt: string
  catalog: CatalogStamp
}

export function catalogStamp(metadata: AppDataset['metadata'] | undefined): CatalogStamp {
  if (!metadata) return { source: 'demo' }
  return {
    source: metadata.sourceUrl ?? metadata.source,
    ...(metadata.sourceVersion ? { version: metadata.sourceVersion } : {}),
    ...(metadata.sourceUpdatedAt ? { sourceUpdatedAt: metadata.sourceUpdatedAt } : {}),
    loadedAt: metadata.loadedAt,
  }
}

/** The catalog changed since the correction was made (both versions known and different). */
export function isOverrideStale(override: QuestOverride, metadata: AppDataset['metadata'] | undefined) {
  const current = metadata?.sourceVersion
  return Boolean(current && override.catalog.version && current !== override.catalog.version)
}

export function overridesFor(list: QuestOverride[], taskId: string, mode: RaidMode) {
  return list.filter((override) => override.taskId === taskId && (override.mode === 'all' || override.mode === mode))
}

export function objectiveNote(list: QuestOverride[], taskId: string, objectiveId: string, mode: RaidMode) {
  // A mode-specific note wins over an all-modes one.
  const notes = overridesFor(list, taskId, mode).filter((override) => override.kind === 'objective-note' && override.objectiveId === objectiveId)
  return notes.find((override) => override.mode === mode) ?? notes[0]
}

/** Sets (or, with an empty text, removes) the note of an objective. */
export function upsertObjectiveNote(
  list: QuestOverride[],
  input: { taskId: string; objectiveId: string; mode: RaidMode | 'all'; note: string; catalog: CatalogStamp; now?: string },
): QuestOverride[] {
  const now = input.now ?? new Date().toISOString()
  const note = input.note.trim().slice(0, MAX_NOTE_LENGTH)
  const index = list.findIndex((override) => override.kind === 'objective-note' && override.taskId === input.taskId && override.objectiveId === input.objectiveId && override.mode === input.mode)
  if (!note) return index < 0 ? list : list.filter((_, position) => position !== index)
  if (index >= 0) return list.map((override, position) => position === index ? { ...override, note, updatedAt: now, catalog: input.catalog } : override)
  return capped([...list, {
    id: overrideId(), kind: 'objective-note', taskId: input.taskId, objectiveId: input.objectiveId, mode: input.mode,
    note, source: 'user', createdAt: now, updatedAt: now, catalog: input.catalog,
  }])
}

/** Adds a corrected or extra map point for an objective (replacing `pointId` when given). */
export function addMapPointOverride(
  list: QuestOverride[],
  input: { taskId: string; objectiveId: string; mode: RaidMode | 'all'; point: NonNullable<QuestOverride['point']>; pointId?: string; catalog: CatalogStamp; now?: string },
): QuestOverride[] {
  const now = input.now ?? new Date().toISOString()
  if (![input.point.x, input.point.z].every(Number.isFinite) || !input.point.mapId) return list
  return capped([...list, {
    id: overrideId(), kind: 'map-point', taskId: input.taskId, objectiveId: input.objectiveId, mode: input.mode,
    point: { ...input.point, ...(input.point.label ? { label: input.point.label.slice(0, 120) } : {}) },
    ...(input.pointId ? { pointId: input.pointId } : {}), source: 'user', createdAt: now, updatedAt: now, catalog: input.catalog,
  }])
}

/** Hides a wrong catalog point (it stays in the catalog; the view drops it). */
export function hideCatalogPoint(list: QuestOverride[], input: { taskId: string; objectiveId?: string; pointId: string; mode: RaidMode | 'all'; catalog: CatalogStamp; now?: string }): QuestOverride[] {
  const now = input.now ?? new Date().toISOString()
  if (list.some((override) => override.kind === 'hide-point' && override.pointId === input.pointId && override.mode === input.mode)) return list
  return capped([...list, {
    id: overrideId(), kind: 'hide-point', taskId: input.taskId, ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}), mode: input.mode,
    pointId: input.pointId, source: 'user', createdAt: now, updatedAt: now, catalog: input.catalog,
  }])
}

export function removeOverride(list: QuestOverride[], id: string) {
  return list.filter((override) => override.id !== id)
}

export function loadQuestOverrides(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): QuestOverride[] {
  try {
    const parsed = JSON.parse(storage?.getItem(QUEST_OVERRIDES_KEY) ?? 'null') as { overrides?: unknown } | null
    return Array.isArray(parsed?.overrides) ? parsed.overrides.filter(validOverride) : []
  } catch {
    return []
  }
}

export function saveQuestOverrides(list: QuestOverride[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()) {
  try {
    storage?.setItem(QUEST_OVERRIDES_KEY, JSON.stringify({ version: 1, overrides: capped(list) }))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEST_OVERRIDES_CHANGED_EVENT))
  } catch { /* storage full or unavailable: the correction stays in memory for this session */ }
}

/** The override list, kept in sync across components; `update` saves. */
export function useQuestOverrides() {
  const [list, setList] = useState<QuestOverride[]>(() => loadQuestOverrides())
  useEffect(() => {
    const reload = () => setList(loadQuestOverrides())
    window.addEventListener(QUEST_OVERRIDES_CHANGED_EVENT, reload)
    window.addEventListener('storage', reload)
    return () => { window.removeEventListener(QUEST_OVERRIDES_CHANGED_EVENT, reload); window.removeEventListener('storage', reload) }
  }, [])
  const update = (change: (current: QuestOverride[]) => QuestOverride[]) => {
    const next = change(loadQuestOverrides())
    setList(next)
    saveQuestOverrides(next)
  }
  return { overrides: list, update }
}

function validOverride(value: unknown): value is QuestOverride {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<QuestOverride>
  return typeof entry.id === 'string' && typeof entry.taskId === 'string' && entry.source === 'user'
    && (entry.kind === 'objective-note' || entry.kind === 'map-point' || entry.kind === 'hide-point')
    && typeof entry.createdAt === 'string' && Boolean(entry.catalog && typeof entry.catalog.source === 'string')
}

function capped(list: QuestOverride[]) {
  return list.length > MAX_OVERRIDES ? list.slice(list.length - MAX_OVERRIDES) : list
}

function overrideId() {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `ov-${random}`
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}
