import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), online: vi.fn(), phones: vi.fn(), users: vi.fn(), user: vi.fn(), payments: vi.fn(), grant: vi.fn(), bugReports: vi.fn(), bugReport: vi.fn(), bugReportImage: vi.fn(), reportTable: vi.fn(), reportWork: vi.fn(), reportPlan: vi.fn(), watchReports: vi.fn(),
  supportThreads: vi.fn(), supportThread: vi.fn(), setPaymentAmount: vi.fn(), supportReply: vi.fn(), supportImageReply: vi.fn(), supportImage: vi.fn(), supportRead: vi.fn(), supportDelete: vi.fn(), supportReact: vi.fn(), supportEdit: vi.fn(),
  markRefunded: vi.fn(), rangeStats: vi.fn(), calendar: vi.fn(), day: vi.fn(), series: vi.fn(), referrals: vi.fn(), referrer: vi.fn(),
  streamers: vi.fn(), streamerStats: vi.fn(), streamerSettings: vi.fn(), payouts: vi.fn(), createStreamerInvite: vi.fn(), setStreamerPercent: vi.fn(),
  setStreamerLink: vi.fn(), revokeStreamer: vi.fn(), decidePayout: vi.fn(), payoutAttention: vi.fn(async () => ({ count: 0 })), forget: vi.fn(),
  stickerPacks: vi.fn(), profile: vi.fn(), supportSearch: vi.fn(), supportDeleteMessage: vi.fn(),
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
    mocks.phones.mockResolvedValue({
      users: 2261, phones: { accounts: 830, devices: 853 }, android: { accounts: 813, devices: 830, online: 41 }, ios: { accounts: 20, devices: 23, online: 2 },
      online: { phone: 43, pc: 120, all: 160, windowMinutes: 5 }, at: '2026-11-23T01:00:00.000Z',
    })
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
    await waitFor(() => expect(mocks.supportReply).toHaveBeenCalledWith(accountId, 'Помогаю', [], undefined, {}))
    await user.click(screen.getByRole('button', { name: 'Удалить чат с сервера' }))
    await waitFor(() => expect(mocks.supportDelete).toHaveBeenCalledWith(accountId))
    confirm.mockRestore()
  })
  // Owner, 07.11.2026: «и пользователь, и я смог ставить на сообщения лайки или нажать правой клавишей и нажать «Ответить»».
  it('a chat: a long press or right click on a message → a reaction or «Ответить»; the answer goes with replyTo; a sticker goes at once', async () => {
    const user = userEvent.setup()
    const accountId = 'c'.repeat(24)
    const asked = { id: 7, author: 'user' as const, text: 'Где ключ от 314?', createdAt: '2026-11-07T10:00:00.000Z', read: true }
    mocks.supportThreads.mockResolvedValue({ threads: [{ accountId, email: 'rat@example.com', nickname: 'Rat_King', lastMessage: { ...asked, text: '[стикер: Крыса]', sticker: 'rat' }, lastAt: asked.createdAt, unread: 0 }], total: 1, unread: 0 })
    mocks.supportThread.mockResolvedValue({ account: { id: accountId, email: 'rat@example.com', nickname: 'Rat_King' }, messages: [asked] })
    mocks.supportReact.mockImplementation(async (_account: string, id: number, emoji: string, on: boolean) => ({ message: { ...asked, id, reactions: on ? [{ emoji, authors: ['owner'] }] : [] } }))
    mocks.supportReply.mockResolvedValue({ message: { id: 8, author: 'owner', text: 'В общаге', createdAt: '2026-11-07T10:01:00.000Z', read: false } })

    render(<AdminMobilePage />)
    await user.click(tab('Чаты'))
    // The list names a sticker by its caption.
    expect(await screen.findByText('Стикер: Крыса')).toBeInTheDocument()
    await user.click(screen.getByText('Rat_King'))
    const question = (await screen.findByText('Где ключ от 314?', { selector: '.support-chat-text' })).closest('.support-chat-message') as HTMLElement

    fireEvent.contextMenu(question)
    await user.click(screen.getByRole('menuitemcheckbox', { name: '👍' }))
    await waitFor(() => expect(mocks.supportReact).toHaveBeenCalledWith(accountId, 7, '👍', true))
    expect(await within(question).findByRole('button', { name: '👍 1' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.contextMenu(question)
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }))
    expect(screen.getByRole('group', { name: 'Ответ на сообщение' })).toHaveTextContent('Rat_KingГде ключ от 314?')
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'В общаге')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(mocks.supportReply).toHaveBeenCalledWith(accountId, 'В общаге', [], undefined, { replyTo: 7 }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Ответ на сообщение' })).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Стикеры' }))
    await user.click(within(screen.getByRole('group', { name: 'Стикеры' })).getByRole('button', { name: 'Спасибо, бро' }))
    await waitFor(() => expect(mocks.supportReply).toHaveBeenLastCalledWith(accountId, '', [], undefined, { sticker: 'thanks' }))
  })

  // Owner, 15.11.2026: «После отправки сообщения нельзя сразу отправить второе: клавиатура больше не открывается. Отправка
  // долго думает». «Редактирование своих сообщений только у админа… Человек не видит, что сообщение отредактировано».
  it('a chat: the answer shows at once and the box is ready for the next; «Редактировать» on the owner\'s own message', async () => {
    const user = userEvent.setup()
    const accountId = 'd'.repeat(24)
    const asked = { id: 7, author: 'user' as const, text: 'Где ключ от 314?', createdAt: '2026-11-15T10:00:00.000Z', read: true }
    mocks.supportThreads.mockResolvedValue({ threads: [{ accountId, email: 'rat@example.com', nickname: 'Rat_King', lastMessage: asked, lastAt: asked.createdAt, unread: 0 }], total: 1, unread: 0 })
    mocks.supportThread.mockResolvedValue({ account: { id: accountId, email: 'rat@example.com', nickname: 'Rat_King' }, messages: [asked] })
    let deliver: () => void = () => {}
    mocks.supportReply.mockImplementation((_account: string, text: string) => new Promise((resolve) => {
      deliver = () => resolve({ message: { id: 8, author: 'owner', text, createdAt: '2026-11-15T10:01:00.000Z', read: false } })
    }))
    mocks.supportEdit.mockImplementation(async (_account: string, id: number, text: string) => ({ message: { id, author: 'owner', text, createdAt: '2026-11-15T10:01:00.000Z', read: false } }))

    render(<AdminMobilePage />)
    await user.click(tab('Чаты'))
    await user.click(await screen.findByText('Rat_King'))
    await screen.findByText('Где ключ от 314?', { selector: '.support-chat-text' })
    const box = screen.getByRole('textbox', { name: 'Сообщение' })
    await user.type(box, 'В общаге')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    // Before the server answers: in the conversation with a clock, the box empty and still in focus.
    const sent = screen.getByText('В общаге', { selector: '.support-chat-text' }).closest('.support-chat-message') as HTMLElement
    expect(within(sent).getByRole('img', { name: 'Отправляется' })).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    await act(async () => deliver())
    const answer = await waitFor(() => {
      const node = screen.getByText('В общаге', { selector: '.support-chat-text' }).closest('.support-chat-message') as HTMLElement
      expect(within(node).getByRole('img', { name: 'Отправлено' })).toBeInTheDocument()
      return node
    })
    // The player's message has no «Редактировать»; the owner's has.
    fireEvent.contextMenu(screen.getByText('Где ключ от 314?', { selector: '.support-chat-text' }).closest('.support-chat-message')!)
    expect(screen.queryByRole('menuitem', { name: 'Редактировать' })).toBeNull()
    await user.keyboard('{Escape}')
    fireEvent.contextMenu(answer)
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }))
    expect(box).toHaveValue('В общаге')
    await user.type(box, ' на третьем этаже')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.supportEdit).toHaveBeenCalledWith(accountId, 8, 'В общаге на третьем этаже'))
    expect(await screen.findByText('В общаге на третьем этаже', { selector: '.support-chat-text' })).toBeInTheDocument()
    expect(box).toHaveValue('')
  })

  // Owner, 15.11.2026: «Убрать блок «История обновлений»… Она уже есть в «Обновлениях»».
  it('«Сводка» has no «История обновлений»; «Обновление» stays', async () => {
    render(<AdminMobilePage />)
    await screen.findByText('Платные подписки')
    expect(screen.queryByRole('button', { name: 'История обновлений' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Обновление' })).toBeInTheDocument()
  })

  // Owner, 07.11.2026: «в админ приложении на телефоне сделай мне функцию добавлять стикеры».
  it('«Стикеры» on «Сводка» opens the packs (loaded only then)', async () => {
    const user = userEvent.setup()
    mocks.stickerPacks.mockResolvedValue({ packs: [{ id: 'a1'.repeat(12), name: 'Мемы', published: true, createdAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-08T10:00:00.000Z', stickers: [] }] })
    render(<AdminMobilePage />)
    await screen.findByText('Платные подписки')
    expect(mocks.stickerPacks).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Стикеры' }))
    const sheet = await screen.findByRole('dialog', { name: 'Стикеры' })
    expect(await within(sheet).findByRole('button', { name: /^Мемы/ })).toHaveTextContent('В приложениях')
    await user.click(within(sheet).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog', { name: 'Стикеры' })).toBeNull()
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

  it('«Телефоны»: who signed in on Android and on iPhone, and who is in each app now (owner, 23.11.2026)', async () => {
    render(<AdminMobilePage />)
    const block = await screen.findByRole('region', { name: 'Телефоны' })
    // ru-RU groups thousands with a narrow no-break space
    expect(within(block).getByText(/^всего пользователей 2\s261$/)).toBeInTheDocument()
    const tile = (name: string) => within(block).getByText(name).closest('article')!
    expect(within(tile('Вошли с телефона')).getByText('830')).toBeInTheDocument()
    expect(within(tile('Вошли с телефона')).getByText('телефонов: 853')).toBeInTheDocument()
    expect(within(tile('Онлайн с телефонов')).getByText('43')).toBeInTheDocument()
    expect(within(tile('Android')).getByText('813')).toBeInTheDocument()
    expect(within(tile('Android')).getByText('установили и вошли · онлайн 41')).toBeInTheDocument()
    expect(within(tile('iPhone')).getByText('20')).toBeInTheDocument()
    expect(within(tile('iPhone')).getByText('установили и вошли · онлайн 2')).toBeInTheDocument()
  })

  it('a server before «Телефоны» shows the rest of «Сводка» without it', async () => {
    mocks.phones.mockRejectedValue(Object.assign(new Error('Не найдено'), { status: 404 }))
    render(<AdminMobilePage />)
    expect(await screen.findByText('Статистика онлайна')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Телефоны' })).not.toBeInTheDocument()
  })

  // Owner, 24.11.2026: «на телефоне зажимаю пальцем какого-либо из человека… посмотреть профиль».
  it('«Чаты»: a long press on a person → «Посмотреть профиль» on its own screen; the open chat has «Профиль» too', async () => {
    const user = userEvent.setup()
    const accountId = 'e'.repeat(24)
    const asked = { id: 9, author: 'user' as const, text: 'Как привязать телефон?', createdAt: '2026-11-24T09:00:00.000Z', read: true }
    mocks.supportThreads.mockResolvedValue({ threads: [{ accountId, email: 'kotik@example.com', nickname: 'Kotik_Pro', lastMessage: asked, lastAt: asked.createdAt, unread: 0 }], total: 1, unread: 0 })
    mocks.supportThread.mockResolvedValue({ account: { id: accountId, email: 'kotik@example.com', nickname: 'Kotik_Pro' }, messages: [asked] })
    mocks.profile.mockResolvedValue({
      generatedAt: '2026-11-24T10:00:00.000Z',
      account: { id: accountId, email: 'kotik@example.com', kind: 'user', createdAt: '2026-07-01T09:00:00.000Z', nickname: 'Kotik_Pro' },
      subscription: { status: 'active', paidUntil: '2027-01-01T00:00:00.000Z', source: 'money' }, autopay: null, origin: {},
      payments: { count: 1, total: 300, refunded: { count: 0, total: 0 }, first: { at: '2026-07-07T10:00:00.000Z', plan: '1m', amount: 300 }, months: [{ month: '2026-07', count: 1, revenue: 300, plans: { '1m': 1 } }], plans: plans(1, 300), list: [], more: false },
      grants: [], activity: { phone: { used: true, android: false, ios: true }, phoneSeenAt: '2026-11-22T10:00:00.000Z', devices: [] },
      referrals: { invited: 0, deleted: 0, paid: 0, revenue: 0, friends: [], more: false, rewards: { granted: 0, pending: 0, review: 0, canceled: 0, days: { granted: 0, pending: 0, review: 0 } } },
    })

    render(<AdminMobilePage />)
    await user.click(tab('Чаты'))
    const person = (await screen.findByText('Kotik_Pro')).closest('button')!
    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
    Object.defineProperty(press, 'pointerType', { value: 'touch' })
    fireEvent(person, press)
    await user.click(await screen.findByRole('menuitem', { name: 'Посмотреть профиль' }, { timeout: 2000 }))
    // The finger lifted after the press did not open the chat.
    expect(mocks.supportThread).not.toHaveBeenCalled()

    const profile = await screen.findByRole('dialog', { name: 'Профиль Kotik_Pro' })
    await waitFor(() => expect(mocks.profile).toHaveBeenCalledWith(accountId))
    expect(await within(profile).findByText('Первая оплата')).toBeInTheDocument()
    expect(within(profile).getByText('С телефона').parentElement).toHaveTextContent('ДаiPhone')

    // «Открыть чат» from the profile: the conversation, the profile closed.
    await user.click(within(profile).getByRole('button', { name: 'Открыть чат' }))
    await waitFor(() => expect(mocks.supportThread).toHaveBeenCalledWith(accountId))
    expect(screen.queryByRole('dialog', { name: 'Профиль Kotik_Pro' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Профиль' }))
    expect(await screen.findByRole('dialog', { name: 'Профиль Kotik_Pro' })).toBeInTheDocument()
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
    mocks.bugReportImage.mockResolvedValue('data:image/png;base64,AAAA')
    mocks.reportTable.mockResolvedValue({ rows: [row], total: 1, counts: { active: 1, closed: 0, awaiting: 1 }, agentSeenAt: new Date().toISOString() })
    mocks.watchReports.mockReturnValue(new Promise(() => {}))
    mocks.reportWork.mockResolvedValue({ report: {} })
    mocks.bugReport.mockResolvedValue({ report: { id: 12, topic: 'Карта не открывается', email: 'p@example.com', accountId: 'a'.repeat(24), description: 'Чёрный экран', platform: 'Windows 10/11 x64', appVersion: '0.6.0-243 · client', createdAt: row.createdAt, status: 'open', files: [], rewardDays: 0, work: { status: 'review' } } })
    render(<AdminMobilePage />)
    await user.click(tab('Отчёты'))
    expect(await screen.findByText('Карта не открывается')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'План действий' })).toBeNull()
    expect(mocks.watchReports).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Взял в работу' }))
    await waitFor(() => expect(mocks.reportWork).toHaveBeenCalledWith(12, 'take'))

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
    expect(within(sheet).getByText('Активный')).toBeInTheDocument()
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

  it('«За всё время» counts «оплатили повторно», as on the site (owner, 12.11.2026); an older server shows no count', async () => {
    const { unmount } = render(<AdminMobilePage />)
    expect(await screen.findByText('оплат: 12')).toBeInTheDocument()
    expect(screen.queryByText(/оплатили повторно/)).toBeNull()
    unmount()
    mocks.overview.mockResolvedValue({ ...(await mocks.overview()), repeatPayers: 4 })
    render(<AdminMobilePage />)
    expect(await screen.findByText('оплатили повторно: 4')).toBeInTheDocument()
    expect(screen.getAllByText(/оплатили повторно/)).toHaveLength(1)
  })

  it('«Платные подписки» with the repeat ones, «Пробный период» dead / real, «повторных» in the revenue (owner, 15.11.2026)', async () => {
    const base = await mocks.overview()
    mocks.overview.mockResolvedValue({
      ...base, subscriptions: { ...base.subscriptions, activeRepeat: 2, trials: 5, trialsDead: 3, trialsAlive: 2 },
      revenue: { ...base.revenue, today: { ...base.revenue.today, repeat: 1 }, month: { ...base.revenue.month, repeat: 1 }, all: { ...base.revenue.all, repeat: 6 } },
    })
    render(<AdminMobilePage />)
    expect(await screen.findByText('из них повторных: 2')).toBeInTheDocument()
    expect(screen.getByText('мёртвых 3 · реальных 2')).toBeInTheDocument()
    expect(screen.getByText('оплат: 1 · повторных: 1')).toBeInTheDocument()
    expect(screen.getByText('оплат: 12 · повторных: 6')).toBeInTheDocument()
  })

  it('a long press on the calendar picks the first and the second day; the period summary; the cross drops it (owner, 15.11.2026)', async () => {
    const month = ownerDay(Date.now()).slice(0, 7)
    mocks.rangeStats.mockImplementation(async (from: string, to: string) => ({
      range: { from, to, timezone: 'Asia/Bangkok' }, users: { total: 12, new: from === to ? 11 : 6 },
      subscriptions: { activePaid: 7, activePaidRepeat: 2, trials: 5, trialsDead: 3, trialsAlive: 2 },
      payers: { everPaid: 9, paidInRange: 3, newInRange: 2, repeatPaid: 4, repeatInRange: 1 },
      revenue: { total: 2700, payments: 3, repeatPayments: 1, byPlan: { '1m': { count: 3, amount: 2700 } }, refunds: { count: 0, amount: 0 } },
      trialConversion: { trialStarted: 4, laterPaid: 1, rate: 0.25, dead: 3, alive: 1 },
    }))
    render(<AdminMobilePage />)
    const hold = async (day: number) => {
      const cell = await screen.findByRole('gridcell', { name: new RegExp(`^${day} число`) })
      vi.useFakeTimers()
      fireEvent.touchStart(cell)
      act(() => { vi.advanceTimersByTime(600) })
      fireEvent.touchEnd(cell)
      fireEvent.click(cell)
      vi.useRealTimers()
      return cell
    }
    const fifth = await hold(5)
    expect(fifth).toHaveClass('is-picked')
    expect(screen.getByText('Долгое нажатие — второй день')).toBeInTheDocument()
    await hold(2)
    expect(mocks.day).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.rangeStats).toHaveBeenCalledWith(`${month}-02`, `${month}-05`))
    const summary = await screen.findByRole('region', { name: /^Сводка за период/ })
    expect(await within(summary).findByText('оплат: 3 · повторных: 1')).toBeInTheDocument()
    expect(within(summary).getByText('впервые 2 · повторно 1')).toBeInTheDocument()
    expect(within(summary).getByText('мёртвых 3 · реальных 1 · оплатили 1')).toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: /^3 число/ })).toHaveClass('is-picked-inside')
    fireEvent.click(within(summary).getByRole('button', { name: 'Снять выбор' }))
    expect(screen.queryByRole('region', { name: /^Сводка за период/ })).toBeNull()
    expect(document.querySelector('.admin-calendar-cell.is-picked')).toBeNull()
    // A short tap still opens the day.
    mocks.day.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('gridcell', { name: /^2 число/ }))
    await waitFor(() => expect(mocks.day).toHaveBeenCalledWith(`${month}-02`))
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
    mocks.payouts.mockResolvedValue({ payouts: [{ id: 'po1', amount: 320, status: 'pending', auto: false, createdAt: '2026-11-01T10:00:00.000Z', destination: 'sbp', code: 'HUNTER_TV', email: 'tv@example.com', phone: '+70000000000', bank: 'Банк', recipient: 'Имя' }] })
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

  // Owner, 26.11.2026: «там нет у меня чистыми деньги, сколько суммы чистыми»; «в разделе платежи … чтобы я нажал на него, и у
  // меня открылся его профиль. Там же будет открыть чат с ним».
  it('«Платежи»: «Чистыми» with what it took off; a payment opens its payer\'s profile, and the profile the chat', async () => {
    const user = userEvent.setup()
    const accountId = 'f'.repeat(24)
    mocks.payments.mockResolvedValue({
      payments: [{ id: '1'.repeat(24), accountId, email: 'payer@example.com', nickname: 'Payer_1', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 300, netAmount: 259.41, streamerEarning: 30, createdAt: '2026-11-26T09:00:00.000Z', paidAt: '2026-11-26T09:00:00.000Z', method: 'bank_card' }],
      total: 1, totals: { succeeded: 1, revenue: 300, yookassa: 0, lava: 0, streamerEarnings: 30, net: 259.41, fees: 10.59, plans: plans(1, 300) },
    })
    mocks.profile.mockResolvedValue({
      generatedAt: '2026-11-26T10:00:00.000Z',
      account: { id: accountId, email: 'payer@example.com', kind: 'user', createdAt: '2026-07-01T09:00:00.000Z', nickname: 'Payer_1' },
      subscription: { status: 'active', paidUntil: '2026-12-26T00:00:00.000Z', source: 'money' }, autopay: null, origin: {},
      payments: { count: 1, total: 300, refunded: { count: 0, total: 0 }, first: { at: '2026-11-26T09:00:00.000Z', plan: '1m', amount: 300 }, months: [{ month: '2026-11', count: 1, revenue: 300, plans: { '1m': 1 } }], plans: { '1m': 1 } },
      grants: [], activity: { phone: { used: false, android: false, ios: false }, devices: [] },
      referrals: { invited: 0, deleted: 0, paid: 0, revenue: 0, friends: [], more: false, rewards: { granted: 0, pending: 0, review: 0, canceled: 0, days: { granted: 0, pending: 0, review: 0 } } },
    })
    mocks.supportThread.mockResolvedValue({ account: { id: accountId, email: 'payer@example.com', nickname: 'Payer_1' }, messages: [] })

    render(<AdminMobilePage />)
    await user.click(tab('Платежи'))
    expect(await screen.findByText(/Чистыми: 259 ₽/)).toBeInTheDocument()
    expect(screen.getByText(/комиссия −11 ₽.*стримерам −30 ₽/)).toBeInTheDocument()
    expect(screen.getByText(/чистыми 259 ₽/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Профиль: / }))
    const profile = await screen.findByRole('dialog', { name: 'Профиль Payer_1' })
    expect(mocks.profile.mock.calls[0]?.[0]).toBe(accountId)
    await user.click(await within(profile).findByRole('button', { name: 'Открыть чат' }))
    await waitFor(() => expect(mocks.supportThread).toHaveBeenCalledWith(accountId))
  })

  // Owner, 26.11.2026: «в чате нету функции найти пользователя по логину, ну по почте».
  it('«Чаты»: «Найти по почте» lists accounts with a conversation or not; a tap opens the chat', async () => {
    const user = userEvent.setup()
    const accountId = 'c'.repeat(24)
    mocks.supportSearch.mockResolvedValue({ users: [{ id: accountId, email: 'newbie@example.com', nickname: 'Newbie', hasThread: false }] })
    mocks.supportThread.mockResolvedValue({ account: { id: accountId, email: 'newbie@example.com', nickname: 'Newbie' }, messages: [] })

    render(<AdminMobilePage />)
    await user.click(tab('Чаты'))
    expect(await screen.findByText('Переписок пока нет')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Найти по почте' }), 'newb')
    const found = await screen.findByText('Newbie', {}, { timeout: 2000 })
    expect(mocks.supportSearch).toHaveBeenCalledWith('newb')
    expect(screen.getByText(/переписки нет/)).toBeInTheDocument()
    expect(screen.queryByText('Переписок пока нет')).not.toBeInTheDocument()
    await user.click(found.closest('button')!)
    await waitFor(() => expect(mocks.supportThread).toHaveBeenCalledWith(accountId))
    // one letter is no search
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await user.clear(screen.getByRole('textbox', { name: 'Найти по почте' }))
    await user.type(screen.getByRole('textbox', { name: 'Найти по почте' }), 'n')
    expect(await screen.findByText('Переписок пока нет')).toBeInTheDocument()
  })

  // Owner, 26.11.2026: «добавь в чате у меня, у админа, функцию удалить сообщение».
  it('«Чаты»: «Удалить» on any message asks «Точно удалить?» and then deletes it; the conversation is read again', async () => {
    const user = userEvent.setup()
    const accountId = 'e'.repeat(24)
    const asked = { id: 9, author: 'user' as const, text: 'Реклама казино', createdAt: '2026-11-24T09:00:00.000Z', read: true }
    const account = { id: accountId, email: 'kotik@example.com', nickname: 'Kotik_Pro' }
    mocks.supportThreads.mockResolvedValue({ threads: [{ accountId, email: 'kotik@example.com', nickname: 'Kotik_Pro', lastMessage: asked, lastAt: asked.createdAt, unread: 0 }], total: 1, unread: 0 })
    mocks.supportThread.mockResolvedValue({ account, messages: [asked] })
    mocks.supportDeleteMessage.mockImplementation(async () => { mocks.supportThread.mockResolvedValue({ account, messages: [] }) })

    render(<AdminMobilePage />)
    await user.click(tab('Чаты'))
    await user.click((await screen.findByText('Kotik_Pro')).closest('button')!)
    const sheet = await screen.findByRole('dialog', { name: 'Kotik_Pro' })
    fireEvent.contextMenu(await within(sheet).findByText('Реклама казино'))
    await user.click(await screen.findByRole('menuitem', { name: 'Удалить' }))
    expect(mocks.supportDeleteMessage).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Точно удалить?' }))
    await waitFor(() => expect(mocks.supportDeleteMessage).toHaveBeenCalledWith(accountId, 9))
    await waitFor(() => expect(within(sheet).queryByText('Реклама казино')).not.toBeInTheDocument())
  })

})
