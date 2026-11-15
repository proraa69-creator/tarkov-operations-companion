import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteAdminSummary } from './SiteAdminSummary'

/**
 * «Сводка» of the PC owner app's «Админ панель» (owner, 15.11.2026: «точная копия сайта»): the site's tabs, every request
 * through the app's gateway (the request given to it), never fetch; a link to an account opens «Пользователи» on it.
 */
const plans = { '1m': { count: 0, revenue: 0 }, '3m': { count: 0, revenue: 0 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } }
const overview = {
  generatedAt: '2026-11-15T03:00:00.000Z', users: { total: 120, today: 2, days7: 9, days30: 40, blocked: 0 },
  subscriptions: { active: 7, activeRepeat: 2, trials: 5, trialsDead: 3, trialsAlive: 2, autopay: 0, streamers: 1 },
  revenue: { today: { total: 600, payments: 2, repeat: 1 }, month: { total: 900, payments: 3, repeat: 1 }, all: { total: 9000, payments: 31, repeat: 8 } },
  payouts: { paid: 0, pending: 0, pendingRequests: 0, earned: 0 }, repeatPayers: 6, plans: { month: plans, all: plans },
}
const payment = { id: 'p'.repeat(24), accountId: 'a'.repeat(24), email: 'payer@example.com', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 300, createdAt: '2026-11-15T03:00:00.000Z', paidAt: '2026-11-15T03:01:00.000Z', method: 'sbp' }

function gateway() {
  return vi.fn(async (_method: string, path: string): Promise<unknown> => {
    if (path === '/v1/accounts/me/admin/overview') return overview
    if (path.startsWith('/v1/accounts/me/admin/payments?')) return { payments: [payment], total: 1, totals: { succeeded: 1, revenue: 300, streamerEarnings: 0 } }
    if (path.startsWith('/v1/accounts/me/admin/users?')) return { users: [], total: 0, regions: { all: 0, russia: 0, cis: 0, world: 0, none: 0 } }
    return new Promise(() => {})
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('SiteAdminSummary', () => {
  it('shows the site\'s summary through the gateway, with the site\'s tabs and no «Реклама»', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const request = gateway()
    render(<SiteAdminSummary request={request} email="owner@example.com" />)
    const tabs = screen.getByRole('tablist', { name: 'Разделы сводки' })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Сводка', 'Платежи', 'Пользователи', 'Привлечение друзей', 'Стримеры'])
    expect(await screen.findByText('из них повторных: 2')).toBeInTheDocument()
    expect(screen.getByText('мёртвых 3 · реальных 2')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('GET', '/v1/accounts/me/admin/overview', undefined)
    expect(document.querySelector('.site-admin')).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a payer\'s e-mail opens «Пользователи» on that account', async () => {
    const request = gateway()
    render(<SiteAdminSummary request={request} email="owner@example.com" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Платежи' }))
    fireEvent.click(await screen.findByRole('link', { name: 'payer@example.com' }))
    expect(screen.getByRole('tab', { name: 'Пользователи' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', expect.stringMatching(/^\/v1\/accounts\/me\/admin\/users\?q=payer%40example\.com&/), undefined))
  })
})
