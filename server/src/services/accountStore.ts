/**
 * Website accounts: store + framework-free request handlers.
 *
 * DEVELOPMENT-ONLY PROTOTYPE.
 * - Everything is kept in process memory and is lost on restart. Before any public deployment this must be
 *   replaced by a persistent database (accounts, sessions, referral attribution, visits), see server/schema.sql.
 * - There is no e-mail verification, password reset, payment provider or payout accounting yet.
 *   Subscription state is NEVER taken from the client; `activeSubscriptions` / `earnings` stay 0 until
 *   provider webhooks are implemented server-side.
 * - Streamer status is granted only by an operator through `promoteToStreamer()` (never through HTTP).
 *
 * The handlers below take a small plain request object and return `{ status, body }`, so they can be unit-tested
 * without Express. `server/src/routes/accounts.ts` adapts them to an Express router.
 * Passwords are never logged or returned; only salted scrypt hashes are kept.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export type AccountKind = 'user' | 'streamer'
export type AccountMode = 'pvp' | 'pve' | 'seasonal'
export const ACCOUNT_MODES: readonly AccountMode[] = ['pvp', 'pve', 'seasonal']

/** Referral users get a 3-day trial (docs/product-roadmap-and-business-model.md, "Subscription model"). */
export const REFERRAL_TRIAL_MS = 3 * 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const SCRYPT_KEYLEN = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

interface Account {
  id: string
  email: string
  salt: Buffer
  passwordHash: Buffer
  kind: AccountKind
  createdAt: number
  /** Streamer's own referral code (only for kind === 'streamer'). */
  referralCode?: string
  /** Streamer code this account was attributed to (set once, server-side validated). */
  referredBy?: string
  referredAt?: number
  nicknames: Partial<Record<AccountMode, string>>
}

interface Session { accountId: string; expiresAt: number }

export interface ReferralStats {
  visits: number
  registrations: number
  activeSubscriptions: number
  earnings: { amount: number; currency: 'RUB' }
}

export interface AccountView {
  email: string
  kind: AccountKind
  createdAt: string
  referralCode?: string
  referredBy?: string
  nicknames: Partial<Record<AccountMode, string>>
  subscription: { status: 'trial' | 'inactive'; trialEndsAt?: string }
  stats?: ReferralStats
}

export class AccountError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function hashPassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

/** Only the SHA-256 of a session token is stored, so a memory dump does not reveal usable tokens. */
function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function normalizeReferralCode(code: string) {
  return code.trim().toUpperCase()
}

const REFERRAL_CODE = /^[A-Z0-9_-]{3,24}$/
export const NICKNAME = /^[a-zA-Z0-9_-]{3,15}$/

export class AccountStore {
  private readonly accounts = new Map<string, Account>()
  private readonly byEmail = new Map<string, string>()
  private readonly byReferralCode = new Map<string, string>()
  private readonly sessions = new Map<string, Session>()
  private readonly visits = new Map<string, number>()
  private readonly visitSeen = new Map<string, number>()
  /** Dummy hash so a login for an unknown e-mail costs the same scrypt work as a real one. */
  private readonly dummySalt = randomBytes(16)
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  async register(email: string, password: string, referralCode?: string) {
    const key = email.trim().toLowerCase()
    if (this.byEmail.has(key)) throw new AccountError(409, 'Этот e-mail уже зарегистрирован')
    const salt = randomBytes(16)
    const passwordHash = await hashPassword(password, salt)
    // Re-check after the async hash to avoid a double registration race.
    if (this.byEmail.has(key)) throw new AccountError(409, 'Этот e-mail уже зарегистрирован')
    const account: Account = { id: randomBytes(12).toString('hex'), email: key, salt, passwordHash, kind: 'user', createdAt: this.now(), nicknames: {} }
    this.accounts.set(account.id, account)
    this.byEmail.set(key, account.id)
    let referralApplied = false
    if (referralCode) {
      const code = normalizeReferralCode(referralCode)
      // An unknown or invalid code must not block registration; it is simply not applied.
      if (this.byReferralCode.has(code)) {
        account.referredBy = code
        account.referredAt = account.createdAt
        referralApplied = true
      }
    }
    return { token: this.createSession(account.id), referralApplied }
  }

  async login(email: string, password: string) {
    const account = this.findByEmail(email)
    const hash = await hashPassword(password, account?.salt ?? this.dummySalt)
    if (!account || !timingSafeEqual(hash, account.passwordHash)) throw new AccountError(401, 'Неверный e-mail или пароль')
    return { token: this.createSession(account.id) }
  }

  logout(token: string) {
    this.sessions.delete(tokenDigest(token))
  }

  /** Returns the account id for a valid, non-expired session token. */
  authenticate(token: string | undefined) {
    if (!token) return undefined
    const digest = tokenDigest(token)
    const session = this.sessions.get(digest)
    if (!session) return undefined
    if (session.expiresAt <= this.now()) { this.sessions.delete(digest); return undefined }
    return this.accounts.has(session.accountId) ? session.accountId : undefined
  }

  view(accountId: string): AccountView {
    const account = this.mustGet(accountId)
    const trialEndsAt = account.referredAt === undefined ? undefined : account.referredAt + REFERRAL_TRIAL_MS
    const view: AccountView = {
      email: account.email,
      kind: account.kind,
      createdAt: new Date(account.createdAt).toISOString(),
      nicknames: { ...account.nicknames },
      subscription: trialEndsAt !== undefined && trialEndsAt > this.now() ? { status: 'trial', trialEndsAt: new Date(trialEndsAt).toISOString() } : { status: 'inactive' },
    }
    if (account.referredBy) view.referredBy = account.referredBy
    if (account.kind === 'streamer' && account.referralCode) {
      view.referralCode = account.referralCode
      view.stats = this.stats(account.referralCode)
    }
    return view
  }

  /** Attach a streamer referral code to an ordinary user. Allowed once; a streamer cannot refer anyone to himself. */
  applyReferral(accountId: string, rawCode: string) {
    const account = this.mustGet(accountId)
    if (account.kind !== 'user') throw new AccountError(403, 'Код приглашения можно указать только в аккаунте пользователя')
    if (account.referredBy) throw new AccountError(409, 'Код приглашения уже указан')
    const code = normalizeReferralCode(rawCode)
    if (!this.byReferralCode.has(code)) throw new AccountError(404, 'Код приглашения не найден')
    account.referredBy = code
    account.referredAt = this.now()
  }

  setNicknames(accountId: string, nicknames: Partial<Record<AccountMode, string | null>>) {
    const account = this.mustGet(accountId)
    for (const mode of ACCOUNT_MODES) {
      if (!(mode in nicknames)) continue
      const value = nicknames[mode]
      if (value === null || value === undefined || value === '') delete account.nicknames[mode]
      else account.nicknames[mode] = value
    }
  }

  /** Counts a landing visit for a referral link. One count per visitor key per code per 24 h. */
  recordReferralVisit(rawCode: string, visitorKey: string) {
    const code = normalizeReferralCode(rawCode)
    if (!this.byReferralCode.has(code)) return false
    const seenKey = `${code}\u0000${visitorKey}`
    const seenAt = this.visitSeen.get(seenKey)
    if (seenAt !== undefined && this.now() - seenAt < 24 * 60 * 60 * 1000) return true
    this.visitSeen.set(seenKey, this.now())
    this.visits.set(code, (this.visits.get(code) ?? 0) + 1)
    return true
  }

  /**
   * Operator-only: grant streamer status and a unique referral code. There is intentionally NO HTTP endpoint for this.
   * A streamer keeps any existing attribution but can no longer attach a new one.
   */
  promoteToStreamer(email: string, rawCode: string) {
    const account = this.findByEmail(email)
    if (!account) throw new AccountError(404, `Account not found: ${email}`)
    const code = normalizeReferralCode(rawCode)
    if (!REFERRAL_CODE.test(code)) throw new AccountError(400, 'Referral code must be 3-24 chars: A-Z, 0-9, _ or -')
    const owner = this.byReferralCode.get(code)
    if (owner && owner !== account.id) throw new AccountError(409, `Referral code already taken: ${code}`)
    if (account.referralCode && account.referralCode !== code) this.byReferralCode.delete(account.referralCode)
    account.kind = 'streamer'
    account.referralCode = code
    this.byReferralCode.set(code, account.id)
    return code
  }

  private stats(code: string): ReferralStats {
    let registrations = 0
    for (const account of this.accounts.values()) if (account.referredBy === code) registrations += 1
    // Payments are not implemented: paid conversions and earnings must come from verified provider webhooks.
    return { visits: this.visits.get(code) ?? 0, registrations, activeSubscriptions: 0, earnings: { amount: 0, currency: 'RUB' } }
  }

  private createSession(accountId: string) {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(tokenDigest(token), { accountId, expiresAt: this.now() + SESSION_TTL_MS })
    return token
  }

  private findByEmail(email: string) {
    const id = this.byEmail.get(email.trim().toLowerCase())
    return id ? this.accounts.get(id) : undefined
  }

  private mustGet(accountId: string) {
    const account = this.accounts.get(accountId)
    if (!account) throw new AccountError(401, 'Сессия недействительна')
    return account
  }
}

/** Simple fixed-window per-key limiter (in memory, per process). Use a shared store (e.g. Redis) behind a load balancer. */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  /** Returns 0 when allowed, otherwise the number of seconds until the window resets. */
  hit(key: string) {
    const now = this.now()
    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
      entry = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, entry)
    }
    entry.count += 1
    return entry.count > this.max ? Math.ceil((entry.resetAt - now) / 1000) : 0
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Framework-free handlers
// ---------------------------------------------------------------------------------------------------------------

export interface AccountsRequest { body?: unknown; ip?: string; authorization?: string }
export interface AccountsResponse { status: number; body: unknown; headers?: Record<string, string> }
export interface AccountsHandlerOptions {
  /** Max login/register attempts per IP per window. Default 10 per 15 minutes. */
  authRateLimit?: { max: number; windowMs: number }
  now?: () => number
}

const emailSchema = z.string().trim().toLowerCase().max(254).email()
const passwordSchema = z.string().min(8).max(128)
const credentialsSchema = z.object({ email: emailSchema, password: passwordSchema })
const registerSchema = credentialsSchema.extend({ referralCode: z.string().trim().max(24).optional() })
const referralSchema = z.object({ code: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,24}$/) })
const nicknameValue = z.union([z.literal(''), z.null(), z.string().trim().regex(NICKNAME)])
const nicknamesSchema = z.object({ pvp: nicknameValue.optional(), pve: nicknameValue.optional(), seasonal: nicknameValue.optional() })

const invalid = (message: string): AccountsResponse => ({ status: 400, body: { error: message } })

function bearer(authorization: string | undefined) {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(authorization ?? '')
  return match?.[1]
}

export function createAccountsHandlers(store: AccountStore, options: AccountsHandlerOptions = {}) {
  const limit = options.authRateLimit ?? { max: 10, windowMs: 15 * 60 * 1000 }
  const authLimiter = new FixedWindowRateLimiter(limit.max, limit.windowMs, options.now)
  const visitLimiter = new FixedWindowRateLimiter(60, 60 * 60 * 1000, options.now)

  const limited = (limiter: FixedWindowRateLimiter, key: string): AccountsResponse | undefined => {
    const retryAfter = limiter.hit(key)
    return retryAfter ? { status: 429, body: { error: 'Слишком много попыток. Попробуйте позже.' }, headers: { 'Retry-After': String(retryAfter) } } : undefined
  }

  const guard = async (run: () => Promise<AccountsResponse> | AccountsResponse): Promise<AccountsResponse> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof AccountError) return { status: error.status, body: { error: error.message } }
      throw error
    }
  }

  const authed = (req: AccountsRequest, run: (accountId: string) => AccountsResponse) => guard(() => {
    const accountId = store.authenticate(bearer(req.authorization))
    if (!accountId) return { status: 401, body: { error: 'Требуется вход в аккаунт' } }
    return run(accountId)
  })

  return {
    register: (req: AccountsRequest) => guard(async () => {
      const blocked = limited(authLimiter, `auth:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = registerSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Укажите корректный e-mail и пароль от 8 до 128 символов')
      const { email, password, referralCode } = parsed.data
      const result = await store.register(email, password, referralCode || undefined)
      return { status: 201, body: { token: result.token, referralApplied: result.referralApplied, account: store.view(store.authenticate(result.token)!) } }
    }),

    login: (req: AccountsRequest) => guard(async () => {
      const blocked = limited(authLimiter, `auth:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = credentialsSchema.safeParse(req.body)
      if (!parsed.success) return { status: 401, body: { error: 'Неверный e-mail или пароль' } }
      const { token } = await store.login(parsed.data.email, parsed.data.password)
      return { status: 200, body: { token, account: store.view(store.authenticate(token)!) } }
    }),

    logout: (req: AccountsRequest) => guard(() => {
      const token = bearer(req.authorization)
      if (token) store.logout(token)
      return { status: 204, body: undefined }
    }),

    me: (req: AccountsRequest) => authed(req, (accountId) => ({ status: 200, body: store.view(accountId) })),

    applyReferral: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = referralSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-»')
      store.applyReferral(accountId, parsed.data.code)
      return { status: 200, body: store.view(accountId) }
    }),

    setNicknames: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = nicknamesSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Никнейм: 3–15 символов, латиница, цифры, «_» или «-»')
      store.setNicknames(accountId, parsed.data)
      return { status: 200, body: store.view(accountId) }
    }),

    referralVisit: (req: AccountsRequest) => guard(() => {
      const blocked = limited(visitLimiter, `visit:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = referralSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Некорректный код приглашения')
      const known = store.recordReferralVisit(parsed.data.code, req.ip ?? 'unknown')
      return known ? { status: 200, body: { ok: true, code: normalizeReferralCode(parsed.data.code) } } : { status: 404, body: { error: 'Код приглашения не найден' } }
    }),
  }
}

export type AccountsHandlers = ReturnType<typeof createAccountsHandlers>
