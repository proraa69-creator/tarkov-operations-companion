import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Paywall } from './Paywall'

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop') })

/** The desktop app signed in to an account without a subscription, on a PC whose logs show game account 7654321. */
function signedInDesktop() {
  const reports: unknown[] = []
  const status = vi.fn(async () => ({ signedIn: true, email: 'second@mail.ru', online: true, serverUrl: 'https://raidos.app', persistent: true, entitlement: { valid: false, reason: 'subscription' as const } }))
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    if (method === 'POST' && path === '/v1/accounts/me/eft-account') reports.push(body)
    return path === '/v1/payments/plans' ? { plans: [] } : null
  })
  const autoFindAndScanLogs = vi.fn(async () => ({ folder: 'C:/Battlestate Games/EFT/Logs', latestAccountIdByMode: { pvp: 7654321 }, accountIds: [7654321] }))
  Object.assign(window, { tarkovDesktop: { account: { status }, serviceRequest, autoFindAndScanLogs } })
  return { reports, status }
}

describe('«Нужна подписка» checks the game account too (owner, 13.10.2026)', () => {
  it('reports the game account of the PC and asks for the status again, so a game account in use locks with its reason', async () => {
    const pc = signedInDesktop()
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Нужна подписка' })).toBeInTheDocument()
    await waitFor(() => expect(pc.reports).toEqual([{ accountId: '7654321' }]))
    // Once on opening and once after the report (the server decides: «already in use» or still «Нужна подписка»).
    await waitFor(() => expect(pc.status.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('nothing is reported for other locks (a switched-off device)', async () => {
    const pc = signedInDesktop()
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'device-revoked' }} /></MemoryRouter>)
    await waitFor(() => expect(pc.status).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pc.reports).toEqual([])
  })
})
