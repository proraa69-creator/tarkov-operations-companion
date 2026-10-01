/**
 * The only way the app talks to the Raid OS API server (main process only).
 *
 * - Base URL: env TARKOV_API_URL, else the address saved in the app, else the build's default server
 *   (https://raidos.app, scripts/write-build-info.mjs), else this PC (http://127.0.0.1:8787). The owner's app uses this
 *   PC's server by default only while «Сервер и сайт на этом компьютере» is on (the server laptop): a gaming PC signs
 *   in to raidos.app, where the owner's account lives. Only HTTPS or plain HTTP to localhost / 127.0.0.1 is accepted.
 * - The renderer can only reach the whitelisted paths below through `serviceRequest`.
 * - The account session token lives only here: it is encrypted with Electron `safeStorage` in userData and is
 *   never sent to the renderer, never logged. Login / logout / status have their own IPC (see main.ts).
 * - A server that is not running is reported as `ServiceUnavailableError`, so callers can fall back to local work.
 */
import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDefaultServerUrl, isOwnerBuild } from './buildEdition.js'
import { localServerEnabled } from './localServer.js'

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
  // Account: nicknames per mode, approving a website QR sign-in (services/loginCodes.ts on the server).
  { methods: ['GET'], path: /^\/v1\/accounts\/me$/ },
  { methods: ['PUT'], path: /^\/v1\/accounts\/me\/nicknames$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/qr-login\/(?:inspect|approve)$/ },
  // Phone number and SMS codes (server/src/routes/phone.ts). Only the code *requests* go through here: the calls that
  // return a session (/phone/login, /phone/reset) have their own IPC, so the token never reaches the renderer.
  { methods: ['GET'], path: /^\/v1\/accounts\/auth-config$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/phone\/(?:login|reset)\/start$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/phone\/(?:start|confirm|remove)$/ },
  // «Кабинет стримера» (server/src/routes/accounts.ts, payouts.ts): statistics, audience links, payouts.
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/referral-stats\?period=(?:day|month|year)$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/referral-campaigns$/ },
  { methods: ['GET', 'POST'], path: /^\/v1\/accounts\/me\/payouts$/ },
  { methods: ['PUT'], path: /^\/v1\/accounts\/me\/payout-settings$/ },
]

export class ServiceUnavailableError extends Error {
  constructor() { super('Сервер недоступен') }
}

export function isServiceUnavailable(error: unknown) {
  return error instanceof ServiceUnavailableError
}

/** Server address typed in the app (Profile → server account), e.g. the owner's public link; '' = default. */
let savedServerUrl = ''
let serverUrlLoaded = false
const serverUrlFile = () => join(app.getPath('userData'), 'server-url.json')

function checkServerUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Для сервера требуется HTTPS')
  return raw
}

/** Owner build with the local server mode on: this PC's server is the default instead of the build's address. */
let localPreferred = false
let localCheckedAt = 0
async function refreshLocalPreference() {
  if (!isOwnerBuild() || !buildDefaultServerUrl()) { localPreferred = false; return }
  if (Date.now() - localCheckedAt < 3000) return
  localCheckedAt = Date.now()
  localPreferred = await localServerEnabled().catch(() => false)
}

/** The local server mode was switched: decide the default server again on the next request. */
export function forgetLocalPreference() {
  localCheckedAt = 0
}

export async function loadServerUrl() {
  await refreshLocalPreference()
  if (serverUrlLoaded) return savedServerUrl
  serverUrlLoaded = true
  try {
    const value = (JSON.parse(await readFile(serverUrlFile(), 'utf8')) as { url?: unknown }).url
    savedServerUrl = typeof value === 'string' ? checkServerUrl(value.trim().replace(/\/+$/, '')) : ''
  } catch {
    savedServerUrl = ''
  }
  return savedServerUrl
}

/** Saves another server address; the session of the previous server is dropped (accounts live per server). */
export async function setServerUrl(raw: unknown) {
  const value = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : ''
  const next = value ? checkServerUrl(value.includes('://') ? value : `https://${value}`) : ''
  if (next !== savedServerUrl) await clearSession().catch(() => {})
  savedServerUrl = next
  serverUrlLoaded = true
  await writeFile(serverUrlFile(), JSON.stringify({ url: next }), 'utf8')
  return accountStatus()
}

/**
 * The address this build connects to by default: TARKOV_DEFAULT_SERVER_URL at build time (https://raidos.app), else
 * this PC. The owner's app with the local server mode on (the server laptop) uses this PC's server.
 */
export function defaultApiUrl() {
  if (localPreferred) return DEFAULT_API_URL
  return buildDefaultServerUrl() || DEFAULT_API_URL
}

export function apiBaseUrl() {
  return checkServerUrl((process.env.TARKOV_API_URL?.trim() || savedServerUrl || defaultApiUrl()).replace(/\/+$/, ''))
}

export const isLocalAddress = (url: string) => {
  try { return ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) } catch { return true }
}

// --------------------------------------------------------------------------------------------------------------
// Session (main process only)
// --------------------------------------------------------------------------------------------------------------

/** `server`: the API the session belongs to (accounts live per server); older saved sessions have none. */
interface StoredAccount { email: string; kind: 'user' | 'streamer'; server?: string }
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
    if (typeof parsed.email === 'string') account = { email: parsed.email, kind: parsed.kind === 'streamer' ? 'streamer' : 'user', ...(typeof parsed.server === 'string' ? { server: parsed.server } : {}) }
  } catch { /* not signed in */ }
  if (!canPersistToken()) return
  try {
    const token = safeStorage.decryptString(await readFile(tokenFile()))
    if (/^[A-Za-z0-9_-]{20,200}$/.test(token)) sessionToken = token
  } catch { /* no stored session or it cannot be decrypted on this machine */ }
  if (!sessionToken) account = null
}

/**
 * The session is only sent to the server it was made on: after the server address changes (another saved address,
 * or the local server mode switched off on a gaming PC) the old session is dropped instead of being sent elsewhere.
 */
async function loadSessionForServer() {
  await loadServerUrl()
  await loadSession()
  if (!sessionToken || !account?.server) return
  let base: string
  try { base = apiBaseUrl() } catch { return }
  if (account.server !== base) await clearSession()
}

/** «raidos.app» or «этот компьютер (127.0.0.1:8787)»: which server a message is about. */
function serverName(url: string) {
  try {
    const parsed = new URL(url)
    return isLocalAddress(url) ? `этот компьютер (${parsed.host})` : parsed.host
  } catch {
    return url
  }
}

async function saveSession(token: string, next: StoredAccount) {
  sessionToken = token
  let server = next.server
  try { server = apiBaseUrl() } catch { /* keep */ }
  account = { ...next, ...(server ? { server } : {}) }
  next = account
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
  await loadServerUrl()
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
  const personal = path.startsWith('/v1/me/') || /^\/v1\/accounts\/me(?:[/?]|$)/.test(path)
  await loadSessionForServer()
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

export type AccountMode = 'pvp' | 'pve' | 'seasonal'
export interface AccountSubscription { status: 'active' | 'trial' | 'inactive' | 'lifetime'; paidUntil?: string; trialEndsAt?: string }

export interface AccountStatus {
  signedIn: boolean
  email?: string
  kind?: 'user' | 'streamer'
  /** From the server account (GET /v1/accounts/me) while online. */
  nicknames?: Partial<Record<AccountMode, string>>
  subscription?: AccountSubscription
  /** Verified phone number, masked by the server. */
  phone?: string
  online: boolean
  serverUrl: string
  /** false when the OS offers no secure storage: the session is kept only until the app closes. */
  persistent: boolean
}

export async function accountStatus(): Promise<AccountStatus> {
  await loadSessionForServer()
  let serverUrl = defaultApiUrl()
  let online: boolean
  let details: Pick<AccountStatus, 'nicknames' | 'subscription' | 'phone'> = {}
  try {
    serverUrl = apiBaseUrl()
    const health = await send('GET', '/health', { timeoutMs: 3000 })
    online = health.response.ok
    if (online && sessionToken) {
      const me = await send('GET', '/v1/accounts/me', { token: sessionToken, timeoutMs: 5000 })
      if (me.response.status === 401) await clearSession()
      else if (me.response.ok && me.result && typeof (me.result as { email?: unknown }).email === 'string') {
        const view = me.result as { email: string; kind?: string; nicknames?: unknown; subscription?: unknown; phone?: unknown }
        const next: StoredAccount = { email: view.email, kind: view.kind === 'streamer' ? 'streamer' : 'user' }
        if (next.email !== account?.email || next.kind !== account?.kind) await saveSession(sessionToken, next)
        details = accountDetails(view)
      }
    }
  } catch { online = false }
  return { signedIn: Boolean(sessionToken), ...(account && sessionToken ? { email: account.email, kind: account.kind, ...details } : {}), online, serverUrl, persistent: canPersistToken() }
}

const NICKNAME = /^[a-zA-Z0-9_-]{3,15}$/

/** Only the fields the app shows, shape-checked (the server is trusted, the network is not). */
function accountDetails(view: { nicknames?: unknown; subscription?: unknown; phone?: unknown }): Pick<AccountStatus, 'nicknames' | 'subscription' | 'phone'> {
  const nicknames: Partial<Record<AccountMode, string>> = {}
  const raw = view.nicknames && typeof view.nicknames === 'object' ? view.nicknames as Record<string, unknown> : {}
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    const value = raw[mode]
    if (typeof value === 'string' && NICKNAME.test(value)) nicknames[mode] = value
  }
  const sub = view.subscription && typeof view.subscription === 'object' ? view.subscription as Record<string, unknown> : {}
  // Streamers use the service free of charge for good: { status: 'active', lifetime: true } on the server.
  const status = sub.lifetime === true ? 'lifetime' : ['active', 'trial', 'inactive'].includes(String(sub.status)) ? sub.status as AccountSubscription['status'] : 'inactive'
  const date = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined)
  const paidUntil = date(sub.paidUntil)
  const trialEndsAt = date(sub.trialEndsAt)
  // The verified phone number comes masked from the server (+7 ••• •••-45-67).
  const masked = view.phone && typeof view.phone === 'object' ? (view.phone as { masked?: unknown }).masked : undefined
  const phone = typeof masked === 'string' && /^[+\d •-]{5,32}$/.test(masked) ? masked : undefined
  return { nicknames, subscription: { status, ...(paidUntil ? { paidUntil } : {}), ...(trialEndsAt ? { trialEndsAt } : {}) }, ...(phone ? { phone } : {}) }
}

/**
 * «Войти в мобильную версию»: a one-time code for the phone app (POST /v1/accounts/me/login-codes, two minutes, works
 * once). The session token itself never leaves this process; only the short-lived code goes into the QR code.
 */
export async function createMobileLoginCode(): Promise<{ code: string; expiresAt: string }> {
  await loadSessionForServer()
  if (!sessionToken) throw new Error('Сначала войдите в аккаунт')
  const { response, result } = await send('POST', '/v1/accounts/me/login-codes', { token: sessionToken, timeoutMs: 8000 })
  if (response.status === 401) { await clearSession(); throw new Error('Сессия истекла. Войдите в аккаунт снова.') }
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Сервер не создал код: ${response.status}`)
  const answer = result as { code?: unknown; expiresAt?: unknown } | null
  if (typeof answer?.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(answer.code) || typeof answer.expiresAt !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  return { code: answer.code, expiresAt: answer.expiresAt }
}

export async function accountLogin(rawEmail: unknown, rawPassword: unknown): Promise<AccountStatus> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  const password = typeof rawPassword === 'string' ? rawPassword : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail')
  if (password.length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов')
  await loadServerUrl()
  const server = serverName(apiBaseUrl())
  let sent: Awaited<ReturnType<typeof send>>
  try {
    sent = await send('POST', '/v1/accounts/login', { body: { email, password } })
  } catch (error) {
    if (isServiceUnavailable(error)) throw new Error(`Сервер ${server} недоступен. Проверьте интернет или адрес сервера.`, { cause: error })
    throw error
  }
  const { response, result } = sent
  // Accounts live per server: a wrong address is the usual reason for «wrong password» (the server never says
  // whether an e-mail exists, so the app names the server instead).
  if (response.status === 401) throw new Error(`Неверный e-mail или пароль для сервера ${server}. Аккаунты на разных серверах не общие: если вы регистрировались на другом сайте (например, raidos.app), укажите его адрес сервера выше.`)
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(answer.token)) throw new Error('Сервер вернул неожиданный ответ')
  await saveSession(answer.token, { email: typeof answer.account?.email === 'string' ? answer.account.email : email, kind: answer.account?.kind === 'streamer' ? 'streamer' : 'user' })
  return accountStatus()
}

/**
 * Sign-in by phone, or a password reset by phone, after the SMS code (POST /v1/accounts/phone/login | /phone/reset).
 * The code request itself goes through `serviceRequest`; this call returns a session, so it stays in this process.
 */
export async function accountPhoneSignIn(kind: unknown, rawChallenge: unknown, rawCode: unknown, rawPassword?: unknown): Promise<AccountStatus> {
  const challengeId = typeof rawChallenge === 'string' ? rawChallenge : ''
  const code = typeof rawCode === 'string' ? rawCode.replace(/[\s-]/g, '') : ''
  if (!/^[A-Za-z0-9_-]{32}$/.test(challengeId)) throw new Error('Запросите код ещё раз')
  if (!/^\d{6}$/.test(code)) throw new Error('Код из SMS — 6 цифр')
  const reset = kind === 'reset'
  const password = typeof rawPassword === 'string' ? rawPassword : ''
  if (reset && (password.length < 8 || password.length > 128)) throw new Error('Новый пароль: от 8 до 128 символов')
  await loadServerUrl()
  let sent: Awaited<ReturnType<typeof send>>
  try {
    sent = await send('POST', reset ? '/v1/accounts/phone/reset' : '/v1/accounts/phone/login', { body: reset ? { challengeId, code, password } : { challengeId, code } })
  } catch (error) {
    if (isServiceUnavailable(error)) throw new Error(`Сервер ${serverName(apiBaseUrl())} недоступен. Проверьте интернет или адрес сервера.`, { cause: error })
    throw error
  }
  const { response, result } = sent
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(answer.token) || typeof answer.account?.email !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  await saveSession(answer.token, { email: answer.account.email, kind: answer.account.kind === 'streamer' ? 'streamer' : 'user' })
  return accountStatus()
}

export async function accountLogout(): Promise<AccountStatus> {
  await loadSession()
  const token = sessionToken
  await clearSession()
  if (token) await send('POST', '/v1/accounts/logout', { token, timeoutMs: 5000 }).catch(() => undefined)
  return accountStatus()
}
