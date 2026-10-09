import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: null as import('../electron').ServerAccountStatus | null }))
vi.mock('../sync/serverSync', () => ({ useServerAccount: () => ({ status: mocks.status }) }))
vi.mock('./accountActions', async (original) => {
  const actual = await original<typeof import('./accountActions')>()
  return { ...actual, openWebsite: vi.fn() }
})
const { SubscriptionExpiryNotice, shouldWarnSubscription, subscriptionDaysLeft } = await import('./SubscriptionExpiryNotice')

const day = 24 * 60 * 60 * 1000
const now = Date.parse('2026-10-09T12:00:00Z')

afterEach(() => { cleanup(); vi.useRealTimers(); delete window.tarkovDesktop })
beforeEach(() => { mocks.status = null })

describe('subscription expiry notice', () => {
  it('warns exactly three days and one day before expiry', () => {
    expect(subscriptionDaysLeft({ status: 'active', paidUntil: new Date(now + 3 * day).toISOString() }, now)).toBe(3)
    expect(shouldWarnSubscription({ status: 'active', paidUntil: new Date(now + 3 * day).toISOString() }, now)).toBe(true)
    expect(shouldWarnSubscription({ status: 'active', paidUntil: new Date(now + 2 * day).toISOString() }, now)).toBe(false)
    expect(shouldWarnSubscription({ status: 'active', paidUntil: new Date(now + day).toISOString() }, now)).toBe(true)
    expect(shouldWarnSubscription({ status: 'lifetime' }, now)).toBe(false)
  })

  it('waits for the startup update check and stays hidden when an update exists', async () => {
    vi.useFakeTimers()
    mocks.status = { signedIn: true, online: true, serverUrl: 'https://raidos.app', persistent: true, subscription: { status: 'active', paidUntil: new Date(Date.now() + day).toISOString() } }
    window.tarkovDesktop = {
      update: {
        status: vi.fn().mockResolvedValue({ state: 'available' }), install: vi.fn(),
        check: vi.fn().mockResolvedValue({ outcome: 'available', status: { state: 'available' }, current: '0.5.4', checkedAt: new Date().toISOString() }),
        onStatus: vi.fn(() => () => {}),
      },
    } as unknown as typeof window.tarkovDesktop
    render(<SubscriptionExpiryNotice />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens after the startup check confirms the current version', async () => {
    vi.useFakeTimers()
    mocks.status = { signedIn: true, online: true, serverUrl: 'https://raidos.app', persistent: true, subscription: { status: 'active', paidUntil: new Date(Date.now() + day).toISOString() } }
    window.tarkovDesktop = {
      update: {
        status: vi.fn().mockResolvedValue({ state: 'idle' }), install: vi.fn(),
        check: vi.fn().mockResolvedValue({ outcome: 'latest', status: { state: 'idle' }, current: '0.5.4', checkedAt: new Date().toISOString() }),
        onStatus: vi.fn(() => () => {}),
      },
    } as unknown as typeof window.tarkovDesktop
    render(<SubscriptionExpiryNotice />)
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500) })
    expect(screen.getByRole('dialog', { name: 'Срок подписки скоро закончится' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продлить подписку' })).toBeInTheDocument()
  })
})
