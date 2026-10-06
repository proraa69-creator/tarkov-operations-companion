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
import type { EntitlementView, ServerAccountStatus, ServerRegistrationResult } from '../electron.d'
import { webAcceptIssued, webClearEntitlement, webDeviceId, webDeviceName, webEntitlementDue, webEntitlementFor, webForgetKey, webPinKey, webRefuseEntitlement } from './webEntitlement'

/** The owner's permanent address (site + API under /v1), unless the build sets VITE_TARKOV_API_URL. */
export const DEFAULT_API_URL = (import.meta.env.VITE_TARKOV_API_URL as string | undefined)?.trim() || 'https://raidos.app'
export const API_URL_STORAGE_KEY = 'tarkov-mobile-api-url-v1'
const SESSION_STORAGE_KEY = 'tarkov-mobile-session-v1'
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/
const MODE = '(?:pvp|pve|seasonal)'

type Method = 'GET' | 'POST' | 'PUT'
const ROUTES: Array<{ methods: Method[]; path: RegExp }> = [
  { methods: ['GET'], path: /^\/health$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/catalog/${MODE}(?:\\?lang=(?:ru|en))?$`) },
  // Paid game data through the server only (server/src/routes/data.ts, docs/subscription-protection.md).
  { methods: ['POST'], path: /^\/v1\/data\/graphql$/ },
  { methods: ['GET'], path: /^\/v1\/data\/json\/(?:regular|pve|pvp-season)\/[a-z]{2,20}(?:_[a-z]{2})?$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/devices$/ },
  // Plans and prices for the paywall (public, server/src/routes/payments.ts).
  { methods: ['GET'], path: /^\/v1\/payments\/plans$/ },
  { methods: ['POST'], path: /^\/v1\/players\/resolve$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/players/${MODE}/\\d{1,12}$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/me/progress/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: new RegExp(`^/v1/me/collector/${MODE}$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/me/position/${MODE}$`) },
  // Objective progress and its history (server/src/routes/me.ts).
  { methods: ['GET'], path: new RegExp(`^/v1/me/objectives/${MODE}$`) },
  { methods: ['POST'], path: new RegExp(`^/v1/me/objectives/${MODE}/(?:sync|events/[A-Za-z0-9_-]{6,80}/undo)$`) },
  { methods: ['GET', 'PUT'], path: /^\/v1\/me\/settings$/ },
  { methods: ['GET'], path: /^\/v1\/me\/summary$/ },
  // Bosses placed on the maps by the owner (server/src/routes/mapBosses.ts).
  { methods: ['GET'], path: /^\/v1\/map-bosses$/ },
  // Quest map points corrected by the owner (server/src/routes/questPoints.ts).
  { methods: ['GET'], path: /^\/v1\/quest-points$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me$/ },
  { methods: ['PUT'], path: /^\/v1\/accounts\/me\/nicknames$/ },
  // «Кабинет стримера» on the phone too.
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/referral-stats\?period=(?:day|month|year)$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/referral-campaigns$/ },
  { methods: ['GET', 'POST'], path: /^\/v1\/accounts\/me\/payouts$/ },
  { methods: ['PUT'], path: /^\/v1\/accounts\/me\/payout-settings$/ },
  // Approving a website QR sign-in from the phone (docs/mobile.md).
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/qr-login\/(?:inspect|approve)$/ },
  // Phone number and SMS codes (server/src/routes/phone.ts); sign-in by code is webAccountPhoneSignIn.
  { methods: ['GET'], path: /^\/v1\/accounts\/auth-config$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/phone\/(?:login|reset)\/start$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/phone\/(?:start|confirm|remove)$/ },
  // E-mail codes (server/src/routes/email.ts); sign-in by code is webAccountEmailSignIn.
  { methods: ['POST'], path: /^\/v1\/accounts\/email\/(?:login|reset)\/start$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/email\/(?:start|confirm)$/ },
  // «Отряд» (server/src/routes/squads.ts): the server checks membership on every call.
  { methods: ['GET'], path: new RegExp(`^/v1/squads/mine/${MODE}$`) },
  { methods: ['POST'], path: /^\/v1\/squads(?:\/join)?$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/squads/[a-f0-9]{32}/overview/${MODE}$`) },
  { methods: ['POST'], path: /^\/v1\/squads\/[a-f0-9]{32}\/(?:invites|leave|disband|kick|invite-friend)$/ },
  { methods: ['POST'], path: /^\/v1\/squads\/invitations\/[a-f0-9]{24}\/(?:accept|decline)$/ },
  // Friends (server/src/routes/friends.ts): the server checks the friendship on every call.
  { methods: ['GET'], path: /^\/v1\/friends$/ },
  { methods: ['POST'], path: /^\/v1\/friends\/(?:requests|code)$/ },
  { methods: ['POST'], path: /^\/v1\/friends\/requests\/[a-f0-9]{24}\/(?:accept|decline|cancel)$/ },
  { methods: ['POST'], path: /^\/v1\/friends\/[a-f0-9]{24}\/(?:remove|block|unblock)$/ },
  { methods: ['PUT'], path: /^\/v1\/friends\/[a-f0-9]{24}\/privacy$/ },
  { methods: ['POST'], path: new RegExp(`^/v1/friends/progress/${MODE}$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/friends/needs/${MODE}$`) },
  // Registration in the app: «Отправить код ещё раз» and the consent record. /register and /register/confirm return a
  // session: webAccountRegister / webAccountRegisterConfirm keep it, like the sign-in.
  { methods: ['POST'], path: /^\/v1\/accounts\/register\/resend$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/consents$/ },
  // «Сообщить об ошибке» (server/src/routes/bugReports.ts): signed-in accounts only.
  { methods: ['POST'], path: /^\/v1\/bug-reports$/ },
]

interface StoredSession { token: string; email: string; kind: 'user' | 'streamer' }

/** Paid data routes: sent with the session and this device's id (server/src/routes/data.ts). */
const GATED = /^\/v1\/(?:data|catalog|players)\//

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
const saveSession = (session: StoredSession | null) => {
  // A new session asks for the entitlement at once; signing out drops it (and the server key pinned on first use).
  if (session?.token !== loadSession()?.token) entitlementDue = true
  if (!session) { webClearEntitlement(); webForgetKey(apiBaseUrl()) }
  write(SESSION_STORAGE_KEY, session ? JSON.stringify(session) : null)
}
let entitlementDue = false

class UnavailableError extends Error {
  constructor() { super('Сервер недоступен') }
}

async function send(method: Method, path: string, options: { body?: unknown; token?: string | null; timeoutMs?: number; device?: string } = {}) {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.device ? { 'x-raid-device': options.device } : {}) },
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
  const personal = path.startsWith('/v1/me/') || /^\/v1\/(?:squads|friends|bug-reports)(?:\/|$)/.test(path) || /^\/v1\/accounts\/me(?:[/?]|$)/.test(path)
  const gated = GATED.test(path)
  if (personal && !session) return null
  if (gated && !session) throw new Error('Требуется вход в аккаунт')
  const { response, result } = await send(method, path, { body, token: personal || gated ? session?.token : null, timeoutMs: gated ? 60_000 : path === '/v1/bug-reports' ? 180_000 : 15_000, ...(gated ? { device: webDeviceId() } : {}) })
  if (response.status === 401 && (personal || gated)) {
    saveSession(null)
    throw new Error('Сессия истекла. Войдите в аккаунт сервера снова.')
  }
  const code = (result as { code?: unknown } | null)?.code
  if (gated && response.status === 402) webRefuseEntitlement('subscription', result?.error)
  if (gated && response.status === 403 && (code === 'device_revoked' || code === 'device_inactive')) webRefuseEntitlement(code === 'device_revoked' ? 'device-revoked' : 'device-inactive', result?.error)
  if (!response.ok) throw new Error(result?.error ?? `Сервис недоступен: ${response.status}`)
  return result
}

/** Signed entitlement of this device (sync/webEntitlement.ts): renewed every few hours, offline the stored one. */
async function webEntitlement(session: StoredSession | null, online: boolean): Promise<EntitlementView> {
  if (!session) return { valid: false, reason: 'signed-out' }
  const server = apiBaseUrl()
  const force = entitlementDue
  entitlementDue = false
  if (!online || (!force && !webEntitlementDue(server))) return webEntitlementFor(server)
  try {
    const key = await send('GET', '/v1/entitlement/public-key', { timeoutMs: 8000 })
    if (!webPinKey(server, (key.result as { publicKey?: unknown } | null)?.publicKey)) return { valid: false, reason: 'key-mismatch' }
    const { response, result } = await send('POST', '/v1/entitlement', { token: session.token, timeoutMs: 10_000, body: { deviceId: webDeviceId(), deviceName: webDeviceName() } })
    if (response.status === 402) { webRefuseEntitlement('subscription', (result as { error?: string } | null)?.error); return webEntitlementFor(server) }
    if (response.ok) return webAcceptIssued(server, result)
  } catch { /* offline: the stored token */ }
  return webEntitlementFor(server)
}

export async function webAccountStatus(): Promise<ServerAccountStatus> {
  let session = loadSession()
  const serverUrl = apiBaseUrl()
  let online: boolean
  let details: Pick<ServerAccountStatus, 'nicknames' | 'subscription' | 'phone' | 'emailVerified'> = {}
  try {
    const health = await send('GET', '/health', { timeoutMs: 4000 })
    online = health.response.ok
    if (online && session) {
      const me = await send('GET', '/v1/accounts/me', { token: session.token, timeoutMs: 5000 })
      if (me.response.status === 401) { saveSession(null); session = null }
      else if (me.response.ok && typeof (me.result as { email?: unknown } | null)?.email === 'string') {
        const view = me.result as { email: string; kind?: string; nicknames?: unknown; subscription?: unknown; phone?: unknown; emailVerifiedAt?: unknown }
        const next: StoredSession = { token: session.token, email: view.email, kind: view.kind === 'streamer' ? 'streamer' : 'user' }
        if (next.email !== session.email || next.kind !== session.kind) { saveSession(next); session = next }
        details = accountDetails(view)
      }
    }
  } catch { online = false }
  const entitlement = await webEntitlement(session, online)
  return { signedIn: Boolean(session), ...(session ? { email: session.email, kind: session.kind, ...details } : {}), online, serverUrl, persistent: true, entitlement }
}

/** Nicknames and subscription from GET /v1/accounts/me, shape-checked (same as electron/serviceGateway.ts). */
function accountDetails(view: { nicknames?: unknown; subscription?: unknown; phone?: unknown; emailVerifiedAt?: unknown }): Pick<ServerAccountStatus, 'nicknames' | 'subscription' | 'phone' | 'emailVerified'> {
  const nicknames: NonNullable<ServerAccountStatus['nicknames']> = {}
  const raw = view.nicknames && typeof view.nicknames === 'object' ? view.nicknames as Record<string, unknown> : {}
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    const value = raw[mode]
    if (typeof value === 'string' && /^[a-zA-Z0-9_-]{3,15}$/.test(value)) nicknames[mode] = value
  }
  const sub = view.subscription && typeof view.subscription === 'object' ? view.subscription as Record<string, unknown> : {}
  type Status = NonNullable<ServerAccountStatus['subscription']>['status']
  // Streamers use the service free of charge for good: { status: 'active', lifetime: true } on the server.
  const status: Status = sub.lifetime === true ? 'lifetime' : ['active', 'trial', 'inactive'].includes(String(sub.status)) ? sub.status as Status : 'inactive'
  const date = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined)
  const paidUntil = date(sub.paidUntil)
  const trialEndsAt = date(sub.trialEndsAt)
  // The verified phone number comes masked from the server (+7 ••• •••-45-67).
  const masked = view.phone && typeof view.phone === 'object' ? (view.phone as { masked?: unknown }).masked : undefined
  const phone = typeof masked === 'string' && /^[+\d •-]{5,32}$/.test(masked) ? masked : undefined
  return { nicknames, subscription: { status, ...(paidUntil ? { paidUntil } : {}), ...(trialEndsAt ? { trialEndsAt } : {}) }, ...(phone ? { phone } : {}), emailVerified: date(view.emailVerifiedAt) !== undefined }
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

/**
 * QR sign-in on the phone: the one-time code from «Войти в мобильную версию» on the desktop (two minutes, works once)
 * is exchanged for a session of the same account. The server address must already be set (setApiBaseUrl).
 */
export async function webAccountRedeemLoginCode(code: string): Promise<ServerAccountStatus> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Некорректный код входа')
  const { response, result } = await send('POST', '/v1/accounts/login-codes/redeem', { body: { code } })
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !TOKEN.test(answer.token) || typeof answer.account?.email !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  saveSession({ token: answer.token, email: answer.account.email, kind: answer.account.kind === 'streamer' ? 'streamer' : 'user' })
  return webAccountStatus()
}

/** Sign-in or password reset by phone after the SMS code (POST /v1/accounts/phone/login | /phone/reset). */
export function webAccountPhoneSignIn(kind: 'login' | 'reset', challengeId: string, rawCode: string, password?: string): Promise<ServerAccountStatus> {
  return codeSignIn('phone', kind, challengeId, rawCode, password)
}

/** The same after an e-mail code (POST /v1/accounts/email/login | /email/reset). */
export function webAccountEmailSignIn(kind: 'login' | 'reset', challengeId: string, rawCode: string, password?: string): Promise<ServerAccountStatus> {
  return codeSignIn('email', kind, challengeId, rawCode, password)
}

async function codeSignIn(channel: 'phone' | 'email', kind: 'login' | 'reset', challengeId: string, rawCode: string, password?: string): Promise<ServerAccountStatus> {
  const code = rawCode.replace(/[\s-]/g, '')
  if (!/^[A-Za-z0-9_-]{32}$/.test(challengeId)) throw new Error('Запросите код ещё раз')
  if (!/^\d{6}$/.test(code)) throw new Error(channel === 'phone' ? 'Код из SMS — 6 цифр' : 'Код из письма — 6 цифр')
  if (kind === 'reset' && (!password || password.length < 8 || password.length > 128)) throw new Error('Новый пароль: от 8 до 128 символов')
  const { response, result } = await send('POST', `/v1/accounts/${channel}/${kind === 'reset' ? 'reset' : 'login'}`, { body: kind === 'reset' ? { challengeId, code, password } : { challengeId, code } })
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !TOKEN.test(answer.token) || typeof answer.account?.email !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  saveSession({ token: answer.token, email: answer.account.email, kind: answer.account.kind === 'streamer' ? 'streamer' : 'user' })
  return webAccountStatus()
}

const CHALLENGE_ID = /^[A-Za-z0-9_-]{32}$/

/** A session answer ({ token, account }) of the server: stored, then the status. */
async function adoptSession(result: unknown) {
  const answer = result as { token?: unknown; referralApplied?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !TOKEN.test(answer.token) || typeof answer.account?.email !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  saveSession({ token: answer.token, email: answer.account.email, kind: answer.account.kind === 'streamer' ? 'streamer' : 'user' })
  return { status: await webAccountStatus(), referralApplied: answer.referralApplied === true }
}

/**
 * Registration on the phone (POST /v1/accounts/register), the same contract as electron/serviceGateway.ts
 * accountRegister: 202 → the code from the e-mail (webAccountRegisterConfirm), or 201 with a session right away.
 */
export async function webAccountRegister(rawEmail: string, password: string, rawReferral?: string): Promise<ServerRegistrationResult> {
  const email = rawEmail.trim().toLowerCase()
  const referralCode = (rawReferral ?? '').trim()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail')
  if (password.length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов')
  if (referralCode && !/^[a-zA-Z0-9_-]{3,24}$/.test(referralCode)) throw new Error('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».')
  const { response, result } = await send('POST', '/v1/accounts/register', { body: { email, password, ...(referralCode ? { referralCode } : {}) } })
  if (response.status === 202) {
    const pending = result as { challengeId?: unknown; expiresAt?: unknown; resendSeconds?: unknown; message?: unknown } | null
    if (typeof pending?.challengeId !== 'string' || !CHALLENGE_ID.test(pending.challengeId) || typeof pending.expiresAt !== 'string') throw new Error('Сервер вернул неожиданный ответ')
    const resendSeconds = typeof pending.resendSeconds === 'number' && Number.isFinite(pending.resendSeconds) ? Math.max(0, Math.min(3600, Math.round(pending.resendSeconds))) : 60
    const message = typeof pending.message === 'string' && pending.message.length <= 300 ? pending.message : 'Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.'
    return { pending: { challengeId: pending.challengeId, expiresAt: pending.expiresAt, resendSeconds, message } }
  }
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось зарегистрироваться: ${response.status}`)
  return adoptSession(result)
}

/** The code from the registration e-mail (POST /v1/accounts/register/confirm): the account appears, signed in. */
export async function webAccountRegisterConfirm(challengeId: string, rawCode: string): Promise<{ status: ServerAccountStatus; referralApplied: boolean }> {
  const code = rawCode.replace(/[\s-]/g, '')
  if (!CHALLENGE_ID.test(challengeId)) throw new Error('Запросите код ещё раз')
  if (!/^\d{6}$/.test(code)) throw new Error('Код из письма — 6 цифр')
  const { response, result } = await send('POST', '/v1/accounts/register/confirm', { body: { challengeId, code } })
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось подтвердить e-mail: ${response.status}`)
  return adoptSession(result)
}

export async function webAccountLogout(): Promise<ServerAccountStatus> {
  const session = loadSession()
  saveSession(null)
  if (session) await send('POST', '/v1/accounts/logout', { token: session.token, timeoutMs: 5000 }).catch(() => undefined)
  return webAccountStatus()
}
