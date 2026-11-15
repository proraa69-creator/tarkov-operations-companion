import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «Сводка» (owner, 15.11.2026): «Платные подписки» with the repeat ones, «Пробный период» with the dead and the real ones,
 * «Повторных» in each revenue card. An older server without the numbers keeps the old lines.
 */
const mocks = vi.hoisted(() => ({ overview: vi.fn(), online: vi.fn(), stats: vi.fn(), series: vi.fn(), calendar: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminOverview: mocks.overview, adminOnlineStats: mocks.online, adminStats: mocks.stats, adminSeries: mocks.series, adminCalendar: mocks.calendar } }
})

const { AdminSummary } = await import('./AdminSummary')

const overview = (subscriptions: Record<string, number>, repeat?: [number, number, number]) => ({
  generatedAt: '2026-11-15T03:00:00.000Z', users: { total: 120, today: 2, days7: 9, days30: 40, blocked: 0 },
  subscriptions: { active: 7, trials: 5, autopay: 0, streamers: 1, ...subscriptions },
  revenue: {
    today: { total: 600, payments: 2, ...(repeat ? { repeat: repeat[0] } : {}) },
    month: { total: 900, payments: 3, ...(repeat ? { repeat: repeat[1] } : {}) },
    all: { total: 9000, payments: 31, ...(repeat ? { repeat: repeat[2] } : {}) },
  },
  payouts: { paid: 0, pending: 0, pendingRequests: 0, earned: 0 },
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function pending() {
  mocks.online.mockRejectedValue(new Error('offline'))
  mocks.calendar.mockReturnValue(new Promise(() => {}))
  mocks.series.mockReturnValue(new Promise(() => {}))
  mocks.stats.mockReturnValue(new Promise(() => {}))
}
const card = async (title: string) => (await screen.findByText(title)).closest('.stat-card') as HTMLElement

describe('«Сводка»: repeat subscriptions and payments, dead and real free periods', () => {
  it('shows the numbers under the tiles and in the revenue cards', async () => {
    pending()
    mocks.overview.mockResolvedValue(overview({ activeRepeat: 3, trialsDead: 2, trialsAlive: 3 }, [1, 2, 9]))
    render(<AdminSummary />)
    expect(await card('Платные подписки')).toHaveTextContent('из них повторных: 3')
    expect(await card('Пробный период')).toHaveTextContent('мёртвых 2 · реальных 3')
    for (const [title, repeat] of [['Выручка сегодня', '1'], ['За этот месяц', '2'], ['За всё время', '9']] as const) {
      expect(within(await card(title)).getByText('Повторных').nextSibling).toHaveTextContent(repeat)
    }
  })

  it('an older server keeps the old lines', async () => {
    pending()
    mocks.overview.mockResolvedValue(overview({}))
    render(<AdminSummary />)
    expect(await card('Платные подписки')).toHaveTextContent('только те, кто оплатил и подписка идёт')
    expect(screen.queryByText('Повторных')).toBeNull()
    expect(screen.queryByText(/мёртвых/)).toBeNull()
  })
})
