/**
 * Website accounts: store + framework-free request handlers.
 *
 * Persistence: accounts, sessions, streamer referral codes and referral visit counters live in SQLite
 * (the same database file as the rest of the server, see services/database.ts), so they survive restarts.
 * Without a database handle the store uses a private in-memory SQLite database (tests).
 *
 * Still missing before any public deployment: e-mail verification, password reset and payouts. Subscription state is
 * NEVER taken from the client: paid periods and streamer revenue come from verified ЮKassa payments
 * (services/paymentStore.ts, attached through `SubscriptionSource`).
 * Streamer status is granted only by an operator through `promoteToStreamer()` (CLI `npm run promote`, never HTTP).
 *
 * The handlers below take a small plain request object and return `{ status, body }`, so they can be unit-tested
 * without Express. `server/src/routes/accounts.ts` adapts them to an Express router.
 * Passwords are never logged or returned; only salted scrypt hashes are kept. Session tokens are stored as SHA-256.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { openDatabase } from './database.js'

export type AccountKind = 'user' | 'streamer'
export type AccountMode = 'pvp' | 'pve' | 'seasonal'
export const ACCOUNT_MODES: readonly AccountMode[] = ['pvp', 'pve', 'seasonal']

/** Referral users get a 3-day trial (docs/product-roadmap-and-business-model.md, "Subscription model"). */
export const REFERRAL_TRIAL_MS = 3 * 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const VISIT_DEDUPE_MS = 24 * 60 * 60 * 1000

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

export interface ReferralStats {
  visits: number
  registrations: number
  activeSubscriptions: number
  /** Paid by referred users, roubles. */
  revenue: { amount: number; currency: 'RUB' }
  earnings: { amount: number; currency: 'RUB' }
}

/** Paid periods and referral revenue (PaymentStore); amounts in kopecks. */
export interface SubscriptionSource {
  paidUntil(accountId: string): number | undefined
  referralStats(code: string): { activeSubscriptions: number; revenue: number; earnings: number }
}

export interface AccountView {
  email: string
  kind: AccountKind
  createdAt: string
  referralCode?: string
  referredBy?: string
  nicknames: Partial<Record<AccountMode, string>>
  subscription: { status: 'active' | 'trial' | 'inactive'; paidUntil?: string; trialEndsAt?: string }
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

/** Only the SHA-256 of a session token is stored, so a database copy does not reveal usable tokens. */
function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/** Visitor addresses are not stored in clear text: only a digest bound to the referral code. */
function visitorDigest(code: string, visitorKey: string) {
  return createHash('sha256').update(`${code}\u0000${visitorKey}`).digest('hex')
}

export function normalizeReferralCode(code: string) {
  return code.trim().toUpperCase()
}

const REFERRAL_CODE = /^[A-Z0-9_-]{3,24}$/
export const NICKNAME = /^[a-zA-Z0-9_-]{3,15}$/

type Row = Record<string, unknown>

function parseNicknames(raw: unknown): Partial<Record<AccountMode, string>> {
  try {
    const parsed = JSON.parse(String(raw ?? '{}')) as Record<string, unknown>
    const result: Partial<Record<AccountMode, string>> = {}
    for (const mode of ACCOUNT_MODES) if (typeof parsed[mode] === 'string' && NICKNAME.test(parsed[mode] as string)) result[mode] = parsed[mode] as string
    return result
  } catch {
    return {}
  }
}

function toAccount(row: Row | undefined): Account | undefined {
  if (!row) return undefined
  return {
    id: String(row.id),
    email: String(row.email),
    salt: Buffer.from(row.salt as Uint8Array),
    passwordHash: Buffer.from(row.password_hash as Uint8Array),
    kind: row.kind === 'streamer' ? 'streamer' : 'user',
    createdAt: Number(row.created_at),
    referralCode: row.referral_code == null ? undefined : String(row.referral_code),
    referredBy: row.referred_by == null ? undefined : String(row.referred_by),
    referredAt: row.referred_at == null ? undefined : Number(row.referred_at),
    nicknames: parseNicknames(row.nicknames),
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    salt BLOB NOT NULL,
    password_hash BLOB NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('user','streamer')),
    created_at INTEGER NOT NULL,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    referred_at INTEGER,
    nicknames TEXT NOT NULL DEFAULT '{}');
  CREATE INDEX IF NOT EXISTS accounts_referred_by ON accounts(referred_by);
  CREATE TABLE IF NOT EXISTS sessions (
    digest TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS referral_visits (
    code TEXT PRIMARY KEY,
    visits INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS referral_visit_seen (
    visitor TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL);
`

export class AccountStore {
  private readonly db: DatabaseSync
  private readonly ownsDb: boolean
  /** Dummy hash so a login for an unknown e-mail costs the same scrypt work as a real one. */
  private readonly dummySalt = randomBytes(16)
  private readonly now: () => number
  private lastSweep = 0
  private subscriptions?: SubscriptionSource

  constructor(options: { now?: () => number; db?: DatabaseSync } = {}) {
    this.now = options.now ?? Date.now
    this.ownsDb = !options.db
    this.db = options.db ?? openDatabase(':memory:')
    this.db.exec(SCHEMA)
  }

  /** Payments (index.ts): paid subscriptions and streamer revenue. */
  attachSubscriptions(source: SubscriptionSource) {
    this.subscriptions = source
  }

  /** What a payment needs to know about the payer. */
  billingInfo(accountId: string) {
    const account = this.mustGet(accountId)
    return { id: account.id, email: account.email, ...(account.referredBy ? { referredBy: account.referredBy } : {}) }
  }

  async register(email: string, password: string, referralCode?: string) {
    const key = email.trim().toLowerCase()
    if (this.findByEmail(key)) throw new AccountError(409, 'Этот e-mail уже зарегистрирован')
    const salt = randomBytes(16)
    const passwordHash = await hashPassword(password, salt)
    const id = randomBytes(12).toString('hex')
    const createdAt = this.now()
    let referredBy: string | null = null
    if (referralCode) {
      const code = normalizeReferralCode(referralCode)
      // An unknown or invalid code must not block registration; it is simply not applied.
      if (this.ownerOfCode(code)) referredBy = code
    }
    try {
      this.db.prepare('INSERT INTO accounts (id, email, salt, password_hash, kind, created_at, referred_by, referred_at, nicknames) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, key, salt, passwordHash, 'user', createdAt, referredBy, referredBy ? createdAt : null, '{}')
    } catch (error) {
      // UNIQUE(email) closes the race between two parallel registrations of the same address.
      if (this.findByEmail(key)) throw new AccountError(409, 'Этот e-mail уже зарегистрирован')
      throw error
    }
    return { token: this.createSession(id), referralApplied: referredBy !== null }
  }

  async login(email: string, password: string) {
    const account = this.findByEmail(email)
    const hash = await hashPassword(password, account?.salt ?? this.dummySalt)
    if (!account || !timingSafeEqual(hash, account.passwordHash)) throw new AccountError(401, 'Неверный e-mail или пароль')
    return { token: this.createSession(account.id) }
  }

  logout(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE digest = ?').run(tokenDigest(token))
  }

  /** Returns the account id for a valid, non-expired session token. */
  authenticate(token: string | undefined) {
    if (!token) return undefined
    const digest = tokenDigest(token)
    const session = this.db.prepare('SELECT s.account_id AS account_id, s.expires_at AS expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.digest = ?').get(digest) as Row | undefined
    if (!session) return undefined
    if (Number(session.expires_at) <= this.now()) { this.db.prepare('DELETE FROM sessions WHERE digest = ?').run(digest); return undefined }
    return String(session.account_id)
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
    const paidUntil = this.subscriptions?.paidUntil(account.id)
    if (paidUntil !== undefined && paidUntil > this.now()) view.subscription = { status: 'active', paidUntil: new Date(paidUntil).toISOString() }
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
    if (!this.ownerOfCode(code)) throw new AccountError(404, 'Код приглашения не найден')
    this.db.prepare('UPDATE accounts SET referred_by = ?, referred_at = ? WHERE id = ? AND referred_by IS NULL').run(code, this.now(), account.id)
  }

  setNicknames(accountId: string, nicknames: Partial<Record<AccountMode, string | null>>) {
    const account = this.mustGet(accountId)
    const next = { ...account.nicknames }
    for (const mode of ACCOUNT_MODES) {
      if (!(mode in nicknames)) continue
      const value = nicknames[mode]
      if (value === null || value === undefined || value === '') delete next[mode]
      else next[mode] = value
    }
    this.db.prepare('UPDATE accounts SET nicknames = ? WHERE id = ?').run(JSON.stringify(next), account.id)
  }

  /** Counts a landing visit for a referral link. One count per visitor key per code per 24 h. */
  recordReferralVisit(rawCode: string, visitorKey: string) {
    const code = normalizeReferralCode(rawCode)
    if (!this.ownerOfCode(code)) return false
    const now = this.now()
    this.sweep(now)
    const visitor = visitorDigest(code, visitorKey)
    const seen = this.db.prepare('SELECT seen_at FROM referral_visit_seen WHERE visitor = ?').get(visitor) as Row | undefined
    if (seen && now - Number(seen.seen_at) < VISIT_DEDUPE_MS) return true
    this.db.prepare('INSERT INTO referral_visit_seen (visitor, seen_at) VALUES (?, ?) ON CONFLICT(visitor) DO UPDATE SET seen_at = excluded.seen_at').run(visitor, now)
    this.db.prepare('INSERT INTO referral_visits (code, visits) VALUES (?, 1) ON CONFLICT(code) DO UPDATE SET visits = visits + 1').run(code)
    return true
  }

  /**
   * Operator-only: grant streamer status and a unique referral code. There is intentionally NO HTTP endpoint for this
   * (see server/src/cli/promote-streamer.ts). A streamer keeps any existing attribution but can no longer attach a new one.
   */
  promoteToStreamer(email: string, rawCode: string) {
    const account = this.findByEmail(email)
    if (!account) throw new AccountError(404, `Account not found: ${email}`)
    const code = normalizeReferralCode(rawCode)
    if (!REFERRAL_CODE.test(code)) throw new AccountError(400, 'Referral code must be 3-24 chars: A-Z, 0-9, _ or -')
    const owner = this.ownerOfCode(code)
    if (owner && owner !== account.id) throw new AccountError(409, `Referral code already taken: ${code}`)
    this.db.prepare("UPDATE accounts SET kind = 'streamer', referral_code = ? WHERE id = ?").run(code, account.id)
    return code
  }

  /** Releases the database when the store opened its own (in-memory) one. */
  close() {
    if (this.ownsDb) this.db.close()
  }

  private stats(code: string): ReferralStats {
    const registrations = Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE referred_by = ?').get(code) as Row).n)
    const visits = Number((this.db.prepare('SELECT visits FROM referral_visits WHERE code = ?').get(code) as Row | undefined)?.visits ?? 0)
    // Paid conversions and money come only from verified ЮKassa payments (PaymentStore).
    const paid = this.subscriptions?.referralStats(code) ?? { activeSubscriptions: 0, revenue: 0, earnings: 0 }
    return { visits, registrations, activeSubscriptions: paid.activeSubscriptions, revenue: { amount: paid.revenue / 100, currency: 'RUB' }, earnings: { amount: paid.earnings / 100, currency: 'RUB' } }
  }

  private createSession(accountId: string) {
    const token = randomBytes(32).toString('base64url')
    this.sweep(this.now())
    this.db.prepare('INSERT INTO sessions (digest, account_id, expires_at) VALUES (?, ?, ?)').run(tokenDigest(token), accountId, this.now() + SESSION_TTL_MS)
    return token
  }

  /** Drops expired sessions and stale visitor digests at most once an hour. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60 * 60 * 1000) return
    this.lastSweep = now
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
    this.db.prepare('DELETE FROM referral_visit_seen WHERE seen_at <= ?').run(now - VISIT_DEDUPE_MS)
  }

  private ownerOfCode(code: string) {
    const row = this.db.prepare("SELECT id FROM accounts WHERE referral_code = ? AND kind = 'streamer'").get(code) as Row | undefined
    return row ? String(row.id) : undefined
  }

  private findByEmail(email: string) {
    return toAccount(this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email.trim().toLowerCase()) as Row | undefined)
  }

  private mustGet(accountId: string) {
    const account = toAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row | undefined)
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

/** Session token from an `Authorization: Bearer <token>` header (shape-checked only). */
export function bearer(authorization: string | undefined) {
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
