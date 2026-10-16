import type { Quest, TaskRequirement } from '../domain/types'

/** Only an explicit USEC/BEAR restriction counts; «Any» (or its translation) means everyone. */
export function questFaction(value: string | undefined): 'usec' | 'bear' | undefined {
  const key = value?.trim().toLowerCase() ?? ''
  if (/^(usec|юсек)$/.test(key)) return 'usec'
  if (/^(bear|беар|бир)$/.test(key)) return 'bear'
  return undefined
}

export function isLiveGameQuest(quest: { id: string; kind?: string; storyChapterId?: string }) {
  return Boolean(quest.id) && !quest.id.startsWith('wiki:') && quest.kind !== 'story' && !quest.storyChapterId
}

/**
 * The quest's prerequisites. A tarkov.dev task brings its own list, and an empty one means «none»: the wiki's «Предыдущий
 * квест» (filled into `previous` for such tasks) describes older chains — «Всей этой швали...» has no requirement in
 * tarkov.dev, but its wiki chain made 9 Jaeger quests «completed» for an account that had done 2. Only quests without
 * tarkov.dev data (wiki pages) use `previous`.
 */
export function questRequirements(quest: Pick<Quest, 'requirements' | 'previous'>): TaskRequirement[] {
  if (quest.requirements) return quest.requirements
  return (quest.previous ?? []).map((taskId) => ({
    taskId,
    allowedStatuses: ['complete'] as Array<'complete' | 'failed' | 'active'>,
  }))
}

/** A mandatory «complete this first» requirement (not one of a group of alternatives, not «taken» or «failed»). */
export const isCompletionOnly = (requirement: TaskRequirement) => !requirement.group && (requirement.allowedStatuses.length === 0 || requirement.allowedStatuses.every((status) => status === 'complete'))
