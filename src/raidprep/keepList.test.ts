import { describe, expect, it } from 'vitest'
import { computeKeepList, filterKeepRows, keepBadge, questItemNeeds } from './keepList'
import { item, progressWith, quest, station } from './fixtures'

const items = [
  item('gas', 'Газоанализатор'),
  item('flash', 'Флешка'),
  item('salewa', 'Salewa'),
  item('bolts', 'Болты'),
  item('rub', 'Рубли', { types: ['money'] }),
  item('lion', 'Лев'),
  item('ms2000', 'Маркер MS2000'),
  item('armor-a', '6Б45'),
  item('armor-b', '6Б45 EMR'),
]

const quests = [
  quest('q-gas', 'Аптечный бизнес', {
    raidRequirements: [
      { itemId: 'gas', count: 2, purpose: 'find', mapIds: [], foundInRaid: true, objectiveId: 'o1', alternatives: 1 },
      { itemId: 'gas', count: 2, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'o2', alternatives: 1 },
    ],
  }),
  quest('q-done', 'Сданное', { raidRequirements: [{ itemId: 'flash', count: 1, purpose: 'handover', mapIds: [], objectiveId: 'o3', alternatives: 1 }] }),
  quest('q-any-med', 'Любая медицина', {
    raidRequirements: ['salewa', 'gas', 'm1', 'm2', 'm3', 'm4'].map((itemId) => ({ itemId, count: 3, purpose: 'handover' as const, mapIds: [], objectiveId: 'o4', alternatives: 6 })),
  }),
  quest('q-armor', 'Броня', {
    raidRequirements: ['armor-a', 'armor-b'].map((itemId) => ({ itemId, count: 1, purpose: 'handover' as const, mapIds: [], objectiveId: 'o9', alternatives: 2, foundInRaid: true, minDurability: 50 })),
  }),
  quest('q-money', 'Плата', { raidRequirements: [{ itemId: 'rub', count: 100000, purpose: 'handover', mapIds: [], objectiveId: 'o5', alternatives: 1 }] }),
  quest('q-plant', 'Наблюдение', { raidRequirements: [{ itemId: 'ms2000', count: 2, purpose: 'mark', mapIds: ['customs'], objectiveId: 'o6', alternatives: 1 }] }),
  quest('q-key', 'Ключевое', { raidRequirements: [{ itemId: 'flash', count: 1, purpose: 'key', mapIds: ['customs'] }] }),
  quest('q-usec', 'Только USEC', { faction: 'USEC', raidRequirements: [{ itemId: 'bolts', count: 5, purpose: 'handover', mapIds: [], objectiveId: 'o7', alternatives: 1 }] }),
  quest('q-collector', 'Коллекционер', { kappa: true, raidRequirements: [{ itemId: 'lion', count: 1, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'o8', alternatives: 1 }] }),
]

const hideout = [
  station('lavatory', 'Туалет', [
    { level: 1, requirements: [], bonus: '', itemRequirements: [{ itemId: 'bolts', count: 3 }, { itemId: 'rub', count: 2000 }] },
    { level: 2, requirements: [], bonus: '', itemRequirements: [{ itemId: 'gas', count: 1, foundInRaid: true }] },
  ]),
]

const byQuest = (id: string) => quests.find((entry) => entry.id === id)!

describe('questItemNeeds', () => {
  it('counts find + hand over of one item once and skips «any of» objectives and keys', () => {
    expect([...questItemNeeds(byQuest('q-gas'))]).toEqual([['gas', { count: 2, foundInRaid: true, substitutes: [] }]])
    expect(questItemNeeds(byQuest('q-any-med')).size).toBe(0)
    expect(questItemNeeds(byQuest('q-key')).size).toBe(0)
    expect([...questItemNeeds(byQuest('q-plant'))]).toEqual([['ms2000', { count: 2, foundInRaid: false, substitutes: [] }]])
  })

  it('keeps a small set of substitutes with their durability', () => {
    const armor = quests.find((entry) => entry.id === 'q-armor')!
    expect([...questItemNeeds(armor)]).toEqual([
      ['armor-a', { count: 1, foundInRaid: true, substitutes: ['armor-b'], minDurability: 50 }],
      ['armor-b', { count: 1, foundInRaid: true, substitutes: ['armor-a'], minDurability: 50 }],
    ])
  })
})

describe('computeKeepList', () => {
  const progress = progressWith({ 'q-done': 'completed' }, { faction: 'bear', hideoutLevels: { lavatory: 1 }, itemCounts: { gas: 1 } })
  const rows = computeKeepList({ quests, hideout, items, progress })
  const byId = new Map(rows.map((row) => [row.item.id, row]))

  it('drops completed quests, other-faction quests, money, «any of» objectives and built hideout levels', () => {
    expect(byId.has('flash')).toBe(false)
    expect(byId.has('rub')).toBe(false)
    expect(byId.has('bolts')).toBe(false)
    expect(byId.has('salewa')).toBe(false)
  })

  it('sums quest and hideout needs with found-in-raid parts and the player counter', () => {
    const gas = byId.get('gas')!
    expect(gas.need).toBe(3)
    expect(gas.needFoundInRaid).toBe(3)
    expect(gas.have).toBe(1)
    expect(gas.remaining).toBe(2)
    expect(gas.reasons.map((reason) => [reason.kind, reason.name, reason.count])).toEqual([['quest', 'Аптечный бизнес', 2], ['hideout', 'Туалет', 1]])
  })

  it('lists the Collector as Kappa and takes the Collector checklist as had', () => {
    expect(byId.get('lion')!.reasons[0].kind).toBe('kappa')
    const withChecklist = computeKeepList({ quests, hideout, items, progress, collectorCollected: ['lion'] })
    expect(withChecklist.find((row) => row.item.id === 'lion')!.remaining).toBe(0)
  })

  it('keeps PvP and PvE counters apart: the counter comes from the given mode only', () => {
    const pve = progressWith({}, { faction: 'bear', itemCounts: {} })
    expect(computeKeepList({ quests, hideout, items, progress: pve }).find((row) => row.item.id === 'gas')!.have).toBe(0)
  })

  it('a quest completed later (from the logs) drops out automatically', () => {
    const later = progressWith({ 'q-done': 'completed', 'q-gas': 'completed' }, { faction: 'bear', hideoutLevels: { lavatory: 1 } })
    const gas = computeKeepList({ quests, hideout, items, progress: later }).find((row) => row.item.id === 'gas')!
    expect(gas.reasons.map((reason) => reason.kind)).toEqual(['hideout'])
  })
})

describe('filterKeepRows and keepBadge', () => {
  const rows = computeKeepList({ quests, hideout, items, progress: progressWith({}, { faction: 'usec' }) })

  it('filters by source, FIR and search and recounts the need', () => {
    const hideoutOnly = filterKeepRows(rows, { kinds: ['hideout'] })
    expect(hideoutOnly.map((row) => [row.item.id, row.need]).sort()).toEqual([['bolts', 3], ['gas', 1]])
    expect(filterKeepRows(rows, { foundInRaidOnly: true }).map((row) => row.item.id).sort()).toEqual(['armor-a', 'armor-b', 'gas', 'lion'])
    expect(filterKeepRows(rows, { search: 'болт' }).map((row) => row.item.id)).toEqual(['bolts'])
    expect(filterKeepRows(rows, { kinds: ['kappa'] }).map((row) => row.item.id)).toEqual(['lion'])
  })

  it('builds the overlay badge from the first reason', () => {
    const badge = keepBadge(rows.find((row) => row.item.id === 'gas'))
    expect(badge).toMatchObject({ need: 3, remaining: 3, foundInRaid: true, kind: 'quest', reason: 'Аптечный бизнес', more: 1 })
    expect(keepBadge(undefined)).toBeUndefined()
  })
})
