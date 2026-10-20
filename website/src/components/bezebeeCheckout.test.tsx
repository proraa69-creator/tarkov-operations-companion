import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The CIS tariffs on BZB (owner, 20.10.2026): a card and a button per plan; the page only after the e-mail warning. */
const mocks = vi.hoisted(() => ({ bezebeeLink: vi.fn(), assign: vi.fn() }))

vi.mock('../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'session-token', account: { email: 'buyer@example.com' } }) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { bezebeeLink: mocks.bezebeeLink } }
})

const { BezebeePlans, BEZEBEE_EMAIL_WARNING } = await import('./BezebeeCheckout')
const { setSiteLocale } = await import('../i18n')

const PLANS = [
  { plan: '1m' as const, months: 1, price: 300 },
  { plan: '3m' as const, months: 3, price: 810 },
  { plan: '6m' as const, months: 6, price: 1500 },
  { plan: '12m' as const, months: 12, price: 2400 },
]

const realLocation = window.location
afterEach(() => {
  cleanup()
  setSiteLocale('ru')
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('BZB tariffs for the CIS in the cabinet', () => {
  it('a card and «Оплатить» per plan with its price; the chosen plan opens only after the warning is ticked', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign: mocks.assign } })
    mocks.bezebeeLink.mockResolvedValue({ url: 'https://pay.bezebee.com/iPnQLAib', plan: '6m' })
    const user = userEvent.setup()
    const { container } = render(<BezebeePlans plans={PLANS} currency="RUB" email="buyer@example.com" />)
    expect(container.querySelectorAll('.plan-card')).toHaveLength(4)
    for (const price of ['300', '810', '1500', '2400']) expect(container).toHaveTextContent(new RegExp(`${price.replace(/(\d)(?=(\d{3})+$)/g, '$1\\s?')}\\s?₽`))
    await user.click(screen.getByRole('button', { name: 'Оплатить 6 месяцев' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(BEZEBEE_EMAIL_WARNING)
    expect(dialog).toHaveTextContent('buyer@example.com')
    const go = screen.getByRole('button', { name: 'Перейти к оплате' })
    expect(go).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Понятно: укажу при оплате этот email' }))
    await user.click(go)
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://pay.bezebee.com/iPnQLAib'))
    expect(mocks.bezebeeLink).toHaveBeenCalledWith('session-token', '6m')
  })

  it('in English', async () => {
    setSiteLocale('en')
    const user = userEvent.setup()
    render(<BezebeePlans plans={PLANS} currency="RUB" email="buyer@example.com" />)
    await user.click(screen.getByRole('button', { name: 'Pay for 1 month' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('When paying, enter the same email as in your Raid OS account.')
    expect(screen.getByRole('button', { name: 'Proceed to payment' })).toBeDisabled()
  })
})
