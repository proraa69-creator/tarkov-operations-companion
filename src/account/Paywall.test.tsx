import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

/** The desktop app on a PC whose logs show game account `eftId` (the lock re-scans and reports it). */
function desktopWithLogs(eftId: number) {
  const reports: unknown[] = []
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => { if (method === 'POST' && path === '/v1/accounts/me/eft-account') reports.push(body); return null })
  const autoFindAndScanLogs = vi.fn(async () => ({ folder: 'C:/Games/EFT/Logs', latestAccountIdByMode: { pvp: eftId }, accountIds: [eftId] }))
  Object.assign(window, { tarkovDesktop: { serviceRequest, autoFindAndScanLogs } })
  return { reports, autoFindAndScanLogs }
}

describe('one Escape from Tarkov account — one Raid OS account (owner, 13.10.2026)', () => {
  it('the game account belongs to another Raid OS account: no plans, the reason, and the logs are checked again', async () => {
    const pc = desktopWithLogs(7654321)
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'eft-conflict', eft: { conflict: 'in-use', seen: '••••321' } }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Аккаунт Escape from Tarkov' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.')
    expect(screen.getByText('В логах игры на этом компьютере')).toBeInTheDocument()
    expect(screen.getByText('••••321')).toBeInTheDocument()
    expect(screen.getByText(/Войдите в тот аккаунт Raid OS или напишите в поддержку/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Оплатить/ })).toBeNull()
    expect(screen.queryByText('12 месяцев')).toBeNull()
    expect(screen.getByRole('link', { name: /Написать в поддержку/ })).toHaveAttribute('href', expect.stringContaining('t.me'))
    // On opening the logs are scanned and the game account reported, so the right one opens the app by itself.
    await waitFor(() => expect(pc.reports).toEqual([{ accountId: '7654321' }]))
    await waitFor(() => expect(screen.getByRole('button', { name: /Проверить снова/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Проверить снова/ }))
    await waitFor(() => expect(pc.reports).toHaveLength(2))
    expect(pc.autoFindAndScanLogs).toHaveBeenCalledTimes(2)
  })

  it('this account is bound to another game account: both shown, start the game under the bound one', () => {
    desktopWithLogs(1234999)
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'eft-conflict', eft: { conflict: 'other-account', seen: '••••999', bound: '••••321' } }} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('К этому аккаунту Raid OS привязан другой аккаунт Escape from Tarkov.')
    expect(screen.getByText('••••999')).toBeInTheDocument()
    expect(screen.getByText('Привязан к этому аккаунту Raid OS')).toBeInTheDocument()
    expect(screen.getByText('••••321')).toBeInTheDocument()
    expect(screen.getByText(/Запустите игру под привязанным аккаунтом и нажмите «Проверить снова»/)).toBeInTheDocument()
  })

  it('in English: nothing Russian left on the screen', () => {
    desktopWithLogs(1234999)
    setRenderLanguage('en')
    const { container } = render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'eft-conflict', eft: { conflict: 'other-account', seen: '••••999', bound: '••••321' } }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Escape from Tarkov account' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Another Escape from Tarkov account is linked to this Raid OS account.')
    expect(container.textContent ?? '').not.toMatch(/[А-Яа-яЁё]/)
  })
})
