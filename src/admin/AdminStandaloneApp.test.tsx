import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerAccountStatus } from '../electron.d'

const mocks = vi.hoisted(() => ({
  stored: null as string | null,
  status: vi.fn<() => Promise<ServerAccountStatus>>(),
}))
vi.mock('../sync/webAccount', () => ({
  webStoredSessionEmail: () => mocks.stored,
  webAdminAccountStatus: mocks.status,
  webAdminAccountLogin: vi.fn(),
  webAdminAccountLogout: vi.fn(async () => ({ signedIn: false, online: true, persistent: true, serverUrl: 'https://raidos.app' })),
}))
vi.mock('./AdminMobilePage', () => ({ AdminMobilePage: () => <div>Панель владельца</div> }))
vi.mock('./useAdminNotifications', () => ({ useAdminNotifications: () => undefined }))

const { AdminStandaloneApp } = await import('./AdminStandaloneApp')
const OWNER = 'proraa69@gmail.com'
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mocks.stored = null
  mocks.status.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

// Owner, 30.10.2026: «я должен нажать на приложение и у меня сразу открылось все. без входа».
describe('the iPhone admin app', () => {
  it('with the owner\'s session kept on the phone the panel opens at once, even without the server; it keeps asking', async () => {
    mocks.stored = OWNER
    localStorage.setItem('raidos.admin.confirmedOwner', OWNER)
    mocks.status.mockResolvedValue({ signedIn: true, email: OWNER, online: false, persistent: true, serverUrl: 'https://raidos.app' })
    render(<AdminStandaloneApp />)
    expect(screen.getByText('Панель владельца')).toBeInTheDocument()
    await flush()
    expect(screen.getByText('Панель владельца')).toBeInTheDocument()
    expect(screen.queryByText('Доступ закрыт')).toBeNull()
    expect(screen.getByText('Нет связи — повторяем')).toBeInTheDocument()
    // Asked again after 5 s; the server answers now.
    mocks.status.mockResolvedValue({ signedIn: true, email: OWNER, owner: true, online: true, persistent: true, serverUrl: 'https://raidos.app' })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(mocks.status).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Сервер подключён')).toBeInTheDocument()
  })

  it('only the server\'s own answer signs out: an ended session shows the sign-in', async () => {
    mocks.stored = OWNER
    localStorage.setItem('raidos.admin.confirmedOwner', OWNER)
    mocks.status.mockResolvedValue({ signedIn: false, online: true, persistent: true, serverUrl: 'https://raidos.app' })
    render(<AdminStandaloneApp />)
    await flush()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
    expect(localStorage.getItem('raidos.admin.confirmedOwner')).toBeNull()
  })

  it('the first start without a confirmed owner waits for the server instead of saying «Доступ закрыт»', async () => {
    mocks.stored = OWNER
    mocks.status.mockResolvedValue({ signedIn: true, email: OWNER, online: false, persistent: true, serverUrl: 'https://raidos.app' })
    render(<AdminStandaloneApp />)
    await flush()
    expect(screen.queryByText('Доступ закрыт')).toBeNull()
    expect(screen.getByText('Подключаемся к серверу Raid OS')).toBeInTheDocument()
    mocks.status.mockResolvedValue({ signedIn: true, email: OWNER, owner: true, online: true, persistent: true, serverUrl: 'https://raidos.app' })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByText('Панель владельца')).toBeInTheDocument()
    expect(localStorage.getItem('raidos.admin.confirmedOwner')).toBe(OWNER)
  })
})
