import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportChatDialog, SupportNotice } from './SupportChat'
import { pendingSupportNotice, resetSupportChat, supportTime, type SupportMessage } from './supportChatClient'
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
      const message = mine(nextId++, (body as { text: string }).text)
      thread.messages = [...thread.messages, message]
      return { message }
    }
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

describe('unread answers on «Связаться» and «Ещё»', () => {
  it('the sidebar «Связаться» counts the answers not read yet; opening the chat reads them', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Вопрос', true), answer(2, 'Ответ 1'), answer(3, 'Ответ 2')], unread: 2 })
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    const contact = screen.getByRole('button', { name: /Связаться/ })
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

  it('the PC sidebar: «Чат с поддержкой» right under «Сообщить об ошибке», with the count; it opens the chat (owner, 14.10.2026)', async () => {
    mockServer(signedIn, { messages: [mine(1, 'Вопрос', true), answer(2, 'Ответ')], unread: 1 })
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    const names = screen.getAllByRole('button').map((button) => button.querySelector('span')?.textContent)
    expect(names).toEqual(['Связаться', 'Сообщить об ошибке', 'Чат с поддержкой', 'Ваши предложения'])
    const entry = screen.getByRole('button', { name: /Чат с поддержкой/ })
    expect(await within(entry).findByLabelText('Новых сообщений: 1')).toHaveTextContent('1')
    await user.click(entry)
    expect(await screen.findByRole('dialog', { name: 'Чат с поддержкой' })).toHaveTextContent('Ответ')
    await waitFor(() => expect(within(entry).queryByLabelText(/Новых сообщений/)).toBeNull())
    cleanup()
    // Settings → «Поддержка» keeps its three buttons.
    render(<SupportButtons variant="panel" />)
    expect(screen.getAllByRole('button').map((button) => button.querySelector('span')?.textContent)).toEqual(['Связаться', 'Сообщить об ошибке', 'Ваши предложения'])
  })

  it('a conversation the owner deleted («Проблема решена») leaves the app at once: no count, an empty chat', async () => {
    const server = mockServer(signedIn, { messages: [mine(1, 'Карта не грузится', true), answer(2, 'Обновите приложение')], unread: 1 })
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    const contact = screen.getByRole('button', { name: /Связаться/ })
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
    expect(within(screen.getByRole('button', { name: /Связаться/ })).getByLabelText('Новых сообщений: 1')).toBeInTheDocument()
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
      expect(uiText('Или напишите нам в Telegram')).toBe('Or message us on Telegram')
      expect(uiText('Enter — отправить, Shift+Enter — новая строка')).toBe('Enter to send, Shift+Enter for a new line')
      expect(uiText('Новых сообщений: 3')).toBe('New messages: 3')
      expect(uiText('Новых уведомлений: 4')).toBe('New notifications: 4')
      expect(uiText('Непрочитанных: 2')).toBe('Unread: 2')
      expect(uiText('Слишком много сообщений. Подождите несколько минут.')).toBe('Too many messages. Please wait a few minutes.')
      expect(uiText('Сообщение длиннее 2000 символов')).toBe('The message is longer than 2000 characters')
      expect(uiText('Напишите нам в чат поддержки, отправьте отчёт об ошибке со скриншотами или поделитесь идеей для приложения.')).toBe('Message us in the support chat, send a bug report with screenshots or share an idea for the app.')
      expect(uiText('Чаты')).toBe('Chats')
      expect(uiText('Ответ игроку…')).toBe('Reply to the player…')
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
