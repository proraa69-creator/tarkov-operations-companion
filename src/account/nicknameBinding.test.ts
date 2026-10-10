import { describe, expect, it, vi } from 'vitest'
import { createLocalProfile, registerModeProfile } from '../domain/progress'
import type { RaidMode } from '../domain/types'

const { accountNickname, profileNickname, renameBoundModes } = await import('./nicknameBinding')

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

  it('a new nickname from the logs: every other bound mode takes it and keeps its game account; unbound modes stay unbound', () => {
    const activeProfile = bound('seasonal', 99, 'OldName', bound('pvp', 7, 'OldName'))
    const state = { activeProfile, registerModeProfile: vi.fn() }
    renameBoundModes(state, 'Shaurma', ['pvp'], '2026-10-10T00:00:00.000Z')
    expect(state.registerModeProfile.mock.calls).toEqual([['seasonal', { accountId: 99, enteredNickname: 'Shaurma', nickname: 'OldName', verifiedAt: '2026-10-10T00:00:00.000Z' }]])
    state.registerModeProfile.mockClear()
    renameBoundModes(state, 'OldName', [])
    expect(state.registerModeProfile).not.toHaveBeenCalled()
  })
})
