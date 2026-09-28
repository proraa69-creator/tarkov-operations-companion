import type { Quest, Item } from '../domain/types'

export interface KappaItemRequirement {
  itemId: string
  itemName: string
  quests: string[]
  count: number
}

export function getKappaQuestRequirements(
  quests: Quest[],
  allItems: Item[],
): Map<string, KappaItemRequirement> {
  const items = new Map<string, KappaItemRequirement>()

  const kappaQuests = quests.filter((q) => q.kappa)

  kappaQuests.forEach((quest) => {
    if (!quest.objectiveIds) return

    quest.objectiveIds.forEach((itemId: string) => {
      const item = allItems.find((i) => i.id === itemId)
      if (!item) return

      const key = itemId
      const existing = items.get(key)
      if (existing) {
        existing.quests.push(quest.name)
        existing.count += 1
      } else {
        items.set(key, {
          itemId,
          itemName: item.name,
          quests: [quest.name],
          count: 1,
        })
      }
    })
  })

  return items
}

export function getIncompleteKappaItems(
  quests: Quest[],
  allItems: Item[],
  completedQuestIds: Set<string>,
): Map<string, KappaItemRequirement> {
  const allItems_ = getKappaQuestRequirements(quests, allItems)
  const result = new Map<string, KappaItemRequirement>()

  const kappaQuests = quests.filter((q) => q.kappa && !completedQuestIds.has(q.id))
  const incompleteQuestIds = new Set(kappaQuests.map((q) => q.id))

  allItems_.forEach((item) => {
    const relevantQuests = item.quests.filter((questName) => {
      const quest = quests.find((q) => q.name === questName)
      return quest && incompleteQuestIds.has(quest.id)
    })

    if (relevantQuests.length > 0) {
      result.set(item.itemId, {
        ...item,
        quests: relevantQuests,
      })
    }
  })

  return result
}
