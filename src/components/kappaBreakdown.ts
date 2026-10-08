import type { ModeProgress, Quest, TaskProgressRecord, TaskProgressStatus } from '../domain/types'
import { calculateAvailability, isLiveGameQuest, type TaskAvailability } from '../progression/requirementEngine'

/** Why a Kappa task counts as done: a log, a scanned screen, a manual mark, or a later task of its chain. */
export type KappaCountSource = 'eft-log' | 'screen-scan' | 'manual' | 'inferred'

export interface KappaQuestRow {
  quest: Quest
  status: TaskProgressStatus
  /** Part of «Выполнено N из M» on the card. */
  counted: boolean
  source?: KappaCountSource
  /** For `inferred`: the accepted or completed later task whose prerequisites include this one. */
  via?: Quest
  viaStatus?: 'active' | 'completed'
}

const DIRECT_SOURCES = new Set<TaskProgressRecord['source']>(['eft-log', 'screen-scan', 'manual'])

const statusOrder = (row: KappaQuestRow) => row.counted ? (row.source === 'inferred' ? 1 : 0) : row.status === 'active' ? 2 : 3

/**
 * The tasks behind the Kappa card: every task tarkov.dev marks `kappaRequired`, whether it is counted and why.
 * «Counted» is exactly what the availability engine says. For a task done «по цепочке» the engine is asked again with
 * one tracked record at a time, so the later task named as the reason is the one the engine really used, whatever its
 * inference rules are.
 */
export function kappaBreakdown(quests: Quest[], availability: Map<string, TaskAvailability>, progress: ModeProgress): KappaQuestRow[] {
  const rows: KappaQuestRow[] = quests.filter((quest) => isLiveGameQuest(quest) && quest.kappa).map((quest) => {
    const status = availability.get(quest.id)?.status ?? 'unknown'
    if (status !== 'completed') return { quest, status, counted: false }
    const record = progress.taskProgress[quest.id]
    const source = record?.status === 'completed' && DIRECT_SOURCES.has(record.source) ? record.source as KappaCountSource : 'inferred'
    return { quest, status, counted: true, source }
  })

  const unexplained = new Set(rows.filter((row) => row.source === 'inferred').map((row) => row.quest.id))
  const via = new Map<string, { quest: Quest; status: 'active' | 'completed' }>()
  if (unexplained.size) {
    const byId = new Map(quests.map((quest) => [quest.id, quest]))
    // Lower-level proofs first: the nearest later task of a chain explains it better than its far end.
    const proofs = Object.values(progress.taskProgress)
      .filter((record) => DIRECT_SOURCES.has(record.source) && (record.status === 'active' || record.status === 'completed') && byId.has(record.taskId))
      .sort((left, right) => byId.get(left.taskId)!.level - byId.get(right.taskId)!.level)
    for (const record of proofs) {
      if (!unexplained.size) break
      const alone = calculateAvailability(quests, { ...progress, taskProgress: { [record.taskId]: record } })
      for (const id of [...unexplained]) {
        if (id === record.taskId || alone.get(id)?.status !== 'completed') continue
        via.set(id, { quest: byId.get(record.taskId)!, status: record.status === 'active' ? 'active' : 'completed' })
        unexplained.delete(id)
      }
    }
  }

  return rows
    .map((row) => {
      const proof = via.get(row.quest.id)
      return proof ? { ...row, via: proof.quest, viaStatus: proof.status } : row
    })
    .sort((left, right) => statusOrder(left) - statusOrder(right) || left.quest.level - right.quest.level || left.quest.name.localeCompare(right.quest.name, 'ru'))
}
