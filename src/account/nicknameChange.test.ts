import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPlayerSnapshot, applyScreenLevel, createLocalProfile, registerModeProfile, wipeModeProgress } from '../domain/progress'
import type { LocalProfile, PlayerProfileSnapshot, RaidMode } from '../domain/types'

/**
 * A nickname change resets the mode the game is in (owner, 15.10.2026), only when it is sure: a confirmed nickname that
 * differs from the previous confirmed one. Missing a change is preferred over a false one.
 */
const server = vi.hoisted(() => ({ status: { signedIn: false, nicknames: {} as Record<string, string> } }))
vi.mock('../sync/serverSync', async (original) => ({ ...(await original<typeof import('../sync/serverSync')>()), currentServerStatus: () => server.status }))
vi.mock('./nicknameBinding', async (original) => ({ ...(await original<typeof import('./nicknameBinding')>()), saveNicknameOnServer: async () => true }))
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))

const { forgetConfirmedNickname, noteConfirmedNickname, confirmedNickname } = await import('./nicknameChange')

const T0 = Date.parse('2026-10-15T10:00:00Z')
const QUEST = '5936d90786f7742b1420ba5b'
const CHARACTER = 'a'.repeat(24)

function profileWithProgress(): LocalProfile {
  const profile = createLocalProfile('Оператор', 'local-test')
  for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) {
    profile.modes[mode] = {
      ...profile.modes[mode],
      logCharacterId: CHARACTER,
      taskProgress: { [QUEST]: { taskId: QUEST, status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T10:00:00.000Z' } },
    }
  }
  return profile
}

beforeEach(() => {
  localStorage.clear()
  forgetConfirmedNickname()
})

describe('noteConfirmedNickname', () => {
  it('the first nickname this device confirms never resets anything', () => {
    expect(noteConfirmedNickname('Raid_OS', 'screen', T0, 'pve', profileWithProgress())).toBeNull()
    expect(confirmedNickname()).toBe('Raid_OS')
    expect(noteConfirmedNickname('Bear', 'typed', T0, 'pve', profileWithProgress())).not.toBeNull()
    forgetConfirmedNickname()
    expect(noteConfirmedNickname('Bear', 'typed', T0, 'pve', profileWithProgress())).toBeNull()
  })

  it('a case, spacing or look-alike difference, or the same nickname from another source, is no change', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_OS', 'screen', T0, 'pve', profile)
    expect(noteConfirmedNickname('raid_os', 'screen', T0 + 5_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('raid_os', 'screen', T0 + 10_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname(' RAID_OS ', 'typed', T0 + 20_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Raid_0S', 'screen', T0 + 30_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Raid-OS', 'screen', T0 + 40_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Raid OS', 'typed', T0 + 50_000, 'pve', profile)).toBeNull()
  })

  it('a new nickname on the game screen counts only when a second, later reading shows it again', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_OS', 'screen', T0, 'pvp', profile)
    // One reading (or the same frame twice): not yet.
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 60_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 60_000, 'pve', profile)).toBeNull()
    expect(confirmedNickname()).toBe('Raid_OS')
    // Another name in between starts over.
    expect(noteConfirmedNickname('Wolf_Pack', 'screen', T0 + 61_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 62_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 64_000, 'pve', profile)).toEqual({ mode: 'pve', previous: 'Raid_OS', nickname: 'Bear_Hunter', at: new Date(T0 + 64_000).toISOString() })
    expect(confirmedNickname()).toBe('Bear_Hunter')
    // And only once.
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 66_000, 'pve', profile)).toBeNull()
  })

  it('a reading too long after the first one starts over', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_OS', 'screen', T0, 'pvp', profile)
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 60_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 60_000 + 11 * 60_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 60_000 + 12 * 60_000, 'pve', profile)).toMatchObject({ mode: 'pve' })
  })

  it('the player typing another nickname counts at once, for the mode given', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_OS', 'screen', T0, 'pvp', profile)
    expect(noteConfirmedNickname('Bear_Hunter', 'typed', T0 + 1_000, 'seasonal', profile)).toMatchObject({ mode: 'seasonal', previous: 'Raid_OS', nickname: 'Bear_Hunter' })
  })

  it('the game screen correcting a typed nickname it never showed resets nothing', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_SO', 'typed', T0, 'pvp', profile)
    expect(noteConfirmedNickname('Raid_OS', 'screen', T0 + 1_000, 'pvp', profile)).toBeNull()
    expect(noteConfirmedNickname('Raid_OS', 'screen', T0 + 3_000, 'pvp', profile)).toBeNull()
    expect(confirmedNickname()).toBe('Raid_OS')
  })

  it('a mode whose logs started another character since the previous nickname is not reset twice', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_OS', 'screen', T0, 'pve', profile)
    // The logs: a new profile id in PvE (logEpoch already dropped the mode's records), not in PvP.
    const wiped = { ...profile, modes: { ...profile.modes, pve: { ...profile.modes.pve, logCharacterId: 'b'.repeat(24) } } }
    noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 60_000, 'pve', wiped)
    expect(noteConfirmedNickname('Bear_Hunter', 'screen', T0 + 62_000, 'pve', wiped)).toBeNull()
    expect(confirmedNickname()).toBe('Bear_Hunter')
    // The same in PvP (its character did not change) would have reset it.
    expect(noteConfirmedNickname('Wolf_Pack', 'typed', T0 + 70_000, 'pvp', wiped)).toMatchObject({ mode: 'pvp' })
  })

  it('a reading the game\'s rules did not confirm never gets here: an invalid nickname changes nothing', () => {
    const profile = profileWithProgress()
    noteConfirmedNickname('Raid_OS', 'screen', T0, 'pve', profile)
    expect(noteConfirmedNickname('ab', 'screen', T0 + 1_000, 'pve', profile)).toBeNull()
    expect(noteConfirmedNickname('Медведь', 'typed', T0 + 2_000, 'pve', profile)).toBeNull()
    expect(confirmedNickname()).toBe('Raid_OS')
  })
})

describe('a nickname change in the app resets only the mode where it was seen', () => {
  function target(raidMode: RaidMode) {
    const state = {
      activeProfile: profileWithProgress(),
      raidMode,
      registerModeProfile: vi.fn((mode: RaidMode, registration: Parameters<typeof registerModeProfile>[2]) => { state.activeProfile = registerModeProfile(state.activeProfile, mode, registration) }),
      updatePlayerSnapshot: vi.fn((mode: RaidMode, snapshot: PlayerProfileSnapshot) => { state.activeProfile = applyPlayerSnapshot(state.activeProfile, mode, snapshot) }),
      applyScreenLevel: vi.fn((mode: RaidMode, level: number, observedAt: string, raiseOnly?: boolean) => { state.activeProfile = applyScreenLevel(state.activeProfile, mode, level, observedAt, raiseOnly) }),
      resetModeProgress: vi.fn<(mode: RaidMode, at?: string, reason?: 'prestige' | 'nickname') => void>((mode, at) => { state.activeProfile = wipeModeProgress(state.activeProfile, mode, at!) }),
    }
    for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) {
      state.activeProfile = registerModeProfile(state.activeProfile, mode, { accountId: 5550123, enteredNickname: 'Raid_OS', nickname: 'Raid_OS', verifiedAt: '2026-10-01T09:00:00.000Z' })
    }
    return state
  }
  const cards = (nickname: string) => [
    { mode: 'pvp' as const, nickname, level: 12 },
    { mode: 'pve' as const, nickname, level: 41 },
    { mode: 'seasonal' as const, nickname, level: 14 },
  ]
  const done = (state: ReturnType<typeof target>, mode: RaidMode) => Boolean(state.activeProfile.modes[mode].taskProgress[QUEST])

  it('the mode-select screen: the game\'s mode from the logs is reset, the others keep their progress, the nickname goes everywhere', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, bindNicknameFromLogs, logNickname } = await import('./logNickname')
    const state = target('pvp')
    bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 5550123, pve: 5550123, seasonal: 5550123 } }, () => state)
    applyModeSelectScreen(cards('Raid_OS'), T0, () => state, 'pve')
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    // The new nickname, read once: the nickname is spread at once, nothing is reset yet.
    applyModeSelectScreen(cards('Bear_Hunter'), T0 + 60_000, () => state, 'pve')
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    expect(logNickname()).toBe('Bear_Hunter')
    // Read again a moment later: PvE (the game's mode, not the app's PvP) starts again.
    applyModeSelectScreen(cards('Bear_Hunter'), T0 + 63_000, () => state, 'pve')
    expect(state.resetModeProgress.mock.calls).toEqual([['pve', new Date(T0 + 63_000).toISOString(), 'nickname']])
    expect([done(state, 'pvp'), done(state, 'pve'), done(state, 'seasonal')]).toEqual([true, false, true])
    // This reading's levels still count for the reset mode.
    expect(state.activeProfile.modes.pve.playerLevel).toBe(41)
    // Every mode carries the new nickname.
    for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) expect(state.activeProfile.modes[mode].registration).toMatchObject({ enteredNickname: 'Bear_Hunter' })
    // The same screen again: no second reset.
    applyModeSelectScreen(cards('Bear_Hunter'), T0 + 66_000, () => state, 'pve')
    expect(state.resetModeProgress).toHaveBeenCalledTimes(1)
  })

  it('without the logs\' mode, the app\'s mode is reset; a case-only difference resets nothing', async () => {
    vi.resetModules()
    const { applyModeSelectScreen } = await import('./logNickname')
    const state = target('seasonal')
    applyModeSelectScreen(cards('Raid_OS'), T0, () => state)
    applyModeSelectScreen(cards('RAID_OS'), T0 + 60_000, () => state)
    applyModeSelectScreen(cards('RAID_OS'), T0 + 63_000, () => state)
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    applyModeSelectScreen(cards('Wolf_Pack'), T0 + 70_000, () => state)
    applyModeSelectScreen(cards('Wolf_Pack'), T0 + 72_000, () => state)
    expect(state.resetModeProgress.mock.calls.map(([mode]) => mode)).toEqual(['seasonal'])
  })

  it('«Сменить ник»: another nickname resets the mode the app shows; the first one typed resets nothing', async () => {
    vi.resetModules()
    const { setTypedNickname } = await import('./logNickname')
    const state = target('pve')
    await setTypedNickname('Raid_OS', () => state)
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    await setTypedNickname('raid_os', () => state)
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    await setTypedNickname('Bear_Hunter', () => state)
    expect(state.resetModeProgress.mock.calls.map(([mode, , reason]) => [mode, reason])).toEqual([['pve', 'nickname']])
    expect([done(state, 'pvp'), done(state, 'pve'), done(state, 'seasonal')]).toEqual([true, false, true])
    for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) expect(state.activeProfile.modes[mode].registration).toMatchObject({ enteredNickname: 'Bear_Hunter' })
  })
})
