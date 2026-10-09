import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InviteProgram } from '../api'

/** «Пригласи друга»: the cabinet panel of a player and the /r/<code> banner for a friend's code. */
const mocks = vi.hoisted(() => ({
  auth: { status: 'ready' as string, token: 'session-token' as string | null, account: null as unknown },
  invites: vi.fn(),
  referralVisit: vi.fn(),
  payments: vi.fn(),
  plans: vi.fn(),
}))

vi.mock('../auth', () => ({
  useAuth: () => ({ ...mocks.auth, error: null, reload: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn(), setAccount: vi.fn(), adopt: vi.fn() }),
}))
// The landing renders the home page: the trailer video and the long presentation are not needed here.
vi.mock('../components/Trailer', () => ({ Trailer: () => null }))
vi.mock('../components/promo/Presentation', () => ({ Presentation: () => null }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  const answers: Record<string, unknown> = { invites: mocks.invites, referralVisit: mocks.referralVisit, payments: mocks.payments, plans: mocks.plans }
  // Everything else stays pending: these tests only look at what is rendered.
  const api = new Proxy({}, { get: (_target, key: string) => answers[key] ?? (() => new Promise(() => {})) })
  return { ...actual, api }
})

const { CabinetPage } = await import('./CabinetPage')
const { ReferralLandingPage } = await import('./ReferralLandingPage')

const ranks = [
  { id: 'scout', title: 'Scout', friends: 1, bonusDays: 0 },
  { id: 'operator', title: 'Operator', friends: 3, bonusDays: 30 },
  { id: 'squad-leader', title: 'Squad Leader', friends: 10, bonusDays: 90 },
  { id: 'raid-commander', title: 'Raid Commander', friends: 25, bonusDays: 365 },
  { id: 'legend', title: 'Legend', friends: 50, bonusDays: 'lifetime' },
] as const

const program: InviteProgram = {
  code: 'RAID-K7Q2M',
  discountPercent: 20,
  rewardDays: 7,
  holdDays: 14,
  invited: 4,
  paid: 3,
  confirmed: 1,
  rank: { id: 'scout', title: 'Scout' },
  next: { id: 'operator', title: 'Operator', friends: 3, bonusDays: 30 },
  ranks: [...ranks],
  rewards: [
    { id: 4, kind: 'friend', days: 7, status: 'pending', createdAt: '2026-10-06T10:00:00.000Z', releaseAt: '2026-10-20T10:00:00.000Z', friend: 'a***@mail.ru' },
    { id: 3, kind: 'friend', days: 7, status: 'review', createdAt: '2026-10-05T10:00:00.000Z', friend: 'b***@mail.ru' },
    { id: 2, kind: 'friend', days: 7, status: 'canceled', createdAt: '2026-10-02T10:00:00.000Z', decidedAt: '2026-10-03T10:00:00.000Z', friend: 'c***@mail.ru' },
    { id: 1, kind: 'friend', days: 7, status: 'granted', createdAt: '2026-09-01T10:00:00.000Z', decidedAt: '2026-09-15T10:00:00.000Z', friend: 'd***@mail.ru' },
  ],
}

const player = { email: 'me@example.com', kind: 'user', createdAt: '2026-09-01T10:00:00.000Z', nicknames: {}, subscription: { status: 'inactive' }, emailVerifiedAt: '2026-09-01T10:00:00.000Z' }
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('«Пригласи друга»', () => {
  beforeEach(() => {
    mocks.invites.mockResolvedValue(program)
    mocks.payments.mockResolvedValue({ payments: [], autopay: null, friendDiscount: null })
    mocks.plans.mockReturnValue(new Promise(() => {}))
    try { window.sessionStorage.clear() } catch { /* ignore */ }
  })
  afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.auth = { status: 'ready', token: 'session-token', account: null } })

  it('the cabinet shows the code, the link, counters, the rank progress and reward statuses', async () => {
    mocks.auth.account = player
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const scope = within(await screen.findByRole('region', { name: 'Пригласи друга' }))

    expect(await scope.findByTestId('invite-code')).toHaveTextContent('RAID-K7Q2M')
    expect(scope.getByText(`${window.location.origin}/r/RAID-K7Q2M`)).toBeInTheDocument()
    expect(scope.getByText('Ещё 2 оплаты до Operator — +1 месяц Premium')).toBeInTheDocument()
    expect(scope.getAllByText('Scout').length).toBeGreaterThan(0)
    expect(scope.getByText('Зарегистрировались')).toBeInTheDocument()
    expect(scope.getByText('Подтверждено')).toBeInTheDocument()
    // Ladder
    expect(scope.getByText('7 дней за друга')).toBeInTheDocument()
    expect(scope.getByText('Premium навсегда')).toBeInTheDocument()
    // Statuses
    expect(scope.getByText(/^На проверке до 20 окт/)).toBeInTheDocument()
    expect(scope.getByText('Проверяет администрация')).toBeInTheDocument()
    expect(scope.getByText('Начислено')).toBeInTheDocument()
    expect(scope.getByText('Не засчитано')).toBeInTheDocument()
    // The code cannot be changed: friends already registered by it.
    expect(scope.queryByText('Изменить код')).toBeNull()
    expect(scope.getByText(/Награды — дни Premium, деньгами не выводятся/)).toBeInTheDocument()
  })

  it('offers «Изменить код» while nobody used the code', async () => {
    mocks.auth.account = player
    mocks.invites.mockResolvedValue({ ...program, invited: 0, paid: 0, confirmed: 0, rank: null, next: { ...ranks[0] }, rewards: [] })
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    expect(await screen.findByText('Изменить код')).toBeInTheDocument()
    expect(screen.getByText('Ещё 1 оплата до Scout — 7 дней Premium за каждого друга')).toBeInTheDocument()
  })

  it('the 1-month plan shows the friend price', async () => {
    mocks.auth.account = player
    mocks.plans.mockResolvedValue({ enabled: true, plans: [{ id: '1m', months: 1, price: 299, currency: 'RUB', discountPercent: 0 }] })
    mocks.payments.mockResolvedValue({ payments: [], autopay: null, friendDiscount: { percent: 20, plan: '1m' } })
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    expect(await screen.findByText('−20 % по приглашению, только первый месяц')).toBeInTheDocument()
    expect(document.querySelector('.plan-old')?.textContent?.replace(/\s/g, '')).toBe('299₽')
  })

  it('streamers do not get the panel and the program is not requested', async () => {
    mocks.auth.account = { ...player, kind: 'streamer', referralCode: 'HUNTER_TV', subscription: { status: 'active', lifetime: true } }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    await settle()
    expect(screen.queryByText('Пригласи друга')).toBeNull()
    expect(mocks.invites).not.toHaveBeenCalled()
  })

  it('/r/<friend code> shows the friend banner with the 20 % discount', async () => {
    mocks.auth = { status: 'signed-out', token: null, account: null }
    mocks.referralVisit.mockResolvedValue({ ok: true, code: 'RAID-K7Q2M', kind: 'friend' })
    render(<MemoryRouter initialEntries={['/r/RAID-K7Q2M']}><Routes><Route path="/r/:code" element={<ReferralLandingPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText(/Друг пригласил вас в Raid OS/)).toBeInTheDocument()
    expect(screen.getByText('Зарегистрируйтесь — скидка 20 % на первый месяц.')).toBeInTheDocument()
    expect(screen.queryByText(/3 дня бесплатного доступа/)).toBeNull()
    // The home page section with the ranks ladder.
    expect(screen.getByRole('heading', { name: 'Raid OS выгоднее с отрядом' })).toBeInTheDocument()
    expect(screen.getByText('Legend')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Зарегистрироваться' }).every((link) => link.getAttribute('href') === '/register')).toBe(true)
  })

  it('/r/<streamer code>: a plain invitation, no free days (streamer programme paused)', async () => {
    mocks.auth = { status: 'signed-out', token: null, account: null }
    mocks.referralVisit.mockResolvedValue({ ok: true, code: 'HUNTER_TV', kind: 'streamer' })
    render(<MemoryRouter initialEntries={['/r/HUNTER_TV']}><Routes><Route path="/r/:code" element={<ReferralLandingPage />} /></Routes></MemoryRouter>)
    await settle()
    expect(screen.getByText('Зарегистрируйтесь по приглашению.')).toBeInTheDocument()
    expect(screen.queryByText(/3 дня бесплатного доступа/)).toBeNull()
    expect(screen.queryByText(/Друг пригласил вас/)).toBeNull()
  })
})
