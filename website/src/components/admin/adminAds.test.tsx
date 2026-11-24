import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminAds as Ads, StatsPeriod } from '../../api'

/** «Реклама» (owner, 09.11.2026): the Reddit link, visits, registrations and payments. */
const mocks = vi.hoisted(() => ({ ads: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminAds: mocks.ads } }
})

const { AdminAds } = await import('./AdminAds')

const answer = (period: StatsPeriod): Ads => ({
  period,
  sources: [{
    source: 'reddit', label: 'Reddit',
    totals: { visits: 120, registrations: 14, payments: 3, payers: 2, revenue: 1500 },
    rows: period === 'day'
      ? [{ period: '2026-11-09', visits: 80, registrations: 9, payments: 2, revenue: 900 }, { period: '2026-11-08', visits: 40, registrations: 5, payments: 1, revenue: 600 }]
      : [{ period: '2026-11', visits: 120, registrations: 14, payments: 3, revenue: 1500 }],
    campaigns: [{ campaign: 'tarkov', visits: 100, registrations: 12, payments: 3, revenue: 1500 }, { campaign: '', visits: 20, registrations: 2, payments: 0, revenue: 0 }],
  }],
})

describe('«Реклама» in the admin panel', () => {
  afterEach(() => { cleanup(); mocks.ads.mockReset() })

  it('shows the totals, the days, the campaigns and the link for the ads', async () => {
    mocks.ads.mockImplementation(async (_token: string, period: StatsPeriod) => answer(period))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<AdminAds />)
    await screen.findByText('Reddit')
    expect(mocks.ads).toHaveBeenCalledWith('owner-token', 'day')
    const stats = screen.getByRole('table', { name: 'Reddit: статистика' })
    expect(within(stats).getAllByRole('row')).toHaveLength(3)
    expect(within(stats).getByText('80')).toBeInTheDocument()
    const campaigns = screen.getByRole('table', { name: 'Reddit: кампании' })
    expect(within(campaigns).getByText('tarkov')).toBeInTheDocument()
    expect(within(campaigns).getByText('без названия')).toBeInTheDocument()

    expect(screen.getByText('https://raidos.app/?utm_source=reddit')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Ссылка для объявлений/), { target: { value: 'Tarkov Wipe' } })
    expect(screen.getByText('https://raidos.app/?utm_source=reddit&utm_campaign=tarkov-wipe')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://raidos.app/?utm_source=reddit&utm_campaign=tarkov-wipe'))
    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'По месяцам' }))
    await waitFor(() => expect(mocks.ads).toHaveBeenLastCalledWith('owner-token', 'month'))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Reddit: статистика' })).getAllByRole('row')).toHaveLength(2))
  })
})
