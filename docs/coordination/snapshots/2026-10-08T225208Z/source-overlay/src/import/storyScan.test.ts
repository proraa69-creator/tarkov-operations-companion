import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { applyStoryScan, confirmStoryFrame, isStoryMenuText, matchStoryChapters } from './storyScan'

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
  it('does not attribute one objective pane to two chapters with shared wording', () => {
    const other = { ...tour, id: 'story-other', name: 'Другая история', ocrAliases: [] }
    const text = 'СЮЖЕТНЫЕ\nТур\nДругая история\nГлавные задачи\nВыбраться из Эпицентра'
    expect(matchStoryChapters(text, [tour, other]).filter(match => match.stageIndex != null)).toEqual([])
  })
  it('reads only story chapters from the story pane', () => {
    expect(isStoryMenuText(STORY_FRAME)).toBe(true)
    expect(matchStoryChapters(STORY_FRAME, QUESTS)).toMatchObject([{ questId: 'story-tour', stageIndex: 7 }])
    expect(matchStoryChapters(STORY_FRAME, QUESTS)[0]?.objectives?.length).toBeGreaterThan(1)
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

  function savedStage(index: number) {
    const progress = createModeProgress()
    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'active', source: 'screen-scan', currentStageIndex: index, updatedAt: '2026-09-26T00:00:00.000Z' }
    return progress
  }

  it('corrects the frozen tenth stage to stage one after two independent readings', () => {
    const text = 'СЮЖЕТНЫЕ\nТур\nАКТИВНО\nГлавные задачи\nВыбраться из Эпицентра\nОпциональные задачи\nПоговорить с Механиком'
    const matches = matchStoryChapters(text, QUESTS)
    const first = confirmStoryFrame(null, 'profile:pvp', 1000, matches)
    expect(first.confirmed).toEqual([])
    const second = confirmStoryFrame(first.state, 'profile:pvp', 2000, matches)
    const progress = savedStage(9)
    expect(applyStoryScan(progress, second.confirmed).taskProgress['story-tour'].currentStageIndex).toBe(0)
  })

  it('does not count a cached OCR reading as confirmation', () => {
    const first = confirmStoryFrame(null, 'profile:pvp', 1000, [{ questId: 'story-tour', stageIndex: 0 }])
    expect(confirmStoryFrame(first.state, 'profile:pvp', 1000, first.state!.matches).confirmed).toEqual([])
  })

  it('does not mix profile or mode confirmations', () => {
    const first = confirmStoryFrame(null, 'profile:pvp', 1000, [{ questId: 'story-tour', stageIndex: 0 }])
    expect(confirmStoryFrame(first.state, 'profile:pve', 2000, first.state!.matches).confirmed).toEqual([])
    expect(confirmStoryFrame(first.state, 'another:pvp', 2000, first.state!.matches).confirmed).toEqual([])
  })

  it('blocks a jump from stage one to ten even after repeated OCR', () => {
    const progress = savedStage(0)
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 9, stageConfirmed: true }])).toBe(progress)
  })

  it('publishes all visible tasks without declaring skipped stages completed', () => {
    const progress = savedStage(0)
    const matches = matchStoryChapters('СЮЖЕТНЫЕ\nТур\nГлавные задачи\nВыжить на локации Завод и выйти или посетить Завод 3 раза\nОпциональные задачи\nПосетить Завод\n0/3', QUESTS)
    const next = applyStoryScan(progress, matches)
    expect(next.taskProgress['story-tour'].currentStageIndex).toBe(0)
    expect(next.taskProgress['story-tour'].storyObjectives).toHaveLength(2)
    expect(next.taskProgress['story-tour'].storyObjectives?.[1]).toMatchObject({ optional: true, current: 0, total: 3, stageIndex: 10 })
    expect(applyStoryScan(next, matches)).toBe(next)
  })

  it('requires every skipped stage to be visibly complete', () => {
    const progress = savedStage(0)
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 3, completedStageIndexes: [0, 2] }])).toBe(progress)
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 3, completedStageIndexes: [0, 1, 2] }]).taskProgress['story-tour'].currentStageIndex).toBe(3)
  })

  it('accepts an independently confirmed adjacent active objective, but not an unconfirmed one', () => {
    const progress = savedStage(0)
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 1 }])).toBe(progress)
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 1, stageConfirmed: true }]).taskProgress['story-tour'].currentStageIndex).toBe(1)
  })

  it('keeps saved progress when only the chapter title is read', () => {
    const progress = savedStage(9)
    expect(applyStoryScan(progress, matchStoryChapters('СЮЖЕТНЫЕ\nТур\nАКТИВНО', QUESTS))).toBe(progress)
    const empty = createModeProgress()
    expect(applyStoryScan(empty, [{ questId: 'story-tour' }])).toBe(empty)
  })

  it('rejects stale updates and invalid stage numbers', () => {
    const progress = savedStage(9)
    expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex: 0 }], '2026-09-25T00:00:00.000Z')).toBe(progress)
    for (const stageIndex of [NaN, -1, 1.5]) expect(applyStoryScan(progress, [{ questId: 'story-tour', stageIndex }])).toBe(progress)
  })
})
