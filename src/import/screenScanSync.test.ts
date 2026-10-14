import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { applyScreenScanProgress, isTasksMenuText, shouldApplyQuestScan, tableMatches } from './screenScanSync'
import { matchQuestsFromOcr } from './questOcr'
import { tasksScreenKind } from './storyScan'
import { ENGLISH_TABLE_QUESTS } from './__fixtures__/englishGameOcr'

const debut: Quest = { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: '', objectives: [], rewards: [] }
const checking: Quest = {
  id: 'checking', name: 'Проверка', trader: 'Прапор', level: 2, kappa: true,
  description: '', objectives: [], rewards: [], previous: ['debut'],
}
const parallel: Quest = {
  id: 'side', name: 'Рядом', trader: 'Прапор', level: 2, kappa: false,
  description: '', objectives: [], rewards: [],
  requirements: [{ taskId: 'debut', allowedStatuses: ['active', 'complete'] }],
}

describe('screen scan sync after turn-in', () => {
  it('detects the Tasks menu and ignores raid HUD noise', () => {
    expect(isTasksMenuText('ЗАДАНИЯ\nПОБОЧНЫЕ\nВитамины Любая локация активно!')).toBe(true)
    expect(shouldApplyQuestScan('ЗАДАНИЯ ПОБОЧНЫЕ активно!', 1)).toBe(true)
    expect(shouldApplyQuestScan('убить 3 scav\nвыход', 0)).toBe(false)
    expect(shouldApplyQuestScan('сдать задание\nнаграда', 1)).toBe(false)
  })

  it('moves the turned-in quest out of current when the next one appears', () => {
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'checking' }], [debut, checking], { previousSeenIds: ['debut'] })
    expect(next.taskProgress.debut?.status).toBe('completed')
    expect(next.taskProgress.checking?.status).toBe('active')
  })

  it('keeps the previous quest current if it is still on the same Tasks screen', () => {
    const progress = createModeProgress()
    const next = applyScreenScanProgress(progress, [{ questId: 'debut' }, { questId: 'checking' }], [debut, checking])
    expect(next.taskProgress.debut?.status).toBe('active')
    expect(next.taskProgress.checking?.status).toBe('active')
  })

  it('keeps other story chapters when only one detail pane is visible', () => {
    const tour: Quest = { id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
    const maze: Quest = { id: 'story-labyrinth', kind: 'story', name: 'Лабиринт', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
    const progress = createModeProgress()
    progress.taskProgress['story-labyrinth'] = { taskId: 'story-labyrinth', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z', currentStageIndex: 5 }
    const next = applyScreenScanProgress(progress, [{ questId: 'story-tour', stageIndex: 4 }], [tour, maze])
    expect(next.taskProgress['story-tour']?.status).toBe('active')
    expect(next.taskProgress['story-tour']?.currentStageIndex).toBe(4)
    expect(next.taskProgress['story-labyrinth']).toBe(progress.taskProgress['story-labyrinth'])
  })

  it('does not wipe trader currents when only a story chapter is scanned', () => {
    const tour: Quest = { id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'story-tour', stageIndex: 4 }], [debut, tour])
    expect(next.taskProgress.debut?.status).toBe('active')
    expect(next.taskProgress['story-tour']?.status).toBe('active')
  })

  it('completes a quest that left the Tasks screen while neighbors stayed', () => {
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    progress.taskProgress.checking = { taskId: 'checking', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(
      progress,
      [{ questId: 'checking' }, { questId: 'side' }],
      [debut, checking, parallel],
      { previousSeenIds: ['debut', 'checking'] },
    )
    expect(next.taskProgress.debut?.status).toBe('completed')
    expect(next.taskProgress.checking?.status).toBe('active')
    expect(next.taskProgress.side?.status).toBe('active')
  })

  it('keeps quests of another trader when switching trader tabs', () => {
    const skier: Quest = { id: 'swag', name: 'Золотая добыча', trader: 'Лыжник', level: 5, kappa: true, description: '', objectives: [], rewards: [] }
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'swag' }], [debut, skier], { previousSeenIds: ['debut'] })
    expect(next.taskProgress.debut?.status).toBe('active')
    expect(next.taskProgress.swag?.status).toBe('active')
  })

  it('keeps a quest that flickered out of one OCR frame', () => {
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    progress.taskProgress.side = { taskId: 'side', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'side' }], [debut, parallel], { previousSeenIds: ['debut', 'side'] })
    expect(next.taskProgress.debut?.status).toBe('active')
  })

  it('does not turn scrolling a trader list into a turn-in', () => {
    const cans: Quest = { id: 'cans', name: 'Стрельба по баночкам', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
    const order: Quest = { id: 'order', name: 'Большой заказчик', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] }
    const progress = createModeProgress()
    progress.taskProgress.cans = { taskId: 'cans', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    progress.taskProgress.side = { taskId: 'side', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'side' }, { questId: 'order' }], [cans, order, parallel], { previousSeenIds: ['cans', 'side', 'order'] })
    expect(next.taskProgress.cans?.status).toBe('active')
  })

  it('never re-activates a completed quest and does not store an unconfirmed chain', () => {
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'completed', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'debut' }], [debut, checking])
    expect(next.taskProgress.debut?.status).toBe('completed')

    const fresh = applyScreenScanProgress(createModeProgress(), [{ questId: 'checking' }], [debut, checking])
    expect(fresh.taskProgress.debut).toBeUndefined()
  })

  it('adds a new quest in live watch only after two consecutive frames', () => {
    const first = applyScreenScanProgress(createModeProgress(), [{ questId: 'debut' }], [debut], { previousSeenIds: [], requireConfirmation: true })
    expect(first.taskProgress.debut).toBeUndefined()
    const second = applyScreenScanProgress(first, [{ questId: 'debut' }], [debut], { previousSeenIds: ['debut'], requireConfirmation: true })
    expect(second.taskProgress.debut?.status).toBe('active')
  })

  it('keeps active PvE quests found in logs when OCR only sees one page', () => {
    const progress = createModeProgress()
    progress.taskProgress.debut = { taskId: 'debut', status: 'active', source: 'eft-log', updatedAt: '2026-09-26T00:00:00.000Z' }
    const next = applyScreenScanProgress(progress, [{ questId: 'checking' }], [debut, checking], { previousSeenIds: ['checking'], requireConfirmation: true })
    expect(next.taskProgress.debut?.status).toBe('active')
    expect(next.taskProgress.checking?.status).toBe('active')
  })

  it('rejects messenger and trading screens', () => {
    expect(isTasksMenuText('Сообщения\nЗадание «Посылка из прошлого» выполнено. Награда: 5000')).toBe(false)
    expect(isTasksMenuText('Торговля\nПрапор\nЛояльность 2\nКупить')).toBe(false)
  })

  it('detects the story task menu; a trader\'s own Tasks tab is not the table (audit P13)', () => {
    expect(isTasksMenuText('СЮЖЕТНЫЕ\nИСТОРИЯ\nАКТИВНО\nГлавные задачи')).toBe(true)
    // «Уровень лояльности» is the trader tab's word: it counted for the table before.
    expect(isTasksMenuText('ЗАДАНИЯ\nЗАВЕРШИТЬ\nУРОВЕНЬ ЛОЯЛЬНОСТИ 3\nЛегкотня\nактивно!')).toBe(false)
  })
})

/**
 * A trader's own «Задания» tab in the Russian game, laid out like the English one the owner sent (ENGLISH_TRADER_TASKS):
 * the open quest with its status and «ЗАВЕРШИТЬ», the trader's other quests — taken or not — without a status, the
 * loyalty groups, the standing row and «(вы)» at the top. No Russian screenshot of it yet: the words are the game's.
 */
const RU_TRADER_TASKS = `НАЗАД
Raid_0S (вы) 224551706 €2359
Прапор Терапевт Скупщик Лыжник Миротворец Механик Барахольщик Егерь Реф Текущее отношение: LVL 41 1830 Р 389M
ЗАВЕРШИТЬ ® Работа для патриота Любая локация активно!
[_] Показать выполненные [_] Показать заблокированные
Зеленый коридор
Новый участковый
Короли высоток
Захват аванпоста
УРОВЕНЬ ЛОЯЛЬНОСТИ 3
Легкотня
Спецсвязь
Разведка
ГЛАВНОЕ МЕНЮ УБЕЖИЩЕ ПЕРСОНАЖ БАРАХОЛКА СБОРКИ СПРАВОЧНИК СООБЩЕНИЯ`

describe('a trader\'s own Tasks tab in the Russian game (audit P13)', () => {
  const quests = ENGLISH_TABLE_QUESTS.map(([id, name]): Quest => ({ id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] }))
  const name = (id: string) => quests.find((quest) => quest.id === id)?.name

  const unmarked = RU_TRADER_TASKS.split('\n').filter((line) => !/вы\)|отношение|показать|лояльности/i.test(line)).join('\n')

  it('is not the Tasks table: the standing, «(вы)», the loyalty groups tell it, each of them alone', () => {
    expect(isTasksMenuText(RU_TRADER_TASKS)).toBe(false)
    expect(tasksScreenKind(RU_TRADER_TASKS)).toBeNull()
    expect(isTasksMenuText(unmarked)).toBe(true)
    for (const mark of ['Текущее отношение: LVL 41', 'Raid_0S (вы)', 'Raid_0S (ву)', 'УРОВЕНЬ ЛОЯЛЬНОСТИ 3', '[_] Показать выполненные']) {
      expect(isTasksMenuText(`${unmarked}\n${mark}`)).toBe(false)
    }
  })

  it('rows without a status read never become current from it, even when its marks were not read', () => {
    expect(tasksScreenKind(unmarked)).toBe('table')
    const read = matchQuestsFromOcr(unmarked, quests)
    expect(read.length).toBeGreaterThan(3)
    expect(tableMatches(unmarked, read).map((match) => name(match.questId))).toEqual(['Работа для патриота'])
  })
})
