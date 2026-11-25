import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Owner, 03.11.2026: «сделай реальное количество регистраций» — the app's streamer cabinet shows them like the site. */
const statsOnlyMe = { referralCode: 'RAID-58XWZ', statsOnly: true, stats: { visits: 337, registrations: 72, linkRegistrations: 12, activeSubscriptions: 4, payers: 9, revenue: { amount: 12345 }, earnings: { amount: 0 } } }
const statsOnlyPayouts = { percent: 0, earned: 0, paidOut: 0, pending: 0, available: 0, minimum: 500, details: null, autoPayout: { enabled: false, intervalDays: 7, limits: { min: 3, max: 30 }, nextAt: null }, payouts: [] }
const answers: Record<string, unknown> = {}
beforeEach(() => {
  answers['/v1/accounts/me'] = statsOnlyMe
  answers['/v1/accounts/me/payouts'] = statsOnlyPayouts
  answers['/v1/accounts/me/referral-campaigns'] = { campaigns: [] }
  answers['/v1/accounts/me/referral-stats?period=day'] = { rows: [{ period: '2026-11-01', visits: 122, registrations: 17, linkRegistrations: 5, payments: 0, earnings: 0 }] }
  // Streamer new-events for the profile badge (owner, 25.11.2026).
  answers['/v1/accounts/me/streamer-notifications'] = { unread: 2, seenAt: null, items: [{ type: 'payment', at: '2026-11-25T00:00:00.000Z', amount: 15 }] }
})

vi.mock('../sync/serverSync', () => ({
  cleanIpcError: (reason: unknown) => String(reason),
  useServerAccount: () => ({ status: { signedIn: true, online: true, kind: 'streamer', subscription: { status: 'active' } } }),
}))
vi.mock('./nicknameBinding', () => ({ serviceClient: () => async (_method: string, path: string) => answers[path] }))

const { StreamerCabinetPanel, StreamerPanelButton } = await import('./StreamerCabinetPanel')

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

  it('shows how many viewers paid and the total sum (owner, 25.11.2026)', async () => {
    render(<StreamerCabinetPanel />)
    expect(await screen.findByText((text) => text.replace(/\s/g, ' ').includes('на сумму 12 345'))).toBeInTheDocument()
  })

  it('the profile button shows the unread streamer-notice count', async () => {
    render(<StreamerPanelButton />)
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByText('Панель стримера')).toBeInTheDocument()
  })

  it('a streamer with a share sees the 14-day rule and the payout accounting', async () => {
    answers['/v1/accounts/me'] = { referralCode: 'RAID-58XWZ', stats: { visits: 337, registrations: 72, linkRegistrations: 12, activeSubscriptions: 4, payers: 9, revenue: { amount: 12345 }, earnings: { amount: 1500 } } }
    answers['/v1/accounts/me/payouts'] = { percent: 15, earned: 1500, paidOut: 200, pending: 100, available: 900, maturing: 300, maturityDays: 14, minimum: 500, details: { phone: '+7 ••• •••-45-67', bank: 'Т-Банк', recipient: 'Иван Петров' }, autoPayout: { enabled: false, intervalDays: 7, limits: { min: 3, max: 30 }, nextAt: null }, payouts: [] }
    render(<StreamerCabinetPanel />)
    expect(await screen.findByText((text) => text.replace(/\s/g, ' ').includes('в течение 14 дней'))).toBeInTheDocument()
    expect(screen.getByText((text) => text.replace(/\s/g, ' ').includes('в заявке'))).toBeInTheDocument()
  })
})
