import type { ModeProgress, Quest, TaskProgressStatus } from '../domain/types'
import { withInferredPrerequisites } from './progressInference'

export interface TaskAvailability {
  status: TaskProgressStatus
  blockers: string[]
  inferred?: boolean
}

export function evaluateTaskAvailability(quest: Quest, progress: ModeProgress): TaskAvailability {
  const explicit = progress.taskProgress[quest.id]
  if (explicit) return { status: explicit.status, blockers: [], inferred: explicit.source === 'inferred' }

  const blockers: string[] = []
  if (progress.playerLevel < quest.level) blockers.push(`Нужен уровень ${quest.level}`)
  const faction = quest.faction?.trim().toLowerCase()
  if (progress.faction !== 'unknown' && faction && !['any', 'all', 'все'].includes(faction) && faction !== progress.faction) {
    blockers.push(`Задание доступно фракции ${quest.faction}`)
  }

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
  const inferred = withInferredPrerequisites(quests, progress)
  return new Map(quests.map((quest) => [quest.id, evaluateTaskAvailability(quest, inferred)]))
}
