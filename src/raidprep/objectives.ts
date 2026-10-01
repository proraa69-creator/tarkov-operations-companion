import type { ModeProgress } from '../domain/types'

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
export function objectiveDone(progress: ModeProgress, questId: string, objectiveId: string | undefined): boolean {
  if (!objectiveId) return false
  const loose = progress as unknown as { objectiveProgress?: Record<string, unknown> }
  const record = progress.taskProgress[questId] as unknown as { objectives?: Record<string, unknown> } | undefined
  return isDone(loose.objectiveProgress?.[objectiveId]) || isDone(record?.objectives?.[objectiveId])
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
