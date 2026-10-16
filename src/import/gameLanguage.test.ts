import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters } from '../data/storyChapters'
import type { Quest } from '../domain/types'
import { matchQuestsFromOcr, questTitles } from './questOcr'
import { matchStoryChapters, storyPaneChapter } from './storyScan'
import { ENGLISH_STORY_BATYA, ENGLISH_TABLE_QUESTS, ENGLISH_TASKS_SIDE, ENGLISH_TASKS_SIDE_SCROLLED } from './__fixtures__/englishGameOcr'
import { RU_TABLE_QUESTS, RU_TASKS_TABLE } from './__fixtures__/russianTasksTable'
import { PVP_BATYA, PVP_FALLING_SKIES } from './__fixtures__/storyPanesPvp'

/**
 * The game's language is not the app's (audit P11; product roadmap: «Quest counts must not change when switching
 * interface language»). Titles were matched against `name` — the app's language — and the English slug only: a Russian
 * game read by the English app found no trader quest at all.
 */
const quest = (fields: Partial<Quest> & Pick<Quest, 'id' | 'name'>): Quest => ({ trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...fields })
/** The English title the slug spells («the-huntsman-path-controller» → «The Huntsman Path Controller»). */
const english = (slug: string) => slug.split('-').map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ')
const ids = (matches: Array<{ questId: string }>) => matches.map((match) => match.questId).sort()

describe('a Russian game read by the English app', () => {
  // The English catalog: `name` is English, the game's Russian title is `nameRu` (src/i18n/englishDataset.ts).
  const englishUi = RU_TABLE_QUESTS.map(([id, name]) => quest({ id, name: `EN ${id}`, nameRu: name, nameEn: `EN ${id}` }))

  it('finds every row of the Russian Tasks table', () => {
    expect(ids(matchQuestsFromOcr(RU_TASKS_TABLE, englishUi))).toEqual(RU_TABLE_QUESTS.map(([id]) => id).sort())
  })

  it('finds as many quests as the Russian app does', () => {
    const russianUi = RU_TABLE_QUESTS.map(([id, name]) => quest({ id, name }))
    expect(ids(matchQuestsFromOcr(RU_TASKS_TABLE, englishUi))).toEqual(ids(matchQuestsFromOcr(RU_TASKS_TABLE, russianUi)))
  })

  it('knows a story chapter by its Russian name, also from a catalog without `nameRu`', () => {
    const story = addMissingStoryChapters([], 'en')
    expect(story.find((entry) => entry.id === 'story-falling-skies')?.name).toBe('Falling Skies')
    const [falling] = matchStoryChapters(PVP_FALLING_SKIES, story)
    expect(falling).toMatchObject({ questId: 'story-falling-skies', stageIndex: 0, active: true })
    expect(storyPaneChapter(PVP_BATYA, story.filter((entry) => entry.kind === 'story'))?.quest.id).toBe('story-batya')
  })
})

describe('an English game read by the Russian app', () => {
  // The Russian catalog: `name` is Russian, the game's English title is `nameEn`; no slug to fall back on.
  const russianUi = ENGLISH_TABLE_QUESTS.map(([id, name, slug]) => quest({ id, name, nameRu: name, nameEn: english(slug) }))

  it('finds every row of the English Tasks table by `nameEn`', () => {
    for (const [text, count] of [[ENGLISH_TASKS_SIDE, 9], [ENGLISH_TASKS_SIDE_SCROLLED, 9]] as const) {
      const found = matchQuestsFromOcr(text, russianUi)
      expect(found).toHaveLength(count)
      expect(found.every((match) => match.status === 'active')).toBe(true)
    }
  })

  it('finds the same quests with the English app', () => {
    const englishUi = ENGLISH_TABLE_QUESTS.map(([id, name, slug]) => quest({ id, name: english(slug), nameRu: name, nameEn: english(slug) }))
    for (const text of [ENGLISH_TASKS_SIDE, ENGLISH_TASKS_SIDE_SCROLLED]) {
      expect(ids(matchQuestsFromOcr(text, englishUi))).toEqual(ids(matchQuestsFromOcr(text, russianUi)))
    }
  })

  it('knows a story chapter by its English name', () => {
    const [batya] = matchStoryChapters(ENGLISH_STORY_BATYA.screen, addMissingStoryChapters([], 'ru'), ENGLISH_STORY_BATYA.parts)
    expect(batya).toMatchObject({ questId: 'story-batya', stageIndex: 1 })
  })
})

describe('the titles a quest is matched by', () => {
  it('are the app\'s name, both game titles and the other wordings, each once', () => {
    const renamed = quest({ id: 'q', name: 'Old Name', nameRu: 'Новое имя', nameEn: 'Old Name', ocrAliases: ['Старое имя'] })
    expect(questTitles(renamed)).toEqual(['Old Name', 'Новое имя', 'Старое имя'])
    expect(ids(matchQuestsFromOcr('Класс Задание Локация Статус\nСтарое имя Любая локация активно!', [renamed]))).toEqual(['q'])
  })

  it('of a story chapter include the names its seed knows', () => {
    const [unheard] = addMissingStoryChapters([], 'ru').filter((entry) => entry.id === 'story-the-unheard')
    expect(questTitles(unheard!)).toEqual(expect.arrayContaining(['Неизвестные', 'The Unheard', 'Неуслышанные']))
  })
})
