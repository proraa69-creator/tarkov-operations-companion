import type { ModeProgress, ModeRegistration, RaidMode, TaskProgressRecord } from '../domain/types'
import type { ParsedTaskEvent } from './logParser'

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
 * The logs of one mode are the source of truth for that mode: every quest they mention takes its
 * latest logged status. Records from other sources are dropped, except manual edits and scanned
 * story chapters (the game never logs those) that are newer than anything the logs say.
 */
export function applyLogQuestState(progress: ModeProgress, events: ParsedTaskEvent[], options: { keepPreviousLogRecords?: boolean } = {}): ModeProgress {
  const taskProgress: Record<string, TaskProgressRecord> = {}
  for (const [taskId, record] of Object.entries(progress.taskProgress)) {
    if (record.source === 'manual' || record.source === 'screen-scan') taskProgress[taskId] = record
    // Game logs are rotated and deleted over time. For the same character, what an earlier scan
    // read stays true (a wipe or profile reset changes the character or is reported as a reset).
    else if (options.keepPreviousLogRecords && record.source === 'eft-log') taskProgress[taskId] = record
  }
  for (const event of events) {
    const manual = taskProgress[event.taskId]
    if (manual && manual.updatedAt > event.timestamp) continue
    taskProgress[event.taskId] = { taskId: event.taskId, status: event.status, source: 'eft-log', updatedAt: event.timestamp }
  }
  return { ...progress, taskProgress }
}

const RAID_MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/** Applies each mode's own log events to that mode only. */
export function applyScanToModes(
  result: ModeLogEvents & { summaryByMode?: Partial<Record<RaidMode, { lastActivityAt?: string; resetAt?: string }>> },
  registrationOf: (mode: RaidMode) => ModeRegistration,
  apply: (mode: RaidMode, events: ParsedTaskEvent[], characterId?: string, resetAt?: string) => void,
) {
  for (const mode of RAID_MODES) {
    if (!result.summaryByMode?.[mode]?.lastActivityAt) continue
    apply(mode, logEventsForMode(result, mode, registrationOf(mode)), result.latestCharacterIdByMode?.[mode], result.summaryByMode?.[mode]?.resetAt)
  }
}

export function logStateFingerprint(progress: ModeProgress) {
  return Object.values(progress.taskProgress)
    .map((record) => `${record.taskId}:${record.status}:${record.source}:${record.updatedAt}`)
    .sort()
    .join('|')
}
