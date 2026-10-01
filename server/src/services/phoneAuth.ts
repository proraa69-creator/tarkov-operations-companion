/**
 * Phone numbers and SMS one-time codes: binding a verified number to an account, signing in by phone and resetting the
 * password by phone. Routes: server/src/routes/phone.ts.
 *
 * Off unless an SMS provider is configured (services/sms/index.ts): every route then answers 503 and
 * GET /v1/accounts/auth-config reports `smsEnabled: false`, so the website and the apps hide the phone options.
 *
 * Security model
 * - Codes: 6 digits from crypto.randomInt, stored only as SHA-256(per-code salt, purpose, phone, code); live 5 minutes;
 *   5 wrong attempts invalidate the code; compared with timingSafeEqual; bound to the purpose (bind / login / reset),
 *   the number and, for binding, the account. A new code for the same number and purpose replaces the old one.
 * - Anti-enumeration: sign-in and reset requests answer exactly the same whether the number belongs to an account or
 *   not. For an unknown number (or a blocked account, or an owner account) no SMS is sent, but a decoy challenge is
 *   stored, so checking a code fails the same way. Sending happens in the background, so the response time does not
 *   depend on the number either. Cooldowns and daily caps count every request, sent or not.
 * - Owner accounts (TARKOV_OWNER_EMAILS) can never sign in or reset the password by SMS (SIM-swap protection).
 * - Anti SMS-pumping: per-IP limits, a 60-second resend cooldown and a daily cap per number, a global daily SMS budget
 *   set by the owner (TARKOV_SMS_DAILY_LIMIT), and an allowlist of country calling codes (TARKOV_SMS_COUNTRIES).
 * - Nothing here logs a number, a code or a provider key; provider failures are logged as provider + status code only.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { AccountError, bearer, BLOCKED_MESSAGE, FixedWindowRateLimiter, type AccountsRequest, type AccountsResponse, type AccountStore } from './accountStore.js'
import { DEFAULT_SMS_LIMITS, SmsSendError, type SmsLimits, type SmsSender } from './sms/index.js'

export type SmsPurpose = 'bind' | 'login' | 'reset'
export const CODE_TTL_MS = 5 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_CODE_ATTEMPTS = 5
const DAY_MS = 24 * 60 * 60 * 1000
const CODE_LENGTH = 6

type Row = Record<string, unknown>

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sms_challenges (
    digest TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    phone TEXT NOT NULL,
    account_id TEXT,
    salt BLOB NOT NULL,
    code_hash BLOB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sms_challenges_phone ON sms_challenges(phone, purpose);
  CREATE TABLE IF NOT EXISTS sms_requests (
    phone_digest TEXT NOT NULL,
    purpose TEXT NOT NULL,
    at INTEGER NOT NULL,
    sent INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sms_requests_phone ON sms_requests(phone_digest, at);
  CREATE INDEX IF NOT EXISTS sms_requests_at ON sms_requests(at);
`

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const phoneDigest = (phone: string) => sha256(`phone\u0000${phone}`)
const codeHash = (salt: Buffer, purpose: SmsPurpose, phone: string, code: string) => createHash('sha256').update(salt).update(`\u0000${purpose}\u0000${phone}\u0000${code}`).digest()

/**
 * «+7 (999) 123-45-67», «8 999 123 45 67», «79991234567» → «+79991234567» (E.164), or undefined. A leading 8 with 11
 * digits is the Russian trunk prefix. The number must start with an allowed calling code.
 */
export function normalizePhone(raw: unknown, countries: readonly string[] = DEFAULT_SMS_LIMITS.countries) {
  if (typeof raw !== 'string' || raw.length > 32 || !/^[\d\s()+.-]+$/.test(raw)) return undefined
  let digits = raw.replace(/\D/g, '')
  if (!raw.trim().startsWith('+') && digits.length === 11 && digits.startsWith('8') && countries.includes('7')) digits = `7${digits.slice(1)}`
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return undefined
  const country = countries.find((code) => digits.startsWith(code))
  if (!country) return undefined
  // +7: Russia and Kazakhstan, always 10 digits after the code.
  if (country === '7' && digits.length !== 11) return undefined
  return `+${digits}`
}

export class PhoneAuthError extends AccountError {
  readonly retryAfter?: number
  constructor(status: number, message: string, retryAfter?: number) {
    super(status, message)
    this.retryAfter = retryAfter
  }
}

const SMS_TEXT: Record<SmsPurpose | 'test', (code: string) => string> = {
  bind: (code) => `Raid OS: код ${code} для привязки номера. Никому его не сообщайте.`,
  login: (code) => `Raid OS: код входа ${code}. Никому его не сообщайте.`,
  reset: (code) => `Raid OS: код ${code} для сброса пароля. Никому его не сообщайте.`,
  test: () => 'Raid OS: тестовое сообщение. Отправка SMS работает.',
}

export const SMS_OFF_MESSAGE = 'Вход и восстановление по номеру телефона сейчас недоступны. Войдите по e-mail и паролю.'
const BUDGET_MESSAGE = 'Отправка SMS временно недоступна. Попробуйте позже или войдите по e-mail и паролю.'
export const WRONG_CODE_MESSAGE = 'Неверный или устаревший код. Проверьте код или запросите новый.'
const COUNTRY_MESSAGE = 'Укажите номер полностью, с кодом страны. Поддерживаются номера: '

export interface PhoneAuthOptions {
  sender?: SmsSender
  limits?: Partial<SmsLimits>
  now?: () => number
  /** Logs provider failures (provider + code only). Defaults to console.error. */
  log?: (message: string) => void
}

export class PhoneAuthService {
  private readonly accounts: AccountStore
  private readonly db: DatabaseSync
  private readonly sender?: SmsSender
  readonly limits: SmsLimits
  private readonly now: () => number
  private readonly log: (message: string) => void
  private lastSweep = 0
  /** Background sends still running (tests wait for them). */
  private readonly pending = new Set<Promise<unknown>>()

  constructor(accounts: AccountStore, options: PhoneAuthOptions = {}) {
    this.accounts = accounts
    this.db = accounts.database
    this.sender = options.sender
    this.limits = { ...DEFAULT_SMS_LIMITS, ...options.limits }
    this.now = options.now ?? accounts.clock
    this.log = options.log ?? ((message) => console.error(message))
    this.db.exec(SCHEMA)
  }

  get enabled() {
    return this.sender !== undefined
  }

  get provider() {
    return this.sender?.provider
  }

  /** Public settings for the website and the apps (no secrets). */
  publicConfig() {
    return { smsEnabled: this.enabled, codeLength: CODE_LENGTH, codeTtlSeconds: CODE_TTL_MS / 1000, resendSeconds: RESEND_COOLDOWN_MS / 1000, countries: [...this.limits.countries] }
  }

  /** Resolves once every background SMS send has finished (tests). */
  async settled() {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  phone(raw: unknown) {
    const phone = normalizePhone(raw, this.limits.countries)
    if (!phone) throw new PhoneAuthError(400, `${COUNTRY_MESSAGE}${this.limits.countries.map((code) => `+${code}`).join(', ')}.`)
    return phone
  }

  private requireEnabled(): SmsSender {
    if (!this.sender) throw new PhoneAuthError(503, SMS_OFF_MESSAGE)
    return this.sender
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 10 * 60 * 1000) return
    this.lastSweep = now
    this.db.prepare('DELETE FROM sms_challenges WHERE expires_at <= ?').run(now)
    this.db.prepare('DELETE FROM sms_requests WHERE at <= ?').run(now - 2 * DAY_MS)
  }

  /** SMS actually sent in the last 24 hours (the owner's daily budget). */
  sentToday() {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM sms_requests WHERE sent = 1 AND at > ?').get(this.now() - DAY_MS) as Row).n)
  }

  /** Budget, cooldown and per-number cap — checked the same way whether or not the number has an account. */
  private checkQuota(phone: string) {
    const now = this.now()
    if (this.sentToday() >= this.limits.dailyLimit) throw new PhoneAuthError(503, BUDGET_MESSAGE)
    const digest = phoneDigest(phone)
    const recent = this.db.prepare('SELECT COUNT(*) AS n, MAX(at) AS last FROM sms_requests WHERE phone_digest = ? AND at > ?').get(digest, now - DAY_MS) as Row
    const last = recent.last == null ? 0 : Number(recent.last)
    if (last && now - last < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000)
      throw new PhoneAuthError(429, `Новый код можно запросить через ${wait} с.`, wait)
    }
    if (Number(recent.n) >= this.limits.phoneDailyLimit) throw new PhoneAuthError(429, 'Для этого номера исчерпан лимит кодов на сутки. Попробуйте завтра.', 3600)
  }

  private record(phone: string, purpose: SmsPurpose | 'test', sent: boolean) {
    this.db.prepare('INSERT INTO sms_requests (phone_digest, purpose, at, sent) VALUES (?, ?, ?, ?)').run(phoneDigest(phone), purpose, this.now(), sent ? 1 : 0)
  }

  /** A new challenge for (purpose, phone[, account]); the previous one for the same target is dropped. */
  private createChallenge(purpose: SmsPurpose, phone: string, accountId: string | undefined) {
    const now = this.now()
    this.sweep(now)
    if (purpose === 'bind') this.db.prepare('DELETE FROM sms_challenges WHERE purpose = ? AND account_id = ?').run(purpose, accountId ?? '')
    else this.db.prepare('DELETE FROM sms_challenges WHERE purpose = ? AND phone = ?').run(purpose, phone)
    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
    const challengeId = randomBytes(24).toString('base64url')
    const salt = randomBytes(16)
    const expiresAt = now + CODE_TTL_MS
    this.db.prepare('INSERT INTO sms_challenges (digest, purpose, phone, account_id, salt, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .run(sha256(challengeId), purpose, phone, accountId ?? null, salt, codeHash(salt, purpose, phone, code), now, expiresAt)
    return { challengeId, code, expiresAt }
  }

  private answer(challenge: { challengeId: string; expiresAt: number }) {
    return { challengeId: challenge.challengeId, expiresAt: new Date(challenge.expiresAt).toISOString(), resendSeconds: RESEND_COOLDOWN_MS / 1000 }
  }

  private sendInBackground(sender: SmsSender, phone: string, text: string) {
    const job = sender.send(phone, text).catch((error: unknown) => {
      this.log(`SMS send failed (${sender.provider}${error instanceof SmsSendError && error.code ? `, code ${error.code}` : ''})`)
    })
    this.pending.add(job)
    void job.finally(() => this.pending.delete(job))
  }

  /**
   * Sign-in or password reset: the same answer for every allowed number. The SMS goes only to a number verified by an
   * account that is not blocked and is not an owner account.
   */
  start(purpose: 'login' | 'reset', rawPhone: unknown) {
    const sender = this.requireEnabled()
    const phone = this.phone(rawPhone)
    this.checkQuota(phone)
    const account = this.accounts.accountByPhone(phone)
    const eligible = account !== undefined && !account.blocked && !account.owner
    const challenge = this.createChallenge(purpose, phone, eligible ? account.id : undefined)
    this.record(phone, purpose, eligible)
    if (eligible) this.sendInBackground(sender, phone, SMS_TEXT[purpose](challenge.code))
    return this.answer(challenge)
  }

  /** Binding a number to the signed-in account (the caller has checked the password). The SMS is always sent. */
  async startBind(accountId: string, rawPhone: unknown) {
    const sender = this.requireEnabled()
    const phone = this.phone(rawPhone)
    if (this.accounts.phoneOf(accountId) === phone) throw new PhoneAuthError(409, 'Этот номер уже привязан к вашему аккаунту')
    this.checkQuota(phone)
    const challenge = this.createChallenge('bind', phone, accountId)
    try {
      await sender.send(phone, SMS_TEXT.bind(challenge.code))
    } catch (error) {
      this.db.prepare('DELETE FROM sms_challenges WHERE digest = ?').run(sha256(challenge.challengeId))
      this.record(phone, 'bind', false)
      this.log(`SMS send failed (${sender.provider}${error instanceof SmsSendError && error.code ? `, code ${error.code}` : ''})`)
      throw new PhoneAuthError(502, 'Не удалось отправить SMS. Попробуйте позже.')
    }
    this.record(phone, 'bind', true)
    return this.answer(challenge)
  }

  /**
   * Checks a code. Every wrong try counts; after MAX_CODE_ATTEMPTS the code is gone. A correct code is used up.
   * Returns the phone and the account bound to the challenge (undefined for a decoy).
   */
  private consume(purpose: SmsPurpose, challengeId: string, rawCode: string) {
    this.requireEnabled()
    const code = rawCode.replace(/[\s-]/g, '')
    const digest = sha256(challengeId)
    const row = this.db.prepare('SELECT * FROM sms_challenges WHERE digest = ? AND purpose = ?').get(digest, purpose) as Row | undefined
    if (!row || Number(row.expires_at) <= this.now()) {
      if (row) this.db.prepare('DELETE FROM sms_challenges WHERE digest = ?').run(digest)
      throw new PhoneAuthError(400, WRONG_CODE_MESSAGE)
    }
    const attempts = Number(row.attempts) + 1
    const phone = String(row.phone)
    const expected = Buffer.from(row.code_hash as Uint8Array)
    const supplied = codeHash(Buffer.from(row.salt as Uint8Array), purpose, phone, /^\d{6}$/.test(code) ? code : '')
    const match = timingSafeEqual(expected, supplied) && row.account_id != null
    if (match || attempts >= MAX_CODE_ATTEMPTS) this.db.prepare('DELETE FROM sms_challenges WHERE digest = ?').run(digest)
    else this.db.prepare('UPDATE sms_challenges SET attempts = ? WHERE digest = ?').run(attempts, digest)
    if (!match) {
      if (attempts >= MAX_CODE_ATTEMPTS) throw new PhoneAuthError(400, 'Слишком много неверных попыток. Запросите новый код.')
      throw new PhoneAuthError(400, WRONG_CODE_MESSAGE)
    }
    return { phone, accountId: String(row.account_id) }
  }

  /** The account a sign-in / reset code is for, re-checked at the moment of use. */
  private signInTarget(purpose: 'login' | 'reset', challengeId: string, code: string) {
    const { phone, accountId } = this.consume(purpose, challengeId, code)
    const account = this.accounts.accountByPhone(phone)
    // The number was moved or removed meanwhile, or the account became an owner account.
    if (!account || account.id !== accountId || account.owner) throw new PhoneAuthError(400, WRONG_CODE_MESSAGE)
    if (account.blocked) throw new PhoneAuthError(403, BLOCKED_MESSAGE)
    return account.id
  }

  login(challengeId: string, code: string) {
    const accountId = this.signInTarget('login', challengeId, code)
    return this.accounts.startSession(accountId)
  }

  /** New password after a confirmed code: every session of the account is revoked, this browser gets a new one. */
  async reset(challengeId: string, code: string, password: string) {
    const accountId = this.signInTarget('reset', challengeId, code)
    const token = await this.accounts.setPassword(accountId, password)
    return { accountId, token }
  }

  confirmBind(accountId: string, challengeId: string, code: string) {
    const { phone, accountId: owner } = this.consume('bind', challengeId, code)
    if (owner !== accountId) throw new PhoneAuthError(400, WRONG_CODE_MESSAGE)
    this.accounts.setPhone(accountId, phone)
  }

  /** «Отправить тестовое SMS» in the owner's laptop app (admin API only). Counts towards the daily budget. */
  async sendTest(rawPhone: unknown) {
    const sender = this.requireEnabled()
    const phone = this.phone(rawPhone)
    if (this.sentToday() >= this.limits.dailyLimit) throw new PhoneAuthError(503, 'Дневной лимит SMS исчерпан')
    try {
      await sender.send(phone, SMS_TEXT.test(''))
    } catch (error) {
      this.record(phone, 'test', false)
      throw new PhoneAuthError(502, error instanceof SmsSendError ? `${error.message}${error.code ? ` (код ${error.code})` : ''}` : 'Провайдер SMS недоступен')
    }
    this.record(phone, 'test', true)
    return { ok: true, provider: sender.provider, sentToday: this.sentToday(), dailyLimit: this.limits.dailyLimit }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Framework-free handlers (routes/phone.ts adapts them to Express)
// ---------------------------------------------------------------------------------------------------------------

export interface PhoneHandlerOptions {
  now?: () => number
  /** Per IP in 15 minutes: code requests (start) and code checks (verify). Per account per hour: binding. */
  limits?: Partial<Record<'start' | 'startDaily' | 'verify' | 'bind', number>>
}

const challengeId = z.string().regex(/^[A-Za-z0-9_-]{32}$/)
const code = z.string().trim().max(12)
const startSchema = z.object({ phone: z.string().max(32) })
const verifySchema = z.object({ challengeId, code })
const resetSchema = verifySchema.extend({ password: z.string().min(8).max(128) })
const bindSchema = z.object({ phone: z.string().max(32), password: z.string().min(1).max(128) })
const removeSchema = z.object({ password: z.string().min(1).max(128) })

export function createPhoneHandlers(accounts: AccountStore, phones: PhoneAuthService, options: PhoneHandlerOptions = {}) {
  const limit = { start: 5, startDaily: 30, verify: 20, bind: 6, ...options.limits }
  const startLimiter = new FixedWindowRateLimiter(limit.start, 15 * 60 * 1000, options.now)
  const startDailyLimiter = new FixedWindowRateLimiter(limit.startDaily, 24 * 60 * 60 * 1000, options.now)
  const verifyLimiter = new FixedWindowRateLimiter(limit.verify, 15 * 60 * 1000, options.now)
  const bindLimiter = new FixedWindowRateLimiter(limit.bind, 60 * 60 * 1000, options.now)

  const tooMany = (retry: number): AccountsResponse => ({ status: 429, body: { error: 'Слишком много попыток. Попробуйте позже.' }, headers: { 'Retry-After': String(retry) } })
  const hit = (limiter: FixedWindowRateLimiter, key: string) => { const retry = limiter.hit(key); return retry ? tooMany(retry) : undefined }
  const ip = (req: AccountsRequest) => `ip:${req.ip ?? 'unknown'}`

  const guard = async (run: () => Promise<AccountsResponse> | AccountsResponse): Promise<AccountsResponse> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof PhoneAuthError && error.retryAfter) return { status: error.status, body: { error: error.message, retryAfter: error.retryAfter }, headers: { 'Retry-After': String(error.retryAfter) } }
      if (error instanceof AccountError) return { status: error.status, body: { error: error.message } }
      throw error
    }
  }
  const authed = (req: AccountsRequest, run: (accountId: string) => Promise<AccountsResponse> | AccountsResponse) => guard(() => {
    const accountId = accounts.authenticate(bearer(req.authorization))
    if (!accountId) return { status: 401, body: { error: 'Требуется вход в аккаунт' } }
    return run(accountId)
  })
  const off = (): AccountsResponse | undefined => (phones.enabled ? undefined : { status: 503, body: { error: SMS_OFF_MESSAGE, smsEnabled: false } })

  const start = (purpose: 'login' | 'reset') => (req: AccountsRequest) => guard(() => {
    const stop = off() ?? hit(startLimiter, ip(req)) ?? hit(startDailyLimiter, ip(req))
    if (stop) return stop
    const parsed = startSchema.safeParse(req.body)
    if (!parsed.success) return { status: 400, body: { error: 'Укажите номер телефона' } }
    return { status: 200, body: phones.start(purpose, parsed.data.phone) }
  })

  return {
    config: () => guard(() => ({ status: 200, body: phones.publicConfig() })),

    loginStart: start('login'),
    resetStart: start('reset'),

    login: (req: AccountsRequest) => guard(() => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = verifySchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: WRONG_CODE_MESSAGE } }
      const token = phones.login(parsed.data.challengeId, parsed.data.code)
      return { status: 200, body: { token, account: accounts.view(accounts.authenticate(token)!) } }
    }),

    reset: (req: AccountsRequest) => guard(async () => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = resetSchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: verifySchema.safeParse(req.body).success ? 'Новый пароль: от 8 до 128 символов' : WRONG_CODE_MESSAGE } }
      const { accountId, token } = await phones.reset(parsed.data.challengeId, parsed.data.code, parsed.data.password)
      return { status: 200, body: { token, account: accounts.view(accountId) } }
    }),

    /** Signed in: send a code to a new number. Needs the current password. */
    bindStart: (req: AccountsRequest) => authed(req, async (accountId) => {
      const stop = off() ?? hit(bindLimiter, `account:${accountId}`) ?? hit(startLimiter, ip(req))
      if (stop) return stop
      const parsed = bindSchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: 'Укажите номер телефона и текущий пароль' } }
      if (!(await accounts.verifyPassword(accountId, parsed.data.password))) return { status: 403, body: { error: 'Текущий пароль указан неверно' } }
      return { status: 200, body: await phones.startBind(accountId, parsed.data.phone) }
    }),

    bindConfirm: (req: AccountsRequest) => authed(req, (accountId) => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = verifySchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: WRONG_CODE_MESSAGE } }
      phones.confirmBind(accountId, parsed.data.challengeId, parsed.data.code)
      return { status: 200, body: accounts.view(accountId) }
    }),

    /** Remove the number (works even with SMS switched off). Needs the current password. */
    remove: (req: AccountsRequest) => authed(req, async (accountId) => {
      const stop = hit(bindLimiter, `account:${accountId}`)
      if (stop) return stop
      const parsed = removeSchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: 'Укажите текущий пароль' } }
      if (!(await accounts.verifyPassword(accountId, parsed.data.password))) return { status: 403, body: { error: 'Текущий пароль указан неверно' } }
      accounts.setPhone(accountId, null)
      return { status: 200, body: accounts.view(accountId) }
    }),
  }
}

export type PhoneHandlers = ReturnType<typeof createPhoneHandlers>
