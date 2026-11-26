import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../api'

/**
 * «Срок скрыт» (owner, 27.11.2026, about a streamer: «Сделай ему на год. Но в личном кабинете… пусть пишется у него подписка
 * активна… не надо писать, сколько у него осталось… Когда срок выйдет, у него уже будет срок подписки вышел»): the server sends an
 * active subscription without its end; the cabinet says «Активна» and names no date, no «навсегда».
 */
const mocks = vi.hoisted(() => ({ account: null as unknown }))

vi.mock('../auth', () => ({
  useAuth: () => ({ status: 'ready', token: 'session-token', account: mocks.account, error: null, reload: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn(), confirmRegistration: vi.fn(), setAccount: vi.fn() }),
}))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  // Everything stays pending: these tests only look at the subscription's words.
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) })
  return { ...actual, api }
})

const { CabinetPage } = await import('./CabinetPage')

const base: Account = { email: 'streamer@example.com', kind: 'streamer', referralCode: 'HUNTER', createdAt: '2026-11-15T10:00:00.000Z', nicknames: {}, country: 'RU', emailVerifiedAt: '2026-11-15T10:00:00.000Z', subscription: { status: 'inactive' } }
const subscriptionPanel = () => screen.getByRole('region', { name: 'Подписка' })

afterEach(() => { cleanup() })

describe('the cabinet: a term hidden from the player', () => {
  it('says «Активна» with no date and no «навсегда»', () => {
    mocks.account = { ...base, subscription: { status: 'active', termHidden: true } }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const panel = subscriptionPanel()
    expect(within(panel).getAllByText('Активна').length).toBeGreaterThan(0)
    expect(panel).not.toHaveTextContent(/Активна до|\d{2}\.\d{2}\.\d{4}|навсегда/)
  })

  it('once the days are over: «Не активна», as anyone whose subscription ended', () => {
    mocks.account = { ...base, subscription: { status: 'inactive' } }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    expect(within(subscriptionPanel()).getAllByText('Не активна').length).toBeGreaterThan(0)
    expect(subscriptionPanel()).not.toHaveTextContent(/навсегда/)
  })

  it('a dated subscription keeps its date', () => {
    mocks.account = { ...base, kind: 'user', referralCode: undefined, subscription: { status: 'active', paidUntil: '2027-12-24T15:16:00.000Z' } }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    expect(subscriptionPanel()).toHaveTextContent(/Активна до .*2027/)
  })
})
