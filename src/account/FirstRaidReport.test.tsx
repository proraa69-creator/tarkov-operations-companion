import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { RaidState } from '../import/raidState'
import { subscriptionDaysLeft } from './SubscriptionExpiryNotice'
import { subscriptionText } from './accountActions'

const state = vi.hoisted(() => ({
  status: { signedIn: true, online: true, email: 'player@mail.ru', subscription: { status: 'trial', trialEndsAt: '2026-11-18T10:00:00.000Z', trialRaidDays: 2 } } as Record<string, unknown>,
  raid: null as RaidState | null,
  refresh: vi.fn(async () => null),
}))
vi.mock('../sync/serverSync', () => ({ useServerAccount: () => ({ status: state.status }), refreshServerStatus: state.refresh }))
vi.mock('../app/useRaidState', async (original) => ({ ...(await original<typeof import('../app/useRaidState')>()), useRaidState: () => state.raid }))

import { FirstRaidReport } from './FirstRaidReport'

function desktop(answer: () => Promise<unknown>) {
  const serviceRequest = vi.fn(async () => answer())
  Object.assign(window, { tarkovDesktop: { serviceRequest } })
  return serviceRequest
}

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop'); state.refresh.mockClear(); state.raid = null })

// Owner, 08.11.2026: «пошли в первый рейд… После этого начинается отсчёт 2 дней».
describe('the free days count from the first raid', () => {
  it('reports the raid start the logs show once, while the days wait for it, and asks for the status again', async () => {
    const request = desktop(async () => ({ started: true }))
    const view = render(<FirstRaidReport />)
    expect(request).not.toHaveBeenCalled()
    state.raid = { inRaid: true, since: Date.now() - 60_000, tracked: true }
    await act(async () => { view.rerender(<FirstRaidReport />) })
    expect(request).toHaveBeenCalledWith('POST', '/v1/accounts/me/first-raid')
    await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(1))
    await act(async () => { view.rerender(<FirstRaidReport />) })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('days that already run, or no account: nothing is sent', async () => {
    const request = desktop(async () => ({ started: false }))
    state.raid = { inRaid: true, since: Date.now(), tracked: true }
    const saved = state.status
    state.status = { ...saved, subscription: { status: 'trial', trialEndsAt: '2026-11-11T10:00:00.000Z' } }
    try {
      await act(async () => { render(<FirstRaidReport />) })
      expect(request).not.toHaveBeenCalled()
    } finally {
      state.status = saved
    }
  })

  it('the account says «с первого рейда» and counts nothing down while they wait', () => {
    const waiting = { status: 'trial' as const, trialEndsAt: '2026-11-18T10:00:00.000Z', trialRaidDays: 2 }
    expect(subscriptionText(waiting)).toBe('Пробный период с первого рейда')
    expect(subscriptionDaysLeft(waiting, Date.parse('2026-11-09T10:00:00.000Z'))).toBeNull()
    expect(subscriptionText({ status: 'trial', trialEndsAt: '2026-11-11T10:00:00.000Z' })).toBe('Пробный период до 11.11.2026')
  })
})
