import type { LocalProfile, ModeProgress, ModeRegistration, ObjectiveConflict, ObjectiveProgress, PlayerProfileSnapshot, ProgressEvent, Quest, RaidMode, TaskProgressRecord } from './types'
import { MAX_LOCAL_EVENTS, normalizeObjective } from '../progression/objectiveProgress'
import { levelReachable } from '../profile/levelExperience'
import { commitQuestInputs, inputsFromRecords, inputsOf, renameInputKeys, STORY_IDS } from '../quests/questInputs'
import { emptyQuestInputs, isStoryRecord, type QuestInputLayers } from '../quests/questEngine'

/**
 * A Tasks-table reading of a trader quest (owner, 15.10.2026: «сканирование экрана только для пве режима и для сюжетных
 * квестах во всех режимах»): a screen record that is no story chapter — not one of the chapter ids, no stage, no objectives.
 */
export function isTasksTableRecord(record: TaskProgressRecord) {
  return record.source === 'screen-scan' && !isStoryRecord(record, STORY_IDS)
}

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

/** The later of two ISO times (either may be missing). */
export function laterTime(a: string | undefined, b: string | undefined) {
  return a && b ? (a > b ? a : b) : a ?? b
}

/**
 * «Престиж +» or a nickname change (src/state/modeReset.ts): every progress record of one mode goes — quests from the
 * logs, the Tasks table and the story pane (chapters, stages, their objectives), objective progress, conflicts and the
 * history of changes, hideout levels, «Что не продавать» counts, and the level, prestige, faction and Tarkov.dev profile
 * read for the mode. Kept: the game account binding and the logs' character of the mode (identity, not progress), the
 * tracked quests, favourite and raid items (preferences), the season. The reset time `at` becomes the mode's epoch
 * (`logResetAt`, `logEpochAt`, `modeResetAt`): nothing older comes back from a rescan, the server or a screen reading.
 * Other modes are not touched.
 */
export function wipeModeProgress(profile: LocalProfile, mode: RaidMode, at: string, now = new Date().toISOString(), prestige?: { keep?: boolean; level?: number }): LocalProfile {
  const current = profile.modes[mode]
  const next: ModeProgress = {
    ...createModeProgress(),
    questInputs: emptyQuestInputs(),
    // «Престиж +»: the level the player chose, from the press on. «Вайп»: a game wipe keeps the prestige (BSG, 0.16.0.0:
    // «Prestige levels and rewards do not reset with wipes»). A nickname change: Tarkov.dev reads it again.
    ...(prestige?.level != null ? { prestige: prestige.level, prestigeSetAt: at }
      : prestige?.keep ? { prestige: current.prestige, ...(current.prestigeSetAt ? { prestigeSetAt: current.prestigeSetAt } : {}) } : {}),
    registration: current.registration,
    trackedTaskIds: [...current.trackedTaskIds],
    favoriteItemIds: [...current.favoriteItemIds],
    raidItemIds: [...current.raidItemIds],
    ...(current.seasonId ? { seasonId: current.seasonId } : {}),
    ...(current.lastLogSyncAt ? { lastLogSyncAt: current.lastLogSyncAt } : {}),
    ...(current.logCharacterId ? { logCharacterId: current.logCharacterId } : {}),
    logResetAt: laterTime(current.logResetAt, at),
    logEpochAt: laterTime(current.logEpochAt, at),
    modeResetAt: laterTime(current.modeResetAt, at),
  }
  return { ...profile, updatedAt: now, modes: { ...profile.modes, [mode]: next } }
}

/** A reading taken before the mode's last reset (wipeModeProgress) belongs to the progress before it. */
export function beforeModeReset(progress: Pick<ModeProgress, 'modeResetAt'>, time: string | undefined) {
  return Boolean(progress.modeResetAt && time && time < progress.modeResetAt)
}

export function clearModeRegistration(profile: LocalProfile, mode: RaidMode): LocalProfile {
  return updateMode(profile, mode, {
    registration: { status: 'unregistered' },
    playerSnapshot: undefined,
  })
}

export function applyPlayerSnapshot(profile: LocalProfile, mode: RaidMode, snapshot: PlayerProfileSnapshot | null | undefined): LocalProfile {
  if (!snapshot) return profile
  // A Tarkov.dev profile from before the mode's reset is the character before it: not its level, not its prestige.
  if (beforeModeReset(profile.modes[mode], snapshot.upstreamUpdatedAt ?? snapshot.fetchedAt)) return profile
  const current = profile.modes[mode].playerSnapshot
  if (current?.upstreamUpdatedAt && snapshot.upstreamUpdatedAt && snapshot.upstreamUpdatedAt < current.upstreamUpdatedAt) return profile
  if (!snapshot.upstreamUpdatedAt && current && snapshot.fetchedAt < current.fetchedAt) return profile
  // The level: Tarkov.dev's unless the game's screen showed one later («побеждают свежие, но приоритет у тарков дев») —
  // and one its exact experience could have reached by then: a screen level no play explains is a misreading (player's
  // report, 14.10.2026: PvE 39 shown as 59), Tarkov.dev's replaces it. The other way round too: a Tarkov.dev level no
  // play explains since a checked screen reading (src/import/levelDigits.ts) does not replace that reading.
  const observedAt = snapshot.upstreamUpdatedAt ?? snapshot.fetchedAt
  const anchor = profile.modes[mode].levelAnchor
  const level = Math.max(1, Math.round(snapshot.level))
  const experience = Number.isFinite(snapshot.experience) && snapshot.experience > 0 ? snapshot.experience : undefined
  const misread = anchor?.source === 'screen' && !levelReachable({ level, observedAt, experience }, anchor.level, anchor.observedAt)
  const beyond = anchor?.source === 'screen' && anchor.checked === true && !levelReachable(anchor, level, observedAt)
  const levelUpdate = (!anchor || anchor.source === 'tarkov-dev' || observedAt >= anchor.observedAt || misread) && !beyond
    ? { playerLevel: level, levelAnchor: { level, observedAt, source: 'tarkov-dev' as const, ...(experience ? { experience } : {}) } }
    : {}
  return updateMode(profile, mode, {
    playerSnapshot: snapshot,
    ...levelUpdate,
    faction: snapshot.faction,
    // The prestige the player chose in «Престиж +» is theirs from then on: a later game reading may raise it, never lower it.
    prestige: profile.modes[mode].prestigeSetAt
      ? Math.max(profile.modes[mode].prestige, Math.max(0, Math.round(snapshot.prestige)))
      : Math.max(0, Math.round(snapshot.prestige)),
    registration: {
      ...profile.modes[mode].registration,
      status: 'registered',
      accountId: snapshot.accountId,
      nickname: snapshot.nickname,
    },
  }, snapshot.fetchedAt)
}

/**
 * The level the game's screen showed for this mode at `observedAt` (src/import/modeSelectScreen.ts; its digits read from
 * their shapes too, src/import/levelDigits.ts): «Выбор профиля и режима», or the traders' screen (`raiseOnly`).
 * It replaces an older reading at once; Tarkov.dev's anchor stays when it has the same level (it knows the exact
 * experience) or is newer. A raise no play explains since the anchor (src/profile/levelExperience.ts) is not taken: a
 * misreading, or another mode's traders' screen.
 */
export function applyScreenLevel(profile: LocalProfile, mode: RaidMode, level: number, observedAt: string, raiseOnly = false): LocalProfile {
  if (!Number.isInteger(level) || level < 1) return profile
  // A screen read before the mode's reset (a reading kept while the app was locked).
  if (beforeModeReset(profile.modes[mode], observedAt)) return profile
  const { levelAnchor: anchor, playerLevel } = profile.modes[mode]
  // Read by OCR alone before 14.10.2026 («39» stored as «59»): any newer reading replaces it, the traders' screen too.
  const unchecked = anchor?.source === 'screen' && !anchor.checked
  // The traders' screen does not name its mode (the logs' current one is taken): it may raise a level, never lower one.
  if (raiseOnly && level < playerLevel && !unchecked) return profile
  if (anchor && anchor.observedAt >= observedAt) return profile
  // The same level as Tarkov.dev's (and nothing added since disagrees): its anchor stays, it knows the exact experience.
  if (anchor?.source === 'tarkov-dev' && anchor.level === level && playerLevel === level) return profile
  if (anchor && !unchecked && level > playerLevel && !levelReachable(anchor, level, observedAt)) return profile
  return updateMode(profile, mode, { playerLevel: level, levelAnchor: { level, observedAt, source: 'screen', checked: true } })
}

/** Quest experience since the anchor raised the level (src/profile/questExperience.ts); never lowers it. */
export function raisePlayerLevel(profile: LocalProfile, mode: RaidMode, level: number): LocalProfile {
  if (!Number.isInteger(level) || level <= profile.modes[mode].playerLevel) return profile
  return updateMode(profile, mode, { playerLevel: level })
}

/**
 * One record put into the layer its source belongs to (a test fixture, an import): the quest-state engine decides as for
 * any other reading. An older record than the one of that source kept changes nothing.
 */
export function setTaskProgress(
  profile: LocalProfile,
  mode: RaidMode,
  record: TaskProgressRecord,
): LocalProfile {
  const current = profile.modes[mode]
  const layers = inputsOf(current, mode)
  const single = inputsFromRecords({ [record.taskId]: record }, mode)
  const next = { ...layers }
  let changed = false
  for (const key of Object.keys(single) as Array<keyof QuestInputLayers>) {
    const entry = (single[key] as Record<string, { at?: string; updatedAt?: string }>)[record.taskId]
    if (!entry) continue
    const kept = (layers[key] as Record<string, { at?: string; updatedAt?: string }>)[record.taskId]
    if (kept && (kept.at ?? kept.updatedAt ?? '') > (entry.at ?? entry.updatedAt ?? '')) return profile
    ;(next as unknown as Record<string, Record<string, unknown>>)[key] = { ...layers[key], [record.taskId]: entry }
    changed = true
  }
  if (!changed) return profile
  return { ...profile, updatedAt: record.updatedAt, modes: { ...profile.modes, [mode]: commitQuestInputs(current, mode, next) } }
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
      // PvP and Season: trader quests come from the logs only; the Tasks-table readings of earlier versions go.
      else if (mode !== 'pve' && isTasksTableRecord(record)) delete taskProgress[taskId]
    }
    const migrated: ModeProgress = {
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
    delete migrated.questInputs
    // The quest-state engine (src/quests/questEngine.ts): its layers, built once from the records of an older profile;
    // the Tasks table counts in PvE only. `taskProgress` becomes the engine's output.
    const layers = sanitizeInputs(saved?.questInputs) ?? inputsFromRecords(taskProgress, mode)
    if (mode !== 'pve' && Object.keys(layers.table).length) layers.table = {}
    return commitQuestInputs(migrated, mode, layers)
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

/** Saved layers of the quest-state engine, each an object (anything else: built again from the records). */
function sanitizeInputs(value: unknown): QuestInputLayers | null {
  if (!isRecord(value)) return null
  const layers = emptyQuestInputs()
  for (const key of Object.keys(layers) as Array<keyof QuestInputLayers>) {
    const layer = value[key]
    if (layer === undefined) continue
    if (!isRecord(layer)) return null
    ;(layers as unknown as Record<string, unknown>)[key] = Object.fromEntries(Object.entries(layer).filter(([, entry]) => isRecord(entry) && (isTime(entry.at) || isTime(entry.updatedAt))))
  }
  return layers
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
export function normalizeTaskKeys(progress: ModeProgress, quests: Quest[], mode: RaidMode = 'pve'): ModeProgress {
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
  if (progress.questInputs) {
    const layers = renameInputKeys(progress.questInputs, resolve)
    if (layers !== progress.questInputs) return commitQuestInputs({ ...progress, trackedTaskIds, objectiveProgress }, mode, layers)
  }
  return changed ? { ...progress, taskProgress, trackedTaskIds, objectiveProgress } : progress
}
