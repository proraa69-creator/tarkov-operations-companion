import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), online: vi.fn(), users: vi.fn(), user: vi.fn(), payments: vi.fn(), grant: vi.fn(), bugReports: vi.fn(), bugReport: vi.fn(), reportTable: vi.fn(), reportWork: vi.fn(), reportPlan: vi.fn(), watchReports: vi.fn(),
  supportThreads: vi.fn(), supportThread: vi.fn(), setPaymentAmount: vi.fn(), supportReply: vi.fn(), supportImageReply: vi.fn(), supportImage: vi.fn(), supportRead: vi.fn(), supportDelete: vi.fn(),
  markRefunded: vi.fn(), rangeStats: vi.fn(), calendar: vi.fn(), day: vi.fn(), series: vi.fn(), referrals: vi.fn(), referrer: vi.fn(),
  streamers: vi.fn(), streamerStats: vi.fn(), streamerSettings: vi.fn(), payouts: vi.fn(), createStreamerInvite: vi.fn(), setStreamerPercent: vi.fn(),
  setStreamerLink: vi.fn(), revokeStreamer: vi.fn(), decidePayout: vi.fn(), setPayoutLimits: vi.fn(), forget: vi.fn(),
}))

vi.mock('./adminApi', async (load) => ({ ...(await load<typeof import('./adminApi')>()), adminApi: mocks }))

const { AdminMobilePage } = await import('./AdminMobilePage')
const { newUsersRange, ownerDay } = await import('../shared/ownerTime')
const { adminPaths } = await import('./adminApi')
const { keepAnswer } = await import('./adminKeep')

/** A tab of the bottom bar. */
const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Разделы админ-панели' })).getByRole('button', { name: new RegExp(`^${name}`) })

const plans = (count = 0, revenue = 0) => ({ '1m': { count, revenue }, '3m': { count: 0, revenue: 0 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } })

const account = {
  id: 'a'.repeat(24), email: 'buyer@example.com', kind: 'user' as const, createdAt: '2026-10-17T09:00:00.000Z',
  subscription: { status: 'active' as const, paidUntil: '2026-11-17T09:00:00.000Z' }, autopay: null, payments: { count: 1, total: 600 },
}

describe('mobile admin dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
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
    mocks.rangeStats.mockImplementation(async (from: string, to: string) => ({ range: { from, to, timezone: 'Asia/Bangkok' }, users: { total: 12, new: 11 } }))
    mocks.calendar.mockImplementation(async (month: string) => ({ month, today: `${month}-28`, days: Array.from({ length: 28 }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, '0')}`, registrations: index === 1 ? 3 : 0, payments: index === 1 ? 2 : 0, revenue: index === 1 ? 1800 : 0, plans: plans(index === 1 ? 2 : 0, index === 1 ? 1800 : 0) })) }))
    mocks.series.mockImplementation(async (period: string) => ({ period, rows: [{ period: '2026-11', registrations: 59, payments: 4, revenue: 3200, plans: plans(4, 3200) }] }))
    // An older server without «Привлечение друзей»: 404, no button.
    mocks.referrals.mockRejectedValue(Object.assign(new Error('Не найдено'), { status: 404 }))
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
    await waitFor(() => expect(mocks.payments).toHaveBeenCalledWith('30d', { status: 'succeeded' }))
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
      id: 'c'.repeat(24), email: 'friend@example.com', nickname: 'Friend_1', plan: '1m' as const, provider: 'bezebee' as const, status: 'succeeded' as const, amount: 240,
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
    expect(screen.getByText('1 месяц · BZB · оплачено · скидка друга −20 %')).toBeInTheDocument()
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
    expect(screen.getByText('Расформировано')).toBeInTheDocument()
    expect(container.querySelectorAll('.admin-online-row:not(.header)')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Показать все дни (5)' }))
    expect(container.querySelectorAll('.admin-online-row:not(.header)')).toHaveLength(5)
    expect(mocks.users).not.toHaveBeenCalled()
  })

  it('marks new requests and chats in the bottom bar', async () => {
    mocks.bugReports.mockResolvedValue({ reports: [], total: 5, counts: { open: 5, closed: 0 }, awaiting: 2 })
    mocks.supportThreads.mockResolvedValue({ threads: [], total: 0, unread: 3 })
    render(<AdminMobilePage />)
    // The number counts what waits for the owner, not everything still open.
    expect(await within(tab('Отчёты')).findByText('2')).toBeInTheDocument()
    expect(within(tab('Чаты')).getByText('3')).toBeInTheDocument()
  })

  // Owner, 05.11.2026: «в админ приложении на сайте блок заявки переделай на блок отчеты».
  it('«Отчёты»: the table, the owner\'s buttons, a row opens what else the report holds', async () => {
    const user = userEvent.setup()
    const row = { id: 12, kind: 'bug' as const, topic: 'Карта не открывается', description: 'Чёрный экран', createdAt: '2026-11-05T09:00:00.000Z', files: 1, triage: { summary: 'Падает Таможня', plan: 'Проверить загрузку' }, work: { status: 'review' as const } }
    mocks.reportTable.mockResolvedValue({ rows: [row], total: 1, counts: { active: 1, closed: 0, awaiting: 1 }, agentSeenAt: new Date().toISOString() })
    mocks.watchReports.mockReturnValue(new Promise(() => {}))
    mocks.reportWork.mockResolvedValue({ report: {} })
    mocks.bugReport.mockResolvedValue({ report: { id: 12, topic: 'Карта не открывается', email: 'p@example.com', accountId: 'a'.repeat(24), description: 'Чёрный экран', platform: 'Windows 10/11 x64', appVersion: '0.6.0-243 · client', createdAt: row.createdAt, status: 'open', files: [], rewardDays: 0, work: { status: 'review' } } })
    render(<AdminMobilePage />)
    await user.click(tab('Отчёты'))
    expect(await screen.findByText('Падает Таможня')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'План действий' })).toHaveValue('Проверить загрузку')
    expect(mocks.watchReports).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Отдать в работу' }))
    await waitFor(() => expect(mocks.reportWork).toHaveBeenCalledWith(12, 'approve', 'Проверить загрузку'))

    // «Копировать»: one report's data for Claude, without opening anything.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Копировать' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]![0]).toContain('Отчёт №12')
    expect(writeText.mock.calls[0]![0]).toContain('Тема: Карта не открывается')
    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeInTheDocument()

    // The window of the report: the answer, the days and the chat stay; the system details do not show.
    await user.click(screen.getByRole('button', { name: 'Подробнее' }))
    const sheet = await screen.findByRole('dialog', { name: 'Карта не открывается' })
    expect(within(sheet).getByText('Ожидает проверки')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Открыть чат' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Начислить' })).toBeInTheDocument()
    expect(sheet).not.toHaveTextContent('Windows')
  })

  it('an old Boosty payment reads «Архив», with no amount to change (owner, 03.11.2026: «все что связано с бусти удаляй»)', async () => {
    const user = userEvent.setup()
    const archived = { id: 'e'.repeat(24), email: 'old@example.com', plan: '1m' as const, provider: 'archive' as const, status: 'succeeded' as const, amount: 300, createdAt: '2026-10-17T09:00:00.000Z', paidAt: '2026-10-17T09:01:00.000Z' }
    mocks.payments.mockResolvedValue({ payments: [archived], total: 1, totals: { succeeded: 1, revenue: 300, yookassa: 0, lava: 0, streamerEarnings: 0 } })
    render(<AdminMobilePage />)
    await user.click(tab('Платежи'))
    expect(await screen.findByText('1 месяц · Архив · оплачено')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Изменить сумму' })).toBeNull()
    expect(screen.queryByText(/Boosty/)).toBeNull()
  })

  it('«Новые за …»: a tap on the tile chooses the period, as on the site (owner, 03.11.2026)', async () => {
    const user = userEvent.setup()
    render(<AdminMobilePage />)
    const thirty = newUsersRange('30d')
    await waitFor(() => expect(mocks.rangeStats).toHaveBeenCalledWith(thirty.from, thirty.to))
    const tile = await screen.findByRole('button', { name: /^Новые за 30 дней: 11/ })
    expect(screen.getByText('Выручка сегодня')).toBeInTheDocument()
    expect(screen.getByText('За этот месяц')).toBeInTheDocument()
    expect(screen.getAllByText('За всё время').length).toBeGreaterThan(0)
    await user.click(tile)
    for (const label of ['7 дней', 'Эта неделя', 'Этот месяц', 'Прошлый месяц', '30 дней']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    mocks.rangeStats.mockImplementationOnce(async (from: string, to: string) => ({ range: { from, to, timezone: 'Asia/Bangkok' }, users: { total: 12, new: 4 } }))
    await user.click(screen.getByRole('button', { name: 'Прошлый месяц' }))
    const last = newUsersRange('lastMonth')
    await waitFor(() => expect(mocks.rangeStats).toHaveBeenLastCalledWith(last.from, last.to))
    expect(await screen.findByRole('button', { name: /^Новые за прошлый месяц: 4/ })).toBeInTheDocument()
  })

  it('the calendar of registrations and payments goes month by month and opens a day (owner, 03.11.2026)', async () => {
    const user = userEvent.setup()
    const month = ownerDay(Date.now()).slice(0, 7)
    mocks.day.mockResolvedValue({
      date: `${month}-02`, totals: { registrations: 3, payments: 2, revenue: 1800, streamerEarnings: 90, plans: plans(2, 1800) },
      registrations: [{ id: 'r1', email: 'new@example.com', kind: 'user', createdAt: `${month}-02T05:00:00.000Z`, invitedByFriend: true, invitedBy: { id: 'i', email: 'inviter@example.com' } }],
      payments: [{ id: 'p'.repeat(24), email: 'payer@example.com', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 900, createdAt: `${month}-02T06:00:00.000Z`, paidAt: `${month}-02T06:01:00.000Z` }],
      grants: [], invites: [],
    })
    render(<AdminMobilePage />)
    await waitFor(() => expect(mocks.calendar).toHaveBeenCalledWith(month))
    const cell = await screen.findByRole('gridcell', { name: /^2 число: выручка 1\s800 ₽, оплат 2, регистраций 3$/ })
    await user.click(cell)
    await waitFor(() => expect(mocks.day).toHaveBeenCalledWith(`${month}-02`))
    expect(await screen.findByText('new@example.com')).toBeInTheDocument()
    expect(screen.getByText('по приглашению от inviter@example.com')).toBeInTheDocument()
    expect(screen.getByText('Оплатил: payer@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    const previous = new Date(`${month}-15T00:00:00Z`)
    previous.setUTCMonth(previous.getUTCMonth() - 1)
    await waitFor(() => expect(mocks.calendar).toHaveBeenLastCalledWith(previous.toISOString().slice(0, 7)))
    await user.click(screen.getByRole('button', { name: '12 месяцев' }))
    await waitFor(() => expect(mocks.series).toHaveBeenCalledWith('month'))
    expect(await screen.findByRole('rowheader', { name: /^Ноябрь 2026/ })).toBeInTheDocument()
  })

  it('«Стримеры»: numbers, the streamer statistics, the percent and the payouts, as the site tab (owner, 03.11.2026)', async () => {
    const user = userEvent.setup()
    mocks.streamers.mockResolvedValue({ streamers: [{ email: 'tv@example.com', code: 'HUNTER_TV', stats: { visits: 336, registrations: 59, activeSubscriptions: 4, revenue: { amount: 3200, currency: 'RUB' }, earnings: { amount: 320, currency: 'RUB' } } }], invites: [] })
    mocks.streamerSettings.mockResolvedValue({ defaultPercent: 10, streamers: [{ code: 'HUNTER_TV', email: 'tv@example.com', percent: 10, custom: false, linkEnabled: true }] })
    mocks.payouts.mockResolvedValue({ payouts: [{ id: 'po1', amount: 320, status: 'pending', auto: false, createdAt: '2026-11-01T10:00:00.000Z', destination: 'sbp', code: 'HUNTER_TV', email: 'tv@example.com', phone: '+70000000000', bank: 'Банк', recipient: 'Имя' }], limits: { min: 7, max: 30 } })
    mocks.streamerStats.mockResolvedValue({ code: 'HUNTER_TV', period: 'day', rows: [{ period: '2026-11-03', visits: 12, registrations: 3, payments: 1, months: { '1m': 1, '3m': 0, '6m': 0, '12m': 0 }, revenue: 900, earnings: 90 }], campaigns: [] })
    mocks.setStreamerPercent.mockResolvedValue({ defaultPercent: 10, streamers: [{ code: 'HUNTER_TV', email: 'tv@example.com', percent: 15, custom: true, linkEnabled: true }] })
    mocks.decidePayout.mockResolvedValue({})
    render(<AdminMobilePage />)
    await user.click(await screen.findByRole('button', { name: 'Стримеры' }))
    const sheet = await screen.findByRole('dialog', { name: 'Стримеры' })
    expect((await within(sheet).findAllByText('HUNTER_TV')).length).toBeGreaterThan(0)
    expect(within(sheet).getAllByText('336').length).toBeGreaterThan(0)
    expect(within(sheet).getAllByText('59').length).toBeGreaterThan(0)
    await user.click(within(sheet).getByRole('button', { name: /HUNTER_TV/ }))
    await waitFor(() => expect(mocks.streamerStats).toHaveBeenCalledWith('HUNTER_TV', 'day'))
    expect(await within(sheet).findByText('03.11')).toBeInTheDocument()
    const percent = within(sheet).getByRole('textbox', { name: 'Доля HUNTER_TV, %' })
    await user.clear(percent)
    await user.type(percent, '15')
    await user.click(within(sheet).getAllByRole('button', { name: 'Сохранить' })[0]!)
    await waitFor(() => expect(mocks.setStreamerPercent).toHaveBeenCalledWith('HUNTER_TV', 15))
    await user.click(within(sheet).getByRole('button', { name: 'Выплачено' }))
    await waitFor(() => expect(mocks.decidePayout).toHaveBeenCalledWith('po1', 'paid', undefined))
  })

  it('«Пригласи друга» appears once the server has it and lists who brought friends (owner, 03.11.2026)', async () => {
    const user = userEvent.setup()
    const referrer = { id: 'e'.repeat(24), email: 'leader@example.com', nickname: 'Leader', code: 'LEAD1', invited: 5, paid: 3, unpaid: 2, friendsDeleted: 0, confirmed: 3, rank: { id: 'scout', title: 'Scout' }, days: { granted: 21, pending: 7, review: 0 }, rewards: { granted: 3, pending: 1 }, waitingEft: 0 }
    mocks.referrals.mockResolvedValue({
      summary: { withCode: 40, referrers: 1, invited: 5, paid: 3, unpaid: 2, friendsDeleted: 0, days: { granted: 21, pending: 7, review: 0 }, rewards: { granted: 3 }, waitingEft: 0, lifetime: 0, rewardDays: 7, holdDays: 14, discountPercent: 20, ranks: [] },
      referrers: [referrer], total: 1,
    })
    mocks.referrer.mockResolvedValue({
      referrer,
      friends: [{ id: 'f'.repeat(24), email: 'friend@example.com', invitedAt: '2026-10-20T10:00:00.000Z', paid: true, payments: 1, amount: 240, eftBound: true, first: { amount: 240, plan: '1m', provider: 'yookassa', status: 'succeeded', discountPercent: 20 }, reward: { id: 1, kind: 'friend', days: 7, status: 'granted', createdAt: '2026-10-20T10:00:00.000Z', decidedAt: '2026-11-03T10:00:00.000Z' } }],
      rewards: [{ id: 1, kind: 'friend', days: 7, status: 'granted', createdAt: '2026-10-20T10:00:00.000Z' }],
    })
    render(<AdminMobilePage />)
    await user.click(await screen.findByRole('button', { name: 'Пригласи друга' }))
    const sheet = await screen.findByRole('dialog', { name: 'Пригласи друга' })
    expect(await within(sheet).findByText('leader@example.com · Leader')).toBeInTheDocument()
    expect(within(sheet).getByText('друзей 5 · оплатили 3 · не оплатили 2')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Больше оплат' }))
    await waitFor(() => expect(mocks.referrals).toHaveBeenLastCalledWith('', 'paid'))
    await user.click(within(sheet).getByText('leader@example.com · Leader'))
    await waitFor(() => expect(mocks.referrer).toHaveBeenCalledWith('e'.repeat(24)))
    expect(await screen.findByText('friend@example.com')).toBeInTheDocument()
  })

  it('without «Привлечение друзей» on the server there is no «Пригласи друга» button', async () => {
    render(<AdminMobilePage />)
    expect(await screen.findByRole('button', { name: 'Стримеры' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.referrals).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Пригласи друга' })).toBeNull()
  })

  it('payments filter by the plan and the e-mail as on the site, and a refund can be marked', async () => {
    const user = userEvent.setup()
    const payment = { id: 'a1'.repeat(12), email: 'buyer@example.com', plan: '3m' as const, provider: 'yookassa' as const, status: 'succeeded' as const, amount: 810, createdAt: '2026-11-03T03:00:00.000Z', paidAt: '2026-11-03T03:01:00.000Z' }
    mocks.payments.mockResolvedValue({ payments: [payment], total: 1, totals: { succeeded: 1, revenue: 810, yookassa: 810, lava: 0, streamerEarnings: 0 } })
    mocks.markRefunded.mockResolvedValue({ ok: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminMobilePage />)
    await user.click(tab('Платежи'))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Тариф' }), '3m')
    await waitFor(() => expect(mocks.payments).toHaveBeenLastCalledWith('30d', { status: 'succeeded', plan: '3m' }))
    await user.type(screen.getByRole('textbox', { name: 'Поиск по e-mail' }), 'buyer')
    await waitFor(() => expect(mocks.payments).toHaveBeenLastCalledWith('30d', { status: 'succeeded', plan: '3m', q: 'buyer' }))
    await user.click(await screen.findByRole('button', { name: 'Отметить возврат' }))
    await waitFor(() => expect(mocks.markRefunded).toHaveBeenCalledWith(payment.id))
    confirm.mockRestore()
  })

  it('opens with the numbers kept from the last time while the fresh ones load (owner, 03.11.2026: «долго загружает»)', async () => {
    const kept = await mocks.overview()
    keepAnswer(adminPaths.overview(), { ...kept, users: { ...kept.users, total: 777 } })
    mocks.overview.mockReturnValue(new Promise(() => {}))
    render(<AdminMobilePage />)
    expect(screen.getByText('777')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Обновить' })).toHaveAttribute('aria-busy', 'true')
  })

  it('one request without an answer keeps the data with a quiet line instead of «нет связи» (owner, 03.11.2026)', async () => {
    const user = userEvent.setup()
    render(<AdminMobilePage />)
    expect(await screen.findByText('Платные подписки')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить' })).toHaveAttribute('aria-busy', 'false'))
    mocks.overview.mockRejectedValue(new Error('Сервер недоступен'))
    await user.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(await screen.findByText('Сервер не ответил — показаны последние данные, повторим сами')).toBeInTheDocument()
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('switching tabs does not ask for «Сводка» again', async () => {
    const user = userEvent.setup()
    render(<AdminMobilePage />)
    await screen.findByText('Платные подписки')
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1))
    await user.click(tab('Пользователи'))
    await screen.findByText('buyer@example.com')
    await user.click(tab('Платежи'))
    await waitFor(() => expect(mocks.payments).toHaveBeenCalled())
    await user.click(tab('Сводка'))
    expect(mocks.overview).toHaveBeenCalledTimes(1)
    expect(mocks.online).toHaveBeenCalledTimes(1)
  })

})
