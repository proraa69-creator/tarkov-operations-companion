import { API_URL } from './config'

/**
 * The site's support chat (owner, 17.11.2026: «справа в углу должно быть кружочек и открывается чат. Можно войти как гость, а
 * если человек в аккаунте, то он может написать в поддержку… если он не авторизован, то пишется как гость»).
 * Signed in: the account's own conversation (/v1/me/support, the same one as in the app). A guest: a conversation of its
 * own (/v1/support/guest), its token kept in this browser; the owner answers both from «Заявки» → «Чаты».
 */
export interface SupportMessage { id: number; author: 'user' | 'owner'; text: string; createdAt: string; read?: boolean }
export interface SupportPage { messages: SupportMessage[]; unread: number }
export type SupportWho = { kind: 'account'; token: string } | { kind: 'guest'; token: string | null }

const GUEST_KEY = 'raidos-support-guest'
export const SUPPORT_TEXT_MAX = 2000

export function loadGuestToken() {
  try { return window.localStorage.getItem(GUEST_KEY) } catch { return null }
}
function saveGuestToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(GUEST_KEY, token)
    else window.localStorage.removeItem(GUEST_KEY)
  } catch { /* storage unavailable: the guest's chat lives until the page closes */ }
}

export class SupportChatError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function call<T>(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SupportChatError(0, 'Нет связи с сервером. Попробуйте ещё раз.')
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) throw new SupportChatError(response.status, typeof data?.error === 'string' ? data.error : 'Не удалось отправить. Попробуйте ещё раз.')
  return data as T
}

const headersOf = (who: SupportWho): Record<string, string> => who.kind === 'account'
  ? { authorization: `Bearer ${who.token}` }
  : who.token ? { 'x-support-guest': who.token } : {}
const base = (who: SupportWho) => who.kind === 'account' ? '/v1/me/support' : '/v1/support/guest'

/** The conversation; a guest who never wrote has none (and a forgotten guest token starts afresh). */
export async function readSupport(who: SupportWho): Promise<SupportPage> {
  if (who.kind === 'guest' && !who.token) return { messages: [], unread: 0 }
  try {
    const page = await call<SupportPage>('GET', `${base(who)}/messages`, headersOf(who))
    return { messages: Array.isArray(page.messages) ? page.messages : [], unread: Number(page.unread) || 0 }
  } catch (error) {
    if (who.kind === 'guest' && error instanceof SupportChatError && error.status === 401) { saveGuestToken(null); return { messages: [], unread: 0 } }
    throw error
  }
}

/** Sends a message; a guest's first message makes the guest's conversation. Returns the guest token in use. */
export async function sendSupport(who: SupportWho, text: string): Promise<{ message: SupportMessage; guestToken?: string }> {
  if (who.kind === 'account') return call('POST', '/v1/me/support/messages', headersOf(who), { text })
  let token = who.token
  if (!token) {
    token = (await call<{ token: string }>('POST', '/v1/support/guest', {})).token
    saveGuestToken(token)
  }
  const sent = await call<{ message: SupportMessage }>('POST', '/v1/support/guest/messages', { 'x-support-guest': token }, { text })
  return { ...sent, guestToken: token }
}

export async function markSupportRead(who: SupportWho) {
  if (who.kind === 'guest' && !who.token) return
  await call('POST', who.kind === 'account' ? '/v1/me/support/read' : '/v1/support/guest/read', headersOf(who)).catch(() => undefined)
}
