import type { ModeProgress, ModeRegistration, RaidMode } from '../domain/types'
import { commitQuestInputs, dropInputsBefore, inputsOf, mergeObservations, withLayer } from '../quests/questInputs'
import type { ParsedTaskEvent } from './logParser'

/** The game's Logs folder the desktop app found or was given (AppShell; the locked app's re-check, eftAccountLink.ts). */
export const LOG_FOLDER_STORAGE_KEY = 'tarkov-operations-log-folder-v1'

export interface ModeLogEvents {
  eventsByMode: Record<RaidMode, ParsedTaskEvent[]>
  latestAccountIdByMode?: Partial<Record<RaidMode, number>>
  latestCharacterIdByMode?: Partial<Record<RaidMode, string>>
}

export function logEventsForMode(result: ModeLogEvents, mode: RaidMode, registration: ModeRegistration) {
  const events = result.eventsByMode[mode] ?? []
  const wanted = registration.status === 'registered' ? registration.accountId : result.latestAccountIdByMode?.[mode]
  if (!wanted) return events
  const matching = events.filter((event) => !event.accountId || event.accountId === wanted)
  return matching.length ? matching : events
}

/**
 * A scan's events of one mode into its log layer (src/quests/questInputs.ts): per quest the newest event. The quest-state
 * engine (src/quests/questEngine.ts) then decides against the other sources — a log event beats any Tasks-table reading,
 * an older manual mark and an older event of another PC. Without `keepPreviousLogRecords` the log layer starts again
 * from these events (the first character a mode learns); with it, what an earlier scan read stays (game logs are rotated
 * and deleted over time).
 */
export function applyLogQuestState(progress: ModeProgress, events: ParsedTaskEvent[], options: { keepPreviousLogRecords?: boolean; mode?: RaidMode; layer?: 'log' | 'server' } = {}): ModeProgress {
  const mode = options.mode ?? 'pve'
  const key = options.layer ?? 'log'
  const layers = inputsOf(progress, mode)
  return withLayer(progress, mode, key, mergeObservations(layers[key], events, key === 'server' || Boolean(options.keepPreviousLogRecords)))
}

/** Who the log records of a mode belong to, as a scan or the server tells it. */
export interface LogIdentityInput {
  /** The mode's profile id in the logs (the server's character scope for its records); undefined when no profile line. */
  characterId?: string
  /** The latest trusted reset (src/import/eftLogTimeline.ts dropBeforeReset). */
  resetAt?: string
  /** Since when the logs show this character in this mode (summaryByMode.profileSince). */
  characterSince?: string
}

/** A new epoch of a mode's records: another character, or a newer trusted reset of the same one. */
export interface LogEpochChange {
  kind: 'character' | 'reset'
  /** Records older than this belong to the epoch before. */
  at: string
  characterId?: string
  previousCharacterId?: string
}

/**
 * R4 / step 25: a character change (a wipe, or another game account in this mode) or a newer trusted reset of the same
 * character starts a new epoch. It is told once, at the change: the mode keeps its character (`logCharacterId`) and the
 * reset it was cut at (`logResetAt`), so the next scans with the same ones change nothing. A scan without a profile line
 * (no character id) is no change, and neither is the first character a mode learns. An older reset never counts.
 */
export function logEpochChange(progress: Pick<ModeProgress, 'logCharacterId' | 'logResetAt'>, input: LogIdentityInput, now = new Date().toISOString()): LogEpochChange | null {
  const known = progress.logCharacterId
  const { characterId, resetAt } = input
  if (characterId && known && characterId !== known) {
    // The logs tell since when the new character plays; the server's scope does not (then everything before now goes).
    const since = input.characterSince && input.characterSince <= now ? input.characterSince : now
    return { kind: 'character', at: resetAt && resetAt > since ? resetAt : since, characterId, previousCharacterId: known }
  }
  const character = characterId ?? known
  if (resetAt && (!progress.logResetAt || resetAt > progress.logResetAt)) return { kind: 'reset', at: resetAt, ...(character ? { characterId: character } : {}) }
  return null
}

/**
 * Drops a mode's quest state older than `at`: log, Tasks-table and legacy manual quest records, story chapters (their
 * stage and objectives are records of the same map) and objective progress. Preferences stay: tracked quests, favourite
 * and raid items, item counts, hideout levels, the game account binding and the level.
 */
export function dropRecordsBefore(progress: ModeProgress, at: string, mode: RaidMode = 'pve'): ModeProgress {
  const objectiveProgress = Object.fromEntries(Object.entries(progress.objectiveProgress ?? {}).filter(([, record]) => record.observedAt >= at))
  const objectiveConflicts = (progress.objectiveConflicts ?? []).filter((conflict) => conflict.detectedAt >= at)
  return commitQuestInputs({ ...progress, objectiveProgress, objectiveConflicts }, mode, dropInputsBefore(inputsOf(progress, mode), at))
}

const RAID_MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/** Applies each mode's own log events to that mode only. */
export function applyScanToModes(
  result: ModeLogEvents & { summaryByMode?: Partial<Record<RaidMode, { lastActivityAt?: string; resetAt?: string; profileSince?: string }>> },
  registrationOf: (mode: RaidMode) => ModeRegistration,
  apply: (mode: RaidMode, events: ParsedTaskEvent[], characterId?: string, resetAt?: string, characterSince?: string) => void,
) {
  for (const mode of RAID_MODES) {
    const summary = result.summaryByMode?.[mode]
    if (!summary?.lastActivityAt) continue
    apply(mode, logEventsForMode(result, mode, registrationOf(mode)), result.latestCharacterIdByMode?.[mode], summary.resetAt, summary.profileSince)
  }
}

export function logStateFingerprint(progress: ModeProgress) {
  return Object.values(progress.taskProgress)
    .map((record) => `${record.taskId}:${record.status}:${record.source}:${record.updatedAt}`)
    .sort()
    .join('|')
}
