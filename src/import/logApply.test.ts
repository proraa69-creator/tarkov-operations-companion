import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { RaidMode } from '../domain/types'
import { applyLogQuestState, applyScanToModes, logEventsForMode } from './logApply'
import type { ParsedTaskEvent } from './logParser'

const event = { taskId: '5936d90786f7742b1420ba5b', status: 'active' as const, timestamp: '2026-09-25T10:00:00.000Z', accountId: 100, mode: 'pvp' as const }

describe('log event application', () => {
  it('applies mode events even when the profile is not registered', () => {
    const result = { eventsByMode: { pvp: [event], pve: [], seasonal: [] }, latestAccountIdByMode: { pvp: 100 } }
    expect(logEventsForMode(result, 'pvp', { status: 'unregistered' })).toEqual([event])
  })

  it('falls back to all mode events if the registered account is missing from logs', () => {
    const result = { eventsByMode: { pvp: [event], pve: [], seasonal: [] }, latestAccountIdByMode: { pvp: 100 } }
    expect(logEventsForMode(result, 'pvp', { status: 'registered', accountId: 999 })).toEqual([event])
  })

  it('replaces old log records with the logged state and keeps manual edits and scanned story chapters', () => {
    const progress = createModeProgress()
    progress.taskProgress['story-tour'] = { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-09-26T00:00:00.000Z', currentStageIndex: 3 }
    progress.taskProgress.stale = { taskId: 'stale', status: 'active', source: 'eft-log', updatedAt: '2026-09-20T00:00:00.000Z' }
    progress.taskProgress.inferred = { taskId: 'inferred', status: 'completed', source: 'inferred', updatedAt: '2026-09-26T00:00:00.000Z' }
    progress.taskProgress.story = { taskId: 'story', status: 'active', source: 'manual', updatedAt: '2026-09-26T00:00:00.000Z', currentStageIndex: 7 }
    progress.taskProgress.fixed = { taskId: 'fixed', status: 'completed', source: 'manual', updatedAt: '2026-09-27T12:00:00.000Z' }
    const next = applyLogQuestState(progress, [
      { taskId: 'accepted', status: 'active', timestamp: '2026-09-27T08:00:00.000Z' },
      { taskId: 'fixed', status: 'active', timestamp: '2026-09-27T08:00:00.000Z' },
    ])
    expect(Object.keys(next.taskProgress).sort()).toEqual(['accepted', 'fixed', 'story', 'story-tour'])
    expect(next.taskProgress['story-tour']?.currentStageIndex).toBe(3)
    expect(next.taskProgress.accepted).toMatchObject({ status: 'active', source: 'eft-log' })
    expect(next.taskProgress.fixed).toMatchObject({ status: 'completed', source: 'manual' })
    expect(next.taskProgress.story?.currentStageIndex).toBe(7)
  })

  it('applies every mode only its own events', () => {
    const pvp: ParsedTaskEvent = { ...event, taskId: 'a' }
    const season: ParsedTaskEvent = { ...event, taskId: 'b', mode: 'seasonal' }
    const applied: Array<[RaidMode, string[]]> = []
    applyScanToModes(
      {
        eventsByMode: { pvp: [pvp], pve: [], seasonal: [season] },
        summaryByMode: { pvp: { lastActivityAt: '2026-09-27T00:00:00.000Z' }, pve: {}, seasonal: { lastActivityAt: '2026-09-18T00:00:00.000Z' } },
      },
      () => ({ status: 'unregistered' }),
      (mode, events) => applied.push([mode, events.map((entry) => entry.taskId)]),
    )
    expect(applied).toEqual([['pvp', ['a']], ['seasonal', ['b']]])
  })
})
