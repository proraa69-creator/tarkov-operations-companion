import { describe, expect, it } from 'vitest'
import { diagnosticsLine, emptyQuestInputs, resolveQuestStates, withInferred, type QuestEngineInputs, type QuestInputLayers } from './questEngine'
import type { RaidMode, TaskProgressRecord } from '../domain/types'

const A = '5936d90786f7742b1420ba5b'
const B = '5936d90786f7742b1420ba5c'
const t = (hour: number) => `2026-10-15T${String(hour).padStart(2, '0')}:00:00.000Z`
const screen = (taskId: string, status: TaskProgressRecord['status'], hour: number, extra: Partial<TaskProgressRecord> = {}): TaskProgressRecord => ({ taskId, status, source: 'screen-scan', updatedAt: t(hour), ...extra })
const inputs = (layers: Partial<QuestInputLayers>, mode: RaidMode = 'pve', floor?: string): QuestEngineInputs => ({ ...emptyQuestInputs(), ...layers, mode, ...(floor ? { floor } : {}) })
const decide = (layers: Partial<QuestInputLayers>, mode: RaidMode = 'pve', floor?: string) => resolveQuestStates(inputs(layers, mode, floor)).states.get(A)!

describe('the precedence, case by case (docs/quests/quest-state-engine.md)', () => {
  it('1. the floor: anything older than the mode\'s reset is ignored, from every source', () => {
    const state = decide({
      log: { [A]: { status: 'completed', at: t(8) } },
      server: { [A]: { status: 'completed', at: t(8) } },
      manual: { [A]: { status: 'completed', at: t(8) } },
      table: { [A]: screen(A, 'active', 8) },
    }, 'pve', t(10))
    expect(state.status).toBe('not-started')
    expect(state.conflicts.filter((conflict) => conflict.kind === 'before-floor').map((conflict) => conflict.source).sort()).toEqual(['log', 'manual', 'server', 'table'])
    // After the floor, the same source counts.
    expect(decide({ log: { [A]: { status: 'active', at: t(11) } } }, 'pve', t(10))).toMatchObject({ status: 'active', source: 'log', at: t(11) })
  })

  it('2. the logs decide trader quests: the newest event of this PC\'s logs and the server\'s records', () => {
    expect(decide({ log: { [A]: { status: 'active', at: t(9) } }, server: { [A]: { status: 'completed', at: t(10) } } })).toMatchObject({ status: 'completed', source: 'server', at: t(10), confidence: 0.9 })
    expect(decide({ log: { [A]: { status: 'completed', at: t(11) } }, server: { [A]: { status: 'active', at: t(10) } } })).toMatchObject({ status: 'completed', source: 'log', confidence: 0.95 })
    // The server's copy of this PC's own event: the same time, this PC's log.
    expect(decide({ log: { [A]: { status: 'active', at: t(10) } }, server: { [A]: { status: 'active', at: t(10) } } }).source).toBe('log')
  })

  it('3. a manual mark beats an older log event and loses to a newer one', () => {
    expect(decide({ log: { [A]: { status: 'active', at: t(9) } }, manual: { [A]: { status: 'completed', at: t(10) } } })).toMatchObject({ status: 'completed', source: 'manual', confidence: 1 })
    const newer = decide({ log: { [A]: { status: 'active', at: t(11) } }, manual: { [A]: { status: 'completed', at: t(10) } } })
    expect(newer).toMatchObject({ status: 'active', source: 'log' })
    expect(newer.conflicts).toEqual([expect.objectContaining({ kind: 'manual-overridden', source: 'manual', status: 'completed' })])
    // Against the server's records (another PC's logs) the same.
    expect(decide({ server: { [A]: { status: 'active', at: t(11) } }, manual: { [A]: { status: 'completed', at: t(10) } } }).source).toBe('server')
    // «Снять отметку»: the mark no longer counts, the logs decide again.
    expect(decide({ log: { [A]: { status: 'active', at: t(9) } }, manual: { [A]: { status: 'cleared', at: t(10) } } })).toMatchObject({ status: 'active', source: 'log' })
    expect(decide({ manual: { [A]: { status: 'cleared', at: t(10) } } }).status).toBe('not-started')
  })

  it('4. the Tasks table fills gaps in PvE only, never against a log event and never «completed»', () => {
    expect(decide({ table: { [A]: screen(A, 'active', 10) } })).toMatchObject({ status: 'active', source: 'table', confidence: 0.7 })
    // A newer reading that disagrees with the logs: the logs win, the disagreement is listed.
    const against = decide({ log: { [A]: { status: 'completed', at: t(9) } }, table: { [A]: screen(A, 'active', 10) } })
    expect(against).toMatchObject({ status: 'completed', source: 'log' })
    expect(against.conflicts).toEqual([expect.objectContaining({ kind: 'screen-vs-log', status: 'active', detail: 'log:completed' })])
    // A completion the table cannot show (an older version's chain guess): a hint, not a decision.
    const guessed = decide({ table: { [A]: screen(A, 'completed', 10) } })
    expect(guessed.status).toBe('not-started')
    expect(guessed.conflicts[0]).toMatchObject({ kind: 'table-completed-unproven' })
    // PvP and Season: the table is ignored.
    for (const mode of ['pvp', 'seasonal'] as const) {
      const state = decide({ table: { [A]: screen(A, 'active', 10) } }, mode)
      expect(state.status).toBe('not-started')
      expect(state.conflicts[0]).toMatchObject({ kind: 'table-outside-pve' })
    }
  })

  it('5. story chapters: the pane in every mode, the logs where they exist, the newer decides; stage and objectives from the pane', () => {
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
      expect(decide({ story: { [A]: screen(A, 'active', 10, { currentStageIndex: 3 }) } }, mode)).toMatchObject({ status: 'active', source: 'story', confidence: 0.8 })
    }
    const resolution = resolveQuestStates(inputs({ log: { [A]: { status: 'completed', at: t(11) } }, story: { [A]: screen(A, 'active', 10, { currentStageIndex: 3 }) } }, 'pvp'))
    expect(resolution.states.get(A)).toMatchObject({ status: 'completed', source: 'log' })
    expect(resolution.taskProgress[A]).toMatchObject({ status: 'completed', source: 'eft-log', currentStageIndex: 3 })
    expect(decide({ log: { [A]: { status: 'active', at: t(9) } }, story: { [A]: screen(A, 'completed', 10) } }, 'pvp')).toMatchObject({ status: 'completed', source: 'story' })
  })

  it('6. server records keep their source and time; 7. legacy manual records fill only what nothing else covers', () => {
    const resolution = resolveQuestStates(inputs({ server: { [A]: { status: 'completed', at: t(10) } }, legacy: { [B]: { taskId: B, status: 'completed', source: 'manual', updatedAt: t(5) } } }))
    expect(resolution.taskProgress[A]).toEqual({ taskId: A, status: 'completed', source: 'eft-log', origin: 'server', updatedAt: t(10) })
    expect(resolution.states.get(B)).toMatchObject({ status: 'completed', source: 'legacy', confidence: 0.4 })
    expect(decide({ log: { [A]: { status: 'active', at: t(1) } }, legacy: { [A]: { taskId: A, status: 'completed', source: 'manual', updatedAt: t(5) } } }).source).toBe('log')
  })
})

describe('the engine as a whole', () => {
  it('modes never mix: the same layers decide per mode, and only PvE takes the table', () => {
    const layers = { log: { [B]: { status: 'active' as const, at: t(9) } }, table: { [A]: screen(A, 'active', 10) } }
    expect([...resolveQuestStates(inputs(layers, 'pve')).states.values()].filter((state) => state.status !== 'not-started')).toHaveLength(2)
    expect(Object.keys(resolveQuestStates(inputs(layers, 'pvp')).taskProgress)).toEqual([B])
  })

  it('lists the catalog\'s contradictions: a completion whose prerequisite is still active, an id the catalog does not have', () => {
    const catalog = [{ id: A, requirements: [{ taskId: B, allowedStatuses: ['complete'] }] }, { id: B }]
    const resolution = resolveQuestStates(inputs({ log: { [A]: { status: 'completed', at: t(10) }, [B]: { status: 'active', at: t(9) }, ['0'.repeat(24)]: { status: 'active', at: t(9) } } }), catalog)
    expect(resolution.states.get(A)!.conflicts).toEqual([expect.objectContaining({ kind: 'prerequisite-open', status: 'active', detail: B })])
    expect(resolution.diagnostics).toMatchObject({ unknownIds: 1, conflicts: { 'prerequisite-open': 1, 'unknown-quest': 1 } })
  })

  it('the diagnostics explain a count at a glance; inference is listed, never counted', () => {
    const resolution = resolveQuestStates(inputs({
      log: { [A]: { status: 'completed', at: t(10) } },
      table: { [B]: screen(B, 'active', 10) },
      manual: { ['1'.repeat(24)]: { status: 'completed', at: t(10) } },
    }))
    const availability = new Map([[A, { status: 'completed' }], ['x', { status: 'completed', basis: 'chain' }], ['y', { status: 'completed', basis: 'line' }]])
    const diagnostics = withInferred(resolution.diagnostics, availability)
    expect(diagnostics).toMatchObject({ completed: 2, active: 1, inferred: 2, decided: { log: { completed: 1 }, table: { active: 1 }, manual: { completed: 1 } } })
    expect(diagnosticsLine(diagnostics)).toBe('логи: 1 выполнено, экран: +1, вручную: 1, вывод из цепочек: 2 (не считается)')
    expect(diagnosticsLine(diagnostics, 'en')).toBe('logs: 1 completed, screen: +1, manual: 1, chain inference: 2 (not counted)')
  })
})
