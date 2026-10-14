import { describe, expect, it } from 'vitest'
import type { ModeProgress, Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'
import { applyScreenScanProgress, isTasksMenuText } from './screenScanSync'
import { createScanSession, recordTableView, tableView, WHOLE_LIST_MAX_ROWS, type QuestScanSession } from './questSession'

// Real in-game OCR (1024 px frames) of the «Задания» table and the story pane.
const TABLE_FRAME = `ттт rrr SC”:
Класс Задание Локация Статус \\ Прогресс
6%
По коням Эпицентр. ‘активно!
9,
Снабженец Любая локация активно! 8%
6%
Большая потеря Развязка активно!
я 6%
Модный приговор Любая локация активно!
Предмет
9,
Следопыт Развязка активно! 66%
—
я 50%
Топливный кризис Развязка активно!
—
9,
‘Операция "Водолей" Таможня активно! 8%
я 50%
Первый в очереди Эпицентр активно!
—
9,
Планы снабжения Лес активно! 8%`

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

const MAIN_MENU_FRAME = `ESCAPE FRU.
|. ПЕРСОНАЖ
ТОРГОВЛЯ
ых УБЕЖИЩЕ
выход`

function trader(id: string, name: string, traderName: string): Quest {
  return { id, name, trader: traderName, level: 1, kappa: false, description: '', objectives: [], rewards: [] }
}

const ACTIVE = [
  trader('q-horses', 'По коням', 'Прапор'),
  trader('q-supplier', 'Снабженец', 'Прапор'),
  trader('q-loss', 'Большая потеря', 'Терапевт'),
  trader('q-fashion', 'Модный приговор', 'Лыжник'),
  trader('q-tracker', 'Следопыт', 'Егерь'),
  trader('q-fuel', 'Топливный кризис', 'Механик'),
  trader('q-aquarius', 'Операция "Водолей"', 'Терапевт'),
  trader('q-first', 'Первый в очереди', 'Терапевт'),
  trader('q-supply-plans', 'Планы снабжения', 'Егерь'),
]

const DECOYS = [
  trader('q-supply', 'Снабжение', 'Лыжник'),
  trader('q-fashion2', 'Модный приговор - Часть 2', 'Лыжник'),
  trader('q-aquarius2', 'Операция "Водолей" - Часть 2', 'Терапевт'),
  trader('q-loss-old', 'Потеря', 'Прапор'),
  trader('q-stale', 'Стирка', 'Прапор'),
]

const tour = applyCuratedStoryStages([{
  id: 'story-tour', kind: 'story', name: 'Тур', trader: 'Глава истории', level: 1, kappa: false,
  description: '', objectives: [], rewards: [], stages: [],
}])[0]!

const QUESTS = [...ACTIVE, ...DECOYS, tour]

function scanMatches(text: string) {
  return matchQuestsFromOcr(text, QUESTS).map((entry) => ({ questId: entry.questId, stageIndex: entry.stageIndex, status: entry.status, line: entry.line }))
}

describe('real Tasks-screen frames', () => {
  it('reads all nine rows of the table and nothing else', () => {
    expect(isTasksMenuText(TABLE_FRAME)).toBe(true)
    const ids = scanMatches(TABLE_FRAME).map((entry) => entry.questId).sort()
    expect(ids).toEqual(ACTIVE.map((quest) => quest.id).sort())
  })

  it('finds the story chapter at the customs / building materials stage', () => {
    expect(isTasksMenuText(STORY_FRAME)).toBe(true)
    const matches = scanMatches(STORY_FRAME)
    expect(matches.map((entry) => entry.questId)).toEqual(['story-tour'])
    expect(matches[0]?.stageIndex).toBe(7)
  })

  it('ignores the main menu', () => {
    expect(isTasksMenuText(MAIN_MENU_FRAME)).toBe(false)
  })
})

describe('scan session (audit P8): only a whole current list read twice ends an OCR quest', () => {
  function stored(ids: string[]): ModeProgress {
    const progress = createModeProgress()
    for (const taskId of ids) progress.taskProgress[taskId] = { taskId, status: 'active', source: 'screen-scan', updatedAt: '2026-09-01T00:00:00.000Z' }
    return progress
  }

  /** The scanner's way: each frame a fresh reading, recorded in the session, then applied with it. */
  function watch(progress: ModeProgress, frames: string[], stepMs = 4_000, fresh = (index: number) => index) {
    let session: QuestScanSession = createScanSession()
    let previous: string[] = []
    let next = progress
    frames.forEach((text, index) => {
      const now = (index + 1) * stepMs
      const matches = scanMatches(text)
      session = recordTableView(session, tableView(text, matches, QUESTS, (fresh(index) + 1) * stepMs))
      next = applyScreenScanProgress(next, matches, QUESTS, { previousSeenIds: previous, requireConfirmation: true, session, now })
      previous = matches.map((entry) => entry.questId)
    })
    return next
  }

  // The first five rows: a list that fits on one page with room to spare.
  const SHORT_TABLE = TABLE_FRAME.split('\n').slice(0, TABLE_FRAME.split('\n').findIndex((line) => line.startsWith('Следопыт')) + 1).join('\n')
  const active = (progress: ModeProgress) => Object.values(progress.taskProgress).filter((record) => record.status === 'active').map((record) => record.taskId).sort()

  it('a full page is not the whole list: a stored quest may be scrolled away, nothing ends', () => {
    const next = watch(stored(['q-stale', 'q-supply', 'q-loss']), Array(5).fill(TABLE_FRAME))
    expect(active(next)).toEqual([...ACTIVE.map((quest) => quest.id), 'q-stale', 'q-supply'].sort())
    expect(Object.values(next.taskProgress).some((record) => record.status === 'completed')).toBe(false)
  })

  it('a whole list read twice ends the stored OCR quests it does not show: removed, never completed', () => {
    expect(scanMatches(SHORT_TABLE).length).toBeLessThanOrEqual(WHOLE_LIST_MAX_ROWS)
    const next = watch(stored(['q-stale', 'q-supply']), [SHORT_TABLE, SHORT_TABLE])
    expect(next.taskProgress['q-stale']).toBeUndefined()
    expect(next.taskProgress['q-supply']).toBeUndefined()
    expect(Object.values(next.taskProgress).some((record) => record.status === 'completed')).toBe(false)
    expect(active(next)).toEqual(['q-fashion', 'q-horses', 'q-loss', 'q-supplier', 'q-tracker'])
  })

  it('a quest handed in leaves the whole list: gone after the list is read twice without it', () => {
    const handedIn = SHORT_TABLE.replace('Следопыт Развязка активно! 66%', '')
    const next = watch(createModeProgress(), [SHORT_TABLE, SHORT_TABLE, handedIn])
    expect(next.taskProgress['q-tracker']?.status).toBe('active')
    expect(watch(createModeProgress(), [SHORT_TABLE, SHORT_TABLE, handedIn, handedIn]).taskProgress['q-tracker']).toBeUndefined()
  })

  it('one reading is not two: a copy of the same reading (the same capture time) ends nothing', () => {
    const next = watch(stored(['q-stale']), [SHORT_TABLE, SHORT_TABLE, SHORT_TABLE], 1_000, () => 0)
    expect(next.taskProgress['q-stale']?.status).toBe('active')
  })

  it('never touches what the logs hold', () => {
    const progress = stored(['q-stale'])
    progress.taskProgress['q-supply'] = { taskId: 'q-supply', status: 'active', source: 'eft-log', updatedAt: '2026-09-01T00:00:00.000Z' }
    const next = watch(progress, [SHORT_TABLE, SHORT_TABLE])
    expect(next.taskProgress['q-supply']).toBe(progress.taskProgress['q-supply'])
    expect(next.taskProgress['q-stale']).toBeUndefined()
  })

  it('more stored quests missing at once than hand-ins explain: another view, nothing ends', () => {
    const next = watch(stored(['q-stale', 'q-supply', 'q-first']), [SHORT_TABLE, SHORT_TABLE])
    expect(next.taskProgress['q-stale']?.status).toBe('active')
    expect(next.taskProgress['q-first']?.status).toBe('active')
  })

  it('a row whose title was not read could be the missing quest: nothing ends', () => {
    const unread = SHORT_TABLE.replace('Большая потеря Развязка активно!', 'Бкпшая Пптр Развязка активно!')
    expect(scanMatches(unread).some((match) => match.questId === 'q-loss')).toBe(false)
    expect(watch(stored(['q-loss']), [unread, unread, unread]).taskProgress['q-loss']?.status).toBe('active')
  })

  it('brings a quest back if it shows up again as «активно!»', () => {
    const progress = stored([])
    progress.taskProgress['q-tracker'] = { taskId: 'q-tracker', status: 'completed', source: 'screen-scan', updatedAt: '2026-09-01T00:00:00.000Z' }
    const next = watch(progress, [TABLE_FRAME, TABLE_FRAME])
    expect(next.taskProgress['q-tracker']?.status).toBe('active')
  })

  it('a quest missing for a moment stays', () => {
    const gone = TABLE_FRAME.replace('Следопыт Развязка активно! 66%\n', '')
    const next = watch(createModeProgress(), [TABLE_FRAME, TABLE_FRAME, gone, TABLE_FRAME], 1_000)
    expect(next.taskProgress['q-tracker']?.status).toBe('active')
  })

  it('rows marked «доступно» are not added as current', () => {
    const available = TABLE_FRAME.replace('Планы снабжения Лес активно! 8%', 'Планы снабжения Лес доступно')
    const next = watch(createModeProgress(), [available, available])
    expect(next.taskProgress['q-supply-plans']).toBeUndefined()
    expect(next.taskProgress['q-horses']?.status).toBe('active')
  })
})
