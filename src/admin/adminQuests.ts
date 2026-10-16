import type { MapMarker, Quest } from '../domain/types'

/** «Админ панель» → «Квесты» (src/admin/AdminQuestsSection.tsx): finding a quest and the way into the map constructor. */
const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Quests whose name (RU or the EN slug) or id contains the text, the ones starting with it first. */
export function findQuests(quests: readonly Quest[], text: string, limit = 12): Quest[] {
  const query = normalize(text)
  if (query.length < 2) return []
  return quests
    .filter((quest) => normalize(quest.name).includes(query) || normalize(quest.normalizedName ?? '').includes(query) || quest.id.toLowerCase() === query)
    .sort((a, b) => Number(normalize(b.name).startsWith(query)) - Number(normalize(a.name).startsWith(query)) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit)
}

/** The map a quest opens on in the constructor: its own, else the one with most of its points. */
export function constructorMapOf(quest: Pick<Quest, 'id' | 'mapId' | 'mapIds'> | undefined, markers: readonly MapMarker[], questId = quest?.id) {
  if (quest?.mapId) return quest.mapId
  if (quest?.mapIds?.length) return quest.mapIds[0]
  const counts = new Map<string, number>()
  for (const marker of markers) if (marker.questId === questId) counts.set(marker.mapId, (counts.get(marker.mapId) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** The constructor on the map, on one quest (as «Заявки» → «Открыть в конструкторе») or on none. */
export const constructorUrl = (questId?: string, mapId?: string) => (questId
  ? `${mapId ? `/maps/${mapId}` : '/maps'}?quest=${encodeURIComponent(questId)}&edit=1`
  : '/maps?edit=1')

interface EditedQuest { questId: string; points: number; texts: number; requirements: number; updatedAt: string }

/** The owner's corrections per quest (points, texts, requirements), the latest first. */
export function editedQuests(points: ReadonlyArray<{ questId: string; updatedAt?: string }>, texts: ReadonlyArray<{ questId: string; updatedAt?: string }>, requirements: ReadonlyArray<{ questId: string; updatedAt?: string }>): EditedQuest[] {
  const byQuest = new Map<string, EditedQuest>()
  const add = (entries: ReadonlyArray<{ questId: string; updatedAt?: string }>, field: 'points' | 'texts' | 'requirements') => {
    for (const entry of entries) {
      const row = byQuest.get(entry.questId) ?? { questId: entry.questId, points: 0, texts: 0, requirements: 0, updatedAt: '' }
      row[field] += 1
      if ((entry.updatedAt ?? '') > row.updatedAt) row.updatedAt = entry.updatedAt ?? ''
      byQuest.set(entry.questId, row)
    }
  }
  add(points, 'points')
  add(texts, 'texts')
  add(requirements, 'requirements')
  return [...byQuest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.questId.localeCompare(b.questId))
}
