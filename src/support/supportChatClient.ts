/**
 * «Чат с поддержкой» in the apps (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): the
 * player's conversation with the owner (server/src/routes/supportChat.ts) through the same whitelisted gateway as the
 * rest of the account (electron/serviceGateway.ts on the PC, sync/webAccount.ts on the phone). One copy for the whole
 * app: the unread count on «Связаться» and «Ещё», and the chat window (support/SupportChat.tsx).
 *
 * Fresh at once: the owner's answer moves GET /v1/me/social-events, squad/useSocialEvents.ts then sends
 * SOCIAL_UPDATE_EVENT and the conversation is read again (only the new messages while the window is closed, all of it
 * while it is open, so the «прочитано» marks follow too). As a fallback it is read every minute while the window is open
 * and every five minutes otherwise.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { cleanSupportText, SUPPORT_MESSAGE_MAX } from '../shared/supportChat'
import { SOCIAL_UPDATE_EVENT } from '../squad/useSocialEvents'
import { cleanIpcError, refreshServerStatus, useServerAccount } from '../sync/serverSync'

export const SUPPORT_MESSAGES_PATH = '/v1/me/support/messages'
export const SUPPORT_READ_PATH = '/v1/me/support/read'
export const SUPPORT_OPEN_REFRESH_MS = 60_000
export const SUPPORT_IDLE_REFRESH_MS = 5 * 60_000
/** Messages kept in the app (the server keeps 500 per account). */
const KEPT = 500

/** 'user': the player; 'owner': the answer, shown as «Raid OS». */
export interface SupportMessage { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read: boolean }

export interface SupportChatState {
  /** Whose conversation this is ('' while signed out): another account starts from nothing. */
  account: string
  messages: SupportMessage[]
  /** The owner's answers the player has not seen. */
  unread: number
  loaded: boolean
  loading: boolean
  error: string
}

const EMPTY: SupportChatState = { account: '', messages: [], unread: 0, loaded: false, loading: false, error: '' }

/** A message of the server's answer, shape-checked; null for anything else. */
export function cleanSupportMessage(raw: unknown): SupportMessage | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!value || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 1) return null
  if ((value.author !== 'user' && value.author !== 'owner') || typeof value.text !== 'string') return null
  return { id: value.id, author: value.author, text: value.text, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', read: value.read === true }
}

/** The messages of an answer, oldest first, without the broken ones. */
export function cleanSupportMessages(raw: unknown): SupportMessage[] {
  return (Array.isArray(raw) ? raw : []).map(cleanSupportMessage).filter((message): message is SupportMessage => message !== null).sort((a, b) => a.id - b.id)
}

/** «14:05» today, «12.10 14:05» on another day of this year, with the year before that (the reader's local time). */
export function supportTime(iso: string, locale: 'ru' | 'en', now = new Date()) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const tag = locale === 'en' ? 'en-GB' : 'ru-RU'
  const time = date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return time
  return `${date.toLocaleDateString(tag, { day: '2-digit', month: '2-digit', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })} ${time}`
}

/** `known` with the newer of `incoming` after it (each message once). */
function merge(known: SupportMessage[], incoming: SupportMessage[]) {
  const byId = new Map(known.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEPT)
}

let state: SupportChatState = EMPTY
/** Moves when the account changes: answers that were on their way for the previous one are dropped. */
let generation = 0
/** Moves with every «прочитано»: a read asked for before it brings an unread count that is no longer true. */
let reads = 0
let inflight: { promise: Promise<void>; full: boolean } | null = null
const listeners = new Set<() => void>()
const set = (next: Partial<SupportChatState>) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Forgets the conversation (tests; signing out or another account does it on its own). */
export function resetSupportChat() {
  generation += 1
  inflight = null
  set(EMPTY)
}

/** Signed out, or another account signed in: the old conversation is forgotten. */
function switchAccount(account: string) {
  if (state.account === account) return
  generation += 1
  inflight = null
  set({ ...EMPTY, account })
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const request = serviceClient()
  if (!request) return null
  try {
    return await request(method, path, body)
  } catch (error) {
    const message = cleanIpcError(error)
    // Server stopped or the session expired: the account status says so everywhere.
    if (/недоступен|Сессия истекла/i.test(message)) void refreshServerStatus()
    throw new Error(message, { cause: error })
  }
}

/**
 * Reads the conversation: all of it (`full`), or only the messages after the last one the app has. Concurrent calls
 * share one request; a full read asked during a partial one follows it.
 */
export function loadSupportChat(full = true): Promise<void> {
  if (!state.account) return Promise.resolve()
  if (inflight && (inflight.full || !full)) return inflight.promise
  if (inflight) return inflight.promise.then(() => loadSupportChat(true))
  const mine = generation
  const readsBefore = reads
  const after = !full && state.loaded ? state.messages.at(-1)?.id : undefined
  set({ loading: true })
  const promise = (async () => {
    try {
      const answer = await call('GET', after ? `${SUPPORT_MESSAGES_PATH}?after=${after}` : SUPPORT_MESSAGES_PATH) as { messages?: unknown; unread?: unknown } | null
      if (mine !== generation) return
      // null: the gateway has no session (signed out meanwhile); the account status follows on its own.
      if (!answer) { set({ loading: false }); return }
      const incoming = cleanSupportMessages(answer.messages)
      // Marked read meanwhile: the server marked everything this answer counted.
      const unread = reads !== readsBefore || typeof answer.unread !== 'number' || !Number.isFinite(answer.unread) ? 0 : Math.max(0, Math.round(answer.unread))
      set({ messages: after === undefined ? incoming : merge(state.messages, incoming), unread, loaded: true, loading: false, error: '' })
    } catch (error) {
      if (mine === generation) set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mine === generation) inflight = null
    }
  })()
  inflight = { promise, full: after === undefined }
  return promise
}

/** Sends a message; it joins the conversation at once. Throws a readable error (Russian, for uiText). */
export async function sendSupportMessage(raw: string): Promise<SupportMessage> {
  const text = cleanSupportText(raw)
  if (!text) throw new Error('Напишите сообщение')
  if (text.length > SUPPORT_MESSAGE_MAX) throw new Error(`Сообщение длиннее ${SUPPORT_MESSAGE_MAX} символов`)
  const mine = generation
  const answer = await call('POST', SUPPORT_MESSAGES_PATH, { text }) as { message?: unknown } | null
  if (!answer) throw new Error('Войдите в аккаунт, чтобы написать нам')
  const message = cleanSupportMessage(answer.message)
  if (!message) throw new Error('Сервер вернул неожиданный ответ')
  if (mine === generation) set({ messages: merge(state.messages, [message]), loaded: true })
  return message
}

/** The player has seen the answers: the badge goes at once, the server tells their other devices. */
export async function markSupportRead() {
  if (!state.unread) return
  const mine = generation
  reads += 1
  set({ unread: 0 })
  try {
    await call('POST', SUPPORT_READ_PATH)
  } catch {
    // Not saved: the next read brings the real count back.
    if (mine === generation) void loadSupportChat(false)
  }
}

// One listener and one timer for every badge and window: a social event or the timer reads the conversation once.
let watchers = 0
let openWindows = 0
let timer: ReturnType<typeof setInterval> | undefined
const refresh = () => { void loadSupportChat(openWindows > 0) }
function schedule() {
  if (timer !== undefined) clearInterval(timer)
  timer = watchers > 0 ? setInterval(refresh, openWindows > 0 ? SUPPORT_OPEN_REFRESH_MS : SUPPORT_IDLE_REFRESH_MS) : undefined
}
function watch(open: boolean) {
  watchers += 1
  if (open) openWindows += 1
  if (watchers === 1) window.addEventListener(SOCIAL_UPDATE_EVENT, refresh)
  schedule()
  return () => {
    watchers -= 1
    if (open) openWindows -= 1
    if (watchers === 0) window.removeEventListener(SOCIAL_UPDATE_EVENT, refresh)
    schedule()
  }
}

/** The signed-in account's key ('' while signed out), the conversation kept for it and the account status. */
function useSupportChatState(open: boolean) {
  const current = useSyncExternalStore(subscribe, () => state, () => EMPTY)
  const server = useServerAccount()
  const account = server.status?.signedIn ? server.status.email ?? 'signed-in' : ''
  useEffect(() => {
    switchAccount(account)
    if (!account) return
    const stop = watch(open)
    // A window reads everything when it opens; a badge only what it has not read yet.
    if (open || !state.loaded) void loadSupportChat(open)
    return stop
  }, [account, open])
  return { current: current.account === account ? current : { ...EMPTY, account }, account, server }
}

/** The owner's answers the player has not seen: the badge on «Связаться» and «Ещё» (0 while signed out). */
export function useSupportUnread() {
  const { current, account } = useSupportChatState(false)
  return account ? current.unread : 0
}

/** The chat window: the conversation, sending, and the answers marked seen while the window is open and visible. */
export function useSupportChat(open: boolean) {
  const { current, account, server } = useSupportChatState(open)
  const unread = account ? current.unread : 0
  useEffect(() => {
    if (!open || !unread) return
    const seen = () => { if (document.visibilityState !== 'hidden') void markSupportRead() }
    seen()
    // Opened while the app was in the background: marked when the player comes back to it.
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [open, unread])
  const reload = useCallback(() => loadSupportChat(true), [])
  return {
    ...current,
    unread,
    signedIn: Boolean(account),
    /** The account status is still being read (the first answer). */
    checking: server.checking && !server.status,
    send: sendSupportMessage,
    reload,
  }
}
