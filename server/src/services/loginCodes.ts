/**
 * QR sign-in with short-lived one-time codes. Two flows share this store:
 *
 * 1. Device hand-off (desktop app → phone app, «Войти в мобильную версию»):
 *    POST /v1/accounts/me/login-codes            Bearer            -> 201 { code, expiresAt }
 *    POST /v1/accounts/login-codes/redeem        { code }          -> 200 { token, account } (once) | 404
 *    The desktop app puts the code (never its session token) into a QR code; the phone redeems it once.
 *
 * 2. Browser sign-in (website «Войти по QR-коду»):
 *    POST /v1/accounts/qr-login                  {}                -> 201 { requestId, pollSecret, code, expiresAt }
 *    POST /v1/accounts/me/qr-login/inspect       Bearer { code }   -> 200 { createdAt, expiresAt, agent } | 404
 *    POST /v1/accounts/me/qr-login/approve       Bearer { code }   -> 200 { ok } | 404
 *    POST /v1/accounts/qr-login/poll             { requestId, pollSecret } -> 202 pending | 200 { token, account } (once) | 410
 *    The browser shows `code` (as a QR code and as text). A signed-in phone app (scanning it) or desktop app (typing it)
 *    approves it; only then, and only for the browser that knows `pollSecret`, a new session is created.
 *
 * Everything lives two minutes and works once. Only SHA-256 digests of codes and secrets are kept, in memory: they are
 * too short-lived to need the database, and a server restart just invalidates the open ones. Every endpoint is rate
 * limited (per IP, and per account for the signed-in ones). Request bodies are never logged.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, type AccountsRequest, type AccountsResponse, type AccountStore } from './accountStore.js'

export const LOGIN_CODE_TTL_MS = 2 * 60 * 1000
/** Unambiguous letters and digits (no 0/O, 1/I/L): 31 symbols, 8 of them ≈ 39.6 bits. */
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const USER_CODE_LENGTH = 8
const MAX_OPEN = 10_000

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** «k7qx-m2pd », «K7QXM2PD» → «K7QXM2PD»; anything else → ''. */
export function normalizeUserCode(raw: string) {
  const value = raw.toUpperCase().replace(/[\s-]/g, '')
  return value.length === USER_CODE_LENGTH && [...value].every((char) => USER_CODE_ALPHABET.includes(char)) ? value : ''
}

/** How the code is shown: XXXX-XXXX. */
export const formatUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

interface HandOff { accountId: string; expiresAt: number }
interface BrowserRequest {
  requestDigest: string
  pollDigest: string
  codeDigest: string
  createdAt: number
  expiresAt: number
  agent: string
  approvedBy?: string
}

export class LoginCodeStore {
  private readonly now: () => number
  private readonly handOffs = new Map<string, HandOff>()
  private readonly requests = new Map<string, BrowserRequest>()
  private readonly byCode = new Map<string, string>()

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  private sweep() {
    const now = this.now()
    for (const [key, entry] of this.handOffs) if (entry.expiresAt <= now) this.handOffs.delete(key)
    for (const [key, entry] of this.requests) if (entry.expiresAt <= now) this.drop(key, entry)
  }

  private drop(key: string, entry: BrowserRequest) {
    this.requests.delete(key)
    this.byCode.delete(entry.codeDigest)
  }

  /** Flow 1: a one-time code that signs another device in to `accountId`. */
  createHandOff(accountId: string) {
    this.sweep()
    if (this.handOffs.size >= MAX_OPEN) throw new AccountError(503, 'Слишком много открытых кодов. Попробуйте через минуту.')
    const code = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + LOGIN_CODE_TTL_MS
    this.handOffs.set(digest(code), { accountId, expiresAt })
    return { code, expiresAt: new Date(expiresAt).toISOString() }
  }

  /** The account the code belongs to, once; undefined for unknown, used or expired codes. */
  redeemHandOff(code: string) {
    const key = digest(code)
    const entry = this.handOffs.get(key)
    this.handOffs.delete(key)
    return entry && entry.expiresAt > this.now() ? entry.accountId : undefined
  }

  /** Flow 2: the signed-out browser opens a request; only it gets `pollSecret`. */
  createBrowserRequest(agent: string) {
    this.sweep()
    if (this.requests.size >= MAX_OPEN) throw new AccountError(503, 'Слишком много открытых кодов. Попробуйте через минуту.')
    let code: string
    do {
      code = Array.from({ length: USER_CODE_LENGTH }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join('')
    } while (this.byCode.has(digest(code)))
    const requestId = randomBytes(16).toString('base64url')
    const pollSecret = randomBytes(32).toString('base64url')
    const createdAt = this.now()
    const entry: BrowserRequest = {
      requestDigest: digest(requestId), pollDigest: digest(pollSecret), codeDigest: digest(code),
      createdAt, expiresAt: createdAt + LOGIN_CODE_TTL_MS, agent: agent.slice(0, 160),
    }
    this.requests.set(entry.requestDigest, entry)
    this.byCode.set(entry.codeDigest, entry.requestDigest)
    return { requestId, pollSecret, code: formatUserCode(code), expiresAt: new Date(entry.expiresAt).toISOString() }
  }

  private pendingByCode(rawCode: string) {
    const code = normalizeUserCode(rawCode)
    if (!code) return undefined
    const key = this.byCode.get(digest(code))
    const entry = key ? this.requests.get(key) : undefined
    if (!entry || entry.expiresAt <= this.now() || entry.approvedBy) return undefined
    return entry
  }

  /** What the approving device shows before «Разрешить»: when the request was made and from which browser. */
  inspect(rawCode: string) {
    const entry = this.pendingByCode(rawCode)
    return entry ? { createdAt: new Date(entry.createdAt).toISOString(), expiresAt: new Date(entry.expiresAt).toISOString(), agent: entry.agent } : undefined
  }

  /** A signed-in device approves the request; the session is created later, when the browser polls. */
  approve(rawCode: string, accountId: string) {
    const entry = this.pendingByCode(rawCode)
    if (!entry) return false
    entry.approvedBy = accountId
    return true
  }

  /** 'pending' | 'expired' | the approving account id (once: the request is removed). */
  poll(requestId: string, pollSecret: string): 'pending' | 'expired' | { accountId: string } {
    const key = digest(requestId)
    const entry = this.requests.get(key)
    if (!entry || entry.pollDigest !== digest(pollSecret)) return 'expired'
    if (entry.expiresAt <= this.now()) { this.drop(key, entry); return 'expired' }
    if (!entry.approvedBy) return 'pending'
    this.drop(key, entry)
    return { accountId: entry.approvedBy }
  }
}

export interface LoginCodeHandlerOptions {
  now?: () => number
  /** Per IP (and per account for signed-in calls) in a 10-minute window. */
  limits?: Partial<Record<'create' | 'redeem' | 'request' | 'poll' | 'approve', number>>
}

const handOffSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const userCodeSchema = z.object({ code: z.string().max(20) })
const pollSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{22}$/), pollSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const WINDOW_MS = 10 * 60 * 1000
const NOT_FOUND = 'Код не найден, уже использован или истёк. Создайте новый.'

export function createLoginCodeHandlers(accounts: AccountStore, codes: LoginCodeStore, options: LoginCodeHandlerOptions = {}) {
  const limit = { create: 10, redeem: 20, request: 20, poll: 400, approve: 20, ...options.limits }
  const limiter = (name: keyof typeof limit) => new FixedWindowRateLimiter(limit[name], WINDOW_MS, options.now)
  const limiters = { create: limiter('create'), redeem: limiter('redeem'), request: limiter('request'), poll: limiter('poll'), approve: limiter('approve') }
  const blocked = (name: keyof typeof limiters, ...keys: string[]): AccountsResponse | undefined => {
    for (const key of keys) {
      const retry = limiters[name].hit(`${name}:${key}`)
      if (retry) return { status: 429, body: { error: 'Слишком много попыток. Попробуйте позже.' }, headers: { 'Retry-After': String(retry) } }
    }
    return undefined
  }
  const ip = (req: AccountsRequest) => `ip:${req.ip ?? 'unknown'}`
  const guard = async (run: () => AccountsResponse): Promise<AccountsResponse> => {
    try {
      return run()
    } catch (error) {
      if (error instanceof AccountError) return { status: error.status, body: { error: error.message } }
      throw error
    }
  }
  const authed = (req: AccountsRequest, run: (accountId: string) => AccountsResponse) => guard(() => {
    const accountId = accounts.authenticate(bearer(req.authorization))
    if (!accountId) return { status: 401, body: { error: 'Требуется вход в аккаунт' } }
    return run(accountId)
  })
  const signIn = (accountId: string): AccountsResponse => {
    const token = accounts.startSession(accountId)
    return { status: 200, body: { token, account: accounts.view(accountId) } }
  }

  return {
    createHandOff: (req: AccountsRequest) => authed(req, (accountId) =>
      blocked('create', ip(req), `account:${accountId}`) ?? { status: 201, body: codes.createHandOff(accountId) }),

    redeemHandOff: (req: AccountsRequest) => guard(() => {
      const stop = blocked('redeem', ip(req))
      if (stop) return stop
      const parsed = handOffSchema.safeParse(req.body)
      const accountId = parsed.success ? codes.redeemHandOff(parsed.data.code) : undefined
      return accountId ? signIn(accountId) : { status: 404, body: { error: NOT_FOUND } }
    }),

    createBrowserRequest: (req: AccountsRequest & { agent?: string }) => guard(() =>
      blocked('request', ip(req)) ?? { status: 201, body: codes.createBrowserRequest(req.agent ?? '') }),

    inspect: (req: AccountsRequest) => authed(req, (accountId) => {
      const stop = blocked('approve', ip(req), `account:${accountId}`)
      if (stop) return stop
      const parsed = userCodeSchema.safeParse(req.body)
      const found = parsed.success ? codes.inspect(parsed.data.code) : undefined
      return found ? { status: 200, body: found } : { status: 404, body: { error: NOT_FOUND } }
    }),

    approve: (req: AccountsRequest) => authed(req, (accountId) => {
      const stop = blocked('approve', ip(req), `account:${accountId}`)
      if (stop) return stop
      const parsed = userCodeSchema.safeParse(req.body)
      return parsed.success && codes.approve(parsed.data.code, accountId) ? { status: 200, body: { ok: true } } : { status: 404, body: { error: NOT_FOUND } }
    }),

    poll: (req: AccountsRequest) => guard(() => {
      const stop = blocked('poll', ip(req))
      if (stop) return stop
      const parsed = pollSchema.safeParse(req.body)
      const state = parsed.success ? codes.poll(parsed.data.requestId, parsed.data.pollSecret) : 'expired'
      if (state === 'pending') return { status: 202, body: { status: 'pending' } }
      if (state === 'expired') return { status: 410, body: { error: 'Код истёк. Обновите QR-код.' } }
      return signIn(state.accountId)
    }),
  }
}

export type LoginCodeHandlers = ReturnType<typeof createLoginCodeHandlers>
