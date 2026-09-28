import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { applyStoryScan, isStoryMenuText, matchStoryChapters } from './storyScan'

const STORY_FRAME = `г: |
ТОРИЯ > к A =: Е
ур = = т, . “ae Rae /
FQ
Лыжник знает какого-то cneya по оружию в районе завода. Такой контакт упускать нельзя. Но в обмен на информацию Лыжник
хочет, чтобы я помог собрать стройматериалы для восстановления одного из его складов.
FQ
зные задачи
[] Выжить на локации Таможня и выйти или посетить Таможню 3 раза
[] Передать Лыжнику предметы из категории Стройматериалы 6/5
Предметы должны быть со статусом "Найдено в рейде"
Предмет
иональные задачи
[-] Посетить Таможню os
CJ Найди в рейде предметы из категории Стройматериалы |8 2/5`

const TABLE_FRAME = `Класс Задание Локация Статус \\ Прогресс
По коням Эпицентр. ‘активно!
Снабженец Любая локация активно! 8%`

const tour = applyCuratedStoryStages([{
  id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false,
  description: '', objectives: [], rewards: [], stages: [],
}])[0]!

const traderQuest = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] })
const QUESTS = [tour, traderQuest('q-horses', 'По коням'), traderQuest('q-supplier', 'Снабженец')]

describe('story pane scan', () => {
  it('reads only story chapters from the story pane', () => {
    expect(isStoryMenuText(STORY_FRAME)).toBe(true)
    expect(matchStoryChapters(STORY_FRAME, QUESTS)).toEqual([{ questId: 'story-tour', stageIndex: 7 }])
  })

  it('ignores the trader quest table — those come from the logs', () => {
    expect(isStoryMenuText(TABLE_FRAME)).toBe(false)
    expect(matchStoryChapters(TABLE_FRAME, QUESTS)).toEqual([])
  })

  it('marks the chapter current at the scanned stage and keeps finished chapters finished', () => {
    const progress = createModeProgress()
    const next = applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 7 }], '2026-09-27T10:00:00.000Z')
    expect(next.taskProgress['story-tour']).toMatchObject({ status: 'active', source: 'screen-scan', currentStageIndex: 7 })
    expect(applyStoryScan(next, [{ questId: 'story-tour', stageIndex: 7 }])).toBe(next)

    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'completed', source: 'manual', updatedAt: '2026-09-26T00:00:00.000Z' }
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 2 }])).toBe(progress)
  })
})
