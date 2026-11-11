import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser } from '../../api'

/** Owner, 12.11.2026: an account whose free days wait for the first raid shows «ждёт первого рейда (2 дня)», not a date. */
const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), devices: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminUsers: mocks.users, adminUser: mocks.user, adminDevices: mocks.devices } }
})

const { AdminUsers } = await import('./AdminUsers')

const user = (id: string, email: string, subscription: AdminUser['subscription']): AdminUser => ({
  id: id.repeat(24), email, kind: 'user', createdAt: '2026-11-12T10:00:00.000Z', subscription, autopay: null, payments: { count: 0, total: 0 }, country: 'RU',
})

afterEach(() => { cleanup(); for (const mock of Object.values(mocks)) mock.mockReset() })

describe('admin users: free days waiting for the first raid', () => {
  it('says so instead of the latest end; a running trial keeps its date', async () => {
    mocks.users.mockResolvedValue({
      users: [
        user('a', 'waits@mail.ru', { status: 'trial', trialEndsAt: '2026-11-21T02:05:00.000Z', trialRaidDays: 2 }),
        user('b', 'plays@mail.ru', { status: 'trial', trialEndsAt: '2026-11-14T02:17:00.000Z' }),
      ],
      total: 2,
      regions: { all: 2, russia: 2, cis: 0, world: 0, none: 0 },
    })
    render(<AdminUsers />)
    const row = async (email: string) => (await screen.findByText(email)).closest('tr')!
    expect(within(await row('waits@mail.ru')).getByText('ждёт первого рейда (2 дня)')).toBeInTheDocument()
    expect(within(await row('waits@mail.ru')).queryByText(/21\.11/)).toBeNull()
    expect(within(await row('plays@mail.ru')).getByText(/^пробный до /)).toBeInTheDocument()
  })
})
