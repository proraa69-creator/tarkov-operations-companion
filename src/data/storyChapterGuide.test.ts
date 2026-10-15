import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters, applyCuratedStoryStages, storyChapterTitles } from './storyChapters'
import { STORY_BRANCHES, STORY_CHAPTER_SEEDS } from './storyChapterSeeds'
import { STORY_GUIDE_DATA } from './storyChapterGuideData'
import { storyChapterGuide, storyGuideChapterId, storyGuideSearchText } from './storyChapterGuide'
import { maps } from './demo'

const CYRILLIC = /[А-Яа-яЁё]/
const CHAPTER_IDS = ['tour', 'falling-skies', 'batya', 'the-unheard', 'blue-fire', 'they-are-already-here', 'accidental-witness', 'the-labyrinth', 'the-ticket', 'boreas']
const build = (locale: 'ru' | 'en') => applyCuratedStoryStages(addMissingStoryChapters([], locale))
const MAP_IDS = new Set([...maps.map((map) => map.id), 'icebreaker', 'terminal', 'the-labyrinth'])

describe('story chapter data (seeds + the full guide)', () => {
  it('has every chapter of the 1.0 storyline once, with Russian and English titles and stages in both languages', () => {
    expect(new Set(STORY_CHAPTER_SEEDS.map((chapter) => chapter.id)).size).toBe(STORY_CHAPTER_SEEDS.length)
    expect(STORY_GUIDE_DATA.map((chapter) => chapter.id)).toEqual(CHAPTER_IDS)
    for (const chapter of STORY_CHAPTER_SEEDS) {
      expect(CYRILLIC.test(chapter.ru), chapter.id).toBe(true)
      expect(CYRILLIC.test(chapter.en), chapter.id).toBe(false)
      expect(chapter.aliases, chapter.id).toEqual(expect.arrayContaining([chapter.ru, chapter.en]))
      for (const stage of chapter.stages) {
        expect(stage.ru.trim() && stage.en.trim(), `${chapter.id}: ${stage.en}`).toBeTruthy()
        expect(CYRILLIC.test(stage.ru), stage.ru).toBe(true)
        if (stage.branch) expect(STORY_BRANCHES[stage.branch], stage.branch).toBeTruthy()
        for (const step of stage.steps ?? []) expect(step.ru.trim() && step.en.trim()).toBeTruthy()
      }
    }
  })

  it('lists every tracked stage of every chapter in the guide, with valid stage numbers, maps and two languages', () => {
    for (const quest of build('ru')) {
      const data = STORY_GUIDE_DATA.find((chapter) => `story-${chapter.id}` === quest.id)!
      const stages = quest.stages ?? []
      const linked = data.objectives.filter((row) => row.stage != null).map((row) => row.stage!)
      expect(linked.every((index) => index >= 0 && index < stages.length), quest.id).toBe(true)
      // every stage the app tracks shows up in the full list
      expect(new Set(linked).size, quest.id).toBe(stages.length)
      for (const row of data.objectives) {
        if (row.stage == null) {
          expect(row.untracked, `${quest.id}: ${row.en}`).toBe(true)
          expect(row.en && row.ru && CYRILLIC.test(row.ru), `${quest.id}: ${row.en}`).toBeTruthy()
        }
        for (const mapId of row.maps ?? []) expect(MAP_IDS.has(mapId), mapId).toBe(true)
        for (const step of row.steps ?? []) expect(step.en && step.ru && !step.ru.startsWith('@@'), step.en).toBeTruthy()
        for (const item of row.items ?? []) {
          expect(item.en && item.ru, JSON.stringify(item)).toBeTruthy()
          expect(['handover', 'find', 'place', 'bring', 'key', 'need']).toContain(item.role)
          if (item.id) expect(item.id).toMatch(/^[0-9a-f]{24}$/)
        }
        if (row.branch) expect(STORY_BRANCHES[row.branch], row.branch).toBeTruthy()
      }
      expect(data.unlock.en && data.unlock.ru, quest.id).toBeTruthy()
      for (const group of data.rewards) expect(group.title.en || group.title.ru).toBeTruthy()
    }
  })

  it('joins the guide with a chapter of the base: stage titles in both languages, its maps and its keys', () => {
    const quests = build('ru')
    const fallingSkies = storyChapterGuide(quests.find((quest) => quest.id === 'story-falling-skies')!)
    expect(fallingSkies.title).toEqual({ ru: 'Небеса в огне', en: 'Falling Skies' })
    const recorder = fallingSkies.objectives.find((objective) => objective.stage === 7)!
    expect(recorder.text).toEqual({ ru: 'Забрать бортовой самописец самолёта', en: 'Retrieve the plane\'s flight recorder' })
    expect(recorder.maps).toContain('woods')
    expect(recorder.pointMaps).toEqual(['woods'])
    expect(recorder.items.map((item) => item.en)).toEqual(['Crashed plane\'s flight recorder'])
    // the wiki's objective the game capture did not have, in both languages
    expect(fallingSkies.objectives[0]).toMatchObject({ untracked: true, text: { en: 'Locate the fallen plane', ru: 'Найти упавший самолёт' } })
    // items to hand over with their counts and «found in raid»
    const batteries = fallingSkies.objectives.flatMap((objective) => objective.items).find((item) => item.en === 'Rechargeable battery')
    expect(batteries).toMatchObject({ id: '590a358486f77429692b2790', count: 3, role: 'handover', fir: true })
    // the endings each route of The Ticket leads to
    const ticket = storyChapterGuide(quests.find((quest) => quest.id === 'story-the-ticket')!)
    expect(ticket.objectives.find((objective) => objective.branch?.key === 'If you refuse Mr. Kerman\'s offer')?.endings).toEqual(['survivor'])
    // keys a chapter needs
    const witness = storyChapterGuide(quests.find((quest) => quest.id === 'story-accidental-witness')!)
    expect(witness.keys.map((item) => item.en)).toEqual(expect.arrayContaining(['Dorm room 110 key', 'Zmeisky 3 apartment key']))
    // Tour: the base's Russian stage titles, the wiki's English
    const tour = storyChapterGuide(quests.find((quest) => quest.id === 'story-tour')!)
    expect(tour.objectives[0].text).toEqual({ ru: 'Выбраться из Эпицентра', en: 'Escape Ground Zero' })
    expect(tour.objectives).toHaveLength(22)
    expect(storyGuideSearchText(tour, 'en')).toContain('8,000 usd')
  })

  it('shows the same chapters, stages and objectives in the Russian and the English catalog', () => {
    const ru = build('ru'), en = build('en')
    expect(addMissingStoryChapters([], 'en').map((quest) => quest.name)).toEqual(STORY_GUIDE_DATA.map((chapter) => storyChapterTitles({ id: `story-${chapter.id}`, name: '' })!.en))
    expect(en.map((quest) => quest.id)).toEqual(ru.map((quest) => quest.id))
    expect(ru.map((quest) => quest.id)).toEqual(CHAPTER_IDS.map((id) => `story-${id}`))
    for (const [index, quest] of ru.entries()) {
      const english = en[index]
      expect(english.stages?.length).toBe(quest.stages?.length)
      expect(storyChapterGuide(english).objectives.length).toBe(storyChapterGuide(quest).objectives.length)
      expect(storyGuideChapterId(english)).toBe(storyGuideChapterId(quest))
      // the screen reader matches both titles whatever the catalog language (nameRu / nameEn of the server's base)
      expect(storyChapterTitles(english)).toEqual(storyChapterTitles(quest))
      expect(CYRILLIC.test(storyChapterTitles(quest)!.en)).toBe(false)
    }
  })

  it('keeps the corrections checked against the wiki', () => {
    const tour = build('ru').find((quest) => quest.id === 'story-tour')!
    // Lighthouse access: 8,000 USD to Mechanic (both wikis, 15.10.2026), not 20,000
    expect(tour.stages?.[20].description).toContain('8 000 долларов')
    const ticket = STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === 'the-ticket')!
    expect(ticket.stages[46]).toMatchObject({ en: 'Agree to find dirt on TerraGroup for Mr. Kerman', branch: 'If you accept Mr. Kerman\'s offer and agree to find evidence on TerraGroup' })
    expect(ticket.stages[84]).toMatchObject({ en: 'Ask the traders how to leave Tarkov', branch: 'If you accept Mr. Kerman\'s offer and refuse to find evidence on TerraGroup' })
    const boreas = STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === 'boreas')!
    expect(boreas.stages[29]).toMatchObject({ en: 'Arrive at the icebreaker' })
    expect(boreas.stages[29].branch).toBeUndefined()
  })
})
