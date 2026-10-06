import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveCatalog, isValuableItem, requirementFoundInRaid } from './catalogSource'

/** json.tarkov.dev shapes (tarkov.dev TaskObjectiveItem / RequirementItem), trimmed to what the adapter reads. */
const upstream: Record<string, unknown> = {
  tasks: {
    tasks: {
      t1: {
        id: 't1', name: 'Аптечный бизнес', trader: 'tr1', minPlayerLevel: 5, kappaRequired: true,
        objectives: [
          { id: 'o1', type: 'findItem', description: 'Найти в рейде газоанализатор', count: 2, foundInRaid: true, items: ['gas'], maps: [] },
          { id: 'o2', type: 'giveItem', description: 'Передать газоанализатор', count: 2, foundInRaid: true, items: ['gas'], maps: [] },
          { id: 'o3', type: 'giveItem', description: 'Передать любую медицину', count: 3, foundInRaid: false, items: ['gas', 'salewa'], maps: [] },
          { id: 'o4', type: 'visit', description: 'Посетить склад', zones: [{ map: 'm-customs' }] },
        ],
      },
    },
  },
  items: { items: { gas: { id: 'gas', name: 'Газоанализатор', shortName: 'Газ', types: ['barter'] }, salewa: { id: 'salewa', name: 'Salewa', shortName: 'Salewa', types: ['meds'] } } },
  maps: { maps: { 'm-customs': { id: 'm-customs', name: 'Customs', normalizedName: 'customs' } } },
  traders: { tr1: { id: 'tr1', name: 'Терапевт' } },
  hideout: {
    st1: {
      id: 'st1', name: 'Медблок', normalizedName: 'medstation',
      levels: [{ level: 1, constructionTime: 3600, itemRequirements: [{ item: 'gas', count: 1, attributes: [{ type: 'foundInRaid', name: 'foundInRaid', value: 'true' }] }, { item: 'salewa', count: 2, attributes: [] }] }],
    },
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('catalog adapter: found-in-raid and structured requirements', () => {
  it('reads RequirementItem attributes in the array and object forms', () => {
    expect(requirementFoundInRaid([{ type: 'foundInRaid', name: 'foundInRaid', value: 'true' }])).toBe(true)
    expect(requirementFoundInRaid([{ type: 'foundInRaid', name: 'foundInRaid', value: 'false' }])).toBe(false)
    expect(requirementFoundInRaid({ foundInRaid: true })).toBe(true)
    expect(requirementFoundInRaid(undefined)).toBe(false)
  })

  it('keeps FIR, objective ids, alternatives and per-objective maps of tasks, and hideout item requirements', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const match = /json\.tarkov\.dev\/[a-z-]+\/([a-z]+)(_[a-z]+)?$/.exec(String(url))
      if (!match) return new Response('', { status: 404 })
      return new Response(JSON.stringify({ data: match[2] ? {} : upstream[match[1]] ?? {} }), { status: 200 })
    }))
    const catalog = await fetchLiveCatalog('pve', 'en')
    const quest = catalog.quests.find((entry) => entry.id === 't1')!
    const gas = quest.raidRequirements!.filter((requirement) => requirement.itemId === 'gas')
    expect(gas.map((requirement) => [requirement.objectiveId, requirement.purpose, requirement.count, requirement.foundInRaid, requirement.alternatives])).toEqual([
      ['o1', 'find', 2, true, 1],
      ['o2', 'handover', 2, true, 1],
      ['o3', 'handover', 3, undefined, 2],
    ])
    expect(quest.objectiveDetails!.find((objective) => objective.id === 'o4')).toMatchObject({ type: 'visit', mapIds: ['customs'], zoneBound: true })
    expect(quest.objectiveDetails!.find((objective) => objective.id === 'o3')).toMatchObject({ type: 'giveItem', count: 3 })
    expect(quest.objectiveDetails!.find((objective) => objective.id === 'o3')?.zoneBound).toBeUndefined()
    const level = catalog.hideout.find((station) => station.id === 'st1')!.levels![0]
    expect(level.itemRequirements).toEqual([{ itemId: 'gas', count: 1, foundInRaid: true }, { itemId: 'salewa', count: 2, foundInRaid: undefined }])
    expect(level.requirements[0]).toContain('(найти в рейде)')
  })
})

/** A quest released after the app build: only in the live feed, with objective keys, a quest-item spot and no `maps`. */
const newQuestFeed = (mode: 'regular' | 'pve'): Record<string, unknown> => ({
  tasks: { tasks: {
    fresh: {
      id: 'fresh', name: 'Новое задание', trader: 'tr1', minPlayerLevel: 30, kappaRequired: false,
      objectives: [
        { id: 'f1', type: 'findQuestItem', description: 'Найти папку в кабинете', questItem: 'folder', possibleLocations: [{ map: 'm-customs', positions: [{ x: 5, y: 1, z: 6 }] }],
          requiredKeys: [['key-a', 'key-b'], ['key-c']] },
        { id: 'f2', type: 'visit', description: 'Посетить кабинет', maps: ['m-customs'], zones: [{ id: 'z1', map: 'm-customs', position: { x: 5, y: 1, z: 6 } }] },
      ],
    },
  } },
  items: { items: {
    chain: { id: 'chain', name: 'Золотая цепочка', shortName: 'Цепь', types: ['barter'], categories: ['57864a3d24597754843f8721', '5448eb774bdc2d0a728b4567'], handbookCategories: ['5b47574386f77428ca22b2f1'] },
    bolts: { id: 'bolts', name: 'Болты', shortName: 'Болты', types: ['barter'], categories: ['57864a2d24597710474a8a1e'] },
    'key-a': { id: 'key-a', name: 'Ключ А', shortName: 'А', types: ['keys'] },
  } },
  maps: { maps: { 'm-customs': { id: 'm-customs', name: 'Customs', normalizedName: 'customs', bosses: [
    { mob: 'bossKilla', spawnChance: mode === 'pve' ? 1 : 0.3, spawnLocations: [{ name: 'ZoneDorms', chance: 1, positions: [{ x: mode === 'pve' ? 300 : 100, y: 0, z: 100 }] }] },
  ], lootLoose: [{ items: ['bolts', 'chain'], position: { x: 9, y: 0, z: 9 } }] } }, mobs: { bossKilla: { name: 'Килла', normalizedName: 'killa', imagePortraitLink: 'x' } } },
  traders: { tr1: { id: 'tr1', name: 'Прапор' } },
  hideout: {},
})

function stubModeFeeds(requested: string[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const match = /json\.tarkov\.dev\/([a-z-]+)\/([a-z]+)(_[a-z]+)?$/.exec(String(url))
    if (!match || (match[1] !== 'regular' && match[1] !== 'pve')) return new Response('', { status: 404 })
    requested.push(`${match[1]}/${match[2]}${match[3] ?? ''}`)
    return new Response(JSON.stringify({ data: match[3] ? {} : newQuestFeed(match[1] as 'regular' | 'pve')[match[2]] ?? {} }), { status: 200 })
  }))
}

describe('catalog adapter: new quests and markers straight from the live feed', () => {
  it('brings a new quest with its map (from the quest-item spot), level, objective keys and map points', async () => {
    stubModeFeeds([])
    const catalog = await fetchLiveCatalog('pvp', 'en')
    const quest = catalog.quests.find((entry) => entry.id === 'fresh')!
    expect(quest).toMatchObject({ name: 'Новое задание', trader: 'Прапор', level: 30, kappa: false, mapId: 'customs', mapIds: ['customs'] })
    expect(quest.requiredItems).toEqual(expect.arrayContaining(['key-a', 'key-b', 'key-c']))
    const keys = quest.raidRequirements!.filter((requirement) => requirement.purpose === 'key')
    expect(keys.map((requirement) => [requirement.itemId, requirement.mapIds, requirement.objectiveId, requirement.alternatives])).toEqual([
      ['key-a', ['customs'], 'f1', 2], ['key-b', ['customs'], 'f1', 2], ['key-c', ['customs'], 'f1', undefined],
    ])
    const points = catalog.markers.filter((marker) => marker.questId === 'fresh')
    expect(points.length).toBeGreaterThan(0)
    expect(points.every((marker) => marker.mapId === 'customs')).toBe(true)
  })

  it('marks jewelry by its tarkov.dev category and draws its loose-loot spot on the jewelry layer', async () => {
    stubModeFeeds([])
    const catalog = await fetchLiveCatalog('pvp', 'en')
    expect(catalog.items.find((item) => item.id === 'chain')?.valuable).toBe(true)
    expect(catalog.items.find((item) => item.id === 'bolts')?.valuable).toBeUndefined()
    expect(isValuableItem({ categories: [{ id: 'x', normalizedName: 'jewelry' }] })).toBe(true)
    const spot = catalog.markers.find((marker) => marker.layerId === 'loot.valuable')
    expect(spot).toMatchObject({ itemId: 'chain', mapId: 'customs' })
    expect(spot?.guaranteedSpawn).toBeUndefined()
  })

  it('loads PvP bosses only from the regular feed and PvE bosses only from the pve feed', async () => {
    const requested: string[] = []
    stubModeFeeds(requested)
    const pvp = await fetchLiveCatalog('pvp', 'en')
    const pvpRequests = [...requested]
    requested.length = 0
    const pve = await fetchLiveCatalog('pve', 'en')
    expect(pvpRequests.every((path) => path.startsWith('regular/'))).toBe(true)
    expect(requested.every((path) => path.startsWith('pve/'))).toBe(true)
    const killa = (markers: typeof pvp.markers) => markers.filter((marker) => marker.boss?.key === 'killa' && marker.source === 'json.tarkov.dev/maps')
    expect(killa(pvp.markers).map((marker) => [marker.boss?.spawnChance, marker.position[1], marker.guaranteedSpawn])).toEqual([[0.3, 100, undefined]])
    expect(killa(pve.markers).map((marker) => [marker.boss?.spawnChance, marker.position[1], marker.guaranteedSpawn])).toEqual([[1, 300, true]])
    expect([pvp.metadata?.mode, pve.metadata?.mode]).toEqual(['pvp', 'pve'])
  })
})
