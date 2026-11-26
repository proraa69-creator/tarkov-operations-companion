import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser, AdminUserDetail } from '../../api'

/**
 * «Пользователи» → «Действия» → «Срок скрыт от игрока» (owner, 27.11.2026, about a streamer: «Сделай ему на год. Но в личном
 * кабинете… пусть пишется у него подписка активна… не надо писать, сколько у него осталось»).
 */
const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), termHidden: vi.fn(), devices: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminUsers: mocks.users, adminUser: mocks.user, adminTermHidden: mocks.termHidden, adminDevices: mocks.devices } }
})

const { AdminUsers } = await import('./AdminUsers')

const streamer: AdminUser = {
  id: 'b'.repeat(24), email: 'streamer@example.com', kind: 'streamer', referralCode: 'HUNTER', createdAt: '2026-11-15T06:46:56.000Z',
  subscription: { status: 'active', lifetime: true }, autopay: null, payments: { count: 1, total: 300 },
}
const detail = (target: AdminUser): AdminUserDetail => ({ user: target, payments: [], grants: [] })

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(mocks)) mock.mockReset() })

async function openCard(target: AdminUser) {
  mocks.users.mockResolvedValue({ users: [target], total: 1 })
  mocks.user.mockResolvedValue(detail(target))
  mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
  render(<AdminUsers />)
  fireEvent.click(await screen.findByRole('button', { name: /Действия/ }))
}

describe('admin users: «Срок скрыт от игрока»', () => {
  it('a lifetime streamer: the hint says what changes, the button hides the term and the owner still sees the date', async () => {
    mocks.termHidden.mockResolvedValue(detail({ ...streamer, subscription: { status: 'active', paidUntil: '2027-12-24T15:16:00.000Z', termHidden: true } }))
    await openCard(streamer)
    expect(await screen.findByText(/Стример сейчас бесплатно навсегда/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть срок' }))
    await waitFor(() => expect(mocks.termHidden).toHaveBeenCalledWith('owner-token', 'b'.repeat(24), true))
    expect(await screen.findByText('Срок теперь скрыт')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Показать срок' })).toBeInTheDocument()
  })

  it('shown again: the term back in view', async () => {
    const hidden: AdminUser = { ...streamer, subscription: { status: 'active', paidUntil: '2027-12-24T15:16:00.000Z', termHidden: true } }
    mocks.termHidden.mockResolvedValue(detail(streamer))
    await openCard(hidden)
    expect(await screen.findByText(/только «Активна», без даты/)).toBeInTheDocument()
    // the owner's list names the end and that it is hidden
    expect(screen.getAllByText(/· срок скрыт/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Показать срок' }))
    await waitFor(() => expect(mocks.termHidden).toHaveBeenCalledWith('owner-token', 'b'.repeat(24), false))
    expect(await screen.findByText('Срок снова виден игроку')).toBeInTheDocument()
  })
})
