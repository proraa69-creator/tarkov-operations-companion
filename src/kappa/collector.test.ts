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
    expect(findVisibleItems(entries, 'Kiver-M Saury Can Топор Salewa')).toEqual(['axe'])
  })

  it('reads stash labels as OCR misreads them, but not the label of many items', () => {
    const catalog = [
      item('oil', 'Масло для бороды Deadlyslob\'s', 'Масло'), item('fire', 'Оружейная смазка #FireKlean', '#FireKlean'),
      item('slender', 'Маска Ночного Слендера', 'Маска'), item('half', 'Нижняя полумаска', 'Маска'), item('neo', 'Неопреновая маска', 'Маска'),
      item('raven', 'Статуэтка ворона', 'Ворон'), item('ravenkey', 'Ключ от убежища Ворона', 'Ворон'),
    ]
    const collector = [{ id: 'collector', name: 'Коллекционер', raidRequirements: ['oil', 'fire', 'slender', 'raven'].map((itemId) => ({ itemId, count: 1, purpose: 'handover', mapIds: [] })) }] as unknown as Quest[]
    const wanted = collectorEntries(collector, catalog)
    expect(wanted.find((entry) => entry.item.id === 'slender')?.ambiguous).toBe(true)
    expect(wanted.find((entry) => entry.item.id === 'raven')?.ambiguous).toBeUndefined()
    // «Macno»: Cyrillic read as Latin; «#FireKlea»: the label cut to its cell.
    expect(findVisibleItems(wanted, 'Macno\n#FireKlea\nВорон').sort()).toEqual(['fire', 'oil', 'raven'])
    // «Маска» on screen may be any of the masks; the full name in a tooltip is this one.
    expect(findVisibleItems(wanted, 'Маска')).toEqual([])
    expect(findVisibleItems(wanted, 'Маска Ночного Слендера')).toEqual(['slender'])
  })
})
