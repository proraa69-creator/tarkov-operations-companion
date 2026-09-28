import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerAccountPanel } from './ServerAccountPanel'

const offline = { signedIn: false, online: false, serverUrl: 'http://127.0.0.1:8787', persistent: true }

function mockDesktop(status: unknown) {
  const account = { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn(), openWebsite: vi.fn().mockResolvedValue(true) }
  Object.assign(window, { tarkovDesktop: { serviceRequest: vi.fn().mockResolvedValue(null), account } })
  return account
}

describe('ServerAccountPanel', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

  it('shows "server unavailable" and keeps sign-in disabled while the server is down', async () => {
    const account = mockDesktop(offline)
    render(<ServerAccountPanel />)
    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Регистрация на сайте' }))
    expect(account.openWebsite).toHaveBeenCalledWith('register')
  })

  it('signs in through the main process and never keeps the password', async () => {
    const account = mockDesktop({ ...offline, online: true })
    account.login.mockResolvedValue({ signedIn: true, email: 'a@example.com', kind: 'user', online: true, serverUrl: 'http://127.0.0.1:8787', persistent: true })
    const user = userEvent.setup()
    render(<ServerAccountPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled())
    await user.type(screen.getByLabelText('E-mail'), 'a@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(account.login).toHaveBeenCalledWith('a@example.com', 'correct horse')
    expect(await screen.findByText('a@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
    expect(JSON.stringify(localStorage)).not.toContain('correct horse')
  })

  it('shows the main-process error without the IPC prefix', async () => {
    const account = mockDesktop({ ...offline, online: true })
    account.login.mockRejectedValue(new Error("Error invoking remote method 'account:login': Error: Неверный e-mail или пароль"))
    const user = userEvent.setup()
    render(<ServerAccountPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled())
    await user.type(screen.getByLabelText('E-mail'), 'a@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный e-mail или пароль')
  })
})
