import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The owner's sign-in on the website (owner, 27.11.2026: «После верного пароля на почту владельца приходит код, без кода
 * входа нет»): the server answers the right password with 202 { secondFactor }; the page asks the code from the e-mail
 * and only POST /login/confirm gives this browser a session.
 */
const mocks = vi.hoisted(() => ({ login: vi.fn(), loginConfirm: vi.fn(), loginResend: vi.fn() }))

vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  const answers: Record<string, unknown> = {
    authConfig: () => Promise.resolve({ smsEnabled: false, emailEnabled: true, codeLength: 6, codeTtlSeconds: 600, resendSeconds: 60, countries: [] }),
    login: mocks.login, loginConfirm: mocks.loginConfirm, loginResend: mocks.loginResend,
  }
  const api = new Proxy({}, { get: (_target, key: string) => answers[key] ?? (() => new Promise(() => {})) })
  return { ...actual, api }
})

const { AuthProvider } = await import('../auth')
const { LoginPage } = await import('./LoginPage')
const { ApiError } = await import('../api')

const OWNER = 'owner@example.com'
const CHALLENGE = 'c'.repeat(32)
const PENDING = { secondFactor: true, message: 'Мы отправили код на почту. Введите его, чтобы войти.', challengeId: CHALLENGE, expiresAt: '2026-11-27T10:10:00.000Z', resendSeconds: 60 }

function open() {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cabinet" element={<p>cabinet</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
async function passwordStep() {
  type('E-mail', OWNER)
  type(/^Пароль/, 'correct horse battery')
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  return screen.findByText('Мы отправили код на e-mail')
}

describe('website: the owner\'s code from the e-mail after his password', () => {
  afterEach(() => { cleanup(); localStorage.clear(); for (const mock of Object.values(mocks)) mock.mockReset() })

  it('asks the code, then signs this browser in with it', async () => {
    mocks.login.mockResolvedValue(PENDING)
    mocks.loginConfirm.mockResolvedValue({ token: 'owner-session', account: { email: OWNER, kind: 'user', owner: true } })
    open()
    await passwordStep()
    expect(screen.getByText(OWNER)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Пароль/)).toBeNull()
    expect(screen.getByRole('button', { name: /Отправить код ещё раз через \d+ с/ })).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'Войти' })
    expect(submit).toBeDisabled()
    type(/^Код из письма/, '12 34-56')
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('cabinet')).toBeInTheDocument()
    expect(mocks.login).toHaveBeenCalledWith(OWNER, 'correct horse battery')
    expect(mocks.loginConfirm).toHaveBeenCalledWith(CHALLENGE, '123456')
  })

  it('a wrong code says so and keeps the step; «Изменить e-mail» goes back to the password', async () => {
    mocks.login.mockResolvedValue(PENDING)
    mocks.loginConfirm.mockRejectedValue(new ApiError(401, 'Неверный или устаревший код. Проверьте код или запросите новый.'))
    open()
    await passwordStep()
    type(/^Код из письма/, '000000')
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('Неверный или устаревший код. Проверьте код или запросите новый.')).toBeInTheDocument()
    expect(screen.queryByText('cabinet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Изменить e-mail' }))
    expect(screen.getByLabelText(/^Пароль/)).toBeInTheDocument()
  })

  it('a player signs in at once, as before', async () => {
    mocks.login.mockResolvedValue({ token: 'player-session', account: { email: 'player@example.com', kind: 'user' } })
    open()
    type('E-mail', 'player@example.com')
    type(/^Пароль/, 'correct horse battery')
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('cabinet')).toBeInTheDocument()
    expect(mocks.loginConfirm).not.toHaveBeenCalled()
  })
})
