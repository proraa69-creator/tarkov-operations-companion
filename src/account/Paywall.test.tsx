import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Paywall } from './Paywall'
import { lockedReasonText } from './dataAccess'
import { setRenderLanguage, uiText } from '../i18n/renderText'

describe('paywall of the players’ app', () => {
  it('without a subscription: plans, «Оплатить», and the referral trial', () => {
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Нужна подписка' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeInTheDocument()
    expect(screen.getByText('12 месяцев')).toBeInTheDocument()
    expect(screen.getByText(/первые 3 дня бесплатно/)).toBeInTheDocument()
    expect(screen.queryByText(/Закрыто до оплаты/)).toBeNull()
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
