import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { AppDataset, ModeProgress, Quest, QuestInputLayers, TaskProgressRecord } from '../domain/types'
import { withQuestGrid } from '../data/questGrid'
import { applyLogQuestState } from '../import/logApply'
import { calculateAvailability } from '../progression/requirementEngine'
import grid from '../progression/__fixtures__/quest-grid-tasks-2026-10.json'
import ownerLogs from '../progression/__fixtures__/owner-logs-2026-09.json'
import { checkQuestRules, questCheckSummary, type QuestCheckRule } from './questChecks'
import { emptyQuestInputs, resolveQuestStates } from './questEngine'
import { resolveMode } from './questInputs'
import { withoutScreenQuestsAheadOfChain } from './screenChain'

/** The rules over the engine (owner, 02.11.2026: «построй логическую систему проверок … не допусти регресса»). */
const at = (hour: number, minute = 0) => `2026-10-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
const screen = (taskId: string, status: TaskProgressRecord['status'], when: string): TaskProgressRecord => ({ taskId, status, source: 'screen-scan', updatedAt: when })
const layersOf = (partial: Partial<QuestInputLayers>): QuestInputLayers => ({ ...emptyQuestInputs(), ...partial })
const decide = (layers: QuestInputLayers, floor?: string) => resolveQuestStates({ ...layers, mode: 'pvp', ...(floor ? { floor } : {}) })
const rulesOf = (layers: QuestInputLayers, floor?: string) => {
  const resolution = decide(layers, floor)
  return checkQuestRules({ layers, floor, resolution, stored: resolution.taskProgress })
}

describe('every rule holds for the engine', () => {
  const scenarios: Array<[string, QuestInputLayers, string?]> = [
    ['taken in the logs', layersOf({ log: { a: { status: 'active', at: at(10) } } })],
    ['seen on the screen only (bad logs): it shows', layersOf({ table: { a: screen('a', 'active', at(9)) } })],
    ['found by the screen, then handed in in the logs', layersOf({ table: { a: screen('a', 'active', at(9)) }, log: { a: { status: 'completed', at: at(11) } } })],
    ['handed in in the logs, an older screen reading still says held', layersOf({ log: { a: { status: 'completed', at: at(11) } }, table: { a: screen('a', 'active', at(12)) } })],
    ['the logs fail it', layersOf({ log: { a: { status: 'failed', at: at(11) } }, table: { a: screen('a', 'active', at(9)) } })],
    ['another PC hands it in later (server)', layersOf({ log: { a: { status: 'active', at: at(10) } }, server: { a: { status: 'completed', at: at(12) } } })],
    ['a mark newer than the logs', layersOf({ log: { a: { status: 'completed', at: at(10) } }, manual: { a: { status: 'active', at: at(11) } } })],
    ['the logs newer than the mark', layersOf({ manual: { a: { status: 'completed', at: at(10) } }, log: { a: { status: 'failed', at: at(11) } } })],
    ['a cleared mark', layersOf({ manual: { a: { status: 'cleared', at: at(12) } }, table: { a: screen('a', 'active', at(9)) } })],
    ['an old table «completed» (a chain guess of older versions)', layersOf({ table: { a: screen('a', 'completed', at(9)) } })],
    ['everything before the game\'s reset', layersOf({ log: { a: { status: 'completed', at: at(8) } }, table: { b: screen('b', 'active', at(8)) } }), at(9)],
    ['a story chapter: the pane newer than the logs', layersOf({ log: { 'story-tour': { status: 'active', at: at(8) } }, story: { 'story-tour': { taskId: 'story-tour', status: 'completed', source: 'screen-scan', updatedAt: at(10), currentStageIndex: 2 } } })],
    ['a legacy record nothing else covers', layersOf({ legacy: { a: { taskId: 'a', status: 'completed', source: 'manual', updatedAt: at(7) } } })],
  ]
  for (const [title, layers, floor] of scenarios) {
    it(title, () => expect(rulesOf(layers, floor)).toEqual([]))
  }

  it('holds for 500 random mixes of logs, server, marks, screen, story and floors (seeded)', () => {
    let seed = 20261102
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]
    const statuses = ['active', 'completed', 'failed'] as const
    const time = () => at(6 + Math.floor(random() * 12), Math.floor(random() * 4) * 15)
    for (let round = 0; round < 500; round += 1) {
      const layers = emptyQuestInputs()
      for (const id of ['a', 'b', 'c', 'story-d']) {
        if (random() < 0.5) layers.log[id] = { status: pick(statuses), at: time() }
        if (random() < 0.3) layers.server[id] = { status: pick(statuses), at: time() }
        if (random() < 0.25) layers.manual[id] = { status: pick(['active', 'completed', 'cleared'] as const), at: time() }
        if (random() < 0.4) layers.table[id] = screen(id, pick(['active', 'active', 'completed'] as const), time())
        if (id.startsWith('story') && random() < 0.5) layers.story[id] = { taskId: id, status: pick(statuses), source: 'screen-scan', updatedAt: time(), currentStageIndex: 1 }
        if (random() < 0.1) layers.legacy[id] = { taskId: id, status: pick(statuses), source: 'manual', updatedAt: time() }
      }
      const floor = random() < 0.3 ? time() : undefined
      const findings = rulesOf(layers, floor)
      if (findings.length) throw new Error(`round ${round}: ${JSON.stringify({ layers, floor, findings })}`)
    }
  })
})

describe('the checks catch a broken chain', () => {
  it('a status written past the engine (the old «Отменить»), a quest the logs closed shown held, a vanished screen quest', () => {
    const layers = layersOf({ log: { a: { status: 'completed', at: at(11) } }, table: { b: screen('b', 'active', at(9)) } })
    const resolution = decide(layers)
    // a writer that bypassed the engine
    const stored = { ...resolution.taskProgress, a: { taskId: 'a', status: 'active' as const, source: 'manual' as const, updatedAt: at(12) } }
    expect(checkQuestRules({ layers, resolution, stored }).map((finding) => finding.rule)).toEqual(['stored-is-decided'])
    // an engine that let the screen win over the logs and dropped the screen-only quest
    const broken = { states: new Map(resolution.states) }
    broken.states.set('a', { taskId: 'a', status: 'active', source: 'table', at: at(9), confidence: 0.7, conflicts: [] })
    broken.states.set('b', { taskId: 'b', status: 'not-started', confidence: 0, conflicts: [] })
    const rules = checkQuestRules({ layers, resolution: broken }).map((finding) => finding.rule).sort()
    expect(rules).toEqual<QuestCheckRule[]>(['game-closes', 'game-over-screen', 'seen-stays'])
    expect(questCheckSummary(checkQuestRules({ layers, resolution: broken }))[0]).toMatchObject({ title: 'Логи закрывают квест', count: 1 })
  })

  it('a screen «completed» decision and a decision below the floor', () => {
    const layers = layersOf({ table: { a: screen('a', 'active', at(9)) } })
    const broken = { states: new Map([['a', { taskId: 'a', status: 'completed' as const, source: 'table' as const, at: at(8), confidence: 0.7, conflicts: [] }]]) }
    expect(checkQuestRules({ layers, floor: at(8, 30), resolution: broken }).map((finding) => finding.rule).sort()).toEqual<QuestCheckRule[]>(['floor', 'screen-never-completes'])
  })
})

describe('the chain\'s parts against a screen reading (a player\'s ticket №37)', () => {
  const part = (id: string, number: number, needs?: string): Quest => ({ id, name: `Каратель. Часть ${number}`, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: needs ? [{ taskId: needs, allowedStatuses: ['complete'] }] : [] })
  const quests = [part('p1', 1), part('p2', 2, 'p1'), part('p3', 3, 'p2')]
  const layers = layersOf({ log: { p1: { status: 'active', at: at(8) } }, table: { p3: screen('p3', 'active', at(9)) } })
  const check = (held: QuestInputLayers) => {
    const resolution = decide(held)
    return checkQuestRules({ layers: held, resolution, stored: resolution.taskProgress, availability: new Map(), quests })
  }

  it('finds the part read ahead of the logs', () => {
    expect(check(layers).filter((finding) => finding.rule === 'screen-chain').map((finding) => finding.questId)).toEqual(['p3'])
  })

  it('with the record gone every rule holds, the chain\'s included', () => {
    const resolution = decide(layers)
    const clean = withoutScreenQuestsAheadOfChain(layers, resolution.taskProgress, quests)
    expect(clean.table).toEqual({})
    const after = decide(clean)
    const progress = { ...createModeProgress(), taskProgress: after.taskProgress, questInputs: clean }
    expect(checkQuestRules({ layers: clean, resolution: after, stored: after.taskProgress, availability: calculateAvailability(quests, progress), quests, player: progress })).toEqual([])
  })
})

/** The fixture's PvE tasks with the snapshot's lines (as src/progression/chronology.test.ts). */
function fixtureQuests(): Quest[] {
  const { traders, tasks } = grid.pve
  const quests = (tasks as unknown as Array<[string, string, number, number, { r?: string[][]; l?: Array<[number, number]>; f?: string; k?: number }?]>).map(([id, name, trader, level, extra]): Quest => ({
    id, name, trader: traders[trader][1], traderId: traders[trader][0], level, kappa: Boolean(extra?.k), faction: extra?.f, description: '', objectives: [], rewards: [],
    requirements: (extra?.r ?? []).map(([taskId, ...statuses]) => ({ taskId, allowedStatuses: statuses as Array<'complete' | 'failed' | 'active'> })),
    ...(extra?.l ? { traderLoyalty: { needed: extra.l.map(([index, loyalty]) => ({ traderId: traders[index]?.[0] ?? String(index), level: loyalty })), reached: [] } } : {}),
  } as Quest))
  return withQuestGrid({ quests, traders: traders.map(([id, name]) => ({ id, name })) } as unknown as AppDataset, 'pve').quests
}

describe("the owner's real logs (fixture of 2026-09) pass every rule", () => {
  const quests = fixtureQuests()
  const events = (mode: 'pve' | 'pvp') => (ownerLogs.events[mode] as Array<[string, TaskProgressRecord['status'], string]>).map(([timestamp, status, taskId]) => ({ taskId, status, timestamp }))
  for (const mode of ['pve', 'pvp'] as const) {
    it(`${mode}: the decision, the stored statuses, the chain, level and faction`, () => {
      const progress: ModeProgress = applyLogQuestState({ ...createModeProgress(), playerLevel: mode === 'pve' ? 40 : 5, faction: 'bear' }, events(mode), { mode, keepPreviousLogRecords: true })
      const resolution = resolveMode(progress, mode, quests)
      const availability = calculateAvailability(quests, progress)
      const findings = checkQuestRules({ layers: progress.questInputs!, resolution, stored: progress.taskProgress, availability, quests, player: progress })
      expect(findings).toEqual([])
    })
  }
})
