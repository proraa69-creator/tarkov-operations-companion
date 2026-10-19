import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), online: vi.fn(), users: vi.fn(), user: vi.fn(), payments: vi.fn(), grant: vi.fn(), bugReports: vi.fn(), bugReport: vi.fn(), setBugReportStatus: vi.fn(),
  supportThreads: vi.fn(), supportThread: vi.fn(), setPaymentAmount: vi.fn(), supportReply: vi.fn(), supportImageReply: vi.fn(), supportImage: vi.fn(), supportRead: vi.fn(), supportDelete: vi.fn(), boostyConfirm: vi.fn(),
}))

vi.mock('./adminApi', async (load) => ({ ...(await load<typeof import('./adminApi')>()), adminApi: mocks }))

const { AdminMobilePage } = await import('./AdminMobilePage')

/** A tab of the bottom bar. */
const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Разделы админ-панели' })).getByRole('button', { name: new RegExp(`^${name}`) })

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
    expect(await screen.findByText('Платные подписки')).toBeInTheDocument()
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    await user.click(tab('Пользователи'))
    expect(await screen.findByText('buyer@example.com')).toBeInTheDocument()

    await user.click(screen.getByText('buyer@example.com'))
    expect(await screen.findByRole('button', { name: 'Выдать подписку' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(tab('Платежи'))
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
    await user.click(tab('Пользователи'))
    await screen.findByText('buyer@example.com')
    await user.click(screen.getByRole('button', { name: /Мир/ }))
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith('', 'all', 'world'))
    await user.click(tab('Чаты'))
    await user.click(await screen.findByText('player@example.com'))
    expect((await screen.findAllByText('Нужна помощь')).length).toBeGreaterThan(0)
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Помогаю')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(mocks.supportReply).toHaveBeenCalledWith(accountId, 'Помогаю', []))
    await user.click(screen.getByRole('button', { name: 'Удалить чат с сервера' }))
    await waitFor(() => expect(mocks.supportDelete).toHaveBeenCalledWith(accountId))
    confirm.mockRestore()
  })
  it('payments say who paid and who invited, and the owner changes an amount (owner, 17.10.2026)', async () => {
    const user = userEvent.setup()
    const payment = {
      id: 'c'.repeat(24), email: 'friend@example.com', nickname: 'Friend_1', plan: '1m' as const, provider: 'boosty' as const, status: 'succeeded' as const, amount: 240,
      createdAt: '2026-10-17T09:00:00.000Z', paidAt: '2026-10-17T09:01:00.000Z', friendDiscount: { percent: 20, inviter: 'inviter@example.com' },
      invitedBy: { id: 'i', email: 'inviter@example.com', nickname: 'Inviter_1' },
    }
    const streamer = { id: 'd'.repeat(24), email: 'viewer@example.com', plan: '3m' as const, provider: 'yookassa' as const, status: 'succeeded' as const, amount: 810, createdAt: '2026-10-17T08:00:00.000Z', referralCode: 'HUNTER' }
    mocks.payments.mockResolvedValue({ payments: [payment, streamer], total: 2, totals: { succeeded: 2, revenue: 1050, yookassa: 810, lava: 0, streamerEarnings: 81 } })
    mocks.setPaymentAmount.mockResolvedValue({ ...payment, amount: 200 })
    render(<AdminMobilePage />)
    await user.click(tab('Платежи'))
    expect(await screen.findByText('Оплатил: friend@example.com · Friend_1')).toBeInTheDocument()
    expect(screen.getByText('Пришёл по приглашению: inviter@example.com · Inviter_1')).toBeInTheDocument()
    expect(screen.getByText('1 месяц · Boosty · оплачено · скидка друга −20 %')).toBeInTheDocument()
    expect(screen.getByText('Пришёл по коду стримера HUNTER')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Изменить сумму' })[0]!)
    const input = screen.getByRole('textbox', { name: 'Новая сумма, ₽' })
    await user.clear(input)
    await user.type(input, '200')
    await user.type(screen.getByRole('textbox', { name: 'Комментарий (необязательно)' }), 'ошибка в сумме')
    mocks.payments.mockClear()
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.setPaymentAmount).toHaveBeenCalledWith('c'.repeat(24), 200, 'ошибка в сумме'))
    await waitFor(() => expect(mocks.payments).toHaveBeenCalled())
  })
  it('opens on «Сводка» with terms, squads and three days of online history (owner, 20.10.2026)', async () => {
    const user = userEvent.setup()
    const plan = (count: number, revenue: number) => ({ count, revenue })
    mocks.overview.mockResolvedValue({
      ...(await mocks.overview()),
      plans: { month: { '1m': plan(2, 600), '3m': plan(1, 810), '6m': plan(0, 0), '12m': plan(0, 0) }, all: { '1m': plan(9, 2700), '3m': plan(3, 2430), '6m': plan(1, 1500), '12m': plan(1, 2700) } },
      squads: { created: 14, disbanded: 9, active: 5, players: 13, created30: 6, since: '2026-10-01T00:00:00.000Z' },
    })
    const day = (date: string) => ({ date, users: 3, minimum: 0, maximum: 2, average: 1, samples: 5 })
    mocks.online.mockResolvedValue({ generatedAt: '2026-10-17T10:00:00.000Z', windowMinutes: 10, current: 4, today: day('2026-10-17'), history: ['2026-10-17', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13'].map(day) })
    const { container } = render(<AdminMobilePage />)
    expect(await screen.findByText('Подписки по срокам')).toBeInTheDocument()
    expect(screen.getByText('Распущено')).toBeInTheDocument()
    expect(container.querySelectorAll('.admin-online-row:not(.header)')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Показать все дни (5)' }))
    expect(container.querySelectorAll('.admin-online-row:not(.header)')).toHaveLength(5)
    expect(mocks.users).not.toHaveBeenCalled()
  })

  it('marks new requests and chats in the bottom bar', async () => {
    mocks.bugReports.mockResolvedValue({ reports: [], total: 2, counts: { open: 2, closed: 0 } })
    mocks.supportThreads.mockResolvedValue({ threads: [], total: 0, unread: 3 })
    render(<AdminMobilePage />)
    expect(await within(tab('Заявки')).findByText('2')).toBeInTheDocument()
    expect(within(tab('Чаты')).getByText('3')).toBeInTheDocument()
  })

  it('confirms a Boosty payment and offers «Выдать с перерасчётом» on another region', async () => {
    const user = userEvent.setup()
    mocks.boostyConfirm
      .mockRejectedValueOnce(Object.assign(new Error('Аккаунт из региона «Мир»'), { code: 'region_mismatch' }))
      .mockResolvedValueOnce({ payment: { email: 'buyer@example.com', paidUntilAfter: '2026-11-10T00:00:00.000Z' }, recalculatedDays: 12 })
    render(<AdminMobilePage />)
    await user.click(tab('Платежи'))
    await user.click(await screen.findByRole('button', { name: 'Подтвердить оплату Boosty' }))
    await user.type(screen.getByRole('textbox', { name: 'E-mail аккаунта Raid OS' }), 'buyer@example.com')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Предложение' }), 'CIS_STANDARD')
    await user.type(screen.getByRole('textbox', { name: 'Сколько оплатил человек, ₽' }), '300')
    await user.type(screen.getByRole('textbox', { name: 'Сколько заработали чистыми, ₽' }), '270')
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText('Регион не совпадает с аккаунтом')).toBeInTheDocument()
    expect(mocks.boostyConfirm).toHaveBeenLastCalledWith({ email: 'buyer@example.com', offer: 'standard', region: 'CIS', months: 1, amount: 300, netAmount: 270 })
    await user.click(screen.getByRole('button', { name: 'Выдать с перерасчётом' }))
    await waitFor(() => expect(mocks.boostyConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ recalculate: true })))
    expect(await screen.findByText(/с перерасчётом: 12 дн\./)).toBeInTheDocument()
  })
})
