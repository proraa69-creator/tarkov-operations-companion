import type { RaidMode } from '../models/api.js'
import type { ProgressStore } from './progressStore.js'

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

/** The account's synced progress for one mode (PvP, PvE and Seasonal are never mixed). */
export function sharedProgress(progress: ProgressStore, accountId: string, mode: RaidMode): SharedProgress {
  const { records, scope } = progress.userRecords(`user:${accountId}`, mode)
  const activeQuestIds: string[] = []
  const objectives: Record<string, SharedObjective[]> = {}
  let completedCount = 0
  for (const record of records) {
    if (record.status === 'completed') completedCount += 1
    if (record.status !== 'active') continue
    activeQuestIds.push(record.taskId)
    const list = sanitizeObjectives((record as { objectives?: unknown }).objectives)
    if (list.length) objectives[record.taskId] = list
  }
  return { activeQuestIds, objectives, completedCount, lastSyncAt: scope?.syncedAt ?? null }
}

export const HIDDEN_PROGRESS: SharedProgress = { activeQuestIds: [], objectives: {}, completedCount: 0, lastSyncAt: null }
