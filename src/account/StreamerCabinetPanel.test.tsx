import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Owner, 03.11.2026: «сделай реальное количество регистраций» — the app's streamer cabinet shows them like the site. */
const answers: Record<string, unknown> = {
  '/v1/accounts/me': { referralCode: 'RAID-58XWZ', statsOnly: true, stats: { visits: 337, registrations: 72, linkRegistrations: 12, activeSubscriptions: 4, earnings: { amount: 0 } } },
  '/v1/accounts/me/payouts': { percent: 0, earned: 0, paidOut: 0, pending: 0, available: 0, minimum: 500, details: null, autoPayout: { enabled: false, intervalDays: 7, limits: { min: 3, max: 30 }, nextAt: null }, payouts: [] },
  '/v1/accounts/me/referral-campaigns': { campaigns: [] },
  '/v1/accounts/me/referral-stats?period=day': { rows: [{ period: '2026-11-01', visits: 122, registrations: 17, linkRegistrations: 5, payments: 0, earnings: 0 }] },
}

vi.mock('../sync/serverSync', () => ({
  cleanIpcError: (reason: unknown) => String(reason),
  useServerAccount: () => ({ status: { signedIn: true, online: true, kind: 'streamer', subscription: { status: 'active' } } }),
}))
vi.mock('./nicknameBinding', () => ({ serviceClient: () => async (_method: string, path: string) => answers[path] }))

const { StreamerCabinetPanel } = await import('./StreamerCabinetPanel')

afterEach(cleanup)

describe('the app\'s streamer cabinet', () => {
  it('shows every registration the link brought, with and without the code', async () => {
    render(<StreamerCabinetPanel />)
    expect(await screen.findByText('60 по коду · 12 без кода')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Без кода' })).toBeInTheDocument()
    const row = (await within(table).findByRole('cell', { name: '2026-11-01' })).closest('tr')!
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2026-11-01', '122', '17', '5', '0'])
  })
})
