/**
 * Owner, 15.10.2026: «у меня не находит сюжетную ветку Батя, хотя тур нашел» (PvP and Season, after «Престиж +»).
 *
 * «Батя»'s banner art gives OCR lines of its own between «ИСТОРИЯ» / «CHAPTER» and the name, so the status label
 * (read as its own part) came after the four header lines storyPaneChapter looked at: the pane never counted as
 * «АКТИВНО». The chapter was then written only when its main objective matched the catalog's wording exactly, and
 * most of «Батя»'s stages are worded differently in the game than in the wiki. Once «Престиж +» had emptied the mode's
 * story layer, the open «Батя» pane wrote nothing. «Тур»'s banner leaves the status within those lines.
 */
import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters } from '../data/storyChapters'
import { createModeProgress } from '../domain/progress'
import type { ModeProgress, RaidMode } from '../domain/types'
import { belongsInQuestSection } from '../progression/questSections'
import { inputsOf, withLayer } from '../quests/questInputs'
import { ENGLISH_STORY_BATYA, ENGLISH_STORY_TOUR } from './__fixtures__/englishGameOcr'
import type { StoryPaneReading } from './storyPaneLayout'
import { applyStoryScan, confirmStoryFrame, matchStoryChapters, storyPaneChapter } from './storyScan'
import { storyPaneText } from './storyPaneLayout'

const QUESTS = addMissingStoryChapters([], 'ru')
const STORY = QUESTS.filter((quest) => quest.kind === 'story')
const chapter = (id: string) => STORY.find((quest) => quest.id === id)!

/** The owner's «Батя» title part (englishGameOcr.ts) with the Russian header: the art's lines before and after the name. */
const BATYA_TITLE_RU = 'ИСТОРИЯ к аа A “а\nпет\n\nБатя ‚ в -\nзаса ей Ae 5\n'
const batyaPane = (main: string, title = BATYA_TITLE_RU): StoryPaneReading => ({ title, status: 'АКТИВНО\n', body: `Главные задачи\n\n[О] ${main}\n` })
const TOUR_PANE: StoryPaneReading = { title: 'ИСТОРИЯ в > мА,\nТур > р\n', status: 'АКТИВНО\n', body: 'Главные задачи\nГ] Поговорить с Лыжником\nОпциональные задачи\nС] Посетить Лес № 1/3\n' }

/**
 * What the scanner and AppState.applyStoryScanForMode do with two fresh readings of one pane in `mode`: the story layer
 * of the quest-state engine, after a «Престиж +» left the mode empty with a pending marker.
 */
function scanAfterPrestige(mode: RaidMode, parts: StoryPaneReading): ModeProgress {
  let progress: ModeProgress = { ...createModeProgress(), resetMarker: { kind: 'prestige', at: '2026-10-15T08:00:00.000Z' } }
  const matches = matchStoryChapters('', QUESTS, parts)
  const first = confirmStoryFrame(null, `p:${mode}`, 1000, matches)
  const second = confirmStoryFrame(first.state, `p:${mode}`, 2000, matches)
  for (const [batch, at] of [[matches.filter((match) => match.objectives?.length), '2026-10-15T10:00:00.000Z'], [second.confirmed, '2026-10-15T10:00:01.000Z']] as const) {
    const story = inputsOf(progress, mode).story
    const read = applyStoryScan({ ...progress, taskProgress: story }, [...batch], at)
    progress = withLayer(progress, mode, 'story', read.taskProgress)
  }
  return progress
}

describe('«Батя» on the story pane in PvP and Season (owner, 15.10.2026)', () => {
  it('the status part says «ACTIVE» even when the banner art puts the name three lines under «CHAPTER»', () => {
    const text = storyPaneText(ENGLISH_STORY_BATYA.parts)
    expect(storyPaneChapter(text, STORY, ENGLISH_STORY_BATYA.parts.status)).toMatchObject({ quest: { id: 'story-batya' }, active: true, completed: false })
    expect(storyPaneChapter(storyPaneText(ENGLISH_STORY_TOUR.parts), STORY, ENGLISH_STORY_TOUR.parts.status)).toMatchObject({ quest: { id: 'story-tour' }, active: true })
  })

  it('a name one more art line down is still the chapter\'s name', () => {
    const title = 'ИСТОРИЯ к аа A “а\nпет\n- = Ж\nБатя ‚ в -\n'
    expect(storyPaneChapter(storyPaneText(batyaPane('Узнать у торговцев больше о Богатырях', title)), STORY, 'АКТИВНО\n')).toMatchObject({ quest: { id: 'story-batya' }, active: true })
  })

  for (const mode of ['pvp', 'seasonal'] as const) {
    it(`${mode}: an «АКТИВНО» «Батя» pane whose objective the catalog does not know is written with what it shows`, () => {
      const next = scanAfterPrestige(mode, batyaPane('Совсем новая формулировка задачи'))
      expect(next.taskProgress['story-batya']).toMatchObject({ status: 'active', source: 'screen-scan' })
      expect(next.taskProgress['story-batya']!.storyObjectives?.map((objective) => objective.text)).toEqual(['Совсем новая формулировка задачи'])
      expect(belongsInQuestSection(chapter('story-batya'), next, 'story')).toBe(true)
    })

    it(`${mode}: the game's own wording of a «Батя» stage gives its stage («Найти позицию «Рябина»» is stage 2)`, () => {
      const next = scanAfterPrestige(mode, batyaPane('Найти позицию «Рябина»'))
      expect(next.taskProgress['story-batya']).toMatchObject({ status: 'active', currentStageIndex: 2 })
      expect(belongsInQuestSection(chapter('story-batya'), next, 'story')).toBe(true)
    })

    it(`${mode}: «Тур» is found as before`, () => {
      const next = scanAfterPrestige(mode, TOUR_PANE)
      expect(next.taskProgress['story-tour']).toMatchObject({ status: 'active', currentStageIndex: 12 })
      expect(belongsInQuestSection(chapter('story-tour'), next, 'story')).toBe(true)
    })
  }

  it('the game\'s wording of «Батя»\'s stages and steps identifies the stage (the wiki words them differently)', () => {
    const cases: Array<[string, number]> = [
      ['Найти след спецподразделения BEAR', 0],
      ['Найти информацию о Богатырях', 3],
      ['Найти форпост «Карусель»', 4],
      ['Найти личные записи Богатырей', 5],
      ['Обыскать форпост «Гнездо»', 11],
      ['Узнать, где Богатыри попали в засаду', 13],
      ['Осмотреть труп Моремана', 18],
      ['Выйти на связь с Богатырями', 21],
      ['Найти след предателей', 33],
    ]
    for (const [main, stage] of cases) {
      const [batya] = matchStoryChapters('', QUESTS, batyaPane(main))
      expect([main, batya?.questId, batya?.stageIndex]).toEqual([main, 'story-batya', stage])
    }
  })
})
