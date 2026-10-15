import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters } from '../data/storyChapters'
import { createModeProgress } from '../domain/progress'
import { visibleStoryObjectives } from '../progression/storyObjectives'
import { TOUR_BODY, TOUR_FULL_SCREEN, TOUR_OBJECTIVES, TOUR_OBJECTIVES_VARIANTS, TOUR_STATUS, TOUR_TITLE } from './__fixtures__/storyPaneOcrTour'
import { applyStoryScan, confirmStoryFrame, matchStoryChapters, storyPaneChapter } from './storyScan'
import { readStoryObjectives } from './storyObjectives'
import { isStoryPaneOcr, storyPaneRects, storyPaneText, type OcrWordBox } from './storyPaneLayout'
import { ENGLISH_STORY_BATYA, ENGLISH_STORY_BOREAS, ENGLISH_STORY_TOUR, ENGLISH_TASKS_SIDE, ENGLISH_TASKS_SIDE_SCROLLED } from './__fixtures__/englishGameOcr'
import { PVP_TOUR } from './__fixtures__/storyPanesPvp'
import { RU_TASKS_TABLE } from './__fixtures__/russianTasksTable'

const QUESTS = addMissingStoryChapters([], 'ru')
const STORY = QUESTS.filter((quest) => quest.kind === 'story')
const tour = STORY.find((quest) => quest.id === 'story-tour')!
const PANE = { title: TOUR_TITLE, status: TOUR_STATUS, body: TOUR_BODY }

describe('story pane read by real Tesseract on the owner\'s «Тур» frame', () => {
  it('drops the checkbox and progress-bar junk and keeps the counter the game shows', () => {
    for (const text of [TOUR_OBJECTIVES, TOUR_BODY, ...TOUR_OBJECTIVES_VARIANTS]) {
      expect(readStoryObjectives(text, tour), text).toMatchObject([
        { text: 'Поговорить с Лыжником', optional: false },
        { text: 'Посетить Лес', optional: true, current: 1, total: 3, completed: false },
      ])
    }
  })

  it('corrects a look-alike denominator from the catalog, but keeps a count the game really changed', () => {
    const read = (counter: string) => readStoryObjectives(`Главные задачи\nПоговорить с Лыжником\nОпциональные задачи\nПосетить Лес ${counter}`, tour)[1]
    expect(read('1/5')).toMatchObject({ current: 1, total: 3 })
    expect(read('2/8')).toMatchObject({ current: 2, total: 3 })
    expect(read('1/4')).toMatchObject({ current: 1, total: 4 })
    expect(read('7/5')?.current).toBeUndefined()
  })

  it('finds the chapter and «АКТИВНО» in the title and status parts', () => {
    expect(storyPaneChapter(storyPaneText(PANE), STORY)).toMatchObject({ quest: { id: 'story-tour' }, active: true })
    // The whole-screen pass lost the «Т» of «Тур» and the status: the old reading could not name the open chapter.
    expect(storyPaneChapter(TOUR_FULL_SCREEN, STORY)).toBeUndefined()
  })

  it('publishes clean objectives at once and settles on the second «Поговорить с Лыжником» (stage 12)', () => {
    const matches = matchStoryChapters(TOUR_FULL_SCREEN, QUESTS, PANE)
    expect(matches.filter((match) => match.stageIndex != null || match.objectives?.length).map((match) => match.questId)).toEqual(['story-tour'])
    const first = confirmStoryFrame(null, 'p:pvp', 1, matches)
    const second = confirmStoryFrame(first.state, 'p:pvp', 2, matches)
    const progress = applyStoryScan(applyStoryScan(createModeProgress(), matches.filter((match) => match.objectives?.length), '2026-10-08T10:00:00.000Z'),
      second.confirmed, '2026-10-08T10:00:01.000Z')
    expect(progress.taskProgress['story-tour']).toMatchObject({ status: 'active', currentStageIndex: 12 })
    expect(visibleStoryObjectives(tour, progress)).toMatchObject([
      { text: 'Поговорить с Лыжником', stageIndex: 12 },
      { text: 'Посетить Лес', current: 1, total: 3, stageIndex: 14 },
    ])
  })

  it('the old whole-screen text alone now also gives clean objectives and the right total', () => {
    const tourMatch = matchStoryChapters(TOUR_FULL_SCREEN, QUESTS).find((match) => match.questId === 'story-tour')
    expect(tourMatch?.objectives).toMatchObject([
      { text: 'Поговорить с Лыжником' },
      { text: 'Посетить Лес', current: 1, total: 3 },
    ])
  })

  it('a chapter with wording the catalog does not know is still shown from its title and «АКТИВНО»', () => {
    const pane = { ...PANE, body: 'Главные задачи\n[1] Разведать новую тропу у озера\nОпциональные задачи\nГ] Найти старую карту 0/2' }
    const match = matchStoryChapters('', QUESTS, pane).find((entry) => entry.questId === 'story-tour')
    expect(match).toMatchObject({ active: true, objectives: [{ text: 'Разведать новую тропу у озера' }, { text: 'Найти старую карту', current: 0, total: 2 }] })
  })
})

describe('where the story pane parts are cut', () => {
  const word = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWordBox => ({ text, bbox: { x0, y0, x1, y1 } })
  // Word boxes of the whole-screen pass over the owner's frame.
  const WORDS = [word('СЮЖЕТНЫЕ', 63, 60, 193, 77), word('Предметы', 1310, 56, 1394, 73), word('ИСТОРИЯ', 175, 134, 250, 166),
    word('Главные', 160, 407, 230, 421), word('задачи', 236, 410, 295, 423), word('Опциональные', 160, 500, 285, 516), word('ГЛАВНОЕ', 49, 1058, 117, 1070)]

  it('cuts a 16:9 frame by the measured fractions', () => {
    expect(storyPaneRects({ width: 1920, height: 1080 })).toEqual({
      title: { x: 144, y: 124, width: 557, height: 97 },
      // Inside the orange status box only (the English game's «ACTIVE» misread with 8 px of banner art beside it).
      status: { x: 1133, y: 130, width: 144, height: 75 },
      body: { x: 144, y: 248, width: 1133, height: 783 },
    })
  })

  it('follows the anchors of a full-screen pass, and the objectives start at «Главные задачи» when asked', () => {
    const rects = storyPaneRects({ width: 1920, height: 1080 }, WORDS, true)!
    expect(rects.title).toMatchObject({ x: 137, y: 123 })
    expect(rects.status.x + rects.status.width).toBe(1272)
    expect(rects.body).toMatchObject({ x: 137, y: 394 })
    expect(rects.body.y + rects.body.height).toBe(1047)
  })

  it('ends the body before the right panel when only its lower header «Предметы для заданий в схроне» was read', () => {
    // Owner's «Тур», 15.10.2026: the body reached the panel and «Предмет:» became part of «Посетить Таможню».
    const lower = [...WORDS.filter((entry) => entry.text !== 'Предметы'), word('Предметы', 1240, 600, 1320, 616), word('для', 1326, 600, 1356, 616)]
    expect(storyPaneRects({ width: 1920, height: 1080 }, lower, true)!.body.x + storyPaneRects({ width: 1920, height: 1080 }, lower, true)!.body.width).toBe(1202)
    // A «предметы» of the description is no panel header.
    const description = [...WORDS, word('предметы', 1100, 300, 1180, 316), word('Лыжнику', 1186, 300, 1260, 316)]
    expect(storyPaneRects({ width: 1920, height: 1080 }, description, true)!.status.x + storyPaneRects({ width: 1920, height: 1080 }, description, true)!.status.width).toBe(1272)
  })

  it('reads other aspect ratios only with anchors', () => {
    expect(storyPaneRects({ width: 1920, height: 810 })).toBeUndefined()
    expect(storyPaneRects({ width: 1920, height: 810 }, WORDS.map((entry) => ({ ...entry, bbox: { ...entry.bbox, y0: entry.bbox.y0 * 0.75, y1: entry.bbox.y1 * 0.75 } })))).toBeDefined()
  })

  it('tells the story pane from other screens', () => {
    expect(isStoryPaneOcr(TOUR_FULL_SCREEN)).toBe(true)
    expect(isStoryPaneOcr(PVP_TOUR)).toBe(true)
    for (const pane of [ENGLISH_STORY_TOUR, ENGLISH_STORY_BATYA, ENGLISH_STORY_BOREAS]) expect(isStoryPaneOcr(pane.screen)).toBe(true)
    expect(isStoryPaneOcr('ЗАДАНИЯ\nПОБОЧНЫЕ\nПрапор Посылка из прошлого АКТИВНО')).toBe(false)
    expect(isStoryPaneOcr(RU_TASKS_TABLE)).toBe(false)
  })

  it('needs the pane\'s own marks: the «STORY» tab over the side table is not the pane (audit P5c)', () => {
    // The side table with its tab bar read as on the story frames («STORY © SIDE @ OPERATIONAL»): every look at it cost
    // two or three part reads of a pane that was not there.
    const tabs = 'Д STORY © SIDE @ OPERATIONAL Task items on character a'
    for (const table of [ENGLISH_TASKS_SIDE, ENGLISH_TASKS_SIDE_SCROLLED]) {
      const read = table.replace(/^.*\n.*\n/, (head) => `${head.split('\n')[0]}\n${tabs}\n`)
      expect(read).toContain('STORY © SIDE')
      expect(isStoryPaneOcr(read)).toBe(false)
    }
  })
})

describe('objectives saved by an older version', () => {
  it('are shown clean at once: junk text, the look-alike total and the stage it hid', () => {
    const progress = createModeProgress()
    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'active', source: 'screen-scan', currentStageIndex: 12, updatedAt: '', storyObjectives: [
      { id: 'main:x', text: '= [1] Поговорить с Лыжником', optional: false, completed: false, stageIndex: 12 },
      { id: 'optional:y', text: 'Посетить Лес №8', optional: true, completed: false, current: 1, total: 5 },
    ] }
    expect(visibleStoryObjectives(tour, progress)).toMatchObject([
      { text: 'Поговорить с Лыжником', stageIndex: 12 },
      { text: 'Посетить Лес', stageIndex: 14, current: 1, total: 3, completed: false },
    ])
  })
})
