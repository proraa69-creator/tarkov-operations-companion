import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The iPhone app (App Store build, owner 17.10.2026): no payments, prices or partner payouts; «Удалить аккаунт».
const mocks = vi.hoisted(() => ({
  status: null as import('../electron').ServerAccountStatus | null,
  request: vi.fn(),
  logout: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
}))
vi.mock('../platform', async (original) => ({ ...await original<typeof import('../platform')>(), isIosApp: () => true }))
vi.mock('../sync/serverSync', async (original) => ({
  ...await original<typeof import('../sync/serverSync')>(),
  useServerAccount: () => ({ status: mocks.status, checking: false, available: true, refresh: mocks.refresh, login: vi.fn(), logout: mocks.logout }),
}))
vi.mock('./useAccountNickname', () => ({ useAccountNickname: () => 'Reviewer' }))
vi.mock('../sync/webAccount', async (original) => ({ ...await original<typeof import('../sync/webAccount')>(), webServiceRequest: mocks.request }))

const { Paywall } = await import('./Paywall')
const { IosAccountPanel } = await import('./IosAccount')
const { SubscriptionExpiryNotice } = await import('./SubscriptionExpiryNotice')
const { accessText, deleteErrorText, privacyPolicyUrl } = await import('./iosAccountText')

const signedIn = (subscription: NonNullable<import('../electron').ServerAccountStatus['subscription']>) => ({
  signedIn: true, online: true, serverUrl: 'https://raidos.app', persistent: true, email: 'reviewer@example.com', subscription,
})

beforeEach(() => { mocks.status = null; mocks.request.mockReset(); mocks.logout.mockClear(); mocks.refresh.mockClear() })
afterEach(cleanup)

describe('iPhone app (App Store build)', () => {
  it('instead of the paywall: «Нет доступа», Refresh, Support, Sign out — no plans, prices or payment', () => {
    mocks.status = signedIn({ status: 'inactive' })
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Обновить/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Поддержка/ })).toHaveAttribute('href', 'https://t.me/raidosapp')
    expect(screen.getByRole('button', { name: /Выйти/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Удалить аккаунт/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Политика конфиденциальности/ })).toHaveAttribute('href', 'https://raidos.app/legal/privacy')
    expect(document.body.textContent).not.toMatch(/₽|Оплат|оплат|подписк|Подписк|месяц|скидк|код друга/)
  })

  it('a lock that is not the subscription says why, with «Обновить» instead of «Проверить оплату»', () => {
    mocks.status = signedIn({ status: 'active' })
    render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'unavailable' }} /></MemoryRouter>)
    expect(screen.getByText('Сервер недоступен. Проверьте интернет и нажмите «Обновить».')).toBeInTheDocument()
  })

  it('no subscription chip or renewal window', () => {
    mocks.status = signedIn({ status: 'active', paidUntil: new Date(Date.now() + 86_400_000).toISOString() })
    const { container } = render(<SubscriptionExpiryNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('profile: access in words, privacy policy, delete with the password (POST /v1/accounts/me/delete): the 10 days are named only after pressing, the account stays signed in', async () => {
    mocks.status = signedIn({ status: 'active', paidUntil: '2026-10-30T00:00:00Z' })
    mocks.request.mockResolvedValue({ scheduled: true, deletionAt: '2026-10-30T12:00:00Z' })
    render(<MemoryRouter><IosAccountPanel /></MemoryRouter>)
    expect(screen.getByText('Доступ открыт до 30.10.2026')).toBeInTheDocument()
    expect(screen.queryByText(/Открыть кабинет на сайте|Оформить подписку|Подтвердить вход на сайте/)).toBeNull()
    expect(screen.getByRole('link', { name: /Политика конфиденциальности/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Удалить аккаунт/ }))
    const dialog = screen.getByRole('dialog', { name: 'Удалить аккаунт?' })
    expect(dialog).toHaveTextContent('reviewer@example.com')
    expect(dialog).not.toHaveTextContent(/10 дней/)
    fireEvent.change(screen.getByLabelText('Пароль для подтверждения'), { target: { value: 'secret-pass' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Удалить аккаунт$/ }))
    expect(await screen.findByRole('dialog', { name: 'Удаление запланировано' })).toHaveTextContent('Аккаунт будет удалён через 10 дней — 30.10.2026')
    expect(mocks.request).toHaveBeenCalledWith('POST', '/v1/accounts/me/delete', { password: 'secret-pass' })
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('a scheduled deletion shows its date and «Отменить удаление» (POST /v1/accounts/me/delete/cancel)', async () => {
    mocks.status = { ...signedIn({ status: 'active' }), deletionAt: '2026-10-30T12:00:00Z' }
    mocks.request.mockResolvedValue({ account: {} })
    render(<MemoryRouter><IosAccountPanel /></MemoryRouter>)
    expect(screen.getByText(/Аккаунт будет удалён/)).toHaveTextContent('Аккаунт будет удалён 30.10.2026')
    fireEvent.click(screen.getByRole('button', { name: /Отменить удаление/ }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('POST', '/v1/accounts/me/delete/cancel', {}))
  })

  it('a wrong password keeps the dialog open with the server message', async () => {
    mocks.status = signedIn({ status: 'trial', trialEndsAt: '2026-10-18T00:00:00Z' })
    mocks.request.mockRejectedValue(new Error('Пароль указан неверно'))
    render(<MemoryRouter><IosAccountPanel /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Удалить аккаунт/ }))
    fireEvent.change(screen.getByLabelText('Пароль для подтверждения'), { target: { value: 'wrong-pass' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Удалить аккаунт$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Пароль указан неверно')
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('words without a subscription; the website autopayment refusal becomes support', () => {
    expect(accessText({ status: 'lifetime' })).toBe('Доступ открыт')
    expect(accessText({ status: 'inactive' })).toBe('Нет доступа')
    expect(accessText(undefined)).toBe('Нет данных: сервер недоступен')
    expect(deleteErrorText('Сначала отмените автопродление подписки в личном кабинете')).toMatch(/Напишите в поддержку/)
    expect(deleteErrorText('Пароль указан неверно')).toBe('Пароль указан неверно')
    expect(privacyPolicyUrl()).toBe('https://raidos.app/legal/privacy')
  })
})
