import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «Подписка» in the site header (owner, 16.10.2026): two tabs «СНГ» and «Зарубежная оплата», opened on the visitor's
 * region (account country → server hint → time zone → language); the visitor's own pick always wins.
 */
const mocks = vi.hoisted(() => ({ account: null as unknown, plans: vi.fn() }))

vi.mock('../auth', () => ({ useAuth: () => ({ status: 'ready', token: null, account: mocks.account, error: null }) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { plans: mocks.plans } }
})

const { SubscriptionDialog, initialSubscriptionTab } = await import('./SubscriptionDialog')

const PLANS = { enabled: true, plans: [{ id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 }], providers: { yookassa: true, autopay: false } }

afterEach(() => {
  cleanup()
  mocks.account = null
  vi.clearAllMocks()
})

describe('initialSubscriptionTab', () => {
  it('the account country decides first', () => {
    expect(initialSubscriptionTab('DE', 'RU', 'Europe/Moscow', 'ru')).toBe('world')
    expect(initialSubscriptionTab('KZ', 'WORLD', 'Europe/Berlin', 'en')).toBe('cis')
    expect(initialSubscriptionTab('RU', 'WORLD', undefined, 'en')).toBe('cis')
  })
  it('then the server hint, the time zone, the site language', () => {
    expect(initialSubscriptionTab(undefined, 'WORLD', 'Europe/Moscow', 'ru')).toBe('world')
    expect(initialSubscriptionTab(undefined, 'CIS', 'America/New_York', 'en')).toBe('cis')
    expect(initialSubscriptionTab(undefined, undefined, 'Asia/Almaty', 'en')).toBe('cis')
    expect(initialSubscriptionTab(undefined, undefined, 'Europe/Berlin', 'ru')).toBe('world')
    expect(initialSubscriptionTab(undefined, undefined, undefined, 'en')).toBe('world')
    expect(initialSubscriptionTab(undefined, undefined, undefined, 'ru')).toBe('cis')
  })
})

describe('SubscriptionDialog tabs', () => {
  it('a visitor the server places abroad sees Boosty, and «СНГ» shows the rouble prices', async () => {
    mocks.plans.mockResolvedValue({ ...PLANS, regionHint: 'WORLD' })
    render(<MemoryRouter><SubscriptionDialog onClose={() => {}} /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Зарубежная оплата' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByText(/на платформе Boosty банковской картой/)).toBeInTheDocument()
    expect(screen.queryByText('300 ₽')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'СНГ' }))
    expect(screen.getByRole('tab', { name: 'СНГ' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/ЮKassa/)).toBeInTheDocument()
    expect(screen.getByText('Беларусь, Казахстан и другие страны СНГ')).toBeInTheDocument()
  })

  it('a signed-in account opens on its own country, whatever the hint', async () => {
    mocks.account = { id: 'a', email: 'a@example.com', country: 'BY' }
    mocks.plans.mockResolvedValue({ ...PLANS, regionHint: 'WORLD' })
    render(<MemoryRouter><SubscriptionDialog onClose={() => {}} /></MemoryRouter>)
    await waitFor(() => expect(mocks.plans).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: 'СНГ' })).toHaveAttribute('aria-selected', 'true')
  })
})
