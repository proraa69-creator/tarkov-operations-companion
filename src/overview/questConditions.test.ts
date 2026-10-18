import { describe, expect, it } from 'vitest'
import type { Quest, QuestObjective, TaskProgressStatus } from '../domain/types'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { questAvailabilityOf } from '../quests/questReadModel'
import type { TaskAvailability } from '../progression/requirementEngine'
import { conditionQuestsForMap, excludedFromRaidLoadout, gearObjectives, objectiveOnMap, stablePick } from './questConditions'
import { conditionPieces } from './conditionText'

const ak = { id: 'ak12', name: 'АК-12' }
const shoot = (id: string, mapIds: string[] | undefined, gear = true): QuestObjective => ({
  id, type: 'shoot', description: '', count: 5, ...(mapIds ? { mapIds } : {}),
  conditions: gear ? { weapons: [ak] } : { targets: [{ key: 'Savage', name: 'Диких' }] },
})
const quest = (id: string, objectives: QuestObjective[], level = 10): Quest => ({
  id, name: id, trader: 'Прапор', level, kappa: false, description: '', objectives: [], rewards: [], objectiveDetails: objectives,
})
const statuses = (entries: Record<string, TaskProgressStatus>) => new Map<string, TaskAvailability>(Object.entries(entries).map(([id, status]) => [id, { status, blockers: [] }]))

const QUESTS = [
  quest('streets-only', [shoot('a', ['streets-of-tarkov'])]),
  quest('multi-map', [shoot('b', ['customs', 'streets-of-tarkov', 'shoreline'])], 20),
  quest('any-map', [shoot('c', undefined)], 5),
  quest('woods-only', [shoot('d', ['woods'])]),
  // a kill on Streets with no weapon or gear asked: not this card's business
  quest('no-gear', [shoot('e', ['streets-of-tarkov'], false)]),
  // a story chapter never shows
  { ...quest('story', [shoot('f', undefined)]), kind: 'story' as const },
]

describe('«Условия квестов»: which quests', () => {
  it('takes the objectives of the map, of several maps among them, or of any map; nothing else', () => {
    const result = conditionQuestsForMap(QUESTS, statuses({ 'streets-only': 'active', 'multi-map': 'active', 'any-map': 'active', 'woods-only': 'active', 'no-gear': 'active', story: 'active' }), 'streets-of-tarkov')
    expect(result.tier).toBe('active')
    // lowest level first
    expect(result.quests.map((entry) => entry.quest.id)).toEqual(['any-map', 'streets-only', 'multi-map'])
    expect(objectiveOnMap({ mapIds: [] }, 'woods')).toBe(true)
    expect(objectiveOnMap({ mapIds: ['customs'] }, 'woods')).toBe(false)
  })

  it('shows only the current (taken) quests: never available, completed, failed, locked or unknown (owner, 16.10.2026: «Гренадер»)', () => {
    const mixed = statuses({ 'streets-only': 'available', 'multi-map': 'active', 'any-map': 'completed' })
    expect(conditionQuestsForMap(QUESTS, mixed, 'streets-of-tarkov')).toMatchObject({ tier: 'active', quests: [{ quest: { id: 'multi-map' } }] })
    const noneCurrent = statuses({ 'streets-only': 'available', 'multi-map': 'locked', 'any-map': 'failed' })
    expect(conditionQuestsForMap(QUESTS, noneCurrent, 'streets-of-tarkov')).toEqual({ tier: 'none', quests: [] })
    const done = statuses({ 'streets-only': 'completed', 'multi-map': 'unknown', 'any-map': 'completed' })
    expect(conditionQuestsForMap(QUESTS, done, 'streets-of-tarkov')).toEqual({ tier: 'none', quests: [] })
  })

  it('reads each mode\'s own statuses from the quest-state engine: PvP and PvE never mix', () => {
    let profile = createLocalProfile('TEST', 'conditions')
    profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, playerLevel: 40 }, pve: { ...profile.modes.pve, playerLevel: 40 } } }
    profile = setTaskProgress(profile, 'pvp', { taskId: 'streets-only', status: 'active', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
    profile = setTaskProgress(profile, 'pve', { taskId: 'multi-map', status: 'active', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
    profile = setTaskProgress(profile, 'pve', { taskId: 'streets-only', status: 'completed', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
    const pvp = conditionQuestsForMap(QUESTS, questAvailabilityOf(QUESTS, profile.modes.pvp), 'streets-of-tarkov')
    const pve = conditionQuestsForMap(QUESTS, questAvailabilityOf(QUESTS, profile.modes.pve), 'streets-of-tarkov')
    expect(pvp.quests.map((entry) => entry.quest.id)).toEqual(['streets-only'])
    expect(pve.quests.map((entry) => entry.quest.id)).toEqual(['multi-map'])
  })
})

describe('«Условия квестов»: one quest at random, kept', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('keeps the pick for the same map and quests (a re-render, a price refresh, another order of the same quests)', () => {
    const first = stablePick(ids, 'pvp:customs', 'seed-1')
    for (let run = 0; run < 5; run += 1) expect(stablePick(ids, 'pvp:customs', 'seed-1')).toBe(first)
    expect(stablePick([...ids].reverse(), 'pvp:customs', 'seed-1')).toBe(first)
    expect(stablePick([], 'pvp:customs', 'seed-1')).toBeUndefined()
  })

  it('picks again for another map or mode, and at the next app start (another seed); every quest can come up', () => {
    const byMap = new Set(['customs', 'woods', 'shoreline', 'interchange', 'reserve', 'lighthouse', 'factory', 'streets-of-tarkov', 'ground-zero', 'labs']
      .map((map) => stablePick(ids, `pvp:${map}`, 'seed-1')))
    expect(byMap.size).toBeGreaterThan(1)
    const bySeed = new Set(Array.from({ length: 40 }, (_, index) => stablePick(ids, 'pvp:customs', `start-${index}`)))
    expect([...bySeed].sort()).toEqual(ids)
  })
})

describe('«Условия квестов»: the short line', () => {
  it('count, targets, distance, body parts and hours in a few words', () => {
    expect(conditionPieces({ count: 5, conditions: { targets: [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }], distance: { compare: '>=', value: 50 }, bodyParts: [{ key: 'Head', name: 'голову' }] } }))
      .toEqual(['×5', 'ЧВК', '50+ м', 'голова'])
    expect(conditionPieces({ count: 1, conditions: { targets: [{ key: 'bossKilla', name: 'Килла' }], distance: { compare: '<=', value: 25 }, time: { from: 21, until: 5 }, hitOnly: true } }))
      .toEqual(['Килла', 'до 25 м', '21:00–05:00', 'попадание'])
  })
})

describe('quests «Сбор на рейд» leaves out', () => {
  it('never shows «Гренадер», by its id or its name, even while it is a current quest (owner, 17.10.2026)', () => {
    const grenadier = { ...quest('5c0d190cd09282029f5390d8', [shoot('g', undefined)]), name: 'Гренадёр' }
    const byName = { ...quest('custom-id', [shoot('g2', undefined)]), name: 'Grenadier' }
    expect(excludedFromRaidLoadout(grenadier)).toBe(true)
    expect(excludedFromRaidLoadout(byName)).toBe(true)
    expect(gearObjectives(grenadier)).toEqual([])
    const shown = conditionQuestsForMap([grenadier, byName, quest('patriot', [shoot('p', undefined)])], statuses({ '5c0d190cd09282029f5390d8': 'active', 'custom-id': 'active', patriot: 'active' }), 'customs')
    expect(shown.quests.map((entry) => entry.quest.id)).toEqual(['patriot'])
  })
})
