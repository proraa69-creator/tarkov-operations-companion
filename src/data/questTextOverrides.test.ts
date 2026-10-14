import { describe, expect, it } from 'vitest'
import type { AppDataset, MapMarker, Quest } from '../domain/types'
import { findQuestText, parseQuestTextOverrides, withQuestTextOverrides, type QuestTextOverride } from './questTextOverrides'

const trader: Quest = {
  id: 'q1', name: 'Посылка', trader: 'Прапор', description: 'Задание от торговца Прапор.', level: 1, kappa: false, rewards: [],
  objectives: ['Найти посылку', 'Сдать посылку'], objectiveIds: ['o1', 'o2'],
  objectiveDetails: [{ id: 'o1', type: 'visit', description: 'Найти посылку', count: 1 }, { id: 'o2', type: 'giveItem', description: 'Сдать посылку', count: 1 }],
}
const story: Quest = {
  id: 'story-tour', name: 'Тур', trader: 'Сюжет', kind: 'story', description: 'Сюжетная глава Escape from Tarkov.', level: 1, kappa: false, rewards: [], objectives: [],
  stages: [{ id: 's0', title: 'Начало', description: '', mapIds: ['customs'] }, { id: 's1', title: 'Маяк', description: 'Пройти к маяку', mapIds: ['lighthouse'] }],
}
const marker = (id: string, extra: Partial<MapMarker>): MapMarker => ({ id, mapId: 'customs', type: 'quest', layerId: 'quest.zone', title: 'Точка', position: [0, 0], description: 'старый текст', ...extra } as MapMarker)
const dataset = {
  quests: [trader, story],
  markers: [marker('m1', { questId: 'q1', objectiveId: 'o1' }), marker('m2', { questId: 'story-tour', stageIndex: 0, description: 'Начало' }), marker('m3', { questId: 'other' })],
} as unknown as AppDataset
const text = (field: QuestTextOverride['field'], target: string, value: string, lang: 'ru' | 'en' = 'ru', questId = 'q1'): QuestTextOverride => ({ id: `${questId}-${field}-${target}-${lang}`, questId, field, target, lang, text: value })

describe('quest texts corrected by the owner (owner, 13.10.2026: «в нижнем окне квеста могу редактировать описание»)', () => {
  it('reads only well-formed corrections from the server answer', () => {
    expect(parseQuestTextOverrides(null)).toEqual([])
    expect(parseQuestTextOverrides({ overrides: [
      { id: 'a', questId: 'q1', field: 'description', target: '', lang: 'ru', text: 'Описание' },
      { id: 'b', questId: 'q1', field: 'reward', target: '', lang: 'ru', text: 'x' },
      { id: 'c', questId: 'q1', field: 'description', target: '', lang: 'de', text: 'x' },
      { id: 'd', questId: 'q1', field: 'description', target: '', lang: 'ru', text: '' },
    ] }).map((entry) => entry.id)).toEqual(['a'])
  })

  it('keeps the very same dataset while nothing is corrected in this language', () => {
    expect(withQuestTextOverrides(dataset, [], 'ru')).toBe(dataset)
    expect(withQuestTextOverrides(dataset, [text('description', '', 'Find the parcel', 'en')], 'ru')).toBe(dataset)
  })

  it('a trader quest: the description, the objective line and that objective\'s map point', () => {
    const next = withQuestTextOverrides(dataset, [text('description', '', 'Прапор ждёт посылку.'), text('objective', 'o1', 'Найти посылку на заправке')], 'ru')
    const quest = next.quests.find((entry) => entry.id === 'q1')!
    expect(quest.description).toBe('Прапор ждёт посылку.')
    expect(quest.objectiveDetails!.map((objective) => objective.description)).toEqual(['Найти посылку на заправке', 'Сдать посылку'])
    expect(quest.objectives).toEqual(['Найти посылку на заправке', 'Сдать посылку'])
    expect(next.markers.find((entry) => entry.id === 'm1')!.description).toBe('Найти посылку на заправке')
    // Untouched quests and points stay the same objects.
    expect(next.quests.find((entry) => entry.id === 'story-tour')).toBe(story)
    expect(next.markers.find((entry) => entry.id === 'm3')).toBe(dataset.markers[2])
  })

  it('a story chapter: the stage title and task, and the stage\'s point shows the new text', () => {
    const next = withQuestTextOverrides(dataset, [text('stage-title', '0', 'Выход с базы', 'ru', 'story-tour'), text('stage-description', '0', 'Пройти к КПП', 'ru', 'story-tour')], 'ru')
    const quest = next.quests.find((entry) => entry.id === 'story-tour')!
    expect(quest.stages!.map((stage) => [stage.title, stage.description])).toEqual([['Выход с базы', 'Пройти к КПП'], ['Маяк', 'Пройти к маяку']])
    expect(next.markers.find((entry) => entry.id === 'm2')!.description).toBe('Пройти к КПП')
  })

  it('finds the correction of one field in one language', () => {
    const list = [text('description', '', 'A', 'en'), text('description', '', 'Б')]
    expect(findQuestText(list, 'q1', 'description', '', 'ru')?.text).toBe('Б')
    expect(findQuestText(list, 'q1', 'objective', 'o1', 'ru')).toBeUndefined()
  })
})
