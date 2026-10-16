import { describe, expect, it } from 'vitest'
import type { AppDataset, RaidMode } from '../domain/types'
import { fetchLiveCatalog } from './catalogSource'
import { SCOURGE_INVASION, SCOURGE_QUEST_IDS } from './curatedQuests'
import { definitionOfBuiltIn, type EventQuestDefinition } from './eventQuestDefinitions'
import { nextEventEnd, withEventQuests } from './eventQuests'
import { OTHER_TASK_ID, toTheLightFetcher } from './__fixtures__/toTheLightFeed'

/**
 * The app lays the owner's event quests over the catalog it has (src/data/eventQuests.ts) the moment they change, the
 * same way the server's next catalog build adds them (src/data/catalogSource.ts).
 */
const noWiki = { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) }
const DURING_EVENT = Date.UTC(2026, 9, 16, 12)
const END = Date.parse(SCOURGE_INVASION.endsAt!)
const catalogs = new Map<string, Promise<AppDataset>>()
const catalog = (mode: RaidMode, locale: 'ru' | 'en' = 'ru', eventQuests: EventQuestDefinition[] = []) => {
  const key = `${mode}|${locale}|${JSON.stringify(eventQuests)}`
  if (!catalogs.has(key)) catalogs.set(key, fetchLiveCatalog(mode, locale, toTheLightFetcher(), { ...noWiki, eventQuests: () => eventQuests, now: DURING_EVENT }))
  return catalogs.get(key)!
}
/** The catalog with a map point on the first quest (the feed of the tests has no Factory transits). */
const withPoint = (data: AppDataset): AppDataset => ({
  ...data,
  quests: data.quests.map((quest) => (quest.id === SCOURGE_QUEST_IDS.hiddenRoute
    ? { ...quest, objectiveDetails: quest.objectiveDetails!.map((objective) => ({ ...objective, zones: [{ id: 'transit-14', mapId: 'factory', position: { x: 1, y: 2, z: 3 } }], zoneBound: true })) }
    : quest)),
  markers: [...data.markers, { ...data.markers[0], id: 'scourge-transit', questId: SCOURGE_QUEST_IDS.hiddenRoute, mapId: 'factory' }],
})
const builtIn = (id: string) => definitionOfBuiltIn(SCOURGE_INVASION, SCOURGE_INVASION.quests.find((quest) => quest.id === id)!)
const renamed: EventQuestDefinition = { ...builtIn(SCOURGE_QUEST_IDS.coordination), name: { ru: 'Нарушить координацию', en: 'Disrupt the Coordination' } }
const fourth: EventQuestDefinition = {
  id: 'raidos-event-green1',
  trader: '54cb57776803fa99248b456e',
  name: { ru: 'Зелёный коридор', en: 'Green Corridor' },
  after: [SCOURGE_QUEST_IDS.coordination],
  experience: 30_000,
  objectives: [{ type: 'extract', maps: ['the-lab'], text: { ru: 'Выжить и выйти с локации Лаборатория', en: 'Survive and extract from The Lab' } }],
  note: { ru: 'Четвёртое задание.', en: 'The fourth task.' },
  modes: ['pvp', 'pve', 'seasonal'],
  series: { name: { ru: 'Вторжение Scourge', en: 'Scourge Invasion' }, route: { ru: 'ивент до 20 октября', en: 'event until 20 October' } },
  endsAt: SCOURGE_INVASION.endsAt,
  createdAt: '2026-10-16T12:01:00.000Z',
}

describe('the owner\'s event quests in the app, before the next catalog', () => {
  it('nothing defined, the event on: the very same catalog', async () => {
    const data = await catalog('pvp')
    expect(withEventQuests(data, undefined, { mode: 'pvp', lang: 'ru', now: DURING_EVENT })).toBe(data)
    expect(withEventQuests(data, [], { mode: 'pvp', lang: 'ru', now: DURING_EVENT })).toBe(data)
  })

  it('«???» renamed at once, in both languages and for the screen reader; its map point stays', async () => {
    const data = await catalog('pvp')
    const next = withEventQuests(data, [renamed], { mode: 'pvp', lang: 'ru', now: DURING_EVENT })
    const third = next.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.coordination)!
    expect(third.name).toBe('Нарушить координацию')
    expect([third.nameRu, third.nameEn]).toEqual(['Нарушить координацию', 'Disrupt the Coordination'])
    expect(third.ocrAliases).toBeUndefined()
    expect(third.requirements?.map((need) => need.taskId)).toEqual([SCOURGE_QUEST_IDS.simpleTask])
    expect(third.description).toContain('Серия «Вторжение Scourge» (ивент до 20 октября), задание 3 из 3.')
    // the first quest's transit point is the catalog's (the app has no map places of its own)
    const pointed = withPoint(data)
    const route = pointed.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.hiddenRoute)!
    const renamedRoute = withEventQuests(pointed, [{ ...builtIn(SCOURGE_QUEST_IDS.hiddenRoute), name: { ru: 'Маршрут', en: 'Route' } }], { mode: 'pvp', lang: 'ru', now: DURING_EVENT })
      .quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.hiddenRoute)!
    expect(renamedRoute.objectiveDetails?.[0].zones).toEqual(route.objectiveDetails?.[0].zones)
    expect(renamedRoute.ocrAliases).toEqual(['Скрытый маршрут', 'Hidden Route'])
    expect(next.quests.find((quest) => quest.id === OTHER_TASK_ID)).toBe(data.quests.find((quest) => quest.id === OTHER_TASK_ID))
    const english = withEventQuests(await catalog('pvp', 'en'), [renamed], { mode: 'pvp', lang: 'en', now: DURING_EVENT })
    expect(english.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.coordination)!.name).toBe('Disrupt the Coordination')
  })

  it('a new quest is added; the same as the next catalog build gives', async () => {
    const data = await catalog('pve')
    const next = withEventQuests(data, [fourth], { mode: 'pve', lang: 'ru', now: DURING_EVENT })
    const added = next.quests.find((quest) => quest.id === fourth.id)!
    const built = (await catalog('pve', 'ru', [fourth])).quests.find((quest) => quest.id === fourth.id)!
    for (const field of ['name', 'trader', 'traderId', 'description', 'objectives', 'mapIds', 'requirements', 'rewards', 'experience', 'curatedSeriesId'] as const) {
      expect(added[field]).toEqual(built[field])
    }
    expect(next.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.hiddenRoute)!.description).toContain('задание 1 из 4.')
  })

  it('switched off, over, or no longer defined: the quest and its map points leave', async () => {
    const data = withPoint(await catalog('pvp'))
    const off = withEventQuests(data, [{ ...builtIn(SCOURGE_QUEST_IDS.hiddenRoute), hidden: true }], { mode: 'pvp', lang: 'ru', now: DURING_EVENT })
    expect(off.quests.some((quest) => quest.id === SCOURGE_QUEST_IDS.hiddenRoute)).toBe(false)
    expect(off.markers.some((marker) => marker.questId === SCOURGE_QUEST_IDS.hiddenRoute)).toBe(false)
    expect(off.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.simpleTask)!.description).toContain('задание 1 из 2.')

    // the event is over: without anything defined (the server not reached) too
    const over = withEventQuests(data, undefined, { mode: 'pvp', lang: 'ru', now: END })
    expect(over.quests.some((quest) => (Object.values(SCOURGE_QUEST_IDS) as string[]).includes(quest.id))).toBe(false)
    expect(over.quests.length).toBe(data.quests.length - 3)

    // the owner deleted his quest: the catalog built before still has it
    const withFourth = await catalog('pvp', 'ru', [fourth])
    expect(withFourth.quests.some((quest) => quest.id === fourth.id)).toBe(true)
    expect(withEventQuests(withFourth, [], { mode: 'pvp', lang: 'ru', now: DURING_EVENT }).quests.some((quest) => quest.id === fourth.id)).toBe(false)
    expect(withEventQuests(withFourth, undefined, { mode: 'pvp', lang: 'ru', now: DURING_EVENT }).quests.some((quest) => quest.id === fourth.id)).toBe(true)
    // a mode the quest is not in
    const pveOnly = { ...fourth, modes: ['pve' as const] }
    expect(withEventQuests(withFourth, [pveOnly], { mode: 'pvp', lang: 'ru', now: DURING_EVENT }).quests.some((quest) => quest.id === fourth.id)).toBe(false)
  })

  it('the clock moves on at the next end', () => {
    expect(nextEventEnd(undefined, DURING_EVENT)).toBe(END)
    expect(nextEventEnd([{ ...renamed, endsAt: '2026-10-18T00:00:00.000Z' }], DURING_EVENT)).toBe(Date.parse('2026-10-18T00:00:00.000Z'))
    expect(nextEventEnd(undefined, END)).toBeUndefined()
  })
})
