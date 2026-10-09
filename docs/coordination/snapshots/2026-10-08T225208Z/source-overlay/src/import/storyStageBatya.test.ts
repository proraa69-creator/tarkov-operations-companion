import { describe, expect, it } from 'vitest'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'
import { inferStoryStageIndex } from './storyStageOcr'
import { matchStoryChapters } from './storyScan'
import type { Quest } from '../domain/types'

const batya = applyCuratedStoryStages([{ id: 'story-batya', kind: 'story', name: 'Батя', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [], stages: [] } as Quest])[0]!

const screens: Array<[string, string, number]> = [
  ['actual game wording from the user screenshot', 'СЮЖЕТНЫЕ\nБатя\nГлавные задачи\nУзнать у торговцев больше о Богатырях\nОпциональные задачи\nНайти личные вещи командира отряда\nНайти памятный предмет одного из Богатырей\nНайти личный предмет Богатырей\nНайти жетон одного из Богатырей', 1],
  ['stage 2 alone', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nУзнать у торговцев больше об отряде «Богатыри»', 1],
  ['stage 2 with done stage 1', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nНайти следы спецотряда BEAR\nВыполнено\nУзнать у торговцев больше об отряде «Богатыри»\nОпциональные задачи\nНайти и забрать шеврон отряда «Богатыри»', 1],
  ['stage 4', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nНайти больше информации об отряде «Богатыри»\nОпциональные задачи\nНайти и забрать памятную вещь одного из богатырей', 3],
  ['stage 1', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nНайти следы спецотряда BEAR\nОпциональные задачи\nНайти и забрать шеврон отряда «Богатыри»', 0],
  ['stage 9 Voevoda', 'СЮЖЕТНЫЕ\nБатя\nГлавные задачи\nУзнать больше о Воеводе', 8],
  ['stage 18', 'СЮЖЕТНЫЕ\nБатя\nГлавные задачи\nДобыть больше информации об отряде «Богатыри»', 17],
]

describe('Batya stages', () => {
  it('reads the real OCR screenshot without jumping to a later stage', () => {
    const text = `А СЮЖЕТНЫЕ 9 ПОБОЧНЫЕ
ИСТОРИЯ
Батя
Я нашёл патч с надписью «Богатыри», явно изготовленный на заказ.
Главные задачи
ГО Узнать у торговцев больше о Богатырях
Предметы для заданий в схроне
Опциональные задачи Ra
[С] Найти личные вещи командира отряда
[С] Найти памятный предмет одного из Богатырей
[С] Найти личный предмет Богатырей
[О] Найти жетон одного из Богатырей
Связанные предметы`
    expect(matchStoryChapters(text, [batya])).toMatchObject([{ questId: 'story-batya', stageIndex: 1 }])
    expect(matchStoryChapters(text, [batya])[0]?.objectives?.[0]).toMatchObject({ text: 'Узнать у торговцев больше о Богатырях', optional: false })
  })
  for (const [name, text, expected] of screens) {
    it(name, () => {
      expect(inferStoryStageIndex(text, batya)).toBe(expected)
      expect(matchQuestsFromOcr(text, [batya])[0]?.stageIndex).toBe(expected)
    })
  }
})
