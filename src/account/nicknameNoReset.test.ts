import { describe, expect, it, vi } from 'vitest'
import { applyPlayerSnapshot, applyScreenLevel, createLocalProfile, registerModeProfile } from '../domain/progress'
import type { LocalProfile, PlayerProfileSnapshot, RaidMode } from '../domain/types'

/**
 * Owner, 25.11.2026: «При смене ника не нужно сбрасывать прогресс». A new nickname — read on the game's «Выбор профиля и
 * режима» screen, again and again, or typed in «Сменить ник» — goes to every mode and the account, and no mode loses its
 * progress (up to 0.6.0.345 it reset the mode it was seen in, and a misread nickname did the same).
 */
const server = vi.hoisted(() => ({ status: { signedIn: false, nicknames: {} as Record<string, string> } }))
vi.mock('../sync/serverSync', async (original) => ({ ...(await original<typeof import('../sync/serverSync')>()), currentServerStatus: () => server.status }))
vi.mock('./nicknameBinding', async (original) => ({ ...(await original<typeof import('./nicknameBinding')>()), saveNicknameOnServer: async () => true }))
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))

const T0 = Date.parse('2026-11-25T10:00:00Z')
const QUEST = '5936d90786f7742b1420ba5b'
const CHARACTER = 'a'.repeat(24)
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

function profileWithProgress(): LocalProfile {
  const profile = createLocalProfile('Оператор', 'local-test')
  for (const mode of MODES) {
    profile.modes[mode] = {
      ...profile.modes[mode],
      logCharacterId: CHARACTER,
      taskProgress: { [QUEST]: { taskId: QUEST, status: 'completed', source: 'eft-log', updatedAt: '2026-10-01T10:00:00.000Z' } },
    }
  }
  return profile
}

function target() {
  const state = {
    activeProfile: profileWithProgress(),
    raidMode: 'pve' as RaidMode,
    registerModeProfile: vi.fn((mode: RaidMode, registration: Parameters<typeof registerModeProfile>[2]) => { state.activeProfile = registerModeProfile(state.activeProfile, mode, registration) }),
    updatePlayerSnapshot: vi.fn((mode: RaidMode, snapshot: PlayerProfileSnapshot) => { state.activeProfile = applyPlayerSnapshot(state.activeProfile, mode, snapshot) }),
    applyScreenLevel: vi.fn((mode: RaidMode, level: number, observedAt: string, raiseOnly?: boolean) => { state.activeProfile = applyScreenLevel(state.activeProfile, mode, level, observedAt, raiseOnly) }),
    // The app state has it (AppState.resetModeProgress, «Престиж +» / «Вайп» / «Сброс»): a nickname never calls it.
    resetModeProgress: vi.fn(),
  }
  for (const mode of MODES) {
    state.activeProfile = registerModeProfile(state.activeProfile, mode, { accountId: 5550123, enteredNickname: 'Raid_OS', nickname: 'Raid_OS', verifiedAt: '2026-10-01T09:00:00.000Z' })
  }
  return state
}

const cards = (nickname: string) => MODES.map((mode, index) => ({ mode, nickname, level: [12, 41, 14][index]! }))
const kept = (state: ReturnType<typeof target>) => MODES.map((mode) => Boolean(state.activeProfile.modes[mode].taskProgress[QUEST]))

describe('a new nickname resets no mode (owner, 25.11.2026)', () => {
  it('the mode-select screen showing another nickname, read again and again: every mode keeps its progress, the nickname goes everywhere', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, bindNicknameFromLogs, logNickname } = await import('./logNickname')
    const state = target()
    bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 5550123, pve: 5550123, seasonal: 5550123 } }, () => state)
    applyModeSelectScreen(cards('Raid_OS'), T0, () => state)
    for (const [index, at] of [60_000, 63_000, 66_000, 9 * 60_000].entries()) {
      applyModeSelectScreen(cards(index % 2 ? 'Bear_Hunter' : 'Wolf_Pack'), T0 + at, () => state)
    }
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    expect(kept(state)).toEqual([true, true, true])
    expect(logNickname()).toBe('Bear_Hunter')
    for (const mode of MODES) expect(state.activeProfile.modes[mode].registration).toMatchObject({ enteredNickname: 'Bear_Hunter' })
    // The levels of the readings still count.
    expect(state.activeProfile.modes.pve.playerLevel).toBe(41)
  })

  it('a misread of the same nickname (a slashed zero read «2», a clipped first letter) resets nothing either', async () => {
    vi.resetModules()
    const { applyModeSelectScreen } = await import('./logNickname')
    const state = target()
    for (const [index, name] of ['K0rn_Bat60', 'rn_Bat62', 'KOrn_Bat62', 'K0rn_Bat62', 'K0rn_Bat60'].entries()) {
      applyModeSelectScreen(cards(name), T0 + index * 3_000, () => state)
    }
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    expect(kept(state)).toEqual([true, true, true])
  })

  it('«Сменить ник»: another nickname typed after the game showed one resets nothing and goes to every mode', async () => {
    vi.resetModules()
    const { applyModeSelectScreen, setTypedNickname } = await import('./logNickname')
    const state = target()
    applyModeSelectScreen(cards('Raid_OS'), T0, () => state)
    applyModeSelectScreen(cards('Raid_OS'), T0 + 3_000, () => state)
    await setTypedNickname('Wolf_King', () => state)
    expect(state.resetModeProgress).not.toHaveBeenCalled()
    expect(kept(state)).toEqual([true, true, true])
    for (const mode of MODES) expect(state.activeProfile.modes[mode].registration).toMatchObject({ enteredNickname: 'Wolf_King' })
  })
})
