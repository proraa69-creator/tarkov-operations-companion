import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newUsersRange } from '../../../../src/shared/ownerTime'

/** «Сводка» → «Новые за …»: a click on the tile chooses the period, the same periods as in the phone admin app. */
const mocks = vi.hoisted(() => ({ overview: vi.fn(), online: vi.fn(), stats: vi.fn(), series: vi.fn(), calendar: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminOverview: mocks.overview, adminOnlineStats: mocks.online, adminStats: mocks.stats, adminSeries: mocks.series, adminCalendar: mocks.calendar } }
})

const { AdminSummary } = await import('./AdminSummary')

const revenue = (total: number) => ({ total, payments: 1 })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('«Новые за …» on the site (owner, 03.11.2026)', () => {
  it('shows 30 days first and asks the server for the chosen period', async () => {
    mocks.overview.mockResolvedValue({
      generatedAt: '2026-11-03T03:00:00.000Z', users: { total: 120, today: 2, days7: 9, days30: 40, blocked: 1 },
      subscriptions: { active: 7, trials: 3, autopay: 0, streamers: 1 }, revenue: { today: revenue(300), month: revenue(900), all: revenue(9000) },
      payouts: { paid: 0, pending: 0, pendingRequests: 0, earned: 0 },
    })
    mocks.online.mockRejectedValue(new Error('offline'))
    mocks.calendar.mockReturnValue(new Promise(() => {}))
    mocks.series.mockReturnValue(new Promise(() => {}))
    mocks.stats.mockImplementation(async (_token: string, from: string, to: string) => ({ range: { from, to, timezone: 'Asia/Bangkok' }, users: { total: 120, new: from === newUsersRange('lastMonth').from ? 17 : 41 } }))

    render(<AdminSummary />)
    const thirty = newUsersRange('30d')
    await waitFor(() => expect(mocks.stats).toHaveBeenCalledWith('owner-token', thirty.from, thirty.to))
    const tile = await screen.findByRole('button', { name: 'Новые за 30 дней: 41. Выбрать период' })
    expect(screen.getByText(/заблокировано 1/)).toBeInTheDocument()
    expect(screen.getAllByText(/Время — по Бангкоку/).length).toBeGreaterThan(0)

    fireEvent.click(tile)
    for (const label of ['Сегодня', 'Вчера', '7 дней', 'Эта неделя', 'Прошлая неделя', '30 дней', 'Этот месяц', 'Прошлый месяц']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Прошлый месяц' }))
    const last = newUsersRange('lastMonth')
    await waitFor(() => expect(mocks.stats).toHaveBeenLastCalledWith('owner-token', last.from, last.to))
    expect(await screen.findByRole('button', { name: 'Новые за прошлый месяц: 17. Выбрать период' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Эта неделя' })).toBeNull()
  })
})
