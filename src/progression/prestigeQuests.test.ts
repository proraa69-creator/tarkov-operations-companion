import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { Quest } from '../domain/types'
import { NEW_BEGINNING_IDS, withCuratedTasks } from '../data/curatedQuests'
import { calculateAvailability, evaluateTaskAvailability } from './requirementEngine'
import { prestigeMismatch, taskPrestigeOf } from './prestigeQuests'

const RAGMAN = '5ac3b934156ae10c4430e83c'

const newBeginning = (prestige: number, level: number): Quest => ({
  id: `nb-${prestige}`, name: 'Новое начало', trader: 'Барахольщик', traderId: RAGMAN, level, kappa: false,
  description: '', objectives: [], rewards: [], prestige,
})

describe('report №100: «Новое начало» is given at its own prestige only', () => {
  it('reads the prestige from the known ids and from tarkov.dev `requiredPrestige`', () => {
    const root = { prestige: [{ id: 'p1', prestigeLevel: 1 }, { id: 'p3', prestigeLevel: 3 }] }
    expect(taskPrestigeOf({ id: '6761f28a022f60bb320f3e95' }, root)).toBe(0)
    expect(taskPrestigeOf({ id: NEW_BEGINNING_IDS.prestige4 }, root)).toBe(3)
    expect(taskPrestigeOf({ id: 'later-one', requiredPrestige: 'p3' }, root)).toBe(3)
    expect(taskPrestigeOf({ id: 'plain' }, root)).toBeUndefined()
    expect(taskPrestigeOf({ id: 'unknown-prestige', requiredPrestige: 'p9' }, root)).toBeUndefined()
  })

  it('opens the one of the character\'s prestige; the others say why they are closed', () => {
    const progress = { ...createModeProgress(), playerLevel: 40, prestige: 3 }
    expect(evaluateTaskAvailability(newBeginning(3, 35), progress).status).toBe('available')
    expect(evaluateTaskAvailability(newBeginning(2, 30), progress)).toMatchObject({ status: 'locked', blockers: ['Только на престиже 2'] })
    expect(evaluateTaskAvailability(newBeginning(4, 45), { ...progress, playerLevel: 50 })).toMatchObject({ status: 'locked', blockers: ['Нужен престиж 4'] })
    // the level still counts at the right prestige
    expect(evaluateTaskAvailability(newBeginning(3, 35), { ...progress, playerLevel: 1 }).status).toBe('locked')
    expect(prestigeMismatch({}, 5)).toBeUndefined()
  })

  it('is never «probably done» from the chronology', () => {
    const progress = { ...createModeProgress(), playerLevel: 40, prestige: 0 }
    const availability = calculateAvailability([newBeginning(0, 25)], progress)
    expect(availability.get('nb-0')?.status).toBe('available')
  })

  it('PvE gets prestige 2, 3 and 4 with the PvE levels; PvP keeps tarkov.dev\'s own', () => {
    const traders = { ragman: { id: RAGMAN } }
    const pve = withCuratedTasks({ tasks: {} }, { mode: 'pve', locale: 'ru', maps: {}, traders })
    const tasks = pve.tasks.tasks as Record<string, { minPlayerLevel: number; name: string; objectives: Array<{ id: string }> }>
    expect([NEW_BEGINNING_IDS.prestige2, NEW_BEGINNING_IDS.prestige3, NEW_BEGINNING_IDS.prestige4].map((id) => tasks[id]?.minPlayerLevel)).toEqual([20, 30, 35])
    expect(tasks[NEW_BEGINNING_IDS.prestige4]!.name).toBe('Новое начало')
    // the game's objective ids, so the logs' objective lines land on them
    expect(tasks[NEW_BEGINNING_IDS.prestige4]!.objectives[0]!.id).toBe('68481881f43abfdda205836d')
    const pvp = withCuratedTasks({ tasks: {} }, { mode: 'pvp', locale: 'ru', maps: {}, traders })
    expect([...pvp.added].filter((id) => Object.values(NEW_BEGINNING_IDS).includes(id as never))).toEqual([])
  })
})
