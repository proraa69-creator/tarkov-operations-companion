import type { ModeProgress, Quest } from '../domain/types'
import type { QuestRowStatus } from './questOcr'

/**
 * One «Найти квесты» watch session. A quest the scanner found earlier that is no longer in the
 * Tasks table is treated as handed in and moves to completed.
 */
export interface QuestScanSession {
  startedAt: number
  firstTableAt?: number
  lastTableAt?: number
  /** Tasks-table frames (frames that listed at least one trader quest). */
  tableFrames: number
  /** questId → frame number / time it was last listed. */
  seenFrame: Record<string, number>
  seenAt: Record<string, number>
  /** Trader → last frame number that listed one of their quests. */
  traderFrame: Record<string, number>
  /** questId → the other quests listed next to it the last time it was seen. */
  neighbors: Record<string, string[]>
  lastFrameIds: string[]
}

/** Viewing the table this long without a stored quest proves it is gone. */
export const STALE_AFTER_MS = 15_000
export const STALE_AFTER_FRAMES = 4
/** A quest seen earlier in the session must be missing this long before it counts as handed in. */
export const VANISH_AFTER_MS = 8_000
export const VANISH_AFTER_FRAMES = 3

export function createScanSession(now = Date.now()): QuestScanSession {
  return { startedAt: now, tableFrames: 0, seenFrame: {}, seenAt: {}, traderFrame: {}, neighbors: {}, lastFrameIds: [] }
}

export function recordScanFrame(
  session: QuestScanSession,
  matches: Array<{ questId: string; status?: QuestRowStatus }>,
  quests: Quest[],
  now = Date.now(),
): QuestScanSession {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const listed = matches.filter((match) => {
    const quest = byId.get(match.questId)
    return quest && quest.kind !== 'story' && (match.status === undefined || match.status === 'active' || match.status === 'ready')
  })
  if (!listed.length) return session
  const frame = session.tableFrames + 1
  const ids = [...new Set(listed.map((match) => match.questId))]
  const next: QuestScanSession = {
    ...session,
    tableFrames: frame,
    firstTableAt: session.firstTableAt ?? now,
    lastTableAt: now,
    seenFrame: { ...session.seenFrame },
    seenAt: { ...session.seenAt },
    traderFrame: { ...session.traderFrame },
    neighbors: { ...session.neighbors },
    lastFrameIds: ids,
  }
  for (const taskId of ids) {
    next.seenFrame[taskId] = frame
    next.seenAt[taskId] = now
    next.neighbors[taskId] = ids.filter((id) => id !== taskId)
    const trader = byId.get(taskId)?.trader
    if (trader) next.traderFrame[trader] = frame
  }
  return next
}

export function reconcileWithSession(
  progress: ModeProgress,
  session: QuestScanSession,
  quests: Quest[],
  now = Date.now(),
): ModeProgress {
  if (!session.tableFrames || session.firstTableAt == null) return progress
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const sustained = session.tableFrames >= STALE_AFTER_FRAMES && now - session.firstTableAt >= STALE_AFTER_MS
  const overview = Object.keys(session.traderFrame).length >= 3
  const updatedAt = new Date(now).toISOString()
  let taskProgress = progress.taskProgress
  const complete = (taskId: string, currentStageIndex?: number) => {
    if (taskProgress === progress.taskProgress) taskProgress = { ...progress.taskProgress }
    taskProgress[taskId] = { taskId, status: 'completed', source: 'screen-scan', updatedAt, currentStageIndex }
  }

  for (const [taskId, record] of Object.entries(progress.taskProgress)) {
    if (record.source !== 'screen-scan' || record.status !== 'active') continue
    const quest = byId.get(taskId)
    if (!quest || quest.kind === 'story') continue
    const traderFrame = session.traderFrame[quest.trader]
    const seenFrame = session.seenFrame[taskId]

    if (seenFrame == null) {
      // Found by an earlier scan, missing from this one while its trader / the full list is shown.
      if (sustained && (traderFrame != null || overview)) complete(taskId, record.currentStageIndex)
      continue
    }

    // Gone while the rows around it are still listed → handed in, not scrolled away.
    const neighbors = session.neighbors[taskId] ?? []
    const stillListed = neighbors.filter((id) => session.lastFrameIds.includes(id)).length
    const vanished = session.tableFrames - seenFrame >= VANISH_AFTER_FRAMES
      && now - (session.seenAt[taskId] ?? now) >= VANISH_AFTER_MS
      && (traderFrame ?? 0) > seenFrame
      && neighbors.length > 0
      && stillListed >= Math.min(2, neighbors.length)
    if (vanished) complete(taskId, record.currentStageIndex)
  }

  return taskProgress === progress.taskProgress ? progress : { ...progress, taskProgress }
}
