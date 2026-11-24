import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AdminAds, StatsPeriod } from './adminApi'

/** «Реклама» of the admin app (owner, 09.11.2026): the Reddit link, visits, registrations and payments. */
const mocks = vi.hoisted(() => ({ ads: vi.fn() }))
vi.mock('./adminApi', async (original) => {
  const actual = await original<typeof import('./adminApi')>()
  return { ...actual, adminApi: { ...actual.adminApi, ads: mocks.ads } }
})

const { AdsSheet } = await import('./AdminAdsSheet')

const answer = (period: StatsPeriod): AdminAds => ({
  period,
  sources: [{
    source: 'reddit', label: 'Reddit',
    totals: { visits: 120, registrations: 14, payments: 3, payers: 2, revenue: 1500 },
    rows: [{ period: period === 'day' ? '2026-11-09' : '2026-11', visits: 120, registrations: 14, payments: 3, revenue: 1500 }],
    campaigns: [{ campaign: 'tarkov', visits: 120, registrations: 14, payments: 3, revenue: 1500 }],
  }],
})

describe('«Реклама» in the admin app', () => {
  afterEach(() => { cleanup(); mocks.ads.mockReset() })

  it('shows the numbers and gives the link for the ads with the campaign', async () => {
    mocks.ads.mockImplementation(async (period: StatsPeriod) => answer(period))
    const onClose = vi.fn()
    render(<AdsSheet onClose={onClose} />)
    const dialog = await screen.findByRole('dialog', { name: 'Реклама' })
    await within(dialog).findByText('Reddit')
    expect(mocks.ads).toHaveBeenCalledWith('day')
    expect(within(dialog).getByText('оплатили: 2')).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Reddit: кампании' })).getByText('tarkov')).toBeTruthy()
    expect(within(dialog).getByText('https://raidos.app/?utm_source=reddit')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Название кампании'), { target: { value: 'wipe' } })
    expect(within(dialog).getByText('https://raidos.app/?utm_source=reddit&utm_campaign=wipe')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'По месяцам' }))
    await waitFor(() => expect(mocks.ads).toHaveBeenLastCalledWith('month'))
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Reddit: статистика' })).getAllByRole('row')).toHaveLength(2))
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Закрыть' })[0]!)
    expect(onClose).toHaveBeenCalled()
  })
})
