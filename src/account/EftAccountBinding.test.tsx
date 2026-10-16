import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const sync = vi.hoisted(() => ({ refresh: vi.fn(async () => null) }))
vi.mock('../sync/serverSync', () => ({
  useServerAccount: () => ({ status: { signedIn: true, online: true, email: 'player@mail.ru' } }),
  refreshServerStatus: sync.refresh,
  cleanIpcError: (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''),
}))

import { EftAccountBinding } from './EftAccountBinding'
import { computeDataAccess } from './dataAccess'
import { rememberEftAccount } from './eftAccountLink'

/** The desktop gateway answering the report the way the server would. */
function desktop(answer: () => Promise<unknown>) {
  const serviceRequest = vi.fn(async () => answer())
  Object.assign(window, { tarkovDesktop: { serviceRequest } })
  return serviceRequest
}
const scan = (id: number) => rememberEftAccount({ latestAccountIdByMode: { pvp: id }, accountIds: [id] })
/** A later log scan while the app runs. */
const seen = (id: number) => act(async () => { scan(id) })
/** The game account is known before the component mounts (the module keeps the last scan between tests). */
const mount = async (id: number) => { scan(id); await act(async () => { render(<EftAccountBinding />) }) }
const ipcError = (text: string) => new Error(`Error invoking remote method 'service:request': Error: ${text}`)

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop'); sync.refresh.mockClear() })

describe('the game account of this PC goes to the server at sign-in (owner, 13.10.2026)', () => {
  it('reports it once and asks for the account status again: the server decides whether this PC may stay open', async () => {
    const request = desktop(async () => ({ eftAccount: { masked: '••••321' } }))
    await mount(7654321)
    expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/eft-account', { accountId: '7654321' })
    await vi.waitFor(() => expect(sync.refresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a refusal also asks again (the app locks); the notice stays for a refusal that did not lock it', async () => {
    desktop(async () => { throw ipcError('Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.') })
    await mount(7654322)
    expect(await screen.findByRole('alert')).toHaveTextContent('Этот аккаунт Escape from Tarkov уже используется')
    expect(sync.refresh).toHaveBeenCalledTimes(1)
  })

  it('another game account than the bound one: the notice says so', async () => {
    desktop(async () => { throw ipcError('К этому аккаунту Raid OS привязан другой аккаунт Escape from Tarkov.') })
    await mount(7654323)
    expect(await screen.findByRole('alert')).toHaveTextContent('К этому аккаунту Raid OS привязан другой аккаунт Escape from Tarkov.')
    expect(sync.refresh).toHaveBeenCalledTimes(1)
  })

  it('offline: nothing shown, nothing re-checked, sent again with the next game account', async () => {
    const request = desktop(async () => { throw ipcError('Сервер недоступен') })
    await mount(7654324)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sync.refresh).not.toHaveBeenCalled()
    await seen(7654325)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  it('the lock carries what the server refused (dataAccess)', () => {
    const eft = { conflict: 'in-use' as const, seen: '••••321' }
    expect(computeDataAccess('gateway', { signedIn: true, online: true, serverUrl: '', persistent: true, entitlement: { valid: false, reason: 'eft-conflict', message: 'x', eft } }))
      .toEqual({ state: 'locked', reason: 'eft-conflict', message: 'x', eft })
  })
})
