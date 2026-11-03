import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OwnerStreamers } from '../../api'

/**
 * Owner, 03.11.2026: «переходы по его ссылке 336. Регистрация 59. Скорее всего люди нажимали по его ссылке, листали сайт,
 * а потом регистрировались сами… сделай реальное количество регистраций».
 */
const mocks = vi.hoisted(() => ({ streamers: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, ownerStreamers: mocks.streamers } }
})

const { OwnerAdmin } = await import('../OwnerAdmin')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const stats = (registrations: number, linkRegistrations: number) => ({
  visits: 337, registrations, linkRegistrations, activeSubscriptions: 4, revenue: { amount: 960, currency: 'RUB' }, earnings: { amount: 0, currency: 'RUB' },
})

describe('«Стримеры»: registrations without the code', () => {
  it('shows every registration the link brought, split into with the code and without it', async () => {
    const data: OwnerStreamers = { streamers: [{ email: 'streamer@example.com', code: 'RAID-58XWZ', createdAt: '2026-10-27T10:00:00.000Z', stats: stats(72, 12) }], invites: [] }
    mocks.streamers.mockResolvedValue(data)
    render(<OwnerAdmin />)
    const row = (await screen.findByText('RAID-58XWZ', { selector: 'span' })).closest('tr')!
    expect(within(row).getByText('60 по коду · 12 без кода')).toBeInTheDocument()
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent(/^72/)
    // The cards: the total with its split, the active subscriptions on their own.
    const card = screen.getByText('Регистрации', { selector: '.stat-label' }).closest('.stat-card')!
    expect(within(card as HTMLElement).getByText('72')).toBeInTheDocument()
    expect(within(card as HTMLElement).getByText('60 по коду · 12 без кода')).toBeInTheDocument()
    expect(screen.getByText('Подписки', { selector: '.stat-label' }).closest('.stat-card')).toHaveTextContent('4')
    expect(screen.getByText(/«Без кода» — из них зарегистрировались без кода с того же интернет-адреса в течение 7 дней/)).toBeInTheDocument()
  })

  it('an older server without the split: everything is by the code', async () => {
    const { linkRegistrations: _unused, ...old } = stats(59, 0)
    void _unused
    mocks.streamers.mockResolvedValue({ streamers: [{ email: 'streamer@example.com', code: 'RAID-58XWZ', createdAt: '2026-10-27T10:00:00.000Z', stats: old }], invites: [] })
    render(<OwnerAdmin />)
    const row = (await screen.findByText('RAID-58XWZ', { selector: 'span' })).closest('tr')!
    expect(within(row).getByText('59 по коду · 0 без кода')).toBeInTheDocument()
  })
})
