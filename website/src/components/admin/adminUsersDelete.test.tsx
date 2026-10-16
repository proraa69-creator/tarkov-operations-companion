import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AdminUser, type AdminUserDetail } from '../../api'

/** «Пользователи» → «Действия» → «Удалить аккаунт» (owner, 13.10.2026): the e-mail typed to confirm, then gone from the list. */
const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), remove: vi.fn(), devices: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminUsers: mocks.users, adminUser: mocks.user, adminDeleteUser: mocks.remove, adminDevices: mocks.devices } }
})

const { AdminUsers } = await import('./AdminUsers')

const user = (email: string, owner = false): AdminUser => ({
  id: (owner ? 'b' : 'a').repeat(24), email, kind: 'user', createdAt: '2026-10-13T10:00:00.000Z', ...(owner ? { owner: true as const } : {}),
  subscription: { status: 'inactive' }, autopay: null, payments: { count: 0, total: 0 },
})
const player = user('player@mail.ru')
const detail = (target: AdminUser): AdminUserDetail => ({ user: target, payments: [], grants: [] })

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(mocks)) mock.mockReset() })

async function openCard(target: AdminUser) {
  mocks.users.mockResolvedValue({ users: [target], total: 1 })
  mocks.user.mockResolvedValue(detail(target))
  mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
  render(<AdminUsers />)
  fireEvent.click(await screen.findByRole('button', { name: /Действия/ }))
  return screen.findByRole('button', { name: /Удалить аккаунт/ })
}

describe('admin users: «Удалить аккаунт»', () => {
  it('deletes after the e-mail is typed, then the card closes and the list is read again', async () => {
    const button = await openCard(player)
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(' Player@Mail.ru ')
    mocks.remove.mockResolvedValue({ deleted: true })
    mocks.users.mockResolvedValue({ users: [], total: 0 })
    fireEvent.click(button)
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('player@mail.ru'))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('owner-token', player.id))
    expect(await screen.findByText('Никого не нашли.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Удалить аккаунт/ })).toBeNull()
  })

  it('a wrong e-mail deletes nothing and says so; cancelling deletes nothing', async () => {
    const button = await openCard(player)
    vi.spyOn(window, 'prompt').mockReturnValueOnce('someone@mail.ru').mockReturnValueOnce(null)
    fireEvent.click(button)
    expect(await screen.findByText('E-mail не совпал — аккаунт не удалён.')).toBeInTheDocument()
    fireEvent.click(button)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('the server\'s refusal is shown (an active autopay first has to be cancelled)', async () => {
    const button = await openCard(player)
    vi.spyOn(window, 'prompt').mockReturnValue('player@mail.ru')
    mocks.remove.mockRejectedValue(new ApiError(409, 'Сначала отмените автопродление — кнопка «Отменить автопродление» выше'))
    fireEvent.click(button)
    expect(await screen.findByText(/Сначала отмените автопродление/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Удалить аккаунт/ })).toBeEnabled()
  })

  it('the owner\'s own account cannot be deleted', async () => {
    const button = await openCard(user('owner@mail.ru', true))
    expect(button).toBeDisabled()
    expect(screen.getByText('Аккаунт владельца заблокировать и удалить нельзя.')).toBeInTheDocument()
  })
})
