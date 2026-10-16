import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { RaidMode } from '../domain/types'
import { applyLogQuestState, applyScanToModes, dropRecordsBefore, logEpochChange, logEventsForMode } from './logApply'
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

  it('replaces old log records with the logged state, keeps scanned story chapters, and a log event beats a legacy manual record', () => {
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
    // Manual marking is retired (P19): the manual «done» of an older version no longer beats the logs, even a newer one.
    expect(next.taskProgress.fixed).toMatchObject({ status: 'active', source: 'eft-log', updatedAt: '2026-09-27T08:00:00.000Z' })
    // Untouched by the logs, a legacy manual record stays.
    expect(next.taskProgress.story?.currentStageIndex).toBe(7)
  })

  it('keeps a newer reading of the Tasks table or another PC\'s later event over an older log event', () => {
    const progress = createModeProgress()
    progress.taskProgress.scanned = { taskId: 'scanned', status: 'active', source: 'screen-scan', updatedAt: '2026-09-27T12:00:00.000Z' }
    progress.taskProgress.server = { taskId: 'server', status: 'completed', source: 'eft-log', updatedAt: '2026-09-27T12:00:00.000Z' }
    const next = applyLogQuestState(progress, [
      { taskId: 'scanned', status: 'failed', timestamp: '2026-09-27T08:00:00.000Z' },
      { taskId: 'server', status: 'active', timestamp: '2026-09-27T08:00:00.000Z' },
    ], { keepPreviousLogRecords: true })
    expect(next.taskProgress.scanned).toMatchObject({ status: 'active', source: 'screen-scan' })
    expect(next.taskProgress.server).toMatchObject({ status: 'completed', source: 'eft-log' })
  })

  it('keeps records read by earlier scans when the logs were rotated (same character, no reset)', () => {
    const progress = createModeProgress()
    progress.taskProgress.old = { taskId: 'old', status: 'completed', source: 'eft-log', updatedAt: '2026-09-01T00:00:00.000Z' }
    progress.taskProgress.moved = { taskId: 'moved', status: 'active', source: 'eft-log', updatedAt: '2026-09-01T00:00:00.000Z' }
    const events: ParsedTaskEvent[] = [{ taskId: 'moved', status: 'completed', timestamp: '2026-09-27T08:00:00.000Z' }]
    const kept = applyLogQuestState(progress, events, { keepPreviousLogRecords: true })
    expect(kept.taskProgress.old).toMatchObject({ status: 'completed' })
    expect(kept.taskProgress.moved).toMatchObject({ status: 'completed' })
    expect(applyLogQuestState(progress, events).taskProgress.old).toBeUndefined()
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

  it('passes each mode its character, its trusted reset and since when the logs show that character', () => {
    const calls: unknown[][] = []
    applyScanToModes(
      {
        eventsByMode: { pvp: [event], pve: [], seasonal: [] },
        latestCharacterIdByMode: { pvp: 'a'.repeat(24) },
        summaryByMode: { pvp: { lastActivityAt: '2026-09-27T00:00:00.000Z', resetAt: '2026-09-26T00:00:00.000Z', profileSince: '2026-09-20T00:00:00.000Z' } },
      },
      () => ({ status: 'unregistered' }),
      (...args) => calls.push(args),
    )
    expect(calls).toEqual([['pvp', [event], 'a'.repeat(24), '2026-09-26T00:00:00.000Z', '2026-09-20T00:00:00.000Z']])
  })
})

describe('a new character or a trusted reset (R4)', () => {
  const OLD = 'a'.repeat(24), NEW = 'b'.repeat(24)
  const now = '2026-10-14T12:00:00.000Z'

  it('is a change only for another character id, or a newer reset; never for no profile line', () => {
    expect(logEpochChange({ logCharacterId: OLD }, { characterId: NEW, characterSince: '2026-10-10T00:00:00.000Z' }, now))
      .toEqual({ kind: 'character', at: '2026-10-10T00:00:00.000Z', characterId: NEW, previousCharacterId: OLD })
    // The server's scope says nothing of since when: everything before now belonged to the character before.
    expect(logEpochChange({ logCharacterId: OLD }, { characterId: NEW }, now)?.at).toBe(now)
    expect(logEpochChange({ logCharacterId: OLD }, { characterId: OLD }, now)).toBeNull()
    expect(logEpochChange({ logCharacterId: OLD }, {}, now)).toBeNull()
    // The first character a mode learns is no change.
    expect(logEpochChange({}, { characterId: NEW }, now)).toBeNull()
    expect(logEpochChange({ logCharacterId: OLD }, { characterId: OLD, resetAt: '2026-10-12T00:00:00.000Z' }, now))
      .toEqual({ kind: 'reset', at: '2026-10-12T00:00:00.000Z', characterId: OLD })
    // Told once: the same reset (or an older one) again is no change.
    expect(logEpochChange({ logCharacterId: OLD, logResetAt: '2026-10-12T00:00:00.000Z' }, { characterId: OLD, resetAt: '2026-10-12T00:00:00.000Z' }, now)).toBeNull()
    expect(logEpochChange({ logCharacterId: OLD, logResetAt: '2026-10-12T00:00:00.000Z' }, { characterId: OLD, resetAt: '2026-10-01T00:00:00.000Z' }, now)).toBeNull()
    // An unknown character with a reset: still the reset of the character kept.
    expect(logEpochChange({ logCharacterId: OLD }, { resetAt: '2026-10-12T00:00:00.000Z' }, now)).toEqual({ kind: 'reset', at: '2026-10-12T00:00:00.000Z', characterId: OLD })
  })

  it('drops the quest, story and objective records older than the change and keeps the preferences', () => {
    const progress = createModeProgress()
    progress.trackedTaskIds = ['kept-track']
    progress.favoriteItemIds = ['ledx']
    progress.hideoutLevels = { lavatory: 2 }
    progress.playerLevel = 42
    progress.taskProgress = {
      oldLog: { taskId: 'oldLog', status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T00:00:00.000Z' },
      oldScan: { taskId: 'oldScan', status: 'active', source: 'screen-scan', updatedAt: '2026-10-02T00:00:00.000Z' },
      oldStory: { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-10-03T00:00:00.000Z', currentStageIndex: 4 },
      oldManual: { taskId: 'oldManual', status: 'completed', source: 'manual', updatedAt: '2026-10-04T00:00:00.000Z' },
      newScan: { taskId: 'newScan', status: 'active', source: 'screen-scan', updatedAt: '2026-10-11T00:00:00.000Z' },
    }
    progress.objectiveProgress = {
      old: { objectiveId: 'old', taskId: 'oldLog', type: 'shoot', target: 5, current: 3, source: 'manual', confidence: 1, observedAt: '2026-10-01T00:00:00.000Z' },
    }
    const next = dropRecordsBefore(progress, '2026-10-10T00:00:00.000Z')
    expect(Object.keys(next.taskProgress)).toEqual(['newScan'])
    expect(next.objectiveProgress).toEqual({})
    expect(next).toMatchObject({ trackedTaskIds: ['kept-track'], favoriteItemIds: ['ledx'], hideoutLevels: { lavatory: 2 }, playerLevel: 42 })
  })
})
