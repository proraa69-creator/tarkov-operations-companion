import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveCatalog, requirementFoundInRaid } from './catalogSource'

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
