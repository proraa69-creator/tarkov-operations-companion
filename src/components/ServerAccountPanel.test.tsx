import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerAccountPanel } from './ServerAccountPanel'
import { OPEN_ACCOUNT_SIGN_IN_EVENT } from '../account/accountEvents'

const offline = { signedIn: false, online: false, serverUrl: 'http://127.0.0.1:8787', persistent: true }

function mockDesktop(status: unknown, shell: { edition?: 'owner' | 'client'; serverMode?: boolean } = {}) {
  const account = { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn(), openWebsite: vi.fn().mockResolvedValue(true) }
  Object.assign(window, { tarkovDesktop: { ...shell, serviceRequest: vi.fn().mockResolvedValue(null), account } })
  return account
}

describe('ServerAccountPanel', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

  it('shows "server unavailable" and keeps sign-in disabled while the server is down', async () => {
    // The server laptop (owner build, --server-mode) has no account window: registration opens the website.
    const account = mockDesktop(offline, { edition: 'owner', serverMode: true })
    render(<ServerAccountPanel />)
    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Регистрация на сайте' }))
    expect(account.openWebsite).toHaveBeenCalledWith('register')
  })

  it('registers in the app\'s account window where it exists (the «Регистрация» tab)', async () => {
    const account = mockDesktop(offline, { edition: 'owner' })
    const opened = vi.fn()
    window.addEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, opened)
    try {
      render(<ServerAccountPanel />)
      await userEvent.click(await screen.findByRole('button', { name: 'Зарегистрироваться' }))
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe('register')
      expect(account.openWebsite).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, opened)
    }
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

  it('only the owner\'s app can change the server address (the players\' app trusts only its built-in server)', async () => {
    const account = mockDesktop({ ...offline, online: true, serverUrl: 'https://raidos.app' }, { edition: 'client' })
    Object.assign(account, { setServerUrl: vi.fn() })
    const { unmount } = render(<ServerAccountPanel />)
    expect(await screen.findByText('Сервер доступен')).toBeInTheDocument()
    expect(screen.queryByLabelText('Адрес сервера')).not.toBeInTheDocument()
    unmount()
    const owner = mockDesktop({ ...offline, online: true, serverUrl: 'https://raidos.app' }, { edition: 'owner' })
    Object.assign(owner, { setServerUrl: vi.fn() })
    render(<ServerAccountPanel />)
    expect(await screen.findByLabelText('Адрес сервера')).toBeInTheDocument()
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
