import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportChatDialog, SupportNotice } from './SupportChat'
import { cleanSupportMessage, pendingSupportNotice, resetSupportChat, supportTime, type SupportMessage } from './supportChatClient'
import { SUPPORT_TELEGRAM_URL } from '../app/support'
import { SUPPORT_IMAGE_PLACEHOLDER, type SupportReaction } from '../shared/supportChat'
import { SUPPORT_STICKERS } from '../shared/supportStickers'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { SupportButtons } from '../components/SupportButtons'
import { MobileTabBar } from '../mobile/MobileNav'
import { OPEN_ACCOUNT_SIGN_IN_EVENT } from '../account/accountEvents'
import { SOCIAL_UPDATE_EVENT } from '../squad/useSocialEvents'
import { refreshServerStatus } from '../sync/serverSync'

/** «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»). */
const signedIn = { signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }
const signedOut = { signedIn: false, online: true, serverUrl: 'https://raidos.app', persistent: true }

const at = '2026-10-13T10:05:00.000Z'
const answer = (id: number, text: string, read = false): SupportMessage => ({ id, author: 'owner', text, createdAt: at, read })
const mine = (id: number, text: string, read = false): SupportMessage => ({ id, author: 'user', text, createdAt: at, read })

/**
 * The desktop gateway with a server conversation: GET answers `thread` (only what came after `after` when asked, with
 * the oldest message's id), POST appends the player's message.
 */
function mockServer(status: unknown, thread: { messages: SupportMessage[]; unread: number }) {
  const calls: Array<[string, string, unknown]> = []
  let nextId = 100
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    calls.push([method, path, body])
    if (method === 'GET' && path.startsWith('/v1/me/support/messages')) {
      const after = Number(new URL(path, 'https://raidos.app').searchParams.get('after') ?? 0)
      return { messages: thread.messages.filter((message) => message.id > after), unread: thread.unread, oldestId: thread.messages[0]?.id ?? null }
    }
    if (method === 'POST' && path === '/v1/me/support/messages') {
      const sent = body as { text: string; images?: Array<{ data: string }>; replyTo?: number; sticker?: string }
      const attachments = (sent.images ?? []).map((_, index) => ({ id: `${String(nextId).padStart(22, '0')}${index}a`, width: 1920, height: 1080 }))
      // As the server: a reply quotes the message as it read, a sticker reads «[стикер: …]» for older apps.
      const original = sent.replyTo ? thread.messages.find((known) => known.id === sent.replyTo) : undefined
      const text = sent.sticker ? `[стикер: ${sent.sticker}]` : sent.text || (attachments.length ? SUPPORT_IMAGE_PLACEHOLDER : '')
      const message: SupportMessage = {
        ...mine(nextId++, text), ...(attachments.length ? { attachments } : {}), ...(sent.sticker ? { sticker: sent.sticker } : {}),
        ...(original ? { replyTo: { id: original.id, author: original.author, text: original.sticker ? '' : original.text, ...(original.sticker ? { sticker: original.sticker } : {}) } } : {}),
      }
      thread.messages = [...thread.messages, message]
      return { message }
    }
    const reaction = /^\/v1\/me\/support\/messages\/(\d+)\/reactions$/.exec(path)
    if (method === 'POST' && reaction) {
      const { emoji, on } = body as { emoji: string; on: boolean }
      const id = Number(reaction[1])
      thread.messages = thread.messages.map((known) => {
        if (known.id !== id) return known
        const list: SupportReaction[] = (known.reactions ?? []).map((entry) => ({ emoji: entry.emoji, authors: [...entry.authors] }))
        const entry = list.find((item) => item.emoji === emoji) ?? (list[list.push({ emoji, authors: [] }) - 1]!)
        entry.authors = [...entry.authors.filter((author) => author !== 'user'), ...(on ? ['user' as const] : [])]
        const reactions = list.filter((item) => item.authors.length)
        const { reactions: _old, ...rest } = known
        void _old
        return { ...rest, ...(reactions.length ? { reactions } : {}) }
      })
      return { message: thread.messages.find((known) => known.id === id) }
    }
    // A screenshot of the conversation: a 1×1 PNG.
    if (method === 'GET' && path.startsWith('/v1/me/support/attachments/')) return { mime: 'image/png', data: 'iVBORw0KGgo=', width: 1920, height: 1080 }
    if (method === 'POST' && path === '/v1/me/support/read') { thread.unread = 0; return null }
    return null
  })
  Object.assign(window, { tarkovDesktop: { isDesktop: true, serviceRequest, account: { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn() } } })
  return { calls, serviceRequest, thread }
}

// The account status and the conversation are one copy for the whole app: every test starts signed out and empty.
afterEach(async () => {
  cleanup()
  Object.assign(window, { tarkovDesktop: { isDesktop: true, serviceRequest: vi.fn(), account: { status: vi.fn().mockResolvedValue(signedOut) } } })
  await refreshServerStatus()
  Reflect.deleteProperty(window, 'tarkovDesktop')
  resetSupportChat()
  localStorage.clear()
})

describe('support chat window', () => {
  it('shows the conversation (answers on the left under «Raid OS», own messages on the right) and marks the answers read', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Не грузится карта', true), answer(2, 'Добрый день!\nУже чиним.')], unread: 1 })
    render(<SupportChatDialog onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Чат с поддержкой' })
    const reply = (await within(dialog).findByText(/Уже чиним/)).closest('.support-chat-message')!
    expect(reply).not.toHaveClass('is-own')
    expect(reply).toHaveTextContent('Raid OS')
    // The words as they were written: line breaks kept.
    expect(reply.querySelector('.support-chat-text')!.textContent).toBe('Добрый день!\nУже чиним.')
    const own = within(dialog).getByText('Не грузится карта').closest('.support-chat-message')!
    expect(own).toHaveClass('is-own')
    expect(within(own as HTMLElement).getByRole('img', { name: 'Прочитано' })).toBeInTheDocument()
    expect(own.querySelector('time')).toHaveAttribute('dateTime', at)
    await waitFor(() => expect(server.calls.some(([method, path]) => method === 'POST' && path === '/v1/me/support/read')).toBe(true))
  })

  // Owner, 04.11.2026: «У человека появляется в чате номер его заявки, и название его заявки, заголовок. И пишется, что это ответ на заявку».
  it('an answer about a report: «Ответ на заявку №37», its title, then the owner\'s words alone', async () => {
    const reply: SupportMessage = { ...answer(2, 'Ответ на заявку №37 «Квесты и их баги»\n\nНашли причину.'), report: { id: 37, kind: 'idea', title: 'Квесты и их баги', text: 'Нашли причину.' } }
    mockServer(signedIn, { messages: [reply], unread: 0 })
    render(<SupportChatDialog onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Чат с поддержкой' })
    const message = (await within(dialog).findByText('Нашли причину.')).closest('.support-chat-message')!
    expect(message.querySelector('.support-chat-report')).toHaveTextContent('Ответ на заявку №37Квесты и их баги')
    expect(message.querySelector('.support-chat-text')!.textContent).toBe('Нашли причину.')
  })

  it('a message from a server without the report\'s card, or with a broken one, shows its text', () => {
    expect(cleanSupportMessage({ id: 2, author: 'owner', text: 'Ответ на заявку №37 «Х»\n\nДа', createdAt: at, read: false, report: { id: 'x', title: 'Х', text: 'Да' } })).toEqual({ id: 2, author: 'owner', text: 'Ответ на заявку №37 «Х»\n\nДа', createdAt: at, read: false })
    expect(cleanSupportMessage({ id: 2, author: 'owner', text: 'Т', createdAt: at, read: false, report: { id: 37, kind: 'idea', title: 'Х', text: 'Да' } })?.report).toEqual({ id: 37, kind: 'idea', title: 'Х', text: 'Да' })
  })

  it('Enter sends, Shift+Enter starts a new line; the message joins the conversation and the box is emptied', async () => {
    const server = mockServer(signedIn, { messages: [], unread: 0 })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    expect(await screen.findByText('Напишите нам — ответим здесь же')).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Сообщение' })
    expect(box).toHaveAttribute('maxLength', '2000')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    await user.type(box, 'Привет{Shift>}{Enter}{/Shift}мир')
    expect(box).toHaveValue('Привет\nмир')
    expect(server.calls.filter(([method]) => method === 'POST')).toHaveLength(0)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(box).toHaveValue(''))
    expect(server.calls.filter(([method]) => method === 'POST')).toEqual([['POST', '/v1/me/support/messages', { text: 'Привет\nмир' }]])
    const sent = screen.getByText((_, element) => element?.classList.contains('support-chat-text') === true && element.textContent === 'Привет\nмир')
    expect(sent.closest('.support-chat-message')).toHaveClass('is-own')
    expect(within(sent.closest('.support-chat-message') as HTMLElement).getByRole('img', { name: 'Отправлено' })).toBeInTheDocument()
    expect(screen.queryByText('Напишите нам — ответим здесь же')).toBeNull()
    // Spaces only: nothing to send.
    await user.type(box, '   {Enter}')
    expect(server.calls.filter(([method]) => method === 'POST')).toHaveLength(1)
  })

  it('a refused message stays in the box with the reason in Russian', async () => {
    const server = mockServer(signedIn, { messages: [], unread: 0 })
    server.serviceRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'POST') throw new Error("Error invoking remote method 'service:request': Error: Слишком много сообщений. Подождите несколько минут.")
      return path.startsWith('/v1/me/support/messages') ? { messages: [], unread: 0 } : null
    })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    const box = await screen.findByRole('textbox', { name: 'Сообщение' })
    await user.type(box, 'Ещё вопрос')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Слишком много сообщений. Подождите несколько минут.')
    expect(box).toHaveValue('Ещё вопрос')
  })

  it('without an account there is no chat: it asks to sign in and sends nothing', async () => {
    const server = mockServer(signedOut, { messages: [answer(1, 'чужое')], unread: 1 })
    const onClose = vi.fn()
    const opened = vi.fn()
    window.addEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, opened)
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={onClose} />)
    expect(await screen.findByText('Войдите в аккаунт, чтобы написать нам')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(onClose).toHaveBeenCalled()
    expect(opened).toHaveBeenCalledTimes(1)
    window.removeEventListener(OPEN_ACCOUNT_SIGN_IN_EVENT, opened)
    expect(server.calls).toEqual([])
  })

  it('reads the conversation again when the social events say something changed (the owner answered)', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Есть кто?')], unread: 0 })
    render(<SupportChatDialog onClose={() => {}} />)
    expect(await screen.findByText('Есть кто?')).toBeInTheDocument()
    server.thread.messages = [...server.thread.messages, answer(2, 'Да, слушаю')]
    server.thread.unread = 1
    act(() => { window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT)) })
    expect(await screen.findByText('Да, слушаю')).toBeInTheDocument()
    // The window is open: the whole conversation is read, not only what came after.
    expect(server.calls.filter(([method]) => method === 'GET').map(([, path]) => path)).toEqual(['/v1/me/support/messages', '/v1/me/support/messages'])
  })

  it('formats the time: today only the clock, another day with the date', () => {
    const now = new Date('2026-10-13T18:00:00')
    expect(supportTime(new Date('2026-10-13T09:07:00').toISOString(), 'ru', now)).toBe('09:07')
    expect(supportTime(new Date('2026-10-12T21:30:00').toISOString(), 'ru', now)).toBe('12.10 21:30')
    expect(supportTime(new Date('2025-12-31T23:59:00').toISOString(), 'ru', now)).toBe('31.12.2025 23:59')
    expect(supportTime('broken', 'ru', now)).toBe('')
  })
})

describe('unread answers on «Чат с поддержкой» and «Ещё»', () => {
  it('the sidebar «Чат с поддержкой» counts the answers not read yet; opening the chat reads them', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Вопрос', true), answer(2, 'Ответ 1'), answer(3, 'Ответ 2')], unread: 2 })
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    const contact = screen.getByRole('button', { name: /Чат с поддержкой/ })
    expect(await within(contact).findByLabelText('Новых сообщений: 2')).toHaveTextContent('2')
    await user.click(contact)
    expect(await screen.findByText('Ответ 2')).toBeInTheDocument()
    await waitFor(() => expect(within(contact).queryByLabelText(/Новых сообщений/)).toBeNull())
    expect(server.calls.filter(([method, path]) => method === 'POST' && path === '/v1/me/support/read')).toHaveLength(1)
  })

  it('the phone: «Ещё» counts squad requests and answers together; «Чат с поддержкой» in the sheet opens the chat', async () => {
    mockServer(signedIn, { messages: [answer(1, 'Ответ от поддержки')], unread: 1 })
    const user = userEvent.setup()
    render(<MemoryRouter><MobileTabBar squadBadge={2} onSearch={() => {}} onRefresh={() => {}} refreshing={false} /></MemoryRouter>)
    const more = screen.getByRole('button', { name: /Ещё/ })
    expect(await within(more).findByLabelText('Новых уведомлений: 3')).toHaveTextContent('3')
    await user.click(more)
    const sheet = screen.getByRole('dialog', { name: 'Ещё' })
    const entry = within(sheet).getByRole('button', { name: /Чат с поддержкой/ })
    expect(within(entry).getByLabelText('Новых сообщений: 1')).toBeInTheDocument()
    await user.click(entry)
    expect(screen.queryByRole('dialog', { name: 'Ещё' })).toBeNull()
    expect(await screen.findByRole('dialog', { name: 'Чат с поддержкой' })).toHaveTextContent('Ответ от поддержки')
    // Any tab closes the chat sheet.
    await user.click(screen.getByRole('link', { name: 'Карты' }))
    expect(screen.queryByRole('dialog', { name: 'Чат с поддержкой' })).toBeNull()
  })

  it('signed out: no badge and no request', async () => {
    const server = mockServer(signedOut, { messages: [answer(1, 'x')], unread: 1 })
    render(<SupportButtons variant="panel" />)
    await waitFor(() => expect(window.tarkovDesktop?.account?.status).toHaveBeenCalled())
    expect(screen.queryByLabelText(/Новых сообщений/)).toBeNull()
    expect(server.calls).toEqual([])
  })

  it('the PC sidebar: one «Чат с поддержкой» right under «Сообщить об ошибке», with the count; it opens the chat (owner, 14 and 15.10.2026)', async () => {
    mockServer(signedIn, { messages: [mine(1, 'Вопрос', true), answer(2, 'Ответ')], unread: 1 })
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    const names = screen.getAllByRole('button').map((button) => button.querySelector('span')?.textContent)
    // «Связаться» duplicated the chat (owner, 15.10.2026: «у нас дублируется связаться и чат с поддержкой»): gone.
    expect(names).toEqual(['Сообщить об ошибке', 'Чат с поддержкой', 'Ваши предложения'])
    expect(screen.queryByText('Связаться')).toBeNull()
    const entry = screen.getByRole('button', { name: /Чат с поддержкой/ })
    expect(await within(entry).findByLabelText('Новых сообщений: 1')).toHaveTextContent('1')
    await user.click(entry)
    expect(await screen.findByRole('dialog', { name: 'Чат с поддержкой' })).toHaveTextContent('Ответ')
    await waitFor(() => expect(within(entry).queryByLabelText(/Новых сообщений/)).toBeNull())
    cleanup()
    // Settings → «Поддержка»: the same three, the chat named «Чат с поддержкой» with the same count.
    render(<SupportButtons variant="panel" />)
    expect(screen.getAllByRole('button').map((button) => button.querySelector('span')?.textContent)).toEqual(['Сообщить об ошибке', 'Чат с поддержкой', 'Ваши предложения'])
  })

  it('a conversation the owner deleted («Проблема решена») leaves the app at once: no count, an empty chat', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Карта не грузится', true), answer(2, 'Обновите приложение')], unread: 1 })
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    const contact = screen.getByRole('button', { name: /Чат с поддержкой/ })
    expect(await within(contact).findByLabelText('Новых сообщений: 1')).toBeInTheDocument()
    server.thread.messages = []
    server.thread.unread = 0
    act(() => { window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT)) })
    await waitFor(() => expect(within(contact).queryByLabelText(/Новых сообщений/)).toBeNull())
    // Only what came after the last message was asked; the server's empty conversation dropped what the app had.
    expect(server.calls.filter(([method]) => method === 'GET').map(([, path]) => path)).toEqual(['/v1/me/support/messages', '/v1/me/support/messages?after=2'])
    await user.click(contact)
    const dialog = await screen.findByRole('dialog', { name: 'Чат с поддержкой' })
    expect(await within(dialog).findByText('Напишите нам — ответим здесь же')).toBeInTheDocument()
    expect(within(dialog).queryByText('Обновите приложение')).toBeNull()
  })
})

describe('«Новое сообщение от поддержки» (owner, 14.10.2026: «так же должно появляться уведомление о том что у человека новое сообщение»)', () => {
  const toast = () => screen.queryByText('Новое сообщение от поддержки')?.closest('.support-notice') as HTMLElement | null | undefined
  const answered = (server: ReturnType<typeof mockServer>, message: SupportMessage) => {
    server.thread.messages = [...server.thread.messages, message]
    server.thread.unread += 1
    act(() => { window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT)) })
  }

  it('an answer while the chat is closed: the toast until «Открыть» or «×», again only for a newer answer', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Вопрос', true)], unread: 0 })
    const user = userEvent.setup()
    render(<><SupportButtons variant="nav" /><SupportNotice /></>)
    await waitFor(() => expect(server.calls).toHaveLength(1))
    expect(toast()).toBeFalsy()

    answered(server, answer(2, 'Ответ 1'))
    await waitFor(() => expect(toast()).toBeTruthy())
    expect(toast()).toHaveAttribute('role', 'status')
    // The note names no text of the message; «Открыть» opens the chat where the sidebar keeps it.
    expect(toast()).not.toHaveTextContent('Ответ 1')
    await user.click(within(toast()!).getByRole('button', { name: 'Открыть' }))
    const dialog = await screen.findByRole('dialog', { name: 'Чат с поддержкой' })
    expect(await within(dialog).findByText('Ответ 1')).toBeInTheDocument()
    expect(toast()).toBeFalsy()
    await waitFor(() => expect(server.calls.filter(([method, path]) => method === 'POST' && path === '/v1/me/support/read')).toHaveLength(1))
    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toast()).toBeFalsy()

    // A newer answer: the toast again; «×» closes it, and the same answer never brings it back.
    answered(server, answer(3, 'Ответ 2'))
    await waitFor(() => expect(toast()).toBeTruthy())
    await user.click(within(toast()!).getByRole('button', { name: 'Закрыть' }))
    expect(toast()).toBeFalsy()
    act(() => { window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT)) })
    await waitFor(() => expect(server.calls.filter(([method]) => method === 'GET')).toHaveLength(5))
    expect(toast()).toBeFalsy()
    expect(within(screen.getByRole('button', { name: /Чат с поддержкой/ })).getByLabelText('Новых сообщений: 1')).toBeInTheDocument()
    // Nor after a restart of the app: the closed one is remembered for this account on this device.
    cleanup()
    resetSupportChat()
    render(<SupportNotice />)
    await waitFor(() => expect(server.calls.filter(([method]) => method === 'GET')).toHaveLength(6))
    expect(toast()).toBeFalsy()
    answered(server, answer(4, 'Ответ 3'))
    await waitFor(() => expect(toast()).toBeTruthy())
    // One toast, whatever the number of answers.
    answered(server, answer(5, 'Ответ 4'))
    await waitFor(() => expect(server.calls.filter(([method]) => method === 'GET')).toHaveLength(8))
    expect(screen.getAllByText('Новое сообщение от поддержки')).toHaveLength(1)
    // Social events and the five-minute fallback only: no poll of its own.
    expect(server.calls.filter(([method]) => method === 'GET').map(([, path]) => path).slice(-3)).toEqual(['/v1/me/support/messages', '/v1/me/support/messages?after=3', '/v1/me/support/messages?after=4'])
  })

  it('no toast while a chat window is open, nor afterwards for what it showed; an answer read elsewhere brings none', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Вопрос', true)], unread: 0 })
    // The app is in the background: the open window does not mark the answer read, it is still unread on the server.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      const view = render(<><SupportChatDialog onClose={() => {}} /><SupportNotice /></>)
      expect(await screen.findByText('Вопрос')).toBeInTheDocument()
      answered(server, answer(2, 'Ответ в окне'))
      expect(await screen.findByText('Ответ в окне')).toBeInTheDocument()
      expect(toast()).toBeFalsy()
      view.rerender(<SupportNotice />)
      act(() => { window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT)) })
      await waitFor(() => expect(server.calls.at(-1)?.[1]).toBe('/v1/me/support/messages?after=2'))
      expect(toast()).toBeFalsy()
      expect(server.calls.some(([method]) => method === 'POST')).toBe(false)
      // Read on another device: the server counts nothing unread, no toast.
      server.thread.messages = [...server.thread.messages, answer(3, 'Прочитан на телефоне', true)]
      server.thread.unread = 0
      act(() => { window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT)) })
      await waitFor(() => expect(server.calls.at(-1)?.[1]).toBe('/v1/me/support/messages?after=2'))
      await waitFor(() => expect(server.calls.filter(([method]) => method === 'GET')).toHaveLength(4))
      expect(toast()).toBeFalsy()
    } finally {
      Reflect.deleteProperty(document, 'visibilityState')
    }
  })

  it('the phone: «Открыть» opens the chat sheet of the tab bar', async () => {
    mockServer(signedIn, { messages: [answer(1, 'Ответ от поддержки')], unread: 1 })
    const user = userEvent.setup()
    render(<MemoryRouter><MobileTabBar onSearch={() => {}} onRefresh={() => {}} refreshing={false} /><SupportNotice /></MemoryRouter>)
    await waitFor(() => expect(toast()).toBeTruthy())
    await user.click(within(toast()!).getByRole('button', { name: 'Открыть' }))
    expect(await screen.findByRole('dialog', { name: 'Чат с поддержкой' })).toHaveTextContent('Ответ от поддержки')
    expect(screen.getByRole('button', { name: /Ещё/ })).toHaveClass('active')
    // Any tab closes it, as when it is opened from «Ещё».
    await user.click(screen.getByRole('link', { name: 'Карты' }))
    expect(screen.queryByRole('dialog', { name: 'Чат с поддержкой' })).toBeNull()
  })

  it('signed out or nothing unread: no toast', () => {
    const at2 = answer(2, 'Ответ')
    expect(pendingSupportNotice({ messages: [mine(1, 'Вопрос'), at2], unread: 1, noticed: 0 })).toBe(at2)
    expect(pendingSupportNotice({ messages: [mine(1, 'Вопрос'), at2], unread: 0, noticed: 0 })).toBeNull()
    expect(pendingSupportNotice({ messages: [mine(1, 'Вопрос'), at2], unread: 1, noticed: 2 })).toBeNull()
    expect(pendingSupportNotice({ messages: [answer(2, 'Ответ', true)], unread: 1, noticed: 0 })).toBeNull()
  })

  it('English', async () => {
    const { setRenderLanguage } = await import('../i18n/renderText')
    mockServer(signedIn, { messages: [answer(1, 'Ответ')], unread: 1 })
    setRenderLanguage('en')
    try {
      render(<SupportNotice />)
      const note = await screen.findByText('New message from support')
      expect(within(note.closest('.support-notice') as HTMLElement).getByRole('button', { name: 'Open' })).toBeInTheDocument()
      expect(within(note.closest('.support-notice') as HTMLElement).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    } finally {
      setRenderLanguage('ru')
    }
  })
})

describe('English', () => {
  it('has English for every phrase of the chat', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Чат с поддержкой')).toBe('Support chat')
      expect(uiText('Напишите нам — ответим здесь же')).toBe('Write to us and we will answer right here')
      expect(uiText('Войдите в аккаунт, чтобы написать нам')).toBe('Sign in to message us')
      expect(uiText('Удобнее в Telegram?')).toBe('Prefer Telegram?')
      expect(uiText('Написать в Telegram')).toBe('Message on Telegram')
      expect(uiText('Enter — отправить, Shift+Enter — новая строка')).toBe('Enter to send, Shift+Enter for a new line')
      expect(uiText('Новых сообщений: 3')).toBe('New messages: 3')
      expect(uiText('Новых уведомлений: 4')).toBe('New notifications: 4')
      expect(uiText('Непрочитанных: 2')).toBe('Unread: 2')
      expect(uiText('Слишком много сообщений. Подождите несколько минут.')).toBe('Too many messages. Please wait a few minutes.')
      expect(uiText('Сообщение длиннее 2000 символов')).toBe('The message is longer than 2000 characters')
      expect(uiText('Напишите нам в чат поддержки, отправьте отчёт об ошибке со скриншотами или поделитесь идеей для приложения.')).toBe('Message us in the support chat, send a bug report with screenshots or share an idea for the app.')
      expect(uiText('Чаты')).toBe('Chats')
      expect(uiText('Ответ игроку…')).toBe('Reply to the player…')
      expect(uiText('Ответ на заявку')).toBe('Reply to request')
      expect(uiText('Ответить')).toBe('Reply')
      expect(uiText('Ответ отправлен')).toBe('Reply sent')
      expect(uiText('Отвечено')).toBe('Answered')
      expect(uiText('Заявка не найдена')).toBe('Request not found')
      expect(uiText('Новое сообщение от поддержки')).toBe('New message from support')
      expect(uiText('Открыть')).toBe('Open')
      expect(uiText('Открыть чат')).toBe('Open chat')
      expect(uiText('Проблема решена')).toBe('Problem solved')
      expect(uiText('Удалить переписку?')).toBe('Delete the conversation?')
      expect([uiText('Да'), uiText('Нет')]).toEqual(['Yes', 'No'])
    } finally {
      setRenderLanguage('ru')
    }
  })

  it('has no duplicate Russian keys with different translations', async () => {
    const { SUPPORT_CHAT_PHRASES } = await import('../i18n/uiEnglishSupportChat')
    const seen = new Map<string, string>()
    for (const [ru, en] of SUPPORT_CHAT_PHRASES) {
      if (seen.has(ru)) expect(seen.get(ru)).toBe(en)
      seen.set(ru, en)
    }
  })
})

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const shotFile = (name: string, type = 'image/png', bytes: BlobPart = PNG_BYTES) => new File([bytes], name, { type })
const ATTACHMENT = 'c0ffee00c0ffee00c0ffee00'
const withImages = (message: SupportMessage, count = 1): SupportMessage => ({ ...message, attachments: Array.from({ length: count }, (_, index) => ({ id: `${ATTACHMENT.slice(0, 23)}${index}`, width: 800, height: 600 })) })

describe('one entry, Telegram inside (owner, 15.10.2026: «сделай одну кнопку чат с поддержкой, но что бы там можно было написать в чат и кнопка на телеграм»)', () => {
  it('signed in: the box and «Написать в Telegram» under it', async () => {
    mockServer(signedIn, { messages: [], unread: 0 })
    render(<SupportChatDialog onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Чат с поддержкой' })
    expect(await within(dialog).findByRole('textbox', { name: 'Сообщение' })).toBeInTheDocument()
    const telegram = within(dialog).getByRole('link', { name: 'Написать в Telegram' })
    expect(telegram).toHaveAttribute('href', SUPPORT_TELEGRAM_URL)
    expect(telegram).toHaveAttribute('target', '_blank')
    expect(telegram.querySelector('svg')).not.toBeNull()
    expect(dialog).toHaveTextContent('Удобнее в Telegram?')
  })

  it('signed out: «Войти» and the same Telegram button', async () => {
    mockServer(signedOut, { messages: [], unread: 0 })
    render(<SupportChatDialog onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Чат с поддержкой' })
    expect(await within(dialog).findByRole('button', { name: 'Войти' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Написать в Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL)
    expect(within(dialog).queryByRole('button', { name: 'Прикрепить скриншот' })).toBeNull()
  })
})

describe('screenshots in the chat (owner, 15.10.2026: «еще связаться с поддержкой, добавь что бы можно было добавить скриншот»)', () => {
  const posts = (server: ReturnType<typeof mockServer>) => server.calls.filter(([method, path]) => method === 'POST' && path === '/v1/me/support/messages')

  it('the paperclip attaches; text and screenshots go in one message; the message shows them as thumbnails', async () => {
    const server = mockServer(signedIn, { messages: [], unread: 0 })
    const user = userEvent.setup({ applyAccept: false })
    render(<SupportChatDialog onClose={() => {}} />)
    const box = await screen.findByRole('textbox', { name: 'Сообщение' })
    expect(screen.getByRole('button', { name: 'Прикрепить скриншот' })).toBeEnabled()
    await user.upload(screen.getByLabelText('Скриншоты'), shotFile('raid.png'))
    const waiting = await screen.findByRole('list', { name: 'Скриншоты к сообщению' })
    expect(within(waiting).getByRole('img', { name: 'raid.png' })).toBeInTheDocument()
    await user.type(box, 'Вот ошибка{Enter}')
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    const [, , body] = posts(server)[0]! as [string, string, { text: string; images: Array<{ data: string }> }]
    expect(body.text).toBe('Вот ошибка')
    expect(body.images).toHaveLength(1)
    // base64 without the data: prefix (src/notices/imageResize.ts).
    expect(body.images[0]!.data).toBe(btoa(String.fromCharCode(...PNG_BYTES)))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Скриншоты к сообщению' })).toBeNull())
    const sent = (await screen.findByText('Вот ошибка')).closest('.support-chat-message') as HTMLElement
    expect(await within(sent).findByRole('img', { name: 'Скриншот 1' })).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    expect(server.calls.some(([method, path]) => method === 'GET' && path.startsWith('/v1/me/support/attachments/'))).toBe(true)
  })

  it('screenshots only: the send button works without text; the bubble shows the images, not «[скриншот]»', async () => {
    const server = mockServer(signedIn, { messages: [], unread: 0 })
    const user = userEvent.setup({ applyAccept: false })
    const { container } = render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByRole('textbox', { name: 'Сообщение' })
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    await user.upload(screen.getByLabelText('Скриншоты'), shotFile('only.png'))
    await screen.findByRole('img', { name: 'only.png' })
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(posts(server)).toHaveLength(1))
    expect((posts(server)[0]![2] as { text: string }).text).toBe('')
    const bubble = await waitFor(() => { const found = document.querySelector('.support-chat-message.has-images'); expect(found).not.toBeNull(); return found as HTMLElement })
    expect(await within(bubble).findByRole('img', { name: 'Скриншот 1' })).toBeInTheDocument()
    expect(bubble.querySelector('.support-chat-text')).toBeNull()
    expect(container.ownerDocument.body).not.toHaveTextContent(SUPPORT_IMAGE_PLACEHOLDER)
  })

  it('Ctrl+V pastes a screenshot; a dropped file is taken by the window; neither reaches the bug report under it', async () => {
    const server = mockServer(signedIn, { messages: [], unread: 0 })
    // What a dialog under the chat (the bug report, which takes pastes and drops too) would hear.
    const outside = vi.fn()
    render(<div onPaste={(event) => outside(event.type)} onDrop={(event) => outside(event.type)}><SupportChatDialog onClose={() => {}} /></div>)
    const box = await screen.findByRole('textbox', { name: 'Сообщение' })
    {
      fireEvent.paste(box, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => shotFile('pasted.png') }], types: ['Files'] } })
      expect(await screen.findByRole('img', { name: 'pasted.png' })).toBeInTheDocument()
      // A text paste stays a text paste.
      fireEvent.paste(box, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], types: ['text/plain'] } })
      const dialog = screen.getByRole('dialog', { name: 'Чат с поддержкой' }).querySelector('section')!
      fireEvent.dragEnter(dialog, { dataTransfer: { types: ['Files'], files: [] } })
      expect(dialog).toHaveClass('is-dropping')
      const drop = fireEvent.drop(dialog.querySelector('.support-chat-log')!, { dataTransfer: { types: ['Files'], files: [shotFile('dropped.webp', 'image/webp')] } })
      expect(drop).toBe(false)
      expect(await screen.findByRole('img', { name: 'dropped.webp' })).toBeInTheDocument()
      expect(dialog).not.toHaveClass('is-dropping')
      // Only the text paste went on.
      expect(outside.mock.calls).toEqual([['paste']])
    }
    expect(posts(server)).toHaveLength(0)
  })

  it('limits like the bug report: four at most, PNG / JPEG / WEBP, each up to 5 MB; a removed one frees its place', async () => {
    mockServer(signedIn, { messages: [], unread: 0 })
    const user = userEvent.setup({ applyAccept: false })
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByRole('textbox', { name: 'Сообщение' })
    const input = screen.getByLabelText('Скриншоты')
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    await user.upload(input, shotFile('anim.gif', 'image/gif'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Можно прикрепить только PNG, JPEG или WEBP.')
    await user.upload(input, shotFile('huge.png', 'image/png', new Uint8Array(5 * 1024 * 1024 + 1)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Каждый скриншот — не больше 5 МБ.')
    await user.upload(input, ['1', '2', '3', '4', '5'].map((name) => shotFile(`${name}.png`)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не больше 4 скриншотов.')
    const waiting = await screen.findByRole('list', { name: 'Скриншоты к сообщению' })
    await waitFor(() => expect(within(waiting).getAllByRole('img')).toHaveLength(4))
    expect(screen.getByRole('button', { name: 'Прикрепить скриншот' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Убрать скриншот 2.png' }))
    expect(screen.getByRole('button', { name: 'Прикрепить скриншот' })).toBeEnabled()
    await user.upload(input, shotFile('6.png'))
    await waitFor(() => expect(within(waiting).getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual(['1.png', '3.png', '4.png', '6.png']))
  })

  it('a screenshot opens full size over the chat (the reports\' viewer); Escape closes only it', async () => {
    mockServer(signedIn, { messages: [withImages(answer(1, 'Так должно быть'), 2)], unread: 0 })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SupportChatDialog onClose={onClose} />)
    const bubble = (await screen.findByText('Так должно быть')).closest('.support-chat-message') as HTMLElement
    await within(bubble).findByRole('img', { name: 'Скриншот 2' })
    // Sized before it arrives: 800×600 in a 150×120 box for two.
    const thumb = within(bubble).getByRole('button', { name: 'Открыть скриншот 1' })
    expect([thumb.style.width, thumb.style.height]).toEqual(['150px', '113px'])
    await user.click(within(bubble).getByRole('button', { name: 'Открыть скриншот 2' }))
    const viewer = await screen.findByRole('dialog', { name: 'Изображение 2 из 2' })
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Изображение/ })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Чат с поддержкой' })).toBeInTheDocument()
  })

  it('another account\'s screenshot (404) shows as unavailable; old messages keep their text; «[скриншот]» without images stays readable', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Старое сообщение', true), withImages(mine(2, SUPPORT_IMAGE_PLACEHOLDER)), mine(3, SUPPORT_IMAGE_PLACEHOLDER)], unread: 0 })
    const original = server.serviceRequest.getMockImplementation()!
    server.serviceRequest.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path.startsWith('/v1/me/support/attachments/')) throw new Error('Скриншот не найден')
      return original(method, path, body)
    })
    render(<SupportChatDialog onClose={() => {}} />)
    expect(await screen.findByText('Старое сообщение')).toBeInTheDocument()
    const broken = await screen.findByRole('button', { name: 'Открыть скриншот 1' })
    await waitFor(() => expect(broken).toHaveAttribute('title', 'Скриншот недоступен'))
    expect(broken).toBeDisabled()
    // The images of message 3 are gone (90 days): its placeholder is the text.
    expect(screen.getAllByText(SUPPORT_IMAGE_PLACEHOLDER)).toHaveLength(1)
  })

  it('the server\'s message shape: attachments checked, at most four, none on an old message', () => {
    expect(cleanSupportMessage({ id: 1, author: 'user', text: 'x', createdAt: at, read: false })).toEqual({ id: 1, author: 'user', text: 'x', createdAt: at, read: false })
    const message = cleanSupportMessage({ id: 2, author: 'owner', text: SUPPORT_IMAGE_PLACEHOLDER, createdAt: at, read: true, attachments: [
      { id: ATTACHMENT, width: 10, height: 20 }, { id: '../etc/passwd', width: 1, height: 1 }, { id: ATTACHMENT, width: -1, height: 2 }, 'x',
      { id: 'a'.repeat(24), width: 1, height: 1 }, { id: 'b'.repeat(24), width: 1, height: 1 }, { id: 'c'.repeat(24), width: 1, height: 1 }, { id: 'd'.repeat(24), width: 1, height: 1 },
    ] })
    expect(message?.attachments?.map((attachment) => attachment.id)).toEqual([ATTACHMENT, 'a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)])
    expect(cleanSupportMessage({ id: 3, author: 'user', text: 'y', createdAt: at, read: false, attachments: 'nope' })).not.toHaveProperty('attachments')
  })

  it('English', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      expect(uiText(SUPPORT_IMAGE_PLACEHOLDER)).toBe('[screenshot]')
      expect(uiText('Прикрепить скриншот')).toBe('Attach a screenshot')
      expect(uiText('Скриншоты к сообщению')).toBe('Screenshots for the message')
      expect(uiText('Скриншот')).toBe('Screenshot')
      expect(uiText('Открыть скриншот')).toBe('Open screenshot')
      expect(uiText('Скриншот недоступен')).toBe('Screenshot unavailable')
      expect(uiText('Не больше 4 скриншотов.')).toBe('No more than 4 screenshots.')
      expect(uiText('Не больше 4 скриншотов')).toBe('No more than 4 screenshots')
      expect(uiText('Слишком много скриншотов. Попробуйте через час.')).toBe('Too many screenshots. Please try again in an hour.')
      expect(uiText('Хранилище скриншотов сейчас заполнено. Отправьте сообщение без скриншотов.')).toBe('Screenshot storage is full right now. Please send the message without screenshots.')
      expect(uiText('Enter — отправить, Shift+Enter — новая строка, Ctrl+V — вставить скриншот')).toBe('Enter to send, Shift+Enter for a new line, Ctrl+V to paste a screenshot')
      mockServer(signedIn, { messages: [], unread: 0 })
      render(<SupportChatDialog onClose={() => {}} />)
      const dialog = await screen.findByRole('dialog', { name: 'Support chat' })
      expect(await within(dialog).findByRole('button', { name: 'Attach a screenshot' })).toBeInTheDocument()
      expect(within(dialog).getByRole('link', { name: 'Message on Telegram' })).toBeInTheDocument()
      expect(dialog).toHaveTextContent('Prefer Telegram?')
    } finally {
      setRenderLanguage('ru')
    }
  })
})

// Owner, 07.11.2026: «и пользователь, и я смог ставить на сообщения лайки или нажать правой клавишей и нажать «Ответить» именно
// на это сообщение… И просто отправлять смайлики… стикеры в стиле Таркова отправлять».
describe('reactions, replies, emoji and stickers', () => {
  const bubble = (text: string) => screen.getByText(text, { selector: '.support-chat-text' }).closest('.support-chat-message') as HTMLElement
  const posts = (calls: Array<[string, string, unknown]>, path = '/v1/me/support/messages') => calls.filter(([method, called]) => method === 'POST' && called === path).map(([, , body]) => body)

  it('a right click on a message → «Ответить»: the reply bar above the box, the message goes with replyTo and quotes it; a click on the quote shows the original', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Не грузится карта'), answer(2, 'Обновите приложение до 0.6.0')], unread: 0 })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByText('Обновите приложение до 0.6.0')
    fireEvent.contextMenu(bubble('Обновите приложение до 0.6.0'), { clientX: 40, clientY: 60 })
    const menu = screen.getByRole('menu', { name: 'Действия с сообщением' })
    expect(within(menu).getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual(['👍', '❤️', '😂', '😮', '😢', '🔥', '💀', '🤝'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Ответить' }))
    expect(screen.queryByRole('menu')).toBeNull()

    const bar = screen.getByRole('group', { name: 'Ответ на сообщение' })
    expect(bar).toHaveTextContent('Raid OS')
    expect(bar).toHaveTextContent('Обновите приложение до 0.6.0')
    const box = screen.getByRole('textbox', { name: 'Сообщение' })
    expect(box).toHaveFocus()
    await user.type(box, 'Обновил, работает{Enter}')
    await waitFor(() => expect(box).toHaveValue(''))
    expect(posts(server.calls)).toEqual([{ text: 'Обновил, работает', replyTo: 2 }])
    // Sent: the bar is gone; the bubble quotes the owner's message.
    expect(screen.queryByRole('group', { name: 'Ответ на сообщение' })).toBeNull()
    const sent = bubble('Обновил, работает')
    const quote = within(sent).getByRole('button', { name: /Raid OS/ })
    expect(quote).toHaveTextContent('Raid OSОбновите приложение до 0.6.0')
    await user.click(quote)
    expect(bubble('Обновите приложение до 0.6.0')).toHaveClass('is-flash')

    // «×» drops the reply: the next message goes alone. A reply to one's own message quotes «Вы».
    fireEvent.contextMenu(bubble('Не грузится карта'))
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }))
    expect(screen.getByRole('group', { name: 'Ответ на сообщение' })).toHaveTextContent('ВыНе грузится карта')
    await user.click(screen.getByRole('button', { name: 'Отменить ответ' }))
    expect(screen.queryByRole('group', { name: 'Ответ на сообщение' })).toBeNull()
    await user.type(box, 'Без ответа{Enter}')
    await waitFor(() => expect(posts(server.calls)).toHaveLength(2))
    expect(posts(server.calls)[1]).toEqual({ text: 'Без ответа' })
  })

  it('Escape closes the menu, then drops the reply, and only then the chat', async () => {
    mockServer(signedIn, { messages: [answer(2, 'Здравствуйте')], unread: 0 })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={onClose} />)
    await screen.findByText('Здравствуйте')
    fireEvent.contextMenu(bubble('Здравствуйте'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(bubble('Здравствуйте'))
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Ответ на сообщение' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a reaction from the menu shows as a chip with its count, the reader\'s own marked; a click on the chip takes it back; the other side\'s stays', async () => {
    const liked: SupportMessage = { ...answer(2, 'Готово'), reactions: [{ emoji: '🔥', authors: ['owner'] }] }
    const server = mockServer(signedIn, { messages: [mine(1, 'Спасибо'), liked], unread: 0 })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByText('Готово')
    // The owner's reaction: shown, not the reader's.
    const fire = within(bubble('Готово')).getByRole('button', { name: '🔥 1' })
    expect(fire).toHaveAttribute('aria-pressed', 'false')
    expect(fire).toHaveAttribute('title', 'Raid OS')

    fireEvent.contextMenu(bubble('Готово'))
    await user.click(screen.getByRole('menuitemcheckbox', { name: '👍' }))
    await waitFor(() => expect(within(bubble('Готово')).getByRole('button', { name: '👍 1' })).toHaveAttribute('aria-pressed', 'true'))
    expect(posts(server.calls, '/v1/me/support/messages/2/reactions')).toEqual([{ emoji: '👍', on: true }])
    // The menu says which ones are the reader's.
    fireEvent.contextMenu(bubble('Готово'))
    expect(screen.getByRole('menuitemcheckbox', { name: '👍' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: '🔥' })).toHaveAttribute('aria-checked', 'false')
    await user.keyboard('{Escape}')

    // A click on the other side's chip adds the reader's own; on the reader's own, takes it back.
    await user.click(within(bubble('Готово')).getByRole('button', { name: '🔥 1' }))
    await waitFor(() => expect(within(bubble('Готово')).getByRole('button', { name: '🔥 2' })).toHaveAttribute('aria-pressed', 'true'))
    expect(within(bubble('Готово')).getByRole('button', { name: '🔥 2' })).toHaveAttribute('title', 'Вы, Raid OS')
    await user.click(within(bubble('Готово')).getByRole('button', { name: '👍 1' }))
    await waitFor(() => expect(within(bubble('Готово')).queryByRole('button', { name: /^👍/ })).toBeNull())
    expect(posts(server.calls, '/v1/me/support/messages/2/reactions')).toEqual([{ emoji: '👍', on: true }, { emoji: '🔥', on: true }, { emoji: '👍', on: false }])
    // The reader's own message takes reactions too.
    fireEvent.contextMenu(bubble('Спасибо'))
    await user.click(screen.getByRole('menuitemcheckbox', { name: '🤝' }))
    await waitFor(() => expect(within(bubble('Спасибо')).getByRole('button', { name: '🤝 1' })).toBeInTheDocument())
  })

  it('a refused reaction goes back and says why', async () => {
    const server = mockServer(signedIn, { messages: [answer(2, 'Готово')], unread: 0 })
    server.serviceRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/v1/me/support/messages')) return { messages: [answer(2, 'Готово')], unread: 0, oldestId: 2 }
      if (path.endsWith('/reactions')) throw new Error('Сообщение не найдено')
      return null
    })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByText('Готово')
    fireEvent.contextMenu(bubble('Готово'))
    await user.click(screen.getByRole('menuitemcheckbox', { name: '❤️' }))
    expect(await screen.findByText('Сообщение не найдено')).toBeInTheDocument()
    expect(within(bubble('Готово')).queryByRole('button', { name: /❤️/ })).toBeNull()
  })

  it('the phone: a long press opens the menu; a finger that moves scrolls instead', async () => {
    mockServer(signedIn, { messages: [answer(2, 'Держитесь')], unread: 0 })
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByText('Держитесь')
    fireEvent.touchStart(bubble('Держитесь'), { touches: [{ clientX: 100, clientY: 300 }] })
    fireEvent.touchMove(bubble('Держитесь'), { touches: [{ clientX: 100, clientY: 340 }] })
    await new Promise((resolve) => setTimeout(resolve, 520))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.touchStart(bubble('Держитесь'), { touches: [{ clientX: 100, clientY: 300 }] })
    expect(await screen.findByRole('menu', {}, { timeout: 1500 })).toBeInTheDocument()
    expect(bubble('Держитесь')).toHaveClass('is-menu')
  })

  it('stickers: the button opens the pack, a click sends it at once (with the reply); the bubble shows its picture and caption', async () => {
    const server = mockServer(signedIn, { messages: [answer(2, 'Как успехи?')], unread: 0 })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByText('Как успехи?')
    const box = screen.getByRole('textbox', { name: 'Сообщение' })
    await user.type(box, 'черновик')
    fireEvent.contextMenu(bubble('Как успехи?'))
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }))
    await user.click(screen.getByRole('button', { name: 'Стикеры' }))
    const pack = screen.getByRole('group', { name: 'Стикеры' })
    expect(within(pack).getAllByRole('button')).toHaveLength(SUPPORT_STICKERS.length)
    await user.click(within(pack).getByRole('button', { name: 'Крыса' }))
    await waitFor(() => expect(posts(server.calls)).toEqual([{ text: '', sticker: 'rat', replyTo: 2 }]))
    // Sent: the pack and the reply are gone, the words in the box stay for the next message.
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Стикеры' })).toBeNull())
    expect(screen.queryByRole('group', { name: 'Ответ на сообщение' })).toBeNull()
    expect(box).toHaveValue('черновик')
    const sticker = screen.getByText('Крыса', { selector: 'figcaption' }).closest('.support-chat-message') as HTMLElement
    expect(sticker).toHaveClass('is-own', 'is-sticker')
    // The text for older apps is not shown; the picture is.
    expect(sticker.querySelector('.support-chat-text')).toBeNull()
    expect(sticker.querySelector('figure img, figure .support-chat-sticker-blank')).not.toBeNull()
    expect(within(sticker).getByRole('button', { name: /Raid OS/ })).toHaveTextContent('Как успехи?')
    // A reply to a sticker quotes «Стикер: Крыса».
    fireEvent.contextMenu(sticker)
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }))
    expect(screen.getByRole('group', { name: 'Ответ на сообщение' })).toHaveTextContent('ВыСтикер: Крыса')
  })

  it('emoji: the grid puts one in at the cursor; a message of emoji only is shown bigger', async () => {
    const server = mockServer(signedIn, { messages: [answer(2, '👍🔥'), answer(3, 'Ок 👍')], unread: 0 })
    const user = userEvent.setup()
    render(<SupportChatDialog onClose={() => {}} />)
    await screen.findByText('Ок 👍')
    expect(bubble('👍🔥').querySelector('.support-chat-text')).toHaveClass('is-emoji')
    expect(bubble('Ок 👍').querySelector('.support-chat-text')).not.toHaveClass('is-emoji')

    const box = screen.getByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement
    await user.type(box, 'Привет мир')
    await user.click(screen.getByRole('button', { name: 'Смайлики' }))
    const grid = screen.getByRole('group', { name: 'Смайлики' })
    for (const emoji of ['💀', '🔫', '🎒', '🩸', '🧰', '💰', '🚪', '🐀']) expect(within(grid).getByRole('button', { name: emoji })).toBeInTheDocument()
    await user.click(within(grid).getByRole('button', { name: '🔥' }))
    expect(box).toHaveValue('Привет мир🔥')
    // In the middle, in place of what is selected.
    box.setSelectionRange(6, 7)
    await user.click(within(grid).getByRole('button', { name: '🐀' }))
    expect(box).toHaveValue('Привет🐀мир🔥')
    expect([box.selectionStart, box.selectionEnd]).toEqual([8, 8])
    // The grid stays for more; Escape closes it, not the chat.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Смайлики' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Чат с поддержкой' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    await waitFor(() => expect(posts(server.calls)).toEqual([{ text: 'Привет🐀мир🔥' }]))
  })

  it('the server\'s message shape: a sticker of the pack, a reply, reactions of SUPPORT_REACTIONS; anything else is left out', () => {
    const base = { id: 5, author: 'owner', text: '[стикер: Крыса]', createdAt: at, read: false }
    expect(cleanSupportMessage({ ...base, sticker: 'rat', replyTo: { id: 3, author: 'user', text: 'Вопрос' }, reactions: [{ emoji: '👍', authors: ['user', 'owner'] }] })).toEqual({
      ...base, sticker: 'rat', replyTo: { id: 3, author: 'user', text: 'Вопрос' }, reactions: [{ emoji: '👍', authors: ['user', 'owner'] }],
    })
    // A sticker this app does not know: the text for older apps shows instead.
    expect(cleanSupportMessage({ ...base, sticker: 'from-a-newer-pack' })).not.toHaveProperty('sticker')
    expect(cleanSupportMessage({ ...base, replyTo: { id: 'x', author: 'user', text: 'Т' } })).not.toHaveProperty('replyTo')
    expect(cleanSupportMessage({ ...base, replyTo: { id: 3, author: 'someone', text: 'Т' } })).not.toHaveProperty('replyTo')
    expect(cleanSupportMessage({ ...base, reactions: [{ emoji: '🍕', authors: ['user'] }, { emoji: '👍', authors: ['x'] }, { emoji: '🔥', authors: ['owner', 'owner'] }, { emoji: '🔥', authors: ['user'] }] })?.reactions).toEqual([{ emoji: '🔥', authors: ['owner'] }])
    expect(cleanSupportMessage({ ...base, reactions: 'nope' })).not.toHaveProperty('reactions')
  })

  it('English', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      for (const [ru, en] of [
        ['Действия с сообщением', 'Message actions'], ['Реакции', 'Reactions'], ['Ответить', 'Reply'], ['Копировать', 'Copy'], ['Ответ на сообщение', 'Reply to a message'],
        ['Отменить ответ', 'Cancel reply'], ['Показать сообщение', 'Show the message'], ['Смайлики', 'Emoji'], ['Стикеры', 'Stickers'], ['Стикер', 'Sticker'], ['Вы', 'You'],
        ['Игрок', 'Player'], ['Не удалось поставить реакцию', 'Could not set the reaction'], ['Сообщение не найдено', 'Message not found'], ['Неизвестный стикер', 'Unknown sticker'],
        ['Такой реакции нет', 'No such reaction'], ['Стикер отправляется без текста и скриншотов', 'A sticker is sent without text or screenshots'],
      ]) expect(uiText(ru!)).toBe(en)
      mockServer(signedIn, { messages: [{ ...answer(2, '[стикер: GG]'), sticker: 'thanks' }], unread: 0 })
      localStorage.setItem('tarkov-operations-locale-v1', 'en')
      render(<LocaleProvider><SupportChatDialog onClose={() => {}} /></LocaleProvider>)
      const dialog = await screen.findByRole('dialog', { name: 'Support chat' })
      // The caption in the reader's language, from the pack.
      expect(await within(dialog).findByText('Thanks, bro', { selector: 'figcaption' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Emoji' })).toBeInTheDocument()
      await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Stickers' }))
      expect(within(dialog).getByRole('group', { name: 'Stickers' })).toHaveTextContent('Rat')
    } finally {
      setRenderLanguage('ru')
      localStorage.clear()
    }
  })
})
