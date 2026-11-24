import type { ModeProgress, Quest } from '../domain/types'

type QuestRequirement = NonNullable<Quest['raidRequirements']>[number]

/** What a tick is read from; a caller with no objectives at hand reads none as done. */
export type ObjectiveMarks = Pick<ModeProgress, 'taskProgress'> & Partial<Pick<ModeProgress, 'objectiveProgress'>>

/** Short Russian verb per tarkov.dev objective type, for the briefing checklist. */
export const OBJECTIVE_TYPE_LABELS: Record<string, string> = {
  visit: 'Посетить',
  mark: 'Отметить',
  plantItem: 'Заложить',
  plantQuestItem: 'Заложить',
  findItem: 'Найти',
  findQuestItem: 'Найти',
  giveItem: 'Сдать',
  giveQuestItem: 'Сдать',
  shoot: 'Убить',
  extract: 'Выжить и выйти',
  buildWeapon: 'Собрать',
  useItem: 'Использовать',
  skill: 'Навык',
  traderLevel: 'Лояльность',
  traderStanding: 'Репутация',
  taskStatus: 'Задание',
  sellItem: 'Продать',
  experience: 'Опыт',
}

export function objectiveTypeLabel(type: string) {
  return OBJECTIVE_TYPE_LABELS[type] ?? ''
}

/**
 * Whether one objective is already done, when per-objective progress is tracked. The schema is being added
 * separately (objective-level sync), so both likely shapes are read and anything unknown counts as not done:
 * `progress.objectiveProgress[objectiveId]` or `progress.taskProgress[questId].objectives[objectiveId]`, holding
 * `true` or `{ completed | done | status: 'completed' | current ≥ target }`.
 */
export function objectiveDone(progress: ObjectiveMarks, questId: string, objectiveId: string | undefined): boolean {
  if (!objectiveId) return false
  const loose = progress as unknown as { objectiveProgress?: Record<string, unknown> }
  const record = progress.taskProgress[questId] as unknown as { objectives?: Record<string, unknown> } | undefined
  return isDone(loose.objectiveProgress?.[objectiveId]) || isDone(record?.objectives?.[objectiveId])
}

/**
 * What is left of an item to plant or mark: `count` is what the requirement asks for (at least one, as shared/raidNeeds.ts
 * reads it), and an objective ticked done or counted part of the way takes its share off.
 */
export function objectiveItemsLeft(progress: ModeProgress, questId: string, objectiveId: string | undefined, count: number): number {
  if (objectiveDone(progress, questId, objectiveId)) return 0
  const current = objectiveId ? progress.objectiveProgress?.[objectiveId]?.current : undefined
  return Math.max(0, Math.max(1, Math.round(count) || 1) - (current ?? 0))
}

/** The objectives a requirement belongs to: for a key, every one it opens. */
export function requirementObjectiveIds(requirement: Pick<QuestRequirement, 'objectiveId' | 'objectiveIds'>): string[] {
  return requirement.objectiveIds ?? (requirement.objectiveId ? [requirement.objectiveId] : [])
}

/**
 * A key is needed until every objective it opens is ticked (owner, 06.11.2026: «После того как ты отметил… что ты посетил
 * место рентгенолога он до сих пор требует ключ от этой комнаты»); a tick taken back brings it back. A key that names no
 * objective (a catalog of a server not updated yet) stays with its quest.
 */
export function keyUsed(progress: ObjectiveMarks, questId: string, requirement: Pick<QuestRequirement, 'objectiveId' | 'objectiveIds'>): boolean {
  const objectives = requirementObjectiveIds(requirement)
  return objectives.length > 0 && objectives.every((objectiveId) => objectiveDone(progress, questId, objectiveId))
}

/** The items of this quest that are only keys, all of them used. An item it also takes for anything else stays out of this. */
export function usedQuestKeys(quest: Pick<Quest, 'id' | 'raidRequirements'>, progress: ObjectiveMarks): ReadonlySet<string> {
  const rows = quest.raidRequirements ?? []
  const keys = rows.filter((row) => row.purpose === 'key').map((row) => row.itemId)
  return new Set(keys.filter((itemId) => rows.every((row) => row.itemId !== itemId || (row.purpose === 'key' && keyUsed(progress, quest.id, row)))))
}

/** The quest's plain list of items, without the keys already used. */
export function openRequiredItems(quest: Pick<Quest, 'id' | 'raidRequirements' | 'requiredItems'>, progress: ObjectiveMarks): string[] {
  const used = usedQuestKeys(quest, progress)
  return (quest.requiredItems ?? []).filter((itemId) => !used.has(itemId))
}

function isDone(value: unknown): boolean {
  if (value === true) return true
  if (!value || typeof value !== 'object') return false
  const entry = value as { completed?: unknown; done?: unknown; status?: unknown; current?: unknown; target?: unknown; count?: unknown }
  if (entry.completed === true || entry.done === true || entry.status === 'completed' || entry.status === 'complete') return true
  const target = typeof entry.target === 'number' ? entry.target : undefined
  const current = typeof entry.current === 'number' ? entry.current : typeof entry.count === 'number' ? entry.count : undefined
  return target != null && current != null && target > 0 && current >= target
}
