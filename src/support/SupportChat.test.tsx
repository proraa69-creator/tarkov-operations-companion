import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportChatDialog } from './SupportChat'
import { resetSupportChat, supportTime, type SupportMessage } from './supportChatClient'
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

/** The desktop gateway with a server conversation: GET answers `thread`, POST appends the player's message. */
function mockServer(status: unknown, thread: { messages: SupportMessage[]; unread: number }) {
  const calls: Array<[string, string, unknown]> = []
  let nextId = 100
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body])
    if (method === 'GET' && path.startsWith('/v1/me/support/messages')) return { messages: thread.messages, unread: thread.unread }
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
