import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser, AdminUserDetail } from '../../api'

/** «Пользователи» → «Действия»: the bound Escape from Tarkov account and «Отвязать» (owner, 13.10.2026). */
const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), unbind: vi.fn(), devices: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminUsers: mocks.users, adminUser: mocks.user, adminUnbindEft: mocks.unbind, adminDevices: mocks.devices } }
})

const { AdminUsers } = await import('./AdminUsers')

const player: AdminUser = {
  id: 'a'.repeat(24), email: 'player@mail.ru', kind: 'user', createdAt: '2026-10-13T10:00:00.000Z',
  subscription: { status: 'trial', trialEndsAt: '2026-10-14T10:00:00.000Z' }, autopay: null, payments: { count: 0, total: 0 },
  eftAccount: { masked: '••••321', boundAt: '2026-10-13T10:05:00.000Z' },
}
const detail = (user: AdminUser): AdminUserDetail => ({ user, payments: [], grants: [] })

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(mocks)) mock.mockReset() })

describe('admin users: the Escape from Tarkov account', () => {
  it('shows the bound game account masked and frees it after a confirmation', async () => {
    mocks.users.mockResolvedValue({ users: [player], total: 1 })
    mocks.user.mockResolvedValue(detail(player))
    mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
    const { eftAccount: _bound, ...unbound } = player
    void _bound
    mocks.unbind.mockResolvedValue(detail(unbound))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminUsers />)
    fireEvent.click(await screen.findByRole('button', { name: /Действия/ }))
    expect(await screen.findByText('Аккаунт Escape from Tarkov')).toBeInTheDocument()
    expect(screen.getByText('••••321')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Отвязать/ }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('••••321'))
    await waitFor(() => expect(mocks.unbind).toHaveBeenCalledWith('owner-token', player.id))
    expect(await screen.findByText('Аккаунт Escape from Tarkov отвязан')).toBeInTheDocument()
    expect(screen.getByText(/Не привязан: приложение для Windows привяжет аккаунт игры из логов при входе/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Отвязать/ })).toBeNull()
  })

  it('nothing is sent when the owner cancels', async () => {
    mocks.users.mockResolvedValue({ users: [player], total: 1 })
    mocks.user.mockResolvedValue(detail(player))
    mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<AdminUsers />)
    fireEvent.click(await screen.findByRole('button', { name: /Действия/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Отвязать/ }))
    expect(mocks.unbind).not.toHaveBeenCalled()
  })
})
