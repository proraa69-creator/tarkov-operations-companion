import type { RaidMode } from '../models/api.js'
import type { ProgressStore } from './progressStore.js'
import { emptyQuestInputs, resolveQuestStates } from '../../../src/quests/questEngine'

/** Progress of one objective as friends and squad mates see it (only ids and numbers, never free text). */
export interface SharedObjective { objectiveId: string; count?: number; target?: number; done?: boolean }

/** What a friend or squad mate may see of somebody's progress in one mode. */
export interface SharedProgress {
  activeQuestIds: string[]
  /** Objective-level progress per active quest, when the progress records carry it (feat-quest-sync). */
  objectives: Record<string, SharedObjective[]>
  completedCount: number
  lastSyncAt: string | null
}

const OBJECTIVE_ID = /^[A-Za-z0-9_-]{1,64}$/
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? Math.floor(value) : undefined)

/** Tolerates an optional `objectives` array on progress records; anything unexpected is dropped. */
export function sanitizeObjectives(raw: unknown): SharedObjective[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 64).flatMap((entry): SharedObjective[] => {
    if (!entry || typeof entry !== 'object') return []
    const value = entry as Record<string, unknown>
    const objectiveId = typeof value.objectiveId === 'string' ? value.objectiveId : typeof value.id === 'string' ? value.id : ''
    if (!OBJECTIVE_ID.test(objectiveId)) return []
    const current = count(value.count ?? value.current)
    const target = count(value.target ?? value.targetCount ?? value.total)
    const done = typeof value.done === 'boolean' ? value.done : typeof value.completed === 'boolean' ? value.completed : value.status === 'completed' ? true : undefined
    return [{ objectiveId, ...(current === undefined ? {} : { count: current }), ...(target === undefined ? {} : { target }), ...(done === undefined ? {} : { done }) }]
  })
}

/**
 * The account's synced progress for one mode (PvP, PvE and Seasonal are never mixed), as the app shows it: the quest-state
 * engine (src/quests/questEngine.ts) over the log records of every PC and the player's manual marks, after the mode's
 * reset — the same decision the player's own app makes.
 */
export function sharedProgress(progress: ProgressStore, accountId: string, mode: RaidMode): SharedProgress {
  const { records, scope } = progress.userRecords(`user:${accountId}`, mode)
  const states = resolvedRecords(progress, `user:${accountId}`, mode, records, scope?.resetAt)
  const byId = new Map(records.map((record) => [record.taskId, record]))
  const activeQuestIds: string[] = []
  const objectives: Record<string, SharedObjective[]> = {}
  let completedCount = 0
  for (const [taskId, status] of states) {
    if (status === 'completed') completedCount += 1
    if (status !== 'active') continue
    activeQuestIds.push(taskId)
    const list = sanitizeObjectives((byId.get(taskId) as { objectives?: unknown } | undefined)?.objectives)
    if (list.length) objectives[taskId] = list
  }
  return { activeQuestIds, objectives, completedCount, lastSyncAt: scope?.syncedAt ?? null }
}

/** Each quest's decided status of one owner and mode: the server's log records and the manual marks, through the engine. */
export function resolvedRecords(progress: ProgressStore, owner: string, mode: RaidMode, records: ReadonlyArray<{ taskId: string; status: string; updatedAt: string }>, floor?: string) {
  const layers = emptyQuestInputs()
  for (const record of records) {
    if (record.status === 'active' || record.status === 'completed' || record.status === 'failed') layers.server[record.taskId] = { status: record.status, at: record.updatedAt }
  }
  for (const mark of progress.manualMarks(owner, mode)) layers.manual[mark.taskId] = { status: mark.status, at: mark.at }
  const resolution = resolveQuestStates({ ...layers, mode, ...(floor ? { floor } : {}) })
  return new Map([...resolution.states.values()].filter((state) => state.status !== 'not-started').map((state) => [state.taskId, state.status]))
}

export const HIDDEN_PROGRESS: SharedProgress = { activeQuestIds: [], objectives: {}, completedCount: 0, lastSyncAt: null }
