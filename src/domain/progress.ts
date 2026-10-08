import type { LocalProfile, ModeProgress, ModeRegistration, ObjectiveConflict, ObjectiveProgress, PlayerProfileSnapshot, ProgressEvent, Quest, RaidMode, TaskProgressRecord } from './types'
import { MAX_LOCAL_EVENTS, normalizeObjective } from '../progression/objectiveProgress'

/** v6 adds objective progress, progress events and objective conflicts per mode (v5 data is kept as is). */
export const PROFILE_SCHEMA_VERSION = 6 as const

export function createModeProgress(): ModeProgress {
  return {
    registration: { status: 'unregistered' },
    playerLevel: 1,
    faction: 'unknown',
    prestige: 0,
    taskProgress: {},
    trackedTaskIds: [],
    favoriteItemIds: [],
    raidItemIds: [],
    hideoutLevels: {},
    objectiveProgress: {},
    progressEvents: [],
    objectiveConflicts: [],
  }
}

export function createLocalProfile(displayName: string, id: string = crypto.randomUUID()): LocalProfile {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id,
    displayName: displayName.trim() || 'Оператор',
    createdAt: now,
    updatedAt: now,
    selectedMode: 'pvp',
    modes: { pvp: createModeProgress(), pve: createModeProgress(), seasonal: createModeProgress() },
  }
}

export function registerModeProfile(
  profile: LocalProfile,
  mode: RaidMode,
  registration: Omit<ModeRegistration, 'status'> & { accountId: number; nickname: string; verifiedAt: string },
): LocalProfile {
  const current = profile.modes[mode]
  const previousAccountId = current.registration.accountId
  const accountChanged = typeof previousAccountId === 'number' && previousAccountId !== registration.accountId

  // Binding a different Tarkov account resets quest progress, but keeps operator prefs
  // (favorites / raid list / hideout) so they survive nick confirmation and wipe rebinds.
  let next = profile
  if (accountChanged) {
    next = {
      ...profile,
      modes: {
        ...profile.modes,
        [mode]: {
          ...createModeProgress(),
          favoriteItemIds: [...current.favoriteItemIds],
          raidItemIds: [...current.raidItemIds],
          hideoutLevels: { ...current.hideoutLevels },
          itemCounts: { ...(current.itemCounts ?? {}) },
        },
      },
    }
  }

  return updateMode(next, mode, {
    registration: { ...registration, status: 'registered' },
  }, registration.verifiedAt)
}

export function clearModeRegistration(profile: LocalProfile, mode: RaidMode): LocalProfile {
  return updateMode(profile, mode, {
    registration: { status: 'unregistered' },
    playerSnapshot: undefined,
  })
}

export function applyPlayerSnapshot(profile: LocalProfile, mode: RaidMode, snapshot: PlayerProfileSnapshot | null | undefined): LocalProfile {
  if (!snapshot) return profile
  const current = profile.modes[mode].playerSnapshot
  if (current?.upstreamUpdatedAt && snapshot.upstreamUpdatedAt && snapshot.upstreamUpdatedAt < current.upstreamUpdatedAt) return profile
  if (!snapshot.upstreamUpdatedAt && current && snapshot.fetchedAt < current.fetchedAt) return profile
  return updateMode(profile, mode, {
    playerSnapshot: snapshot,
    playerLevel: Math.max(1, Math.round(snapshot.level)),
    faction: snapshot.faction,
    prestige: Math.max(0, Math.round(snapshot.prestige)),
    registration: {
      ...profile.modes[mode].registration,
      status: 'registered',
      accountId: snapshot.accountId,
      nickname: snapshot.nickname,
    },
  }, snapshot.fetchedAt)
}

export function setTaskProgress(
  profile: LocalProfile,
  mode: RaidMode,
  record: TaskProgressRecord,
): LocalProfile {
  const current = profile.modes[mode].taskProgress[record.taskId]
  if (current && current.updatedAt > record.updatedAt) return profile

  return {
    ...profile,
    updatedAt: record.updatedAt,
    modes: {
      ...profile.modes,
      [mode]: {
        ...profile.modes[mode],
        taskProgress: { ...profile.modes[mode].taskProgress, [record.taskId]: record },
      },
    },
  }
}

export function migrateProfile(input: unknown): LocalProfile | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<LocalProfile> & { schemaVersion?: number; modes?: Partial<Record<RaidMode, Partial<ModeProgress>>> }
  if (!candidate.id || !candidate.displayName || !candidate.modes) return null
  const favoriteUnion = [...new Set((['pvp', 'pve', 'seasonal'] as RaidMode[]).flatMap((mode) => candidate.modes?.[mode]?.favoriteItemIds ?? []))]
  // v4 and older filled quests from screen OCR and from a log parser that could mix modes;
  // v5 rebuilds every mode from the per-mode log timeline, keeping only manual edits.
  const dropUntrusted = (candidate.schemaVersion ?? 0) < 5
  const normalizeMode = (mode: RaidMode): ModeProgress => {
    const saved = candidate.modes?.[mode]
    const taskProgress = { ...(saved?.taskProgress ?? {}) }
    for (const [taskId, record] of Object.entries(taskProgress)) {
      if (dropUntrusted && ['screen-scan', 'inferred', 'eft-log'].includes(record.source)) delete taskProgress[taskId]
      // Confirmed trader-task scans survive restart; inferred chains remain untrusted.
      else if (record.source === 'inferred') delete taskProgress[taskId]
    }
    return {
      ...createModeProgress(),
      ...(saved ?? {}),
      registration: saved?.registration?.status === 'registered'
        ? { ...saved.registration, status: 'registered' }
        : { status: 'unregistered' },
      taskProgress,
      trackedTaskIds: [...(saved?.trackedTaskIds ?? [])],
      favoriteItemIds: favoriteUnion.length ? [...favoriteUnion] : [...(saved?.favoriteItemIds ?? [])],
      raidItemIds: [...(saved?.raidItemIds ?? [])],
      hideoutLevels: { ...(saved?.hideoutLevels ?? {}) },
      itemCounts: Object.fromEntries(Object.entries(saved?.itemCounts ?? {})
        .filter(([, count]) => typeof count === 'number' && Number.isFinite(count) && count > 0)
        .map(([itemId, count]) => [itemId, Math.round(count)])),
      objectiveProgress: sanitizeObjectives(saved?.objectiveProgress),
      progressEvents: sanitizeEvents(saved?.progressEvents, mode),
      objectiveConflicts: sanitizeConflicts(saved?.objectiveConflicts),
    }
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: candidate.id,
    displayName: candidate.displayName,
    createdAt: candidate.createdAt ?? new Date().toISOString(),
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    selectedMode: candidate.selectedMode === 'pve' || candidate.selectedMode === 'seasonal' ? candidate.selectedMode : 'pvp',
    modes: { pvp: normalizeMode('pvp'), pve: normalizeMode('pve'), seasonal: normalizeMode('seasonal') },
  }
}

function updateMode(profile: LocalProfile, mode: RaidMode, patch: Partial<ModeProgress>, updatedAt = new Date().toISOString()): LocalProfile {
  return {
    ...profile,
    updatedAt,
    modes: { ...profile.modes, [mode]: { ...profile.modes[mode], ...patch } },
  }
}

const OBJECTIVE_SOURCES = new Set(['log', 'ocr', 'manual', 'sync'])
const EVENT_TYPES = new Set(['objective', 'task-status', 'undo', 'conflict-resolved'])
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

function validObjective(value: unknown): value is ObjectiveProgress {
  return isRecord(value) && typeof value.objectiveId === 'string' && Boolean(value.objectiveId) && typeof value.taskId === 'string'
    && typeof value.current === 'number' && typeof value.target === 'number' && OBJECTIVE_SOURCES.has(String(value.source)) && isTime(value.observedAt)
}

function sanitizeObjectives(value: unknown): Record<string, ObjectiveProgress> {
  if (!isRecord(value)) return {}
  const result: Record<string, ObjectiveProgress> = {}
  for (const record of Object.values(value)) if (validObjective(record)) result[record.objectiveId] = normalizeObjective(record)
  return result
}

function sanitizeEvents(value: unknown, mode: RaidMode): ProgressEvent[] {
  if (!Array.isArray(value)) return []
  return value.filter((event): event is ProgressEvent => isRecord(event) && typeof event.id === 'string' && typeof event.taskId === 'string'
    && EVENT_TYPES.has(String(event.eventType)) && OBJECTIVE_SOURCES.has(String(event.source)) && isTime(event.observedAt))
    .map((event) => ({ ...event, mode }))
    .slice(-MAX_LOCAL_EVENTS)
}

function sanitizeConflicts(value: unknown): ObjectiveConflict[] {
  if (!Array.isArray(value)) return []
  return value.filter((conflict): conflict is ObjectiveConflict => isRecord(conflict) && typeof conflict.objectiveId === 'string' && validObjective(conflict.incoming))
}

/**
 * Stable identity: progress keys must be task ids. Old builds stored slugs (normalizedName, e.g. the demo seeds
 * `operation-aquarius`); once the catalog is loaded those keys are rewritten to the task id. Keys that match no
 * quest are kept untouched (never dropped). Returns the same object when nothing changes.
 */
export function normalizeTaskKeys(progress: ModeProgress, quests: Quest[]): ModeProgress {
  const ids = new Set(quests.map((quest) => quest.id))
  const bySlug = new Map<string, string>()
  for (const quest of quests) if (quest.normalizedName && !ids.has(quest.normalizedName)) bySlug.set(quest.normalizedName, quest.id)
  const resolve = (key: string) => ids.has(key) ? key : bySlug.get(key) ?? key
  let changed = false
  const taskProgress: Record<string, TaskProgressRecord> = {}
  for (const [key, record] of Object.entries(progress.taskProgress)) {
    const id = resolve(key)
    if (id !== key || record.taskId !== id) changed = true
    const next = { ...record, taskId: id }
    const known = taskProgress[id]
    // Two keys for one task: the newer record wins.
    if (!known || known.updatedAt < next.updatedAt) taskProgress[id] = next
  }
  const trackedTaskIds = [...new Set(progress.trackedTaskIds.map(resolve))]
  if (trackedTaskIds.length !== progress.trackedTaskIds.length || trackedTaskIds.some((id, index) => id !== progress.trackedTaskIds[index])) changed = true
  const objectiveProgress: Record<string, ObjectiveProgress> = {}
  for (const [key, record] of Object.entries(progress.objectiveProgress)) {
    const taskId = resolve(record.taskId)
    if (taskId !== record.taskId) changed = true
    objectiveProgress[key] = taskId === record.taskId ? record : { ...record, taskId }
  }
  return changed ? { ...progress, taskProgress, trackedTaskIds, objectiveProgress } : progress
}
