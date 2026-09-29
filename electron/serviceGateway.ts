/**
 * The only way the app talks to the Tarkov Operator API server (main process only).
 *
 * - Base URL: env TARKOV_API_URL, otherwise the owner's local server http://127.0.0.1:8787. Only HTTPS or
 *   plain HTTP to localhost / 127.0.0.1 is accepted.
 * - The renderer can only reach the whitelisted paths below through `serviceRequest`.
 * - The account session token lives only here: it is encrypted with Electron `safeStorage` in userData and is
 *   never sent to the renderer, never logged. Login / logout / status have their own IPC (see main.ts).
 * - A server that is not running is reported as `ServiceUnavailableError`, so callers can fall back to local work.
 */
import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_API_URL = 'http://127.0.0.1:8787'
const MODE = '(?:pvp|pve|seasonal)'

type Method = 'GET' | 'POST' | 'PUT'
const ROUTES: Array<{ methods: Method[]; path: RegExp }> = [
  { methods: ['GET'], path: /^\/health$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/catalog/${MODE}$`) },
  { methods: ['POST'], path: /^\/v1\/players\/resolve$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/players/${MODE}/\\d{1,12}$`) },
  { methods: ['POST'], path: /^\/v1\/sync\/events$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/goons/${MODE}$`) },
  { methods: ['POST'], path: new RegExp(`^/v1/goons/${MODE}/sightings$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/me/progress/${MODE}$`) },
  { methods: ['POST'], path: new RegExp(`^/v1/me/progress/${MODE}/events$`) },
  { methods: ['GET', 'PUT'], path: new RegExp(`^/v1/me/collector/${MODE}$`) },
  { methods: ['GET', 'POST'], path: new RegExp(`^/v1/me/position/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: /^\/v1\/me\/settings$/ },
  { methods: ['GET'], path: /^\/v1\/me\/summary$/ },
]

export class ServiceUnavailableError extends Error {
  constructor() { super('Сервер недоступен') }
}

export function isServiceUnavailable(error: unknown) {
  return error instanceof ServiceUnavailableError
}

export function apiBaseUrl() {
  const raw = (process.env.TARKOV_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, '')
  const url = new URL(raw)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Для сервера требуется HTTPS')
  return raw
}

// --------------------------------------------------------------------------------------------------------------
// Session (main process only)
// --------------------------------------------------------------------------------------------------------------

interface StoredAccount { email: string; kind: 'user' | 'streamer' }
let sessionToken: string | null = null
let account: StoredAccount | null = null
let loaded = false

const tokenFile = () => join(app.getPath('userData'), 'server-session.bin')
const accountFile = () => join(app.getPath('userData'), 'server-account.json')

/** A real OS-backed encryption (DPAPI on Windows, Keychain on macOS, a keyring on Linux). */
function canPersistToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

async function loadSession() {
  if (loaded) return
  loaded = true
  try {
    const parsed = JSON.parse(await readFile(accountFile(), 'utf8')) as Partial<StoredAccount>
    if (typeof parsed.email === 'string') account = { email: parsed.email, kind: parsed.kind === 'streamer' ? 'streamer' : 'user' }
  } catch { /* not signed in */ }
  if (!canPersistToken()) return
  try {
    const token = safeStorage.decryptString(await readFile(tokenFile()))
    if (/^[A-Za-z0-9_-]{20,200}$/.test(token)) sessionToken = token
  } catch { /* no stored session or it cannot be decrypted on this machine */ }
  if (!sessionToken) account = null
}

async function saveSession(token: string, next: StoredAccount) {
  sessionToken = token
  account = next
  loaded = true
  await writeFile(accountFile(), JSON.stringify(next), 'utf8').catch(() => {})
  // Without OS encryption the token stays in memory only: the user signs in again after a restart.
  if (canPersistToken()) await writeFile(tokenFile(), safeStorage.encryptString(token)).catch(() => {})
}

async function clearSession() {
  sessionToken = null
  account = null
  loaded = true
  await rm(tokenFile(), { force: true }).catch(() => {})
  await rm(accountFile(), { force: true }).catch(() => {})
}

// --------------------------------------------------------------------------------------------------------------
// HTTP
// --------------------------------------------------------------------------------------------------------------

async function send(method: Method, path: string, options: { body?: unknown; token?: string | null; timeoutMs?: number } = {}) {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ServiceUnavailableError()
  }
  const result = response.status === 204 ? null : await response.json().catch(() => null) as { error?: string } | null
  return { response, result }
}

/** Whitelisted request from the renderer. `/v1/me/*` returns null when no account is signed in. */
export async function serviceRequest(method: string, path: string, body?: unknown): Promise<unknown | null> {
  const route = ROUTES.find((entry) => entry.path.test(String(path)))
  if (!route || !route.methods.includes(method as Method)) throw new Error('Неизвестный запрос сервиса')
  const personal = path.startsWith('/v1/me/')
  await loadSession()
  if (personal && !sessionToken) return null
  // The development sync endpoint keeps its device token; everything else uses the signed-in account.
  const token = path === '/v1/sync/events' ? process.env.TARKOV_API_TOKEN ?? null : sessionToken
  const { response, result } = await send(method as Method, path, { body, token, timeoutMs: path.startsWith('/v1/catalog/') || path.startsWith('/v1/players/') ? 45_000 : 15_000 })
  if (response.status === 401 && personal) {
    await clearSession()
    throw new Error('Сессия истекла. Войдите в аккаунт сервера снова.')
  }
  if (!response.ok) throw new Error(result?.error ?? `Сервис недоступен: ${response.status}`)
  return result
}

/** For main-process callers that have a local fallback: null when the server is not reachable. */
export async function serviceRequestOrNull(method: string, path: string, body?: unknown) {
  try {
    return await serviceRequest(method, path, body)
  } catch (error) {
    if (isServiceUnavailable(error)) return null
    throw error
  }
}

export interface AccountStatus {
  signedIn: boolean
  email?: string
  kind?: 'user' | 'streamer'
  online: boolean
  serverUrl: string
  /** false when the OS offers no secure storage: the session is kept only until the app closes. */
  persistent: boolean
}

export async function accountStatus(): Promise<AccountStatus> {
  await loadSession()
  let serverUrl = DEFAULT_API_URL
  let online: boolean
  try {
    serverUrl = apiBaseUrl()
    const health = await send('GET', '/health', { timeoutMs: 3000 })
    online = health.response.ok
    if (online && sessionToken) {
      const me = await send('GET', '/v1/accounts/me', { token: sessionToken, timeoutMs: 5000 })
      if (me.response.status === 401) await clearSession()
      else if (me.response.ok && me.result && typeof (me.result as { email?: unknown }).email === 'string') {
        const view = me.result as { email: string; kind?: string }
        const next: StoredAccount = { email: view.email, kind: view.kind === 'streamer' ? 'streamer' : 'user' }
        if (next.email !== account?.email || next.kind !== account?.kind) await saveSession(sessionToken, next)
      }
    }
  } catch { online = false }
  return { signedIn: Boolean(sessionToken), ...(account && sessionToken ? { email: account.email, kind: account.kind } : {}), online, serverUrl, persistent: canPersistToken() }
}

export async function accountLogin(rawEmail: unknown, rawPassword: unknown): Promise<AccountStatus> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  const password = typeof rawPassword === 'string' ? rawPassword : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail')
  if (password.length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов')
  const { response, result } = await send('POST', '/v1/accounts/login', { body: { email, password } })
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(answer.token)) throw new Error('Сервер вернул неожиданный ответ')
  await saveSession(answer.token, { email: typeof answer.account?.email === 'string' ? answer.account.email : email, kind: answer.account?.kind === 'streamer' ? 'streamer' : 'user' })
  return accountStatus()
}

export async function accountLogout(): Promise<AccountStatus> {
  await loadSession()
  const token = sessionToken
  await clearSession()
  if (token) await send('POST', '/v1/accounts/logout', { token, timeoutMs: 5000 }).catch(() => undefined)
  return accountStatus()
}
