import type { Quest } from '../domain/types'
import { isLiveGameQuest, type TaskAvailability } from '../progression/requirementEngine'

/**
 * The four key tasks Fence wants before he hands out «Коллекционер» (the owner's list, 2026-10-08). Matched by the
 * catalog's `normalizedName`, which does not change with the language. «Реагент. Часть 4» has two alternatives: any one
 * of the three closes the step.
 */
export const COLLECTOR_KEY_TASKS: ReadonlyArray<{ key: string; name: string; trader: string; alternatives: string[] }> = [
  { key: 'chemical-part-4', name: 'Реагент. Часть 4', trader: 'Лыжник', alternatives: ['chemical-part-4', 'big-customer', 'out-of-curiosity'] },
  { key: 'shooter-born-in-heaven', name: 'Стрелок от бога', trader: 'Механик', alternatives: ['shooter-born-in-heaven'] },
  { key: 'the-tarkov-shooter-part-4', name: 'Тарковский стрелок. Часть 4', trader: 'Егерь', alternatives: ['the-tarkov-shooter-part-4'] },
  { key: 'sew-it-good-part-4', name: 'Шить — не тужить. Часть 4', trader: 'Барахольщик', alternatives: ['sew-it-good-part-4'] },
]

export type CollectorTaskState = 'completed' | 'active' | 'open'

export interface CollectorTaskRow {
  key: string
  /** Catalog name of the main task (the owner's name when the catalog has no such task). */
  name: string
  trader: string
  state: CollectorTaskState
  /** The catalog task the row opens: the alternative that closed the step, else the main task. */
  quest?: Quest
  /** Alternatives of the main task, for «или …». */
  alternatives: Quest[]
}

/** The four key tasks with their state in this profile: done, accepted, or not yet. */
export function collectorKeyTasks(quests: Quest[], availability: Map<string, TaskAvailability>): CollectorTaskRow[] {
  const byName = new Map(quests.filter(isLiveGameQuest).filter((quest) => quest.normalizedName).map((quest) => [quest.normalizedName!, quest]))
  return COLLECTOR_KEY_TASKS.map((task) => {
    const found = task.alternatives.flatMap((name) => byName.get(name) ?? [])
    const main = byName.get(task.key)
    const status = (quest: Quest) => availability.get(quest.id)?.status
    const done = found.find((quest) => status(quest) === 'completed')
    const active = found.find((quest) => status(quest) === 'active')
    return {
      key: task.key,
      name: main?.name ?? task.name,
      trader: main?.trader ?? task.trader,
      state: done ? 'completed' : active ? 'active' : 'open',
      quest: done ?? active ?? main,
      alternatives: found.filter((quest) => quest !== main),
    }
  })
}
