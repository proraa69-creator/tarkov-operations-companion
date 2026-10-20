import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The CIS tariffs on BZB (owner, 20.10.2026): a card and a button per plan; the page only with the offer consent. */
const mocks = vi.hoisted(() => ({ bezebeeLink: vi.fn(), assign: vi.fn() }))

vi.mock('../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'session-token', account: { email: 'buyer@example.com' } }) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { bezebeeLink: mocks.bezebeeLink } }
})

const { BezebeePlans } = await import('./BezebeeCheckout')
const { setSiteLocale } = await import('../i18n')
const { LEGAL_VERSION } = await import('../legal/documents')

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

const view = () => render(<MemoryRouter><BezebeePlans region="CIS" plans={PLANS} currency="RUB" /></MemoryRouter>)
const WORLD = [
  { plan: '1m' as const, months: 1, price: 7 },
  { plan: '3m' as const, months: 3, price: 19 },
  { plan: '6m' as const, months: 6, price: 35 },
  { plan: '12m' as const, months: 12, price: 60 },
]

describe('BZB tariffs for the CIS in the cabinet (owner, 20.10.2026)', () => {
  it('a card and «Оплатить» per plan; the discounted plans highlighted like ЮKassa; the page only with the offer consent and the account e-mail to type on BZB\'s page (the notification is matched by it)', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign: mocks.assign } })
    mocks.bezebeeLink.mockResolvedValue({ url: 'https://pay.bezebee.com/iPnQLAib', plan: '6m' })
    const user = userEvent.setup()
    const { container } = view()
    expect(container.querySelectorAll('.plan-card')).toHaveLength(4)
    expect([...container.querySelectorAll('.plan-badge')].map((badge) => badge.textContent)).toEqual(['−10%', '−17%', '−33%'])
    expect(screen.getByRole('button', { name: 'Оплатить 1 месяц' })).not.toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Оплатить 6 месяцев' })).toHaveClass('primary')
    await user.click(screen.getByRole('button', { name: 'Оплатить 6 месяцев' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('укажите на странице оплаты e-mail вашего аккаунта: buyer@example.com')
    expect(dialog).toHaveTextContent('Платёж разовый. Автоматических повторных списаний нет.')
    const go = screen.getByRole('button', { name: 'Перейти к оплате' })
    expect(go).toBeDisabled()
    await user.click(go)
    expect(mocks.bezebeeLink).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox', { name: /Я принимаю условия публичной оферты/ }))
    await user.click(go)
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://pay.bezebee.com/iPnQLAib'))
    expect(mocks.bezebeeLink).toHaveBeenCalledWith('session-token', '6m', LEGAL_VERSION, false, undefined)
  })

  it('the rest of the world in dollars; an invited account pays its first month at the friend price, as with ЮKassa', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign: mocks.assign } })
    mocks.bezebeeLink.mockResolvedValue({ url: 'https://pay.bezebee.com/Xw98gnXM', plan: '1m', friend: true })
    const user = userEvent.setup()
    const { container } = render(<MemoryRouter><BezebeePlans region="WORLD" plans={WORLD} currency="USD" friend={{ plan: '1m', price: 5.5 }} /></MemoryRouter>)
    expect(container).toHaveTextContent('в долларах США')
    const first = container.querySelector('.plan-card') as HTMLElement
    expect(first.querySelector('.plan-old')).toBeTruthy()
    expect(first).toHaveTextContent(/по приглашению, только первый месяц/)
    expect(first.querySelector('.plan-badge')).toHaveTextContent('−21%')
    await user.click(screen.getByRole('button', { name: 'Оплатить 1 месяц' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Цена по приглашению действует один раз')
    await user.click(screen.getByRole('checkbox', { name: /Я принимаю условия публичной оферты/ }))
    await user.click(screen.getByRole('button', { name: 'Перейти к оплате' }))
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('https://pay.bezebee.com/Xw98gnXM'))
    expect(mocks.bezebeeLink).toHaveBeenCalledWith('session-token', '1m', LEGAL_VERSION, true, undefined)
  })

  it('in English', async () => {
    setSiteLocale('en')
    const user = userEvent.setup()
    view()
    await user.click(screen.getByRole('button', { name: 'Pay for 1 month' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('This is a one-time payment.')
    expect(screen.getByRole('button', { name: 'Proceed to payment' })).toBeDisabled()
  })
})
