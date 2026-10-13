import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalProfile, registerModeProfile } from '../domain/progress'

/**
 * The nickname typed by the player (owner, 13.10.2026: «делай ручной ввод, не обращаясь к тарков дев», «возвращай кнопку
 * сменить ник»): bound to each mode's game account from the logs of this PC, saved on the account; nothing looked up.
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
  const state = { activeProfile: createLocalProfile('Оператор'), registerModeProfile: vi.fn((mode, registration) => { state.activeProfile = registerModeProfile(state.activeProfile, mode, registration) }) }
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
