import { describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { collectorEntries, findCollectorQuest, findVisibleItems } from './collector'

const item = (id: string, name: string, shortName: string) => ({ id, name, shortName, category: 'Предмет', description: '', prices: [] }) as unknown as Item

const items = [item('axe', 'Старинный топор', 'Топор'), item('book', 'Потрёпанная старинная книга', 'Книга'), item('other', 'Патрон', '5.45')]
const quests = [
  { id: 'q1', name: 'Другой квест', raidRequirements: [{ itemId: 'other', count: 1, purpose: 'handover', mapIds: [] }] },
  { id: 'collector', name: 'Коллекционер', raidRequirements: [{ itemId: 'axe', count: 1, purpose: 'handover', mapIds: [] }, { itemId: 'book', count: 1, purpose: 'handover', mapIds: [] }] },
] as unknown as Quest[]

describe('collector items', () => {
  it('reads the Collector task items from the catalog', () => {
    expect(findCollectorQuest(quests)?.id).toBe('collector')
    expect(collectorEntries(quests, items).map((entry) => entry.item.id).sort()).toEqual(['axe', 'book'])
  })

  it('ticks only the wanted items that appear in the OCR text', () => {
    const entries = collectorEntries(quests, items)
    expect(findVisibleItems(entries, 'Схрон\nСтаринный топор\nПатрон')).toEqual(['axe'])
    expect(findVisibleItems(entries, '')).toEqual([])
  })
})
