/**
 * Server account for the phone app (Capacitor) and the browser preview — the same contract as the desktop
 * gateway in electron/serviceGateway.ts, but over `fetch` from the renderer, because there is no main process.
 *
 * - The server address is set by the user in Settings → «Адрес сервера» (a phone cannot reach 127.0.0.1 of the PC:
 *   use the PC's LAN address, e.g. http://192.168.1.20:8787, or an HTTPS address). Plain HTTP is accepted only
 *   for localhost and private LAN addresses; anything public must be HTTPS.
 * - The session token is kept in the app's private WebView storage (never logged, never put in a URL).
 * - Only the whitelisted paths below can be requested.
 */
import type { ServerAccountStatus } from '../electron.d'

export const DEFAULT_API_URL = (import.meta.env.VITE_TARKOV_API_URL as string | undefined)?.trim() || 'http://127.0.0.1:8787'
export const API_URL_STORAGE_KEY = 'tarkov-mobile-api-url-v1'
const SESSION_STORAGE_KEY = 'tarkov-mobile-session-v1'
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/
const MODE = '(?:pvp|pve|seasonal)'

type Method = 'GET' | 'POST' | 'PUT'
const ROUTES: Array<{ methods: Method[]; path: RegExp }> = [
  { methods: ['GET'], path: /^\/health$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/catalog/${MODE}$`) },
  { methods: ['POST'], path: /^\/v1\/players\/resolve$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/players/${MODE}/\\d{1,12}$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/me/progress/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: new RegExp(`^/v1/me/collector/${MODE}$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/me/position/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: /^\/v1\/me\/settings$/ },
  { methods: ['GET'], path: /^\/v1\/me\/summary$/ },
]

interface StoredSession { token: string; email: string; kind: 'user' | 'streamer' }

function read(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* storage unavailable */ }
}

const PRIVATE_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[a-z0-9-]+\.local)$/i

/** Normalizes a server address; throws a readable error for unusable ones. */
export function normalizeApiUrl(raw: string) {
  let value = raw.trim().replace(/\/+$/, '')
  if (!value) throw new Error('Введите адрес сервера')
  if (!/^[a-z]+:\/\//i.test(value)) value = `http://${value}`
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Некорректный адрес сервера') }
  if (url.username || url.password || url.search || url.hash) throw new Error('Некорректный адрес сервера')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && PRIVATE_HOST.test(url.hostname))) {
    throw new Error('HTTP разрешён только для адресов домашней сети; для остальных нужен HTTPS')
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

export function apiBaseUrl() {
  const saved = read(API_URL_STORAGE_KEY)
  if (saved) {
    try { return normalizeApiUrl(saved) } catch { /* fall back to the default */ }
  }
  return DEFAULT_API_URL
}

export function setApiBaseUrl(raw: string) {
  const url = normalizeApiUrl(raw)
  write(API_URL_STORAGE_KEY, url === DEFAULT_API_URL ? null : url)
  return url
}

function loadSession(): StoredSession | null {
  try {
    const parsed = JSON.parse(read(SESSION_STORAGE_KEY) ?? 'null') as Partial<StoredSession> | null
    if (!parsed || typeof parsed.token !== 'string' || !TOKEN.test(parsed.token) || typeof parsed.email !== 'string') return null
    return { token: parsed.token, email: parsed.email, kind: parsed.kind === 'streamer' ? 'streamer' : 'user' }
  } catch {
    return null
  }
}
const saveSession = (session: StoredSession | null) => write(SESSION_STORAGE_KEY, session ? JSON.stringify(session) : null)

class UnavailableError extends Error {
  constructor() { super('Сервер недоступен') }
}

async function send(method: Method, path: string, options: { body?: unknown; token?: string | null; timeoutMs?: number } = {}) {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    })
  } catch {
    throw new UnavailableError()
  }
  const result = response.status === 204 ? null : await response.json().catch(() => null) as { error?: string } | null
  return { response, result }
}

/** Same shape as the desktop `serviceRequest`: null for `/v1/me/*` while signed out. */
export async function webServiceRequest(method: Method, path: string, body?: unknown): Promise<unknown | null> {
  const route = ROUTES.find((entry) => entry.path.test(path))
  if (!route || !route.methods.includes(method)) throw new Error('Неизвестный запрос сервиса')
  const session = loadSession()
  const personal = path.startsWith('/v1/me/')
  if (personal && !session) return null
  const { response, result } = await send(method, path, { body, token: personal ? session?.token : null, timeoutMs: /^\/v1\/(?:players|catalog)\//.test(path) ? 45_000 : 15_000 })
  if (response.status === 401 && personal) {
    saveSession(null)
    throw new Error('Сессия истекла. Войдите в аккаунт сервера снова.')
  }
  if (!response.ok) throw new Error(result?.error ?? `Сервис недоступен: ${response.status}`)
  return result
}

export async function webAccountStatus(): Promise<ServerAccountStatus> {
  let session = loadSession()
  const serverUrl = apiBaseUrl()
  let online: boolean
  try {
    const health = await send('GET', '/health', { timeoutMs: 4000 })
    online = health.response.ok
    if (online && session) {
      const me = await send('GET', '/v1/accounts/me', { token: session.token, timeoutMs: 5000 })
      if (me.response.status === 401) { saveSession(null); session = null }
      else if (me.response.ok && typeof (me.result as { email?: unknown } | null)?.email === 'string') {
        const view = me.result as { email: string; kind?: string }
        const next: StoredSession = { token: session.token, email: view.email, kind: view.kind === 'streamer' ? 'streamer' : 'user' }
        if (next.email !== session.email || next.kind !== session.kind) { saveSession(next); session = next }
      }
    }
  } catch { online = false }
  return { signedIn: Boolean(session), ...(session ? { email: session.email, kind: session.kind } : {}), online, serverUrl, persistent: true }
}

export async function webAccountLogin(rawEmail: string, rawPassword: string): Promise<ServerAccountStatus> {
  const email = rawEmail.trim().toLowerCase()
  const password = rawPassword
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail')
  if (password.length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов')
  const { response, result } = await send('POST', '/v1/accounts/login', { body: { email, password } })
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !TOKEN.test(answer.token)) throw new Error('Сервер вернул неожиданный ответ')
  saveSession({ token: answer.token, email: typeof answer.account?.email === 'string' ? answer.account.email : email, kind: answer.account?.kind === 'streamer' ? 'streamer' : 'user' })
  return webAccountStatus()
}

export async function webAccountLogout(): Promise<ServerAccountStatus> {
  const session = loadSession()
  saveSession(null)
  if (session) await send('POST', '/v1/accounts/logout', { token: session.token, timeoutMs: 5000 }).catch(() => undefined)
  return webAccountStatus()
}
