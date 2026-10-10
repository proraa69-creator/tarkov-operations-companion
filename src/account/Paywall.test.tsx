import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Paywall } from './Paywall'
import { lockedReasonText } from './dataAccess'
import { setRenderLanguage, uiText } from '../i18n/renderText'

const SERVER_PLANS = [
  { id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 },
  { id: '3m', months: 3, price: 810, currency: 'RUB', discountPercent: 10 },
  { id: '6m', months: 6, price: 1500, currency: 'RUB', discountPercent: 17 },
  { id: '12m', months: 12, price: 2400, currency: 'RUB', discountPercent: 33 },
]
const withServerPrices = () => Object.assign(window, { tarkovDesktop: { serviceRequest: vi.fn(async (_method: string, path: string) => (path === '/v1/payments/plans' ? { plans: SERVER_PLANS } : null)) } })
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop'); setRenderLanguage('ru') })
/** «вместо <s>900 ₽</s>»: the whole line, the struck-through price included. */
const line = (text: string) => (_content: string, element: Element | null) => element?.tagName === 'SPAN' && element.textContent?.replace(/\s+/g, ' ') === text

describe('paywall of the players’ app', () => {
  it('without a subscription: plans, «Оплатить», and the referral trial', () => {
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Нужна подписка' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeInTheDocument()
    expect(screen.getByText('12 месяцев')).toBeInTheDocument()
    expect(screen.getByText(/Есть код друга\?.*скидка 20 %/)).toBeInTheDocument()
    expect(screen.queryByText(/стример/i)).toBeNull()
    expect(screen.queryByText(/Закрыто до оплаты/)).toBeNull()
  })

  it('longer plans: «810 ₽ вместо 900 ₽» and the saving at the server prices (owner, 10.10.2026)', async () => {
    withServerPrices()
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)
    expect(await screen.findByText(line('вместо 3 600 ₽'))).toBeInTheDocument()
    expect(screen.getByText('−33% · экономия 1 200 ₽')).toBeInTheDocument()
    expect(screen.getByText(line('вместо 1 800 ₽'))).toBeInTheDocument()
    expect(screen.getByText('−17% · экономия 300 ₽')).toBeInTheDocument()
    expect(screen.getByText('810 ₽')).toBeInTheDocument()
    expect(screen.getByText(line('вместо 900 ₽'))).toBeInTheDocument()
    expect(screen.getByText('−10% · экономия 90 ₽')).toBeInTheDocument()
    expect(screen.getAllByText((_content, element) => element?.tagName === 'S')).toHaveLength(3)
  })

  it('longer plans in English: «instead of» and «save»', async () => {
    withServerPrices()
    setRenderLanguage('en')
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)
    expect(await screen.findByText(line('instead of 3 600 ₽'))).toBeInTheDocument()
    expect(screen.getByText('−33% · save 1 200 ₽')).toBeInTheDocument()
    expect(screen.queryByText(/вместо|экономия/)).toBeNull()
  })

  it('signed out: the sign-in form first', () => {
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'signed-out' }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Вход в аккаунт' })).toBeInTheDocument()
    expect(screen.queryByText('Продолжить без входа')).toBeNull()
  })

  it('is translated to English', () => {
    setRenderLanguage('en')
    try {
      expect(uiText('Нужна подписка')).toBe('Subscription required')
      expect(uiText('Оплатить')).toBe('Pay')
      expect(uiText(lockedReasonText('device-revoked'))).toBe('This device was switched off: the account signed in on another device (three at most).')
      expect(uiText(lockedReasonText('subscription'))).toMatch(/^Your subscription is not active/)
    } finally {
      setRenderLanguage('ru')
    }
  })
})
