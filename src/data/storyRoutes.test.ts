// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { STORY_BRANCHES, STORY_CHAPTER_SEEDS } from './storyChapterSeeds'
import { choicesOfStage, nextStoryStage, previousStoryStage, ROUTE_QUESTIONS } from './storyRoutes'
import { stageDone, stageGoals } from '../progression/storyStageGoals'

const seed = (id: string) => STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === id)!
const ru = (id: string, index: number) => seed(id).stages[index]!.ru
const total = (id: string) => seed(id).stages.length

describe('the way through a chapter', () => {
  it('a chapter without routes goes stage by stage and ends', () => {
    expect(nextStoryStage(undefined, 0, 3, {})).toEqual({ index: 1 })
    expect(nextStoryStage(undefined, 2, 3, {})).toEqual({ index: null })
    expect(previousStoryStage(undefined, 2, {})).toBe(1)
    expect(previousStoryStage(undefined, 0, {})).toBeNull()
  })

  it('«Небеса в огне»: the armored case is asked, and either answer ends the chapter', () => {
    const asked = nextStoryStage('falling-skies', 17, total('falling-skies'), {})
    expect(asked.ask?.id).toBe('armored-case')
    expect(asked.ask?.options[0]!.decision?.outcome.ru).toBeTruthy()
    expect(ru('falling-skies', nextStoryStage('falling-skies', 17, total('falling-skies'), { 'armored-case': 'prapor' }).index!)).toBe('Передать бронированный кейс Прапору')
    expect(ru('falling-skies', nextStoryStage('falling-skies', 17, total('falling-skies'), { 'armored-case': 'kept' }).index!)).toBe('Оставить бронированный кейс себе')
    expect(nextStoryStage('falling-skies', 18, total('falling-skies'), { 'armored-case': 'prapor' })).toEqual({ index: null })
    expect(nextStoryStage('falling-skies', 19, total('falling-skies'), { 'armored-case': 'kept' })).toEqual({ index: null })
  })

  it('«Билет»: a route that does not fit the answers is walked past', () => {
    const chapter = 'the-ticket'
    const n = total(chapter)
    // Kept the case: nothing of what Lightkeeper asks for to win it back.
    expect(ru(chapter, nextStoryStage(chapter, 4, n, { 'armored-case': 'kept' }).index!)).toBe('Открыть бронированный кейс')
    expect(nextStoryStage(chapter, 4, n, {}).ask?.id).toBe('armored-case')
    // After the case: Mr. Kerman's offer is asked, each answer has its own route.
    const offer = 22
    expect(nextStoryStage(chapter, offer, n, { 'armored-case': 'kept' }).ask?.id).toBe('kerman-offer')
    expect(ru(chapter, nextStoryStage(chapter, offer, n, { 'armored-case': 'kept', 'kerman-offer': 'accept' }).index!)).toBe('Принять предложение мистера Кермана о сотрудничестве')
    expect(ru(chapter, nextStoryStage(chapter, offer, n, { 'armored-case': 'kept', 'kerman-offer': 'refuse' }).index!)).toBe('Отказаться от предложения мистера Кермана о сотрудничестве')
    // The accept route's end does not walk into the refuse route.
    const accept = { 'armored-case': 'kept', 'kerman-offer': 'accept' }
    expect(nextStoryStage(chapter, 34, n, accept).index).not.toBe(35)
  })

  it('every branch of the chapters has a way through: nothing asks a question the app does not have', () => {
    const allAnswers = [
      { 'armored-case': 'prapor', 'kerman-offer': 'accept', 'kerman-evidence': 'agree', 'major-evidence': 'yes', 'prapor-72h': 'in-time', 'boreas-transport': 'friends', 'fragment-1156': 'give' },
      { 'armored-case': 'kept', 'kerman-offer': 'refuse', 'kerman-evidence': 'refuse', 'major-evidence': 'no', 'prapor-72h': 'late', 'boreas-transport': 'neither', 'fragment-1156': 'keep' },
      { 'armored-case': 'kept', 'kerman-offer': 'accept', 'kerman-evidence': 'betray', 'major-evidence': 'no', 'prapor-72h': 'in-time', 'boreas-transport': 'independence', 'fragment-1156': 'give' },
    ]
    for (const chapter of STORY_CHAPTER_SEEDS) {
      for (const answers of allAnswers) {
        let at = -1
        let steps = 0
        for (;;) {
          const next = nextStoryStage(chapter.id, at, chapter.stages.length, answers)
          expect(next.ask, `${chapter.id} at ${at}`).toBeUndefined()
          if (next.index === null) break
          expect(next.index).toBeGreaterThan(at)
          at = next.index
          steps += 1
        }
        expect(steps).toBeGreaterThan(0)
        // Back from the end walks the same route to the start.
        let back = at
        while (back > 0) {
          const previous = previousStoryStage(chapter.id, back, answers)
          if (previous === null) break
          expect(previous).toBeLessThan(back)
          back = previous
        }
      }
    }
  })

  it('every question has answers, and a branch header known to the app reads in Russian', () => {
    for (const question of Object.values(ROUTE_QUESTIONS)) expect(question.options.length).toBeGreaterThan(1)
    for (const chapter of STORY_CHAPTER_SEEDS) for (const stage of chapter.stages) if (stage.branch) expect(STORY_BRANCHES[stage.branch], stage.branch).toBeTruthy()
  })

  it('a stage picked by hand says which route the player took', () => {
    const accepted = seed('the-ticket').stages.findIndex((stage) => stage.ru === 'Принять предложение мистера Кермана о сотрудничестве')
    expect(choicesOfStage('the-ticket', accepted)).toEqual({ 'kerman-offer': 'accept' })
    expect(choicesOfStage('falling-skies', 19)).toEqual({ 'armored-case': 'kept' })
    expect(choicesOfStage('batya', 0)).toEqual({})
    expect(choicesOfStage(undefined, 3)).toEqual({})
  })
})

describe('the goals of a stage', () => {
  const quest = (title: string, extra: object = {}) => ({ id: 'story-x', name: 'x', normalizedName: 'x', kind: 'story' as const, stages: [{ id: 's', title, description: '', mapIds: [], ...extra }] })

  it('«выжить или посетить 3 раза» is either of two: a tick or a counter', () => {
    const goals = stageGoals(quest('Выжить на локации Таможня и выйти или посетить Таможню 3 раза', { progressTotal: 3 }), 0)
    expect(goals.goals.every((goal) => goal.either)).toBe(true)
    expect(goals.goals.map((goal) => [goal.key, goal.text.ru, goal.target])).toEqual([['survive', 'Выжить на локации Таможня и выйти', undefined], ['visit', 'Посетить Таможню', 3]])
    expect(stageDone(goals, {})).toBe(false)
    expect(stageDone(goals, { visit: 2 })).toBe(false)
    expect(stageDone(goals, { visit: 3 })).toBe(true)
    expect(stageDone(goals, { survive: 1 })).toBe(true)
  })

  it('the English titles read the same, and marks do not depend on the language', () => {
    const goals = stageGoals(quest('Survive and extract from Customs or visit Customs 3 times', { progressTotal: 3 }), 0)
    expect(goals.goals.map((goal) => [goal.key, goal.text.ru, goal.target, goal.either])).toEqual([['survive', 'Survive and extract from Customs', undefined, true], ['visit', 'Visit Customs', 3, true]])
    expect(stageGoals(quest('Hand over 5 items of the Building materials category to Ski'), 0).goals[0]!.target).toBe(5)
    expect(stageGoals(quest('Hand over the fragment of Item 1156 to Mechanic'), 0).goals[0]!.target).toBeUndefined()
    // A chapter with its own words: the English title gives the same counter and keys as the Russian one.
    const chapter = STORY_CHAPTER_SEEDS.find((entry) => entry.stages.some((stage) => stage.ru.startsWith('Ликвидировать 15')))!
    const seeded = chapter.stages.findIndex((stage) => stage.ru.startsWith('Ликвидировать 15'))
    const stages = chapter.stages.map((stage, index) => ({ id: `story-${chapter.id}-${index}`, title: stage.en, description: '', mapIds: [] }))
    const english = { id: `story-${chapter.id}`, name: chapter.en, normalizedName: chapter.id, kind: 'story' as const, stages }
    expect(stageGoals(english, seeded).goals[0]).toMatchObject({ key: 'main', target: 15, text: { en: expect.stringContaining('Eliminate 15') } })
  })

  it('the Tour\'s «Обеспечить доступ» stages are the things they ask: one choice, the rest required', () => {
    const tour = { id: 'story-tour', name: 'Тур', normalizedName: 'tour', kind: 'story' as const, stages: [{ id: 'story-tour-19', title: 'Обеспечить доступ на локацию Резерв', description: '', mapIds: [] }, { id: 'story-tour-21', title: 'Обеспечить доступ на локацию Лаборатория', description: '', mapIds: [] }] }
    const reserve = stageGoals(tour, 0)
    expect(reserve.goals.map((goal) => [goal.key, goal.target, goal.either])).toEqual([['survive', undefined, true], ['visit', 3, true], ['tags', 5, undefined]])
    expect(stageDone(reserve, { survive: 1 })).toBe(false)
    expect(stageDone(reserve, { tags: 5 })).toBe(false)
    expect(stageDone(reserve, { visit: 3, tags: 5 })).toBe(true)
    expect(stageDone(reserve, { survive: 1, tags: 5 })).toBe(true)
    const lab = stageGoals(tour, 1)
    expect(lab.goals.filter((goal) => !goal.optional).map((goal) => goal.key)).toEqual(['reach', 'offices', 'servers', 'drain'])
    expect(stageDone(lab, { reach: 1, drain: 1, servers: 1 })).toBe(false)
    expect(stageDone(lab, { reach: 1, drain: 1, servers: 1, offices: 1 })).toBe(true)
  })

  it('a number of things is a counter; other numbers are not', () => {
    const target = (title: string) => stageGoals(quest(title), 0).goals[0]!.target
    expect(target('Передать Лыжнику 5 предметов из категории Стройматериалы')).toBe(5)
    expect(target('Передать Механику 40 физических биткоинов')).toBe(40)
    expect(target('Ликвидировать 15 целей за один рейд на Развязке')).toBe(15)
    expect(target('Передать 200 патронов 7,62x54 мм R БТ гж')).toBe(200)
    expect(target('Передать Прапору 1 000 000 долларов')).toBeUndefined()
    expect(target('Передать Водителю БТР бронепластины 5-го класса или выше')).toBeUndefined()
    expect(target('Достичь 5-го уровня навыка «Ручные пулемёты»')).toBeUndefined()
    expect(target('Построить Разведцентр 3-го уровня')).toBeUndefined()
    expect(target('Поговорить с Механиком')).toBeUndefined()
    expect(target('Убить 3 любые цели на локации Лес')).toBe(3)
  })

  it('a chapter\'s steps go under the stage; optional ones and optional stages do not hold the way on', () => {
    const stages = seed('falling-skies').stages.map((stage, index) => ({ id: `story-falling-skies-${index}`, title: stage.ru, description: '', mapIds: [], optional: stage.optional }))
    const chapter = { id: 'story-falling-skies', name: 'Небеса в огне', normalizedName: 'falling-skies', kind: 'story' as const, stages }
    const required = stageGoals(chapter, 3)
    expect(required.goals.map((goal) => goal.key)).toEqual(['main', 'step-0', 'step-1'])
    expect(stageDone(required, { main: 1 })).toBe(false)
    expect(stageDone(required, { main: 1, 'step-0': 1, 'step-1': 1 })).toBe(true)
    const withOptional = stageGoals(chapter, 17)
    expect(withOptional.goals[1]!.optional).toBe(true)
    expect(stageDone(withOptional, { main: 1 })).toBe(true)
    expect(stageDone(stageGoals(quest('Поговорить', { optional: true }), 0), {})).toBe(true)
    expect(stageGoals(chapter, 99).goals).toEqual([])
  })
})
