import { describe, expect, it } from 'vitest'
import type { MapMarker, Quest } from '../domain/types'
import { planMapRoute, rankMaps, SHARED_WEIGHT } from './raidPlanEngine'
import { computeSquadOverview, itemIdsNeededBy } from './squadOverview'

const quest = (id: string, extra: Partial<Quest>): Quest => ({ id, name: id, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra })
const marker = (id: string, questId: string, mapId: string, objectiveId: string, position: [number, number], extra: Partial<MapMarker> = {}): MapMarker => ({ id, questId, mapId, objectiveId, position, type: 'quest', title: id, description: '', ...extra })

const quests = [
  quest('shared', { mapId: 'customs', objectives: ['Отметить бензовоз', 'Найти часы'], objectiveIds: ['o1', 'o2'], raidRequirements: [{ itemId: 'marker', count: 1, purpose: 'mark', mapIds: ['customs'], objectiveId: 'o1' }, { itemId: 'watch', count: 1, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'o3' }] }),
  quest('solo-woods', { mapId: 'woods', objectives: ['a', 'b', 'c'], objectiveIds: ['w1', 'w2', 'w3'] }),
  quest('solo-customs', { mapId: 'customs' }),
  quest('anywhere', { anyMap: true }),
]
const markers = [
  marker('m1', 'shared', 'customs', 'o1', [0, 0]),
  marker('m1b', 'shared', 'customs', 'o1', [1, 1]),
  marker('m2', 'shared', 'customs', 'o2', [10, 0]),
  marker('w1', 'solo-woods', 'woods', 'w1', [0, 0]),
  marker('w2', 'solo-woods', 'woods', 'w2', [0, 5]),
  marker('w3', 'solo-woods', 'woods', 'w3', [0, 9]),
  marker('approx', 'solo-customs', 'customs', 'x', [5, 5], { approximate: true }),
]

describe('rankMaps', () => {
  it('ranks maps by remaining objectives of all members, shared quests weighing more', () => {
    const members = [
      { memberId: 'a', activeQuestIds: ['shared', 'solo-customs'] },
      { memberId: 'b', activeQuestIds: ['shared', 'solo-woods', 'anywhere'] },
    ]
    const ranks = rankMaps(members, quests, markers)
    // customs: shared quest 2 objectives × 2 members × 1.5 = 6, plus solo-customs without exact points = 1 → 7.
    expect(ranks.map((rank) => [rank.mapId, rank.score, rank.objectives, rank.quests, rank.sharedQuests])).toEqual([
      ['customs', 2 * 2 * SHARED_WEIGHT + 1, 5, 2, 1],
      ['woods', 3, 3, 1, 0],
    ])
  })

  it('a shared quest beats a solo quest with the same number of objectives', () => {
    const many = [quest('solo', { mapId: 'woods' }), quest('both', { mapId: 'customs' })]
    const ranks = rankMaps([{ memberId: 'a', activeQuestIds: ['solo', 'both'] }, { memberId: 'b', activeQuestIds: ['solo2', 'both'] }], many, [])
    expect(ranks[0].mapId).toBe('customs')
  })

  it('leaves out objectives a member already finished', () => {
    const members = [
      { memberId: 'a', activeQuestIds: ['solo-woods'], objectives: { 'solo-woods': [{ objectiveId: 'w1', done: true }, { objectiveId: 'w2', count: 3, target: 3 }] } },
    ]
    expect(rankMaps(members, quests, markers)).toEqual([{ mapId: 'woods', score: 1, objectives: 1, quests: 1, sharedQuests: 0, perMember: { a: 1 }, covered: 1 }])
  })
})

describe('rankMaps for a group of friends', () => {
  const list = [
    quest('a1', { mapId: 'woods' }), quest('a2', { mapId: 'woods' }), quest('a3', { mapId: 'woods' }), quest('a4', { mapId: 'woods' }),
    quest('a5', { mapId: 'customs' }), quest('b1', { mapId: 'customs' }), quest('c1', { mapId: 'customs' }), quest('c2', { mapId: 'reserve' }),
  ]
  const members = [
    { memberId: 'me', activeQuestIds: ['a1', 'a2', 'a3', 'a4', 'a5'] },
    { memberId: 'b', activeQuestIds: ['b1'] },
    { memberId: 'c', activeQuestIds: ['c1', 'c2'] },
  ]

  it('counts each member’s quests per map', () => {
    const customs = rankMaps(members, list, []).find((rank) => rank.mapId === 'customs')!
    expect(customs.perMember).toEqual({ me: 1, b: 1, c: 1 })
    expect(customs.covered).toBe(3)
  })

  it('puts first the map where everyone has quests, not the one with the most quests of one person', () => {
    // Woods has 4 quests, all of them mine; Customs has one for each of the three.
    expect(rankMaps(members, list, []).map((rank) => rank.mapId)).toEqual(['customs', 'woods', 'reserve'])
  })

  it('between maps that cover everyone, prefers the one where the member with the fewest quests has more', () => {
    const more = [...list, quest('b2', { mapId: 'reserve' }), quest('a6', { mapId: 'reserve' }), quest('c3', { mapId: 'reserve' })]
    const group = [
      { memberId: 'me', activeQuestIds: ['a5', 'a6'] },
      { memberId: 'b', activeQuestIds: ['b1', 'b2'] },
      { memberId: 'c', activeQuestIds: ['c1', 'c2', 'c3'] },
    ]
    // Reserve: me 1, b 1, c 2 — Customs: me 1, b 1, c 1. Both cover everyone with at least 1; Reserve has more to do.
    expect(rankMaps(group, more, [])[0].mapId).toBe('reserve')
  })
})

describe('planMapRoute', () => {
  it('lists each remaining objective once with who needs it, in route order, starting where most members go', () => {
    const members = [
      { memberId: 'a', activeQuestIds: ['shared', 'solo-customs', 'anywhere'] },
      { memberId: 'b', activeQuestIds: ['shared'], objectives: { shared: [{ objectiveId: 'o2', done: true }] } },
    ]
    const plan = planMapRoute(members, quests, markers, 'customs')
    expect(plan.steps.map((step) => [step.objectiveId, step.label, step.memberIds])).toEqual([
      ['o1', 'Отметить бензовоз', ['a', 'b']],
      ['o2', 'Найти часы', ['a']],
    ])
    expect(plan.unplaced).toEqual([{ questId: 'solo-customs', memberIds: ['a'], anyMap: false }, { questId: 'anywhere', memberIds: ['a'], anyMap: true }])
  })
})

describe('planMapRoute order', () => {
  it('starts at the point most members need and walks the rest by the shared route optimiser', () => {
    const route = [quest('r', { mapId: 'woods', objectiveIds: ['far', 'near', 'mid', 'start'] })]
    const points = [marker('far', 'r', 'woods', 'far', [100, 0]), marker('near', 'r', 'woods', 'near', [1, 0]), marker('mid', 'r', 'woods', 'mid', [50, 0]), marker('start', 'r', 'woods', 'start', [0, 0])]
    const members = [{ memberId: 'a', activeQuestIds: ['r'] }]
    expect(planMapRoute(members, route, points, 'woods').steps.map((step) => step.objectiveId)).toEqual(['far', 'mid', 'near', 'start'])
  })
})

describe('squad overview and needed items', () => {
  it('skips items of finished objectives and keeps the found-in-raid flag', () => {
    const members = [
      { memberId: 'a', activeQuestIds: ['shared'] },
      { memberId: 'b', activeQuestIds: ['shared'], objectives: { shared: [{ objectiveId: 'o1', done: true }] } },
    ]
    const overview = computeSquadOverview(members, quests)
    expect(overview.items).toEqual([{ itemId: 'watch', total: 2, foundInRaid: true, members: [{ memberId: 'a', count: 1 }, { memberId: 'b', count: 1 }], questIds: ['shared'] }])
    expect(itemIdsNeededBy([members[1]], quests)).toEqual(['watch'])
    expect(itemIdsNeededBy(members, quests)).toEqual(['marker', 'watch'])
  })
})
