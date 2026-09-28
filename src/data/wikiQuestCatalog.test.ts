import { describe, expect, it } from 'vitest'
import { mergeWikiQuestCatalog } from './wikiQuestCatalog'

describe('wiki quest catalog merge', () => {
  it('attaches wiki pages to existing tasks and does not invent extra quests', () => {
    const merged = mergeWikiQuestCatalog([
      { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: [], rewards: [] },
    ], ['Дебют', 'Ищейка', 'Категория:Квесты'])
    expect(merged.find((quest) => quest.id === 'debut')?.wikiLink).toContain(encodeURIComponent('Дебют'))
    expect(merged.find((quest) => quest.name === 'Ищейка')).toBeUndefined()
    expect(merged).toHaveLength(1)
  })
})
