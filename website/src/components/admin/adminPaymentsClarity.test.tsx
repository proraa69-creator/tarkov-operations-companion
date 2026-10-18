import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminInviteReward, AdminPayment } from '../../api'

/**
 * Owner, 17.10.2026: «Должно писаться, от кого пришло, от кого человек пришёл, кто пришёл, аккаунты их… в платежах у
 * каждого менять платёж, сколько он заплатил».
 */
const mocks = vi.hoisted(() => ({ payments: vi.fn(), setAmount: vi.fn(), rewards: vi.fn(), decide: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminPayments: mocks.payments, adminSetPaymentAmount: mocks.setAmount, adminInviteRewards: mocks.rewards, adminDecideInviteReward: mocks.decide } }
})

const { AdminPayments } = await import('./AdminPayments')
const { AdminInviteRewards } = await import('./AdminInviteRewards')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const friendPayment: AdminPayment = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa', accountId: 'f', email: 'friend@mail.ru', nickname: 'Friend_1', plan: '1m', provider: 'boosty', status: 'succeeded', amount: 240,
  createdAt: '2026-10-14T10:00:00.000Z', paidAt: '2026-10-14T10:01:00.000Z', friendDiscount: { percent: 20, inviter: 'inviter@mail.ru' },
  invitedBy: { id: 'i', email: 'inviter@mail.ru', nickname: 'Inviter_1' },
}
const streamerPayment: AdminPayment = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbb', email: 'viewer@mail.ru', plan: '3m', provider: 'yookassa', status: 'succeeded', amount: 810, createdAt: '2026-10-14T11:00:00.000Z',
  referralCode: 'HUNTER', streamerEarning: 81,
}
const list = (payments: AdminPayment[], revenue: number) => ({ payments, total: payments.length, totals: { succeeded: payments.length, revenue, streamerEarnings: 0 } })

describe('«Платежи»: who paid, who invited, and the amount the owner can change', () => {
  it('each row names the payer and where he came from, with the accounts', async () => {
    mocks.payments.mockResolvedValue(list([friendPayment, streamerPayment], 1050))
    render(<AdminPayments />)
    const [friendRow, streamerRow] = (await screen.findAllByText('Оплатил:')).map((label) => label.closest('tr')!)
    expect(within(friendRow!).getByText('· Friend_1')).toBeInTheDocument()
    expect(within(friendRow!).getByText('Пришёл по приглашению:')).toBeInTheDocument()
    expect(within(friendRow!).getByRole('link', { name: 'inviter@mail.ru' })).toHaveAttribute('href', '/admin?tab=users&q=inviter%40mail.ru')
    expect(within(friendRow!).getByText('· Inviter_1')).toBeInTheDocument()
    expect(within(friendRow!).getByText('Boosty')).toBeInTheDocument()
    expect(within(streamerRow!).getByText(/Пришёл по коду стримера/)).toHaveTextContent('Пришёл по коду стримера HUNTER')
  })

  it('«Изменить сумму»: the old amount stays in sight, the new one and the comment go to the server, the list reloads', async () => {
    mocks.payments.mockResolvedValueOnce(list([streamerPayment], 810))
      .mockResolvedValue(list([{ ...streamerPayment, amount: 700, streamerEarning: 70, amountEdited: { before: 810, at: '2026-10-17T10:00:00.000Z' } }], 700))
    mocks.setAmount.mockResolvedValue({ ...streamerPayment, amount: 700 })
    render(<AdminPayments />)
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить сумму' }))
    const form = screen.getByRole('form', { name: 'Сумма платежа viewer@mail.ru' })
    expect(within(form).getByText(/Было: 810/)).toBeInTheDocument()
    const input = within(form).getByRole('textbox', { name: 'Новая сумма, ₽' })
    fireEvent.change(input, { target: { value: '12,345' } })
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '700' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Комментарий' }), { target: { value: 'частичный возврат' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.setAmount).toHaveBeenCalledWith('owner-token', 'bbbbbbbbbbbbbbbbbbbbbbbb', 700, 'частичный возврат'))
    expect(await screen.findByText('изменено, было 810 ₽')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /Сумма платежа/ })).not.toBeInTheDocument()
    expect(mocks.payments).toHaveBeenCalledTimes(2)
  })

  it('«Отмена» closes the editor without a request; an archived payment has no button', async () => {
    mocks.payments.mockResolvedValue(list([{ ...streamerPayment, id: 'c'.repeat(24), email: 'old@mail.ru', provider: 'archive' }, friendPayment], 1050))
    render(<AdminPayments />)
    const buttons = await screen.findAllByRole('button', { name: 'Изменить сумму' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('form', { name: /Сумма платежа/ })).not.toBeInTheDocument()
    expect(mocks.setAmount).not.toHaveBeenCalled()
  })
})

const reward = (patch: Partial<AdminInviteReward>): AdminInviteReward => ({
  id: 1, kind: 'friend', days: 7, status: 'pending', createdAt: '2026-10-14T10:00:00.000Z', inviterId: 'i', inviter: 'inviter@mail.ru', inviterNickname: 'Inviter_1',
  friendId: 'f', friend: 'friend@mail.ru', friendNickname: 'Friend_1', flags: [],
  payment: { amount: 240, status: 'succeeded', provider: 'yookassa', plan: '1m', discountPercent: 20, paidAt: '2026-10-14T10:01:00.000Z' }, ...patch,
})

describe('«Награды за друзей»: who invited whom, the friend\'s payment and the status in words', () => {
  it('names both accounts and says why a reward waits, in Russian', async () => {
    mocks.rewards.mockResolvedValue({
      rewards: [
        reward({ id: 1, status: 'review', flags: ['same-device', 'same-card'] }),
        reward({ id: 2, status: 'pending', releaseAt: '2026-10-28T10:00:00.000Z' }),
        reward({ id: 3, status: 'granted', decidedAt: '2026-10-16T10:00:00.000Z' }),
        reward({ id: 4, status: 'canceled', comment: 'платёж друга возвращён', friend: undefined, friendNickname: undefined, friendDeleted: true }),
      ],
      total: 4, counts: { review: 1, pending: 1, granted: 1, canceled: 1 },
    })
    render(<AdminInviteRewards />)
    const items = (await screen.findAllByText('Пригласивший:')).map((label) => label.closest('li')!)
    expect(within(items[0]!).getByRole('link', { name: 'inviter@mail.ru' })).toBeInTheDocument()
    expect(within(items[0]!).getByRole('link', { name: 'friend@mail.ru' })).toBeInTheDocument()
    expect(within(items[0]!).getByText('у администрации: тот же компьютер, что у пригласившего; оплачено картой пригласившего')).toBeInTheDocument()
    expect(within(items[0]!).getByText(/Платёж друга: 240 ₽ · 1 мес · ЮKassa · скидка −20 % · оплачен/)).toBeInTheDocument()
    expect(within(items[1]!).getByText(/^на проверке до /)).toBeInTheDocument()
    expect(within(items[2]!).getByText(/^начислено /)).toBeInTheDocument()
    expect(within(items[3]!).getByText('не засчитано: платёж друга возвращён')).toBeInTheDocument()
    expect(within(items[3]!).getByText('аккаунт удалён')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Засчитать' })).toHaveLength(1)
  })

  it('«Засчитать» decides a reward held for the owner and reloads the list', async () => {
    mocks.rewards.mockResolvedValue({ rewards: [reward({ status: 'review', flags: ['burst'] })], total: 1, counts: { review: 1 } })
    mocks.decide.mockResolvedValue(reward({ status: 'pending' }))
    render(<AdminInviteRewards />)
    fireEvent.click(await screen.findByRole('button', { name: 'Засчитать' }))
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith('owner-token', 1, 'approve', undefined))
    await waitFor(() => expect(mocks.rewards).toHaveBeenCalledTimes(2))
  })
})
