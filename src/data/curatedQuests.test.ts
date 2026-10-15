import { describe, expect, it } from 'vitest'
import type { RaidMode } from '../domain/types'
import { fetchLiveCatalog } from './catalogSource'
import { TO_THE_LIGHT, TO_THE_LIGHT_IDS } from './curatedQuests'
import { INFORMATION_SOURCE_ID, OTHER_TASK_ID, toTheLightFetcher, type FeedOptions } from './__fixtures__/toTheLightFeed'
import ownerLogs from '../progression/__fixtures__/owner-logs-2026-09.json'

const noWiki = { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) }
const build = (mode: RaidMode, locale: 'ru' | 'en', options: FeedOptions = {}) => fetchLiveCatalog(mode, locale, toTheLightFetcher(options), noWiki)

const ORDER = [
  TO_THE_LIGHT_IDS.trustButVerify, TO_THE_LIGHT_IDS.falseCall, TO_THE_LIGHT_IDS.someoneCalled, TO_THE_LIGHT_IDS.clipTheirWings,
  TO_THE_LIGHT_IDS.fallenBird, TO_THE_LIGHT_IDS.dangerousAmbitions, TO_THE_LIGHT_IDS.biteTheDust, TO_THE_LIGHT_IDS.throwStones,
  TO_THE_LIGHT_IDS.gatherStones, TO_THE_LIGHT_IDS.otherSide, TO_THE_LIGHT_IDS.gettingAcquainted,
]
const SERIES = new Set<string>(ORDER)
const RESEARCH_NOTE = /tarkov\.(help|dev)|tarkov-?dev|wiki|вики|fandom|координат|coordinat|источник(и|а|ов)? (не|даёт)|no source|игра \d|game \d/i

const RU_NAMES = [
  'На свет. Доверяй, но проверяй', 'На свет. Ложный вызов', 'На свет. Вызывали?', 'На свет. Подрезать крылья', 'На свет. Павшая птица',
  'На свет. Опасные амбиции', 'На свет. Фиаско', 'На свет. Время разбрасывать камни', 'На свет. Время собирать камни', 'На свет. Изнанка',
  'На свет. Новое знакомство',
]
const EN_NAMES = [
  'To the Light - Trust but Verify', 'To the Light - False Call', 'To the Light - Someone Called?', 'To the Light - Clip Their Wings',
  'To the Light - Fallen Bird', 'To the Light - Dangerous Ambitions', 'To the Light - Bite the Dust', 'To the Light - A Time to Throw Stones',
  'To the Light - A Time to Gather Stones', 'To the Light - The Other Side', 'To the Light - Getting Acquainted',
]

/** The previous quest of each, in the series' order (Bite the Dust is Peacekeeper's and opens with Dangerous Ambitions). */
const PREVIOUS: Record<string, string[]> = {
  [TO_THE_LIGHT_IDS.trustButVerify]: [],
  [TO_THE_LIGHT_IDS.falseCall]: [TO_THE_LIGHT_IDS.trustButVerify],
  [TO_THE_LIGHT_IDS.someoneCalled]: [TO_THE_LIGHT_IDS.falseCall],
  [TO_THE_LIGHT_IDS.clipTheirWings]: [TO_THE_LIGHT_IDS.falseCall],
  [TO_THE_LIGHT_IDS.fallenBird]: [TO_THE_LIGHT_IDS.clipTheirWings],
  [TO_THE_LIGHT_IDS.dangerousAmbitions]: [TO_THE_LIGHT_IDS.fallenBird],
  [TO_THE_LIGHT_IDS.biteTheDust]: [TO_THE_LIGHT_IDS.fallenBird],
  [TO_THE_LIGHT_IDS.throwStones]: [TO_THE_LIGHT_IDS.dangerousAmbitions],
  [TO_THE_LIGHT_IDS.gatherStones]: [TO_THE_LIGHT_IDS.throwStones],
  [TO_THE_LIGHT_IDS.otherSide]: [TO_THE_LIGHT_IDS.gatherStones],
  [TO_THE_LIGHT_IDS.gettingAcquainted]: [TO_THE_LIGHT_IDS.otherSide],
}

describe('«На свет» (To the Light): the series tarkov.dev lacks is in the catalog', () => {
  it('the series data holds the game\'s quest ids, in the game\'s order', () => {
    expect(TO_THE_LIGHT.quests.map((quest) => quest.id)).toEqual(ORDER)
    // the ru wiki's infobox `node` of each page; Getting Acquainted's id is also the key of its name in tarkov.dev's
    // tasks_ru / tasks_en («На свет. Новое знакомство» / «To the Light - Getting Acquainted»)
    for (const id of ORDER) expect(id).toMatch(/^[0-9a-f]{24}$/)
    expect(new Set(ORDER).size).toBe(11)
  })

  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    for (const locale of ['ru', 'en'] as const) {
      it(`${mode}, ${locale}: all 11 quests with their trader, names, requirements and objectives; the other quests are unchanged`, async () => {
        const catalog = await build(mode, locale)
        const series = ORDER.map((id) => catalog.quests.find((quest) => quest.id === id)!)
        expect(series.every(Boolean)).toBe(true)
        expect(series.map((quest) => quest.name)).toEqual(locale === 'ru' ? RU_NAMES : EN_NAMES)
        expect(series.map((quest) => quest.traderId)).toEqual(ORDER.map((id) => (id === TO_THE_LIGHT_IDS.biteTheDust ? '5935c25fb3acc3127c3d8cd9' : '5a7c2eca46aef81a7ca2145d')))
        expect(series.map((quest) => quest.trader)).toEqual(ORDER.map((id) => (id === TO_THE_LIGHT_IDS.biteTheDust
          ? (locale === 'ru' ? 'Миротворец' : 'Peacekeeper') : (locale === 'ru' ? 'Механик' : 'Mechanic'))))
        for (const quest of series) {
          expect(quest.requirements?.map((requirement) => requirement.taskId)).toEqual(PREVIOUS[quest.id])
          expect(quest.objectives.length).toBeGreaterThan(0)
          expect(quest.objectiveDetails?.length).toBe(quest.objectives.length)
          expect(quest.kappa).toBe(false)
          expect(quest.kind).toBeUndefined()
          expect(quest.description).toContain(locale === 'ru' ? 'Серия «На свет»' : 'To the Light series')
          // player-facing texts: no source names, no notes about the data (docs/quests/na-svet-audit.md keeps those)
          for (const line of [quest.description, ...quest.objectives, ...quest.rewards]) expect(line).not.toMatch(RESEARCH_NOTE)
          // no source gives a player level for any of them: the catalog's floor for «no level requirement» (catalogSource.ts)
          expect(quest.level).toBe(1)
        }
        // the other quests: the feed's two and the story chapters, nothing else and nothing lost
        const others = catalog.quests.filter((quest) => !SERIES.has(quest.id))
        expect(others.filter((quest) => quest.kind !== 'story').map((quest) => quest.id).sort()).toEqual([INFORMATION_SOURCE_ID, OTHER_TASK_ID].sort())
        const without = await build(mode, locale, { withoutSeriesTraders: true })
        expect(without.quests.some((quest) => SERIES.has(quest.id))).toBe(false)
        expect(others.length).toBe(without.quests.length)
        expect(catalog.quests.length).toBe(without.quests.length + 11)
        expect(catalog.metadata?.counts?.quests).toBe(without.quests.length + 11)
      })
    }
  }

  it('the first quest opens in a dialogue with loyalty 3 at the seven traders; the objectives, items, keys and maps are kept', async () => {
    const catalog = await build('pvp', 'ru')
    const byId = (id: string) => catalog.quests.find((quest) => quest.id === id)!
    const first = byId(TO_THE_LIGHT_IDS.trustButVerify)
    expect(first.gameConditions).toEqual(['dialogue'])
    expect(first.unlock).toEqual({ dialogue: true })
    expect(first.traderLoyalty?.needed.map((entry) => entry.level)).toEqual([3, 3, 3, 3, 3, 3, 3])
    expect(first.mapIds).toEqual(['the-lab'])
    expect(first.objectiveDetails?.map((objective) => objective.optional ?? false)).toEqual([false, true, false])

    const falseCall = byId(TO_THE_LIGHT_IDS.falseCall)
    expect(falseCall.objectiveDetails?.map((objective) => [objective.type, objective.count])).toEqual([['shoot', 5], ['shoot', 1], ['plantItem', 1], ['useItem', 1]])
    expect(falseCall.raidRequirements?.map((need) => [need.itemId, need.purpose])).toEqual([
      ['5b4391a586f7745321235ab2', 'place'], ['624c0b3340357b5f566e8766', 'bring'], ['62389be94d5d474bf712e709', 'bring'],
    ])

    const wings = byId(TO_THE_LIGHT_IDS.clipTheirWings)
    expect(wings.mapIds).toEqual(['woods', 'customs', 'shoreline'])
    expect(wings.raidRequirements?.filter((need) => need.itemId === '5ac78a9b86f7741cca0bbd8d')).toHaveLength(4)

    const stones = byId(TO_THE_LIGHT_IDS.gatherStones)
    expect(stones.raidRequirements?.map((need) => [need.itemId, need.count, need.foundInRaid, need.dogTagLevel, need.alternatives])).toEqual([
      ['59f32bb586f774757e1e8442', 3, true, 30, 2], ['59f32c3b86f77472a31742f0', 3, true, 30, 2],
    ])

    const otherSide = byId(TO_THE_LIGHT_IDS.otherSide)
    expect(otherSide.mapIds).toEqual(['reserve', 'streets-of-tarkov', 'customs'])
    const keys = otherSide.raidRequirements?.filter((need) => need.purpose === 'key').map((need) => [need.itemId, need.mapIds[0], need.alternatives])
    expect(keys).toEqual([
      ['5d80c60f86f77440373c4ece', 'reserve', 3], ['5ede7a8229445733cb4c18e2', 'reserve', 3], ['5d80c62a86f7744036212b3f', 'reserve', 3],
      ['63a3a93f8a56922e82001f5d', 'streets-of-tarkov', 2], ['64ccc25f95763a1ae376e447', 'streets-of-tarkov', 2],
      ['5780cf7f2459777de4559322', 'customs', undefined],
    ])
    expect(otherSide.rewards).toContain('Рубли × 300000')
    expect(otherSide.rewards).toContain('Репутация у Смотрителя +0,01')

    const last = byId(TO_THE_LIGHT_IDS.gettingAcquainted)
    expect(last.mapIds).toEqual(['lighthouse'])
    expect(last.ocrAliases).toEqual(['Новое знакомство', 'Getting Acquainted'])
    expect(last.objectiveDetails?.[0]).toMatchObject({ type: 'findQuestItem', itemIds: ['6331bb0d1aa9f42b804997a6'] })
  })

  it('the map points are the feed\'s own places (extract, transits, marked-room doors); nothing else gets a point', async () => {
    const catalog = await build('pvp', 'en')
    const points = catalog.markers.filter((marker) => marker.questId && SERIES.has(marker.questId))
      .map((marker) => [marker.questId, marker.mapId, marker.id.replace(/^.*-quest-zone-[0-9a-f]{24}-/, '')])
    expect(points).toEqual([
      [TO_THE_LIGHT_IDS.trustButVerify, 'the-lab', 'extract-bb32a5dbbe8116e0765ed80a5ec7980e47676dc6'],
      [TO_THE_LIGHT_IDS.falseCall, 'customs', 'transit-42'],
      [TO_THE_LIGHT_IDS.clipTheirWings, 'woods', 'transit-41'],
      [TO_THE_LIGHT_IDS.clipTheirWings, 'customs', 'transit-42'],
      [TO_THE_LIGHT_IDS.otherSide, 'reserve', 'lock-5d80c60f86f77440373c4ece'],
      [TO_THE_LIGHT_IDS.otherSide, 'reserve', 'lock-5ede7a8229445733cb4c18e2'],
      [TO_THE_LIGHT_IDS.otherSide, 'reserve', 'lock-5d80c62a86f7744036212b3f'],
      [TO_THE_LIGHT_IDS.otherSide, 'streets-of-tarkov', 'lock-63a3a93f8a56922e82001f5d'],
      [TO_THE_LIGHT_IDS.otherSide, 'streets-of-tarkov', 'lock-64ccc25f95763a1ae376e447'],
      [TO_THE_LIGHT_IDS.otherSide, 'customs', 'lock-5780cf7f2459777de4559322'],
    ])
    const dorm = catalog.quests.find((quest) => quest.id === TO_THE_LIGHT_IDS.otherSide)!.objectiveDetails![2]
    expect(dorm.zones).toEqual([{ id: 'lock-5780cf7f2459777de4559322', mapId: 'customs', position: { x: 180.67, y: 6.85, z: 183.72 } }])
  })

  it('«Источник информации» follows the series again, unless tarkov.dev gives it a previous task', async () => {
    const catalog = await build('pve', 'ru')
    expect(catalog.quests.find((quest) => quest.id === INFORMATION_SOURCE_ID)?.requirements).toEqual([{ taskId: TO_THE_LIGHT_IDS.gettingAcquainted, allowedStatuses: ['complete'] }])
  })

  it('a quest tarkov.dev lists again is tarkov.dev\'s: not doubled, not rewritten', async () => {
    const upstream = { id: TO_THE_LIGHT_IDS.trustButVerify, name: 'Доверяй, но проверяй (tarkov.dev)', trader: '5a7c2eca46aef81a7ca2145d', objectives: [] }
    const catalog = await build('pvp', 'ru', { extraTasks: { [upstream.id]: upstream } })
    const rows = catalog.quests.filter((quest) => quest.id === upstream.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe(upstream.name)
    expect(rows[0].description).not.toContain('Серия «На свет»')
    expect(catalog.quests.filter((quest) => SERIES.has(quest.id))).toHaveLength(11)
  })

  it('the owner\'s log event of 18.09.2026 (game 1.1.5.1, PvP: task 6a880acc… taken) now names a catalog quest', async () => {
    const event = ownerLogs.events.pvp.find(([, , id]) => id === TO_THE_LIGHT_IDS.trustButVerify)
    expect(event).toEqual(['2026-09-18T16:56:45Z', 'active', TO_THE_LIGHT_IDS.trustButVerify])
    const catalog = await build('pvp', 'ru')
    expect(catalog.quests.find((quest) => quest.id === event![2])?.name).toBe('На свет. Доверяй, но проверяй')
  })
})
