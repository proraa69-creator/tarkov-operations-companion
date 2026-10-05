import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * No payment service is connected: the cabinet shows the subscription status and «Оплата пока не подключена», without
 * plans, «Оплатить» or autopayment controls, and still lists earlier payments. The owner's log shows a generic label
 * for actions this version no longer knows.
 */
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  answers: {} as Record<string, unknown>,
}))

vi.mock('../auth', () => ({
  useAuth: () => ({
    status: 'ready', token: 'session-token', error: null,
    account: { email: 'me@example.com', kind: 'user', createdAt: '2026-10-01T10:00:00.000Z', nicknames: {}, subscription: { status: 'active', paidUntil: '2026-12-01T10:00:00.000Z' }, emailVerifiedAt: '2026-10-01T10:00:00.000Z' },
    reload: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn(), setAccount: vi.fn(), adopt: vi.fn(),
  }),
}))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  const api = new Proxy({}, {
    get: (_target, key: string) => () => {
      mocks.calls.push(key)
      return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : new Promise(() => {})
    },
  })
  return { ...actual, api }
})

const { CabinetPage } = await import('./CabinetPage')
const { AdminAudit } = await import('../components/admin/AdminSales')

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('website without a payment service', () => {
  afterEach(() => { cleanup(); mocks.calls = []; mocks.answers = {} })

  it('the cabinet shows the status and «Оплата пока не подключена», no plans or autopayment', async () => {
    mocks.answers.payments = {
      payments: [
        { id: 'p1', plan: '1m', amount: 299, currency: 'RUB', status: 'succeeded', createdAt: '2026-09-01T10:00:00.000Z', paidAt: '2026-09-01T10:01:00.000Z', provider: 'yookassa' },
        { id: 'p2', plan: '3m', amount: 9.99, currency: 'USD', status: 'succeeded', createdAt: '2026-09-02T10:00:00.000Z', provider: 'lava' },
        { id: 'p3', plan: '6m', amount: 1500, currency: 'RUB', status: 'pending', createdAt: '2026-09-03T10:00:00.000Z', provider: 'someservice' },
      ],
    }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    await settle()
    expect(screen.getByText(/^Активна до/)).toBeInTheDocument()
    expect(screen.getByText('Оплата пока не подключена.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Оплатить/ })).toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/автопродл|автоплат|Lava\.top \(|Россия и СНГ|Другие страны/i)
    expect(mocks.calls).not.toContain('plans')
    // Earlier payments keep the name of their payment service.
    expect(screen.getByText(/1 мес\. · ЮKassa/)).toBeInTheDocument()
    expect(screen.getByText(/3 мес\. · Lava\.top/)).toBeInTheDocument()
    expect(screen.getByText(/6 мес\. · someservice/)).toBeInTheDocument()
  })

  it('the owner log shows a generic label for removed actions', async () => {
    mocks.answers.adminAudit = {
      total: 2,
      entries: [
        { id: 2, at: '2026-10-02T10:00:00.000Z', actor: 'owner@example.com', action: 'autopay.cancel', target: 'user@example.com' },
        { id: 1, at: '2026-10-01T10:00:00.000Z', actor: 'owner@example.com', action: 'subscription.grant', target: 'user@example.com', details: { days: 30 } },
      ],
    }
    render(<MemoryRouter><AdminAudit /></MemoryRouter>)
    expect(await screen.findByText('Выдана подписка')).toBeInTheDocument()
    expect(screen.getByText('Прочее действие')).toHaveAttribute('title', 'autopay.cancel')
    expect(screen.queryByText(/автопродл/i)).toBeNull()
  })
})
