import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { addMissingStoryChapters, applyCuratedStoryStages, storyChapterTitles } from './storyChapters'
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

  it('«Батя»: the first stage\'s points are where the patch lies, each saying where; the places that start the chapter are not among them (a player, 04.11.2026)', () => {
    const quests = applyCuratedStoryStages(addMissingStoryChapters([]))
    const stage = quests.find((quest) => quest.id === 'story-batya')!.stages![0]!
    expect(stage.points?.map((point) => point.mapId)).toEqual(['customs', 'reserve', 'woods', 'lighthouse'])
    expect(stage.mapIds).not.toContain('shoreline')
    const markers = adaptStoryQuestMarkers(quests, maps, []).filter((marker) => marker.questId === 'story-batya' && marker.stageIndex === 0)
    expect(markers.length).toBeGreaterThan(0)
    for (const marker of markers) {
      expect(marker.description).toMatch(/^Шеврон отряда «Богатыри»: /)
      expect(CYRILLIC.test(translateUiText(marker.description ?? ''))).toBe(false)
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

describe('story chapter titles (the server quest base: nameRu, nameEn, ocrAliases)', () => {
  it('gives every curated chapter its Russian and English names, whatever the catalog language', () => {
    for (const locale of ['ru', 'en'] as const) {
      const quests = applyCuratedStoryStages(addMissingStoryChapters([], locale))
      expect(quests).toHaveLength(10)
      for (const quest of quests) {
        const titles = storyChapterTitles(quest)
        expect(titles?.id, quest.id).toBe(quest.id)
        expect(CYRILLIC.test(titles!.ru)).toBe(true)
        expect(CYRILLIC.test(titles!.en)).toBe(false)
      }
    }
    expect(storyChapterTitles({ id: 'story-tour', name: 'Тур', normalizedName: 'tour' })).toEqual({ id: 'story-tour', ru: 'Тур', en: 'Tour', aliases: ['Tour'] })
  })

  it('finds a chapter the wiki named its own way by its other names, and nothing for a trader quest', () => {
    expect(storyChapterTitles({ id: 'story-небеса в огне', name: 'Падающие небеса' })).toEqual({
      id: 'story-falling-skies', ru: 'Небеса в огне', en: 'Falling Skies', aliases: ['Небеса в огне', 'Падающие небеса', 'Falling Skies'],
    })
    expect(storyChapterTitles({ id: '5936d90786f7742b1420ba5b', name: 'Дефицит' })).toBeUndefined()
  })
})

describe('«Неизвестные»: the steps about A.P. (a player, 24.11.2026: «почему нельзя посмотреть точки на карте по квесту неизвестные»)', () => {
  it('«Узнать больше о деятельности/роли А.П.» show the Lab places, as «Найти в Лаборатории любые упоминания А.П.»', () => {
    const chapter = STORY_CHAPTER_SEEDS.find((entry) => entry.id === 'the-unheard')!
    const stage = (ru: string) => chapter.stages.find((entry) => entry.ru === ru)!
    const lab = stage('Найти в Лаборатории любые упоминания А.П.')
    for (const ru of ['Узнать больше о деятельности А.П.', 'Узнать больше о роли А.П.']) {
      expect(stage(ru).mapIds).toEqual(['the-lab'])
      expect(stage(ru).points).toEqual(lab.points)
      expect(stage(ru).points?.length).toBe(3)
    }
  })
})

describe('«Неизвестные» against the EFT wiki and tarkovforge (a player, 25.11.2026: «маркер показывает не те ключи, не от санатория а от улиц таркова»)', () => {
  const chapter = STORY_CHAPTER_SEEDS.find((entry) => entry.id === 'the-unheard')!
  const stage = (index: number) => chapter.stages[index]!
  const onMap = (index: number, mapId: string) => (stage(index).points ?? []).filter((point) => point.mapId === mapId)

  it('the note of the first stage may be on Ground Zero too; «Узнать больше о деятельности TerraGroup» is in The Lab, the fax in O23', () => {
    expect(stage(0).mapIds).toEqual(['streets-of-tarkov', 'ground-zero'])
    expect(onMap(0, 'ground-zero')[0]?.note).toContain('ключ от научного офиса TerraGroup')
    expect(stage(1)).toMatchObject({ en: 'Learn more about TerraGroup\'s activities', mapIds: ['the-lab'] })
    expect(stage(1).needs).toBeUndefined()
    expect(stage(1).points?.map((point) => [point.mapId, point.x, point.z])).toEqual([['the-lab', -161.37, -374.86]])
    expect(stage(2).points?.map((point) => [point.mapId, point.x, point.z, point.y])).toEqual([['the-lab', -152.49, -403.37, 5.2]])
  })

  it('both Factory storage room stages need the storage room keycard and are in the tunnels', () => {
    for (const index of [7, 8]) {
      expect(stage(index).needs).toBe('TerraGroup storage room keycard')
      expect(onMap(index, 'factory')).toHaveLength(1)
      expect(onMap(index, 'factory')[0]).toMatchObject({ x: -20.57, z: 47.24, y: -2 })
    }
  })

  it('A.P.\'s room is east wing room 305 on Shoreline; its stages need no key; the guard post note is in the west wing', () => {
    // east wing room locks of the catalog: x −286…−357; west wing: x −142…−230
    const eastWing = (x: number) => x <= -268 && x >= -364
    for (const index of [13, 14, 15]) {
      expect(stage(index).mapIds).toEqual(['shoreline'])
      expect(stage(index).needs).toBeUndefined()
      expect(eastWing(stage(index).points![0]!.x)).toBe(true)
    }
    expect(stage(13).points![0]!.note).toContain('305 восточного крыла')
    expect(stage(13).points![1]).toMatchObject({ x: -194.53, z: -84.99 })
    expect(stage(13).points![1]!.note).toContain('Записка на посту охраны')
  })

  it('the apartment and its hidden room are on Streets, with the corporate apartment key and the green keycard', () => {
    expect(stage(22).needs).toBe('TerraGroup corporate apartment key')
    expect(stage(23).needs).toBe('TerraGroup corporate apartment key')
    expect(stage(24).needs).toBe('Reprogrammed keycard for A.P.\'s apartment lock (Green)')
    for (const index of [22, 23, 24, 25, 26, 27, 29]) expect(onMap(index, 'streets-of-tarkov')).toHaveLength(1)
    for (const index of [23, 24, 25, 26, 27, 29]) expect(onMap(index, 'streets-of-tarkov')[0]).toMatchObject({ x: 132.02, z: -24.66 })
  })

  it('every point note of the chapter has its English', () => {
    const notes = chapter.stages.flatMap((entry) => (entry.points ?? []).flatMap((point) => point.note ? [point.note] : []))
    expect(notes.length).toBeGreaterThan(10)
    for (const note of notes) expect(translateUiText(note)).not.toMatch(CYRILLIC)
  })
})
