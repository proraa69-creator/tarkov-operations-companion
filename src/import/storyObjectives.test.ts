import { describe, expect, it } from 'vitest'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { createModeProgress } from '../domain/progress'
import type { Quest } from '../domain/types'
import { readStoryObjectives } from './storyObjectives'
import { storyObjectiveMapLinks, visibleStoryObjectives } from '../progression/storyObjectives'

const quest = applyCuratedStoryStages([{ id: 'story-tour', kind: 'story', name: 'Тур', trader: 'История', level: 1,
  kappa: false, description: '', objectives: [], rewards: [] } as Quest])[0]!

describe('visible story objectives', () => {
  it('keeps multiple main and optional tasks and their individual counters', () => {
    const objectives = readStoryObjectives('Тур\nГлавные задачи\n[] Выбраться из Эпицентра\n[] Поговорить с Терапевтом\nОпциональные задачи\n[-] Посетить Завод\n0/3\nНайти новый предмет\nСвязанные предметы\nНайти несуществующий предмет', quest)
    expect(objectives).toHaveLength(4)
    expect(objectives[0]).toMatchObject({ text: 'Выбраться из Эпицентра', stageIndex: 0, optional: false })
    expect(objectives[2]).toMatchObject({ text: 'Посетить Завод', current: 0, total: 3, optional: true, stageIndex: 10 })
    expect(storyObjectiveMapLinks(quest, objectives[3]!)).toEqual([])
  })
  it('joins wrapped text but not two separate objectives', () => {
    const objectives = readStoryObjectives('Главные задачи\nВыжить на локации Завод и выйти или\nпосетить Завод 3 раза\nПередать Механику 2 предмета из категории Оружие', quest)
    expect(objectives).toHaveLength(2)
    expect(objectives[0]?.text).toBe('Выжить на локации Завод и выйти или посетить Завод 3 раза')
  })
  it('does not use sidebar or description text as current tasks', () => {
    expect(readStoryObjectives('СЮЖЕТНЫЕ\nТур\nНайти оружие\nБатя', quest)).toEqual([])
  })
  it('does not expose catalogue stage guesses as observed tasks', () => {
    const progress = createModeProgress()
    progress.taskProgress[quest.id] = { taskId: quest.id, source: 'screen-scan', status: 'active', currentStageIndex: 10, updatedAt: '' }
    expect(visibleStoryObjectives(quest, progress)).toEqual([])
  })
  it('returns a link for every map of a matched objective and none for completed tasks', () => {
    const multi = { ...quest, stages: [{ id: 's', title: 'Найти документы', description: '', mapIds: ['woods', 'customs'] }] }
    const objective = { id: 'main:test', text: 'Найти документы', optional: false, completed: false, stageIndex: 0 }
    expect(storyObjectiveMapLinks(multi, objective).map(link => link.to)).toEqual([
      '/maps/woods?quest=story-tour&stage=0', '/maps/customs?quest=story-tour&stage=0',
    ])
    expect(storyObjectiveMapLinks(multi, { ...objective, completed: true })).toEqual([])
  })
  it('does not append game footer text to the optional task in the real Tour screenshot', () => {
    const quest: Quest = { id: 'story-tour', name: 'Тур', kind: 'story', trader: '', level: 1, kappa: false, description: '', objectives: [], rewards: [], stages: [
      { id: 'factory', title: 'Посетить Завод', description: '', mapIds: ['factory'] },
    ] }
    const result = readStoryObjectives(`Тур
Главные задачи
[О] Выжить на локации Завод и выйти или посетить Завод 3 раза
Предметы для заданий в схроне
Опциональные задачи -
[С] Посетить Завод 6/3 9 |
Rarity
1.2.0.0.47888 20
= ГЛАВНОЕ МЕНЮ УБЕЖИЩЕ ТОРГОВЦЫ БАРАХОЛКА`, quest)
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ text: 'Посетить Завод', optional: true, completed: false, stageIndex: 0 })
    expect(result[1]?.current).toBeUndefined()
    expect(result.every(row => !/Rarity|ГЛАВНОЕ МЕНЮ/.test(row.text))).toBe(true)
  })
})

// Owner, 15.10.2026 («Тур», PvP): «читает не коректно описание квеста» — «там лишние буквы вв ws предмет GYWTLO | PVP S |».
// The game: main «Выжить на локации Таможня и выйти или посетить Таможню 3 раза», optional «Посетить Таможню» 1/3.
describe('the «Тур» objectives with the owner\'s junk tokens (images/162)', () => {
  const MAIN = 'Выжить на локации Таможня и выйти или посетить Таможню 3 раза'
  const panes = {
    'counter at the end': `Главные задачи\n[С] ${MAIN}\n'Опциснальные задачи\nCD Посетить Таможню вв ws Предмет: GYWTLO | PVP S | 1/3\n`,
    'counter glued to the bar': `Главные задачи\n[С] выжить на локации Таможня и выйти или посетить Таможню 3 раза\nОпционапьные задачи\nО Посетить Таможню вв ws Предмет: GYWTLO | PVP S |1/3\n`,
    'heading read right': `Главные задачи\n[С] ${MAIN}\nОпциональные задачи\n[С] Посетить Таможню вв ws Предмет: GYWTLO | PVP S | 1/3\n`,
  }
  for (const [variant, pane] of Object.entries(panes)) {
    it(`(${variant}): the optional objective is optional, «1/3» a counter, no junk in the text`, () => {
      const objectives = readStoryObjectives(pane, quest)
      expect(objectives.map(({ text, optional, current, total, stageIndex }) => ({ text, optional, current, total, stageIndex }))).toEqual([
        { text: MAIN, optional: false, current: undefined, total: undefined, stageIndex: 7 },
        { text: 'Посетить Таможню', optional: true, current: 1, total: 3, stageIndex: 7 },
      ])
      const words = objectives.flatMap((objective) => objective.text.split(/\s+/))
      for (const junk of ['вв', 'ws', 'Предмет:', 'GYWTLO', '|', 'PVP', 'S', '|1/3', '1/3']) expect(words).not.toContain(junk)
    })
  }

  it('an objective the catalog does not know loses the same junk', () => {
    const [objective] = readStoryObjectives('Главные задачи\n[С] Осмотреть новый склад у моста вв ws Предмет: GYWTLO | PVP S | 1/3\n', quest)
    expect(objective).toMatchObject({ text: 'Осмотреть новый склад у моста', optional: false, current: 1, total: 3 })
  })

  it('a saved objective of an older version is shown cleaned', () => {
    const progress = createModeProgress()
    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-10-15T10:00:00.000Z', currentStageIndex: 7,
      storyObjectives: [{ id: 'main:x', text: 'Посетить Таможню вв ws Предмет: GYWTLO | PVP S |', optional: false, completed: false }] }
    expect(visibleStoryObjectives(quest, progress).map((objective) => objective.text)).toEqual(['Посетить Таможню'])
  })
})
