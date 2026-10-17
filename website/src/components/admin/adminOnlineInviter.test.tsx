import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AdminCalendar as Calendar, type AdminDay, type AdminUser } from '../../api'

/**
 * Owner, 14.10.2026: «Онлайн сейчас» at the top of the admin panel, and «Пришёл от» naming the friend whose code gave
 * the discount (the users table, the calendar day, the payments).
 */
const mocks = vi.hoisted(() => ({ online: vi.fn(), users: vi.fn(), calendar: vi.fn(), day: vi.fn(), payments: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminOnline: mocks.online, adminUsers: mocks.users, adminCalendar: mocks.calendar, adminDay: mocks.day, adminPayments: mocks.payments } }
})

const { AdminOnline, ADMIN_ONLINE_REFRESH_MS } = await import('./AdminOnline')
const { AdminUsers } = await import('./AdminUsers')
const { AdminCalendar } = await import('./AdminCalendar')
const { AdminPayments } = await import('./AdminPayments')

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('admin panel: «Онлайн сейчас»', () => {
  it('shows the number with the PC / phone split and the window', async () => {
    mocks.online.mockResolvedValue({ online: 12, pc: 9, phone: 4, windowMinutes: 5, at: '2026-10-14T12:00:00.000Z' })
    render(<AdminOnline />)
    const line = await screen.findByRole('status', { name: /Онлайн сейчас: 12/ })
    expect(line).toHaveTextContent('Онлайн сейчас: 12')
    expect(line).toHaveTextContent('ПК 9 · телефон 4')
    expect(line).toHaveTextContent('за 5 мин')
    expect(line).toHaveAttribute('title', expect.stringContaining('за последние 5 мин. Посещения сайта не считаются.'))
    expect(mocks.online).toHaveBeenCalledWith('owner-token')
  })

  it('refreshes every ~45 s while the tab is visible, not while it is hidden, and at once when shown again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    mocks.online.mockResolvedValueOnce({ online: 1, pc: 1, phone: 0, windowMinutes: 5, at: '' }).mockResolvedValue({ online: 2, pc: 1, phone: 1, windowMinutes: 5, at: '' })
    render(<AdminOnline />)
    await screen.findByText('1')
    await act(async () => { vi.advanceTimersByTime(ADMIN_ONLINE_REFRESH_MS) })
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(mocks.online).toHaveBeenCalledTimes(2)
    act(() => setVisibility('hidden'))
    await act(async () => { vi.advanceTimersByTime(ADMIN_ONLINE_REFRESH_MS * 3) })
    expect(mocks.online).toHaveBeenCalledTimes(2)
    act(() => setVisibility('visible'))
    await waitFor(() => expect(mocks.online).toHaveBeenCalledTimes(3))
  })

  it('a server without the route shows nothing', async () => {
    mocks.online.mockRejectedValue(new ApiError(404, 'Не найдено'))
    render(<AdminOnline />)
    await waitFor(() => expect(mocks.online).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })
})

const base = { kind: 'user' as const, createdAt: '2026-10-13T10:00:00.000Z', subscription: { status: 'inactive' as const }, autopay: null, payments: { count: 0, total: 0 } }
const users: AdminUser[] = [
  { ...base, id: 'a'.repeat(24), email: 'friend@mail.ru', invitedBy: { id: 'i'.repeat(24), email: 'inviter@mail.ru', nickname: 'Inviter_Nick', discount: 'used' } },
  { ...base, id: 'b'.repeat(24), email: 'waiting@mail.ru', invitedBy: { id: 'i'.repeat(24), email: 'inviter@mail.ru', discount: 'unused' } },
  { ...base, id: 'c'.repeat(24), email: 'orphan@mail.ru', invitedBy: { id: 'd'.repeat(24), deleted: true, discount: 'lost' } },
  { ...base, id: 'e'.repeat(24), email: 'viewer@mail.ru', referredBy: 'HUNTER' },
  { ...base, id: 'f'.repeat(24), email: 'plain@mail.ru' },
]

describe('admin users: «Пришёл от»', () => {
  it('names the inviting friend with the nickname and the discount; a deleted one; streamer codes as before', async () => {
    mocks.users.mockResolvedValue({ users, total: users.length })
    render(<AdminUsers />)
    const cell = (email: string) => within(screen.getByRole('rowheader', { name: new RegExp(email) }).closest('tr')!).getByText((_, element) => element?.getAttribute('data-label') === 'Пришёл от')
    await screen.findByText('friend@mail.ru')
    const friend = cell('friend@mail.ru')
    expect(friend).toHaveTextContent('inviter@mail.ru')
    expect(friend).toHaveTextContent('Inviter_Nick')
    expect(within(friend).getByText('друг · скидка')).toBeInTheDocument()
    expect(within(friend).getByText('скидка использована')).toBeInTheDocument()
    expect(within(cell('waiting@mail.ru')).getByText('скидка ещё не использована')).toBeInTheDocument()
    const orphan = cell('orphan@mail.ru')
    expect(orphan).toHaveTextContent('друг (аккаунт удалён)')
    expect(within(orphan).getByText('оплатил без скидки')).toBeInTheDocument()
    const viewer = cell('viewer@mail.ru')
    expect(viewer).toHaveTextContent('HUNTER')
    expect(within(viewer).getByText('стример')).toBeInTheDocument()
    expect(within(viewer).queryByText('друг · скидка')).toBeNull()
    expect(cell('plain@mail.ru')).toHaveTextContent('—')
  })

  it('the inviter\'s e-mail can be searched', async () => {
    mocks.users.mockResolvedValue({ users, total: users.length })
    render(<AdminUsers />)
    await screen.findByText('friend@mail.ru')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'inviter@mail.ru' } })
    fireEvent.click(screen.getByRole('button', { name: /Найти/ }))
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith('owner-token', 'inviter@mail.ru', 'all', 50, 0, 'all'))
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', expect.stringContaining('e-mail пригласившего'))
  })
})

const plans = { '1m': { count: 1, revenue: 240 }, '3m': { count: 0, revenue: 0 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } }

describe('calendar day and payments: the inviter instead of a bare flag', () => {
  it('the day window names the inviter of a registration and of a discounted payment', async () => {
    const month = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7)
    const date = `${month}-01`
    const calendar: Calendar = { month, today: `${month}-28`, days: Array.from({ length: 28 }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, '0')}`, registrations: index === 0 ? 3 : 0, payments: index === 0 ? 1 : 0, revenue: index === 0 ? 240 : 0, plans })) }
    const day: AdminDay = {
      date,
      totals: { registrations: 3, payments: 1, revenue: 240, streamerEarnings: 0, plans },
      registrations: [
        { id: 'a', email: 'friend@mail.ru', kind: 'user', createdAt: `${date}T09:00:00.000Z`, invitedByFriend: true, invitedBy: { id: 'i', email: 'inviter@mail.ru' } },
        { id: 'b', email: 'orphan@mail.ru', kind: 'user', createdAt: `${date}T09:10:00.000Z`, invitedByFriend: true, invitedBy: { id: 'd', deleted: true } },
        // An older server: only the flag.
        { id: 'c', email: 'old@mail.ru', kind: 'user', createdAt: `${date}T09:20:00.000Z`, invitedByFriend: true },
      ],
      payments: [{ id: 'p1', email: 'friend@mail.ru', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 240, createdAt: `${date}T10:00:00.000Z`, paidAt: `${date}T10:01:00.000Z`, friendDiscount: { percent: 20, inviter: 'inviter@mail.ru' } }],
      grants: [],
      invites: [],
    }
    mocks.calendar.mockResolvedValue(calendar)
    mocks.day.mockResolvedValue(day)
    render(<AdminCalendar />)
    fireEvent.click(await screen.findByRole('gridcell', { name: /^1 число/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('от inviter@mail.ru')).toBeInTheDocument()
    expect(within(dialog).getByText('от друг (аккаунт удалён)')).toBeInTheDocument()
    expect(within(dialog).getByText('по коду друга')).toBeInTheDocument()
    expect(within(dialog).getByText('скидка друга −20 % · от inviter@mail.ru')).toBeInTheDocument()
  })

  it('«Платежи» marks a payment made with the friend\'s discount and names the inviter', async () => {
    mocks.payments.mockResolvedValue({
      payments: [
        { id: 'p1', email: 'friend@mail.ru', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 240, createdAt: '2026-10-14T10:00:00.000Z', paidAt: '2026-10-14T10:01:00.000Z', friendDiscount: { percent: 20, inviter: 'inviter@mail.ru' } },
        { id: 'p2', email: 'orphan@mail.ru', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 240, createdAt: '2026-10-14T11:00:00.000Z', friendDiscount: { percent: 20, inviterDeleted: true } },
        { id: 'p3', email: 'payer@mail.ru', plan: '1m', provider: 'yookassa', status: 'succeeded', amount: 300, createdAt: '2026-10-14T12:00:00.000Z' },
      ],
      total: 3,
      totals: { succeeded: 3, revenue: 780, streamerEarnings: 0 },
    })
    render(<AdminPayments />)
    expect(await screen.findByText('скидка друга −20 % · от inviter@mail.ru')).toBeInTheDocument()
    expect(screen.getByText('скидка друга −20 % · друг (аккаунт удалён)')).toBeInTheDocument()
    expect(screen.getAllByText(/скидка друга/)).toHaveLength(2)
  })
})
