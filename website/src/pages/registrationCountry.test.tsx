import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../api'

/**
 * The country at registration (owner, 13.10.2026: «научись понимать из какого региона зарегистрировался человек … при
 * регистрации нужно указать страну»): every registration form of the site asks it and sends it, the cabinet shows it and
 * lets an account from before the question set it.
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
const groupsOf = (select: HTMLElement) => [...select.querySelectorAll('optgroup')].map((group) => ({ label: group.label, names: [...group.querySelectorAll('option')].map((option) => option.textContent ?? '') }))

afterEach(() => {
  cleanup()
  setSiteLocale('ru')
  mocks.status = 'signed-out'
  mocks.account = null
  for (const mock of [mocks.register, mocks.login, mocks.setCountry, mocks.streamerInvite]) mock.mockReset()
})

describe('registration on the site asks the country', () => {
  it('«Страна» is required, nothing is chosen in advance, the groups are «СНГ», «Европа», «Другие страны» sorted by name', async () => {
    mocks.register.mockResolvedValue(pending)
    const user = userEvent.setup()
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const country = screen.getByRole('combobox', { name: 'Страна' }) as HTMLSelectElement
    expect(country).toBeRequired()
    expect(country.value).toBe('')
    expect(country).toHaveAccessibleDescription('Для статистики по регионам и выбора способов оплаты.')
    const groups = groupsOf(country)
    expect(groups.map((group) => group.label)).toEqual(['СНГ', 'Европа', 'Другие страны'])
    expect(groups[0]!.names).toEqual(['Азербайджан', 'Армения', 'Беларусь', 'Казахстан', 'Киргизия', 'Молдова', 'Россия', 'Таджикистан', 'Туркменистан', 'Узбекистан'])
    // Ukraine is Europe; Georgia and Türkiye are Western Asia in the UN scheme, so «Другие страны».
    expect(groups[1]!.names).toEqual(expect.arrayContaining(['Украина', 'Германия', 'Кипр', 'Польша']))
    expect(groups[1]!.names).not.toContain('Грузия')
    expect(groups[2]!.names).toEqual(expect.arrayContaining(['Грузия', 'Турция', 'Соединенные Штаты']))
    for (const group of groups) expect(group.names).toEqual([...group.names].sort((a, b) => a.localeCompare(b, 'ru')))
    expect(groups.reduce((sum, group) => sum + group.names.length, 0)).toBe(249)

    await user.type(screen.getByLabelText('E-mail'), 'player@mail.ru')
    await user.type(screen.getByLabelText(/^Пароль/), password)
    await user.type(screen.getByLabelText('Повторите пароль'), password)
    await user.click(screen.getByRole('checkbox'))
    // Without a country the form is not sent.
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(country).toBeInvalid()
    expect(mocks.register).not.toHaveBeenCalled()
    await user.selectOptions(country, 'KZ')
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('player@mail.ru', password, undefined, 'KZ'))
    expect(await screen.findByText('Проверьте почту')).toBeInTheDocument()
  })

  it('speaks English: the country names and the groups in English', () => {
    setSiteLocale('en')
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const country = screen.getByRole('combobox', { name: 'Country' })
    const groups = groupsOf(country)
    expect(groups.map((group) => group.label)).toEqual(['CIS', 'Europe', 'Other countries'])
    expect(groups[0]!.names).toEqual(['Armenia', 'Azerbaijan', 'Belarus', 'Kazakhstan', 'Kyrgyzstan', 'Moldova', 'Russia', 'Tajikistan', 'Turkmenistan', 'Uzbekistan'])
    expect(screen.getByRole('option', { name: 'Choose your country' })).toBeInTheDocument()
    expect(country).toHaveAccessibleDescription('Used for statistics by region and to offer suitable payment methods.')
  })

  it('the streamer invitation: a new account names its country too, signing in to an existing one does not ask it', async () => {
    mocks.streamerInvite.mockResolvedValue({ code: 'HUNTER_TV', expiresAt: '2026-10-20T10:00:00.000Z' })
    mocks.register.mockResolvedValue(pending)
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[`/streamer/${'s'.repeat(32)}`]}><Routes><Route path="/streamer/:token" element={<StreamerInvitePage />} /></Routes></MemoryRouter>)
    const country = await screen.findByRole('combobox', { name: 'Страна' })
    expect(country).toBeRequired()
    await user.type(screen.getByLabelText('E-mail'), 'tv@mail.ru')
    await user.type(screen.getByLabelText(/^Пароль/), password)
    await user.type(screen.getByLabelText('Повторите пароль'), password)
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт стримера' }))
    expect(mocks.register).not.toHaveBeenCalled()
    await user.selectOptions(country, 'AM')
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
    const select = within(panel).getByRole('combobox', { name: 'Страна' })
    expect(within(panel).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    await user.selectOptions(select, 'BY')
    await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
    expect(mocks.setCountry).toHaveBeenCalledWith('session-token', 'BY')
    expect(await within(panel).findByText('Беларусь')).toBeInTheDocument()
    expect(within(panel).getByText('СНГ')).toBeInTheDocument()
    expect(within(panel).queryByRole('combobox')).toBeNull()
  })

  it('a named country is shown and can be corrected; a refusal of the server is shown', async () => {
    mocks.status = 'ready'
    mocks.account = { ...account, country: 'UA' }
    const { ApiError } = await import('../api')
    mocks.setCountry.mockRejectedValue(new ApiError(400, 'Неизвестная страна. Выберите страну из списка.'))
    const user = userEvent.setup()
    render(<MemoryRouter><CabinetPage /></MemoryRouter>)
    const panel = screen.getByRole('region', { name: 'Страна' })
    expect(within(panel).getByText('Украина')).toBeInTheDocument()
    expect(within(panel).getByText('Европа')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Изменить' }))
    expect((within(panel).getByRole('combobox', { name: 'Страна' }) as HTMLSelectElement).value).toBe('UA')
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Страна' }), 'PL')
    await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
    expect(await within(panel).findByText('Неизвестная страна. Выберите страну из списка.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Отмена' }))
    expect(within(panel).getByText('Украина')).toBeInTheDocument()
  })
})
