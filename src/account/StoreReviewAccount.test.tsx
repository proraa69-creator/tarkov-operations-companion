import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hidesPayments, noteStoreReviewAccount } from '../platform'

// Owner, 12.11.2026, the Apple reviewer's test account: «там не должно быть не единого упоминания о платной подписке».
const status = { signedIn: true, online: true, email: 'appletest@example.com', kind: 'user' as const, subscription: { status: 'active' as const, paidUntil: '2027-11-12T00:00:00.000Z' }, storeReview: true as const, emailVerified: true, serverUrl: 'https://raidos.app', persistent: true }
vi.mock('../sync/serverSync', async (original) => ({ ...await original<typeof import('../sync/serverSync')>(), useServerAccount: () => ({ status, logout: vi.fn() }) }))
vi.mock('./useAccountNickname', () => ({ useAccountNickname: () => 'Reviewer' }))

const { ClientCabinetPanel } = await import('./ClientCabinetPanel')

afterEach(() => { cleanup(); noteStoreReviewAccount(false) })

describe('the reviewer\'s account outside the iPhone app', () => {
  it('names no subscription in «Личный кабинет»', () => {
    noteStoreReviewAccount(true)
    expect(hidesPayments()).toBe(true)
    render(<ClientCabinetPanel />)
    expect(screen.getByText('appletest@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/Подписк|Оформить|Активна до/)).not.toBeInTheDocument()
  })

  it('any other account still sees its subscription', () => {
    expect(hidesPayments()).toBe(false)
    render(<ClientCabinetPanel />)
    expect(screen.getByText('Подписка')).toBeInTheDocument()
  })
})
