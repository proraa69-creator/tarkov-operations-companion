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

describe('resetModeProgress: one mode starts again («Престиж +», a nickname change)', () => {
  it('wipes every progress record of PvE and keeps PvP and Season byte for byte', async () => {
    const before = JSON.stringify({ pvp: storedModes().pvp, seasonal: storedModes().seasonal })
    const at = '2026-10-10T12:00:00.000Z'
    act(() => state.resetModeProgress('pve', at, 'prestige'))
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
    expect(pve.prestige).toBe(0)
    expect(pve.faction).toBe('unknown')
    // Kept: the game account binding, the logs' character, preferences; the reset is the mode's epoch.
    expect(pve.registration).toEqual(savedProfile().modes.pve.registration)
    expect(pve.logCharacterId).toBe(CHARACTER)
    expect(pve.trackedTaskIds).toEqual([OTHER])
    expect(pve.favoriteItemIds).toEqual(['ledx'])
    expect(pve.raidItemIds).toEqual(['salewa'])
    expect(pve).toMatchObject({ logResetAt: at, logEpochAt: at, modeResetAt: at })
    // It survives a restart: the stored profile is the reset one.
    expect(storedModes().pve.modeResetAt).toBe(at)
    expect(storedModes().pve.taskProgress).toEqual({})

    // The stores outside the profile: PvE's only.
    expect(readScreenTraderLevels('pve', CHARACTER)).toBeUndefined()
    expect(readManualTraderLevels('pve')).toEqual({})
    expect(readScreenTraderLevels('pvp', CHARACTER)?.levels).toEqual({ prapor: 3 })
    expect(readManualTraderLevels('seasonal')).toEqual({ skier: 2 })
    expect(loadCollected('pve')).toEqual([])
    expect(isCollectorDirty('pve')).toBe(true)
    expect(loadCollected('pvp')).toEqual(['axe'])
    expect(isCollectorDirty('pvp')).toBe(false)
    expect(readQuestChecks('local-test', 'pve').size).toBe(0)
    expect(readQuestChecks('local-test', 'seasonal').size).toBe(1)
    expect(localStorage.getItem(kappaCongratsKey('local-test', 'pve'))).toBeNull()
    expect(localStorage.getItem(kappaCongratsKey('local-test', 'pvp'))).toBe('1')
    expect(localStorage.getItem(QUEST_SYNC_TIP_KEY)).toBeNull()

    // Queued for the server (sent once an account is online), told as the mode's epoch, and shown.
    expect(modeResetFloor('pve')).toBe(at)
    expect(modeResetFloor('pvp')).toBeUndefined()
    expect(epochs).toEqual([expect.objectContaining({ kind: 'reset', at, mode: 'pve', profileId: 'local-test' })])
    expect(probe.notices).toEqual([expect.objectContaining({ mode: 'pve', reason: 'prestige', at })])
  })

  it('the epoch stops the old log events and server records from coming back after a rescan; newer ones count', () => {
    const at = '2026-10-10T12:00:00.000Z'
    act(() => state.resetModeProgress('pve', at, 'prestige'))
    // The next scan of the same logs: the whole history again, the game's older trusted reset, the same character.
    const old = [
      { taskId: QUEST, status: 'completed' as const, timestamp: '2026-10-01T10:00:00.000Z' },
      { taskId: OTHER, status: 'active' as const, timestamp: '2026-10-09T10:00:00.000Z' },
    ]
    act(() => state.applyLogScanForMode('pve', old, { characterId: CHARACTER, resetAt: '2026-09-01T00:00:00.000Z' }))
    expect(mode('pve').taskProgress).toEqual({})
    // The server's copy from before the reset (another PC that has not heard of it): nothing either.
    act(() => state.applyLogStateForMode('pve', old, CHARACTER, '2026-09-01T00:00:00.000Z'))
    expect(mode('pve').taskProgress).toEqual({})
    // A Tarkov.dev profile and a screen level from before the reset: not taken.
    act(() => state.updatePlayerSnapshot('pve', { ...savedProfile().modes.pve.playerSnapshot!, fetchedAt: '2026-10-10T11:00:00.000Z', upstreamUpdatedAt: '2026-10-10T11:00:00.000Z' }))
    act(() => state.applyScreenLevel('pve', 40, '2026-10-10T11:59:00.000Z'))
    expect(mode('pve').playerSnapshot).toBeUndefined()
    expect(mode('pve').playerLevel).toBe(1)
    // Play after the reset counts as usual.
    act(() => state.applyLogScanForMode('pve', [...old, { taskId: OTHER, status: 'active', timestamp: '2026-10-10T12:30:00.000Z' }], { characterId: CHARACTER }))
    expect(Object.keys(mode('pve').taskProgress)).toEqual([OTHER])
    act(() => state.applyScreenLevel('pve', 1, '2026-10-10T12:31:00.000Z'))
    expect(mode('pve').levelAnchor).toMatchObject({ level: 1, source: 'screen' })
    // Another character after the reset still starts from it: its older events do not come back either.
    act(() => state.applyLogScanForMode('pve', old, { characterId: 'c'.repeat(24), characterSince: '2026-09-15T00:00:00.000Z' }))
    expect(Object.values(mode('pve').taskProgress).map((record) => record.updatedAt)).toEqual(['2026-10-10T12:30:00.000Z'])
    expect(mode('pve').modeResetAt).toBe(at)
    // The other modes still take the same events.
    act(() => state.applyLogScanForMode('pvp', old, { characterId: CHARACTER }))
    expect(mode('pvp').taskProgress[OTHER]).toMatchObject({ status: 'active', source: 'eft-log' })
  })

  it('an older reset of the same mode does not move its epoch back', () => {
    act(() => state.resetModeProgress('pve', '2026-10-10T12:00:00.000Z', 'nickname'))
    act(() => state.resetModeProgress('pve', '2026-10-01T12:00:00.000Z', 'prestige'))
    expect(mode('pve').modeResetAt).toBe('2026-10-10T12:00:00.000Z')
    expect(modeResetFloor('pve')).toBe('2026-10-10T12:00:00.000Z')
  })

  it('tells the reset in Russian and English', () => {
    expect(modeResetMessage('nickname', 'pve', 'ru')).toBe('Ник изменился — прогресс режима PvE сброшен')
    expect(modeResetMessage('nickname', 'pve', 'en')).toBe('Nickname changed — PvE progress was reset')
    expect(modeResetMessage('prestige', 'seasonal', 'ru')).toBe('Престиж + — прогресс режима Сезон сброшен')
    expect(modeResetMessage('prestige', 'seasonal', 'en')).toBe('Prestige + — Season progress was reset')
  })
})
