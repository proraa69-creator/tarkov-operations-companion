import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { setAnnouncement } from './announcement'
import { OwnerAnnouncementPanel } from './OwnerAnnouncementPanel'

/**
 * «Уведомление сверху» in the owner app with the English for foreign players (owner, 14.10.2026: «я буду писать по
 * русски… а все иностранные у них этот текст будет автоматически переводится на английский»).
 */
const PATH = '/v1/accounts/me/admin/announcement'
const WORKS = 'Ведутся технические работы. Приложение заработает через 15 минут.'
const AUTO = 'Maintenance is under way. The app will be back in 15 minutes.'
const HINT = 'Пишите по-русски. Игроки из СНГ и из неизвестных стран видят этот текст, остальные — английский перевод, он делается сам.'
const NO_ENGLISH = 'Перевод не получился — иностранцы видят русский текст. Впишите английский вручную.'

interface Stored { text: string; textEn: string | null; textEnSource: 'auto' | 'manual' | null; active: boolean; updatedBy: string; updatedAt: string }
interface Body { text: string; active: boolean; textEn?: string }

/**
 * The owner app's gateway with a server as server/src/routes/announcement.ts: a notice in both languages is split, the
 * owner's English wins, an unchanged Russian keeps its English, `translations` are what the translator manages
 * (anything else fails).
 */
function mockServer(initial: Stored | null, translations: Record<string, string> = { [WORKS]: AUTO }) {
  let current = initial
  let saves = 0
  const puts: Body[] = []
  const history: Array<{ id: number; text: string; textEn: string | null; updatedAt: string }> = []
  const serviceRequest = vi.fn(async (method: string, path: string, body?: Body) => {
    if (path === `${PATH}/history`) return { history: [...history].reverse() }
    if (path !== PATH) throw new Error('Неизвестный запрос сервиса')
    if (method === 'GET') return { announcement: current }
    puts.push(body!)
    const { active } = body!
    const [text, both] = body!.text.split('\n\n')
    const textEn = body!.textEn || both
    const kept = current?.text === text && current.textEn ? current : undefined
    const english = textEn ? { textEn, textEnSource: 'manual' as const } : kept ? { textEn: kept.textEn, textEnSource: kept.textEnSource }
      : translations[text!] ? { textEn: translations[text!]!, textEnSource: 'auto' as const } : { textEn: null, textEnSource: null }
    const changed = active && text && (current?.text !== text || !current?.active)
    current = { text: text!, active, ...english, updatedBy: 'owner@example.com', updatedAt: `2026-10-14T10:00:${String(saves++).padStart(2, '0')}.000Z` }
    if (changed) history.push({ id: history.length + 1, text: text!, textEn: current.textEn, updatedAt: current.updatedAt })
    return { announcement: current, translation: textEn ? 'manual' : kept ? 'kept' : english.textEn ? 'auto' : 'failed' }
  })
  Object.assign(window, { tarkovDesktop: { edition: 'owner', isDesktop: true, serviceRequest } })
  return { puts, serviceRequest }
}

const stored = (patch: Partial<Stored> = {}): Stored => ({ text: WORKS, textEn: AUTO, textEnSource: 'auto', active: true, updatedBy: 'owner@example.com', updatedAt: '2026-10-14T09:00:00.000Z', ...patch })

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'tarkovDesktop')
  localStorage.clear()
  setRenderLanguage('ru')
  setAnnouncement(null)
  vi.restoreAllMocks()
})

describe('«Уведомление сверху»: the English for foreign players', () => {
  it('says to write in Russian, then shows the automatic English after the save; «Изменить» sends the owner\'s own', async () => {
    const server = mockServer(null)
    const user = userEvent.setup()
    render(<OwnerAnnouncementPanel />)
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.queryByText('Английская версия')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.'), WORKS)
    await user.click(screen.getByRole('button', { name: 'Показать всем' }))
    expect(await screen.findByText(AUTO)).toBeInTheDocument()
    expect(screen.getByText('Английская версия')).toBeInTheDocument()
    expect(screen.getByText('Автоперевод')).toBeInTheDocument()
    expect(screen.queryByText(NO_ENGLISH)).not.toBeInTheDocument()
    expect(server.puts).toEqual([{ text: WORKS, active: true }])
    // The compose field starts over after a banner is shown (owner, 16.10.2026).
    expect(screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.')).toHaveValue('')

    // «Отмена» closes the editor without a request.
    await user.click(screen.getByRole('button', { name: 'Изменить' }))
    expect(screen.getByRole('textbox', { name: 'Английская версия' })).toHaveValue(AUTO)
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('textbox', { name: 'Английская версия' })).not.toBeInTheDocument()

    // The correction goes as textEn with the stored Russian; the compose field keeps an unsaved draft.
    await user.type(screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.'), 'Черновик')
    await user.click(screen.getByRole('button', { name: 'Изменить' }))
    const field = screen.getByRole('textbox', { name: 'Английская версия' })
    await user.clear(field)
    expect(screen.getByRole('button', { name: 'Сохранить перевод' })).toBeDisabled()
    await user.type(field, 'Maintenance: back in 15 minutes.')
    await user.click(screen.getByRole('button', { name: 'Сохранить перевод' }))
    expect(await screen.findByText('Maintenance: back in 15 minutes.')).toBeInTheDocument()
    expect(screen.getByText('Ваш перевод')).toBeInTheDocument()
    expect(screen.queryByText('Автоперевод')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Английская версия' })).not.toBeInTheDocument()
    expect(server.puts.at(-1)).toEqual({ text: WORKS, active: true, textEn: 'Maintenance: back in 15 minutes.' })
    expect(screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.')).toHaveValue('Черновик')
  })

  it('warns when the translation failed and the English is written by hand', async () => {
    const server = mockServer(stored({ text: 'Сервер перезагружается.', textEn: null, textEnSource: null }))
    const user = userEvent.setup()
    render(<OwnerAnnouncementPanel />)
    expect(await screen.findByText(NO_ENGLISH)).toBeInTheDocument()
    expect(screen.queryByText('Автоперевод')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Изменить' }))
    const field = screen.getByRole('textbox', { name: 'Английская версия' })
    expect(field).toHaveValue('')
    await user.type(field, 'The server is restarting.')
    await user.click(screen.getByRole('button', { name: 'Сохранить перевод' }))
    expect(await screen.findByText('The server is restarting.')).toBeInTheDocument()
    expect(screen.getByText('Ваш перевод')).toBeInTheDocument()
    expect(screen.queryByText(NO_ENGLISH)).not.toBeInTheDocument()
    expect(server.puts).toEqual([{ text: 'Сервер перезагружается.', active: true, textEn: 'The server is restarting.' }])

    // A new Russian the translator cannot manage: saved, and the warning is back.
    const russian = screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.')
    expect(russian).toHaveValue('')
    await user.type(russian, 'Карты временно недоступны.')
    await user.click(screen.getByRole('button', { name: 'Показать новый всем' }))
    expect(await screen.findByText(NO_ENGLISH)).toBeInTheDocument()
    expect(server.puts.at(-1)).toEqual({ text: 'Карты временно недоступны.', active: true })
  })

  it('a notice typed in both languages: the field shows the Russian kept, the English part below as the owner\'s own', async () => {
    const server = mockServer(null)
    const user = userEvent.setup()
    render(<OwnerAnnouncementPanel />)
    const russian = screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.')
    await user.type(russian, 'Карты недоступны.{Enter}{Enter}Maps are unavailable.')
    await user.click(screen.getByRole('button', { name: 'Показать всем' }))
    expect(await screen.findByText('Maps are unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Ваш перевод')).toBeInTheDocument()
    expect(russian).toHaveValue('')
    expect(server.puts).toEqual([{ text: 'Карты недоступны.\n\nMaps are unavailable.', active: true }])
  })

  it('shows no English part for a server from before the English', async () => {
    const legacy: Partial<Stored> = stored()
    delete legacy.textEn
    delete legacy.textEnSource
    mockServer(legacy as Stored)
    render(<OwnerAnnouncementPanel />)
    expect(await screen.findByText('Показывается у всех.', { exact: false })).toBeInTheDocument()
    expect(screen.queryByDisplayValue(WORKS)).not.toBeInTheDocument()
    expect(screen.queryByText('Английская версия')).not.toBeInTheDocument()
    expect(screen.queryByText(NO_ENGLISH)).not.toBeInTheDocument()
  })

  it('keeps the past banners in «История баннеров»; «Скрыть» takes down the shown one', async () => {
    const server = mockServer(null, { 'Первый.': 'First.', 'Второй.': 'Second.' })
    const user = userEvent.setup()
    render(<OwnerAnnouncementPanel />)
    const field = screen.getByPlaceholderText('Например: ведутся технические работы, приложение заработает через 15 минут.')
    await user.type(field, 'Первый.')
    await user.click(screen.getByRole('button', { name: 'Показать всем' }))
    expect(await screen.findByText('First.')).toBeInTheDocument()
    await user.type(field, 'Второй.')
    await user.click(screen.getByRole('button', { name: 'Показать новый всем' }))
    expect(await screen.findByText('Second.')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /История баннеров/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    const list = screen.getByRole('list')
    expect([...list.querySelectorAll('li > p:not([lang])')].map((item) => item.textContent)).toEqual(['Второй.', 'Первый.'])
    await user.click(screen.getByRole('button', { name: 'Скрыть' }))
    expect(await screen.findByText('Сейчас не показывается.', { exact: false })).toBeInTheDocument()
    expect(server.puts.at(-1)).toEqual({ text: 'Второй.', active: false })
  })

  it('speaks English in the English interface', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    mockServer(stored({ textEn: null, textEnSource: null }))
    const user = userEvent.setup()
    render(<LocaleProvider><OwnerAnnouncementPanel /></LocaleProvider>)
    expect(screen.getByText('Write in Russian. Players from the CIS and from unknown countries see this text; everyone else sees an English translation, made automatically.')).toBeInTheDocument()
    expect(await screen.findByText('The translation failed: foreign players see the Russian text. Enter the English yourself.')).toBeInTheDocument()
    expect(screen.getByText('English version')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.type(screen.getByRole('textbox', { name: 'English version' }), 'Maintenance.')
    await user.click(screen.getByRole('button', { name: 'Save translation' }))
    expect(await screen.findByText('Your translation')).toBeInTheDocument()
    expect(screen.getByText('Maintenance.')).toBeInTheDocument()
    cleanup()

    mockServer(stored())
    render(<LocaleProvider><OwnerAnnouncementPanel /></LocaleProvider>)
    expect(await screen.findByText('Machine translation')).toBeInTheDocument()
    expect(screen.getByText(AUTO)).toBeInTheDocument()
  })
})
