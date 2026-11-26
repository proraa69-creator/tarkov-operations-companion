import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminStreamerSettings, OwnerStreamers } from '../../api'

/**
 * Owner, 25.11.2026: a streamer with a 0 % share is out of «Все стримеры» and of the table; raised above 0 %, he is counted
 * again.
 */
const mocks = vi.hoisted(() => ({ streamers: vi.fn(), settings: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, ownerStreamers: mocks.streamers, adminStreamerSettings: mocks.settings } }
})

const { OwnerAdmin } = await import('../OwnerAdmin')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const stats = (visits: number, revenue: number, earnings: number) => ({
  visits, registrations: 10, linkRegistrations: 0, activeSubscriptions: 2, revenue: { amount: revenue, currency: 'RUB' }, earnings: { amount: earnings, currency: 'RUB' },
})
const DATA: OwnerStreamers = {
  streamers: [
    { email: 'zero@example.com', code: 'ZERO_TV', createdAt: '2026-10-27T10:00:00.000Z', stats: stats(300, 5000, 0) },
    { email: 'share@example.com', code: 'SHARE_TV', createdAt: '2026-11-15T10:00:00.000Z', stats: stats(40, 2000, 300) },
  ],
  invites: [],
}
const settings = (zeroPercent: number): AdminStreamerSettings => ({
  defaultPercent: 15,
  streamers: [
    { code: 'ZERO_TV', email: 'zero@example.com', percent: zeroPercent, custom: true, linkEnabled: true },
    { code: 'SHARE_TV', email: 'share@example.com', percent: 15, custom: true, linkEnabled: true },
  ],
})
const card = (label: string) => screen.getByText(label, { selector: '.stat-label' }).closest('.stat-card') as HTMLElement

describe('«Стримеры»: a 0 % streamer is out of the statistics', () => {
  it('the totals and the table count the streamers with a share only', async () => {
    mocks.streamers.mockResolvedValue(DATA)
    mocks.settings.mockResolvedValue(settings(0))
    render(<OwnerAdmin />)
    await screen.findByText('SHARE_TV', { selector: 'span' })
    expect(screen.queryByText('ZERO_TV', { selector: 'span' })).toBeNull()
    expect(within(card('Стримеры')).getByText('1')).toBeInTheDocument()
    expect(within(card('Переходы')).getByText('40')).toBeInTheDocument()
  })

  it('with a share above 0 % he is counted again; no settings answer hides nobody', async () => {
    mocks.streamers.mockResolvedValue(DATA)
    mocks.settings.mockResolvedValue(settings(10))
    render(<OwnerAdmin />)
    await screen.findByText('ZERO_TV', { selector: 'span' })
    expect(within(card('Переходы')).getByText('340')).toBeInTheDocument()
    cleanup()
    mocks.settings.mockRejectedValue(new Error('offline'))
    render(<OwnerAdmin />)
    await screen.findByText('ZERO_TV', { selector: 'span' })
    expect(within(card('Стримеры')).getByText('2')).toBeInTheDocument()
  })
})
