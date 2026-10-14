import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPlayerSnapshot, applyScreenLevel, createLocalProfile, registerModeProfile } from '../domain/progress'
import type { PlayerProfileSnapshot, RaidMode } from '../domain/types'

/**
 * The nickname and level without waiting or typing (owner, 13.10.2026): Tarkov.dev in the background from the player's
 * PC, the game's mode selection and traders' screens, and typing as the last resort. Bound to each mode's game account
 * from the logs of this PC and saved on the account.
 */
const server = vi.hoisted(() => ({ status: { signedIn: true, nicknames: {} as Record<string, string> } as { signedIn: boolean; nicknames: Record<string, string> } | null }))
vi.mock('../sync/serverSync', async (original) => ({ ...(await original<typeof import('../sync/serverSync')>()), currentServerStatus: () => server.status }))
const saved = vi.hoisted(() => [] as Array<string | null>)
vi.mock('./nicknameBinding', async (original) => ({ ...(await original<typeof import('./nicknameBinding')>()), saveNicknameOnServer: async (nickname: string | null) => { saved.push(nickname); return true } }))
const fetches = vi.hoisted(() => ({ count: 0 }))
vi.stubGlobal('fetch', vi.fn(async () => { fetches.count += 1; throw new Error('no network in this test') }))

const { bindNicknameFromLogs, logNickname, setTypedNickname } = await import('./logNickname')

afterEach(() => { saved.length = 0 })

function target() {
  const state = {
    activeProfile: createLocalProfile('Оператор'),
    registerModeProfile: vi.fn((mode: RaidMode, registration: Parameters<typeof registerModeProfile>[2]) => { state.activeProfile = registerModeProfile(state.activeProfile, mode, registration) }),
    updatePlayerSnapshot: vi.fn((mode: RaidMode, snapshot: PlayerProfileSnapshot) => { state.activeProfile = applyPlayerSnapshot(state.activeProfile, mode, snapshot) }),
    applyScreenLevel: vi.fn((mode: RaidMode, level: number, observedAt: string, raiseOnly?: boolean) => { state.activeProfile = applyScreenLevel(state.activeProfile, mode, level, observedAt, raiseOnly) }),
  }
  return state
}

describe('the nickname typed in the app', () => {
  it('waits for the player while none is typed: the logs\' accounts are only remembered', () => {
    server.status = { signedIn: true, nicknames: {} }
    const state = target()
    expect(bindNicknameFromLogs({ latestAccountIdByMode: { pve: 5550123 } }, () => state)).toBeNull()
    expect(state.registerModeProfile).not.toHaveBeenCalled()
    expect(fetches.count).toBe(0)
  })

  it('«Сменить ник»: checked like the game\'s, bound to each mode\'s account from the logs, saved on the account', async () => {
    server.status = { signedIn: true, nicknames: {} }
    const state = target()
    bindNicknameFromLogs({ latestAccountIdByMode: { pve: 5550123, pvp: 5550123 } }, () => state)
    await expect(setTypedNickname('ab', () => state)).rejects.toThrow(/3–15 символов/)
    await expect(setTypedNickname('Медведь', () => state)).rejects.toThrow(/латиница/)
    expect(await setTypedNickname(' Bear_Hunter ', () => state)).toBe('Bear_Hunter')
    expect(state.registerModeProfile.mock.calls.map(([mode, registration]) => [mode, registration.accountId, registration.enteredNickname])).toEqual([['pvp', 5550123, 'Bear_Hunter'], ['pve', 5550123, 'Bear_Hunter']])
    expect(saved).toEqual(['Bear_Hunter'])
    expect(logNickname()).toBe('Bear_Hunter')

    // A later scan with the same accounts changes nothing; a new mode in the logs is bound under the same nickname.
    state.registerModeProfile.mockClear()
    expect(bindNicknameFromLogs({ latestAccountIdByMode: { pve: 5550123, pvp: 5550123 } }, () => state)).toBe('Bear_Hunter')
    expect(state.registerModeProfile).not.toHaveBeenCalled()
    bindNicknameFromLogs({ latestAccountIdByMode: { seasonal: 5550123 } }, () => state)
    expect(state.registerModeProfile).toHaveBeenCalledWith('seasonal', expect.objectContaining({ accountId: 5550123, enteredNickname: 'Bear_Hunter' }))
    expect(fetches.count).toBe(0)
  })

  it('a new nickname renames every bound mode; the same one is not saved twice', async () => {
    // A fresh session: no accounts from earlier logs.
    vi.resetModules()
    const { bindNicknameFromLogs, setTypedNickname } = await import('./logNickname')
    server.status = { signedIn: true, nicknames: { pvp: 'Bear_Hunter', pve: 'Bear_Hunter', seasonal: 'Bear_Hunter' } }
    const state = target()
    state.activeProfile = registerModeProfile(state.activeProfile, 'seasonal', { accountId: 7690289, nickname: 'Old_Name', enteredNickname: 'Old_Name', verifiedAt: '2026-10-01T00:00:00.000Z' })
    bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 5550123 } }, () => state)
    await setTypedNickname('Wolf_77', () => state)
    expect(state.activeProfile.modes.seasonal.registration).toMatchObject({ accountId: 7690289, enteredNickname: 'Wolf_77' })
    expect(saved).toEqual(['Wolf_77'])
    server.status = { signedIn: true, nicknames: { pvp: 'Wolf_77', pve: 'Wolf_77', seasonal: 'Wolf_77' } }
    await setTypedNickname('Wolf_77', () => state)
    expect(saved).toEqual(['Wolf_77'])
  })
})

describe('the game\'s screens', () => {
  const cards = [
    { mode: 'pve' as const, nickname: 'Raid_OS', level: 41 },
    { mode: 'pvp' as const, nickname: 'Raid_OS', level: 12 },
    { mode: 'seasonal' as const, nickname: 'Raid_0S', level: 14 },
  ]

  it('«Выбор профиля и режима» sets every mode\'s level and the nickname at once', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, bindNicknameFromLogs, logNickname } = await import('./logNickname')
    server.status = { signedIn: true, nicknames: {} }
    const state = target()
    bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 5550123, pve: 5550123 } }, () => state)
    applyModeSelectScreen(cards, Date.parse('2026-10-13T18:00:00Z'), () => state)
    expect([state.activeProfile.modes.pve.playerLevel, state.activeProfile.modes.pvp.playerLevel, state.activeProfile.modes.seasonal.playerLevel]).toEqual([41, 12, 14])
    expect(state.activeProfile.modes.pvp.levelAnchor).toMatchObject({ source: 'screen', level: 12 })
    expect(logNickname()).toBe('Raid_OS')
    expect(state.activeProfile.modes.pvp.registration).toMatchObject({ accountId: 5550123, enteredNickname: 'Raid_OS' })
    expect(saved).toEqual(['Raid_OS'])
    // The same screen a second later: nothing new.
    state.applyScreenLevel.mockClear()
    applyModeSelectScreen(cards, Date.parse('2026-10-13T18:00:02Z'), () => state)
    expect(state.applyScreenLevel).not.toHaveBeenCalled()
  })

  it('keeps the spelling the app knows, and cards with different names change no nickname', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, logNickname, setTypedNickname } = await import('./logNickname')
    server.status = { signedIn: false, nicknames: {} }
    const state = target()
    await setTypedNickname('Raid_OS', () => state)
    applyModeSelectScreen([{ mode: 'pvp', nickname: 'Raid_0S', level: 12 }], Date.now(), () => state)
    expect(logNickname()).toBe('Raid_OS')
    applyModeSelectScreen([{ mode: 'pvp', nickname: 'Other', level: 13 }, { mode: 'pve', nickname: 'Raid_OS', level: 41 }], Date.now() + 1000, () => state)
    expect(logNickname()).toBe('Raid_OS')
    expect(state.activeProfile.modes.pvp.playerLevel).toBe(13)
  })

  it('the player\'s stored PvE 59 (report of 14.10.2026) is 39 again at the next mode selection screen, PvP keeps its 59', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, logNickname, setTypedNickname } = await import('./logNickname')
    server.status = { signedIn: false, nicknames: {} }
    const state = target()
    await setTypedNickname('Raid_OS', () => state)
    // What the old reader stored from the PvE card: «39» read as «59».
    const pve = state.activeProfile.modes.pve
    state.activeProfile = { ...state.activeProfile, modes: { ...state.activeProfile.modes, pve: { ...pve, playerLevel: 59, levelAnchor: { level: 59, observedAt: '2026-10-13T20:00:00.000Z', source: 'screen' } } } }
    // Cards whose name the readings did not agree on still give their level, and change no nickname.
    applyModeSelectScreen([{ mode: 'pve', level: 39 }, { mode: 'pvp', level: 59 }], Date.parse('2026-10-14T18:00:00Z'), () => state)
    expect([state.activeProfile.modes.pvp.playerLevel, state.activeProfile.modes.pve.playerLevel, state.activeProfile.modes.seasonal.playerLevel]).toEqual([59, 39, 1])
    expect(logNickname()).toBe('Raid_OS')
  })

  it('a card that gives the nickname without a confirmed level (audit P4e): the name is taken, no level is set', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, logNickname, useScreenReading } = await import('./logNickname')
    server.status = { signedIn: false, nicknames: {} }
    const state = target()
    applyModeSelectScreen([{ mode: 'pve', nickname: 'Raid_OS' }, { mode: 'pvp', level: 12 }], Date.parse('2026-10-14T18:00:00Z'), () => state)
    expect(logNickname()).toBe('Raid_OS')
    expect(state.applyScreenLevel.mock.calls.map((call) => [call[0], call[1]])).toEqual([['pvp', 12]])
    expect(state.activeProfile.modes.pve.playerLevel).toBe(1)
    expect(useScreenReading).toBeTypeOf('function')
    // The same reading a second later: nothing new.
    state.applyScreenLevel.mockClear()
    applyModeSelectScreen([{ mode: 'pve', nickname: 'Raid_OS' }, { mode: 'pvp', level: 12 }], Date.parse('2026-10-14T18:00:02Z'), () => state)
    expect(state.applyScreenLevel).not.toHaveBeenCalled()
  })

  it('what the locked app read is kept, not applied, until the app unlocks (audit P4a)', async () => {
    vi.resetModules()
    const { applyKeptIdentity, keepModeSelectScreen, keepTraderScreen, logNickname } = await import('./logNickname')
    server.status = { signedIn: false, nicknames: {} }
    const state = target()
    keepModeSelectScreen([{ mode: 'pve', nickname: 'Raid_OS', level: 41 }], Date.parse('2026-10-14T18:00:00Z'))
    keepTraderScreen({ nickname: 'Raid_OS', level: 42, loyalty: { prapor: 4 } }, undefined, Date.parse('2026-10-14T18:01:00Z'))
    expect(state.applyScreenLevel).not.toHaveBeenCalled()
    expect(logNickname()).toBeUndefined()
    applyKeptIdentity(() => state)
    expect(state.activeProfile.modes.pve.playerLevel).toBe(41)
    expect(logNickname()).toBe('Raid_OS')
    // The traders' reading had no mode then: its nickname only, no level of a mode it does not name.
    expect(state.applyScreenLevel.mock.calls.map((call) => [call[0], call[1]])).toEqual([['pve', 41]])
    // Applied once.
    state.applyScreenLevel.mockClear()
    applyKeptIdentity(() => state)
    expect(state.applyScreenLevel).not.toHaveBeenCalled()
  })

  it('the traders\' screen raises the level of the mode the game is in, never lowers it', async () => {
    vi.resetModules()
    const { applyTraderScreen } = await import('./logNickname')
    const state = target()
    state.activeProfile = applyScreenLevel(state.activeProfile, 'pvp', 12, '2026-10-13T18:00:00.000Z')
    applyTraderScreen({ level: 13 }, 'pvp', Date.parse('2026-10-13T18:30:00Z'), () => state)
    expect(state.activeProfile.modes.pvp.playerLevel).toBe(13)
    applyTraderScreen({ level: 11 }, 'pvp', Date.parse('2026-10-13T18:40:00Z'), () => state)
    expect(state.activeProfile.modes.pvp.playerLevel).toBe(13)
    // Without the game's mode from the logs nothing is set.
    applyTraderScreen({ level: 20 }, undefined, Date.parse('2026-10-13T18:50:00Z'), () => state)
    expect(state.activeProfile.modes.pvp.playerLevel).toBe(13)
  })

  it('the traders\' loyalty badges are kept for that mode\'s character with their time, other modes untouched (audit P18)', async () => {
    vi.resetModules()
    localStorage.clear()
    const { applyTraderScreen } = await import('./logNickname')
    const { readManualTraderLevels, readScreenTraderLevels } = await import('../gunsmith/traderLevels')
    const state = target()
    state.activeProfile = { ...state.activeProfile, modes: { ...state.activeProfile.modes, pve: { ...state.activeProfile.modes.pve, logCharacterId: 'a'.repeat(24) } } }
    applyTraderScreen({ loyalty: { prapor: 4, fence: 1, ragman: 3 } }, 'pve', Date.parse('2026-10-13T18:30:00Z'), () => state)
    expect(readScreenTraderLevels('pve', 'a'.repeat(24))).toEqual({ at: '2026-10-13T18:30:00.000Z', levels: { prapor: 4, fence: 1, ragman: 3 } })
    // Not a manual override, and no other character's.
    expect(readManualTraderLevels('pve')).toEqual({})
    expect(readScreenTraderLevels('pve', 'b'.repeat(24))).toBeUndefined()
    expect(readScreenTraderLevels('pvp', undefined)).toBeUndefined()
    applyTraderScreen({ loyalty: { prapor: 4 } }, undefined, Date.parse('2026-10-13T18:31:00Z'), () => state)
    expect(readScreenTraderLevels('pvp', undefined)).toBeUndefined()
  })
})

describe('Tarkov.dev in the background', () => {
  const snapshot = (level: number, upstreamUpdatedAt: string): PlayerProfileSnapshot => ({ accountId: 5550123, nickname: 'Raid_OS', experience: 0, level, faction: 'usec', prestige: 0, fetchedAt: upstreamUpdatedAt, upstreamUpdatedAt })

  it('asks from this PC, again after 2, 5 and 10 minutes while it has nothing, and applies what it finds', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const answers: Array<PlayerProfileSnapshot | null> = [null, null, snapshot(12, '2026-10-13T17:00:00.000Z')]
      const refreshPlayerProfile = vi.fn(async () => answers.shift() ?? null)
      vi.stubGlobal('tarkovDesktop', { refreshPlayerProfile })
      const { bindNicknameFromLogs, logNickname } = await import('./logNickname')
      const state = target()
      bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 5550123 } }, () => state)
      await vi.advanceTimersByTimeAsync(0)
      expect(refreshPlayerProfile).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(refreshPlayerProfile).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(refreshPlayerProfile).toHaveBeenCalledTimes(3)
      expect(logNickname()).toBe('Raid_OS')
      expect(state.activeProfile.modes.pvp.playerLevel).toBe(12)
      expect(state.activeProfile.modes.pvp.levelAnchor).toMatchObject({ source: 'tarkov-dev', level: 12 })
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
      vi.useRealTimers()
    }
  })

  it('a newer screen reading wins over an older Tarkov.dev profile, Tarkov.dev keeps the same level', () => {
    let profile = createLocalProfile('Оператор')
    profile = applyPlayerSnapshot(profile, 'pvp', snapshot(12, '2026-10-13T17:00:00.000Z'))
    // The game's screen showed the same level later: Tarkov.dev's anchor (exact experience) stays.
    profile = applyScreenLevel(profile, 'pvp', 12, '2026-10-13T18:00:00.000Z')
    expect(profile.modes.pvp.levelAnchor?.source).toBe('tarkov-dev')
    // A higher level on the screen: the screen wins.
    profile = applyScreenLevel(profile, 'pvp', 13, '2026-10-13T18:05:00.000Z')
    expect([profile.modes.pvp.playerLevel, profile.modes.pvp.levelAnchor?.source]).toEqual([13, 'screen'])
    // An older Tarkov.dev profile does not take it back; a newer one does.
    profile = applyPlayerSnapshot(profile, 'pvp', snapshot(12, '2026-10-13T18:01:00.000Z'))
    expect(profile.modes.pvp.playerLevel).toBe(13)
    profile = applyPlayerSnapshot(profile, 'pvp', snapshot(14, '2026-10-13T19:00:00.000Z'))
    expect([profile.modes.pvp.playerLevel, profile.modes.pvp.levelAnchor?.source]).toEqual([14, 'tarkov-dev'])
  })
})

describe('a Tarkov.dev profile from before a rename (owner, 13.10.2026: «я уже давно поменял ник, а справа пишется мой старый»)', () => {
  it('is outdated when its name is not the one the app knows and it is not newer than that reading', async () => {
    const { outdatedProfile } = await import('./logNickname')
    const old = { nickname: 'SHAURMA', upstreamUpdatedAt: '2026-09-28T00:46:10.000Z', fetchedAt: '2026-10-13T19:00:00.000Z' }
    expect(outdatedProfile(old, 'Raid_OS')).toBe(true)
    expect(outdatedProfile(old, 'Raid_OS', '2026-10-13T18:00:00.000Z')).toBe(true)
    // The same name (OCR spelling aside), no name known yet, or a profile captured after the reading: in use.
    expect(outdatedProfile({ ...old, nickname: 'Raid_0S' }, 'Raid_OS')).toBe(false)
    expect(outdatedProfile(old, undefined)).toBe(false)
    expect(outdatedProfile({ ...old, upstreamUpdatedAt: '2026-10-13T18:30:00.000Z' }, 'Raid_OS', '2026-10-13T18:00:00.000Z')).toBe(false)
  })

  it('is neither applied nor shown, and is asked for again later', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const stale = { accountId: 5550123, nickname: 'SHAURMA', experience: 0, level: 41, faction: 'bear' as const, prestige: 0, fetchedAt: '2026-10-13T19:00:00.000Z', upstreamUpdatedAt: '2026-09-28T00:46:10.000Z' }
      const refreshPlayerProfile = vi.fn(async () => stale)
      vi.stubGlobal('tarkovDesktop', { refreshPlayerProfile })
      const { bindNicknameFromLogs, logNickname, setTypedNickname } = await import('./logNickname')
      server.status = { signedIn: false, nicknames: {} }
      const state = target()
      await setTypedNickname('Raid_OS', () => state)
      bindNicknameFromLogs({ latestAccountIdByMode: { pve: 5550123 } }, () => state)
      await vi.advanceTimersByTimeAsync(0)
      expect(refreshPlayerProfile).toHaveBeenCalled()
      expect(state.updatePlayerSnapshot).not.toHaveBeenCalled()
      expect(logNickname()).toBe('Raid_OS')
      const calls = refreshPlayerProfile.mock.calls.length
      await vi.advanceTimersByTimeAsync(2 * 60_000)
      expect(refreshPlayerProfile.mock.calls.length).toBeGreaterThan(calls)
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
      vi.useRealTimers()
    }
  })
})
