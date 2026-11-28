import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminCalendar as Calendar, AdminDay } from '../../api'
import { ownerDay } from '../../../../src/shared/ownerTime'

/** «Сводка» → «Календарь»: a month of days; a click opens the day window. */
const mocks = vi.hoisted(() => ({ calendar: vi.fn(), day: vi.fn(), stats: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminCalendar: mocks.calendar, adminDay: mocks.day, adminStats: mocks.stats } }
})

const { AdminCalendar } = await import('./AdminCalendar')

const plans = (count = 0, revenue = 0) => ({ '1m': { count, revenue }, '3m': { count: 0, revenue: 0 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } })
const month: Calendar = {
  month: ownerDay(Date.now()).slice(0, 7),
  today: '',
  days: [],
}
month.days = Array.from({ length: 30 }, (_, index) => ({
  date: `${month.month}-${String(index + 1).padStart(2, '0')}`,
  registrations: index === 1 ? 3 : 0, payments: index === 1 ? 2 : 0, revenue: index === 1 ? 600 : 0, plans: plans(index === 1 ? 2 : 0, index === 1 ? 600 : 0),
}))
month.today = month.days[27]!.date

const day: AdminDay = {
  date: month.days[1]!.date,
  totals: { registrations: 3, payments: 2, revenue: 600, streamerEarnings: 30, plans: plans(2, 600) },
  registrations: [{ id: 'a', email: 'new@example.com', kind: 'user', createdAt: `${month.days[1]!.date}T09:00:00.000Z`, referredBy: 'HUNTER' }],
  payments: [
    { id: 'p1', email: 'payer@example.com', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 300, createdAt: `${month.days[1]!.date}T10:00:00.000Z`, paidAt: `${month.days[1]!.date}T10:01:00.000Z` },
    // A payment of a payment service that is no longer connected (owner, 13.10.2026): «Архив», with what was paid.
    { id: 'p2', email: 'archived@example.com', plan: '1m', provider: 'archive', status: 'succeeded', amount: 300, original: { amount: 3.5, currency: 'USD' }, createdAt: `${month.days[1]!.date}T11:00:00.000Z`, paidAt: `${month.days[1]!.date}T11:00:00.000Z` },
  ],
  grants: [{ email: 'friend@example.com', days: 5, reason: 'компенсация', actor: 'owner@example.com', at: `${month.days[1]!.date}T12:00:00.000Z` }],
  invites: [],
}

afterEach(() => { cleanup(); mocks.calendar.mockReset(); mocks.day.mockReset(); mocks.stats.mockReset() })

describe('admin calendar', () => {
  it('shows the month and opens a day with its payments, registrations and grants', async () => {
    mocks.calendar.mockResolvedValue(month)
    mocks.day.mockResolvedValue(day)
    render(<AdminCalendar />)
    const second = await screen.findByRole('gridcell', { name: /^2 число: выручка 600/ })
    expect(within(second).getByText(/600/)).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /^29 число/ })).toBeDisabled()
    expect(screen.getByText('Выручка').parentElement).toHaveTextContent('600 ₽')

    fireEvent.click(second)
    const dialog = await screen.findByRole('dialog')
    expect(mocks.day).toHaveBeenCalledWith('owner-token', day.date)
    // The window stands inside the layer, never on it: in the PC owner app @scope dresses what is in «site-admin-layer»,
    // not the layer itself, so a backdrop that was the layer lost its own rules and fell to the bottom left of the page
    // (owner, 28.11.2026: «окно с информацией открывается слева внизу, и его не видно»).
    const backdrop = dialog.closest('.pay-dialog-backdrop')!
    expect(backdrop).not.toHaveClass('site-admin-layer')
    expect(backdrop.parentElement).toHaveClass('site-admin-layer')
    await waitFor(() => expect(within(dialog).getByText('payer@example.com')).toBeInTheDocument())
    expect(within(dialog).getByText('new@example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('HUNTER')).toBeInTheDocument()
    expect(within(dialog).getByText('+5 дн.')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Оплачен')).toHaveLength(2)
    const archived = within(dialog).getByText('archived@example.com').closest('tr')!
    expect(archived).toHaveTextContent('Архив')
    expect(archived).toHaveTextContent('3,50 USD')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a right click picks the first and the second day of a period: its summary, the third click and the cross drop it (owner, 15.11.2026)', async () => {
    mocks.calendar.mockResolvedValue(month)
    const [from, to] = [month.days[1]!.date, month.days[4]!.date]
    mocks.stats.mockResolvedValue({
      range: { from, to, timezone: 'Asia/Bangkok' },
      users: { total: 40, new: 7 },
      subscriptions: { activePaid: 5, activePaidRepeat: 2, trials: 4, trialsDead: 1, trialsAlive: 3 },
      payers: { everPaid: 9, paidInRange: 3, newInRange: 2, repeatPaid: 4, repeatInRange: 1 },
      revenue: { total: 1500, payments: 4, repeatPayments: 2, byPlan: { '1m': { count: 3, amount: 900 }, '3m': { count: 1, amount: 600 } }, refunds: { count: 0, amount: 0 } },
      trialConversion: { trialStarted: 6, laterPaid: 2, rate: 0.33, dead: 4, alive: 2 },
    })
    render(<AdminCalendar />)
    const fifth = await screen.findByRole('gridcell', { name: /^5 число/ })
    fireEvent.contextMenu(fifth)
    expect(screen.getByText('Выберите второй день правой кнопкой')).toBeInTheDocument()
    expect(fifth).toHaveClass('is-picked')
    expect(mocks.stats).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /^2 число/ }))

    const summary = await screen.findByRole('region', { name: /^Сводка за период/ })
    expect(mocks.stats).toHaveBeenCalledWith('owner-token', from, to)
    await waitFor(() => expect(within(summary).getByText('1 500 ₽')).toBeInTheDocument())
    expect(within(summary).getByText('оплат 4 · повторных 2')).toBeInTheDocument()
    expect(within(summary).getByText('Регистрации').parentElement).toHaveTextContent('7')
    expect(within(summary).getByText('впервые 2 · повторно 1')).toBeInTheDocument()
    expect(within(summary).getByText('мёртвых 4 · реальных 2 · оплатили 2')).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /^3 число/ })).toHaveClass('is-picked-inside')
    // No day window: a right click is not a click.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /^10 число/ }))
    expect(screen.queryByRole('region', { name: /^Сводка за период/ })).not.toBeInTheDocument()
    expect(document.querySelector('.is-picked')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /^2 число/ }))
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: /^5 число/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Снять выбор' }))
    expect(screen.queryByRole('region', { name: /^Сводка за период/ })).not.toBeInTheDocument()
  })
})
