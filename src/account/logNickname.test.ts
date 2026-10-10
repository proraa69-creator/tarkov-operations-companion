import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, registerModeProfile } from '../domain/progress'
import type { RaidMode } from '../domain/types'

const profiles = vi.hoisted(() => ({ byMode: {} as Partial<Record<RaidMode, { nickname: string; upstreamUpdatedAt: string }>>, calls: [] as string[] }))
vi.mock('../profile/playerProfileGateway', () => ({
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
