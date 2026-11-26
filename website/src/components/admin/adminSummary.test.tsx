import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminOverview } from '../../api'

/** Owner, 25.11.2026: выручка грязными и чистыми; в блоке «За всё время» один показатель повторных оплат, без дубля. */
const mocks = vi.hoisted(() => ({ overview: vi.fn(), phones: vi.fn(), online: vi.fn(), stats: vi.fn(), series: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminOverview: mocks.overview, adminPhones: mocks.phones, adminOnlineStats: mocks.online, adminStats: mocks.stats, adminSeries: mocks.series } }
})

const { AdminSummary } = await import('./AdminSummary')

afterEach(() => { cleanup(); vi.clearAllMocks() })

const overview: AdminOverview = {
  generatedAt: '2026-11-25T00:00:00.000Z',
  users: { total: 100, today: 1, days7: 5, days30: 20, blocked: 0 },
  subscriptions: { active: 10, trials: 3, autopay: 2, streamers: 1 },
  repeatPayers: 20,
  revenue: {
    today: { total: 1000, payments: 3, repeat: 1, net: 900, streamerEarnings: 50, fees: 50 },
    month: { total: 5000, payments: 10, repeat: 4, net: 4500, streamerEarnings: 300, fees: 200 },
    all: { total: 20000, payments: 40, repeat: 22, net: 18000, streamerEarnings: 1200, fees: 800 },
  },
  payouts: { paid: 0, pending: 0, pendingRequests: 0, earned: 1200 },
}

describe('AdminSummary revenue cards', () => {
  it('shows net (чистыми) and keeps only one repeat metric in the all-time card', async () => {
    mocks.overview.mockResolvedValue(overview)
    mocks.phones.mockRejectedValue(new Error('x'))
    mocks.online.mockRejectedValue(new Error('x'))
    mocks.stats.mockRejectedValue(new Error('x'))
    mocks.series.mockRejectedValue(new Error('x'))
    render(<AdminSummary />)

    // «Чистыми» on the all-time card.
    expect(await screen.findByText((text) => text.replace(/\s/g, ' ').includes('Чистыми: 18 000'))).toBeInTheDocument()

    // «За всё время»: «Оплатили повторно» (people) stays, «Повторных» (payments) is gone — no duplicate.
    const allCard = (await screen.findByText('За всё время')).closest('.admin-revenue-card') as HTMLElement
    expect(within(allCard).getByText('Оплатили повторно')).toBeInTheDocument()
    expect(within(allCard).queryByText('Повторных')).not.toBeInTheDocument()

    // «За этот месяц» keeps «Повторных» and never shows «Оплатили повторно».
    const monthCard = screen.getByText('За этот месяц').closest('.admin-revenue-card') as HTMLElement
    expect(within(monthCard).getByText('Повторных')).toBeInTheDocument()
    expect(within(monthCard).queryByText('Оплатили повторно')).not.toBeInTheDocument()
  })
})
