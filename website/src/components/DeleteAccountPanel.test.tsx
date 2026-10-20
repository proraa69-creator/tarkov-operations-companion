import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../api'

/** Cabinet: «Удалить аккаунт» — the server deletes the account 10 days later (owner, 20.10.2026). */
const mocks = vi.hoisted(() => ({
  account: null as unknown as Account,
  setAccount: vi.fn(),
  deleteAccount: vi.fn(),
  cancelAccountDeletion: vi.fn(),
}))

vi.mock('../auth', () => ({ useAuth: () => ({ token: 'session-token', account: mocks.account, setAccount: mocks.setAccount }) }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, deleteAccount: mocks.deleteAccount, cancelAccountDeletion: mocks.cancelAccountDeletion } }
})

const { DeleteAccountPanel } = await import('./DeleteAccountPanel')

const account = (extra: Partial<Account> = {}) => ({ email: 'player@example.com', kind: 'user', createdAt: '2026-10-01T00:00:00Z', nicknames: {}, subscription: { status: 'inactive' }, ...extra }) as Account

describe('DeleteAccountPanel', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('names the 10 days only after «Удалить аккаунт» is pressed; the account stays signed in', async () => {
    mocks.account = account()
    const scheduled = account({ deletionAt: '2026-10-30T12:00:00.000Z' })
    mocks.deleteAccount.mockResolvedValue({ scheduled: true, deletionAt: '2026-10-30T12:00:00.000Z', account: scheduled })
    render(<DeleteAccountPanel />)
    expect(document.body).not.toHaveTextContent(/10 дней/)
    fireEvent.click(screen.getByRole('button', { name: /Удалить аккаунт/ }))
    const dialog = screen.getByRole('dialog', { name: 'Удалить аккаунт?' })
    expect(dialog).toHaveTextContent('player@example.com')
    expect(dialog).not.toHaveTextContent(/10 дней|сразу/)
    fireEvent.change(within(dialog).getByLabelText('Пароль для подтверждения'), { target: { value: 'secret-pass' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Удалить аккаунт/ }))
    expect(await screen.findByRole('dialog', { name: 'Удаление запланировано' })).toHaveTextContent('Аккаунт будет удалён через 10 дней — 30 октября 2026')
    expect(mocks.deleteAccount).toHaveBeenCalledWith('session-token', 'secret-pass')
    expect(mocks.setAccount).toHaveBeenCalledWith(scheduled)
  })

  it('a scheduled deletion shows its date and «Отменить удаление»', async () => {
    mocks.account = account({ deletionAt: '2026-10-30T12:00:00.000Z' })
    mocks.cancelAccountDeletion.mockResolvedValue({ account: account() })
    render(<DeleteAccountPanel />)
    expect(screen.getByText('Аккаунт будет удалён 30 октября 2026 г.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Отменить удаление/ }))
    await waitFor(() => expect(mocks.setAccount).toHaveBeenCalledWith(account()))
    expect(mocks.cancelAccountDeletion).toHaveBeenCalledWith('session-token')
  })
})
