import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters } from '../data/storyChapters'
import type { Quest } from '../domain/types'
import { isModeSelectText, isTraderScreenText, traderScreenParts } from './modeSelectScreen'
import { matchQuestsFromOcr, rowStatus } from './questOcr'
import { isTasksMenuText } from './screenScanSync'
import { isStoryMenuText, matchStoryChapters } from './storyScan'
import {
  ENGLISH_MODE_SELECT, ENGLISH_STORY_BATYA, ENGLISH_STORY_BOREAS, ENGLISH_STORY_TOUR, ENGLISH_TABLE_QUESTS, ENGLISH_TASKS_SIDE,
  ENGLISH_TASKS_SIDE_SCROLLED, ENGLISH_TRADER_TASKS, ENGLISH_TRADERS, ENGLISH_TRADERS_SIZE, ENGLISH_TRADERS_WORDS,
} from './__fixtures__/englishGameOcr'

// The English game (owner's PvE screenshots, 14.10.2026): players of the English client got nothing from the screen —
// the Tasks menu was told by its Russian words only.
const trader = ENGLISH_TABLE_QUESTS.map(([id, name, normalizedName]) => ({
  id, name, normalizedName, trader: 'Prapor', level: 1, kappa: false, description: '', objectives: [], rewards: [],
} as Quest))
const slugOf = (id: string) => trader.find((quest) => quest.id === id)?.normalizedName

describe('the English game', () => {
  it('tells the Tasks menu from the other screens', () => {
    for (const text of [ENGLISH_TASKS_SIDE, ENGLISH_TASKS_SIDE_SCROLLED, ENGLISH_STORY_TOUR.screen, ENGLISH_STORY_BATYA.screen, ENGLISH_STORY_BOREAS.screen]) {
      expect(isTasksMenuText(text)).toBe(true)
    }
    // A trader's own Tasks tab lists quests not taken yet too: never read as the table of current quests.
    for (const text of [ENGLISH_MODE_SELECT, ENGLISH_TRADERS, ENGLISH_TRADER_TASKS]) expect(isTasksMenuText(text)).toBe(false)
    expect(isStoryMenuText(ENGLISH_STORY_TOUR.screen)).toBe(true)
    expect(isStoryMenuText(ENGLISH_TASKS_SIDE)).toBe(false)
  })

  it('reads every visible row of the Tasks table, each as active', () => {
    const top = matchQuestsFromOcr(ENGLISH_TASKS_SIDE, trader)
    expect(top.map((match) => slugOf(match.questId)).sort()).toEqual([
      'all-this-filth', 'dragnet', 'fishing-place', 'psycho-sniper', 'stray-dogs', 'the-huntsman-path-administrator',
      'the-huntsman-path-control', 'the-huntsman-path-controller', 'the-huntsman-path-woods-keeper',
    ])
    expect(top.every((match) => match.status === 'active')).toBe(true)
    const scrolled = matchQuestsFromOcr(ENGLISH_TASKS_SIDE_SCROLLED, trader)
    expect(scrolled.map((match) => slugOf(match.questId)).sort()).toEqual([
      'all-is-revealed', 'best-job-in-the-world', 'district-patrol', 'easy-breezy', 'getting-some-air', 'intimidator',
      'job-for-a-patriot', 'our-own-land-bear', 'unique-experience',
    ])
    expect(scrolled.every((match) => match.status === 'active')).toBe(true)
  })

  it('reads the status cell as the game writes it', () => {
    expect(rowStatus('* №1 9 Dragnet Factory activel 8%')).toBe('active')
    expect(rowStatus('Stray Dogs Any location active! 0%')).toBe('active')
    expect(rowStatus('Shooting Cans Any location available')).toBe('available')
    expect(rowStatus('Background Check Customs failed')).toBe('failed')
    expect(rowStatus('Gunsmith - Part 2 Any location locked')).toBe('locked')
    expect(rowStatus('Debut Any location completed!')).toBe('ready')
    expect(rowStatus('Unlocked doors Any location')).toBeUndefined()
  })

  it('finds the nickname and the level row of the traders screen', () => {
    expect(isTraderScreenText(ENGLISH_TRADERS)).toBe(true)
    const parts = traderScreenParts(ENGLISH_TRADERS_WORDS, ENGLISH_TRADERS_SIZE)
    // The whole pass read «Raid_0S»: the close-up confirms the name before it counts (electron/screenOcr.ts).
    expect(parts.nickname?.value).toBe('Raid_0S')
    // «LVL» came out as «wi»: the level still gets a close-up, with the word before it.
    expect(parts.level?.value).toBe(41)
    expect(parts.level!.box.width).toBeGreaterThan(60)
  })

  it('knows the mode selection screen', () => {
    expect(isModeSelectText(ENGLISH_MODE_SELECT)).toBe(true)
  })

  for (const locale of ['ru', 'en'] as const) {
    it(`reads story chapters from the pane parts, with the ${locale === 'ru' ? 'Russian' : 'English'} interface`, () => {
      const story = addMissingStoryChapters([], locale)
      const [tour] = matchStoryChapters(ENGLISH_STORY_TOUR.screen, story, ENGLISH_STORY_TOUR.parts)
      expect(tour).toMatchObject({ questId: 'story-tour', active: true })
      expect(tour!.objectives?.map((objective) => [objective.text, objective.optional, objective.current, objective.total])).toEqual([
        ['Talk to Skier', false, undefined, undefined],
        ['Visit Woods', true, 1, 3],
      ])
      const [batya] = matchStoryChapters(ENGLISH_STORY_BATYA.screen, story, ENGLISH_STORY_BATYA.parts)
      expect(batya).toMatchObject({ questId: 'story-batya', stageIndex: 1 })
      expect(batya!.objectives?.[0]?.text).toBe('Learn more about the Bogatyr squad from the traders')
      const [boreas] = matchStoryChapters(ENGLISH_STORY_BOREAS.screen, story, ENGLISH_STORY_BOREAS.parts)
      expect(boreas).toMatchObject({ questId: 'story-boreas', stageIndex: 2, active: true })
    })
  }

  it('knows the other chapters by their English name and objectives too (no screenshot of them)', () => {
    // owner, 14.10.2026: «если есть другие главы сюжета, которых у меня нету, обнаруживай их аналогично»
    const story = addMissingStoryChapters([], 'ru')
    const parts = { title: 'CHAPTER\nFalling Skies >', status: 'ACTIVE\n', body: 'Main objectives\n[] Hand over the cash to Therapist\nOptional objectives\n[] Collect the required amount in USD\n' }
    const [chapter] = matchStoryChapters('', story, parts)
    expect(chapter).toMatchObject({ questId: 'story-falling-skies', stageIndex: 3, active: true })
  })
})
