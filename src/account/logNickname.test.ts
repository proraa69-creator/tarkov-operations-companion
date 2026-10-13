import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, registerModeProfile } from '../domain/progress'
import type { RaidMode } from '../domain/types'

const profiles = vi.hoisted(() => ({ byMode: {} as Partial<Record<RaidMode, { nickname: string; upstreamUpdatedAt: string }>>, calls: [] as string[] }))
vi.mock('../profile/playerProfileGateway', async (original) => ({
  ...(await original<typeof import('../profile/playerProfileGateway')>()),
  desktopPlayerProfileGateway: () => ({
    fetchByAccountId: async (mode: RaidMode, accountId: number) => {
      profiles.calls.push(`${mode}:${accountId}`)
      const hit = profiles.byMode[mode]
      if (!hit) throw new Error('not found')
      return { accountId, nickname: hit.nickname, upstreamUpdatedAt: hit.upstreamUpdatedAt, fetchedAt: '2026-10-10T00:00:00.000Z', experience: 0, level: 41, faction: 'bear', prestige: 0 }
    },
  }),
}))
const server = vi.hoisted(() => ({ status: { signedIn: true, nicknames: {} as Record<string, string> } }))
vi.mock('../sync/serverSync', async (original) => ({ ...(await original<typeof import('../sync/serverSync')>()), currentServerStatus: () => server.status }))
const saved = vi.hoisted(() => [] as Array<string | null>)
vi.mock('./nicknameBinding', async (original) => ({ ...(await original<typeof import('./nicknameBinding')>()), saveNicknameOnServer: async (nickname: string | null) => { saved.push(nickname); return true } }))

const { bindNicknameFromLogs, logNickname } = await import('./logNickname')

afterEach(() => { profiles.calls.length = 0; saved.length = 0 })

describe('the nickname from the game logs (owner, 10.10.2026)', () => {
  it('binds every mode the logs show to its game account, takes the newest Tarkov.dev name and saves it on the account', async () => {
    profiles.byMode = { pvp: { nickname: 'Raid_OS', upstreamUpdatedAt: '2026-10-10T10:00:00.000Z' }, pve: { nickname: 'SHAURMA', upstreamUpdatedAt: '2026-09-28T00:46:10.000Z' } }
    // «Сезон» was bound earlier under the old name; the logs of this scan do not show it.
    const activeProfile = registerModeProfile(createLocalProfile('Оператор'), 'seasonal', { accountId: 7690289, nickname: 'SHAURMA', enteredNickname: 'SHAURMA', verifiedAt: '2026-10-01T00:00:00.000Z' })
    const state = { activeProfile, registerModeProfile: vi.fn(), updatePlayerSnapshot: vi.fn() }
    const nickname = await bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 7690289, pve: 7690289 } }, () => state)
    expect(nickname).toBe('Raid_OS')
    expect(logNickname()).toBe('Raid_OS')
    expect(state.registerModeProfile.mock.calls.map(([mode, registration]) => [mode, registration.accountId, registration.enteredNickname])).toEqual([['pvp', 7690289, 'Raid_OS'], ['pve', 7690289, 'Raid_OS'], ['seasonal', 7690289, 'Raid_OS']])
    expect(state.updatePlayerSnapshot).toHaveBeenCalledTimes(2)
    expect(saved).toEqual(['Raid_OS'])
  })

  it('looks each mode and account up once per session, and does nothing without an AccountId in the logs', async () => {
    const state = { activeProfile: createLocalProfile('Оператор'), registerModeProfile: vi.fn(), updatePlayerSnapshot: vi.fn() }
    await bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 7690289 } }, () => state)
    expect(profiles.calls).toEqual([])
    expect(await bindNicknameFromLogs({ latestAccountIdByMode: {} }, () => state)).toBeNull()
    expect(state.registerModeProfile).not.toHaveBeenCalled()
  })
})

// A player whose profile Tarkov.dev had never published (owner, 13.10.2026: «до сих пор не находит» — his logs were read).
describe('a profile Tarkov.dev has not published yet', () => {
  it('is named for the player with a link to it, asked again later and at once after «Открыть мой профиль на tarkov.dev»', async () => {
    const { retryNicknameLookups, tarkovDevProfileUrl, NICKNAME_RETRY_MS } = await import('./logNickname')
    profiles.byMode = {}
    const state = { activeProfile: createLocalProfile('Оператор'), registerModeProfile: vi.fn(), updatePlayerSnapshot: vi.fn() }
    const scan = { latestAccountIdByMode: { pve: 5550123 } }
    expect(await bindNicknameFromLogs(scan, () => state)).toBeNull()
    expect(profiles.calls).toEqual(['pve:5550123'])
    expect(tarkovDevProfileUrl('pve', 5550123)).toBe('https://tarkov.dev/players/pve/5550123')
    expect(tarkovDevProfileUrl('pvp', 1)).toBe('https://tarkov.dev/players/regular/1')
    expect(tarkovDevProfileUrl('seasonal', 1)).toBe('https://tarkov.dev/players/pvp-season/1')

    // Log scans come every few seconds: not asked again before NICKNAME_RETRY_MS.
    await bindNicknameFromLogs(scan, () => state)
    expect(profiles.calls).toHaveLength(1)
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + NICKNAME_RETRY_MS + 1)
    await bindNicknameFromLogs(scan, () => state)
    later.mockRestore()
    expect(profiles.calls).toHaveLength(2)

    // The player opened the profile on tarkov.dev: published now, and found on the retry.
    profiles.byMode = { pve: { nickname: 'Bear_Hunter', upstreamUpdatedAt: '2026-10-13T12:00:00.000Z' } }
    expect(await retryNicknameLookups()).toBe('Bear_Hunter')
    expect(state.registerModeProfile).toHaveBeenCalledWith('pve', expect.objectContaining({ accountId: 5550123, enteredNickname: 'Bear_Hunter' }))
    expect(await retryNicknameLookups()).toBeNull()
    expect(profiles.calls).toHaveLength(3)
  })
})

// owner, 13.10.2026: «что если нам вернуть ручной ввод ника в приложении?»
describe('a typed nickname while Tarkov.dev gives none', () => {
  it('is bound to the game account of the logs and saved; Tarkov.dev\'s real name replaces it later', async () => {
    const { bindTypedNickname, retryNicknameLookups, typedNickname } = await import('./logNickname')
    profiles.byMode = {}
    const state = { activeProfile: createLocalProfile('Оператор'), registerModeProfile: vi.fn(), updatePlayerSnapshot: vi.fn() }
    await bindNicknameFromLogs({ latestAccountIdByMode: { pvp: 4440321 } }, () => state)
    await expect(bindTypedNickname('a', () => state)).rejects.toThrow(/3–15 символов/)
    await expect(bindTypedNickname('Имя', () => state)).rejects.toThrow(/латиница/)
    expect(await bindTypedNickname(' Wolf_77 ', () => state)).toBe('Wolf_77')
    expect(state.registerModeProfile).toHaveBeenCalledWith('pvp', expect.objectContaining({ accountId: 4440321, enteredNickname: 'Wolf_77', nickname: 'Wolf_77' }))
    expect(saved).toEqual(['Wolf_77'])
    expect(typedNickname()).toBe('Wolf_77')
    expect(logNickname()).toBe('Wolf_77')

    profiles.byMode = { pvp: { nickname: 'Wolf_78', upstreamUpdatedAt: '2026-10-13T12:00:00.000Z' } }
    server.status = { signedIn: true, nicknames: { nickname: 'Wolf_77' } }
    expect(await retryNicknameLookups()).toBe('Wolf_78')
    expect(typedNickname()).toBeUndefined()
    expect(saved).toEqual(['Wolf_77', 'Wolf_78'])
    // Every account has its nickname now: nothing left to type.
    await expect(bindTypedNickname('Wolf_79', () => state)).rejects.toThrow(/нет аккаунта игры без ника/)
  })
})
