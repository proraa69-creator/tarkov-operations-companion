import type { ModeProgress, Quest, TaskProgressStatus } from '../domain/types'

export interface TaskAvailability {
  status: TaskProgressStatus
  blockers: string[]
}

export function evaluateTaskAvailability(quest: Quest, progress: ModeProgress): TaskAvailability {
  const explicit = progress.taskProgress[quest.id]
  if (explicit) return { status: explicit.status, blockers: [] }

  const blockers: string[] = []
  if (progress.playerLevel < quest.level) blockers.push(`Нужен уровень ${quest.level}`)

  for (const requirement of quest.requirements ?? []) {
    const prerequisite = progress.taskProgress[requirement.taskId]
    const normalized = prerequisite?.status === 'completed' ? 'complete' : prerequisite?.status
    if (!normalized || !requirement.allowedStatuses.includes(normalized as 'complete' | 'failed' | 'active')) {
      blockers.push(`Не выполнено предыдущее задание: ${requirement.taskId}`)
    }
  }

  return blockers.length ? { status: 'locked', blockers } : { status: 'available', blockers: [] }
}

export function calculateAvailability(quests: Quest[], progress: ModeProgress) {
  return new Map(quests.map((quest) => [quest.id, evaluateTaskAvailability(quest, progress)]))
}
