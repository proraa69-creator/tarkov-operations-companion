import type { Item, Quest } from '../domain/types'

/**
 * The quest items of a quest, one row each, with what the quest has done with it (report 162, owner 15.11.2026: «А где картинки
 * жестких дисков? Есть квесты, где есть картинки жестких дисков, которые нужно забрать, поднять… И не только флешки»):
 * «Поднять и заложить», «Найти и передать», «Заложить», «Найти», «Передать». Not sold: no flea link.
 */
export interface QuestItemRow { item: Item; action: string }

export function questItemRows(quest: Pick<Quest, 'raidRequirements'>, questItems: readonly Item[] = []): QuestItemRow[] {
  const byId = new Map(questItems.map((item) => [item.id, item]))
  const purposes = new Map<string, Set<string>>()
  for (const need of quest.raidRequirements ?? []) {
    if (!need.questItem) continue
    const own = purposes.get(need.itemId) ?? new Set<string>()
    own.add(need.purpose)
    purposes.set(need.itemId, own)
  }
  return [...purposes].flatMap(([itemId, kinds]) => {
    const item = byId.get(itemId)
    if (!item) return []
    const action = kinds.has('find') && kinds.has('place') ? 'Поднять и заложить'
      : kinds.has('find') && kinds.has('handover') ? 'Найти и передать'
        : kinds.has('place') ? 'Заложить' : kinds.has('find') ? 'Найти' : 'Передать'
    return [{ item, action }]
  })
}
