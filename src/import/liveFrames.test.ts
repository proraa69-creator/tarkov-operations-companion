import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { applyCuratedStoryStages } from '../data/storyChapters'
import { matchQuestsFromOcr } from './questOcr'
import { isTasksMenuText } from './screenScanSync'

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

