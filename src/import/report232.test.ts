import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { RU_TABLE_QUESTS, RU_TASKS_TABLE } from './__fixtures__/russianTasksTable'
import { ENGLISH_STORY_BATYA, ENGLISH_STORY_TOUR, ENGLISH_TASKS_SIDE } from './__fixtures__/englishGameOcr'
import { PVP_FALLING_SKIES } from './__fixtures__/storyPanesPvp'
import { isStoryPaneOcr, isStoryTitleText } from './storyPaneLayout'
import { isStoryMenuText, tasksScreenKind } from './storyScan'
import { isTasksTableText } from './tasksTableText'
import { matchQuestsFromOcr } from './questOcr'
import { tableMatches } from './screenScanSync'

/**
 * Report 232 (25.11.2026, 0.6.0.343, the Russian game, Season): «Нажал кнопку — найти квесты с экрана. Перешёл персонаж →
 * задания → побочные, и он не отсканировал ни одного задания». The player's list holds a quest on Labs: its row says
 * «Лаборатория», and «…тория» was the story pane's clipped «ИСТОРИЯ». With the «СЮЖЕТНЫЕ» tab on every Tasks screen the
 * frame passed for a story pane, the main process read the pane's parts, and the scanner threw the whole table away.
 */
const LABS_ROW = 'Лабораторный допуск Лаборатория активно! 0%'
const TABLE = RU_TASKS_TABLE.replace('Класс Задание Локация Статус \\ Прогресс\n', `Класс Задание Локация Статус \\ Прогресс\n${LABS_ROW}\n`)
const quests = [...RU_TABLE_QUESTS, ['q-labs', 'Лабораторный допуск'] as [string, string]]
  .map(([id, name]) => ({ id, name, trader: 'Терапевт', level: 1, kappa: false, description: '', objectives: [], rewards: [] } as Quest))

describe('report 232: «Лаборатория» is no story header', () => {
  it('reads «ИСТОРИЯ» and its clipped forms as the header, never a word that only ends like it', () => {
    for (const header of ['ИСТОРИЯ', '> ИСТОРИЯ >. a.', 'ТОРИЯ', 'СТОРИЯ', 'История', 'CHAPTER', 'СНАРТЕВ']) expect(isStoryTitleText(header)).toBe(true)
    for (const word of ['Лаборатория', 'Лабораторный допуск Лаборатория', 'Чужая территория', 'траектория']) expect(isStoryTitleText(word)).toBe(false)
  })

  it('does not take «Побочные» with a row on Labs for the story pane', () => {
    expect(isStoryPaneOcr(TABLE)).toBe(false)
    expect(isStoryMenuText(TABLE)).toBe(true) // the «СЮЖЕТНЫЕ» tab is on every Tasks screen; the rows decide (tasksScreenKind)
    expect(isTasksTableText(TABLE)).toBe(true)
    expect(tasksScreenKind(TABLE)).toBe('table')
  })

  it('keeps the table a table even when story parts came with it, and every row is found, the Labs one too', () => {
    const story = { title: 'Лабораторный допуск Лаборатория', status: 'активно!', body: 'По коням Эпицентр активно!' }
    expect(tasksScreenKind(TABLE, story)).toBe('table')
    for (const language of ['en', 'ru'] as const) {
      const ids = tableMatches(TABLE, matchQuestsFromOcr(TABLE, quests, { language })).map((match) => match.questId)
      expect(new Set(ids)).toEqual(new Set(quests.map((quest) => quest.id)))
    }
  })

  it('still tells the real story panes (Russian and English) from the table', () => {
    const pane = (text: string) => ({ title: text, status: '', body: text })
    for (const screen of [ENGLISH_STORY_TOUR.screen, ENGLISH_STORY_BATYA.screen]) {
      expect(isStoryPaneOcr(screen)).toBe(true)
      expect(isTasksTableText(screen)).toBe(false)
      expect(tasksScreenKind(screen, pane(screen))).toBe('story')
    }
    expect(isStoryPaneOcr(PVP_FALLING_SKIES)).toBe(true)
    expect(isTasksTableText(PVP_FALLING_SKIES)).toBe(false)
    expect(tasksScreenKind(PVP_FALLING_SKIES, pane(PVP_FALLING_SKIES))).toBe('story')
    expect(isTasksTableText(ENGLISH_TASKS_SIDE)).toBe(true)
  })
})

describe('report 232: the default «en» does not stop the Russian game', () => {
  it('finds the same quests on the Russian table whether the game language is English or Russian', () => {
    const read = (language: 'en' | 'ru') => tableMatches(RU_TASKS_TABLE, matchQuestsFromOcr(RU_TASKS_TABLE, quests, { language })).map((match) => `${match.questId}:${match.status}`).sort()
    expect(read('en')).toEqual(read('ru'))
    expect(read('en')).toHaveLength(RU_TABLE_QUESTS.length)
  })
})
