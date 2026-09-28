import { describe, expect, it } from 'vitest'
import type { ModeProgress, Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'
import { applyScreenScanProgress, isTasksMenuText } from './screenScanSync'
import { createScanSession, recordScanFrame, type QuestScanSession } from './questSession'

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
  return matchQuestsFromOcr(text, QUESTS).map((entry) => ({ questId: entry.questId, stageIndex: entry.stageIndex, status: entry.status }))
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

describe('scan session', () => {
  function stored(ids: string[]): ModeProgress {
    const progress = createModeProgress()
    for (const taskId of ids) progress.taskProgress[taskId] = { taskId, status: 'active', source: 'screen-scan', updatedAt: '2026-09-01T00:00:00.000Z' }
    return progress
  }

  function watch(progress: ModeProgress, frames: string[], stepMs = 4_000) {
    let session: QuestScanSession = createScanSession(0)
    let previous: string[] = []
    let next = progress
    frames.forEach((text, index) => {
      const now = (index + 1) * stepMs
      const matches = scanMatches(text)
      session = recordScanFrame(session, matches, QUESTS, now)
      next = applyScreenScanProgress(next, matches, QUESTS, { previousSeenIds: previous, requireConfirmation: true, session, now })
      previous = matches.map((entry) => entry.questId)
    })
    return next
  }

  it('moves quests found earlier but missing from the next scan to completed', () => {
    const next = watch(stored(['q-stale', 'q-supply', 'q-loss']), Array(5).fill(TABLE_FRAME))
    const active = Object.values(next.taskProgress).filter((record) => record.status === 'active').map((record) => record.taskId).sort()
    expect(active).toEqual(ACTIVE.map((quest) => quest.id).sort())
    expect(next.taskProgress['q-stale']?.status).toBe('completed')
    expect(next.taskProgress['q-supply']?.status).toBe('completed')
  })

  it('brings a quest back if it shows up again as «активно!»', () => {
    const progress = stored([])
    progress.taskProgress['q-tracker'] = { taskId: 'q-tracker', status: 'completed', source: 'screen-scan', updatedAt: '2026-09-01T00:00:00.000Z' }
    const next = watch(progress, [TABLE_FRAME, TABLE_FRAME])
    expect(next.taskProgress['q-tracker']?.status).toBe('active')
  })

  it('does not drop anything after a short glance', () => {
    const next = watch(stored(['q-stale']), [TABLE_FRAME, TABLE_FRAME], 1_000)
    expect(next.taskProgress['q-stale']?.status).toBe('active')
  })

  it('a found quest that leaves the table moves to completed', () => {
    const handedIn = TABLE_FRAME.replace('Следопыт Развязка активно! 66%\n', '')
    const next = watch(createModeProgress(), [TABLE_FRAME, TABLE_FRAME, TABLE_FRAME, handedIn, handedIn, handedIn, handedIn])
    expect(next.taskProgress['q-tracker']?.status).toBe('completed')
    const completed = Object.values(next.taskProgress).filter((record) => record.status === 'completed')
    expect(completed).toHaveLength(1)
  })

  it('a quest missing for a moment is not completed yet', () => {
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
