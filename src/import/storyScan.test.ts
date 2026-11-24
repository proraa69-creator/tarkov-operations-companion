import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { applyStoryScan, confirmStoryFrame, isStoryMenuText, matchStoryChapters, tasksScreenKind } from './storyScan'
import { matchQuestsFromOcr } from './questOcr'
import { tableRowCount } from './screenScanSync'
import { RU_TABLE_QUESTS, RU_TASKS_TABLE } from './__fixtures__/russianTasksTable'
import { TOUR_FULL_SCREEN } from './__fixtures__/storyPaneOcrTour'
import { PVP_BATYA, PVP_TOUR } from './__fixtures__/storyPanesPvp'
import { ENGLISH_MODE_SELECT, ENGLISH_STORY_TOUR, ENGLISH_TASKS_SIDE, ENGLISH_TRADER_TASKS, ENGLISH_TRADERS } from './__fixtures__/englishGameOcr'

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

  // A 21:9 player's «Синий Огонь» (31.10.2026): the game says «Найти обломок устройства», our text «фрагмент».
  it('reads the stage of «Синий огонь» in the game\'s own wording', () => {
    const blueFire = applyCuratedStoryStages([{
      id: 'story-blue-fire', normalizedName: 'blue-fire', kind: 'story', name: 'Синий огонь', trader: 'Глава истории', level: 1, kappa: false,
      description: '', objectives: [], rewards: [], stages: [],
    }])[0]!
    const pane = { title: 'ИСТОРИЯ\nСиний Огонь', status: 'АКТИВНО', body: 'Главные задачи\nНайти обломок устройства\nОбломок устройства могли утащить Дикие или сектанты' }
    expect(matchStoryChapters('', [blueFire], pane)).toMatchObject([{ questId: 'story-blue-fire', stageIndex: 1, active: true }])
  })

  // Owner, 31.10.2026: «попробуй определять по названиям» — the game's wording from the Russian wiki (storyGameWording.ts).
  it('reads stages of other chapters in the game\'s wording too', () => {
    const chapter = (id: string, name: string) => applyCuratedStoryStages([{
      id: `story-${id}`, normalizedName: id, kind: 'story', name, trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [], stages: [],
    }])[0]!
    const skies = chapter('falling-skies', 'Небеса в огне')
    const pane = (title: string, objective: string) => ({ title: `ИСТОРИЯ\n${title}`, status: 'АКТИВНО', body: `Главные задачи\n${objective}` })
    expect(matchStoryChapters('', [skies], pane('Небеса в огне', 'Найти флешку в одном из внедорожников Gelandewagen'))).toMatchObject([{ questId: 'story-falling-skies', stageIndex: 4 }])
    const unheard = chapter('the-unheard', 'Неизвестные')
    expect(matchStoryChapters('', [unheard], pane('Неизвестные', 'Найти служебный автомобиль Ржевского и его личные вещи'))).toMatchObject([{ questId: 'story-the-unheard', stageIndex: 4 }])
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

describe('which Tasks screen a frame shows, by its structure (audit P1)', () => {
  const rows = RU_TABLE_QUESTS.map(([id, name]) => traderQuest(id, name))

  it('the Russian table is the table even when the dimmed «СЮЖЕТНЫЕ» tab is read', () => {
    // The tab alone made it a story frame before: the rows on it were never applied.
    expect(isStoryMenuText(RU_TASKS_TABLE)).toBe(true)
    expect(tableRowCount(RU_TASKS_TABLE)).toBe(9)
    expect(tasksScreenKind(RU_TASKS_TABLE)).toBe('table')
    expect(matchQuestsFromOcr(RU_TASKS_TABLE, [...rows, tour]).map((match) => match.questId).sort()).toEqual(RU_TABLE_QUESTS.map(([id]) => id).sort())
  })

  it('the story pane stays the story pane: by its parts, its header or its objective blocks', () => {
    for (const text of [TOUR_FULL_SCREEN, PVP_TOUR, PVP_BATYA, ENGLISH_STORY_TOUR.screen]) {
      expect(tableRowCount(text)).toBeLessThan(2)
      expect(tasksScreenKind(text)).toBe('story')
    }
    expect(tasksScreenKind('', ENGLISH_STORY_TOUR.parts)).toBe('story')
  })

  it('the English side table is the table; other screens are none of them', () => {
    expect(tasksScreenKind(ENGLISH_TASKS_SIDE)).toBe('table')
    for (const text of [ENGLISH_MODE_SELECT, ENGLISH_TRADERS, ENGLISH_TRADER_TASKS, 'ГЛАВНОЕ МЕНЮ\nУБЕЖИЩЕ']) expect(tasksScreenKind(text)).toBeNull()
  })
})
