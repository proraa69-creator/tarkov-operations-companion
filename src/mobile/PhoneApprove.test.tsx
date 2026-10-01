import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const launch = vi.hoisted(() => ({ url: '' }))
const request = vi.hoisted(() => vi.fn())
vi.mock('@capacitor/app', () => ({ App: { getLaunchUrl: async () => ({ url: launch.url }), addListener: async () => ({ remove: () => {} }) } }))
vi.mock('../platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../platform')>()), isNative: () => true }))
vi.mock('../sync/serverSync', () => ({ useServerAccount: () => ({ status: { signedIn: true, email: 'player@example.com' } }), refreshServerStatus: vi.fn(), cleanIpcError: (reason: unknown) => String(reason) }))
vi.mock('../sync/webAccount', async (importOriginal) => ({ ...(await importOriginal<typeof import('../sync/webAccount')>()), webServiceRequest: request }))

const { DeepLinkLogin } = await import('./DeepLinkLogin')

describe('phone approves a website QR sign-in (mobile/DeepLinkLogin.tsx)', () => {
  beforeEach(() => {
    localStorage.clear()
    request.mockReset().mockImplementation(async (_method: string, path: string) => path.endsWith('/inspect')
      ? { agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', createdAt: new Date().toISOString(), ip: '203.0.113.x', country: 'NL' }
      : { ok: true })
    launch.url = 'tarkovoperator://approve?code=K7QX-M2PD&server=https%3A%2F%2Fraidos.app'
  })

  it('shows who asks and from where, does not show the code, and approves only after the code from the other screen is typed', async () => {
    const user = userEvent.setup()
    render(<DeepLinkLogin />)
    expect(await screen.findByText('Chrome · Windows')).toBeInTheDocument()
    expect(screen.getByText(/IP 203\.0\.113\.x/)).toBeInTheDocument()
    expect(screen.queryByText(/K7QX-M2PD/)).toBeNull()
    const approve = screen.getByRole('button', { name: 'Разрешить вход' })
    expect(approve).toBeDisabled()
    const input = screen.getByPlaceholderText('XXXX-XXXX')
    await user.type(input, 'AAAA-AAAA')
    expect(screen.getByRole('alert')).toHaveTextContent('Код не совпадает')
    expect(approve).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'k7qx m2pd')
    expect(approve).toBeEnabled()
    await user.click(approve)
    expect(request).toHaveBeenLastCalledWith('POST', '/v1/accounts/me/qr-login/approve', { code: 'K7QX-M2PD' })
    expect(await screen.findByText('Готово: браузер вошёл в ваш аккаунт.')).toBeInTheDocument()
  })
})
