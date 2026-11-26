import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser, AdminUserDetail } from '../../api'

/**
 * «Пользователи» → «Действия» → «Новый пароль» (owner, 26.11.2026: «кнопка новый пароль, я отправляю её и человек может
 * перейти и создать новый пароль; при нажатии копируется ссылка для человека»).
 */
const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), link: vi.fn(), devices: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminUsers: mocks.users, adminUser: mocks.user, adminPasswordLink: mocks.link, adminDevices: mocks.devices } }
})

const { AdminUsers } = await import('./AdminUsers')

const user = (email: string, extra: Partial<AdminUser> = {}): AdminUser => ({
  id: 'a'.repeat(24), email, kind: 'user', createdAt: '2026-11-15T06:46:56.000Z',
  subscription: { status: 'inactive' }, autopay: null, payments: { count: 0, total: 0 }, ...extra,
})
const detail = (target: AdminUser): AdminUserDetail => ({ user: target, payments: [], grants: [] })
const LINK = `https://raidos.app/reset#link=${'Ab3_-'.repeat(6)}Zz.042137`

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(mocks)) mock.mockReset() })

async function openCard(target: AdminUser) {
  mocks.users.mockResolvedValue({ users: [target], total: 1 })
  mocks.user.mockResolvedValue(detail(target))
  mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
  render(<AdminUsers />)
  fireEvent.click(await screen.findByRole('button', { name: /Действия/ }))
  return screen.findByRole('button', { name: /Новый пароль/ })
}

describe('admin users: «Новый пароль»', () => {
  it('makes a link, copies it and shows it with the date it works until', async () => {
    const writeText = vi.fn(async () => {})
    clipboard(writeText)
    mocks.link.mockResolvedValue({ url: LINK, expiresAt: '2026-11-28T10:00:00.000Z' })
    fireEvent.click(await openCard(user('player@example.com')))
    await waitFor(() => expect(mocks.link).toHaveBeenCalledWith('owner-token', 'a'.repeat(24)))
    expect(await screen.findByText(/^Ссылка скопирована: действует до/)).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(LINK)
    expect(screen.getByLabelText('Ссылка на новый пароль')).toHaveValue(LINK)
  })

  it('a closed clipboard: the link stays on the screen to copy by hand', async () => {
    clipboard(async () => { throw new Error('denied') })
    mocks.link.mockResolvedValue({ url: LINK, expiresAt: '2026-11-28T10:00:00.000Z' })
    fireEvent.click(await openCard(user('player@example.com')))
    expect(await screen.findByText(/^Скопируйте ссылку ниже: действует до/)).toBeInTheDocument()
    expect(screen.getByLabelText('Ссылка на новый пароль')).toHaveValue(LINK)
  })

  it('not for the owner\'s own account, nor for a blocked one', async () => {
    expect(await openCard(user('owner@example.com', { owner: true }))).toBeDisabled()
    cleanup()
    expect(await openCard(user('blocked@example.com', { blockedAt: '2026-11-20T10:00:00.000Z' }))).toBeDisabled()
  })
})
