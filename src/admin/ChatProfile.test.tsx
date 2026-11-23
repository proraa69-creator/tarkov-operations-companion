import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { refreshServerStatus } from '../sync/serverSync'
import { AdminPanelPage } from '../pages/AdminPanelPage'
import { resetOwnerAccessForTests } from './ownerAccess'
import { AccountProfile } from './AccountProfile'
import { ChatPersonMenu } from './ChatPersonMenu'
import { usePersonMenu } from './personMenu'
import type { AdminAccountProfile } from './adminApi'

/**
 * «Посмотреть профиль» (owner, 24.11.2026: «я захожу в чат… нажимаю правой кнопкой, на телефоне зажимаю пальцем… у меня
 * открывается окошечко, и там будет посмотреть профиль… должна открываться отдельная вкладка с информацией о аккаунте»).
 */
const ID = 'a1b2c3d4e5f60718293a4b5c'
const plans = (one = 0, three = 0) => ({ '1m': { count: one, revenue: one * 300 }, '3m': { count: three, revenue: three * 800 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } })
const payment = (id: string, plan: '1m' | '3m', amount: number, at: string, status: 'succeeded' | 'refunded' = 'succeeded') => ({ id: id.padEnd(24, '0'), email: 'kotik.pro@example.com', plan, provider: 'yookassa' as const, status, amount, createdAt: at, paidAt: at, method: 'sbp' })

const full: AdminAccountProfile = {
  generatedAt: '2026-11-24T10:00:00.000Z',
  account: {
    id: ID, email: 'kotik.pro@example.com', emailVerifiedAt: '2026-07-01T10:00:00.000Z', kind: 'user', createdAt: '2026-07-01T09:00:00.000Z', country: 'RU', payRegion: 'RU',
    nickname: 'Kotik_Pro', eftAccount: { masked: '••••482', boundAt: '2026-07-02T10:00:00.000Z' },
  },
  subscription: { status: 'active', paidUntil: '2027-01-01T00:00:00.000Z', source: 'money' },
  autopay: { provider: 'yookassa', status: 'active', plan: '1m' },
  origin: { invitedBy: { id: 'b'.repeat(24), email: 'sniper.wolf@example.com', nickname: 'SniperWolf', discount: 'used' } },
  payments: {
    count: 3, total: 1400, refunded: { count: 1, total: 300 },
    first: { at: '2026-07-07T10:00:00.000Z', plan: '1m', amount: 300 },
    last: { at: '2026-11-16T10:00:00.000Z', plan: '1m', amount: 300 },
    months: [{ month: '2026-11', count: 2, revenue: 1100, plans: { '3m': 1, '1m': 1 } }, { month: '2026-07', count: 1, revenue: 300, plans: { '1m': 1 } }],
    plans: plans(2, 1),
    list: [payment('p3', '1m', 300, '2026-11-16T10:00:00.000Z'), payment('p2', '3m', 800, '2026-11-02T10:00:00.000Z'), payment('p1', '1m', 300, '2026-07-07T10:00:00.000Z')],
    more: false,
  },
  grants: [],
  activity: {
    lastSeenAt: '2026-11-24T09:48:00.000Z', pcSeenAt: '2026-11-24T09:48:00.000Z', phoneSeenAt: '2026-11-22T10:00:00.000Z', firstAppAt: '2026-07-02T10:00:00.000Z',
    phone: { used: true, android: true, ios: false },
    devices: [
      { kind: 'pc', name: 'Windows · DESKTOP-1 · Raid OS 0.6.0', firstAt: '2026-07-02T10:00:00.000Z', lastAt: '2026-11-24T09:48:00.000Z', active: true },
      { kind: 'android', name: 'Android · Raid OS', firstAt: '2026-10-25T10:00:00.000Z', lastAt: '2026-11-22T10:00:00.000Z', active: true },
    ],
    online: { pc: true, phone: false, windowMinutes: 5 },
  },
  referrals: {
    inviteCode: 'KOTIK', invited: 2, deleted: 0, paid: 1, revenue: 540, more: false,
    friends: [
      { id: 'c'.repeat(24), email: 'new.player@example.com', invitedAt: '2026-11-21T10:00:00.000Z', payments: 0, amount: 0 },
      { id: 'd'.repeat(24), email: 'tarkov.fan@example.com', nickname: 'TarkovFan', invitedAt: '2026-10-15T10:00:00.000Z', payments: 2, amount: 540, firstPaidAt: '2026-10-16T10:00:00.000Z', firstPlan: '1m' },
    ],
    rewards: { granted: 1, pending: 0, review: 0, canceled: 0, days: { granted: 7, pending: 0, review: 0 } },
  },
}

const bare: AdminAccountProfile = {
  generatedAt: '2026-11-24T10:00:00.000Z',
  account: { id: ID, email: 'new.player@example.com', kind: 'user', createdAt: '2026-11-21T10:00:00.000Z' },
  subscription: { status: 'inactive' },
  autopay: null,
  origin: {},
  payments: { count: 0, total: 0, refunded: { count: 0, total: 0 }, months: [], plans: plans(), list: [], more: false },
  grants: [],
  activity: { phone: { used: false, android: false, ios: false }, devices: [] },
  referrals: { invited: 0, deleted: 0, paid: 0, revenue: 0, friends: [], more: false, rewards: { granted: 0, pending: 0, review: 0, canceled: 0, days: { granted: 0, pending: 0, review: 0 } } },
}

/** A pointer event of a finger (jsdom has no PointerEvent: React reads pointerType off the event). */
function finger(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x = 20, y = 20) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  fireEvent(target, event)
}

function People({ onProfile, onOpen }: { onProfile: (id: string) => void; onOpen: (id: string) => void }) {
  const people = usePersonMenu()
  return <LocaleProvider>
    <button type="button" onClick={() => onOpen(ID)} {...people.bind({ accountId: ID, name: 'Kotik_Pro' })}>Kotik_Pro</button>
    <ChatPersonMenu menu={people.menu} onClose={people.close} onProfile={onProfile} onChat={onOpen} />
  </LocaleProvider>
}

beforeEach(() => {
  localStorage.clear()
  resetOwnerAccessForTests()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setRenderLanguage('ru')
})

describe('the menu on a person in the chats', () => {
  it('a right click: «Посмотреть профиль» and «Открыть чат»; arrows move, Escape closes and gives the focus back', async () => {
    const user = userEvent.setup()
    const onProfile = vi.fn()
    const onOpen = vi.fn()
    render(<People onProfile={onProfile} onOpen={onOpen} />)
    const person = screen.getByRole('button', { name: 'Kotik_Pro' })

    fireEvent.contextMenu(person, { clientX: 120, clientY: 40 })
    const menu = screen.getByRole('menu', { name: 'Kotik_Pro' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Посмотреть профиль', 'Открыть чат'])
    expect(within(menu).getByRole('menuitem', { name: 'Посмотреть профиль' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Открыть чат' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(person).toHaveFocus()

    fireEvent.contextMenu(person, { clientX: 120, clientY: 40 })
    await user.click(screen.getByRole('menuitem', { name: 'Посмотреть профиль' }))
    expect(onProfile).toHaveBeenCalledWith(ID)
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a long press opens the sheet and the lifted finger does not open the chat; a short tap opens it; a scrolling finger opens nothing', () => {
    vi.useFakeTimers()
    const onProfile = vi.fn()
    const onOpen = vi.fn()
    render(<People onProfile={onProfile} onOpen={onOpen} />)
    const person = screen.getByRole('button', { name: 'Kotik_Pro' })

    finger(person, 'pointerdown')
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => { vi.advanceTimersByTime(300) })
    const sheet = screen.getByRole('menu', { name: 'Kotik_Pro' })
    expect(sheet).toHaveClass('is-sheet')
    finger(person, 'pointerup')
    fireEvent.click(person)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('menu')).toBeNull()

    finger(person, 'pointerdown')
    act(() => { vi.advanceTimersByTime(150) })
    finger(person, 'pointerup')
    fireEvent.click(person)
    expect(onOpen).toHaveBeenCalledTimes(1)

    finger(person, 'pointerdown', 20, 20)
    finger(person, 'pointermove', 20, 60)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onProfile).not.toHaveBeenCalled()
  })

  it('in English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    render(<People onProfile={vi.fn()} onOpen={vi.fn()} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Kotik_Pro' }), { clientX: 10, clientY: 10 })
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['View profile', 'Open chat'])
  })
})

describe('the profile', () => {
  it('four parts: the account, the payments with the first one and the plans by month, the activity with the phone, the friends', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const onChat = vi.fn()
    const load = vi.fn().mockResolvedValue(full)
    render(<LocaleProvider><AccountProfile accountId={ID} load={load} onBack={onBack} backLabel={{ ru: 'К чату', en: 'Back to chat' }} onOpenChat={onChat} variant="page" /></LocaleProvider>)

    expect(await screen.findByRole('heading', { level: 2, name: 'Kotik_Pro' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledWith(ID)
    const card = (name: string) => screen.getByRole('region', { name })
    expect(within(card('Аккаунт')).getByText('kotik.pro@example.com')).toBeInTheDocument()
    expect(within(card('Аккаунт')).getByText('подтверждена 01.07.2026')).toBeInTheDocument()
    expect(within(card('Аккаунт')).getByText('••••482')).toBeInTheDocument()
    expect(within(card('Аккаунт')).getByText('01.07.2026, 16:00')).toBeInTheDocument()
    expect(within(card('Аккаунт')).getByText('Россия')).toBeInTheDocument()
    expect(within(card('Аккаунт')).getByText('не привязан', { selector: '.account-profile-none' })).toBeInTheDocument()
    expect(within(card('Аккаунт')).getByText(/по приглашению друга: SniperWolf/)).toBeInTheDocument()

    const payments = card('Оплаты')
    expect(within(payments).getByText('Первая оплата').parentElement).toHaveTextContent('07.07.2026')
    expect(within(payments).getByText('Первая оплата').parentElement).toHaveTextContent('1 мес.')
    expect(within(payments).getByText('Ноябрь 2026').parentElement).toHaveTextContent(/1 мес\.3 мес\.1\s100 ₽/)
    expect(within(payments).getByText('Июль 2026')).toBeInTheDocument()
    expect(within(payments).getByText('Возвраты').closest('div')).toHaveTextContent('1 на 300 ₽')
    expect(within(payments).getByText('ЮKassa · 1 мес. · включён')).toBeInTheDocument()

    const activity = card('Активность')
    expect(within(activity).getByText('С телефона').parentElement).toHaveTextContent('ДаAndroid')
    expect(within(activity).getByText('в приложении на ПК')).toBeInTheDocument()
    expect(within(activity).getByText('Windows · DESKTOP-1 · Raid OS 0.6.0')).toBeInTheDocument()
    expect(screen.getByText('Сейчас в приложении: ПК')).toBeInTheDocument()

    const referrals = card('Рефералы')
    expect(within(referrals).getByText('Привёл').parentElement).toHaveTextContent('2')
    expect(within(referrals).getByText('Оплатили').parentElement).toHaveTextContent('1из 2')
    expect(within(referrals).getByText('TarkovFan').closest('li')).toHaveTextContent(/540 ₽оплат: 2 · первая 1 мес\./)
    expect(within(referrals).getByText('KOTIK')).toBeInTheDocument()
    expect(within(referrals).getByText('выдано 7 дн.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Открыть чат' }))
    expect(onChat).toHaveBeenCalledWith(ID)
    await user.click(screen.getByRole('button', { name: 'К чату' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('what the server does not have is «нет данных» or said plainly, never made up', async () => {
    render(<LocaleProvider><AccountProfile accountId={ID} load={vi.fn().mockResolvedValue(bare)} onBack={vi.fn()} variant="sheet" /></LocaleProvider>)
    expect(await screen.findByRole('heading', { level: 2, name: 'new.player@example.com' })).toBeInTheDocument()
    const account = screen.getByRole('region', { name: 'Аккаунт' })
    expect(within(account).getByText('Ник в игре').closest('div')).toHaveTextContent('нет данных')
    expect(within(account).getByText('Страна').closest('div')).toHaveTextContent('не указана')
    expect(within(account).getByText('не подтверждена')).toBeInTheDocument()
    expect(screen.getByText('Оплат не было.')).toBeInTheDocument()
    expect(screen.getByText('В приложения не входил.')).toBeInTheDocument()
    expect(screen.getByText('Никого не приглашал.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Активность' })).toHaveTextContent('Сейчаснет данных')
    expect(screen.getAllByText('Без подписки').length).toBeGreaterThan(0)
  })

  it('in English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    render(<LocaleProvider><AccountProfile accountId={ID} load={vi.fn().mockResolvedValue(full)} onBack={vi.fn()} backLabel={{ ru: 'К чату', en: 'Back to chat' }} variant="page" /></LocaleProvider>)
    expect(await screen.findByRole('heading', { level: 2, name: 'Kotik_Pro' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Account', 'Activity', 'Payments', 'Referrals'])
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    expect(screen.getByText('In the app now: PC')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Подписка|Оплаты|Активность|Рефералы|нет данных|Россия/)
  })

  it('an older server without the profile says so; «Повторить» asks again', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValueOnce(new Error('Не найдено')).mockResolvedValueOnce(full)
    render(<LocaleProvider><AccountProfile accountId={ID} load={load} onBack={vi.fn()} name="Kotik_Pro" variant="sheet" /></LocaleProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер пока не отдаёт профиль: нужна новая версия сервера.')
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('region', { name: 'Оплаты' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the owner app: «Чат» → «Посмотреть профиль» → its own tab', () => {
  const thread = { accountId: ID, email: 'kotik.pro@example.com', nickname: 'Kotik_Pro', lastMessage: { id: 3, author: 'user', text: 'Карта не обновляется', createdAt: '2026-11-24T09:00:00.000Z', read: false }, lastAt: '2026-11-24T09:00:00.000Z', unread: 1 }

  async function desktop() {
    const serviceRequest = vi.fn(async (_method: string, path: string): Promise<unknown> => {
      if (path === '/v1/accounts/me/admin/features') return { features: { minimap: false } }
      if (path.startsWith('/v1/accounts/me/admin/support/threads?')) return { threads: [thread], total: 1, unread: 1 }
      if (path === `/v1/accounts/me/admin/support/threads/${ID}`) return { account: { id: ID, email: thread.email, nickname: thread.nickname }, messages: [thread.lastMessage] }
      if (path === `/v1/accounts/me/admin/users/${ID}/profile`) return full
      return null
    })
    Object.assign(window, { tarkovDesktop: { isDesktop: true, edition: 'owner', serviceRequest, account: { status: vi.fn().mockResolvedValue({ signedIn: true, email: 'owner@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }), login: vi.fn(), logout: vi.fn() } } })
    await refreshServerStatus()
    return serviceRequest
  }

  function Where() {
    const location = useLocation()
    return <output aria-label="адрес">{location.search}</output>
  }

  it('a right click on the person opens the profile tab under «Чат»; «К чату» goes back to the conversation', async () => {
    const user = userEvent.setup()
    const request = await desktop()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
    render(
      <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
        <MemoryRouter initialEntries={['/admin?tab=chat']}>
          <Routes><Route path="/admin" element={<><AdminPanelPage /><Where /></>} /></Routes>
        </MemoryRouter>
      </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
    )
    const person = await screen.findByRole('button', { name: /^Kotik_Pro/ })
    fireEvent.contextMenu(person, { clientX: 100, clientY: 100 })
    await user.click(screen.getByRole('menuitem', { name: 'Посмотреть профиль' }))

    await waitFor(() => expect(screen.getByRole('status', { name: 'адрес' })).toHaveTextContent(`?tab=profile&account=${ID}`))
    expect(screen.getByRole('tab', { name: /Профиль/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: 'Оплаты' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('GET', `/v1/accounts/me/admin/users/${ID}/profile`, undefined)

    await user.click(screen.getByRole('button', { name: 'К чату' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'адрес' })).toHaveTextContent(`?tab=chat&chat=${ID}`))
    expect(screen.queryByRole('tab', { name: /Профиль/ })).toBeNull()
    // The open conversation has «Профиль» too.
    await user.click(await screen.findByRole('button', { name: 'Профиль' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'адрес' })).toHaveTextContent(`?tab=profile&account=${ID}`))
  })
})
