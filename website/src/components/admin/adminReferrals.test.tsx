import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminReferrals, AdminReferrerDetail } from '../../api'

/**
 * Owner, 03.11.2026: «кнопку привлечения друзей… список тех, кто привел друзей… сколько оплатили, сколько
 * зарегистрировались но не оплатили… максимальное количество… сколько дней им положено, через сколько будет выдано, и
 * выдано ли им».
 */
const mocks = vi.hoisted(() => ({ referrals: vi.fn(), referrer: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminReferrals: mocks.referrals, adminReferrer: mocks.referrer } }
})

const { AdminReferrals: ReferralsTab } = await import('./AdminReferrals')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const DAY = 86_400_000
const rewards = (granted: number, pending: number, review = 0) => ({ granted, pending, review, canceled: 0 })
const list: AdminReferrals = {
  summary: {
    withCode: 667, referrers: 2, invited: 5, paid: 3, unpaid: 2, friendsDeleted: 1,
    top: { id: 'a'.repeat(24), invited: 4, email: 'alpha@example.com', nickname: 'Alpha_1' },
    days: { granted: 7, pending: 14, review: 7 }, rewards: rewards(1, 2, 1), waitingEft: 1, lifetime: 0,
    rewardDays: 7, holdDays: 3, discountPercent: 20,
    ranks: [
      { id: 'scout', title: 'Scout', friends: 1, bonusDays: 0 }, { id: 'operator', title: 'Operator', friends: 3, bonusDays: 30 },
      { id: 'legend', title: 'Legend', friends: 50, bonusDays: 'lifetime' },
    ],
  },
  referrers: [
    {
      id: 'a'.repeat(24), email: 'alpha@example.com', nickname: 'Alpha_1', code: 'RAID-ALPHA', invited: 4, paid: 3, unpaid: 1, friendsDeleted: 0, confirmed: 1,
      rank: { id: 'scout', title: 'Scout' }, days: { granted: 7, pending: 14, review: 0 }, rewards: rewards(1, 2), waitingEft: 1,
      nextReleaseAt: new Date(Date.now() + 2.5 * DAY).toISOString(),
    },
    { id: 'b'.repeat(24), deleted: true, invited: 1, paid: 0, unpaid: 1, friendsDeleted: 1, confirmed: 0, days: { granted: 0, pending: 0, review: 7 }, rewards: rewards(0, 0, 1), waitingEft: 0 },
  ],
  total: 2,
}
const friendOf = (email: string, extra: Partial<AdminReferrerDetail['friends'][number]>): AdminReferrerDetail['friends'][number] => ({
  id: email.replace(/\W/g, '').padEnd(24, '0').slice(0, 24), email, invitedAt: '2026-10-20T10:00:00.000Z', paid: false, payments: 0, amount: 0, eftBound: true, ...extra,
})
const paidFirst = (discountPercent?: number) => ({ amount: discountPercent ? 240 : 800, plan: discountPercent ? '1m' : '3m', provider: 'yookassa' as const, status: 'succeeded', ...(discountPercent ? { discountPercent } : {}), paidAt: '2026-10-21T10:00:00.000Z' })
const detail: AdminReferrerDetail = {
  referrer: list.referrers[0]!,
  friends: [
    friendOf('a1@example.com', { paid: true, payments: 1, amount: 240, first: paidFirst(20), reward: { id: 1, kind: 'friend', days: 7, status: 'granted', createdAt: '2026-10-21T10:00:00.000Z', decidedAt: '2026-10-24T11:00:00.000Z', flags: [] } }),
    friendOf('a2@example.com', { paid: true, payments: 1, amount: 240, first: paidFirst(20), reward: { id: 2, kind: 'friend', days: 7, status: 'pending', createdAt: '2026-11-03T10:00:00.000Z', releaseAt: new Date(Date.now() + 2.5 * DAY).toISOString(), flags: [] } }),
    friendOf('a3@example.com', { paid: true, payments: 1, amount: 240, eftBound: false, first: paidFirst(20), reward: { id: 3, kind: 'friend', days: 7, status: 'pending', createdAt: '2026-11-03T10:00:00.000Z', releaseAt: '2026-11-06T10:00:00.000Z', waitingEft: true, flags: [] } }),
    friendOf('a4@example.com', {}),
    friendOf('b1@example.com', { paid: true, payments: 2, amount: 1100, first: paidFirst() }),
  ],
  rewards: [],
}

describe('«Привлечение друзей»: the program in numbers and every inviter with his friends', () => {
  it('shows who takes part, the most friends, paid and unpaid, and the days granted, coming and waiting', async () => {
    mocks.referrals.mockResolvedValue(list)
    render(<ReferralsTab />)
    await screen.findByText('alpha@example.com')
    expect(mocks.referrals).toHaveBeenCalledWith('owner-token', '', 'invited')
    // A tile by its label (the table's head says «Оплатили» too).
    const tile = (label: string) => screen.getAllByText(label).map((element) => element.closest('.stat-card')).find(Boolean) as HTMLElement
    expect(within(tile('Участвуют')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Участвуют')).getByText(/открыли «Пригласи друга»: 667/)).toBeInTheDocument()
    expect(within(tile('Больше всех привёл')).getByText('4')).toBeInTheDocument()
    expect(within(tile('Больше всех привёл')).getByText('alpha@example.com · Alpha_1')).toBeInTheDocument()
    expect(within(tile('Оплатили')).getByText('60 % приглашённых')).toBeInTheDocument()
    expect(within(tile('Дней ждут выдачи')).getByText(/ждут входа друга в приложение для ПК: 1/)).toBeInTheDocument()
    expect(within(tile('Ждут вашего решения')).getByText(/«Платежи» → «Награды за друзей»/)).toBeInTheDocument()
    expect(screen.getByText(/Ранги за подтверждённых друзей: 3 — \+30 дней, 50 — Premium навсегда/)).toBeInTheDocument()

    const row = screen.getByText('alpha@example.com').closest('tr') as HTMLElement
    expect(within(row).getByText('RAID-ALPHA')).toBeInTheDocument()
    expect(within(row).getByText('Scout')).toBeInTheDocument()
    expect([within(row).getByText('4'), within(row).getByText('3'), within(row).getByText('1')].length).toBe(3)
    expect(within(row).getByText('выдано 7 дней')).toBeInTheDocument()
    expect(within(row).getByText('ждут 14 дней')).toBeInTheDocument()
    expect(within(row).getByText(/· через 3 дня/)).toBeInTheDocument()
    expect(within(row).getByText('ждут входа друга в приложение для ПК: 1')).toBeInTheDocument()
    const deleted = screen.getByText('аккаунт удалён', { selector: '.admin-account' }).closest('tr') as HTMLElement
    expect(within(deleted).getByText('у вас 7 дней')).toBeInTheDocument()
  })

  it('a row opens the friends: paid or not and how, and where each reward stands', async () => {
    mocks.referrals.mockResolvedValue(list)
    mocks.referrer.mockResolvedValue(detail)
    render(<ReferralsTab />)
    const row = (await screen.findByText('alpha@example.com')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Друзья' }))
    await screen.findByText('a1@example.com')
    expect(mocks.referrer).toHaveBeenCalledWith('owner-token', 'a'.repeat(24))
    const friend = (email: string) => screen.getByText(email).closest('li') as HTMLElement
    expect(within(friend('a1@example.com')).getByText(/^выдано /)).toBeInTheDocument()
    expect(within(friend('a1@example.com')).getByText(/первая оплата: 240 ₽ · 1 мес · ЮKassa · скидка друга −20 %/)).toBeInTheDocument()
    expect(within(friend('a2@example.com')).getByText(/^будет выдано .*, через 3 дня$/)).toBeInTheDocument()
    expect(within(friend('a3@example.com')).getByText('выдадим, когда друг войдёт в приложение для ПК')).toBeInTheDocument()
    expect(within(friend('a3@example.com')).getByText('не входил в приложение для ПК')).toBeInTheDocument()
    expect(within(friend('a4@example.com')).getByText('не оплатил')).toBeInTheDocument()
    expect(within(friend('a4@example.com')).getByText('награда — после оплаты первого месяца со скидкой друга')).toBeInTheDocument()
    expect(within(friend('b1@example.com')).getByText('без награды: первая оплата прошла без скидки друга')).toBeInTheDocument()
    expect(within(friend('b1@example.com')).getByText(/всего 2 оплаты на 1 100 ₽/)).toBeInTheDocument()
  })

  it('search and sorting ask the server again', async () => {
    mocks.referrals.mockResolvedValue(list)
    render(<ReferralsTab />)
    await screen.findByText('alpha@example.com')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по e-mail, нику или коду' }), { target: { value: ' raid-alpha ' } })
    fireEvent.submit(screen.getByRole('search'))
    await waitFor(() => expect(mocks.referrals).toHaveBeenLastCalledWith('owner-token', 'raid-alpha', 'invited'))
    fireEvent.click(screen.getByRole('button', { name: 'Больше оплативших' }))
    await waitFor(() => expect(mocks.referrals).toHaveBeenLastCalledWith('owner-token', 'raid-alpha', 'paid'))
  })
})
