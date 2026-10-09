import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { addMissingStoryChapters, applyCuratedStoryStages } from './storyChapters'
import { STORY_CHAPTER_SEEDS } from './storyChapterSeeds'
import { STORY_QUEST_INDEX } from './storyQuestIndex'
import { adaptStoryQuestMarkers } from './storyQuestMarkers'
import { maps } from './demo'
import { translateUiText } from '../i18n/uiEnglish'

const CYRILLIC = /[А-Яа-яЁё]/

describe('curated story chapters', () => {
  it('classifies every reference chapter and hides internal objectives from trader sections without duplicate chapters', () => {
    const input = STORY_QUEST_INDEX.flatMap(row => [
      { id: row.questId, normalizedName: row.id, name: row.name, trader: 'Narrator', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
      ...row.objectiveQuestIds.map(id => ({ id, name: 'Internal objective', trader: 'Narrator', level: 1, kappa: false, description: '', objectives: [], rewards: [] })),
    ])
    const classified = addMissingStoryChapters(input)
    expect(classified.filter(quest => quest.kind === 'story')).toHaveLength(10)
    for (const row of STORY_QUEST_INDEX) {
      expect(classified.find(quest => quest.id === row.questId)).toMatchObject({ kind: 'story', storyOrder: row.order })
      for (const id of row.objectiveQuestIds) expect(classified.find(quest => quest.id === id)?.storyChapterId).toBeTruthy()
    }
  })
  it('adds all ten chapters when the wiki gave none, in story order, with stages', () => {
    const quests = applyCuratedStoryStages(addMissingStoryChapters([]))
    expect(quests.map((quest) => quest.id)).toEqual([
      'story-tour', 'story-falling-skies', 'story-batya', 'story-the-unheard', 'story-blue-fire',
      'story-they-are-already-here', 'story-accidental-witness', 'story-the-labyrinth', 'story-the-ticket', 'story-boreas',
    ])
    expect(quests.map((quest) => quest.storyOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    for (const quest of quests) {
      expect(quest.kind).toBe('story')
      expect(quest.stages?.length).toBeGreaterThan(3)
      expect(quest.stages?.every((stage) => CYRILLIC.test(stage.title))).toBe(true)
    }
  })

  it('does not duplicate a chapter the wiki already has (by id or Russian name) and replaces its stages', () => {
    const wiki: Quest[] = [
      { id: 'story-небеса в огне', name: 'Небеса в огне', trader: 'Глава истории', kind: 'story', storyOrder: 2, level: 1, kappa: false, description: '', objectives: [], rewards: [], stages: [{ id: 'w0', title: 'Что-то из wiki', description: '', mapIds: [] }] },
      { id: 'story-boreas', name: 'Борей (глава)', trader: 'Глава истории', kind: 'story', storyOrder: 10, level: 1, kappa: false, description: '', objectives: [], rewards: [] },
    ]
    const quests = applyCuratedStoryStages(addMissingStoryChapters(wiki))
    expect(quests.filter((quest) => quest.kind === 'story')).toHaveLength(10)
    const fallingSkies = quests.find((quest) => quest.id === 'story-небеса в огне')
    expect(fallingSkies?.stages?.[0]?.title).toBe('Расспросить торговцев об упавшем самолёте')
    expect(quests.find((quest) => quest.id === 'story-boreas')?.name).toBe('Борей')
  })

  it('uses English chapter names in the English catalog', () => {
    const quests = addMissingStoryChapters([], 'en')
    expect(quests.find((quest) => quest.id === 'story-falling-skies')?.name).toBe('Falling Skies')
  })

  it('translates every stage title and description to English', { timeout: 60_000 }, () => {
    const quests = applyCuratedStoryStages(addMissingStoryChapters([]))
    for (const quest of quests) {
      expect(CYRILLIC.test(translateUiText(quest.name)), quest.name).toBe(false)
      for (const stage of quest.stages ?? []) {
        expect(CYRILLIC.test(translateUiText(stage.title)), stage.title).toBe(false)
        expect(CYRILLIC.test(translateUiText(stage.description)), stage.description).toBe(false)
      }
    }
  })

  it('puts a stage with known points on the map at those points, including the Tour Terminal intercom', () => {
    const quests = applyCuratedStoryStages(addMissingStoryChapters([]))
    const tour = quests.find((quest) => quest.id === 'story-tour')!
    expect(tour.stages?.[17]?.points?.[0]).toMatchObject({ mapId: 'shoreline' })
    const markers = adaptStoryQuestMarkers(quests, maps, [])
    const intercom = markers.find((marker) => marker.questId === 'story-tour' && marker.stageIndex === 17)
    expect(intercom?.mapId).toBe('shoreline')
    expect(intercom?.approximate).toBe(true)
    expect(intercom?.position).toEqual([265.83, -917.35])
    // An area objective (Lab top management offices) is drawn with its outline.
    const offices = markers.filter((marker) => marker.questId === 'story-tour' && marker.stageIndex === 21 && marker.mapId === 'the-lab')
    expect(offices.some((marker) => (marker.outline?.length ?? 0) >= 3)).toBe(true)
  })

  it('keeps every point on a known map and inside the stage maps', () => {
    for (const chapter of STORY_CHAPTER_SEEDS) {
      for (const stage of chapter.stages) {
        for (const point of stage.points ?? []) {
          expect(maps.some((map) => map.id === point.mapId), `${chapter.id}: ${stage.en}`).toBe(true)
          expect(Number.isFinite(point.x) && Number.isFinite(point.z)).toBe(true)
        }
      }
    }
    const quests = applyCuratedStoryStages(addMissingStoryChapters([]))
    for (const quest of quests) for (const stage of quest.stages ?? []) for (const point of stage.points ?? []) expect(stage.mapIds).toContain(point.mapId)
  })
})
