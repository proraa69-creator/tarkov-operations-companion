import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), approve: vi.fn() }))
vi.mock('../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'session-token', account: { email: 'me@example.com' } }) }))
vi.mock('../qrLogin', async (original) => ({ ...await original<typeof import('../qrLogin')>(), qrLogin: { inspect: mocks.inspect, approve: mocks.approve } }))
const { AppLoginPage } = await import('./AppLoginPage')

const requester = { createdAt: '2026-10-01T10:00:00.000Z', agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140', ip: '203.0.113.x', country: 'NL' }

describe('/app-login#approve=… (approve a browser sign-in on this phone)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/app-login#approve=K7QX-M2PD')
    mocks.inspect.mockResolvedValue(requester)
    mocks.approve.mockResolvedValue(undefined)
  })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('shows who / where / when, warns, and never approves with one click', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AppLoginPage /></MemoryRouter>)
    expect(await screen.findByText(/Откуда:/)).toHaveTextContent('Откуда: Нидерланды · IP 203.0.113.x')
    expect(screen.getByText(/Вход запрашивает:/)).toHaveTextContent('Chrome · Windows')
    expect(screen.getByText(/Аккаунт:/)).toHaveTextContent('me@example.com')
    expect(screen.getByText(/Никогда не подтверждайте вход по ссылке, которую вам прислали/)).toBeInTheDocument()
    // The link's code is never shown: it has to come from the screen the person is signing in on.
    expect(document.body.textContent).not.toContain('K7QX')
    expect(mocks.inspect).toHaveBeenCalledWith('session-token', 'K7QX-M2PD')

    const confirm = screen.getByRole('button', { name: 'Подтвердить' })
    expect(confirm).toBeDisabled()
    const input = screen.getByLabelText('Код с экрана, на котором вы входите')
    await user.type(input, 'AAAA-BBBB')
    expect(screen.getByText(/Код не совпадает/)).toBeInTheDocument()
    expect(confirm).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(mocks.approve).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'k7qx m2pd')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith('session-token', 'K7QX-M2PD'))
    expect(await screen.findByText('Браузер вошёл в ваш аккаунт. Эту страницу можно закрыть.')).toBeInTheDocument()
  })
})
