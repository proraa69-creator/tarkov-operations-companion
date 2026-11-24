import { describe, expect, it } from 'vitest'
import type { MapMarker, Quest } from '../domain/types'
import { friendQuestPoints, mergeLayerPeople, squadPeople } from './friendQuestLayer'
import type { Friend, PlannerPerson, SquadMember } from './socialClient'

const quest = (id: string, extra: Partial<Quest>): Quest => ({ id, name: `Quest ${id}`, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra })
const marker = (id: string, questId: string, mapId: string, objectiveId: string, position: [number, number]): MapMarker => ({ id, questId, mapId, objectiveId, position, type: 'quest', title: `point ${objectiveId}`, description: '' })
const person = (id: string, activeQuestIds: string[], extra: Partial<PlannerPerson> = {}): PlannerPerson => ({ id, nickname: `N${id}`, hidden: false, activeQuestIds, objectives: {}, completedCount: 0, lastSyncAt: null, ...extra })
const friend = (friendId: string): Friend => ({ friendId, nicknames: {}, since: '2026-10-01', hideMyProgress: false, sharesProgress: true })

const quests = [quest('q1', { mapId: 'customs' }), quest('q2', { mapId: 'customs' }), quest('q3', { mapId: 'woods' }), quest('any', { anyMap: true })]
const markers = [marker('m1', 'q1', 'customs', 'o1', [0, 0]), marker('m2', 'q1', 'customs', 'o2', [5, 5]), marker('m3', 'q2', 'customs', 'p1', [0, 0]), marker('m4', 'q3', 'woods', 'w1', [1, 1])]
const colors = new Map([['a'.repeat(24), '#111111'], ['b'.repeat(24), '#222222']])

describe('friends’ quest points on the map', () => {
  it('shows every friend’s remaining points of this map in the friend’s colour, side by side on a shared spot', () => {
    const a = 'a'.repeat(24)
    const b = 'b'.repeat(24)
    const { points, legend } = friendQuestPoints({
      people: [person('me', ['q1'], { isYou: true }), person(a, ['q1', 'q3', 'any'], { objectives: { q1: [{ objectiveId: 'o2', done: true }] } }), person(b, ['q2'])],
      sharing: [friend(a), friend(b)], colors, quests, markers, mapId: 'customs', mode: 'pvp',
    })
    expect(points.map((point) => [point.nickname, point.color, point.label, point.slot])).toEqual([
      [`N${a}`, '#111111', 'point o1', 0],
      [`N${b}`, '#222222', 'point p1', 1],
    ])
    expect(legend).toEqual([
      { friendId: a, nickname: `N${a}`, color: '#111111', quests: 1 },
      { friendId: b, nickname: `N${b}`, color: '#222222', quests: 1 },
    ])
  })

  it('leaves out a friend who hides their progress', () => {
    const a = 'a'.repeat(24)
    expect(friendQuestPoints({ people: [person(a, ['q1'], { hidden: true })], sharing: [friend(a)], colors, quests, markers, mapId: 'customs', mode: 'pvp' }).points).toEqual([])
  })
  it('a point knows its quest and what the friend still has to do there, for the point’s window', () => {
    const a = 'a'.repeat(24)
    const withGoals = [quest('q1', { mapId: 'customs', trader: 'Механик', objectiveDetails: [{ id: 'o1', type: 'visit', description: 'Найти склад', count: 1 }, { id: 'o2', type: 'visit', description: 'Осмотреть офис', count: 1 }] })]
    const { points } = friendQuestPoints({ people: [person(a, ['q1'])], sharing: [friend(a)], colors, quests: withGoals, markers, mapId: 'customs', mode: 'pvp' })
    expect(points.map((point) => [point.questId, point.objectiveId, point.trader])).toEqual([['q1', 'o1', 'Механик'], ['q1', 'o2', 'Механик']])
    expect(points[0].left).toEqual([{ objectiveId: 'o1', text: 'Найти склад' }, { objectiveId: 'o2', text: 'Осмотреть офис' }])
  })

  it('the squad mates come by their nicknames, a friend in the squad once (owner, 12.11.2026)', () => {
    const a = 'a'.repeat(24)
    const c = 'c'.repeat(24)
    const member = (memberId: string, extra: Partial<SquadMember> = {}): SquadMember => ({ memberId, nickname: `S${memberId}`, isYou: false, isOwner: false, joinedAt: '2026-11-01', activeQuestIds: ['q2'], ...extra })
    const mates = squadPeople([member('me', { isYou: true }), member(a), member(c)])
    expect(mates.map((mate) => mate.id)).toEqual([a, c])
    const people = mergeLayerPeople([person(a, ['q1'])], mates)
    expect(people.map((entry) => [entry.id, entry.squad ?? false])).toEqual([[a, true], [c, true]])
    const { points, legend } = friendQuestPoints({ people, sharing: [friend(a)], colors: new Map([[a, '#111111'], [c, '#333333']]), quests, markers, mapId: 'customs', mode: 'pvp' })
    expect(legend).toEqual([
      { friendId: a, nickname: `N${a}`, color: '#111111', quests: 1, squad: true },
      { friendId: c, nickname: `S${c}`, color: '#333333', quests: 1, squad: true },
    ])
    expect(points.map((point) => point.nickname)).toEqual([`N${a}`, `N${a}`, `S${c}`])
  })
})
