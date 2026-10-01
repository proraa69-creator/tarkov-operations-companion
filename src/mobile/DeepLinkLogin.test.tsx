import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setRenderLanguage } from '../i18n/renderText'
import { API_URL_STORAGE_KEY, apiBaseUrl } from '../sync/webAccount'

const launch = vi.hoisted(() => ({ url: '' }))
const redeem = vi.hoisted(() => vi.fn())
vi.mock('@capacitor/app', () => ({ App: { getLaunchUrl: async () => ({ url: launch.url }), addListener: async () => ({ remove: () => {} }) } }))
vi.mock('../platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../platform')>()), isNative: () => true }))
vi.mock('../sync/serverSync', () => ({ useServerAccount: () => ({ status: { signedIn: false } }), refreshServerStatus: vi.fn(), cleanIpcError: (reason: unknown) => String(reason) }))
vi.mock('../sync/webAccount', async (importOriginal) => ({ ...(await importOriginal<typeof import('../sync/webAccount')>()), webAccountRedeemLoginCode: redeem }))

const { DeepLinkLogin } = await import('./DeepLinkLogin')
const CODE = 'a'.repeat(21) + 'B_-' + '9'.repeat(19)
const link = (server?: string) => `tarkovoperator://login?code=${CODE}${server ? `&server=${encodeURIComponent(server)}` : ''}`

describe('QR sign-in link with a server (mobile/DeepLinkLogin.tsx)', () => {
  beforeEach(() => { localStorage.clear(); redeem.mockReset().mockResolvedValue({ email: 'player@example.com' }) })
  afterEach(() => setRenderLanguage('ru'))

  it('goes straight to sign-in for the built-in server, the current one, or no server in the link', async () => {
    for (const server of ['https://raidos.app', undefined]) {
      launch.url = link(server)
      const { unmount } = render(<DeepLinkLogin />)
      expect(await screen.findByRole('heading', { name: 'Войти в аккаунт?' })).toBeInTheDocument()
      expect(screen.queryByText('Незнакомый сервер')).toBeNull()
      unmount()
    }
    localStorage.setItem(API_URL_STORAGE_KEY, 'http://192.168.1.20:8787')
    launch.url = link('http://192.168.1.20:8787')
    render(<DeepLinkLogin />)
    expect(await screen.findByRole('heading', { name: 'Войти в аккаунт?' })).toBeInTheDocument()
  })

  it('asks first for any other server, shows its host large, and «Отмена» is the default', async () => {
    launch.url = link('https://evil.example')
    const user = userEvent.setup()
    render(<DeepLinkLogin />)
    expect(await screen.findByRole('heading', { name: 'Незнакомый сервер' })).toBeInTheDocument()
    expect(screen.getByText('evil.example')).toHaveClass('account-server-host')
    expect(screen.getByRole('alert')).toHaveTextContent('Подключайтесь, только если это ваш сервер')
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Войти' })).toBeNull()
    await user.keyboard('{Enter}') // the default action
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apiBaseUrl()).toBe('https://raidos.app')
    expect(redeem).not.toHaveBeenCalled()
  })

  it('signs in to the other server only after «Подключиться к этому серверу»', async () => {
    launch.url = link('https://friend.example:8443')
    const user = userEvent.setup()
    render(<DeepLinkLogin />)
    await user.click(await screen.findByRole('button', { name: 'Подключиться к этому серверу' }))
    expect(screen.getByRole('heading', { name: 'Войти в аккаунт?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(redeem).toHaveBeenCalledWith(CODE)
    expect(await screen.findByText('player@example.com')).toBeInTheDocument()
    expect(apiBaseUrl()).toBe('https://friend.example:8443')
  })

  it('is translated to English', async () => {
    setRenderLanguage('en')
    launch.url = link('https://evil.example')
    render(<DeepLinkLogin />)
    expect(await screen.findByRole('heading', { name: 'Unknown server' })).toBeInTheDocument()
    expect(screen.getByText('The sign-in link leads to a server this app does not know:')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Connect only if this is your own server.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Connect to this server' })).toBeInTheDocument()
  })
})
