// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import { STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'
import { storyRaidNeedsAhead, storyStageRaidNeeds } from './storyRaidNeeds'

const chapterOf = (id: string) => {
  const seed = STORY_CHAPTER_SEEDS.find((entry) => entry.id === id)!
  return { id: `story-${id}`, name: seed.ru, normalizedName: id, kind: 'story', stages: seed.stages.map((stage, index) => ({ id: `story-${id}-${index}`, title: stage.ru, description: '', mapIds: stage.mapIds })) } as unknown as Quest
}
const catalog = (...ids: string[]) => new Map(ids.map((id) => [id, { id, name: id } as unknown as Item]))
const stageOf = (id: string, text: RegExp) => STORY_CHAPTER_SEEDS.find((entry) => entry.id === id)!.stages.findIndex((stage) => text.test(stage.en))

describe('«Требования рейда» of a story stage', () => {
  it('a key of the stage: on its maps', () => {
    const quest = chapterOf('they-are-already-here')
    const { requirements, items } = storyStageRaidNeeds(quest, 3, catalog('68e96180901b9b10270f1eed'))
    expect(requirements.map((need) => [need.itemId, need.purpose])).toEqual([['68e96180901b9b10270f1eed', 'key']])
    expect(items).toEqual([])
  })

  it('something to plant, with its map', () => {
    const { requirements } = storyStageRaidNeeds(chapterOf('blue-fire'), 3, catalog('68e63a53371639e1e4004b6e'))
    expect(requirements.map((need) => [need.itemId, need.purpose, need.mapIds])).toEqual([['68e63a53371639e1e4004b6e', 'place', ['the-lab']]])
  })

  it('a stage that names its key only in words finds it in the catalog', () => {
    const stage = stageOf('accidental-witness', /Zmeisky|apartment/i)
    const needs = storyStageRaidNeeds(chapterOf('accidental-witness'), 4, catalog('68e960db934bf7b02d005dab'))
    expect(stage).toBeGreaterThanOrEqual(0)
    expect(needs.requirements[0]).toMatchObject({ itemId: '68e960db934bf7b02d005dab', purpose: 'key' })
  })

  it('what is found or handed to a trader is no part of the kit; another stage asks nothing', () => {
    expect(storyStageRaidNeeds(chapterOf('falling-skies'), 10, catalog()).requirements).toEqual([])
    expect(storyStageRaidNeeds(chapterOf('falling-skies'), 0, catalog()).requirements).toEqual([])
  })

  it('a quest item not in the catalog comes with its name from the guide, in the language of the app', () => {
    const ru = storyStageRaidNeeds(chapterOf('falling-skies'), 8, catalog())
    expect(ru.requirements[0]).toMatchObject({ purpose: 'place' })
    expect(ru.items[0]).toMatchObject({ id: ru.requirements[0]!.itemId, name: 'Чёрный ящик самолёта' })
    expect(storyStageRaidNeeds(chapterOf('falling-skies'), 8, catalog(), 'en').items[0]!.name).not.toMatch(/[а-яё]/i)
  })

  it('a flare of a stage: either of its colour', () => {
    const stage = stageOf('the-ticket', /yellow signal flare/i)
    expect(stage).toBeGreaterThanOrEqual(0)
    const { requirements } = storyStageRaidNeeds(chapterOf('the-ticket'), stage, catalog('624c0b3340357b5f566e8766', '62389be94d5d474bf712e709'))
    expect(requirements.filter((need) => need.purpose === 'signal').map((need) => [need.itemId, need.alternatives])).toEqual([['624c0b3340357b5f566e8766', 2], ['62389be94d5d474bf712e709', 2]])
  })

  it('marked keys that replace each other: one of them', () => {
    const stage = STORY_CHAPTER_SEEDS.find((entry) => entry.id === 'they-are-already-here')!.stages.findIndex((entry) => entry.needs?.includes('marked key'))
    const { requirements } = storyStageRaidNeeds(chapterOf('they-are-already-here'), stage, catalog())
    expect(requirements.filter((need) => need.purpose === 'key').map((need) => need.alternatives)).toEqual([5, 5, 5, 5, 5])
    expect(requirements.filter((need) => need.purpose === 'use')).toHaveLength(1)
  })

  it('a chapter the guide does not know asks nothing', () => {
    expect(storyStageRaidNeeds({ id: 'x', name: 'Неизвестно', normalizedName: 'x', kind: 'story' } as unknown as Quest, 0, catalog())).toEqual({ requirements: [], items: [] })
  })
})

// A player, 13.11.2026: «не показывает что надо с собою взять для сюжетных квестов, к примеру набор инструментов для борея починки вышки».
describe('«Требования рейда» of a story chapter: the stages done in the same raid', () => {
  const TOOLSET = '590c2e1186f77425357b6124'
  it('«Борей» on «Найти оборудование под вышкой» asks for the toolset of «Починить оборудование» there, in Woods', () => {
    const quest = chapterOf('boreas')
    const locate = stageOf('boreas', /^Locate the equipment under the cellular tower/)
    expect(storyStageRaidNeeds(quest, locate, catalog(TOOLSET)).requirements).toEqual([])
    const ahead = storyRaidNeedsAhead(quest, locate, catalog(TOOLSET)).requirements
    expect(ahead.map((need) => [need.itemId, need.purpose, need.mapIds])).toEqual([[TOOLSET, 'use', ['woods']]])
  })

  it('not past a stage on no map or another map: «Отчитаться Механику» after the repair asks nothing ahead', () => {
    const quest = chapterOf('boreas')
    const first = stageOf('boreas', /^Find out from traders/)
    expect(storyRaidNeedsAhead(quest, first, catalog(TOOLSET)).requirements).toEqual([])
    const report = stageOf('boreas', /^Report back to Mechanic/)
    expect(storyRaidNeedsAhead(quest, report, catalog(TOOLSET)).requirements).toEqual([])
  })
})
