/**
 * Website accounts: store + framework-free request handlers.
 *
 * Persistence: accounts, sessions, streamer referral codes and referral visit counters live in SQLite
 * (the same database file as the rest of the server, see services/database.ts), so they survive restarts.
 * Without a database handle the store uses a private in-memory SQLite database (tests).
 *
 * E-mail verification, sign-in and password reset by e-mail code live in services/emailAuth.ts (on once the owner
 * configures an e-mail provider); password reset also works through a verified phone number (services/phoneAuth.ts)
 * when an SMS provider is configured. Subscription state is
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
/** Open sessions per account; a new sign-in beyond this ends the oldest one (shared accounts stay tedious). */
export const MAX_SESSIONS_PER_ACCOUNT = 10
/** Failed password sign-ins per e-mail per hour, whatever the IP (credential stuffing from many addresses). */
export const LOGIN_FAILURES_PER_EMAIL = 10
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
  /** The streamer-code trial was refused: this e-mail (canonical form) or device already had one (trial_claims). */
  trialDenied: boolean
}

export interface ReferralStats {
  visits: number
  registrations: number
  activeSubscriptions: number
  /** Paid by referred users, roubles. Owner only: the streamer's own view leaves it out (he sees only his share). */
  revenue?: { amount: number; currency: 'RUB' }
  earnings: { amount: number; currency: 'RUB' }
}

/** Paid periods and referral revenue (PaymentStore); amounts in kopecks. */
export interface SubscriptionSource {
  paidUntil(accountId: string): number | undefined
  referralStats(code: string): { activeSubscriptions: number; revenue: number; earnings: number }
  /** Paid subscriptions of referred users grouped by period key (see `periodKeySql`). */
  referralSeries(code: string, keySql: (column: string) => string): Array<{ key: string; payments: number; months: Record<string, number>; revenue: number; earnings: number }>
}

export type StatsPeriod = 'day' | 'month' | 'year'
/** Statistics days follow Moscow time (UTC+3, no daylight saving). */
const STATS_OFFSET_MS = 3 * 60 * 60 * 1000
const PERIOD_LENGTH: Record<StatsPeriod, number> = { day: 10, month: 7, year: 4 }
/** SQL that turns a millisecond timestamp column into the period key: 2026-10-01 / 2026-10 / 2026. */
export const periodKeySql = (period: StatsPeriod) => (column: string) => `substr(strftime('%Y-%m-%d', (${column} + ${STATS_OFFSET_MS}) / 1000, 'unixepoch'), 1, ${PERIOD_LENGTH[period]})`
const statsDay = (time: number) => new Date(time + STATS_OFFSET_MS).toISOString().slice(0, 10)

export interface ReferralSeriesRow {
  period: string
  visits: number
  registrations: number
  /** Successful payments by referred users and how many of them were for 1 / 3 / 6 / 12 months. */
  payments: number
  months: { '1m': number; '3m': number; '6m': number; '12m': number }
  /** Owner only (left out of the streamer's own table). */
  revenue?: number
  earnings: number
}

export interface AccountView {
  email: string
  kind: AccountKind
  createdAt: string
  referralCode?: string
  referredBy?: string
  nicknames: Partial<Record<AccountMode, string>>
  /** `lifetime`: streamers use the service free of charge, for good. */
  subscription: { status: 'active' | 'trial' | 'inactive'; paidUntil?: string; trialEndsAt?: string; lifetime?: true }
  stats?: ReferralStats
  /** The service owner (e-mail listed in TARKOV_OWNER_EMAILS): sees the owner section of the website. */
  owner?: true
  /** Verified phone number, masked (+7 ••• •••-45-67); the full number is never sent back. */
  phone?: { masked: string; verifiedAt: string }
  /** When the e-mail was confirmed with a one-time code (services/emailAuth.ts); absent = not confirmed yet. */
  emailVerifiedAt?: string
  /** The Escape from Tarkov account found in this player's game logs (desktop app), masked («••••289»). */
  eftAccount?: { masked: string; boundAt: string }
}

/** «+7 ••• •••-45-67»: enough for the owner of the number to recognise it. */
export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  const country = digits.startsWith('7') ? '7' : digits.slice(0, Math.max(1, digits.length - 10))
  return `+${country} ••• •••-${digits.slice(-4, -2)}-${digits.slice(-2)}`
}

/** Owner e-mails from `TARKOV_OWNER_EMAILS` (comma, semicolon or space separated), set by the owner's desktop app. */
export function parseOwnerEmails(raw: string | undefined) {
  return [...new Set((raw ?? '').split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter((email) => z.string().email().max(254).safeParse(email).success))]
}

/** Campaign label of an audience link (`/r/CODE?c=youtube`): lowercase latin letters, digits, «_» or «-». */
export const CAMPAIGN = /^[a-z0-9_-]{1,32}$/
export function normalizeCampaign(raw: unknown) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return CAMPAIGN.test(value) ? value : undefined
}

/** Documents a user accepts with a checkbox; the version is the date of the published text (website/src/legal). */
export type ConsentKind = 'registration' | 'payment'
export const CONSENT_VERSION = /^\d{4}-\d{2}-\d{2}(\.\d{1,3})?$/

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

/** A fresh salt and its scrypt hash (a pending registration keeps only these, never the password). */
export async function newPasswordHash(password: string) {
  const salt = randomBytes(16)
  return { salt, hash: await hashPassword(password, salt) }
}

/** Only the SHA-256 of a session token is stored, so a database copy does not reveal usable tokens. */
export function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/** Visitor addresses are not stored in clear text: only a digest bound to the referral code. */
function visitorDigest(code: string, visitorKey: string) {
  return createHash('sha256').update(`${code}\u0000${visitorKey}`).digest('hex')
}

/** The registration address is kept only as this digest: enough to see two accounts made from one address. */
export function signupDigest(ip: string) {
  return createHash('sha256').update(`signup\u0000${ip}`).digest('hex')
}

/** An Escape from Tarkov AccountId (digits from the game logs) is kept only as this digest. */
export function eftDigest(eftAccountId: string) {
  return createHash('sha256').update(`eft\u0000${eftAccountId}`).digest('hex')
}

/** The answer when the game account already belongs to another Raid OS account. */
export const EFT_IN_USE_MESSAGE = 'Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.'

/**
 * The canonical form of an e-mail for anti-abuse checks (never for sign-in): lowercase, «+tag» dropped, and for
 * Gmail (gmail.com / googlemail.com) the dots of the local part dropped too — all of these reach the same mailbox.
 */
export function canonicalEmail(email: string) {
  const key = email.trim().toLowerCase()
  const at = key.lastIndexOf('@')
  if (at <= 0) return key
  let local = key.slice(0, at)
  let domain = key.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

/** What `trial_claims` keeps of an e-mail: a digest of its canonical form (survives «Удалить аккаунт»). */
export function trialEmailDigest(email: string) {
  return createHash('sha256').update(`trial\u0000${canonicalEmail(email)}`).digest('hex')
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
    trialDenied: row.trial_denied != null,
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
  CREATE TABLE IF NOT EXISTS referral_visit_days (
    code TEXT NOT NULL,
    day TEXT NOT NULL,
    visits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (code, day));
  CREATE TABLE IF NOT EXISTS streamer_invites (
    digest TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    used_at INTEGER);
  CREATE TABLE IF NOT EXISTS referral_visit_campaigns (
    code TEXT NOT NULL,
    campaign TEXT NOT NULL,
    day TEXT NOT NULL,
    visits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (code, campaign, day));
  CREATE TABLE IF NOT EXISTS account_consents (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    version TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, kind, version));
  -- Who already had the streamer-code trial: by canonical e-mail digest and by app device. No foreign key and never
  -- purged by deleteAccount(), so deleting the account and registering again does not give a second trial.
  CREATE TABLE IF NOT EXISTS trial_claims (
    email_canon_hash TEXT NOT NULL,
    device_id TEXT,
    account_id TEXT NOT NULL,
    at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS trial_claims_email ON trial_claims(email_canon_hash);
  CREATE INDEX IF NOT EXISTS trial_claims_device ON trial_claims(device_id);
  CREATE INDEX IF NOT EXISTS trial_claims_account ON trial_claims(account_id);
  -- The Escape from Tarkov account of a Raid OS account: the AccountId the desktop app reads from the game logs, kept as
  -- a digest (eftDigest) and its last digits. One game account belongs to one Raid OS account at a time («Пригласи
  -- друга» counts one friend per game account, services/invites.ts). Deleted with the account.
  CREATE TABLE IF NOT EXISTS eft_accounts (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    eft_digest TEXT NOT NULL UNIQUE,
    eft_hint TEXT NOT NULL,
    bound_at INTEGER NOT NULL);
`

/**
 * Columns added after the first release (owner admin panel); older databases get them on start, NULL for every
 * existing account: `blocked_at` — sign-in blocked by the owner, `last_seen_at` — last authenticated request (updated
 * at most every few minutes), `referral_disabled_at` — the owner switched the streamer's link off.
 */
const ADDED_ACCOUNT_COLUMNS: Array<[string, string]> = [
  ['blocked_at', 'INTEGER'],
  // «Удалить аккаунт»: the row stays (payments refer to it) but holds no personal data any more.
  ['deleted_at', 'INTEGER'],
  ['last_seen_at', 'INTEGER'],
  ['referral_disabled_at', 'INTEGER'],
  // Verified phone number in E.164 (services/phoneAuth.ts): set only after an SMS code was confirmed.
  ['phone', 'TEXT'],
  ['phone_verified_at', 'INTEGER'],
  // E-mail confirmed with a one-time code (services/emailAuth.ts).
  ['email_verified_at', 'INTEGER'],
  // 1 for every account that already existed when e-mail confirmation was introduced (see the constructor).
  ['email_grandfathered', 'INTEGER NOT NULL DEFAULT 0'],
  // «Пригласи друга» (services/invites.ts): the player's own code, who invited this account (account id) and when,
  // and a digest of the address the account was registered from (anti-abuse; never the address itself).
  ['invite_code', 'TEXT'],
  ['invited_by', 'TEXT'],
  ['invited_at', 'INTEGER'],
  ['signup_ip', 'TEXT'],
  // Canonical e-mail (canonicalEmail) of a working account: one person cannot hold several accounts through
  // «name+1@», «n.a.m.e@gmail.com»… NULL once the account is deleted.
  ['email_canon', 'TEXT'],
  // Set when the streamer-code trial was refused (trial_claims): the referral still counts for the streamer.
  ['trial_denied', 'INTEGER'],
]
/** `last_seen_at` is written at most this often per account. */
const LAST_SEEN_STEP_MS = 5 * 60 * 1000
/** Immediate registration (e-mail codes off) of a taken or owner address: one answer for both. */
export const REGISTRATION_REFUSED_MESSAGE = 'Не удалось зарегистрировать этот e-mail. Если это ваш адрес — войдите или восстановите пароль.'
export const BLOCKED_MESSAGE = 'Вход в этот аккаунт заблокирован. Напишите в поддержку.'

/** Streamer invitation links live a week and work once. */
export const STREAMER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class AccountStore {
  private readonly db: DatabaseSync
  private readonly ownsDb: boolean
  /** Dummy hash so a login for an unknown e-mail costs the same scrypt work as a real one. */
  private readonly dummySalt = randomBytes(16)
  private readonly now: () => number
  private lastSweep = 0
  private subscriptions?: SubscriptionSource
  private readonly ownerEmails: ReadonlySet<string>

  /** `ownerEmails` defaults to TARKOV_OWNER_EMAILS (the owner's desktop app passes it to the API process). */
  constructor(options: { now?: () => number; db?: DatabaseSync; ownerEmails?: readonly string[] } = {}) {
    this.now = options.now ?? Date.now
    this.ownerEmails = new Set(options.ownerEmails ? parseOwnerEmails(options.ownerEmails.join(',')) : parseOwnerEmails(process.env.TARKOV_OWNER_EMAILS))
    this.ownsDb = !options.db
    this.db = options.db ?? openDatabase(':memory:')
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(accounts)').all() as Row[]).map((row) => String(row.name)))
    for (const [name, type] of ADDED_ACCOUNT_COLUMNS) if (!columns.has(name)) this.db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`)
    // Owner grandfathering. Owner rights now need a confirmed e-mail (see isOwner()), but accounts registered before
    // e-mail codes existed could never confirm theirs. So, exactly once — on the start that adds the column — every
    // account that exists at that moment is marked `email_grandfathered = 1` and keeps the owner rights it had.
    // Accounts created afterwards are never grandfathered: they must confirm their e-mail first. Because this runs only
    // when the column is missing, a later restart cannot grandfather anybody new.
    if (!columns.has('email_grandfathered')) this.db.exec('UPDATE accounts SET email_grandfathered = 1')
    // A verified number belongs to one account only.
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_phone ON accounts(phone) WHERE phone IS NOT NULL')
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_invite_code ON accounts(invite_code) WHERE invite_code IS NOT NULL')
    this.db.exec('CREATE INDEX IF NOT EXISTS accounts_invited_by ON accounts(invited_by)')
    this.db.exec('CREATE INDEX IF NOT EXISTS accounts_email_canon ON accounts(email_canon)')
    // Accounts from before the canonical e-mail / trial claims: filled in once (only rows still missing them).
    for (const row of this.db.prepare('SELECT id, email FROM accounts WHERE email_canon IS NULL AND deleted_at IS NULL').all() as Row[]) {
      this.db.prepare('UPDATE accounts SET email_canon = ? WHERE id = ?').run(canonicalEmail(String(row.email)), String(row.id))
    }
    for (const row of this.db.prepare("SELECT id, email, referred_at FROM accounts WHERE referred_at IS NOT NULL AND trial_denied IS NULL AND deleted_at IS NULL AND kind = 'user' AND NOT EXISTS (SELECT 1 FROM trial_claims c WHERE c.account_id = accounts.id)").all() as Row[]) {
      this.db.prepare('INSERT INTO trial_claims (email_canon_hash, device_id, account_id, at) VALUES (?, NULL, ?, ?)').run(trialEmailDigest(String(row.email)), String(row.id), Number(row.referred_at))
    }
  }

  /** The shared database handle (the owner's admin panel reads statistics from it, services/adminStore.ts). */
  get database() {
    return this.db
  }

  /** The store's clock (tests set it), shared with the admin panel's statistics. */
  get clock() {
    return this.now
  }

  /** Configured owner e-mails (lowercase). */
  get owners(): ReadonlySet<string> {
    return this.ownerEmails
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

  /**
   * Immediate registration, used while e-mail codes are switched off (no provider): the account starts with an
   * unconfirmed e-mail. With e-mail codes on, registration goes through services/emailAuth.ts instead and the account
   * is created by createVerifiedAccount() only after the code is confirmed.
   */
  async register(email: string, password: string, referralCode?: string, ip?: string) {
    const key = email.trim().toLowerCase()
    // Without e-mail confirmation nobody proves the address is theirs, so a listed owner e-mail cannot be registered
    // here at all (and even if it were, isOwner() would refuse an unconfirmed account). A taken address and an owner
    // address get the same answer, so the reply does not show which e-mail is the owner's.
    // The canonical form counts too (name+x@, n.a.m.e@gmail.com): same answer, so nothing about the account leaks.
    if (this.findByEmail(key) || this.ownerEmails.has(key) || this.canonicalTaken(key)) throw new AccountError(409, REGISTRATION_REFUSED_MESSAGE)
    const { salt, hash } = await newPasswordHash(password)
    return this.insertAccount(key, salt, hash, referralCode, null, ip === undefined ? undefined : signupDigest(ip))
  }

  /**
   * Registration completed with an e-mail code (services/emailAuth.ts): the address is proven, so the account starts
   * confirmed — this is also how a listed owner e-mail can be registered once e-mail codes are on. Throws 409 when the
   * address got an account meanwhile.
   */
  createVerifiedAccount(email: string, salt: Buffer, passwordHash: Buffer, referralCode?: string, signupIp?: string) {
    const key = email.trim().toLowerCase()
    if (this.findByEmail(key) || this.canonicalTaken(key)) throw new AccountError(409, 'Этот e-mail уже зарегистрирован')
    return this.insertAccount(key, salt, passwordHash, referralCode, this.now(), signupIp)
  }

  /**
   * An address that cannot get a new account: it has one, or its canonical form (canonicalEmail) belongs to a working
   * account. Registration answers exactly as for a taken address (anti-enumeration).
   */
  emailTaken(email: string) {
    const key = email.trim().toLowerCase()
    return this.findByEmail(key) !== undefined || this.canonicalTaken(key)
  }

  private canonicalTaken(email: string) {
    return this.db.prepare('SELECT 1 FROM accounts WHERE email_canon = ? AND deleted_at IS NULL').get(canonicalEmail(email)) !== undefined
  }

  /**
   * The streamer-code trial goes to the first account of a canonical e-mail only. A later account (another «+tag», a
   * re-registration after «Удалить аккаунт») keeps the referral — it counts for the streamer — but gets no trial.
   */
  private claimTrialByEmail(accountId: string, email: string) {
    const digest = trialEmailDigest(email)
    if (this.db.prepare('SELECT 1 FROM trial_claims WHERE email_canon_hash = ? AND account_id <> ?').get(digest, accountId)) {
      this.db.prepare('UPDATE accounts SET trial_denied = ? WHERE id = ? AND trial_denied IS NULL').run(this.now(), accountId)
      return
    }
    if (!this.db.prepare('SELECT 1 FROM trial_claims WHERE account_id = ? AND device_id IS NULL').get(accountId)) {
      this.db.prepare('INSERT INTO trial_claims (email_canon_hash, device_id, account_id, at) VALUES (?, NULL, ?, ?)').run(digest, accountId, this.now())
    }
  }

  /**
   * Called when the app registers a device (services/entitlement.ts): an account with a streamer-code trial loses the
   * trial when that device already served another account's trial; otherwise the device is noted for this one.
   */
  claimTrialDevice(accountId: string, deviceId: string) {
    const row = this.db.prepare("SELECT email, referred_at, trial_denied FROM accounts WHERE id = ? AND kind = 'user' AND deleted_at IS NULL").get(accountId) as Row | undefined
    if (!row || row.referred_at == null || row.trial_denied != null) return
    if (this.db.prepare('SELECT 1 FROM trial_claims WHERE device_id = ? AND account_id <> ?').get(deviceId, accountId)) {
      this.db.prepare('UPDATE accounts SET trial_denied = ? WHERE id = ?').run(this.now(), accountId)
      return
    }
    if (!this.db.prepare('SELECT 1 FROM trial_claims WHERE device_id = ? AND account_id = ?').get(deviceId, accountId)) {
      this.db.prepare('INSERT INTO trial_claims (email_canon_hash, device_id, account_id, at) VALUES (?, ?, ?, ?)').run(trialEmailDigest(String(row.email)), deviceId, accountId, this.now())
    }
  }

  /** Same scrypt cost as hashing a real password (registration of an address that already has an account). */
  async dummyPasswordHash(password: string) {
    await hashPassword(password, this.dummySalt)
  }

  /** `signupIp`: digest of the registration address (signupDigest), kept only to spot invitation abuse. */
  private insertAccount(key: string, salt: Buffer, passwordHash: Buffer, referralCode: string | undefined, verifiedAt: number | null, signupIp?: string) {
    const id = randomBytes(12).toString('hex')
    const createdAt = this.now()
    let referredBy: string | null = null
    let invitedBy: string | null = null
    if (referralCode) {
      const code = normalizeReferralCode(referralCode)
      // An unknown or invalid code must not block registration; it is simply not applied. A streamer's code gives the
      // trial; a player's code («Пригласи друга») gives the discount on the first month (services/invites.ts).
      if (this.activeOwnerOfCode(code)) referredBy = code
      else invitedBy = this.playerOfCode(code) ?? null
    }
    try {
      this.db.prepare('INSERT INTO accounts (id, email, salt, password_hash, kind, created_at, referred_by, referred_at, nicknames, email_verified_at, invited_by, invited_at, signup_ip, email_canon) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, key, salt, passwordHash, 'user', createdAt, referredBy, referredBy ? createdAt : null, '{}', verifiedAt, invitedBy, invitedBy ? createdAt : null, signupIp ?? null, canonicalEmail(key))
    } catch (error) {
      // UNIQUE(email) closes the race between two parallel registrations of the same address.
      if (this.findByEmail(key)) throw new AccountError(409, 'Этот e-mail уже зарегистрирован')
      throw error
    }
    if (referredBy) this.claimTrialByEmail(id, key)
    return { token: this.createSession(id), referralApplied: referredBy !== null || invitedBy !== null }
  }

  async login(email: string, password: string) {
    const account = this.findByEmail(email)
    const hash = await hashPassword(password, account?.salt ?? this.dummySalt)
    if (!account || !timingSafeEqual(hash, account.passwordHash)) throw new AccountError(401, 'Неверный e-mail или пароль')
    // Checked only after the password, so the block is not revealed to somebody who does not know it.
    if (this.isBlocked(account.id)) throw new AccountError(403, BLOCKED_MESSAGE)
    return { token: this.createSession(account.id) }
  }

  logout(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE digest = ?').run(tokenDigest(token))
  }

  /** Returns the account id for a valid, non-expired session token. */
  authenticate(token: string | undefined) {
    if (!token) return undefined
    const digest = tokenDigest(token)
    const session = this.db.prepare('SELECT s.account_id AS account_id, s.expires_at AS expires_at, a.blocked_at AS blocked_at, a.last_seen_at AS last_seen_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.digest = ?').get(digest) as Row | undefined
    if (!session) return undefined
    const now = this.now()
    if (Number(session.expires_at) <= now || session.blocked_at != null) { this.db.prepare('DELETE FROM sessions WHERE digest = ?').run(digest); return undefined }
    if (session.last_seen_at == null || now - Number(session.last_seen_at) >= LAST_SEEN_STEP_MS) this.db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(now, String(session.account_id))
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
      subscription: trialEndsAt !== undefined && !account.trialDenied && trialEndsAt > this.now() ? { status: 'trial', trialEndsAt: new Date(trialEndsAt).toISOString() } : { status: 'inactive' },
    }
    const paidUntil = this.subscriptions?.paidUntil(account.id)
    if (paidUntil !== undefined && paidUntil > this.now()) view.subscription = { status: 'active', paidUntil: new Date(paidUntil).toISOString() }
    if (account.referredBy) view.referredBy = account.referredBy
    if (account.kind === 'streamer' && account.referralCode) {
      view.referralCode = account.referralCode
      // The streamer sees his share, never the amounts his viewers paid.
      const { revenue: _revenue, ...own } = this.stats(account.referralCode)
      void _revenue
      view.stats = own
    }
    // Streamers use the service free of charge, for good (the desktop app reads the same view).
    if (account.kind === 'streamer') view.subscription = { status: 'active', lifetime: true }
    const extra = this.db.prepare('SELECT phone, phone_verified_at, email_verified_at, email_grandfathered FROM accounts WHERE id = ?').get(account.id) as Row | undefined
    if (this.ownerRights(account.email, extra)) view.owner = true
    if (extra?.phone != null) view.phone = { masked: maskPhone(String(extra.phone)), verifiedAt: new Date(Number(extra.phone_verified_at)).toISOString() }
    if (extra?.email_verified_at != null) view.emailVerifiedAt = new Date(Number(extra.email_verified_at)).toISOString()
    const eft = this.eftAccountOf(account.id)
    if (eft) view.eftAccount = eft
    return view
  }

  /**
   * The game account found in this player's Escape from Tarkov logs (sent by the desktop app): bound to this account.
   * Another game account later replaces it. A game account another working Raid OS account already holds is refused
   * (409, EFT_IN_USE_MESSAGE): one game account — one Raid OS account, so a second registration cannot reuse it.
   * The logs are the player's own; this keeps honest players apart, it is not proof against a forged request.
   */
  bindEftAccount(accountId: string, eftAccountId: string) {
    const account = this.mustGet(accountId)
    if (!/^\d{3,12}$/.test(eftAccountId)) throw new AccountError(400, 'Неверный идентификатор аккаунта Escape from Tarkov')
    const digest = eftDigest(eftAccountId)
    const holder = this.db.prepare('SELECT account_id FROM eft_accounts WHERE eft_digest = ?').get(digest) as Row | undefined
    if (holder && String(holder.account_id) !== account.id) throw new AccountError(409, EFT_IN_USE_MESSAGE)
    if (!holder) {
      this.db.prepare('INSERT INTO eft_accounts (account_id, eft_digest, eft_hint, bound_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET eft_digest = excluded.eft_digest, eft_hint = excluded.eft_hint, bound_at = excluded.bound_at')
        .run(account.id, digest, eftAccountId.slice(-3), this.now())
    }
    return this.eftAccountOf(account.id)!
  }

  /** The bound game account, masked, or undefined. */
  eftAccountOf(accountId: string) {
    const row = this.db.prepare('SELECT eft_hint, bound_at FROM eft_accounts WHERE account_id = ?').get(accountId) as Row | undefined
    return row ? { masked: `••••${String(row.eft_hint)}`, boundAt: new Date(Number(row.bound_at)).toISOString() } : undefined
  }

  /** The digest of the bound game account (services/invites.ts), or undefined. */
  eftDigestOf(accountId: string) {
    const row = this.db.prepare('SELECT eft_digest FROM eft_accounts WHERE account_id = ?').get(accountId) as Row | undefined
    return row ? String(row.eft_digest) : undefined
  }

  /**
   * Owner rights are decided only here, on the server: the e-mail is listed in TARKOV_OWNER_EMAILS AND the account has
   * proven it owns that e-mail — either it confirmed the address with a one-time code (`email_verified_at`), or it
   * existed before e-mail codes were introduced (`email_grandfathered`, set once by the migration in the constructor,
   * so the owner's existing account keeps working). A listed address registered later without confirmation gets no
   * owner rights until it is confirmed.
   */
  isOwner(accountId: string) {
    const account = this.mustGet(accountId)
    return this.ownerRights(account.email, this.db.prepare('SELECT email_verified_at, email_grandfathered FROM accounts WHERE id = ?').get(accountId) as Row | undefined)
  }

  private ownerRights(email: string, row: Row | undefined) {
    return this.ownerEmails.has(email) && row !== undefined && (row.email_verified_at != null || Number(row.email_grandfathered) === 1)
  }

  /** The e-mail was proven with a one-time code (confirmation, sign-in or reset by e-mail code). */
  markEmailVerified(accountId: string) {
    this.db.prepare('UPDATE accounts SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL').run(this.now(), accountId)
  }

  isEmailVerified(accountId: string) {
    const row = this.db.prepare('SELECT email_verified_at FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    return row?.email_verified_at != null
  }

  /** The account with this e-mail, with what the e-mail code flows need to decide (services/emailAuth.ts). */
  accountByEmail(email: string) {
    const row = this.db.prepare('SELECT id, blocked_at FROM accounts WHERE email = ?').get(email.trim().toLowerCase()) as Row | undefined
    return row ? { id: String(row.id), blocked: row.blocked_at != null } : undefined
  }

  /** Sign-in blocked by the owner (admin panel): no login, no new sessions, existing ones are refused. */
  isBlocked(accountId: string) {
    const row = this.db.prepare('SELECT blocked_at FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    return row?.blocked_at != null
  }

  /** Whether an account exists for this e-mail (the owner's app checks it before listing an owner e-mail). */
  hasAccount(email: string) {
    return this.findByEmail(email) !== undefined
  }

  /** Remembers that the account accepted the documents of `version` (registration or a payment). */
  recordConsent(accountId: string, kind: ConsentKind, version: string) {
    if (!CONSENT_VERSION.test(version)) throw new AccountError(400, 'Некорректная версия документов')
    this.mustGet(accountId)
    this.db.prepare('INSERT INTO account_consents (account_id, kind, version, accepted_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, kind, version) DO NOTHING').run(accountId, kind, version, this.now())
  }

  consents(accountId: string) {
    return (this.db.prepare('SELECT kind, version, accepted_at FROM account_consents WHERE account_id = ? ORDER BY accepted_at').all(accountId) as Row[])
      .map((row) => ({ kind: String(row.kind) as ConsentKind, version: String(row.version), acceptedAt: new Date(Number(row.accepted_at)).toISOString() }))
  }

  /**
   * Attach a streamer's code or a friend's code to an ordinary user. Allowed once (either kind); a streamer cannot refer
   * anyone to himself. A friend's code is for new players only: not one's own and not after a payment.
   */
  applyReferral(accountId: string, rawCode: string) {
    const account = this.mustGet(accountId)
    if (account.kind !== 'user') throw new AccountError(403, 'Код приглашения можно указать только в аккаунте пользователя')
    if (account.referredBy || this.invitedBy(accountId)) throw new AccountError(409, 'Код приглашения уже указан')
    const code = normalizeReferralCode(rawCode)
    if (this.activeOwnerOfCode(code)) {
      const applied = this.db.prepare('UPDATE accounts SET referred_by = ?, referred_at = ? WHERE id = ? AND referred_by IS NULL AND invited_by IS NULL').run(code, this.now(), account.id)
      if (Number(applied.changes) > 0) this.claimTrialByEmail(account.id, account.email)
      return
    }
    const inviter = this.playerOfCode(code)
    if (!inviter) throw new AccountError(404, 'Код приглашения не найден')
    if (inviter === account.id) throw new AccountError(409, 'Свой код указать нельзя')
    if (this.hasPaid(account.id)) throw new AccountError(409, 'Код друга действует только для новых игроков — до первой оплаты')
    this.db.prepare('UPDATE accounts SET invited_by = ?, invited_at = ? WHERE id = ? AND referred_by IS NULL AND invited_by IS NULL').run(inviter, this.now(), account.id)
  }

  /** The account that invited this one with a player's code («Пригласи друга»), if any. */
  invitedBy(accountId: string) {
    const row = this.db.prepare('SELECT invited_by FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    return row?.invited_by == null ? undefined : String(row.invited_by)
  }

  /** The player holding an invitation code, if the account is an ordinary, working one. */
  playerOfCode(code: string) {
    const row = this.db.prepare("SELECT id FROM accounts WHERE invite_code = ? AND kind = 'user' AND blocked_at IS NULL AND deleted_at IS NULL").get(code) as Row | undefined
    return row ? String(row.id) : undefined
  }

  /** «streamer» / «friend» for a working code, undefined otherwise (landing page `/r/<code>`). */
  codeKind(rawCode: string): 'streamer' | 'friend' | undefined {
    const code = normalizeReferralCode(rawCode)
    if (this.activeOwnerOfCode(code)) return 'streamer'
    return this.playerOfCode(code) ? 'friend' : undefined
  }

  private hasPaid(accountId: string) {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payments'").get()) return false
    return this.db.prepare("SELECT 1 FROM payments WHERE account_id = ? AND status = 'succeeded'").get(accountId) !== undefined
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
  recordReferralVisit(rawCode: string, visitorKey: string, campaign?: string) {
    const code = normalizeReferralCode(rawCode)
    if (!this.activeOwnerOfCode(code)) return this.playerOfCode(code) !== undefined
    const now = this.now()
    this.sweep(now)
    const visitor = visitorDigest(code, visitorKey)
    const seen = this.db.prepare('SELECT seen_at FROM referral_visit_seen WHERE visitor = ?').get(visitor) as Row | undefined
    if (seen && now - Number(seen.seen_at) < VISIT_DEDUPE_MS) return true
    this.db.prepare('INSERT INTO referral_visit_seen (visitor, seen_at) VALUES (?, ?) ON CONFLICT(visitor) DO UPDATE SET seen_at = excluded.seen_at').run(visitor, now)
    this.db.prepare('INSERT INTO referral_visits (code, visits) VALUES (?, 1) ON CONFLICT(code) DO UPDATE SET visits = visits + 1').run(code)
    this.db.prepare('INSERT INTO referral_visit_days (code, day, visits) VALUES (?, ?, 1) ON CONFLICT(code, day) DO UPDATE SET visits = visits + 1').run(code, statsDay(now))
    const label = normalizeCampaign(campaign)
    if (label) this.db.prepare('INSERT INTO referral_visit_campaigns (code, campaign, day, visits) VALUES (?, ?, ?, 1) ON CONFLICT(code, campaign, day) DO UPDATE SET visits = visits + 1').run(code, label, statsDay(now))
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
    const owner = this.holderOfCode(code)
    if (owner && owner !== account.id) throw new AccountError(409, `Referral code already taken: ${code}`)
    this.db.prepare("UPDATE accounts SET kind = 'streamer', referral_code = ? WHERE id = ?").run(code, account.id)
    return code
  }

  /**
   * Operator-only (admin API used by the owner's app): a one-time secret link that turns whoever opens it and signs in
   * into a streamer with `code`. Only the token's SHA-256 is stored; the link itself is shown to the owner once.
   */
  createStreamerInvite(rawCode: string) {
    const code = normalizeReferralCode(rawCode)
    if (!REFERRAL_CODE.test(code)) throw new AccountError(400, 'Код стримера: 3–24 символа, латиница, цифры, «_» или «-»')
    if (this.holderOfCode(code)) throw new AccountError(409, `Код ${code} уже занят`)
    const token = randomBytes(24).toString('base64url')
    const expiresAt = this.now() + STREAMER_INVITE_TTL_MS
    this.db.prepare('INSERT INTO streamer_invites (digest, code, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenDigest(token), code, this.now(), expiresAt)
    return { token, code, expiresAt: new Date(expiresAt).toISOString() }
  }

  /** What the invitation page shows before sign-in; undefined for unknown, used or expired links. */
  streamerInvite(token: string) {
    const row = this.db.prepare('SELECT code, expires_at, used_at FROM streamer_invites WHERE digest = ?').get(tokenDigest(token)) as Row | undefined
    if (!row || row.used_at != null || Number(row.expires_at) <= this.now()) return undefined
    return { code: String(row.code), expiresAt: new Date(Number(row.expires_at)).toISOString() }
  }

  /** The signed-in account accepts the invitation and becomes a streamer with the invited code. */
  redeemStreamerInvite(accountId: string, token: string) {
    const account = this.mustGet(accountId)
    const invite = this.streamerInvite(token)
    if (!invite) throw new AccountError(404, 'Приглашение не найдено, уже использовано или истекло')
    if (account.kind === 'streamer') throw new AccountError(409, 'Этот аккаунт уже стримерский')
    // The invitation's own reservation does not count: only another account holding the code blocks it.
    const holder = this.db.prepare('SELECT id FROM accounts WHERE referral_code = ? OR invite_code = ?').get(invite.code, invite.code) as Row | undefined
    const owner = holder ? String(holder.id) : undefined
    if (owner && owner !== account.id) throw new AccountError(409, `Код ${invite.code} уже занят`)
    this.db.prepare('UPDATE streamer_invites SET used_by = ?, used_at = ? WHERE digest = ? AND used_at IS NULL').run(account.id, this.now(), tokenDigest(token))
    this.db.prepare("UPDATE accounts SET kind = 'streamer', referral_code = ? WHERE id = ?").run(invite.code, account.id)
  }

  /** Owner's overview: every streamer with the numbers from their cabinet, plus open invitations. */
  streamers() {
    const rows = this.db.prepare("SELECT email, referral_code, created_at FROM accounts WHERE kind = 'streamer' ORDER BY created_at").all() as Row[]
    const invites = this.db.prepare('SELECT code, expires_at FROM streamer_invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(this.now()) as Row[]
    return {
      streamers: rows.map((row) => ({ email: String(row.email), code: String(row.referral_code), createdAt: new Date(Number(row.created_at)).toISOString(), stats: this.stats(String(row.referral_code)) })),
      invites: invites.map((row) => ({ code: String(row.code), expiresAt: new Date(Number(row.expires_at)).toISOString() })),
    }
  }

  /**
   * Streamer cabinet table: visits, registrations and paid subscriptions (by plan) per day (last 31 days), month (last
   * 12) or year. Newest first; periods without anything still appear for days and months so the table has no gaps.
   */
  referralSeries(accountId: string, period: StatsPeriod): ReferralSeriesRow[] {
    const account = this.mustGet(accountId)
    if (account.kind !== 'streamer' || !account.referralCode) throw new AccountError(403, 'Статистика доступна только стримерам')
    // Per period the streamer sees his earnings, not the revenue.
    return this.seriesForCode(account.referralCode, period).map(({ revenue: _revenue, ...row }) => { void _revenue; return row })
  }

  /** The streamer code of an account, or undefined when it is not (or no longer) a streamer. */
  streamerCode(accountId: string) {
    const row = this.db.prepare("SELECT referral_code FROM accounts WHERE id = ? AND kind = 'streamer'").get(accountId) as Row | undefined
    return row?.referral_code == null ? undefined : String(row.referral_code)
  }

  emailOf(accountId: string) {
    const row = this.db.prepare('SELECT email FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    return row ? String(row.email) : undefined
  }

  /** Owner's view of one streamer's table: exactly what that streamer sees in his cabinet. */
  streamerSeries(rawCode: string, period: StatsPeriod) {
    const code = normalizeReferralCode(rawCode)
    if (!this.ownerOfCode(code)) throw new AccountError(404, 'Стример не найден')
    return this.seriesForCode(code, period)
  }

  /** Visits per campaign label of the streamer's audience links, all time, most visited first. */
  referralCampaigns(accountId: string) {
    const account = this.mustGet(accountId)
    if (account.kind !== 'streamer' || !account.referralCode) throw new AccountError(403, 'Статистика доступна только стримерам')
    return this.campaignsForCode(account.referralCode)
  }

  streamerCampaigns(rawCode: string) {
    const code = normalizeReferralCode(rawCode)
    if (!this.ownerOfCode(code)) throw new AccountError(404, 'Стример не найден')
    return this.campaignsForCode(code)
  }

  private campaignsForCode(code: string) {
    const since = statsDay(this.now() - 29 * 86_400_000)
    return (this.db.prepare('SELECT campaign, SUM(visits) AS total, SUM(CASE WHEN day >= ? THEN visits ELSE 0 END) AS recent, MAX(day) AS last FROM referral_visit_campaigns WHERE code = ? GROUP BY campaign ORDER BY total DESC, campaign').all(since, code) as Row[])
      .map((row) => ({ campaign: String(row.campaign), visits: Number(row.total), visits30d: Number(row.recent), lastVisitDay: String(row.last) }))
  }

  private seriesForCode(code: string, period: StatsPeriod): ReferralSeriesRow[] {
    const length = PERIOD_LENGTH[period]
    const rows = new Map<string, ReferralSeriesRow>()
    const row = (key: string) => {
      let entry = rows.get(key)
      if (!entry) { entry = { period: key, visits: 0, registrations: 0, payments: 0, months: { '1m': 0, '3m': 0, '6m': 0, '12m': 0 }, revenue: 0, earnings: 0 }; rows.set(key, entry) }
      return entry
    }
    const today = statsDay(this.now())
    if (period === 'day') for (let i = 0; i < 31; i++) row(statsDay(this.now() - i * 86_400_000))
    if (period === 'month') for (let i = 0; i < 12; i++) { const d = new Date(`${today.slice(0, 7)}-15T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); row(d.toISOString().slice(0, 7)) }
    if (period === 'year') row(today.slice(0, 4))
    // Days and months: only the prefilled window; years: all of them.
    const cutoff = period === 'year' ? '' : [...rows.keys()].sort()[0]!
    for (const item of this.db.prepare(`SELECT substr(day, 1, ${length}) AS k, SUM(visits) AS n FROM referral_visit_days WHERE code = ? GROUP BY k`).all(code) as Row[]) row(String(item.k)).visits = Number(item.n)
    const key = periodKeySql(period)
    for (const item of this.db.prepare(`SELECT ${key('referred_at')} AS k, COUNT(*) AS n FROM accounts WHERE referred_by = ? AND referred_at IS NOT NULL GROUP BY k`).all(code) as Row[]) row(String(item.k)).registrations = Number(item.n)
    for (const item of this.subscriptions?.referralSeries(code, key) ?? []) {
      const entry = row(item.key)
      entry.payments = item.payments
      entry.revenue = item.revenue / 100
      entry.earnings = item.earnings / 100
      for (const plan of ['1m', '3m', '6m', '12m'] as const) entry.months[plan] = item.months[plan] ?? 0
    }
    return [...rows.values()].filter((entry) => entry.period >= cutoff && entry.period <= today.slice(0, length)).sort((a, b) => b.period.localeCompare(a.period))
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

  /**
   * «Удалить аккаунт» (the user's own request, password confirmed by the route). Everything personal goes: e-mail, phone,
   * password, nicknames, sessions and devices, friends, squads, game progress, settings, positions, payout details.
   * The row itself stays as an anonymous stub, because payments, autopayment records and streamer payouts refer to it and
   * are kept for accounting; the e-mail is free for a new registration at once. The owner's account cannot be deleted
   * this way, and an active autopayment must be cancelled first (cancelling needs the payment provider).
   */
  deleteAccount(accountId: string) {
    const account = this.mustGet(accountId)
    if (this.isOwner(accountId)) throw new AccountError(409, 'Аккаунт владельца удалить нельзя')
    const has = (table: string) => this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
    if (has('recurring_subscriptions') && this.db.prepare("SELECT 1 FROM recurring_subscriptions WHERE account_id = ? AND status = 'active'").get(accountId)) {
      throw new AccountError(409, 'Сначала отмените автопродление подписки в личном кабинете')
    }
    const remove: Array<[string, string]> = [
      ['sessions', 'account_id'], ['account_devices', 'account_id'], ['account_consents', 'account_id'],
      ['email_challenges', 'account_id'], ['sms_challenges', 'account_id'],
      ['friend_blocks', 'account_id'], ['friend_blocks', 'blocked_id'], ['friend_profiles', 'account_id'],
      ['friend_requests', 'from_id'], ['friend_requests', 'to_id'], ['friendships', 'account_id'], ['friendships', 'friend_id'],
      ['squads', 'owner_id'], ['squad_members', 'account_id'], ['squad_friend_invites', 'account_id'],
      ['streamer_payout_settings', 'account_id'], ['subscriptions', 'account_id'],
      ['user_collector', 'account_id'], ['user_positions', 'account_id'], ['user_settings', 'account_id'], ['eft_accounts', 'account_id'],
      ['progress_events', 'owner'], ['objective_progress', 'owner'], ['progress_scopes', 'owner'], ['quest_events', 'owner'],
    ]
    const progressOwner = `user:${account.id}`
    this.db.exec('BEGIN')
    try {
      for (const [table, column] of remove) {
        if (has(table)) this.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(column === 'owner' ? progressOwner : account.id)
      }
      // Bug reports (services/bugReportStore.ts) stay for the owner to handle, without the e-mail and the account link.
      if (has('bug_reports')) this.db.prepare('UPDATE bug_reports SET account_id = NULL, email = NULL WHERE account_id = ?').run(account.id)
      // A former streamer's code stays reserved on the stub (payments and statistics refer to it).
      this.db.prepare(`UPDATE accounts SET email = ?, salt = ?, password_hash = ?, kind = 'user', nicknames = '{}', phone = NULL, phone_verified_at = NULL,
        email_canon = NULL, email_verified_at = NULL, email_grandfathered = 0, signup_ip = NULL, referral_disabled_at = COALESCE(referral_disabled_at, ?), blocked_at = COALESCE(blocked_at, ?), deleted_at = ? WHERE id = ?`)
        .run(`deleted-${account.id}@deleted.invalid`, randomBytes(16), randomBytes(64), this.now(), this.now(), this.now(), account.id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Checks the account's current password (phone binding, password change); same scrypt cost either way. */
  async verifyPassword(accountId: string, password: string) {
    const account = this.mustGet(accountId)
    const hash = await hashPassword(String(password).slice(0, 128), account.salt)
    return timingSafeEqual(hash, account.passwordHash)
  }

  /**
   * A new password: every session of the account is revoked (a stolen session dies with the old password), and a
   * fresh session is returned for the device that made the change.
   */
  async setPassword(accountId: string, password: string) {
    this.mustGet(accountId)
    const salt = randomBytes(16)
    const passwordHash = await hashPassword(password, salt)
    this.db.prepare('UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?').run(salt, passwordHash, accountId)
    this.revokeSessions(accountId)
    return this.createSession(accountId)
  }

  /** Signs every session of the account out; returns how many there were. */
  revokeSessions(accountId: string) {
    return Number(this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId).changes)
  }

  /** Signs out one session (by its stored digest): a device that was switched off (services/entitlement.ts). */
  revokeSessionDigest(digest: string) {
    this.db.prepare('DELETE FROM sessions WHERE digest = ?').run(digest)
  }

  /** The account with this verified number (E.164), with what the phone sign-in needs to decide. */
  accountByPhone(phone: string) {
    const row = this.db.prepare('SELECT id, email, blocked_at FROM accounts WHERE phone = ?').get(phone) as Row | undefined
    if (!row) return undefined
    return { id: String(row.id), blocked: row.blocked_at != null, owner: this.ownerEmails.has(String(row.email)) }
  }

  phoneOf(accountId: string) {
    const row = this.db.prepare('SELECT phone FROM accounts WHERE id = ?').get(accountId) as Row | undefined
    return row?.phone == null ? undefined : String(row.phone)
  }

  /** Stores a verified number (null removes it). A number verified by another account is refused. */
  setPhone(accountId: string, phone: string | null) {
    this.mustGet(accountId)
    const taken = phone ? this.accountByPhone(phone) : undefined
    if (taken && taken.id !== accountId) throw new AccountError(409, 'Этот номер уже привязан к другому аккаунту')
    try {
      this.db.prepare('UPDATE accounts SET phone = ?, phone_verified_at = ? WHERE id = ?').run(phone, phone ? this.now() : null, accountId)
    } catch (error) {
      if (phone && this.accountByPhone(phone)?.id !== accountId) throw new AccountError(409, 'Этот номер уже привязан к другому аккаунту')
      throw error
    }
  }

  /** A new session for an existing account, after an approved one-time QR / device code (services/loginCodes.ts). */
  startSession(accountId: string) {
    this.mustGet(accountId)
    if (this.isBlocked(accountId)) throw new AccountError(403, BLOCKED_MESSAGE)
    return this.createSession(accountId)
  }

  private createSession(accountId: string) {
    const token = randomBytes(32).toString('base64url')
    this.sweep(this.now())
    this.db.prepare('INSERT INTO sessions (digest, account_id, expires_at) VALUES (?, ?, ?)').run(tokenDigest(token), accountId, this.now() + SESSION_TTL_MS)
    // At most MAX_SESSIONS_PER_ACCOUNT open sessions: the oldest ones end (rowid breaks ties of equal expiry).
    this.db.prepare('DELETE FROM sessions WHERE account_id = ? AND digest NOT IN (SELECT digest FROM sessions WHERE account_id = ? ORDER BY expires_at DESC, rowid DESC LIMIT ?)')
      .run(accountId, accountId, MAX_SESSIONS_PER_ACCOUNT)
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

  /** Any account holding the code, including a former streamer: the code stays reserved after the status is taken away. */
  holderOfCode(code: string) {
    const row = this.db.prepare('SELECT id FROM accounts WHERE referral_code = ? OR invite_code = ?').get(code, code) as Row | undefined
    if (row) return String(row.id)
    // A code reserved by an open streamer invitation cannot be taken as a player's code meanwhile.
    const invite = this.db.prepare('SELECT 1 FROM streamer_invites WHERE code = ? AND used_at IS NULL AND expires_at > ?').get(code, this.now())
    return invite ? 'streamer-invite' : undefined
  }

  /** The streamer behind a code whose link the owner has not switched off (registrations, visits, «Код приглашения»). */
  private activeOwnerOfCode(code: string) {
    const row = this.db.prepare("SELECT id FROM accounts WHERE referral_code = ? AND kind = 'streamer' AND referral_disabled_at IS NULL").get(code) as Row | undefined
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

  /** Like hit() but without counting: seconds until the window resets when the key is already at its limit, else 0. */
  peek(key: string) {
    const now = this.now()
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) return 0
    return entry.count >= this.max ? Math.ceil((entry.resetAt - now) / 1000) : 0
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Framework-free handlers
// ---------------------------------------------------------------------------------------------------------------

export interface AccountsRequest { body?: unknown; ip?: string; authorization?: string; query?: unknown }
export interface AccountsResponse { status: number; body: unknown; headers?: Record<string, string> }
export interface AccountsHandlerOptions {
  /** Max login/register attempts per IP per window. Default 10 per 15 minutes. */
  authRateLimit?: { max: number; windowMs: number }
  /** Failed password sign-ins per e-mail per hour, from any IP (default LOGIN_FAILURES_PER_EMAIL). */
  loginFailuresPerEmail?: number
  now?: () => number
  /**
   * E-mail codes (services/emailAuth.ts). While `enabled`, POST /register creates no account: it answers 202 with a
   * challenge and the account appears after POST /register/confirm with the code from the e-mail.
   */
  registrations?: PendingRegistrations
}

/** What registration needs from services/emailAuth.ts (kept as an interface to avoid an import cycle). */
export interface PendingRegistrations {
  readonly enabled: boolean
  startRegistration(email: string, password: string, referralCode?: string, ip?: string): Promise<{ challengeId: string; expiresAt: string; resendSeconds: number }>
}

/** The single answer to every registration while e-mail codes are on, whatever the address (anti-enumeration). */
export const REGISTRATION_PENDING_MESSAGE = 'Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.'

const emailSchema = z.string().trim().toLowerCase().max(254).email()
const passwordSchema = z.string().min(8).max(128)
const credentialsSchema = z.object({ email: emailSchema, password: passwordSchema })
const registerSchema = credentialsSchema.extend({ referralCode: z.string().trim().max(24).optional() })
const referralSchema = z.object({ code: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,24}$/) })
const inviteSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) })
const periodSchema = z.object({ period: z.enum(['day', 'month', 'year']).default('day') })
const visitSchema = z.object({ code: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,24}$/), campaign: z.string().max(64).optional() })
const consentSchema = z.object({ kind: z.enum(['registration', 'payment']), version: z.string().regex(CONSENT_VERSION) })
const ownerSeriesSchema = periodSchema.extend({ code: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,24}$/) })
const ownerInviteSchema = z.object({ code: z.string().trim().max(24) })
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) })
const nicknameValue = z.union([z.literal(''), z.null(), z.string().trim().regex(NICKNAME)])
const eftAccountSchema = z.object({ accountId: z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().regex(/^\d{3,12}$/)) })
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
  // The desktop app sends the game account once per sign-in / log scan: 30 a day is plenty, more is probing.
  const eftLimiter = new FixedWindowRateLimiter(30, 24 * 60 * 60 * 1000, options.now)
  const loginFailures = new FixedWindowRateLimiter(options.loginFailuresPerEmail ?? LOGIN_FAILURES_PER_EMAIL, 60 * 60 * 1000, options.now)
  /** The per-e-mail failure counter keeps only a digest of the (canonical) address. */
  const loginKey = (email: string) => createHash('sha256').update(`login\u0000${canonicalEmail(email)}`).digest('hex')

  const limited = (limiter: FixedWindowRateLimiter, key: string): AccountsResponse | undefined => {
    const retryAfter = limiter.hit(key)
    return retryAfter ? { status: 429, body: { error: 'Слишком много попыток. Попробуйте позже.' }, headers: { 'Retry-After': String(retryAfter) } } : undefined
  }

  const guard = async (run: () => Promise<AccountsResponse> | AccountsResponse): Promise<AccountsResponse> => {
    try {
      return await run()
    } catch (error) {
      const retryAfter = error instanceof AccountError && 'retryAfter' in error && typeof error.retryAfter === 'number' ? error.retryAfter : 0
      if (error instanceof AccountError && retryAfter) return { status: error.status, body: { error: error.message, retryAfter }, headers: { 'Retry-After': String(retryAfter) } }
      if (error instanceof AccountError) return { status: error.status, body: { error: error.message } }
      throw error
    }
  }

  const authed = (req: AccountsRequest, run: (accountId: string) => AccountsResponse) => guard(() => {
    const accountId = store.authenticate(bearer(req.authorization))
    if (!accountId) return { status: 401, body: { error: 'Требуется вход в аккаунт' } }
    return run(accountId)
  })

  const authedAsync = (req: AccountsRequest, run: (accountId: string) => Promise<AccountsResponse>) => guard(async () => {
    const accountId = store.authenticate(bearer(req.authorization))
    if (!accountId) return { status: 401, body: { error: 'Требуется вход в аккаунт' } }
    return run(accountId)
  })

  /** Owner-only routes answer 404 to everybody else, so they do not even reveal that they exist. */
  const owner = (req: AccountsRequest, run: () => AccountsResponse) => authed(req, (accountId) => (
    store.isOwner(accountId) ? run() : { status: 404, body: { error: 'Не найдено' } }
  ))

  return {
    register: (req: AccountsRequest) => guard(async () => {
      const blocked = limited(authLimiter, `auth:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = registerSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Укажите корректный e-mail и пароль от 8 до 128 символов')
      const { email, password, referralCode } = parsed.data
      const registrations = options.registrations
      if (registrations?.enabled) {
        // New, existing and owner addresses all get exactly this answer; whether a code or a notice was e-mailed (or
        // nothing at all) is never visible here. The account is created by POST /register/confirm.
        const challenge = await registrations.startRegistration(email, password, referralCode || undefined, req.ip ?? 'unknown')
        return { status: 202, body: { pending: true, message: REGISTRATION_PENDING_MESSAGE, ...challenge } }
      }
      const result = await store.register(email, password, referralCode || undefined, req.ip)
      return { status: 201, body: { token: result.token, referralApplied: result.referralApplied, account: store.view(store.authenticate(result.token)!) } }
    }),

    login: (req: AccountsRequest) => guard(async () => {
      const blocked = limited(authLimiter, `auth:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = credentialsSchema.safeParse(req.body)
      if (!parsed.success) return { status: 401, body: { error: 'Неверный e-mail или пароль' } }
      // Failed sign-ins per e-mail, whatever the IP: checked before the password, counted only on a failure.
      const key = loginKey(parsed.data.email)
      const retry = loginFailures.peek(key)
      if (retry) return { status: 429, body: { error: 'Слишком много неудачных попыток входа. Попробуйте позже или войдите по коду из письма.' }, headers: { 'Retry-After': String(retry) } }
      let token: string
      try {
        token = (await store.login(parsed.data.email, parsed.data.password)).token
      } catch (error) {
        if (error instanceof AccountError && error.status === 401) loginFailures.hit(key)
        throw error
      }
      return { status: 200, body: { token, account: store.view(store.authenticate(token)!) } }
    }),

    logout: (req: AccountsRequest) => guard(() => {
      const token = bearer(req.authorization)
      if (token) store.logout(token)
      return { status: 204, body: undefined }
    }),

    me: (req: AccountsRequest) => authed(req, (accountId) => ({ status: 200, body: store.view(accountId) })),

    /** «Выйти на всех устройствах»: every session of the account ends, this one included. */
    revokeAllSessions: (req: AccountsRequest) => authed(req, (accountId) => ({ status: 200, body: { revoked: store.revokeSessions(accountId) } })),

    /** «Сменить пароль»: needs the current one; every other session is signed out, this device gets a new one. */
    changePassword: (req: AccountsRequest) => authedAsync(req, async (accountId) => {
      const blocked = limited(authLimiter, `password:${accountId}`)
      if (blocked) return blocked
      const parsed = changePasswordSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Новый пароль: от 8 до 128 символов')
      if (!(await store.verifyPassword(accountId, parsed.data.currentPassword))) return { status: 403, body: { error: 'Текущий пароль указан неверно' } }
      const token = await store.setPassword(accountId, parsed.data.newPassword)
      return { status: 200, body: { token, account: store.view(accountId) } }
    }),

    /** «Удалить аккаунт»: needs the current password; see AccountStore.deleteAccount. */
    deleteAccount: (req: AccountsRequest) => authedAsync(req, async (accountId) => {
      const blocked = limited(authLimiter, `password:${accountId}`)
      if (blocked) return blocked
      const parsed = deleteAccountSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Введите пароль')
      if (!(await store.verifyPassword(accountId, parsed.data.password))) return { status: 403, body: { error: 'Пароль указан неверно' } }
      store.deleteAccount(accountId)
      return { status: 200, body: { deleted: true } }
    }),

    applyReferral: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = referralSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-»')
      store.applyReferral(accountId, parsed.data.code)
      return { status: 200, body: store.view(accountId) }
    }),

    /** The desktop app found the player's Escape from Tarkov AccountId in the game logs (see AccountStore.bindEftAccount). */
    bindEftAccount: (req: AccountsRequest) => authed(req, (accountId) => {
      const blocked = limited(eftLimiter, `eft:${accountId}`)
      if (blocked) return blocked
      const parsed = eftAccountSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Неверный идентификатор аккаунта Escape from Tarkov')
      try {
        return { status: 200, body: { eftAccount: store.bindEftAccount(accountId, parsed.data.accountId), account: store.view(accountId) } }
      } catch (error) {
        if (error instanceof AccountError && error.status === 409) return { status: 409, body: { error: error.message, code: 'eft-in-use' } }
        throw error
      }
    }),

    setNicknames: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = nicknamesSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Никнейм: 3–15 символов, латиница, цифры, «_» или «-»')
      store.setNicknames(accountId, parsed.data)
      return { status: 200, body: store.view(accountId) }
    }),

    referralSeries: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = periodSchema.safeParse(req.query ?? {})
      if (!parsed.success) return invalid('Период: day, month или year')
      return { status: 200, body: { period: parsed.data.period, rows: store.referralSeries(accountId, parsed.data.period) } }
    }),

    /** The secret streamer invitation page: is the link still valid, and for which code. */
    streamerInvite: (req: AccountsRequest) => guard(() => {
      const blocked = limited(visitLimiter, `invite:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = inviteSchema.safeParse(req.body)
      const invite = parsed.success ? store.streamerInvite(parsed.data.token) : undefined
      return invite ? { status: 200, body: invite } : { status: 404, body: { error: 'Приглашение не найдено, уже использовано или истекло' } }
    }),

    redeemStreamerInvite: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = inviteSchema.safeParse(req.body)
      if (!parsed.success) return { status: 404, body: { error: 'Приглашение не найдено, уже использовано или истекло' } }
      store.redeemStreamerInvite(accountId, parsed.data.token)
      return { status: 200, body: store.view(accountId) }
    }),

    referralVisit: (req: AccountsRequest) => guard(() => {
      const blocked = limited(visitLimiter, `visit:${req.ip ?? 'unknown'}`)
      if (blocked) return blocked
      const parsed = visitSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Некорректный код приглашения')
      // An unusable campaign label is ignored: the visit itself still counts.
      const known = store.recordReferralVisit(parsed.data.code, req.ip ?? 'unknown', parsed.data.campaign)
      return known ? { status: 200, body: { ok: true, code: normalizeReferralCode(parsed.data.code), kind: store.codeKind(parsed.data.code) } } : { status: 404, body: { error: 'Код приглашения не найден' } }
    }),

    /** Streamer cabinet: visits per campaign label of the audience links. */
    referralCampaigns: (req: AccountsRequest) => authed(req, (accountId) => ({ status: 200, body: { campaigns: store.referralCampaigns(accountId) } })),

    /** The signed-in user accepted the offer / privacy documents of `version` (checkbox on the site). */
    recordConsent: (req: AccountsRequest) => authed(req, (accountId) => {
      const parsed = consentSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Некорректные данные согласия')
      store.recordConsent(accountId, parsed.data.kind, parsed.data.version)
      return { status: 200, body: { consents: store.consents(accountId) } }
    }),

    /** Owner section of the website: every streamer with the numbers from his cabinet, plus open invitations. */
    ownerStreamers: (req: AccountsRequest) => owner(req, () => ({ status: 200, body: store.streamers() })),

    ownerStreamerStats: (req: AccountsRequest) => owner(req, () => {
      const parsed = ownerSeriesSchema.safeParse(req.query ?? {})
      if (!parsed.success) return invalid('Укажите код стримера и период: day, month или year')
      return { status: 200, body: { code: normalizeReferralCode(parsed.data.code), period: parsed.data.period, rows: store.streamerSeries(parsed.data.code, parsed.data.period), campaigns: store.streamerCampaigns(parsed.data.code) } }
    }),

    /** «Сгенерировать ссылку для стримера»: a one-time secret link /streamer/<token>; the token is shown once. */
    ownerCreateStreamerInvite: (req: AccountsRequest) => owner(req, () => {
      const parsed = ownerInviteSchema.safeParse(req.body)
      if (!parsed.success) return invalid('Код стримера: 3–24 символа, латиница, цифры, «_» или «-»')
      return { status: 201, body: store.createStreamerInvite(parsed.data.code) }
    }),
  }
}

export type AccountsHandlers = ReturnType<typeof createAccountsHandlers>
