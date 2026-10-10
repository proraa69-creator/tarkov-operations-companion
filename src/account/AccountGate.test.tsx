import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerAccountStatus } from '../electron'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { LEGAL_VERSION as SITE_LEGAL_VERSION } from '../../website/src/legal/documents'

/**
 * The account window on first launch (AccountController + AccountSignIn) against a mocked desktop gateway
 * (window.tarkovDesktop: the IPC of electron/preload.ts). The server reports both e-mail and SMS codes as on: the app
 * still shows e-mail options only.
 */
const appState = vi.hoisted(() => ({
  raidMode: 'pvp',
  activeProfile: { id: 'p1', modes: { pvp: { registration: { status: 'unregistered' } }, pve: { registration: { status: 'unregistered' } }, seasonal: { registration: { status: 'unregistered' } } } },
  registerModeProfile: () => {}, updatePlayerSnapshot: () => {}, setRaidMode: () => {},
}))
vi.mock('../state/AppState', () => ({ useAppState: () => appState }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ refresh: () => {} }) }))

const { AccountController } = await import('./AccountController')
const { LEGAL_VERSION, PHONE_AUTH_UI } = await import('./authFeatures')
const { refreshServerStatus } = await import('../sync/serverSync')

const SERVER = 'https://raidos.app'
const signedOut: ServerAccountStatus = { signedIn: false, online: true, serverUrl: SERVER, persistent: true }
const signedIn: ServerAccountStatus = { signedIn: true, email: 'new@example.com', kind: 'user', nicknames: {}, subscription: { status: 'trial' }, online: true, serverUrl: SERVER, persistent: true }
const CHALLENGE = 'c'.repeat(32)

function desktop(options: { edition?: 'client' | 'owner'; serverMode?: boolean; status?: ServerAccountStatus } = {}) {
  const account = {
    status: vi.fn(async () => options.status ?? signedOut),
    login: vi.fn(async () => signedIn),
    logout: vi.fn(async () => signedOut),
    emailSignIn: vi.fn(async () => signedIn),
    phoneSignIn: vi.fn(async () => signedIn),
    register: vi.fn(async (): Promise<unknown> => ({ pending: { challengeId: CHALLENGE, expiresAt: '2026-10-01T10:10:00.000Z', resendSeconds: 60, message: 'Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.' } })),
    registerConfirm: vi.fn(async () => ({ status: signedIn, referralApplied: true })),
    openWebsite: vi.fn(async () => true),
  }
  const serviceRequest = vi.fn(async (method: string, path: string): Promise<unknown> => {
    if (method === 'GET' && path === '/v1/accounts/auth-config') return { emailEnabled: true, smsEnabled: true }
    if (path === '/v1/accounts/me/consents') return { consents: [] }
    if (path === '/v1/accounts/register/resend') return { challengeId: 'd'.repeat(32), expiresAt: '2026-10-01T10:20:00.000Z', resendSeconds: 60 }
    return null
  })
  Object.assign(window, { tarkovDesktop: { edition: options.edition ?? 'client', serverMode: options.serverMode ?? false, serviceRequest, account } })
  return { account, serviceRequest }
}

async function open(locale: 'ru' | 'en' = 'ru') {
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  await refreshServerStatus()
  const user = userEvent.setup()
  render(<LocaleProvider><MemoryRouter><AccountController /></MemoryRouter></LocaleProvider>)
  return user
}

// No manual nickname step any more (owner, 10.10.2026): the app reads the nickname from the game logs.
const expectStraightToTheApp = async () => {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByText('Привязать ник')).toBeNull()
}

const PHONE_TEXT = /SMS|СМС|телефон|phone number/i
const expectNoPhoneUi = () => {
  expect(document.body.textContent ?? '').not.toMatch(PHONE_TEXT)
  expect(document.querySelector('input[type="tel"]')).toBeNull()
}

// Whole forms are typed in with userEvent: give a busy machine more than the default 5 s.
describe('account window on first launch', { timeout: 30_000 }, () => {
  beforeEach(() => { sessionStorage.clear() })
  afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop'); localStorage.clear() })

  it('opens by itself in the client build with «Вход» / «Регистрация» tabs and e-mail options only', async () => {
    desktop()
    await open()
    const dialog = await screen.findByRole('dialog', { name: 'Вход в аккаунт' })
    expect(within(dialog).getByRole('tab', { name: 'Вход' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tab', { name: 'Регистрация' })).toHaveAttribute('aria-selected', 'false')
    expect(await within(dialog).findByText('Войти по коду из письма')).toBeInTheDocument()
    expect(within(dialog).getByText('Забыли пароль?')).toBeInTheDocument()
    expect(PHONE_AUTH_UI).toBe(false)
    expectNoPhoneUi()
  })

  it('signs in with e-mail and password, then goes straight to the app (the nickname comes from the game logs)', async () => {
    const { account } = desktop()
    const user = await open()
    await screen.findByRole('dialog', { name: 'Вход в аккаунт' })
    await user.type(screen.getByLabelText('E-mail'), 'me@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(account.login).toHaveBeenCalledWith('me@example.com', 'correct horse')
    await expectStraightToTheApp()
  })

  it('registers in the app: e-mail code step, then the consent is recorded and the app opens', async () => {
    const { account, serviceRequest } = desktop()
    const user = await open()
    await screen.findByRole('dialog', { name: 'Вход в аккаунт' })
    await user.click(screen.getByRole('tab', { name: 'Регистрация' }))
    await user.type(screen.getByLabelText('E-mail'), 'new@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'correct horse')
    await user.type(screen.getByLabelText('Повторите пароль'), 'correct horse')
    await user.click(screen.getByRole('button', { name: /У меня есть код приглашения/ }))
    await user.type(screen.getByLabelText(/Код приглашения/), 'HUNTER_TV')
    const submit = screen.getByRole('button', { name: 'Зарегистрироваться' })
    // Never pre-ticked: the consent with the documents on raidos.app comes first.
    expect(submit).toBeDisabled()
    const consent = screen.getByRole('checkbox')
    expect(consent).not.toBeChecked()
    expect(screen.getByRole('link', { name: 'оферты' })).toHaveAttribute('href', 'https://raidos.app/legal/offer')
    expect(screen.getByRole('link', { name: 'согласие на обработку персональных данных' })).toHaveAttribute('href', 'https://raidos.app/legal/consent')
    expect(screen.getByRole('link', { name: 'политикой конфиденциальности' })).toHaveAttribute('href', 'https://raidos.app/legal/privacy')
    await user.click(consent)
    await user.click(submit)
    expect(account.register).toHaveBeenCalledWith('new@example.com', 'correct horse', 'HUNTER_TV')
    expect(await screen.findByText('Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.')).toBeInTheDocument()
    expect(account.registerConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Отправить код ещё раз/ }))
    expect(serviceRequest).not.toHaveBeenCalledWith('POST', '/v1/accounts/register/resend', expect.anything())

    await user.type(screen.getByLabelText('Код из письма'), '123456')
    account.status.mockResolvedValue(signedIn)
    await user.click(screen.getByRole('button', { name: 'Подтвердить и войти' }))
    expect(account.registerConfirm).toHaveBeenCalledWith(CHALLENGE, '123456')
    await expectStraightToTheApp()
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/accounts/me/consents', { kind: 'registration', version: LEGAL_VERSION })
  })

  it('without e-mail codes on the server the new account is signed in at once', async () => {
    const { account, serviceRequest } = desktop()
    account.register.mockResolvedValue({ status: signedIn, referralApplied: false })
    const user = await open()
    await screen.findByRole('dialog', { name: 'Вход в аккаунт' })
    await user.click(screen.getByRole('tab', { name: 'Регистрация' }))
    await user.type(screen.getByLabelText('E-mail'), 'new@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'correct horse')
    await user.type(screen.getByLabelText('Повторите пароль'), 'correct horse')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(account.register).toHaveBeenCalledWith('new@example.com', 'correct horse', undefined)
    await expectStraightToTheApp()
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/accounts/me/consents', { kind: 'registration', version: LEGAL_VERSION })
  })

  it('checks the passwords before calling the server', async () => {
    const { account } = desktop()
    const user = await open()
    await screen.findByRole('dialog', { name: 'Вход в аккаунт' })
    await user.click(screen.getByRole('tab', { name: 'Регистрация' }))
    await user.type(screen.getByLabelText('E-mail'), 'new@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'correct horse')
    await user.type(screen.getByLabelText('Повторите пароль'), 'another horse')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(await screen.findByText('Пароли не совпадают.')).toBeInTheDocument()
    expect(account.register).not.toHaveBeenCalled()
  })

  it('«Забыли пароль?» resets the password by an e-mail code', async () => {
    desktop()
    const user = await open()
    await user.click(await screen.findByRole('button', { name: 'Забыли пароль?' }))
    expect(screen.getByRole('heading', { name: 'Восстановление пароля' })).toBeInTheDocument()
    expect(screen.getByText(/Мы пришлём на него код, после него задайте новый пароль/)).toBeInTheDocument()
    expectNoPhoneUi()
  })

  it('opens in the owner build too, but not on the server laptop (--server-mode)', async () => {
    desktop({ edition: 'owner' })
    await open()
    expect(await screen.findByRole('dialog', { name: 'Вход в аккаунт' })).toBeInTheDocument()
    cleanup()
    desktop({ edition: 'owner', serverMode: true })
    await open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stays closed with a session', async () => {
    desktop({ status: { ...signedIn, nicknames: { pvp: 'shaurma' } } })
    await open()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('speaks English', async () => {
    desktop()
    const user = await open('en')
    const dialog = await screen.findByRole('dialog', { name: 'Sign in to your account' })
    expect(within(dialog).getByRole('tab', { name: 'Sign in' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('tab', { name: 'Sign up' }))
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'terms of the offer' })).toHaveAttribute('href', 'https://raidos.app/legal/offer')
    expect(screen.getByRole('button', { name: 'I have an invitation code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled()
    expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/)
  })

  it('the phone app registers through the web account client (sync/webAccount.ts)', async () => {
    const width = window.innerWidth
    Object.assign(window, { innerWidth: 390 })
    const token = 't'.repeat(43)
    const calls: Array<{ path: string; body: unknown; auth: string | null }> = []
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get('authorization') })
      if (url.pathname === '/health') return json(200, { ok: true })
      if (url.pathname === '/v1/accounts/auth-config') return json(200, { emailEnabled: true, smsEnabled: true })
      if (url.pathname === '/v1/accounts/register') return json(202, { pending: true, message: 'Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.', challengeId: CHALLENGE, expiresAt: '2026-10-01T10:10:00.000Z', resendSeconds: 60 })
      if (url.pathname === '/v1/accounts/register/confirm') return json(201, { token, referralApplied: false, account: { email: 'phone@example.com', kind: 'user' } })
      if (url.pathname === '/v1/accounts/me') return json(200, { email: 'phone@example.com', kind: 'user', nicknames: {}, subscription: { status: 'trial' } })
      if (url.pathname === '/v1/accounts/me/consents') return json(200, { consents: [] })
      return json(404, { error: 'Не найдено' })
    })
    try {
      const user = await open()
      await screen.findByRole('dialog', { name: 'Вход в аккаунт' })
      expect(screen.getByText(/Вход по QR-коду: в приложении на компьютере/)).toBeInTheDocument()
      await user.click(screen.getByRole('tab', { name: 'Регистрация' }))
      await user.type(screen.getByLabelText('E-mail'), 'phone@example.com')
      await user.type(screen.getByLabelText('Пароль'), 'correct horse')
      await user.type(screen.getByLabelText('Повторите пароль'), 'correct horse')
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
      await user.type(await screen.findByLabelText('Код из письма'), '654321')
      await user.click(screen.getByRole('button', { name: 'Подтвердить и войти' }))
      await expectStraightToTheApp()
      expect(calls.find((call) => call.path === '/v1/accounts/register')?.body).toEqual({ email: 'phone@example.com', password: 'correct horse' })
      expect(calls.find((call) => call.path === '/v1/accounts/register/confirm')?.body).toEqual({ challengeId: CHALLENGE, code: '654321' })
      await waitFor(() => expect(calls.find((call) => call.path === '/v1/accounts/me/consents')).toMatchObject({ body: { kind: 'registration', version: LEGAL_VERSION }, auth: `Bearer ${token}` }))
      expectNoPhoneUi()
    } finally {
      fetchMock.mockRestore()
      Object.assign(window, { innerWidth: width })
    }
  })

  it('accepts the same documents version as the website', () => {
    expect(LEGAL_VERSION).toBe(SITE_LEGAL_VERSION)
  })
})
