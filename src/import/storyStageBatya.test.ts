import { describe, expect, it } from 'vitest'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'
import { inferStoryStageIndex } from './storyStageOcr'
import type { Quest } from '../domain/types'

const batya = applyCuratedStoryStages([{ id: 'story-batya', kind: 'story', name: 'Батя', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [], stages: [] } as Quest])[0]!

const screens: Array<[string, string, number]> = [
  ['stage 2 alone', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nУзнать у торговцев больше об отряде «Богатыри»', 1],
  ['stage 2 with done stage 1', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nНайти следы спецотряда BEAR\nВыполнено\nУзнать у торговцев больше об отряде «Богатыри»\nОпциональные задачи\nНайти и забрать шеврон отряда «Богатыри»', 1],
  ['stage 4', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nНайти больше информации об отряде «Богатыри»\nОпциональные задачи\nНайти и забрать памятную вещь одного из богатырей', 3],
  ['stage 1', 'СЮЖЕТНЫЕ\nБатя\nАКТИВНО\nГлавные задачи\nНайти следы спецотряда BEAR\nОпциональные задачи\nНайти и забрать шеврон отряда «Богатыри»', 0],
  ['stage 9 Voevoda', 'СЮЖЕТНЫЕ\nБатя\nГлавные задачи\nУзнать больше о Воеводе', 8],
  ['stage 18', 'СЮЖЕТНЫЕ\nБатя\nГлавные задачи\nДобыть больше информации об отряде «Богатыри»', 17],
]

describe('Batya stages', () => {
  for (const [name, text, expected] of screens) {
    it(name, () => {
      expect(inferStoryStageIndex(text, batya)).toBe(expected)
      expect(matchQuestsFromOcr(text, [batya])[0]?.stageIndex).toBe(expected)
    })
  }
})
