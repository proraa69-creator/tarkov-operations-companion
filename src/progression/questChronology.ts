import type { Quest } from '../domain/types'

/**
 * Quests in the order the game hands them out: a quest never comes before one it requires.
 * Key = the highest «minimum level» along its prerequisite chain, then the chain depth, then the name.
 * Requirements on other traders' quests count too (they are looked up in `all`).
 */
export function sortQuestsChronologically(quests: Quest[], all: Quest[] = quests): Quest[] {
  const byId = new Map(all.map((quest) => [quest.id, quest]))
  const memo = new Map<string, { level: number; depth: number }>()
  const visiting = new Set<string>()
  const key = (quest: Quest): { level: number; depth: number } => {
    const known = memo.get(quest.id)
    if (known) return known
    // A broken (cyclic) chain must not recurse forever: the quest then counts on its own.
    if (visiting.has(quest.id)) return { level: quest.level, depth: 0 }
    visiting.add(quest.id)
    let level = quest.level
    let depth = 0
    for (const id of prerequisiteIds(quest)) {
      const previous = byId.get(id)
      if (!previous) continue
      const before = key(previous)
      level = Math.max(level, before.level)
      depth = Math.max(depth, before.depth + 1)
    }
    visiting.delete(quest.id)
    const result = { level, depth }
    memo.set(quest.id, result)
    return result
  }
  return [...quests].sort((left, right) => {
    const a = key(left)
    const b = key(right)
    return a.level - b.level || a.depth - b.depth || left.level - right.level || left.name.localeCompare(right.name, 'ru')
  })
}

/** Ids of the quests that must be done (or taken) before this one. */
export function prerequisiteIds(quest: Quest): string[] {
  const ids = quest.requirements?.length ? quest.requirements.map((requirement) => requirement.taskId) : quest.previous ?? []
  return [...new Set(ids.filter(Boolean))]
}

/** Quests that list this one as a prerequisite. */
export function followUpQuests(quest: Quest, all: Quest[]): Quest[] {
  return all.filter((entry) => entry.id !== quest.id && prerequisiteIds(entry).includes(quest.id))
}
