import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), online: vi.fn(), users: vi.fn(), user: vi.fn(), payments: vi.fn(), grant: vi.fn(), bugReports: vi.fn(), bugReport: vi.fn(), setBugReportStatus: vi.fn(),
  supportThreads: vi.fn(), supportThread: vi.fn(), supportReply: vi.fn(), supportImageReply: vi.fn(), supportImage: vi.fn(), supportRead: vi.fn(), supportDelete: vi.fn(),
}))

vi.mock('./adminApi', async (load) => ({ ...(await load<typeof import('./adminApi')>()), adminApi: mocks }))

const { AdminMobilePage } = await import('./AdminMobilePage')

const account = {
  id: 'a'.repeat(24), email: 'buyer@example.com', kind: 'user' as const, createdAt: '2026-10-17T09:00:00.000Z',
  subscription: { status: 'active' as const, paidUntil: '2026-11-17T09:00:00.000Z' }, autopay: null, payments: { count: 1, total: 600 },
}

describe('mobile admin dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.overview.mockResolvedValue({
      generatedAt: '2026-10-17T10:00:00.000Z', users: { total: 12, today: 2, days7: 5, days30: 12, blocked: 0 },
      subscriptions: { active: 7, trials: 1, autopay: 2, streamers: 0 },
      revenue: { today: { yookassa: 600, lava: 0, total: 600, payments: 1 }, month: { yookassa: 600, lava: 1200, total: 1800, payments: 3 }, all: { yookassa: 6000, lava: 1200, total: 7200, payments: 12 }, lavaOriginal: [] },
      payouts: { paid: 0, pending: 0, pendingRequests: 0, earned: 0 },
    })
    mocks.online.mockResolvedValue({ generatedAt: '2026-10-17T10:00:00.000Z', windowMinutes: 10, current: 4, today: { date: '2026-10-17', users: 9, minimum: 1, maximum: 5, average: 2.5, samples: 10 }, history: [] })
    mocks.users.mockResolvedValue({ users: [account], total: 1, regions: { all: 1, russia: 0, cis: 0, world: 1, none: 0 } })
    mocks.user.mockResolvedValue({ user: account, payments: [], grants: [] })
    mocks.payments.mockResolvedValue({ payments: [], total: 0, totals: { succeeded: 0, revenue: 0, yookassa: 0, lava: 0, streamerEarnings: 0 } })
    mocks.bugReports.mockResolvedValue({ reports: [], total: 0, counts: { open: 0, closed: 0 } })
    mocks.supportThreads.mockResolvedValue({ threads: [], total: 0, unread: 0 })
    mocks.supportRead.mockResolvedValue(undefined)
  })

  it('loads users, opens a user and switches to payments', async () => {
    const user = userEvent.setup()
    render(<AdminMobilePage />)
    expect(await screen.findByText('buyer@example.com')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()

    await user.click(screen.getByText('buyer@example.com'))
    expect(await screen.findByRole('button', { name: 'Выдать подписку' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('tab', { name: 'Платежи' }))
    await waitFor(() => expect(mocks.payments).toHaveBeenCalledWith('30d', 'succeeded'))
    expect(await screen.findByText('0 успешных платежей')).toBeInTheDocument()
  })

  it('filters users by billing region and answers or permanently deletes a support chat', async () => {
    const user = userEvent.setup()
    const accountId = 'b'.repeat(24)
    mocks.supportThreads.mockResolvedValue({
      threads: [{ accountId, email: 'player@example.com', lastMessage: { id: 1, author: 'user', text: 'Нужна помощь', createdAt: '2026-10-17T10:00:00.000Z', read: false }, lastAt: '2026-10-17T10:00:00.000Z', unread: 1 }],
      total: 1, unread: 1,
    })
    mocks.supportThread.mockResolvedValue({ account: { id: accountId, email: 'player@example.com' }, messages: [{ id: 1, author: 'user', text: 'Нужна помощь', createdAt: '2026-10-17T10:00:00.000Z', read: false }] })
    mocks.supportReply.mockResolvedValue({ message: { id: 2, author: 'owner', text: 'Помогаю', createdAt: '2026-10-17T10:01:00.000Z', read: false } })
    mocks.supportDelete.mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<AdminMobilePage />)
    await screen.findByText('buyer@example.com')
    await user.click(screen.getByRole('button', { name: /Мир/ }))
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith('', 'all', 'world'))
    await user.click(screen.getByRole('tab', { name: 'Заявки' }))
    await user.click(await screen.findByRole('button', { name: /Чаты/ }))
    await user.click(await screen.findByText('player@example.com'))
    expect((await screen.findAllByText('Нужна помощь')).length).toBeGreaterThan(0)
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Помогаю')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(mocks.supportReply).toHaveBeenCalledWith(accountId, 'Помогаю'))
    await user.click(screen.getByRole('button', { name: 'Удалить чат с сервера' }))
    await waitFor(() => expect(mocks.supportDelete).toHaveBeenCalledWith(accountId))
    confirm.mockRestore()
  })
})
