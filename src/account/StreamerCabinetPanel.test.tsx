import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 0 % «statistics only» streamer: the old cabinet — no viewers' sums, no share, no payouts (owner, 30.10 and 25.11.2026).
const statsOnlyMe = { referralCode: 'RAID-TEST0', statsOnly: true, stats: { visits: 300, registrations: 70, linkRegistrations: 10, activeSubscriptions: 5, earnings: { amount: 0 } } }
const statsOnlyPayouts = { percent: 0, earned: 0, paidOut: 0, pending: 0, available: 0, minimum: 500, details: null, payouts: [] }
// 15 % streamer: the full new cabinet.
const shareMe = { referralCode: 'RAID-TEST1', stats: { visits: 300, registrations: 70, linkRegistrations: 10, activeSubscriptions: 5, payers: 9, revenue: { amount: 12345 }, earnings: { amount: 1500 } } }
const sharePayouts = { percent: 15, earned: 1500, paidOut: 200, pending: 100, available: 900, maturing: 300, maturityDays: 14, minimum: 500, details: { phone: '+7 ••• •••-45-67', bank: 'Т-Банк', recipient: 'Иван Петров' }, payouts: [] }
const answers: Record<string, unknown> = {}
beforeEach(() => {
  answers['/v1/accounts/me'] = statsOnlyMe
  answers['/v1/accounts/me/payouts'] = statsOnlyPayouts
  answers['/v1/accounts/me/referral-campaigns'] = { campaigns: [] }
  answers['/v1/accounts/me/referral-stats?period=day'] = { rows: [{ period: '2026-11-01', visits: 122, registrations: 17, linkRegistrations: 5, payments: 0, earnings: 0 }] }
  answers['/v1/accounts/me/streamer-notifications'] = { unread: 2, seenAt: null, items: [{ type: 'payment', at: '2026-11-25T00:00:00.000Z', amount: 15 }] }
})

vi.mock('../sync/serverSync', () => ({
  cleanIpcError: (reason: unknown) => String(reason),
  useServerAccount: () => ({ status: { signedIn: true, online: true, kind: 'streamer', subscription: { status: 'active' } } }),
}))
vi.mock('./nicknameBinding', () => ({ serviceClient: () => async (_method: string, path: string) => answers[path] }))

const { StreamerCabinetPanel, StreamerPanelButton, useStreamerPanel } = await import('./StreamerCabinetPanel')

/** The profile's way: the button only where the server has answered the notices. */
function ProfileButton({ enabled = true }: { enabled?: boolean }) {
  const panel = useStreamerPanel(enabled)
  return panel ? <StreamerPanelButton unread={panel.unread} /> : <span>нет панели</span>
}

afterEach(cleanup)

describe('the app\'s streamer cabinet', () => {
  it('a 0 % streamer keeps the old cabinet: registration split, no viewers\' sum, no payouts', async () => {
    render(<StreamerCabinetPanel />)
    expect(await screen.findByText('60 по коду · 10 без кода')).toBeInTheDocument()
    expect(screen.queryByText((text) => text.replace(/\s/g, ' ').includes('на сумму'))).not.toBeInTheDocument()
    expect(screen.queryByText('Доступно к выплате')).not.toBeInTheDocument()
    expect(screen.queryByText('Получить выплату')).not.toBeInTheDocument()
  })

  it('a 15 % streamer sees how much viewers paid, the 14-day rule and the payout accounting', async () => {
    answers['/v1/accounts/me'] = shareMe
    answers['/v1/accounts/me/payouts'] = sharePayouts
    render(<StreamerCabinetPanel />)
    expect(await screen.findByText((text) => text.replace(/\s/g, ' ').includes('на сумму 12 345'))).toBeInTheDocument()
    expect(screen.getByText((text) => text.replace(/\s/g, ' ').includes('в течение 14 дней'))).toBeInTheDocument()
    expect(screen.getByText((text) => text.replace(/\s/g, ' ').includes('в заявке'))).toBeInTheDocument()
  })

  it('the profile button shows the unread streamer-notice count', async () => {
    render(<ProfileButton />)
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByText('Панель стримера')).toBeInTheDocument()
  })

  // Owner, 26.11.2026: only the streamer with a share sees it; nobody else, in any way.
  it('no panel where the server refuses the notices (a player, a 0 % streamer) or for an account that is no streamer', async () => {
    delete answers['/v1/accounts/me/streamer-notifications']
    render(<ProfileButton />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText('нет панели')).toBeInTheDocument()
    expect(screen.queryByText('Панель стримера')).not.toBeInTheDocument()
    cleanup()
    answers['/v1/accounts/me/streamer-notifications'] = { unread: 1, seenAt: null, items: [] }
    render(<ProfileButton enabled={false} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Панель стримера')).not.toBeInTheDocument()
  })
})
