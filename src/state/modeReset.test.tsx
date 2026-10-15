import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalProfile, createModeProgress } from '../domain/progress'
import type { LocalProfile, ModeProgress, RaidMode } from '../domain/types'
import { AppStateProvider, useAppState } from './AppState'
import { onLogEpochChange, type LogEpochEvent } from './logEpoch'
import { dismissModeResetNotice, modeResetMessage, useModeResetNotices } from './modeReset'
import { readScreenTraderLevels, readManualTraderLevels, saveScreenTraderLevels, setManualTraderLevel } from '../gunsmith/traderLevels'
import { isCollectorDirty, loadCollected, saveCollected } from '../kappa/collector'
import { readQuestChecks, setQuestCheck } from '../progression/questChecks'
import { kappaCongratsKey } from '../kappa/kappaCongratsKey'
import { QUEST_SYNC_TIP_KEY } from '../onboarding/guideProgress'
import { modeResetFloor } from '../sync/serverSync'

const CHARACTER = 'a'.repeat(24)
const QUEST = '5936d90786f7742b1420ba5b'
const OTHER = '5936d90786f7742b1420ba5c'
const PROFILE_KEY = 'tarkov-operations-profiles-v2'
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

const probe: { current?: ReturnType<typeof useAppState>; notices?: ReturnType<typeof useModeResetNotices> } = {}
function Probe() {
  const value = useAppState()
  const notices = useModeResetNotices()
  useEffect(() => { probe.current = value; probe.notices = notices })
  return null
}
const state = new Proxy({} as ReturnType<typeof useAppState>, { get: (_target, key) => probe.current![key as keyof ReturnType<typeof useAppState>] })
const mode = (raidMode: RaidMode): ModeProgress => state.activeProfile.modes[raidMode]
const epochs: LogEpochEvent[] = []
let stop = () => {}

/** Every kind of progress a mode keeps, with preferences around it. */
function filledMode(tag: string): ModeProgress {
  return {
    ...createModeProgress(),
    registration: { status: 'registered', accountId: 7001, nickname: 'Raid_OS', enteredNickname: 'Raid_OS', verifiedAt: '2026-10-01T09:00:00.000Z' },
    playerSnapshot: { accountId: 7001, nickname: 'Raid_OS', level: 41, faction: 'usec', prestige: 2, experience: 1_000_000, fetchedAt: '2026-10-01T09:00:00.000Z', upstreamUpdatedAt: '2026-10-01T08:00:00.000Z' } as ModeProgress['playerSnapshot'],
    playerLevel: 42,
    levelAnchor: { level: 41, observedAt: '2026-10-01T09:00:00.000Z', source: 'tarkov-dev' },
    faction: 'usec',
    prestige: 2,
    logCharacterId: CHARACTER,
    lastLogSyncAt: '2026-10-05T10:00:00.000Z',
    seasonId: tag === 'seasonal' ? 'season-3' : undefined,
    trackedTaskIds: [OTHER],
    favoriteItemIds: ['ledx'],
    raidItemIds: ['salewa'],
    hideoutLevels: { 'medstation': 2 },
    itemCounts: { 'graphics-card': 3 },
    taskProgress: {
      [QUEST]: { taskId: QUEST, status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T10:00:00.000Z' },
      scanned: { taskId: 'scanned', status: 'active', source: 'screen-scan', updatedAt: '2026-10-02T10:00:00.000Z' },
      'story-tour': { taskId: 'story-tour', status: 'active', source: 'screen-scan', updatedAt: '2026-10-03T10:00:00.000Z', currentStageIndex: 2, storyObjectives: [{ id: 'talk-skier', text: 'Talk to Skier', optional: false, completed: true }] },
    },
    objectiveProgress: { obj: { objectiveId: 'obj', taskId: QUEST, type: 'shoot', target: 5, current: 2, source: 'log', confidence: 0.7, observedAt: '2026-10-01T10:00:00.000Z' } },
    progressEvents: [{ id: `event-${tag}-1`, mode: tag as RaidMode, taskId: QUEST, eventType: 'task-status', oldValue: 'active', newValue: 'completed', source: 'log', confidence: 1, observedAt: '2026-10-01T10:00:00.000Z', reversible: false, synced: true }],
    objectiveConflicts: [],
  }
}

function savedProfile(): LocalProfile {
  const profile = createLocalProfile('Оператор', 'local-test')
  profile.selectedMode = 'pve'
  for (const raidMode of MODES) profile.modes[raidMode] = filledMode(raidMode)
  return profile
}

/** The profile as stored, by mode (what survives a restart). */
const storedModes = () => (JSON.parse(localStorage.getItem(PROFILE_KEY)!) as { profiles: LocalProfile[] }).profiles[0]!.modes

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ activeProfileId: 'local-test', profiles: [savedProfile()] }))
  for (const raidMode of MODES) {
    saveScreenTraderLevels(raidMode, CHARACTER, { prapor: 3 }, '2026-10-01T10:00:00.000Z')
    setManualTraderLevel(raidMode, 'skier', 2)
    saveCollected(raidMode, ['axe'], { fromServer: true })
    setQuestCheck('local-test', raidMode, QUEST, true, 1_000)
    localStorage.setItem(kappaCongratsKey('local-test', raidMode), '1')
  }
  localStorage.setItem(QUEST_SYNC_TIP_KEY, '2026-10-01T10:00:00.000Z')
  epochs.length = 0
  stop = onLogEpochChange((event) => { epochs.push(event) })
  render(<AppStateProvider><Probe /></AppStateProvider>)
})
afterEach(() => {
  stop()
  for (const notice of probe.notices ?? []) dismissModeResetNotice(notice.id)
})

describe('resetModeProgress: one mode starts again («Престиж +», «Вайп», «Сброс», a nickname change)', () => {
  it('wipes every progress record of PvE and keeps PvP and Season byte for byte', async () => {
    const before = JSON.stringify({ pvp: storedModes().pvp, seasonal: storedModes().seasonal })
    const at = '2026-10-10T12:00:00.000Z'
    act(() => state.resetModeProgress('pve', at, 'prestige', { prestige: 3 }))
    await act(async () => { await Promise.resolve() })

    // Other modes: untouched, in the state and as stored.
    expect(JSON.stringify({ pvp: storedModes().pvp, seasonal: storedModes().seasonal })).toBe(before)
    expect(JSON.stringify({ pvp: mode('pvp'), seasonal: mode('seasonal') })).toBe(before)

    const pve = mode('pve')
    // Wiped: quests of every source, story chapters and stages, objectives, history, hideout, item counts, level readings.
    expect(pve.taskProgress).toEqual({})
    expect(pve.objectiveProgress).toEqual({})
    expect(pve.progressEvents).toEqual([])
    expect(pve.objectiveConflicts).toEqual([])
    expect(pve.hideoutLevels).toEqual({})
    expect(pve.itemCounts).toBeUndefined()
    expect(pve.playerSnapshot).toBeUndefined()
    expect(pve.levelAnchor).toBeUndefined()
    expect(pve.playerLevel).toBe(1)
    // The prestige the player chose in «Престиж +», the player's own value from the press on.
    expect(pve).toMatchObject({ prestige: 3, prestigeSetAt: at })
    expect(pve.faction).toBe('unknown')
    // Kept: the game account binding, the logs' character, preferences. No floor at the press: a pending marker.
    expect(pve.registration).toEqual(savedProfile().modes.pve.registration)
    expect(pve.logCharacterId).toBe(CHARACTER)
    expect(pve.trackedTaskIds).toEqual([OTHER])
    expect(pve.favoriteItemIds).toEqual(['ledx'])
    expect(pve.raidItemIds).toEqual(['salewa'])
    expect(pve).toMatchObject({ resetMarker: { kind: 'prestige', at }, appResetTimes: [at] })
    expect(pve.modeResetAt).toBeUndefined()
    expect(pve.logResetAt).toBeUndefined()
    // It survives a restart: the stored profile is the reset one.
    expect(storedModes().pve.resetMarker).toEqual({ kind: 'prestige', at })
    expect(storedModes().pve.taskProgress).toEqual({})

    // The stores outside the profile: PvE's only.
    expect(readScreenTraderLevels('pve', CHARACTER)).toBeUndefined()
    expect(readManualTraderLevels('pve')).toEqual({})
    expect(readScreenTraderLevels('pvp', CHARACTER)?.levels).toEqual({ prapor: 3 })
    expect(readManualTraderLevels('seasonal')).toEqual({ skier: 2 })
    expect(loadCollected('pve')).toEqual([])
    // Not pushed as an edit to whichever account signs in next: the server's list goes with the reset route.
    expect(isCollectorDirty('pve')).toBe(false)
    expect(loadCollected('pvp')).toEqual(['axe'])
    expect(isCollectorDirty('pvp')).toBe(false)
    expect(readQuestChecks('local-test', 'pve').size).toBe(0)
    expect(readQuestChecks('local-test', 'seasonal').size).toBe(1)
    expect(localStorage.getItem(kappaCongratsKey('local-test', 'pve'))).toBeNull()
    expect(localStorage.getItem(kappaCongratsKey('local-test', 'pvp'))).toBe('1')
    expect(localStorage.getItem(QUEST_SYNC_TIP_KEY)).toBeNull()

    // Made signed out (no server account in this test): local only, nothing queued for any account. Told as the mode's
    // epoch, and shown.
    expect(modeResetFloor('pve')).toBeUndefined()
    expect(localStorage.getItem('raidos-mode-resets-v1')).toBeNull()
    expect(epochs).toEqual([expect.objectContaining({ kind: 'reset', at, mode: 'pve', profileId: 'local-test' })])
    expect(probe.notices).toEqual([expect.objectContaining({ mode: 'pve', reason: 'prestige', at })])
  })

  it('an app-only reset (owner, 15.10.2026): every quest of the logs comes back; the game\'s own reset after the marker drops the older ones', () => {
    const at = '2026-10-10T12:00:00.000Z'
    act(() => state.resetModeProgress('pve', at, 'prestige', { prestige: 1 }))
    // The next scan of the same logs: the whole history again, the game's older trusted reset, the same character.
    const old = [
      { taskId: QUEST, status: 'completed' as const, timestamp: '2026-10-01T10:00:00.000Z' },
      { taskId: OTHER, status: 'active' as const, timestamp: '2026-10-09T10:00:00.000Z' },
    ]
    act(() => state.applyLogScanForMode('pve', old, { characterId: CHARACTER, resetAt: '2026-09-01T00:00:00.000Z' }))
    expect(Object.keys(mode('pve').taskProgress).sort()).toEqual([QUEST, OTHER].sort())
    expect(mode('pve').resetMarker).toEqual({ kind: 'prestige', at })
    // A server of 0.6.0.41 answers the press as the character's reset: not the game's.
    act(() => state.applyLogStateForMode('pve', old, CHARACTER, at))
    expect(Object.keys(mode('pve').taskProgress).sort()).toEqual([QUEST, OTHER].sort())
    expect(mode('pve').logResetAt).toBe('2026-09-01T00:00:00.000Z')
    // The game resets the profile after the press (the trusted reset at 12:30): the older quests drop out, the marker
    // resolves, the newer quests count.
    act(() => state.applyLogScanForMode('pve', [{ taskId: QUEST, status: 'active', timestamp: '2026-10-10T12:31:00.000Z' }], { characterId: CHARACTER, resetAt: '2026-10-10T12:30:00.000Z' }))
    expect(mode('pve').taskProgress).toEqual({ [QUEST]: expect.objectContaining({ status: 'active', updatedAt: '2026-10-10T12:31:00.000Z' }) })
    expect(mode('pve').resetMarker).toEqual({ kind: 'prestige', at, resolvedAt: '2026-10-10T12:30:00.000Z' })
    // Another character after the press (a wipe) resolves one as well.
    act(() => state.resetModeProgress('pvp', at, 'wipe'))
    act(() => state.applyLogScanForMode('pvp', old, { characterId: CHARACTER }))
    expect(Object.keys(mode('pvp').taskProgress).sort()).toEqual([QUEST, OTHER].sort())
    act(() => state.applyLogScanForMode('pvp', [{ taskId: OTHER, status: 'active', timestamp: '2026-10-11T10:00:00.000Z' }], { characterId: 'c'.repeat(24), characterSince: '2026-10-11T09:00:00.000Z' }))
    expect(Object.keys(mode('pvp').taskProgress)).toEqual([OTHER])
    expect(mode('pvp').resetMarker?.resolvedAt).toBe('2026-10-11T09:00:00.000Z')
    // Season: untouched by both.
    expect(mode('seasonal').taskProgress[QUEST]).toMatchObject({ status: 'completed' })
  })

  it('«Сброс» clears a pending marker and rebuilds; it records no marker of its own', () => {
    act(() => state.resetModeProgress('pve', '2026-10-10T12:00:00.000Z', 'wipe'))
    expect(mode('pve').resetMarker?.kind).toBe('wipe')
    act(() => state.resetModeProgress('pve', '2026-10-10T13:00:00.000Z', 'rebuild'))
    expect(mode('pve').resetMarker).toBeUndefined()
    expect(mode('pve').prestige).toBe(2)
    expect(mode('pve').appResetTimes).toEqual(['2026-10-10T12:00:00.000Z', '2026-10-10T13:00:00.000Z'])
  })

  it('tells the reset in Russian and English', () => {
    expect(modeResetMessage('nickname', 'pve', 'ru')).toBe('Ник изменился — прогресс режима PvE сброшен')
    expect(modeResetMessage('nickname', 'pve', 'en')).toBe('Nickname changed — PvE progress was reset')
    expect(modeResetMessage('prestige', 'seasonal', 'ru')).toBe('Престиж + — прогресс режима Сезон найден заново по журналам')
    expect(modeResetMessage('prestige', 'seasonal', 'en')).toBe('Prestige + — Season progress found again from the logs')
    expect(modeResetMessage('wipe', 'pvp', 'ru')).toBe('Вайп — прогресс режима PvP найден заново по журналам')
    expect(modeResetMessage('rebuild', 'pve', 'ru')).toBe('Прогресс режима PvE найден заново по журналам')
    expect(modeResetMessage('rebuild', 'pve', 'en')).toBe('PvE progress found again from the logs')
  })
})

describe('data of 0.6.0.40/41: a «Престиж +» floor at the press (the owner pressed it in PvP and Season)', () => {
  it('becomes a pending marker at load: the quests of the logs come back with the next scan, no «Сброс» needed', () => {
    const at = '2026-10-15T09:00:00.000Z'
    const profile = savedProfile()
    for (const raidMode of ['pvp', 'seasonal'] as const) {
      // What 0.6.0.41 stored after the press: every floor at the press, the records gone.
      profile.modes[raidMode] = { ...createModeProgress(), logCharacterId: CHARACTER, prestige: 0, modeResetAt: at, logResetAt: at, logEpochAt: at }
    }
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ activeProfileId: 'local-test', profiles: [profile] }))
    probe.current = undefined
    render(<AppStateProvider><Probe /></AppStateProvider>)
    for (const raidMode of ['pvp', 'seasonal'] as const) {
      expect(mode(raidMode)).toMatchObject({ resetMarker: { kind: 'prestige', at }, appResetTimes: [at] })
      expect(mode(raidMode).modeResetAt).toBeUndefined()
      expect(mode(raidMode).logResetAt).toBeUndefined()
      expect(mode(raidMode).logEpochAt).toBeUndefined()
      // The next scan of the logs (from before the press): the quests are back.
      act(() => state.applyLogScanForMode(raidMode, [{ taskId: QUEST, status: 'completed', timestamp: '2026-10-01T10:00:00.000Z' }, { taskId: OTHER, status: 'active', timestamp: '2026-10-10T10:00:00.000Z' }], { characterId: CHARACTER }))
      expect(Object.keys(mode(raidMode).taskProgress).sort()).toEqual([QUEST, OTHER].sort())
      // A 0.6.0.41 server still answering the press as the character's reset: ignored.
      act(() => state.applyLogStateForMode(raidMode, [], CHARACTER, at))
      expect(Object.keys(mode(raidMode).taskProgress).sort()).toEqual([QUEST, OTHER].sort())
    }
    // PvE (no press) as it was.
    expect(mode('pve').resetMarker).toBeUndefined()
  })
})
