import type { ModeProgress, Quest, TaskProgressRecord, TaskProgressStatus, TaskRequirement } from '../domain/types'

export interface TaskAvailability {
  status: TaskProgressStatus
  blockers: string[]
}

export function evaluateTaskAvailability(quest: Quest, progress: ModeProgress): TaskAvailability {
  const explicit = progress.taskProgress[quest.id]
  if (explicit) return { status: explicit.status, blockers: [] }

  const blockers: string[] = []
  if (progress.playerLevel < quest.level) blockers.push(`Нужен уровень ${quest.level}`)
  const faction = questFaction(quest.faction)
  if (progress.faction !== 'unknown' && faction && faction !== progress.faction) {
    blockers.push(`Задание доступно фракции ${quest.faction}`)
  }

  for (const requirement of questRequirements(quest)) {
    const prerequisite = progress.taskProgress[requirement.taskId]
    const normalized = prerequisite?.status === 'completed'
      ? 'complete'
      : prerequisite?.status === 'active'
        ? 'active'
        : prerequisite?.status === 'failed'
          ? 'failed'
          : undefined
    const allowed = new Set(requirement.allowedStatuses.length ? requirement.allowedStatuses : ['complete'])
    if (!normalized || !allowed.has(normalized as 'complete' | 'failed' | 'active')) {
      blockers.push(`Не выполнено предыдущее задание: ${requirement.taskId}`)
    }
  }

  return blockers.length ? { status: 'locked', blockers } : { status: 'available', blockers: [] }
}

/** Only an explicit USEC/BEAR restriction counts; «Any» (or its translation) means everyone. */
export function questFaction(value: string | undefined): 'usec' | 'bear' | undefined {
  const key = value?.trim().toLowerCase() ?? ''
  if (/^(usec|юсек)$/.test(key)) return 'usec'
  if (/^(bear|беар|бир)$/.test(key)) return 'bear'
  return undefined
}

/** Sources that describe this mode's real quest state: logs (split per mode), manual edits, story-pane scans. */
const TRACKED_SOURCES = new Set<TaskProgressRecord['source']>(['eft-log', 'manual', 'screen-scan'])

export function calculateAvailability(quests: Quest[], progress: ModeProgress) {
  const verified: ModeProgress = {
    ...progress,
    taskProgress: Object.fromEntries(Object.entries(progress.taskProgress).filter(([, record]) => TRACKED_SOURCES.has(record.source))),
  }
  // Logs reliably expose currently held quests, but older completed rows are
  // often absent in PvE. A current/completed quest proves every mandatory,
  // completion-only prerequisite in its chain. Alternative groups are skipped.
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const queue = Object.values(verified.taskProgress)
    .filter((record) => record.status === 'active' || record.status === 'completed')
    .map((record) => record.taskId)
  const visited = new Set<string>()
  while (queue.length) {
    const taskId = queue.shift()!
    if (visited.has(taskId)) continue
    visited.add(taskId)
    const quest = byId.get(taskId)
    if (!quest) continue
    for (const requirement of questRequirements(quest)) {
      const completionOnly = requirement.allowedStatuses.length === 0 || requirement.allowedStatuses.every((status) => status === 'complete')
      if (requirement.group || !completionOnly || verified.taskProgress[requirement.taskId]) continue
      verified.taskProgress[requirement.taskId] = {
        taskId: requirement.taskId,
        status: 'completed',
        source: 'inferred',
        updatedAt: progress.lastLogSyncAt ?? new Date(0).toISOString(),
        inferredFromTaskId: taskId,
      }
      queue.push(requirement.taskId)
    }
  }
  return new Map(quests.map((quest) => [quest.id, evaluateTaskAvailability(quest, verified)]))
}

/** Completed trader quests proven by logs or by a mandatory prerequisite chain. */
export function completedQuestStats(quests: Quest[], availability: Map<string, TaskAvailability>) {
  const live = quests.filter((quest) => isLiveGameQuest(quest))
  const done = live.filter((quest) => availability.get(quest.id)?.status === 'completed')
  const kappa = live.filter((quest) => quest.kappa)
  const kappaDone = kappa.filter((quest) => availability.get(quest.id)?.status === 'completed')
  return { completed: done.length, total: live.length, kappaCompleted: kappaDone.length, kappaTotal: kappa.length }
}

export function isLiveGameQuest(quest: { id: string; kind?: string; storyChapterId?: string }) {
  return Boolean(quest.id) && !quest.id.startsWith('wiki:') && quest.kind !== 'story' && !quest.storyChapterId
}

export function isStoryQuest(quest: { kind?: string }) {
  return quest.kind === 'story'
}

export function isCurrentQuestStatus(status?: TaskProgressStatus) {
  return status === 'active'
}

export function isCurrentQuest(quest: { id: string; kind?: string }, status?: TaskProgressStatus) {
  if (quest.id.startsWith('wiki:')) return false
  return isCurrentQuestStatus(status)
}

export function isTrackedQuest(quest: { id: string }, progress: ModeProgress) {
  const record = progress.taskProgress[quest.id]
  return Boolean(record && TRACKED_SOURCES.has(record.source))
}

/** Current = accepted in the game (logged «задание принято») and not handed in or failed since. */
export function isCurrentTrackedQuest(quest: { id: string }, progress: ModeProgress) {
  const record = progress.taskProgress[quest.id]
  return record?.status === 'active' && TRACKED_SOURCES.has(record.source)
}

export function currentStoryStageIndex(quest: Quest, progress: ModeProgress) {
  const explicit = progress.taskProgress[quest.id]?.currentStageIndex
  if (typeof explicit === 'number' && explicit >= 0) return explicit
  return 0
}

function questRequirements(quest: Quest): TaskRequirement[] {
  if (quest.requirements?.length) return quest.requirements
  return (quest.previous ?? []).map((taskId) => ({
    taskId,
    allowedStatuses: ['complete'] as Array<'complete' | 'failed' | 'active'>,
  }))
}
