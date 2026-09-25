import type { ModeProgress, Quest, TaskProgressRecord } from '../domain/types'

export function withInferredPrerequisites(quests: Quest[], progress: ModeProgress): ModeProgress {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const taskProgress = { ...progress.taskProgress }
  const visited = new Set<string>()

  const inferFrom = (taskId: string, rootTaskId: string) => {
    if (visited.has(`${rootTaskId}:${taskId}`)) return
    visited.add(`${rootTaskId}:${taskId}`)
    const quest = byId.get(taskId)
    if (!quest) return
    for (const requirement of quest.requirements ?? []) {
      if (!requirement.allowedStatuses.includes('complete')) continue
      const current = taskProgress[requirement.taskId]
      if (!current) {
        taskProgress[requirement.taskId] = inferredRecord(requirement.taskId, rootTaskId, taskProgress[rootTaskId]?.updatedAt)
      }
      if (taskProgress[requirement.taskId]?.status === 'completed') inferFrom(requirement.taskId, rootTaskId)
    }
  }

  for (const record of Object.values(progress.taskProgress)) {
    if (record.status === 'completed' && record.source !== 'inferred') inferFrom(record.taskId, record.taskId)
  }
  return { ...progress, taskProgress }
}

function inferredRecord(taskId: string, inferredFromTaskId: string, updatedAt?: string): TaskProgressRecord {
  return {
    taskId,
    status: 'completed',
    source: 'inferred',
    inferredFromTaskId,
    updatedAt: updatedAt ?? new Date(0).toISOString(),
  }
}
