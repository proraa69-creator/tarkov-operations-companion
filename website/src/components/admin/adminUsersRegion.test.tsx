import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser, AdminUserDetail } from '../../api'

/**
 * «Пользователи» by region (owner, 13.10.2026: «сделать в админ панели, в разделе пользователи, разделение снг и Европа.
 * список аккаунтов»): the tabs «Все · СНГ · Европа · Другие · Не указана» with counts, the country in rows and the card.
 */
const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), devices: vi.fn() }))

vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: null }) }))
vi.mock('../../api', async (original) => {
  const actual = await original<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, adminUsers: mocks.users, adminUser: mocks.user, adminDevices: mocks.devices } }
})

const { AdminUsers } = await import('./AdminUsers')

const user = (id: string, email: string, country?: string): AdminUser => ({
  id: id.repeat(24), email, kind: 'user', createdAt: '2026-10-13T10:00:00.000Z', subscription: { status: 'inactive' }, autopay: null, payments: { count: 0, total: 0 },
  ...(country ? { country } : {}),
})
const almaty = user('a', 'almaty@mail.ru', 'KZ')
const kyiv = user('b', 'kyiv@mail.ru', 'UA')
const old = user('c', 'old@mail.ru')
const regions = { all: 3, cis: 1, europe: 1, other: 0, none: 1 }

afterEach(() => { cleanup(); for (const mock of Object.values(mocks)) mock.mockReset() })

describe('admin users: СНГ and Европа', () => {
  it('shows the region tabs with counts and asks the server for the chosen region', async () => {
    mocks.users.mockImplementation(async (_token: string, _q: string, _filter: string, _limit: number, _offset: number, region = 'all') => ({
      users: region === 'cis' ? [almaty] : region === 'europe' ? [kyiv] : region === 'none' ? [old] : region === 'other' ? [] : [almaty, kyiv, old],
      total: region === 'all' ? 3 : region === 'other' ? 0 : 1,
      regions,
    }))
    render(<AdminUsers />)
    const tabs = await screen.findByRole('group', { name: 'Регион' })
    await waitFor(() => expect(within(tabs).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Все: 3', 'СНГ: 1', 'Европа: 1', 'Другие: 0', 'Не указана: 1']))
    expect(within(tabs).getByRole('button', { name: 'Все: 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.users).toHaveBeenLastCalledWith('owner-token', '', 'all', 50, 0, 'all')
    // The country in the rows (under the registration date): the name in Russian, «страна не указана» without one.
    const row = (email: string) => screen.getByText(email).closest('tr')!
    expect(within(row('almaty@mail.ru')).getByText('Казахстан')).toBeInTheDocument()
    expect(within(row('kyiv@mail.ru')).getByText('Украина')).toBeInTheDocument()
    expect(within(row('old@mail.ru')).getByText('страна не указана')).toBeInTheDocument()

    fireEvent.click(within(tabs).getByRole('button', { name: 'СНГ: 1' }))
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith('owner-token', '', 'all', 50, 0, 'cis'))
    await waitFor(() => expect(screen.queryByText('kyiv@mail.ru')).toBeNull())
    expect(screen.getByText('almaty@mail.ru')).toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: 'СНГ: 1' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(tabs).getByRole('button', { name: 'Другие: 0' }))
    expect(await screen.findByText('Никого не нашли.')).toBeInTheDocument()
    fireEvent.click(within(tabs).getByRole('button', { name: 'Не указана: 1' }))
    await waitFor(() => expect(mocks.users).toHaveBeenLastCalledWith('owner-token', '', 'all', 50, 0, 'none'))
    expect(await screen.findByText('old@mail.ru')).toBeInTheDocument()
  })

  it('the user card names the country and its region; an account without one says how it gets one', async () => {
    mocks.users.mockResolvedValue({ users: [almaty, old], total: 2, regions: { all: 2, cis: 1, europe: 0, other: 0, none: 1 } })
    mocks.user.mockImplementation(async (_token: string, id: string): Promise<AdminUserDetail> => ({ user: id === almaty.id ? almaty : old, payments: [], grants: [] }))
    mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
    render(<AdminUsers />)
    const [first, second] = await screen.findAllByRole('button', { name: /Действия/ })
    fireEvent.click(first!)
    expect(await screen.findByText((_, element) => element?.classList.contains('field-hint') === true && element.textContent === 'Казахстан · СНГ · KZ')).toBeInTheDocument()
    fireEvent.click(second!)
    expect(await screen.findByText(/Не указана: аккаунт создан до вопроса о стране/)).toBeInTheDocument()
  })

  // owner, 13.10.2026: «под каждым аккаунтом … должен писаться найденный ник, в приложении на пк».
  it('shows the nickname the PC app found under each e-mail and in the card; the search hint names it', async () => {
    const found = { ...almaty, nickname: 'Shaurma_1' }
    mocks.users.mockResolvedValue({ users: [found, old], total: 2, regions: { all: 2, cis: 1, europe: 0, other: 0, none: 1 } })
    mocks.user.mockImplementation(async (_token: string, id: string): Promise<AdminUserDetail> => ({ user: id === found.id ? found : old, payments: [], grants: [] }))
    mocks.devices.mockResolvedValue({ devices: [], limit: 3 })
    render(<AdminUsers />)
    const row = (email: string) => screen.getByText(email).closest('tr')!
    expect(await screen.findByText('Shaurma_1')).toBeInTheDocument()
    expect(within(row('almaty@mail.ru')).getByText('Shaurma_1')).toBeInTheDocument()
    expect(within(row('old@mail.ru')).getByText('ник не найден')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Поиск по e-mail или нику' })).toBeInTheDocument()
    const [first, second] = screen.getAllByRole('button', { name: /Действия/ })
    fireEvent.click(first!)
    expect(await screen.findByText((_, element) => element?.classList.contains('admin-eft-nick') === true && element.textContent === 'Ник из логов игры: Shaurma_1')).toBeInTheDocument()
    fireEvent.click(second!)
    expect(await screen.findByText('Ник ещё не найден: его находит приложение для ПК в логах игры.')).toBeInTheDocument()
  })

  it('an older server without the counts: the tabs work without numbers', async () => {
    mocks.users.mockResolvedValue({ users: [almaty], total: 1 })
    render(<AdminUsers />)
    const tabs = await screen.findByRole('group', { name: 'Регион' })
    expect(await screen.findByText('almaty@mail.ru')).toBeInTheDocument()
    expect(within(tabs).getAllByRole('button').map((button) => button.textContent)).toEqual(['Все', 'СНГ', 'Европа', 'Другие', 'Не указана'])
  })
})
