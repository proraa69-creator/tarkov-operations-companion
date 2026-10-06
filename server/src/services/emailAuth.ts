/**
 * E-mail one-time codes: confirming the address at registration and later («Подтвердите e-mail»), passwordless sign-in
 * by e-mail code and «Забыли пароль?» by e-mail code. Routes: server/src/routes/email.ts (+ POST /register in
 * routes/accounts.ts). Shares the one-time-code core with SMS codes (services/oneTimeCode.ts).
 *
 * Off unless an e-mail provider is configured (services/email/index.ts): every route then answers 503,
 * GET /v1/accounts/auth-config reports `emailEnabled: false`, and POST /register creates the account at once with an
 * unconfirmed e-mail — exactly as before e-mail codes existed — so nothing breaks before the owner sets up Resend.
 *
 * Registration while on (anti-enumeration)
 * - POST /register never creates an account and always answers 202 «Мы отправили код на e-mail» with a challenge.
 *   New address → a pending registration (e-mail, scrypt salt+hash of the password, referral code) lives 30 minutes
 *   and the code goes to the address; POST /register/confirm with the code creates the account (confirmed e-mail) and
 *   the first session. Existing address → no account, no code: a decoy challenge is stored (checking a code fails the
 *   same way) and the owner of the address gets a «кто-то пытался зарегистрироваться с вашим адресом» notice, at most
 *   once per 24 hours. Both paths do the same scrypt work and send in the background, so neither the answer nor its
 *   timing tells the two apart. Cooldown and caps count both paths the same way.
 * - A listed owner e-mail with no account can be registered here: the code proves the address belongs to the owner.
 *
 * Security model (same as SMS codes)
 * - 6 digits from crypto.randomInt, stored only as SHA-256(salt, purpose, e-mail, code), 10 minutes, 5 wrong attempts,
 *   timing-safe comparison. Every challenge stands alone: a new code request never cancels another open challenge of
 *   the same address (somebody else asking for codes cannot void the owner's code). Wrong codes per address per day
 *   are capped across all its challenges (MAX_WRONG_CODES_PER_DAY).
 * - 60-second resend cooldown and a daily cap per address — both counted per address AND requesting IP, so one
 *   attacker cannot use up the owner's codes — plus an overall per-address cap (ADDRESS_CAP_FACTOR × that), per-IP
 *   limits (req.ip, trust proxy = loopback) and a global daily budget (TARKOV_EMAIL_DAILY_LIMIT) of which registration
 *   may use at most REGISTRATION_BUDGET_SHARE, keeping the rest for sign-in, reset and confirmation codes.
 *   Sign-in / reset requests answer the same for unknown addresses.
 * - Owners: e-mail is the owner's primary factor, so owner accounts MAY sign in and reset the password by e-mail code
 *   (unlike SMS, services/phoneAuth.ts). Owner rights themselves need a confirmed e-mail (AccountStore.isOwner).
 * - Nothing here logs an address, a code or a key; provider failures are logged as provider + status only.
 */
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { AccountError, bearer, BLOCKED_MESSAGE, FixedWindowRateLimiter, newPasswordHash, signupDigest, type AccountsRequest, type AccountsResponse, type AccountStore, type PendingRegistrations } from './accountStore.js'
import { DEFAULT_EMAIL_LIMITS, EmailSendError, type EmailLimits, type EmailSender } from './email/index.js'
import { renderEmail, type EmailTemplate } from './email/templates.js'
import { CODE_LENGTH, codeHash, codeMatches, DAY_MS, newChallengeId, newCode, newSalt, sha256 } from './oneTimeCode.js'
import { WRONG_CODE_MESSAGE } from './phoneAuth.js'

export type EmailPurpose = 'register' | 'verify' | 'login' | 'reset'
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
/** How long a registration waits for its code (resends included). */
export const REGISTRATION_TTL_MS = 30 * 60 * 1000
export const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_EMAIL_CODE_ATTEMPTS = 5
/** «Кто-то пытался зарегистрироваться с вашим адресом»: at most one notice per address in this period. */
export const NOTICE_INTERVAL_MS = DAY_MS
/** Code requests per IP address per 24 h (registration, sign-in, reset, confirmation together). */
export const DEFAULT_IP_DAILY_LIMIT = 30
/** Registration e-mails (codes and «someone tried» notices) may use at most this share of the daily budget. */
export const REGISTRATION_BUDGET_SHARE = 0.6
/** Codes per address per day from all IPs together: this many times the per-(address, IP) cap. */
export const ADDRESS_CAP_FACTOR = 3
/** Wrong codes per address per 24 h across all its challenges; then every code check for it is refused until later. */
export const MAX_WRONG_CODES_PER_DAY = 10

type Row = Record<string, unknown>

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS email_challenges (
    digest TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    email TEXT NOT NULL,
    account_id TEXT,
    salt BLOB NOT NULL,
    code_hash BLOB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    pending_until INTEGER,
    payload TEXT);
  CREATE INDEX IF NOT EXISTS email_challenges_email ON email_challenges(email, purpose);
  CREATE TABLE IF NOT EXISTS email_requests (
    email_digest TEXT NOT NULL,
    purpose TEXT NOT NULL,
    at INTEGER NOT NULL,
    sent INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS email_requests_email ON email_requests(email_digest, at);
  CREATE INDEX IF NOT EXISTS email_requests_at ON email_requests(at);
  CREATE TABLE IF NOT EXISTS email_code_failures (
    email_digest TEXT NOT NULL,
    at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS email_code_failures_email ON email_code_failures(email_digest, at);
`

/** Request counters keep only a digest of the address. */
const emailDigest = (email: string) => sha256(`email\u0000${email}`)
/** The requesting IP of a code request, as a digest only. */
const ipDigest = (ip: string | undefined) => sha256(`ip\u0000${ip ?? 'unknown'}`)
const normalize = (email: string) => email.trim().toLowerCase()

export class EmailAuthError extends AccountError {
  readonly retryAfter?: number
  constructor(status: number, message: string, retryAfter?: number) {
    super(status, message)
    this.retryAfter = retryAfter
  }
}

export const EMAIL_OFF_MESSAGE = 'Коды на e-mail сейчас недоступны. Войдите по e-mail и паролю.'
const BUDGET_MESSAGE = 'Отправка писем временно недоступна. Попробуйте позже.'
const REGISTRATION_EXPIRED_MESSAGE = 'Срок подтверждения истёк. Зарегистрируйтесь ещё раз.'
const TOO_MANY_ATTEMPTS_MESSAGE = 'Слишком много неверных попыток. Запросите новый код.'
const IP_LIMIT_MESSAGE = 'Слишком много запросов кода с этого адреса. Попробуйте завтра.'

/** `ip`: digest of the address the registration was started from (accountStore signupDigest), never the address. */
interface Payload { salt: string; hash: string; referral?: string; ip?: string }

export interface EmailAuthOptions {
  sender?: EmailSender
  limits?: Partial<EmailLimits & { ipDailyLimit: number }>
  now?: () => number
  /** Logs provider failures (provider + code only). Defaults to console.error. */
  log?: (message: string) => void
}

export class EmailAuthService implements PendingRegistrations {
  private readonly accounts: AccountStore
  private readonly db: DatabaseSync
  private readonly sender?: EmailSender
  readonly limits: EmailLimits & { ipDailyLimit: number }
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly ipLimiter: FixedWindowRateLimiter
  private lastSweep = 0
  /** Background sends still running (tests wait for them). */
  private readonly pending = new Set<Promise<unknown>>()

  constructor(accounts: AccountStore, options: EmailAuthOptions = {}) {
    this.accounts = accounts
    this.db = accounts.database
    this.sender = options.sender
    this.limits = { ...DEFAULT_EMAIL_LIMITS, ipDailyLimit: DEFAULT_IP_DAILY_LIMIT, ...options.limits }
    this.now = options.now ?? accounts.clock
    this.log = options.log ?? ((message) => console.error(message))
    this.ipLimiter = new FixedWindowRateLimiter(this.limits.ipDailyLimit, DAY_MS, this.now)
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(email_requests)').all() as Row[]).map((row) => String(row.name)))
    if (!columns.has('ip_digest')) this.db.exec('ALTER TABLE email_requests ADD COLUMN ip_digest TEXT')
  }

  get enabled() {
    return this.sender !== undefined
  }

  get provider() {
    return this.sender?.provider
  }

  /** Public settings for the website and the apps (no secrets). */
  publicConfig() {
    return { emailEnabled: this.enabled, email: { codeLength: CODE_LENGTH, codeTtlSeconds: EMAIL_CODE_TTL_MS / 1000, resendSeconds: EMAIL_RESEND_COOLDOWN_MS / 1000 } }
  }

  /** What the owner's laptop app shows (admin API only). */
  status() {
    return { emailEnabled: this.enabled, provider: this.sender?.provider ?? null, from: this.sender?.from ?? null, sentToday: this.sentToday(), dailyLimit: this.limits.dailyLimit }
  }

  /** Resolves once every background send has finished (tests). */
  async settled() {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  private requireEnabled(): EmailSender {
    if (!this.sender) throw new EmailAuthError(503, EMAIL_OFF_MESSAGE)
    return this.sender
  }

  /** Per-IP daily cap on code requests (the 15-minute window lives in the route handlers). */
  hitIp(ip: string | undefined) {
    const retry = this.ipLimiter.hit(`ip:${ip ?? 'unknown'}`)
    if (retry) throw new EmailAuthError(429, IP_LIMIT_MESSAGE, retry)
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 10 * 60 * 1000) return
    this.lastSweep = now
    this.db.prepare('DELETE FROM email_challenges WHERE MAX(expires_at, COALESCE(pending_until, 0)) <= ?').run(now)
    this.db.prepare('DELETE FROM email_requests WHERE at <= ?').run(now - 2 * DAY_MS)
    this.db.prepare('DELETE FROM email_code_failures WHERE at <= ?').run(now - 2 * DAY_MS)
  }

  /** E-mails actually sent in the last 24 hours (the owner's daily budget). */
  sentToday() {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM email_requests WHERE sent = 1 AND at > ?').get(this.now() - DAY_MS) as Row).n)
  }

  /** Registration e-mails (codes and notices) actually sent in the last 24 hours. */
  private registrationSentToday() {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM email_requests WHERE sent = 1 AND at > ? AND purpose IN ('register', 'notice')").get(this.now() - DAY_MS) as Row).n)
  }

  /** The part of the daily budget registration may use; the rest stays for sign-in, reset and confirmation. */
  private get registrationBudget() {
    return Math.ceil(this.limits.dailyLimit * REGISTRATION_BUDGET_SHARE)
  }

  /**
   * Budget, cooldown and per-address cap — checked the same way whether or not the address has an account. Notices
   * and test e-mails are not code requests: they never trigger the cooldown or count towards the per-address cap.
   * Cooldown and cap count per address AND requesting IP (somebody else's requests do not lock the owner out), with
   * an overall per-address cap on top against e-mail bombing from many addresses.
   */
  private checkQuota(email: string, ip: string | undefined, purpose: EmailPurpose) {
    const now = this.now()
    if (this.sentToday() >= this.limits.dailyLimit) throw new EmailAuthError(503, BUDGET_MESSAGE)
    if (purpose === 'register' && this.registrationSentToday() >= this.registrationBudget) throw new EmailAuthError(503, BUDGET_MESSAGE)
    const recent = this.db.prepare("SELECT COUNT(*) AS n, MAX(at) AS last FROM email_requests WHERE email_digest = ? AND ip_digest = ? AND at > ? AND purpose NOT IN ('notice', 'test')").get(emailDigest(email), ipDigest(ip), now - DAY_MS) as Row
    const last = recent.last == null ? 0 : Number(recent.last)
    if (last && now - last < EMAIL_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((EMAIL_RESEND_COOLDOWN_MS - (now - last)) / 1000)
      throw new EmailAuthError(429, `Новый код можно запросить через ${wait} с.`, wait)
    }
    const capped = 'Для этого адреса исчерпан лимит кодов на сутки. Попробуйте завтра.'
    if (Number(recent.n) >= this.limits.addressDailyLimit) throw new EmailAuthError(429, capped, 3600)
    const overall = this.db.prepare("SELECT COUNT(*) AS n FROM email_requests WHERE email_digest = ? AND at > ? AND purpose NOT IN ('notice', 'test')").get(emailDigest(email), now - DAY_MS) as Row
    if (Number(overall.n) >= this.limits.addressDailyLimit * ADDRESS_CAP_FACTOR) throw new EmailAuthError(429, capped, 3600)
  }

  private record(email: string, purpose: EmailPurpose | 'notice' | 'test', sent: boolean, ip?: string) {
    this.db.prepare('INSERT INTO email_requests (email_digest, purpose, at, sent, ip_digest) VALUES (?, ?, ?, ?, ?)').run(emailDigest(email), purpose, this.now(), sent ? 1 : 0, ipDigest(ip))
  }

  /**
   * A new challenge for (purpose, e-mail[, account]). Other open challenges of the address stay valid: each challengeId
   * stands alone, so a stranger asking for codes for this address cannot cancel the owner's one. Only the account's own
   * earlier confirmation code (purpose 'verify', signed in) is replaced.
   */
  private createChallenge(purpose: EmailPurpose, email: string, accountId: string | undefined, payload?: Payload | null) {
    const now = this.now()
    this.sweep(now)
    if (purpose === 'verify') this.db.prepare('DELETE FROM email_challenges WHERE purpose = ? AND account_id = ?').run(purpose, accountId ?? '')
    const code = newCode()
    const challengeId = newChallengeId()
    const salt = newSalt()
    const expiresAt = now + EMAIL_CODE_TTL_MS
    const pendingUntil = purpose === 'register' ? now + REGISTRATION_TTL_MS : null
    this.db.prepare('INSERT INTO email_challenges (digest, purpose, email, account_id, salt, code_hash, attempts, created_at, expires_at, pending_until, payload) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
      .run(sha256(challengeId), purpose, email, accountId ?? null, salt, codeHash(salt, purpose, email, code), now, expiresAt, pendingUntil, payload ? JSON.stringify(payload) : null)
    return { challengeId, code, expiresAt }
  }

  private answer(challenge: { challengeId: string; expiresAt: number }) {
    return { challengeId: challenge.challengeId, expiresAt: new Date(challenge.expiresAt).toISOString(), resendSeconds: EMAIL_RESEND_COOLDOWN_MS / 1000 }
  }

  private failure(sender: EmailSender, error: unknown) {
    return `E-mail send failed (${sender.provider}${error instanceof EmailSendError && error.code ? `, code ${error.code}` : ''})`
  }

  private sendInBackground(sender: EmailSender, template: EmailTemplate, email: string, code?: string) {
    const job = sender.send(renderEmail(template, email, { code, ttlMinutes: EMAIL_CODE_TTL_MS / 60_000 })).catch((error: unknown) => this.log(this.failure(sender, error)))
    this.pending.add(job)
    void job.finally(() => this.pending.delete(job))
  }

  /** «Кто-то пытался зарегистрироваться с вашим адресом»: once per NOTICE_INTERVAL_MS per address, within the budget. */
  private notifyExisting(sender: EmailSender, email: string) {
    const last = this.db.prepare("SELECT MAX(at) AS last FROM email_requests WHERE email_digest = ? AND purpose = 'notice' AND sent = 1").get(emailDigest(email)) as Row
    if (last.last != null && this.now() - Number(last.last) < NOTICE_INTERVAL_MS) return
    if (this.sentToday() >= this.limits.dailyLimit) return
    this.record(email, 'notice', true)
    this.sendInBackground(sender, 'notice', email)
  }

  // -------------------------------------------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------------------------------------------

  /** POST /register while e-mail codes are on: the same answer for every address (see the header comment). */
  async startRegistration(rawEmail: string, password: string, referralCode?: string, ip?: string) {
    const sender = this.requireEnabled()
    const email = normalize(rawEmail)
    if (ip !== undefined) this.hitIp(ip)
    this.checkQuota(email, ip, 'register')
    // «Existing» also covers the canonical form of a working account (name+x@…, n.a.m.e@gmail.com): same decoy path.
    if (this.accounts.emailTaken(email)) {
      await this.accounts.dummyPasswordHash(password)
      const challenge = this.createChallenge('register', email, undefined, null)
      this.record(email, 'register', false, ip)
      this.notifyExisting(sender, email)
      return this.answer(challenge)
    }
    const { salt, hash } = await newPasswordHash(password)
    // Another registration of the same address may have finished during the scrypt work: then it is «existing» too.
    if (this.accounts.emailTaken(email)) {
      const challenge = this.createChallenge('register', email, undefined, null)
      this.record(email, 'register', false, ip)
      return this.answer(challenge)
    }
    const payload: Payload = { salt: salt.toString('base64'), hash: hash.toString('base64'), ...(referralCode ? { referral: referralCode.slice(0, 24) } : {}), ...(ip !== undefined ? { ip: signupDigest(ip) } : {}) }
    const challenge = this.createChallenge('register', email, undefined, payload)
    this.record(email, 'register', true, ip)
    this.sendInBackground(sender, 'register', email, challenge.code)
    return this.answer(challenge)
  }

  /** «Отправить код ещё раз» on the registration step: a new code for the same challenge (and the same answer for decoys). */
  resendRegistration(challengeId: string, ip?: string) {
    const sender = this.requireEnabled()
    const digest = sha256(challengeId)
    const row = this.db.prepare("SELECT * FROM email_challenges WHERE digest = ? AND purpose = 'register'").get(digest) as Row | undefined
    const now = this.now()
    if (!row || Number(row.pending_until ?? 0) <= now) {
      if (row) this.db.prepare('DELETE FROM email_challenges WHERE digest = ?').run(digest)
      throw new EmailAuthError(400, REGISTRATION_EXPIRED_MESSAGE)
    }
    if (ip !== undefined) this.hitIp(ip)
    const email = String(row.email)
    this.checkQuota(email, ip, 'register')
    const code = newCode()
    const salt = newSalt()
    const expiresAt = Math.min(now + EMAIL_CODE_TTL_MS, Number(row.pending_until))
    this.db.prepare('UPDATE email_challenges SET salt = ?, code_hash = ?, attempts = 0, expires_at = ? WHERE digest = ?').run(salt, codeHash(salt, 'register', email, code), expiresAt, digest)
    const real = row.payload != null
    this.record(email, 'register', real, ip)
    if (real) this.sendInBackground(sender, 'register', email, code)
    return this.answer({ challengeId, expiresAt })
  }

  /** The code from the registration e-mail: the account is created now, with a confirmed e-mail and a first session. */
  confirmRegistration(challengeId: string, code: string) {
    const row = this.consume('register', challengeId, code)
    const payload = JSON.parse(String(row.payload)) as Payload
    try {
      return this.accounts.createVerifiedAccount(String(row.email), Buffer.from(payload.salt, 'base64'), Buffer.from(payload.hash, 'base64'), payload.referral, typeof payload.ip === 'string' ? payload.ip : undefined)
    } catch (error) {
      // The address got an account meanwhile (another tab, a parallel registration).
      if (error instanceof AccountError && error.status === 409) throw new EmailAuthError(400, WRONG_CODE_MESSAGE)
      throw error
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Confirming the e-mail of an existing account («Подтвердите e-mail»)
  // -------------------------------------------------------------------------------------------------------------

  async startVerify(accountId: string, ip?: string) {
    const sender = this.requireEnabled()
    const email = this.accounts.emailOf(accountId)
    if (!email) throw new EmailAuthError(401, 'Сессия недействительна')
    if (this.accounts.isEmailVerified(accountId)) throw new EmailAuthError(409, 'E-mail уже подтверждён')
    if (ip !== undefined) this.hitIp(ip)
    this.checkQuota(email, ip, 'verify')
    const challenge = this.createChallenge('verify', email, accountId)
    try {
      await sender.send(renderEmail('verify', email, { code: challenge.code, ttlMinutes: EMAIL_CODE_TTL_MS / 60_000 }))
    } catch (error) {
      this.db.prepare('DELETE FROM email_challenges WHERE digest = ?').run(sha256(challenge.challengeId))
      this.record(email, 'verify', false, ip)
      this.log(this.failure(sender, error))
      throw new EmailAuthError(502, 'Не удалось отправить письмо. Попробуйте позже.')
    }
    this.record(email, 'verify', true, ip)
    return this.answer(challenge)
  }

  confirmVerify(accountId: string, challengeId: string, code: string) {
    const row = this.consume('verify', challengeId, code)
    // The code belongs to this account and to its current address.
    if (String(row.account_id) !== accountId || this.accounts.emailOf(accountId) !== String(row.email)) throw new EmailAuthError(400, WRONG_CODE_MESSAGE)
    this.accounts.markEmailVerified(accountId)
  }

  // -------------------------------------------------------------------------------------------------------------
  // Sign-in and password reset by e-mail code
  // -------------------------------------------------------------------------------------------------------------

  /** The same answer for every address; the code goes only to an existing account that is not blocked (owners too). */
  start(purpose: 'login' | 'reset', rawEmail: string, ip?: string) {
    const sender = this.requireEnabled()
    const email = normalize(rawEmail)
    if (ip !== undefined) this.hitIp(ip)
    this.checkQuota(email, ip, purpose)
    const account = this.accounts.accountByEmail(email)
    const eligible = account !== undefined && !account.blocked
    const challenge = this.createChallenge(purpose, email, eligible ? account.id : undefined)
    this.record(email, purpose, eligible, ip)
    if (eligible) this.sendInBackground(sender, purpose, email, challenge.code)
    return this.answer(challenge)
  }

  /**
   * Checks a code. Every wrong try counts; after MAX_EMAIL_CODE_ATTEMPTS the code is gone (a registration keeps its
   * pending data for «Отправить код ещё раз»). A correct code is used up. Decoys never match.
   */
  private consume(purpose: EmailPurpose, challengeId: string, rawCode: string) {
    this.requireEnabled()
    const digest = sha256(challengeId)
    const row = this.db.prepare('SELECT * FROM email_challenges WHERE digest = ? AND purpose = ?').get(digest, purpose) as Row | undefined
    const now = this.now()
    const keepPending = (candidate: Row) => purpose === 'register' && Number(candidate.pending_until ?? 0) > now
    if (!row || Number(row.expires_at) <= now) {
      if (row && !keepPending(row)) this.db.prepare('DELETE FROM email_challenges WHERE digest = ?').run(digest)
      throw new EmailAuthError(400, WRONG_CODE_MESSAGE)
    }
    // Wrong codes per address per day, across all its challenges (new challenges do not reset the count).
    const failures = this.db.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM email_code_failures WHERE email_digest = ? AND at > ?').get(emailDigest(String(row.email)), now - DAY_MS) as Row
    if (Number(failures.n) >= MAX_WRONG_CODES_PER_DAY) {
      const wait = Math.max(60, Math.ceil((Number(failures.first) + DAY_MS - now) / 1000))
      throw new EmailAuthError(429, 'Слишком много неверных кодов для этого адреса. Попробуйте завтра или войдите по паролю.', wait)
    }
    const attempts = Number(row.attempts) + 1
    const target = purpose === 'register' ? row.payload != null : row.account_id != null
    const match = codeMatches(row.code_hash as Uint8Array, row.salt as Uint8Array, purpose, String(row.email), rawCode) && target
    if (!match) this.db.prepare('INSERT INTO email_code_failures (email_digest, at) VALUES (?, ?)').run(emailDigest(String(row.email)), now)
    if (match) this.db.prepare('DELETE FROM email_challenges WHERE digest = ?').run(digest)
    else if (attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
      if (keepPending(row)) this.db.prepare('UPDATE email_challenges SET attempts = ?, expires_at = 0 WHERE digest = ?').run(attempts, digest)
      else this.db.prepare('DELETE FROM email_challenges WHERE digest = ?').run(digest)
    } else this.db.prepare('UPDATE email_challenges SET attempts = ? WHERE digest = ?').run(attempts, digest)
    if (!match) throw new EmailAuthError(400, attempts >= MAX_EMAIL_CODE_ATTEMPTS ? TOO_MANY_ATTEMPTS_MESSAGE : WRONG_CODE_MESSAGE)
    return row
  }

  /** The account a sign-in / reset code is for, re-checked at the moment of use. */
  private signInTarget(purpose: 'login' | 'reset', challengeId: string, code: string) {
    const row = this.consume(purpose, challengeId, code)
    const account = this.accounts.accountByEmail(String(row.email))
    if (!account || account.id !== String(row.account_id)) throw new EmailAuthError(400, WRONG_CODE_MESSAGE)
    if (account.blocked) throw new EmailAuthError(403, BLOCKED_MESSAGE)
    // The code reached the inbox: the address is proven.
    this.accounts.markEmailVerified(account.id)
    return account.id
  }

  login(challengeId: string, code: string) {
    const accountId = this.signInTarget('login', challengeId, code)
    return { accountId, token: this.accounts.startSession(accountId) }
  }

  /** New password after a confirmed code: every session of the account is revoked, this device gets a new one. */
  async reset(challengeId: string, code: string, password: string) {
    const accountId = this.signInTarget('reset', challengeId, code)
    const token = await this.accounts.setPassword(accountId, password)
    return { accountId, token }
  }

  /** «Отправить тестовое письмо» in the owner's laptop app (admin API only). Counts towards the daily budget. */
  async sendTest(rawTo: string) {
    const sender = this.requireEnabled()
    const parsed = emailSchema.safeParse(rawTo)
    if (!parsed.success) throw new EmailAuthError(400, 'Укажите корректный e-mail')
    if (this.sentToday() >= this.limits.dailyLimit) throw new EmailAuthError(503, 'Дневной лимит писем исчерпан')
    try {
      await sender.send(renderEmail('test', parsed.data))
    } catch (error) {
      this.record(parsed.data, 'test', false)
      throw new EmailAuthError(502, error instanceof EmailSendError ? error.message : 'Почтовый сервис недоступен')
    }
    this.record(parsed.data, 'test', true)
    return { ok: true, provider: sender.provider, sentToday: this.sentToday(), dailyLimit: this.limits.dailyLimit }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Framework-free handlers (routes/email.ts adapts them to Express)
// ---------------------------------------------------------------------------------------------------------------

export interface EmailHandlerOptions {
  now?: () => number
  /** Per IP in 15 minutes: code requests (start) and code checks (verify). Per account per hour: confirmation codes. */
  limits?: Partial<Record<'start' | 'verify' | 'account', number>>
}

const emailSchema = z.string().trim().toLowerCase().max(254).email()
const challengeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/)
const codeSchema = z.string().trim().max(12)
const startSchema = z.object({ email: emailSchema })
const verifySchema = z.object({ challengeId: challengeIdSchema, code: codeSchema })
const resendSchema = z.object({ challengeId: challengeIdSchema })
const resetSchema = verifySchema.extend({ password: z.string().min(8).max(128) })

export function createEmailHandlers(accounts: AccountStore, emails: EmailAuthService, options: EmailHandlerOptions = {}) {
  const limit = { start: 5, verify: 20, account: 6, ...options.limits }
  const startLimiter = new FixedWindowRateLimiter(limit.start, 15 * 60 * 1000, options.now)
  const verifyLimiter = new FixedWindowRateLimiter(limit.verify, 15 * 60 * 1000, options.now)
  const accountLimiter = new FixedWindowRateLimiter(limit.account, 60 * 60 * 1000, options.now)

  const tooMany = (retry: number): AccountsResponse => ({ status: 429, body: { error: 'Слишком много попыток. Попробуйте позже.', retryAfter: retry }, headers: { 'Retry-After': String(retry) } })
  const hit = (limiter: FixedWindowRateLimiter, key: string) => { const retry = limiter.hit(key); return retry ? tooMany(retry) : undefined }
  const ip = (req: AccountsRequest) => `ip:${req.ip ?? 'unknown'}`

  const guard = async (run: () => Promise<AccountsResponse> | AccountsResponse): Promise<AccountsResponse> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof EmailAuthError && error.retryAfter) return { status: error.status, body: { error: error.message, retryAfter: error.retryAfter }, headers: { 'Retry-After': String(error.retryAfter) } }
      if (error instanceof AccountError) return { status: error.status, body: { error: error.message } }
      throw error
    }
  }
  const authed = (req: AccountsRequest, run: (accountId: string) => Promise<AccountsResponse> | AccountsResponse) => guard(() => {
    const accountId = accounts.authenticate(bearer(req.authorization))
    if (!accountId) return { status: 401, body: { error: 'Требуется вход в аккаунт' } }
    return run(accountId)
  })
  const off = (): AccountsResponse | undefined => (emails.enabled ? undefined : { status: 503, body: { error: EMAIL_OFF_MESSAGE, emailEnabled: false } })
  /**
   * /email/login and /email/reset: a wrong code is a failed sign-in, answered 401 (same message) so the security guard
   * counts it like a wrong password (services/securityGuard.ts, isLoginPath).
   */
  const asLoginFailure = (response: AccountsResponse): AccountsResponse => (response.status === 400 ? { ...response, status: 401 } : response)

  const start = (purpose: 'login' | 'reset') => (req: AccountsRequest) => guard(() => {
    const stop = off() ?? hit(startLimiter, ip(req))
    if (stop) return stop
    const parsed = startSchema.safeParse(req.body)
    if (!parsed.success) return { status: 400, body: { error: 'Укажите корректный e-mail' } }
    return { status: 200, body: emails.start(purpose, parsed.data.email, req.ip) }
  })

  return {
    loginStart: start('login'),
    resetStart: start('reset'),

    login: (req: AccountsRequest) => guard(() => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = verifySchema.safeParse(req.body)
      if (!parsed.success) return { status: 401, body: { error: WRONG_CODE_MESSAGE } }
      const { accountId, token } = emails.login(parsed.data.challengeId, parsed.data.code)
      return { status: 200, body: { token, account: accounts.view(accountId) } }
    }).then(asLoginFailure),

    reset: (req: AccountsRequest) => guard(async () => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = resetSchema.safeParse(req.body)
      if (!parsed.success) return verifySchema.safeParse(req.body).success ? { status: 400, body: { error: 'Новый пароль: от 8 до 128 символов' } } : { status: 401, body: { error: WRONG_CODE_MESSAGE } }
      try {
        const { accountId, token } = await emails.reset(parsed.data.challengeId, parsed.data.code, parsed.data.password)
        return { status: 200, body: { token, account: accounts.view(accountId) } }
      } catch (error) {
        if (error instanceof EmailAuthError && error.status === 400) return { status: 401, body: { error: error.message } }
        throw error
      }
    }),

    registerConfirm: (req: AccountsRequest) => guard(() => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = verifySchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: WRONG_CODE_MESSAGE } }
      const { token, referralApplied } = emails.confirmRegistration(parsed.data.challengeId, parsed.data.code)
      return { status: 201, body: { token, referralApplied, account: accounts.view(accounts.authenticate(token)!) } }
    }),

    registerResend: (req: AccountsRequest) => guard(() => {
      const stop = off() ?? hit(startLimiter, ip(req))
      if (stop) return stop
      const parsed = resendSchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: REGISTRATION_EXPIRED_MESSAGE } }
      return { status: 200, body: emails.resendRegistration(parsed.data.challengeId, req.ip) }
    }),

    /** Signed in: send a confirmation code to the account's own address. */
    verifyStart: (req: AccountsRequest) => authed(req, async (accountId) => {
      const stop = off() ?? hit(accountLimiter, `account:${accountId}`) ?? hit(startLimiter, ip(req))
      if (stop) return stop
      return { status: 200, body: await emails.startVerify(accountId, req.ip) }
    }),

    verifyConfirm: (req: AccountsRequest) => authed(req, (accountId) => {
      const stop = off() ?? hit(verifyLimiter, ip(req))
      if (stop) return stop
      const parsed = verifySchema.safeParse(req.body)
      if (!parsed.success) return { status: 400, body: { error: WRONG_CODE_MESSAGE } }
      emails.confirmVerify(accountId, parsed.data.challengeId, parsed.data.code)
      return { status: 200, body: accounts.view(accountId) }
    }),
  }
}

export type EmailHandlers = ReturnType<typeof createEmailHandlers>
