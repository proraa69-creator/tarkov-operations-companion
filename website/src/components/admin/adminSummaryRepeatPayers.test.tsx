import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «Сводка» → «За всё время»: «Оплатили повторно», people with two or more paid payments (owner, 12.11.2026). */
const mocks = vi.hoisted(() => ({ overview: vi.fn(), online: vi.fn(), stats: vi.fn(), series: vi.fn(), calendar: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminOverview: mocks.overview, adminOnlineStats: mocks.online, adminStats: mocks.stats, adminSeries: mocks.series, adminCalendar: mocks.calendar } }
})

const { AdminSummary } = await import('./AdminSummary')

const revenue = (total: number, payments = 1) => ({ total, payments })
const overview = (extra: Record<string, unknown>) => ({
  generatedAt: '2026-11-12T03:00:00.000Z', users: { total: 120, today: 2, days7: 9, days30: 40, blocked: 0 },
  subscriptions: { active: 7, trials: 3, autopay: 0, streamers: 1 }, revenue: { today: revenue(300), month: revenue(900, 3), all: revenue(9000, 31) },
  payouts: { paid: 0, pending: 0, pendingRequests: 0, earned: 0 }, ...extra,
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function pending() {
  mocks.online.mockRejectedValue(new Error('offline'))
  mocks.calendar.mockReturnValue(new Promise(() => {}))
  mocks.series.mockReturnValue(new Promise(() => {}))
  mocks.stats.mockReturnValue(new Promise(() => {}))
}

describe('«Оплатили повторно» on the site (owner, 12.11.2026)', () => {
  it('shows the count in «За всё время» only', async () => {
    pending()
    mocks.overview.mockResolvedValue(overview({ repeatPayers: 12 }))
    render(<AdminSummary />)
    const all = (await screen.findByText('За всё время')).closest('.stat-card') as HTMLElement
    expect(within(all).getByText('Оплатили повторно')).toBeInTheDocument()
    expect(within(all).getByText('12')).toBeInTheDocument()
    expect(screen.getAllByText('Оплатили повторно')).toHaveLength(1)
  })

  it('an older server without the number shows no line', async () => {
    pending()
    mocks.overview.mockResolvedValue(overview({}))
    render(<AdminSummary />)
    await screen.findByText('За всё время')
    expect(screen.queryByText('Оплатили повторно')).toBeNull()
  })
})
