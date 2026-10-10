import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, registerModeProfile } from '../domain/progress'
import type { RaidMode } from '../domain/types'

const gateway = vi.hoisted(() => ({ found: {} as Partial<Record<RaidMode, { accountId: number; nickname: string }>> }))
vi.mock('../profile/playerProfileGateway', () => ({
  desktopPlayerProfileGateway: () => ({
    resolveByNickname: async (mode: RaidMode, nickname: string) => {
      const hit = gateway.found[mode]
      if (!hit) throw new Error(`Ник «${nickname}» пока не найден в режиме ${mode}`)
      return { ...hit, level: 41, faction: 'usec', mode }
    },
  }),
  canResolvePlayerProfiles: () => true,
}))
const app = vi.hoisted(() => ({ registerModeProfile: vi.fn(), updatePlayerSnapshot: vi.fn(), clearModeProfile: vi.fn(), raidMode: 'pve' as RaidMode, activeProfile: null as unknown }))
vi.mock('../state/AppState', () => ({ useAppState: () => app }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ refresh: vi.fn() }) }))

const { accountNickname, findNicknameInModes, profileNickname } = await import('./nicknameBinding')
const { useNicknameBinder } = await import('./useNicknameBinder')

afterEach(() => { vi.clearAllMocks(); gateway.found = {}; Reflect.deleteProperty(window, 'tarkovDesktop') })

const bound = (mode: RaidMode, accountId: number, nickname: string, profile = createLocalProfile('Оператор')) =>
  registerModeProfile(profile, mode, { accountId, nickname, enteredNickname: nickname, verifiedAt: '2026-10-10T00:00:00.000Z' })

describe('one Escape from Tarkov nickname for every mode (owner, 10.10.2026)', () => {
  it('the account nickname: the server repeats it per mode; an older server kept one per mode — the first of PvP → PvE → «Сезон»', () => {
    expect(accountNickname({ pvp: 'Shaurma', pve: 'Shaurma', seasonal: 'Shaurma' })).toBe('Shaurma')
    expect(accountNickname({ pve: 'PveOnly' })).toBe('PveOnly')
    expect(accountNickname({})).toBeUndefined()
    expect(accountNickname(undefined)).toBeUndefined()
  })

  it('the app nickname: the preferred mode when bound, else the first bound mode', () => {
    const profile = bound('pve', 7, 'Shaurma')
    expect(profileNickname(profile, 'pvp')).toBe('Shaurma')
    expect(profileNickname(createLocalProfile('x'))).toBeUndefined()
  })

  it('looks the nickname up in every mode, the current one first; fails only when no mode has it', async () => {
    gateway.found = { pvp: { accountId: 7, nickname: 'Shaurma' }, seasonal: { accountId: 7, nickname: 'Shaurma' } }
    expect((await findNicknameInModes('shaurma', 'seasonal')).map((entry) => entry.mode)).toEqual(['seasonal', 'pvp'])
    gateway.found = {}
    await expect(findNicknameInModes('shaurma', 'pve')).rejects.toThrow('режиме pve')
  })

  it('«Привязать ник» binds every mode with a profile, unbinds a mode left on an old nickname and saves the nickname once', async () => {
    const serviceRequest = vi.fn(async () => ({}))
    Object.assign(window, { tarkovDesktop: { serviceRequest } })
    app.activeProfile = bound('seasonal', 99, 'OldName', bound('pvp', 7, 'OldName'))
    gateway.found = { pvp: { accountId: 7, nickname: 'Shaurma' }, pve: { accountId: 7, nickname: 'Shaurma' } }
    const { result } = renderHook(() => useNicknameBinder())
    const binding = await result.current('shaurma')
    expect(binding.modes).toEqual(['pve', 'pvp'])
    expect(binding.candidate.nickname).toBe('Shaurma')
    expect(app.registerModeProfile.mock.calls.map(([mode, registration]) => [mode, registration.accountId, registration.nickname])).toEqual([['pve', 7, 'Shaurma'], ['pvp', 7, 'Shaurma']])
    expect(app.clearModeProfile.mock.calls).toEqual([['seasonal']])
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    expect(serviceRequest).toHaveBeenCalledWith('PUT', '/v1/accounts/me/nicknames', { nickname: 'Shaurma', pvp: 'Shaurma', pve: 'Shaurma', seasonal: 'Shaurma' })
  })
})
