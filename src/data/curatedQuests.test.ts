import { describe, expect, it } from 'vitest'
import type { RaidMode } from '../domain/types'
import { fetchLiveCatalog } from './catalogSource'
import { PLACE_SOURCE_TASKS, SCOURGE_INVASION, SCOURGE_QUEST_IDS, TO_THE_LIGHT, TO_THE_LIGHT_IDS, withCuratedTasks } from './curatedQuests'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { FEED_TASK_IDS, INFORMATION_SOURCE_ID, toTheLightFetcher, type FeedOptions } from './__fixtures__/toTheLightFeed'
import ownerLogs from '../progression/__fixtures__/owner-logs-2026-09.json'

const noWiki = { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) }
const build = (mode: RaidMode, locale: 'ru' | 'en', options: FeedOptions = {}) => fetchLiveCatalog(mode, locale, toTheLightFetcher(options), noWiki)

const ORDER = [
  TO_THE_LIGHT_IDS.trustButVerify, TO_THE_LIGHT_IDS.falseCall, TO_THE_LIGHT_IDS.someoneCalled, TO_THE_LIGHT_IDS.clipTheirWings,
  TO_THE_LIGHT_IDS.fallenBird, TO_THE_LIGHT_IDS.dangerousAmbitions, TO_THE_LIGHT_IDS.biteTheDust, TO_THE_LIGHT_IDS.throwStones,
  TO_THE_LIGHT_IDS.gatherStones, TO_THE_LIGHT_IDS.otherSide, TO_THE_LIGHT_IDS.gettingAcquainted,
]
const SERIES = new Set<string>(ORDER)
/** The other curated series (Scourge's event quests), left out where only «На свет» is counted. */
const OTHER_CURATED = new Set<string>(Object.values(SCOURGE_QUEST_IDS))
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
        // the other quests: the feed's own and the story chapters, nothing else and nothing lost
        const others = catalog.quests.filter((quest) => !SERIES.has(quest.id) && !OTHER_CURATED.has(quest.id))
        expect(others.filter((quest) => quest.kind !== 'story').map((quest) => quest.id).sort()).toEqual([...FEED_TASK_IDS].sort())
        const without = await build(mode, locale, { withoutSeriesTraders: true })
        expect(without.quests.some((quest) => SERIES.has(quest.id))).toBe(false)
        expect(others.length).toBe(without.quests.filter((quest) => !OTHER_CURATED.has(quest.id)).length)
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

  it('the map points are the feeds\' own places (extract, transits, doors, other tasks\' zones of the same place, the archived lighthouse zone)', async () => {
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
      const catalog = await build(mode, 'en')
      // floors by tarkov.dev's map config (the catalog keeps the Russian floor names; the UI translates them)
      const points = catalog.markers.filter((marker) => marker.questId && SERIES.has(marker.questId))
        .map((marker) => [marker.questId, marker.mapId, marker.id.replace(/^.*-quest-zone-[0-9a-f]{24}-/, ''), marker.floor])
      expect(points).toEqual([
        [TO_THE_LIGHT_IDS.trustButVerify, 'the-lab', 'extract-bb32a5dbbe8116e0765ed80a5ec7980e47676dc6', 'Технический уровень'],
        [TO_THE_LIGHT_IDS.falseCall, 'customs', 'zone-place_2A2_unlock_3_customs', 'Основной'],
        [TO_THE_LIGHT_IDS.falseCall, 'customs', 'transit-42', 'Основной'],
        [TO_THE_LIGHT_IDS.clipTheirWings, 'woods', 'zone-q14_8_2', 'Основной'],
        [TO_THE_LIGHT_IDS.clipTheirWings, 'woods', 'transit-41', 'Основной'],
        [TO_THE_LIGHT_IDS.clipTheirWings, 'customs', 'transit-42', 'Основной'],
        [TO_THE_LIGHT_IDS.clipTheirWings, 'shoreline', 'extract-3475b9df1bf661d3c746ff1a1a8493bae828b939', '2 этаж'],
        [TO_THE_LIGHT_IDS.otherSide, 'reserve', 'lock-5d80c60f86f77440373c4ece', expect.any(String)],
        [TO_THE_LIGHT_IDS.otherSide, 'reserve', 'lock-5ede7a8229445733cb4c18e2', expect.any(String)],
        [TO_THE_LIGHT_IDS.otherSide, 'reserve', 'lock-5d80c62a86f7744036212b3f', expect.any(String)],
        [TO_THE_LIGHT_IDS.otherSide, 'streets-of-tarkov', 'lock-63a3a93f8a56922e82001f5d', expect.any(String)],
        [TO_THE_LIGHT_IDS.otherSide, 'streets-of-tarkov', 'lock-64ccc25f95763a1ae376e447', expect.any(String)],
        [TO_THE_LIGHT_IDS.otherSide, 'customs', 'lock-5780cf7f2459777de4559322', '3 этаж'],
        [TO_THE_LIGHT_IDS.gettingAcquainted, 'lighthouse', 'zone-terapevt_tier_03_group_03_quest_03_01', 'Основной'],
        [TO_THE_LIGHT_IDS.gettingAcquainted, 'lighthouse', 'zone-lighthouse_place_bullshit', 'Основной'],
        [TO_THE_LIGHT_IDS.gettingAcquainted, 'lighthouse', 'zone-63ab727b1287ef0b827d0c95-z0', 'Основной'],
      ])
    }
    const catalog = await build('pvp', 'en')
    const dorm = catalog.quests.find((quest) => quest.id === TO_THE_LIGHT_IDS.otherSide)!.objectiveDetails![2]
    expect(dorm.zones).toEqual([{ id: 'lock-5780cf7f2459777de4559322', mapId: 'customs', position: { x: 180.67, y: 6.85, z: 183.72 } }])
    const marker = (id: string) => catalog.markers.find((entry) => entry.questId && SERIES.has(entry.questId) && entry.id.endsWith(id))!
    // the weather station on the mountain: Steady Signal's zone exactly (position, outline, heights)
    expect(marker('zone-q14_8_2')).toMatchObject({ height: 77.52, heightRange: [75.52, 79.52], objectiveId: `${TO_THE_LIGHT_IDS.clipTheirWings}-objective-1` })
    expect(marker('zone-q14_8_2').outline).toHaveLength(4)
    // a building only: the store (Thirsty's stash spot is in its back room) keeps its position, not that spot's outline
    expect(marker('zone-place_2A2_unlock_3_customs')).toMatchObject({ height: -0.72, heightRange: undefined, outline: undefined, objectiveId: `${TO_THE_LIGHT_IDS.falseCall}-objective-3` })
    // the admin building (its basement extract), on its 2nd floor: no height of its own, tarkov.dev's 2nd-floor heights
    expect(marker('extract-3475b9df1bf661d3c746ff1a1a8493bae828b939')).toMatchObject({ heightRange: [-1, 2], outline: undefined, objectiveId: `${TO_THE_LIGHT_IDS.clipTheirWings}-objective-6` })
    const admin = catalog.quests.find((quest) => quest.id === TO_THE_LIGHT_IDS.clipTheirWings)!.objectiveDetails![5]
    expect(admin.zones).toEqual([{ id: 'extract-3475b9df1bf661d3c746ff1a1a8493bae828b939', mapId: 'shoreline', position: { x: -256.87, z: -149.78 }, top: 2, bottom: -1 }])
    // no point for the places no file has: the Labs servers, the sawmill guardhouse, the Customs construction site
    const wings = catalog.quests.find((quest) => quest.id === TO_THE_LIGHT_IDS.clipTheirWings)!
    expect(wings.objectiveDetails!.map((objective) => objective.zones?.length ?? 0)).toEqual([1, 0, 1, 0, 1, 1])
    expect(catalog.quests.find((quest) => quest.id === TO_THE_LIGHT_IDS.trustButVerify)!.objectiveDetails!.map((objective) => objective.zones?.length ?? 0)).toEqual([0, 0, 1])
  })

  it('a place another task names is not pointed at when the mode\'s tasks file lacks that task', async () => {
    const steadySignal = { [PLACE_SOURCE_TASKS.steadySignal]: undefined }
    const catalog = await build('pvp', 'en', { extraTasks: steadySignal })
    expect(catalog.markers.some((marker) => marker.id.endsWith('zone-q14_8_2'))).toBe(false)
    const wings = catalog.quests.find((quest) => quest.id === TO_THE_LIGHT_IDS.clipTheirWings)!
    expect(wings.objectiveDetails![0].zones ?? []).toEqual([])
    expect(wings.objectives[0]).toBe('Plant a Signal jammer at the weather station on the mountain on Woods (In one raid)')
  })

  for (const locale of ['ru', 'en'] as const) {
    it(`Getting Acquainted (${locale}): objectives, maps, points on their map and floor, items, start gear, no keys`, async () => {
      const catalog = await build('pvp', locale)
      const quest = catalog.quests.find((entry) => entry.id === TO_THE_LIGHT_IDS.gettingAcquainted)!
      expect(quest.objectives).toEqual(locale === 'ru'
        ? ['Раздобыть флеш-накопитель V3 на локации Маяк', 'Перепрошить радиопередатчик с помощью флеш-накопителя V3', 'Передать флешку', 'Посетить здание Маяка']
        : ['Obtain the V3 Flash drive on Lighthouse', 'Reflash the Radio transmitter using the V3 Flash drive', 'Hand over the flash drive', 'Visit the Lighthouse building'])
      expect(quest.mapIds).toEqual(['lighthouse'])
      expect(quest.requirements?.map((requirement) => requirement.taskId)).toEqual([TO_THE_LIGHT_IDS.otherSide])
      const details = quest.objectiveDetails!
      expect(details.map((objective) => [objective.type, objective.count, objective.itemIds ?? []])).toEqual([
        ['findQuestItem', 1, ['6331bb0d1aa9f42b804997a6']], ['hideout', 1, []], ['giveQuestItem', 1, ['6331bb0d1aa9f42b804997a6']], ['visit', 1, []],
      ])
      // the flash drive: the upper (black) Rogue chalet (a room of it, the med bay of Invasive Therapy) and the tennis court
      expect(details[0].zones?.map((zone) => [zone.id, zone.mapId, zone.position])).toEqual([
        ['zone-terapevt_tier_03_group_03_quest_03_01', 'lighthouse', { x: -120.61, y: 37.63, z: 79.69 }],
        ['zone-lighthouse_place_bullshit', 'lighthouse', { x: -62.24, y: 29.37, z: 132.98 }],
      ])
      expect(details[0].zones?.[0].outline).toBeUndefined()
      // the lighthouse building: the zone tarkov.dev gave this objective of this quest id, with its outline and heights
      expect(details[3].zones).toEqual([expect.objectContaining({
        id: 'zone-63ab727b1287ef0b827d0c95-z0', mapId: 'lighthouse', position: { x: 442.2326, y: 24.1148987, z: 460.690674 }, top: 29.9708977, bottom: 18.2589,
      })])
      expect(details[3].zones?.[0].outline).toHaveLength(4)
      const markers = catalog.markers.filter((marker) => marker.questId === quest.id)
      expect(markers.map((marker) => [marker.mapId, marker.objectiveId, marker.title, marker.description])).toEqual([
        ['lighthouse', details[0].id, quest.name, quest.objectives[0]],
        ['lighthouse', details[0].id, quest.name, quest.objectives[0]],
        ['lighthouse', details[3].id, quest.name, quest.objectives[3]],
      ])
      expect(markers.map((marker) => marker.floor)).toEqual([catalog.maps.find((map) => map.id === 'lighthouse')!.floors![0], expect.any(String), expect.any(String)])
      expect(new Set(markers.map((marker) => marker.floor)).size).toBe(1)
      // what to bring: the transmitter (catalog item, icon) for the visit; no key is needed
      expect(quest.raidRequirements?.map((need) => [need.itemId, need.purpose, need.objectiveId])).toEqual([['62e910aaf957f2915e0a5e36', 'bring', details[3].id]])
      expect(quest.raidRequirements?.some((need) => need.purpose === 'key')).toBe(false)
      // given with the task (catalog items by name) and the craft it opens
      const on = locale === 'ru' ? 'При взятии задания' : 'On taking the task'
      expect(quest.rewards).toEqual([
        expect.stringMatching(/^32\s000 /),
        `${on}: Цифровой защищенный DSP радиопередатчик × 1`, `${on}: Ключ от схрона на Маяке × 1`, `${on}: Оружейный кейс × 1`,
        `${locale === 'ru' ? 'Открывает крафт' : 'Unlocks the craft'}: Цифровой защищенный DSP радиопередатчик (${locale === 'ru' ? 'Разведцентр, ур. 2' : 'Intelligence Center level 2'})`,
      ])
      expect(quest.description).toMatch(locale === 'ru' ? /верхнего \(чёрного\) шале.*теннисного корта.*Зрячего/ : /upper \(black\) chalet.*tennis court.*Zryachiy/)
    })
  }

  it('the points come out of adaptLiveMapMarkers from the tasks file with the curated tasks', async () => {
    const fetcher = toTheLightFetcher()
    const read = async (endpoint: string) => ((await (await fetcher(`https://json.tarkov.dev/regular/${endpoint}`)).json()) as { data: Record<string, unknown> }).data
    const [tasksRoot, mapsRoot, traders] = await Promise.all([read('tasks'), read('maps'), read('traders')])
    const curated = withCuratedTasks(tasksRoot, { mode: 'pvp', locale: 'en', maps: mapsRoot, traders })
    const catalog = await build('pvp', 'en')
    const mapNameByApiId = new Map(Object.values(mapsRoot.maps as Record<string, { id: string; normalizedName: string }>).map((map) => [map.id, map.normalizedName]))
    const quest = catalog.quests.find((entry) => entry.id === TO_THE_LIGHT_IDS.gettingAcquainted)!
    const markers = adaptLiveMapMarkers(mapsRoot, curated.tasks, { maps: catalog.maps, mapNameByApiId, quests: [quest], items: new Map(), mode: 'pvp' })
      .filter((marker) => marker.questId === quest.id)
    expect(markers.map((marker) => [marker.id, marker.mapId, marker.position])).toEqual([
      ['lighthouse-quest-zone-625d700cc48e6c62a440fab5-zone-terapevt_tier_03_group_03_quest_03_01', 'lighthouse', expect.any(Array)],
      ['lighthouse-quest-zone-625d700cc48e6c62a440fab5-zone-lighthouse_place_bullshit', 'lighthouse', expect.any(Array)],
      ['lighthouse-quest-zone-625d700cc48e6c62a440fab5-zone-63ab727b1287ef0b827d0c95-z0', 'lighthouse', expect.any(Array)],
    ])
    expect(markers.map((marker) => marker.id)).toEqual(catalog.markers.filter((marker) => marker.questId === quest.id).map((marker) => marker.id))
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

describe('«Вторжение Scourge»: the event quests from the owner\'s screenshots', () => {
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    it(`${mode}: both quests with Therapist, the order, the rewards and the skill lines`, async () => {
      const catalog = await build(mode, 'ru')
      const route = catalog.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.hiddenRoute)!
      const simple = catalog.quests.find((quest) => quest.id === SCOURGE_QUEST_IDS.simpleTask)!
      expect(route.name).toBe('Скрытый маршрут')
      expect(simple.name).toBe('Простая задача в непростом месте')
      expect(route.traderId).toBe('54cb57776803fa99248b456e')
      expect(simple.requirements.map((need) => need.taskId)).toEqual([SCOURGE_QUEST_IDS.hiddenRoute])
      expect(simple.mapIds).toEqual(['the-lab'])
      expect(route.description).toContain('Серия «Вторжение Scourge» (ивент до 20 октября), задание 1 из 2.')
      expect(route.rewards.join(' | ')).toContain('Хирургия +1 уровень')
      expect(simple.rewards.join(' | ')).toContain('Здоровье +1 уровень')
      expect(simple.rewards.join(' | ')).toMatch(/При взятии задания: .+ × 1/)
    })
  }

  it('in every mode, and gone once tarkov.dev lists a quest of the same title', async () => {
    expect(SCOURGE_INVASION.modes).toEqual(['pvp', 'pve', 'seasonal'])
    const tasks = { tasks: { real: { id: '6b0000000000000000000001', name: 'Скрытый маршрут', trader: '54cb57776803fa99248b456e', objectives: [] } } }
    const traders = { a: { id: '54cb57776803fa99248b456e' } }
    const result = withCuratedTasks(tasks, { mode: 'pvp', locale: 'ru', maps: {}, traders })
    expect(result.added.has(SCOURGE_QUEST_IDS.hiddenRoute)).toBe(false)
    expect(result.added.has(SCOURGE_QUEST_IDS.simpleTask)).toBe(true)
  })
})
