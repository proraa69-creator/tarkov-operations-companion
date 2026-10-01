import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The website signs in by e-mail only: password, a code from the e-mail, or a QR code. Even when the server reports
 * SMS codes as switched on (auth-config → smsEnabled: true) and the account has a bound number, no phone or SMS
 * option is rendered on the login, registration, password reset and cabinet pages.
 */
const mocks = vi.hoisted(() => ({
  auth: { status: 'signed-out' as string, token: null as string | null, account: null as unknown },
}))

vi.mock('../auth', () => ({
  useAuth: () => ({ ...mocks.auth, error: null, reload: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn(), setAccount: vi.fn(), adopt: vi.fn() }),
}))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  const answers: Record<string, () => Promise<unknown>> = {
    // The server has both providers on: the site must still show e-mail only.
    authConfig: () => Promise.resolve({ smsEnabled: true, emailEnabled: true, codeLength: 6, codeTtlSeconds: 300, resendSeconds: 60, countries: ['7'] }),
  }
  // Everything else stays pending: these tests only look at what is rendered.
  const api = new Proxy({}, { get: (_target, key: string) => answers[key] ?? (() => new Promise(() => {})) })
  return { ...actual, api }
})

const { LoginPage } = await import('./LoginPage')
const { RegisterPage } = await import('./RegisterPage')
const { ResetPasswordPage } = await import('./ResetPasswordPage')
const { CabinetPage } = await import('./CabinetPage')

const PHONE_TEXT = /телефон|SMS|СМС|номер телефона/i

function expectNoPhoneUi() {
  expect(document.body.textContent ?? '').not.toMatch(PHONE_TEXT)
  expect(document.querySelector('input[type="tel"]')).toBeNull()
  expect(document.querySelector('input[autocomplete="tel"]')).toBeNull()
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('website: e-mail-only sign-in', () => {
  afterEach(() => { cleanup(); mocks.auth = { status: 'signed-out', token: null, account: null } })

  it('login offers password, e-mail code and QR — no SMS', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    expect(await screen.findByText('Войти по коду из письма')).toBeInTheDocument()
    expect(screen.getByText('Войти по QR-коду')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expectNoPhoneUi()
  })

  it('registration asks for e-mail and password only, with the consent checkbox', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    await settle()
    expect(screen.getByRole('heading', { name: 'Регистрация' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expectNoPhoneUi()
  })

  it('password reset goes by e-mail only', async () => {
    render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>)
    expect(await screen.findByText(/Мы пришлём на него код/)).toBeInTheDocument()
    expectNoPhoneUi()
  })

  it('the cabinet has no phone panel, even for an account with a bound number', async () => {
    mocks.auth = {
      status: 'ready',
      token: 'session-token',
      account: { id: 'a1', email: 'me@example.com', kind: 'user', createdAt: '2026-10-01T10:00:00.000Z', nicknames: {}, subscription: { status: 'trial' }, emailVerifiedAt: '2026-10-01T10:00:00.000Z', phone: { masked: '+7 ••• •••-45-67', verifiedAt: '2026-10-01T10:00:00.000Z' } },
    }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    await settle()
    expect(screen.getByRole('heading', { name: 'me@example.com' })).toBeInTheDocument()
    expect(screen.getByText('Сменить пароль', { selector: 'button' })).toBeInTheDocument()
    expectNoPhoneUi()
  })
})
