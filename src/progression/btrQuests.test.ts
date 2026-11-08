import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { Quest, TaskProgressRecord } from '../domain/types'
import { evaluateTaskAvailability, isCurrentTrackedQuest } from './requirementEngine'

const BTR = '656f0f98d80a697f855d34b1'
const HELPING_HAND = '6752f6d83038f7df520c83e8'
const DEPARTURE_2 = '673f2cd5d3346c2167020484'

const quest = (id: string, traderId: string, extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: traderId === BTR ? 'Водитель БТР' : 'Прапор', traderId, level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra,
})
const record = (taskId: string, status: TaskProgressRecord['status']): TaskProgressRecord => ({ taskId, status, source: 'eft-log', updatedAt: '2026-11-06T08:25:28.790Z' })

describe('the BTR driver\'s quests on the map (owner, 08.11.2026: a player saw no BTR point)', () => {
  const departure = quest(DEPARTURE_2, BTR, { requirements: [{ taskId: HELPING_HAND, allowedStatuses: ['active'] }] })

  it('a quest that needs another one taken stays open once that one is done', () => {
    const progress = { ...createModeProgress(), playerLevel: 28, taskProgress: { [HELPING_HAND]: record(HELPING_HAND, 'completed') } }
    expect(evaluateTaskAvailability(departure, progress).status).toBe('available')
    expect(evaluateTaskAvailability(departure, { ...progress, taskProgress: {} }).status).toBe('locked')
  })

  it('an open BTR quest is current by itself though the logs never said it was taken; others only when taken; none once over', () => {
    const progress = { ...createModeProgress(), playerLevel: 28, taskProgress: { [HELPING_HAND]: record(HELPING_HAND, 'completed') } }
    const prapor = quest('prapor-open', '54cb50c76803fa8b248b4571')
    expect(isCurrentTrackedQuest(departure, progress)).toBe(true)
    expect(isCurrentTrackedQuest(prapor, progress)).toBe(false)
    expect(isCurrentTrackedQuest(departure, { ...progress, taskProgress: { ...progress.taskProgress, [DEPARTURE_2]: record(DEPARTURE_2, 'completed') } })).toBe(false)
    expect(isCurrentTrackedQuest(departure, { ...progress, taskProgress: { ...progress.taskProgress, [DEPARTURE_2]: record(DEPARTURE_2, 'failed') } })).toBe(false)
    // its previous quest not done yet: not open
    const tyres = quest('tyres', BTR, { requirements: [{ taskId: 'departure-1', allowedStatuses: ['complete'] }] })
    expect(isCurrentTrackedQuest(tyres, progress)).toBe(false)
    expect(isCurrentTrackedQuest(tyres, { ...progress, taskProgress: { ...progress.taskProgress, 'departure-1': record('departure-1', 'completed') } })).toBe(true)
  })

  it('a BTR quest that follows no other one opens only after «Рука помощи»', () => {
    const loner = quest('loner', BTR)
    const fresh = { ...createModeProgress(), playerLevel: 1 }
    expect(isCurrentTrackedQuest(loner, fresh)).toBe(false)
    expect(isCurrentTrackedQuest(loner, { ...fresh, taskProgress: { [HELPING_HAND]: record(HELPING_HAND, 'completed') } })).toBe(true)
  })
})
