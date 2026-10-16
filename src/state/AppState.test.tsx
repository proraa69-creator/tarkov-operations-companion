import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile } from '../domain/progress'
import type { ModeProgress } from '../domain/types'
import { AppStateProvider, useAppState } from './AppState'
import { onLogEpochChange, type LogEpochEvent } from './logEpoch'

const OLD = 'a'.repeat(24)
const NEW = 'b'.repeat(24)
const QUEST = '5936d90786f7742b1420ba5b'
const OTHER = '5936d90786f7742b1420ba5c'

const probe: { current?: ReturnType<typeof useAppState> } = {}
function Probe() {
  const value = useAppState()
  useEffect(() => { probe.current = value })
  return null
}
/** The app state as the last render left it. */
const state = new Proxy({} as ReturnType<typeof useAppState>, { get: (_target, key) => probe.current![key as keyof ReturnType<typeof useAppState>] })

const pvp = (): ModeProgress => state.activeProfile.modes.pvp
const events: LogEpochEvent[] = []
let stop = () => {}

/** The old character's records as the app kept them: a log quest, a Tasks-table row, a story chapter at its stage. */
function savedProfile() {
  const profile = createLocalProfile('Оператор', 'local-test')
  profile.modes.pvp = {
    ...profile.modes.pvp,
    logCharacterId: OLD,
    trackedTaskIds: [OTHER],
    favoriteItemIds: ['ledx'],
    taskProgress: {
      [QUEST]: { taskId: QUEST, status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T10:00:00.000Z' },
      scanned: { taskId: 'scanned', status: 'active', source: 'screen-scan', updatedAt: '2026-10-02T10:00:00.000Z' },
      'story-tour': { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-10-03T10:00:00.000Z', currentStageIndex: 2 },
    },
  }
  return { activeProfileId: profile.id, profiles: [profile] }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify(savedProfile()))
  events.length = 0
  stop = onLogEpochChange((event) => { events.push(event) })
  render(<AppStateProvider><Probe /></AppStateProvider>)
})
afterEach(() => stop())

describe('records of a changed character or a reset (R4, step 25)', () => {
  it('a new character drops the mode\'s older quest and story records once, keeps the preferences, and tells it', async () => {
    expect(pvp().taskProgress[QUEST]).toMatchObject({ status: 'completed', source: 'eft-log' })
    expect(pvp().taskProgress['story-tour']).toMatchObject({ source: 'screen-scan', currentStageIndex: 2 })

    // A wipe: the logs show another profile in PvP since an hour ago.
    const since = new Date(Date.now() - 3_600_000).toISOString()
    act(() => state.applyLogScanForMode('pvp', [{ taskId: OTHER, status: 'active', timestamp: new Date().toISOString() }], { characterId: NEW, characterSince: since }))
    expect(Object.keys(pvp().taskProgress)).toEqual([OTHER])
    expect(pvp()).toMatchObject({ logCharacterId: NEW, logEpochAt: since, trackedTaskIds: [OTHER], favoriteItemIds: ['ledx'] })
    await Promise.resolve()
    expect(events).toEqual([expect.objectContaining({ kind: 'character', mode: 'pvp', characterId: NEW, previousCharacterId: OLD, at: since, profileId: state.activeProfile.id })])

    // The same scan again: no second drop, nothing told again.
    act(() => state.applyLogScanForMode('pvp', [{ taskId: QUEST, status: 'active', timestamp: new Date().toISOString() }], { characterId: NEW, characterSince: since }))
    act(() => state.applyLogScanForMode('pvp', [{ taskId: OTHER, status: 'active', timestamp: new Date(Date.now() - 1000).toISOString() }], { characterId: NEW, characterSince: since }))
    expect(pvp().taskProgress[QUEST]).toMatchObject({ status: 'active' })
    await Promise.resolve()
    expect(events).toHaveLength(1)
  })

  it('a trusted reset of the same character drops what came before it, and old events never come back', async () => {
    const resetAt = '2026-10-02T12:00:00.000Z'
    act(() => state.applyLogStateForMode('pvp', [{ taskId: OTHER, status: 'active', timestamp: '2026-10-06T00:00:00.000Z' }], OLD, resetAt))
    expect(Object.keys(pvp().taskProgress).sort()).toEqual([OTHER, 'story-tour'].sort())
    expect(pvp()).toMatchObject({ logResetAt: resetAt, logEpochAt: resetAt })
    await Promise.resolve()
    expect(events.map((event) => event.kind)).toEqual(['reset'])
    // Another PC (or the server) still sends the hand-in from before the reset: it does not come back.
    act(() => state.applyLogStateForMode('pvp', [{ taskId: QUEST, status: 'completed', timestamp: '2026-10-01T10:00:00.000Z' }], OLD))
    expect(pvp().taskProgress[QUEST]).toBeUndefined()
    expect(pvp().taskProgress[OTHER]).toMatchObject({ status: 'active' })
  })

  it('no profile line in the logs is no change: the records stay (P17)', async () => {
    act(() => state.applyLogStateForMode('pvp', [{ taskId: OTHER, status: 'active', timestamp: '2026-10-06T00:00:00.000Z' }]))
    expect(pvp().taskProgress[QUEST]).toMatchObject({ status: 'completed' })
    expect(pvp().taskProgress.scanned).toMatchObject({ status: 'active' })
    expect(pvp().taskProgress[OTHER]).toMatchObject({ status: 'active' })
    expect(pvp().logCharacterId).toBe(OLD)
    await Promise.resolve()
    expect(events).toEqual([])
  })

  it('keeps PvP, PvE and the season apart', () => {
    act(() => state.applyLogStateForMode('pve', [{ taskId: OTHER, status: 'active', timestamp: '2026-10-06T00:00:00.000Z' }], NEW))
    act(() => state.applyLogStateForMode('pve', [], OLD))
    expect(pvp().taskProgress[QUEST]).toMatchObject({ status: 'completed' })
    expect(state.activeProfile.modes.pve.taskProgress[OTHER]).toBeUndefined()
  })

  it('takes a story chapter another PC read when it is newer; a chapter done stays done; another character\'s are not taken', () => {
    act(() => state.applyRemoteStoryForMode('pvp', [
      { taskId: 'story-tour', status: 'active', updatedAt: '2026-10-05T10:00:00.000Z', currentStageIndex: 3 },
      { taskId: 'story-batya', status: 'completed', updatedAt: '2026-10-05T10:00:00.000Z' },
    ], OLD))
    expect(pvp().taskProgress['story-tour']).toMatchObject({ status: 'active', currentStageIndex: 3, source: 'screen-scan' })
    expect(pvp().taskProgress['story-batya']).toMatchObject({ status: 'completed' })
    act(() => state.applyRemoteStoryForMode('pvp', [
      { taskId: 'story-tour', status: 'active', updatedAt: '2026-10-04T10:00:00.000Z', currentStageIndex: 1 },
      { taskId: 'story-batya', status: 'active', updatedAt: '2026-10-06T10:00:00.000Z', currentStageIndex: 0 },
    ], OLD))
    expect(pvp().taskProgress['story-tour']).toMatchObject({ currentStageIndex: 3 })
    expect(pvp().taskProgress['story-batya']).toMatchObject({ status: 'completed' })
    act(() => state.applyRemoteStoryForMode('pvp', [{ taskId: 'story-other', status: 'active', updatedAt: '2026-10-06T10:00:00.000Z', currentStageIndex: 0 }], NEW))
    expect(pvp().taskProgress['story-other']).toBeUndefined()
  })
})
