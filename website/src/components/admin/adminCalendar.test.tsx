import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminCalendar as Calendar, AdminDay } from '../../api'

/** «Сводка» → «Календарь»: a month of days; a click opens the day window. */
const mocks = vi.hoisted(() => ({ calendar: vi.fn(), day: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminCalendar: mocks.calendar, adminDay: mocks.day } }
})

const { AdminCalendar } = await import('./AdminCalendar')

const plans = (count = 0, revenue = 0) => ({ '1m': { count, revenue }, '3m': { count: 0, revenue: 0 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } })
const month: Calendar = {
  month: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7),
  today: '',
  days: [],
}
month.days = Array.from({ length: 30 }, (_, index) => ({
  date: `${month.month}-${String(index + 1).padStart(2, '0')}`,
  registrations: index === 1 ? 3 : 0, payments: index === 1 ? 2 : 0, revenue: index === 1 ? 600 : 0, yookassa: index === 1 ? 600 : 0, lava: 0, plans: plans(index === 1 ? 2 : 0, index === 1 ? 600 : 0),
}))
month.today = month.days[27]!.date

const day: AdminDay = {
  date: month.days[1]!.date,
  totals: { registrations: 3, payments: 2, revenue: 600, yookassa: 600, lava: 0, streamerEarnings: 30, plans: plans(2, 600) },
  registrations: [{ id: 'a', email: 'new@example.com', kind: 'user', createdAt: `${month.days[1]!.date}T09:00:00.000Z`, referredBy: 'HUNTER' }],
  payments: [{ id: 'p1', email: 'payer@example.com', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 300, createdAt: `${month.days[1]!.date}T10:00:00.000Z`, paidAt: `${month.days[1]!.date}T10:01:00.000Z` }],
  grants: [{ email: 'friend@example.com', days: 5, reason: 'компенсация', actor: 'owner@example.com', at: `${month.days[1]!.date}T12:00:00.000Z` }],
  invites: [],
}

afterEach(() => { cleanup(); mocks.calendar.mockReset(); mocks.day.mockReset() })

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
    await waitFor(() => expect(within(dialog).getByText('payer@example.com')).toBeInTheDocument())
    expect(within(dialog).getByText('new@example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('HUNTER')).toBeInTheDocument()
    expect(within(dialog).getByText('+5 дн.')).toBeInTheDocument()
    expect(within(dialog).getByText('Оплачен')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
