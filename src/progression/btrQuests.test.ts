import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { ObjectiveProgress, ProgressSource, Quest, QuestObjective, TaskProgressRecord } from '../domain/types'
import { evaluateTaskAvailability, isCurrentTrackedQuest } from './requirementEngine'

const BTR = '656f0f98d80a697f855d34b1'
const PRAPOR = '54cb50c76803fa8b248b4571'
const HELPING_HAND = '6752f6d83038f7df520c83e8'
const DEPARTURE_2 = '673f2cd5d3346c2167020484'
const BTR_MYSELF = '6a76457a80a94c0cbf0b07ae'

const obj = (id: string, optional = false): QuestObjective => ({ id, type: 'visit', description: id, count: 1, ...(optional ? { optional } : {}) })
const quest = (id: string, traderId: string, extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: traderId === BTR ? 'Водитель БТР' : 'Прапор', traderId, level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra,
})
const record = (taskId: string, status: TaskProgressRecord['status'], source: ProgressSource = 'eft-log'): TaskProgressRecord => ({ taskId, status, source, updatedAt: '2026-11-25T08:25:28.790Z' })
const tick = (objectiveId: string, taskId: string, current: number, target: number): ObjectiveProgress => ({
  objectiveId, taskId, type: 'visit', target, current, source: 'manual', confidence: 1, observedAt: '2026-11-25T00:00:00.000Z',
  ...(current >= target ? { completedAt: '2026-11-25T00:00:00.000Z' } : {}),
})
const base = (extra: Partial<ReturnType<typeof createModeProgress>> = {}) => ({ ...createModeProgress(), playerLevel: 28, ...extra })

// «Задержка отправления. Часть 2»: a driver's quest that needs «Рука помощи» taken; one open objective.
const departure = quest(DEPARTURE_2, BTR, { requirements: [{ taskId: HELPING_HAND, allowedStatuses: ['active'] }], objectiveDetails: [obj('d-visit')] })

describe('the BTR driver\'s quests (reports 229/230: a player saw his quests though he never took them)', () => {
  it('its game availability is unchanged: open once «Рука помощи» is taken, locked without it', () => {
    const progress = base({ taskProgress: { [HELPING_HAND]: record(HELPING_HAND, 'completed') } })
    expect(evaluateTaskAvailability(departure, progress).status).toBe('available')
    expect(evaluateTaskAvailability(departure, base()).status).toBe('locked')
  })

  it('available by the game but not confirmed: NOT current (the app no longer assumes he took it)', () => {
    const progress = base({ taskProgress: { [HELPING_HAND]: record(HELPING_HAND, 'completed') } })
    expect(isCurrentTrackedQuest(departure, progress)).toBe(false)
    // another driver's quest further down the chain, equally unconfirmed, is not current either
    expect(isCurrentTrackedQuest(quest(BTR_MYSELF, BTR, { objectiveDetails: [obj('b-kill')] }), progress)).toBe(false)
  })

  it('a hand tick (or any objective count) on an open objective makes it current, even with the chain unseen', () => {
    const ticked = base({ objectiveProgress: { 'd-visit': tick('d-visit', DEPARTURE_2, 1, 2) } })
    expect(isCurrentTrackedQuest(departure, ticked)).toBe(true)
    // kept even when «Рука помощи» is not in the records: his hand-ins are logged almost never, the tick is the ground truth
    expect(isCurrentTrackedQuest(departure, { ...base(), objectiveProgress: { 'd-visit': tick('d-visit', DEPARTURE_2, 1, 2) } })).toBe(true)
  })

  it('every objective ticked = done but the hand-in not logged: NOT current', () => {
    const done = base({ objectiveProgress: { 'd-visit': tick('d-visit', DEPARTURE_2, 1, 1) } })
    expect(isCurrentTrackedQuest(departure, done)).toBe(false)
  })

  it('a screen reading or a mark (an active record) keeps it current — those on it are not broken', () => {
    expect(isCurrentTrackedQuest(departure, base({ taskProgress: { [DEPARTURE_2]: record(DEPARTURE_2, 'active', 'screen-scan') } }))).toBe(true)
    expect(isCurrentTrackedQuest(departure, base({ taskProgress: { [DEPARTURE_2]: record(DEPARTURE_2, 'active', 'manual') } }))).toBe(true)
    // handed in (any source): not current
    expect(isCurrentTrackedQuest(departure, base({ taskProgress: { [DEPARTURE_2]: record(DEPARTURE_2, 'completed', 'manual-fix') } }))).toBe(false)
    expect(isCurrentTrackedQuest(departure, base({ taskProgress: { [DEPARTURE_2]: record(DEPARTURE_2, 'failed') } }))).toBe(false)
  })

  it('only the BTR driver opens by a tick alone: an ordinary trader\'s quest with no record is never current by itself', () => {
    const praporQuest = quest('prapor-open', PRAPOR, { objectiveDetails: [obj('p-visit')] })
    const ticked = base({ objectiveProgress: { 'p-visit': tick('p-visit', 'prapor-open', 1, 2) } })
    expect(isCurrentTrackedQuest(praporQuest, ticked)).toBe(false)
  })

  it('report 230, PvE: «Задержка отправления. Часть 2» read from the screen is current, the rest of his chain is not', () => {
    // the player\'s real shape: «Рука помощи» done by the logs, one driver\'s quest read from the screen, nothing else confirmed
    const progress = base({ taskProgress: {
      [HELPING_HAND]: record(HELPING_HAND, 'completed'),
      [DEPARTURE_2]: record(DEPARTURE_2, 'active', 'screen-scan'),
    } })
    expect(isCurrentTrackedQuest(departure, progress)).toBe(true)
    expect(isCurrentTrackedQuest(quest(BTR_MYSELF, BTR, { objectiveDetails: [obj('b-kill')] }), progress)).toBe(false)
  })
})
