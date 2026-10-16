import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerAccountStatus } from '../electron'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { refreshServerStatus } from '../sync/serverSync'
import { AccountNotices, AfterNotices } from './AccountNotices'
import { resetNoticeInbox } from './noticeInbox'
import type { PlayerNotice, PlayerSurvey } from '../shared/notices'

/**
 * The owner's popups in the app (owner, 15.10.2026) against a mocked desktop gateway (window.tarkovDesktop): shown one
 * at a time to the signed-in player, in the app's language, closed for good with «Понятно», never during a raid, after
 * «Укажите страну»; surveys with «Отправить» / «Позже».
 */
const SERVER = 'https://raidos.app'
const signedIn: ServerAccountStatus = { signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: SERVER, persistent: true }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const welcome: PlayerNotice = { id: 1, kind: 'announcement', title: 'Новый канал', text: 'Подписывайтесь', titleEn: 'New channel', textEn: 'Subscribe', button: { text: 'Telegram', url: 'https://t.me/raidos' }, images: 2, createdAt: '2026-10-15T10:00:00.000Z' }
const russianOnly: PlayerNotice = { id: 2, kind: 'announcement', title: 'Только по-русски', text: 'Текст', images: 0, createdAt: '2026-10-15T10:01:00.000Z' }
const poll: PlayerSurvey = {
  id: 3, kind: 'survey', title: 'Как вам Raid OS?', titleEn: 'How do you like Raid OS?', intro: 'Два вопроса', laterLeft: 2, createdAt: '2026-10-15T10:02:00.000Z',
  questions: [
    { id: 'q1', text: 'Где играете?', textEn: 'Where do you play?', type: 'single', options: [{ id: 'o1', text: 'PvP' }, { id: 'o2', text: 'PvE' }], required: true },
    { id: 'q2', text: 'Что добавить?', type: 'text', required: false },
  ],
}

function desktop(options: { notices?: PlayerNotice[]; surveys?: PlayerSurvey[]; needsCountry?: boolean; inRaid?: boolean } = {}) {
  let notices = options.notices ?? []
  let surveys = options.surveys ?? []
  const account = { status: vi.fn(async () => signedIn), logout: vi.fn(), login: vi.fn(), openWebsite: vi.fn() }
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (path === '/v1/accounts/me') return { email: 'player@example.com', ...(options.needsCountry ? { needsCountry: true } : { country: 'RU' }) }
    if (path === '/v1/accounts/me/initial-country') return { email: 'player@example.com', country: 'RU' }
    if (path === '/v1/me/notices') return { notices, surveys }
    const closed = /^\/v1\/me\/notices\/(\d+)\/close$/.exec(path)
    if (closed) { notices = notices.filter((notice) => notice.id !== Number(closed[1])); return null }
    if (/^\/v1\/me\/notices\/\d+\/images\/\d$/.test(path)) return { mime: 'image/png', data: PNG }
    if (/\/responses$/.test(path)) { surveys = []; return { answeredAt: '2026-10-15T10:05:00.000Z', body } }
    return null
  })
  const raid = { inRaid: Boolean(options.inRaid), since: Date.now() }
  let raidListener: ((state: typeof raid) => void) | undefined
  Object.assign(window, { tarkovDesktop: {
    edition: 'client', serviceRequest, account,
    getRaidState: vi.fn(async () => raid),
    onRaidStateChanged: vi.fn((listener: (state: typeof raid) => void) => { raidListener = listener; return () => {} }),
  } })
  return { serviceRequest, account, endRaid: () => raidListener?.({ inRaid: false, since: Date.now() }), startRaid: () => raidListener?.({ inRaid: true, since: Date.now() }) }
}

async function open(locale: 'ru' | 'en' = 'ru') {
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  await refreshServerStatus()
  const user = userEvent.setup()
  render(<LocaleProvider><AccountNotices /></LocaleProvider>)
  return user
}

afterEach(async () => {
  cleanup()
  localStorage.clear()
  resetNoticeInbox()
  Reflect.deleteProperty(window, 'tarkovDesktop')
  await act(async () => { await refreshServerStatus() })
})

describe('an announcement stays until the player presses its button (owner, 16.10.2026)', () => {
  it('stays on screen while the server is out of reach for a moment (the PC slept, the network dropped)', async () => {
    const { account } = desktop({ notices: [russianOnly] })
    await open()
    expect(await screen.findByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
    account.status.mockResolvedValue({ ...signedIn, online: false })
    await act(async () => { await refreshServerStatus() })
    expect(screen.getByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
    account.status.mockResolvedValue(signedIn)
    await act(async () => { await refreshServerStatus() })
    expect(screen.getByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
  })

  it('stays on screen when a raid starts; only «Понятно» closes it', async () => {
    const { startRaid } = desktop({ notices: [russianOnly] })
    const user = await open()
    const dialog = await screen.findByRole('dialog', { name: 'Только по-русски' })
    act(() => startRaid())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Понятно' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('comes first at sign-in: the tips and event windows wait until it is closed', async () => {
    desktop({ notices: [russianOnly] })
    localStorage.setItem('tarkov-operations-locale-v1', 'ru')
    await refreshServerStatus()
    const user = userEvent.setup()
    render(<LocaleProvider><AccountNotices /><AfterNotices><p>Подсказка</p></AfterNotices></LocaleProvider>)
    const dialog = await screen.findByRole('dialog', { name: 'Только по-русски' })
    expect(screen.queryByText('Подсказка')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Понятно' }))
    expect(await screen.findByText('Подсказка')).toBeInTheDocument()
  })

  it('lets the tips show once the inbox answered with nothing to read', async () => {
    desktop()
    await refreshServerStatus()
    render(<LocaleProvider><AccountNotices /><AfterNotices><p>Подсказка</p></AfterNotices></LocaleProvider>)
    expect(await screen.findByText('Подсказка')).toBeInTheDocument()
  })
})

describe('the owner\'s announcements in the app', () => {
  it('shows one at a time, in Russian, with the photos and the button; «Понятно» closes it for good', async () => {
    const { serviceRequest } = desktop({ notices: [welcome, russianOnly] })
    const user = await open()
    const dialog = await screen.findByRole('dialog', { name: 'Новый канал' })
    expect(within(dialog).getByText('Подписывайтесь')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', 'https://t.me/raidos')
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: /Открыть фото/ })).toHaveLength(2))
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/notices/1/seen', {}))
    await user.click(within(dialog).getByRole('button', { name: 'Открыть фото 1' }))
    expect(screen.getByRole('dialog', { name: 'Фото' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть фото' }))
    await user.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/notices/1/close', {})
    expect(await screen.findByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
    expect(screen.queryByText('Новый канал')).not.toBeInTheDocument()
  })

  it('in English where the owner wrote English, in Russian where not', async () => {
    desktop({ notices: [welcome, russianOnly] })
    const user = await open('en')
    const dialog = await screen.findByRole('dialog', { name: 'New channel' })
    expect(within(dialog).getByText('Subscribe')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    expect(await screen.findByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
  })

  it('waits for the end of a raid', async () => {
    const { endRaid } = desktop({ notices: [russianOnly], inRaid: true })
    await open()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => endRaid())
    expect(await screen.findByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
  })

  it('comes after «Укажите страну»', async () => {
    desktop({ notices: [russianOnly], needsCountry: true })
    const user = await open()
    expect(await screen.findByRole('dialog', { name: 'Укажите страну' })).toBeInTheDocument()
    expect(screen.queryByText('Только по-русски')).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Россия' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить: Россия' }))
    expect(await screen.findByRole('dialog', { name: 'Только по-русски' })).toBeInTheDocument()
  })

  it('shows nothing to a signed-out app', async () => {
    const { serviceRequest } = desktop({ notices: [russianOnly] })
    window.tarkovDesktop!.account!.status = vi.fn(async () => ({ signedIn: false, online: true, serverUrl: SERVER, persistent: true }))
    await open()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(serviceRequest).not.toHaveBeenCalledWith('GET', '/v1/me/notices')
  })
})

describe('the owner\'s surveys in the app', () => {
  it('says who sees the answers, checks the required question and sends the answers once', async () => {
    const { serviceRequest } = desktop({ surveys: [poll] })
    const user = await open()
    const dialog = await screen.findByRole('dialog', { name: 'Как вам Raid OS?' })
    expect(within(dialog).getByText('Ответы видит администрация Raid OS вместе с почтой вашего аккаунта.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Выберите вариант')
    expect(serviceRequest).not.toHaveBeenCalledWith('POST', '/v1/me/surveys/3/responses', expect.anything())
    await user.click(within(dialog).getByRole('radio', { name: 'PvE' }))
    await user.type(within(dialog).getByRole('textbox'), '  Миникарту  ')
    await user.click(within(dialog).getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/surveys/3/responses', { answers: { q1: ['o2'], q2: 'Миникарту' } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('«Позже» puts it off until the next start; English where written', async () => {
    const { serviceRequest } = desktop({ surveys: [poll] })
    const user = await open('en')
    const dialog = await screen.findByRole('dialog', { name: 'How do you like Raid OS?' })
    expect(within(dialog).getByText('1. Where do you play?')).toBeInTheDocument()
    expect(within(dialog).getByText('Your answers are seen by the Raid OS team together with your account e-mail.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Later' }))
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/me/surveys/3/later', {})
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
