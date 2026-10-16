import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../api'

/**
 * The country at registration (owner, 13.10.2026: «научись понимать из какого региона зарегистрировался человек … при
 * регистрации нужно указать страну»; then «при нажатии выбора страны окно с ручным вводом» and «не разделяй СНГ, Европу
 * и другие страны, просто общий список»): every registration form of the site asks it in a window with a search over one
 * list and sends it, the cabinet shows it and lets an account from before the question set it.
 */
const mocks = vi.hoisted(() => ({
  status: 'signed-out' as string,
  account: null as unknown,
  listeners: new Set<() => void>(),
  register: vi.fn(),
  login: vi.fn(),
  setCountry: vi.fn(),
  streamerInvite: vi.fn(),
}))

vi.mock('../auth', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) }
  const setAccount = (next: unknown) => { mocks.account = next; for (const listener of mocks.listeners) listener() }
  return {
    useAuth: () => {
      const account = useSyncExternalStore(subscribe, () => mocks.account)
      return { status: mocks.status, token: mocks.status === 'ready' ? 'session-token' : null, account, error: null, reload: vi.fn(), logout: vi.fn(), login: mocks.login, register: mocks.register, confirmRegistration: vi.fn(), setAccount, adopt: vi.fn() }
    },
  }
})
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  const answers: Record<string, unknown> = { setCountry: mocks.setCountry, streamerInvite: mocks.streamerInvite }
  // Everything else stays pending: these tests only look at the country.
  const api = new Proxy({}, { get: (_target, key: string) => answers[key] ?? (() => new Promise(() => {})) })
  return { ...actual, api }
})

const { RegisterPage } = await import('./RegisterPage')
const { StreamerInvitePage } = await import('./StreamerInvitePage')
const { CabinetPage } = await import('./CabinetPage')
const { setSiteLocale } = await import('../i18n')

const password = 'correct horse'
const pending = { pending: { pending: true, message: 'Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.', challengeId: 'c'.repeat(32), expiresAt: '2026-10-13T10:10:00.000Z', resendSeconds: 60 } }
const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent ?? '')

/** Opens the field's window, types into its search box and clicks the country. */
async function pick(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, query: string, name: string, search = 'Поиск страны') {
  await user.click(field)
  await user.type(screen.getByRole('combobox', { name: search }), query)
  await user.click(screen.getByRole('option', { name }))
}

afterEach(() => {
  cleanup()
  setSiteLocale('ru')
  mocks.status = 'signed-out'
  mocks.account = null
  for (const mock of [mocks.register, mocks.login, mocks.setCountry, mocks.streamerInvite]) mock.mockReset()
})

describe('registration on the site asks the country', () => {
  it('a window with a search over one list of all countries; nothing chosen in advance; required', async () => {
    mocks.register.mockResolvedValue(pending)
    const user = userEvent.setup()
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const field = screen.getByRole('combobox', { name: 'Страна' })
    expect(field).toHaveAttribute('aria-required', 'true')
    expect(field).toHaveTextContent('Выберите страну')
    expect(field).toHaveAccessibleDescription('Для статистики по регионам и выбора способов оплаты.')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(field)
    expect(screen.getByRole('dialog', { name: 'Выбор страны' })).toBeInTheDocument()
    const search = screen.getByRole('combobox', { name: 'Поиск страны' })
    expect(search).toHaveFocus()
    // One list, no «СНГ» / «Европа» / «Другие страны» groups, sorted by name.
    const names = optionNames()
    expect(names).toHaveLength(249)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ru')))
    expect(screen.queryByText('СНГ')).toBeNull()
    expect(screen.queryByText('Другие страны')).toBeNull()
    await user.type(search, 'каз')
    expect(optionNames()).toEqual(['Казахстан'])
    await user.clear(search)
    await user.type(search, 'сша')
    expect(optionNames()[0]).toBe('Соединенные Штаты')
    await user.clear(search)
    await user.type(search, 'zzzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(field).toHaveFocus()

    await user.type(screen.getByLabelText('E-mail'), 'player@mail.ru')
    await user.type(screen.getByLabelText(/^Пароль/), password)
    await user.type(screen.getByLabelText('Повторите пароль'), password)
    await user.click(screen.getByRole('checkbox'))
    // Without a country the form is not sent, and the field says why.
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(mocks.register).not.toHaveBeenCalled()
    expect(await screen.findAllByText('Выберите страну.')).not.toHaveLength(0)

    // From the keyboard: arrows open it, typing filters, Enter picks the first match.
    field.focus()
    await user.keyboard('{ArrowDown}')
    await user.type(screen.getByRole('combobox', { name: 'Поиск страны' }), 'kz{Enter}')
    expect(field).toHaveTextContent('Казахстан')
    expect(field).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('player@mail.ru', password, undefined, 'KZ'))
    expect(await screen.findByText('Проверьте почту')).toBeInTheDocument()
  })

  it('speaks English: the country names, the window and the search', async () => {
    setSiteLocale('en')
    const user = userEvent.setup()
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const field = screen.getByRole('combobox', { name: 'Country' })
    expect(field).toHaveTextContent('Choose your country')
    expect(field).toHaveAccessibleDescription('Used for statistics by region and to offer suitable payment methods.')
    await user.click(field)
    expect(screen.getByRole('dialog', { name: 'Choose a country' })).toBeInTheDocument()
    const names = optionNames()
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
    expect(names).toContain('Germany')
    await user.type(screen.getByRole('combobox', { name: 'Search for a country' }), 'герм')
    expect(optionNames()).toEqual(['Germany'])
    await user.click(screen.getByRole('option', { name: 'Germany' }))
    expect(field).toHaveTextContent('Germany')
    await user.click(field)
    await user.type(screen.getByRole('combobox', { name: 'Search for a country' }), 'zzzz')
    expect(screen.getByText('Nothing found')).toBeInTheDocument()
  })

  it('the streamer invitation: a new account names its country too, signing in to an existing one does not ask it', async () => {
    mocks.streamerInvite.mockResolvedValue({ code: 'HUNTER_TV', expiresAt: '2026-10-20T10:00:00.000Z' })
    mocks.register.mockResolvedValue(pending)
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[`/streamer/${'s'.repeat(32)}`]}><Routes><Route path="/streamer/:token" element={<StreamerInvitePage />} /></Routes></MemoryRouter>)
    const field = await screen.findByRole('combobox', { name: 'Страна' })
    expect(field).toHaveAttribute('aria-required', 'true')
    await user.type(screen.getByLabelText('E-mail'), 'tv@mail.ru')
    await user.type(screen.getByLabelText(/^Пароль/), password)
    await user.type(screen.getByLabelText('Повторите пароль'), password)
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт стримера' }))
    expect(mocks.register).not.toHaveBeenCalled()
    await pick(user, field, 'арм', 'Армения')
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт стримера' }))
    // No referral code on purpose: a streamer account is not somebody's referral.
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('tv@mail.ru', password, undefined, 'AM'))
    cleanup()
    render(<MemoryRouter initialEntries={[`/streamer/${'s'.repeat(32)}`]}><Routes><Route path="/streamer/:token" element={<StreamerInvitePage />} /></Routes></MemoryRouter>)
    await user.click(await screen.findByRole('tab', { name: 'У меня уже есть аккаунт' }))
    expect(screen.queryByRole('combobox', { name: 'Страна' })).toBeNull()
  })
})

describe('the cabinet shows the country', () => {
  const account: Account = { email: 'me@mail.ru', kind: 'user', createdAt: '2026-10-01T10:00:00.000Z', nicknames: {}, subscription: { status: 'inactive' }, emailVerifiedAt: '2026-10-01T10:00:00.000Z' }

  it('an account from before the question: «Страна не указана — указать», then the chosen one with its region', async () => {
    mocks.status = 'ready'
    mocks.account = account
    mocks.setCountry.mockResolvedValue({ ...account, country: 'BY' })
    const user = userEvent.setup()
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const panel = screen.getByRole('region', { name: 'Страна' })
    expect(within(panel).getByText('Страна не указана')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'указать' }))
    const field = within(panel).getByRole('combobox', { name: 'Страна' })
    expect(within(panel).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    await pick(user, field, 'бела', 'Беларусь')
    await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
    expect(mocks.setCountry).toHaveBeenCalledWith('session-token', 'BY')
    expect(await within(panel).findByText('Беларусь')).toBeInTheDocument()
    expect(within(panel).getByText('СНГ')).toBeInTheDocument()
    expect(within(panel).queryByRole('combobox')).toBeNull()
  })

  it('a named country is shown and cannot be changed (owner, 16.10.2026)', async () => {
    mocks.status = 'ready'
    mocks.account = { ...account, country: 'UA' }
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const panel = screen.getByRole('region', { name: 'Страна' })
    expect(within(panel).getByText('Украина')).toBeInTheDocument()
    expect(within(panel).getByText('Европа')).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(within(panel).queryByRole('combobox')).toBeNull()
  })
})
