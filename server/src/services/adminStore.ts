/**
 * The owner's admin panel on the website («Админ-панель», routes/ownerAdmin.ts): statistics, payments, users, streamer
 * settings, sales settings and the owner's audit log. Read-mostly SQL over the one shared SQLite database (accounts,
 * payments, payouts), so the accounts store and the payment store MUST share the database handle (index.ts does).
 *
 * New tables are created with IF NOT EXISTS and never change existing ones, so the panel is safe on the live database:
 *   owner_audit_log            — who (owner e-mail) did what, when, to which account / streamer;
 *   owner_subscription_grants  — manual «выдать / продлить подписку на N дней» with the reason.
 *
 * Nothing here returns password hashes, salts or session tokens. Money is in roubles in every view (kopecks inside);
 * an archived payment (paymentStore.ts) counts with the rouble amount stored when it was paid and also shows what was
 * paid in its own currency.
 */
import type { DatabaseSync } from 'node:sqlite'
import { CIS_COUNTRIES, EUROPE_COUNTRIES, regionOf, type CountryRegion } from '../../../src/shared/countries'
import { CIS_PAYMENT_COUNTRIES, paymentRegionOf, type PaymentRegion } from '../../../src/shared/paymentRegions'
import { AccountError, ACCOUNT_MODES, periodKeySql, REFERRAL_TRIAL_MS, storedNickname, WELCOME_TRIAL_MS, type AccountStore, type StatsPeriod } from './accountStore.js'
import { transaction } from './database.js'
import { LIFETIME_UNTIL } from './invites.js'
import { paidInOtherCurrency, PaymentError, PLAN_MONTHS, providerOf, type PaymentProvider, type PaymentStore, type PlanId } from './paymentStore.js'
import { OnlineStatsStore } from './onlineStatsStore.js'

type Row = Record<string, unknown>
const DAY_MS = 24 * 60 * 60 * 1000
/** Statistics days follow Moscow time (UTC+3, no daylight saving), as in the streamer tables. */
const MSK_MS = 3 * 60 * 60 * 1000
const PLAN_IDS = Object.keys(PLAN_MONTHS) as PlanId[]
const PERIOD_LENGTH: Record<StatsPeriod, number> = { day: 10, month: 7, year: 4 }
/** GET /me/admin/stats without `from`: this many Moscow days up to and including `to` (default today). */
const STATS_DEFAULT_DAYS = 30

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS owner_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    details TEXT);
  CREATE INDEX IF NOT EXISTS owner_audit_log_at ON owner_audit_log(at);
  CREATE TABLE IF NOT EXISTS owner_subscription_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    days INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    at INTEGER NOT NULL,
    paid_until_before INTEGER,
    paid_until_after INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS owner_subscription_grants_account ON owner_subscription_grants(account_id, at);
`

export type AuditAction =
  | 'subscription.grant' | 'subscription.revoke' | 'autopay.cancel' | 'account.block' | 'account.unblock' | 'sessions.revoke'
  | 'streamer.percent' | 'streamer.link' | 'streamer.revoke' | 'streamer.invite' | 'payout.decide' | 'payout.limits' | 'payments.export' | 'device.revoke'
  | 'server.update-check' | 'server.update-install' | 'server.rollback' | 'server.download-link'
  | 'payments.yookassa-settings'
  | 'payment.refund' | 'payment.amount' | 'payment.boosty-confirm' | 'payment.bezebee-confirm' | 'payment.bezebee-attach' | 'bezebee.dismiss' | 'bezebee.credentials' | 'boosty.session' | 'map.boss-place' | 'map.boss-remove' | 'map.quest-point' | 'map.quest-point-photo' | 'invite.decide' | 'bug.status' | 'bug.reward' | 'bug.mail'
  | 'eft.unbind' | 'account.delete' | 'account.email' | 'map.quest-text' | 'map.quest-requirement' | 'map.event-quest' | 'overview.blocks' | 'announcement.set' | 'features.minimap' | 'features.minimapOverlay' | 'support.reply' | 'support.resolve'
  | 'requests-key.create' | 'requests-key.revoke'
  | 'notice.send' | 'notice.withdraw' | 'survey.publish' | 'survey.export' | 'support.start'
  | 'users.export' | 'subscription.bulk-grant'

export interface AuditEntry { id: number; at: string; actor: string; action: AuditAction; target?: string; details?: Record<string, unknown> }

export type UserFilter = 'all' | 'active' | 'trial' | 'inactive' | 'streamers' | 'blocked'
/** The billing regions requested by the owner; the old Europe/other values stay accepted by older web clients. */
export type RegionFilter = 'all' | 'russia' | 'cis' | 'world' | 'europe' | 'other' | 'none'
/** Users per region tab, within the search and the status filter. */
export type RegionCounts = Record<RegionFilter, number>
export interface PaymentFilter {
  from?: string
  to?: string
  status?: 'pending' | 'succeeded' | 'canceled' | 'refunded'
  plan?: PlanId
  q?: string
  provider?: PaymentProvider
  /** The stored method (paymentStore.ts `method`), or 'unknown' / 'archive' for payments without one (METHOD_SQL). */
  method?: string
  /** The payer's payment region now (the account's country; a deleted account has none). */
  region?: PayRegion
  /** Which date `from` / `to` apply to: 'created' (default) or 'paid' (paid_at, else created_at — as the statistics). */
  dateField?: 'created' | 'paid'
}

/** The payment region of an account (src/shared/paymentRegions.ts), 'none' without a country. */
export type PayRegion = PaymentRegion | 'none'
export const PAY_REGIONS: readonly PayRegion[] = ['RU', 'CIS', 'WORLD', 'none']
/**
 * What the running access of an account rests on: 'money' — a paid period of an account that has paid (a succeeded
 * payment, any provider), 'grant' — days given by the owner (manual grants, bug report rewards) to an account that never
 * paid, 'friend' — the same with a granted «Пригласи друга» reward, 'lifetime' — a streamer or rank Legend, 'trial' — the
 * free period. Absent without access.
 */
export type SubscriptionSource = 'money' | 'grant' | 'friend' | 'lifetime' | 'trial'
export type UserSort = 'created' | 'paidUntil' | 'lastSeen' | 'payments'
/** «Пользователи» filters (GET /me/admin/users, users.csv, bulk grant): every field narrows the list. */
export interface UserQuery {
  q?: string
  filter?: UserFilter
  region?: RegionFilter
  /** ISO 3166-1 alpha-2 (or «XX», typed by hand). */
  country?: string
  payRegion?: PayRegion
  /** 'yes': at least one succeeded payment ever; 'no': none. */
  payer?: 'yes' | 'no'
  /** A running paid / granted period that ends on or before this Moscow day. */
  expiresBefore?: string
  registeredFrom?: string
  registeredTo?: string
  /** Last authenticated request on or after this Moscow day. */
  seenSince?: string
  /** 'yes': an active autopayment; 'no': none. */
  autopay?: 'yes' | 'no'
  sort?: UserSort
  order?: 'asc' | 'desc'
}
export const BULK_GRANT_MAX = 500
/** The bulk grant refused: more accounts than BULK_GRANT_MAX match. */
export class BulkGrantLimitError extends AccountError {
  constructor(readonly affected: number) {
    super(400, `Под условия попадает ${affected} пользователей, за раз можно не больше ${BULK_GRANT_MAX}`)
  }
}

export interface AdminUser {
  id: string
  email: string
  kind: 'user' | 'streamer'
  owner?: true
  createdAt: string
  referredBy?: string
  referralCode?: string
  /** trialPendingDays: the free period waits for the first sign-in in an app (AccountStore.claimTrialDevice). */
  subscription: { status: 'active' | 'trial' | 'inactive'; paidUntil?: string; trialEndsAt?: string; lifetime?: true; trialPendingDays?: number }
  autopay: { provider: string; status: string; plan: string } | null
  /** The last authenticated request from anywhere (the site, the phone or the PC app). */
  lastSeenAt?: string
  /** The last use of the account in the PC app (owner, 12.10.2026: «крайнее время входа в аккаунт на пк»). */
  pcSeenAt?: string
  blockedAt?: string
  payments: { count: number; total: number }
  /** The bound Escape from Tarkov account, masked (one game account — one Raid OS account, owner 13.10.2026). */
  eftAccount?: { masked: string; boundAt: string }
  /** The country named at registration (ISO 3166-1 alpha-2); absent for accounts from before 13.10.2026 that did not set it. */
  country?: string
  /** «XX»: the country the player typed by hand in «Укажите страну» (counted in «Другие»). */
  countryOther?: string
  /** The Escape from Tarkov nickname the PC app found in the game logs (one for every mode); absent until it is found. */
  nickname?: string
  /**
   * «Пригласи друга» (owner, 14.10.2026: «нужно что бы было видно от кого пришел человек по скидке»): the player whose code
   * this account used (accounts.invited_by), with the inviter's e-mail and game nickname — or `deleted` when that account
   * was deleted since (its e-mail is gone). `discount`: the friend's discount on the first month (services/invites.ts) —
   * 'used' (a payment with it went through, refunded or not), 'unused' (nothing paid yet: still available), 'lost' (the
   * first payment was made without it, e.g. a longer plan, so it is no longer offered). A streamer's code stays in
   * `referredBy`.
   */
  invitedBy?: InviterView
  /** The payment region from the country (RU / CIS / WORLD), 'none' without one. */
  payRegion: PayRegion
  /** What the running access rests on (SubscriptionSource); absent without access. */
  source?: SubscriptionSource
}

/** The inviter of a friend-invited account (owner only). */
export interface InviterView {
  id: string
  email?: string
  nickname?: string
  deleted?: true
  discount?: 'used' | 'unused' | 'lost'
}

export interface AdminPayment {
  id: string
  /** The payer: account, e-mail and the game nickname the PC app found. */
  accountId: string
  email: string
  nickname?: string
  plan: PlanId
  provider: PaymentProvider
  status: 'pending' | 'succeeded' | 'canceled' | 'refunded'
  /** Roubles (an archived payment: the rouble amount stored when it was paid). */
  amount: number
  /** What an archived payment was paid in, when that was not roubles. */
  original?: { amount: number; currency: string }
  createdAt: string
  paidAt?: string
  renewal?: true
  referralCode?: string
  streamerEarning?: number
  /** Paid with the friend's discount (services/invites.ts): its percent and who invited the payer (a deleted inviter: no e-mail). */
  friendDiscount?: { percent: number; inviter?: string; inviterDeleted?: true }
  /** Who invited the payer with a friend link (accounts.invited_by), with or without the discount on this payment. */
  invitedBy?: InviterView
  /** The owner changed the amount by hand («Изменить сумму»): the amount before the first change, roubles, and when. */
  amountEdited?: { before: number; at: string }
  /** What was left after the commission, roubles (the owner's second sum on «Подтвердить оплату Boosty»). */
  netAmount?: number
  /** How it was paid (METHOD_SQL): sbp, sberbank, tinkoff_bank, bank_card, …, boosty; 'unknown' before it was stored, 'archive'. */
  method: string
}

const rub = (kopecks: unknown) => Math.round(Number(kopecks ?? 0)) / 100
const iso = (ms: unknown) => (ms == null ? undefined : new Date(Number(ms)).toISOString())
/** Start of the Moscow day that contains `time`. */
const mskDayStart = (time: number) => Math.floor((time + MSK_MS) / DAY_MS) * DAY_MS - MSK_MS
const mskKey = (time: number) => new Date(time + MSK_MS).toISOString().slice(0, 10)
/** 2026-10-01 (Moscow) → [start, end) in ms. */
function mskDayRange(day: string) {
  const start = Date.parse(`${day}T00:00:00.000Z`) - MSK_MS
  return { start, end: start + DAY_MS }
}
/** A LIKE pattern that matches `text` literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
/** «Способ» in the CSV: ЮKassa, Boosty, or «Архив» for a payment service that is no longer connected. */
const PROVIDER_NAME: Record<PaymentProvider, string> = { yookassa: 'ЮKassa', boosty: 'Boosty', bezebee: 'BZB', archive: 'Архив' }
const placeholders = (codes: readonly string[]) => codes.map(() => '?').join(', ')
/** FROM of «Пользователи»: see AdminStore.userSelect. */
const USER_FROM = 'FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id LEFT JOIN eft_accounts e ON e.account_id = a.id LEFT JOIN accounts i ON i.id = a.invited_by'
/**
 * The inviter in a row joined as `i` (inviter_email, inviter_nicknames, inviter_deleted_at): a deleted account keeps only
 * an anonymous stub (AccountStore.deleteAccount), so it shows as deleted, without the stub's e-mail.
 */
function inviterOf(row: Row): InviterView {
  const id = String(row.invited_by)
  if (row.inviter_email == null || row.inviter_deleted_at != null) return { id, deleted: true }
  const nickname = row.inviter_nicknames === undefined ? undefined : storedNickname(row.inviter_nicknames)
  return { id, email: String(row.inviter_email), ...(nickname ? { nickname } : {}) }
}
/**
 * Payments with the payer's e-mail and, for a payment with the friend's discount, the inviter (one LEFT JOIN on
 * accounts.invited_by, see toPayment). Followed by WHERE / ORDER BY.
 */
/** The payment's provider as stored: NULL is ЮKassa (providerOf). */
const PROVIDER_SQL = "CASE WHEN p.provider IS NULL OR p.provider = 'yookassa' THEN 'yookassa' WHEN p.provider = 'boosty' THEN 'boosty' WHEN p.provider = 'bezebee' THEN 'bezebee' ELSE 'archive' END"
/**
 * How a payment was paid: the stored `method`, else 'boosty' for Boosty, 'unknown' for a ЮKassa payment from before the
 * column, 'archive' for the removed provider.
 */
const METHOD_SQL = `COALESCE(p.method, CASE WHEN p.provider = 'boosty' THEN 'boosty' WHEN p.provider = 'bezebee' THEN 'bezebee' WHEN p.provider IS NULL OR p.provider = 'yookassa' THEN 'unknown' ELSE 'archive' END)`
const PAYMENT_SELECT = `SELECT p.*, ${METHOD_SQL} AS method_view, a.email AS email, a.nicknames AS payer_nicknames, a.invited_by AS invited_by, i.email AS inviter_email, i.nicknames AS inviter_nicknames, i.deleted_at AS inviter_deleted_at FROM payments p JOIN accounts a ON a.id = p.account_id LEFT JOIN accounts i ON i.id = a.invited_by`

/** The filters of a UserQuery that narrow anything (for the audit log): no defaults, no sort. */
export function userQueryDetails(query: UserQuery): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter(([key, value]) => value !== undefined && value !== '' && key !== 'sort' && key !== 'order'
    && !((key === 'filter' || key === 'region') && value === 'all'))) as Record<string, string>
}

/** The moment a payment counts for revenue: paid, else created (the statistics and `dateField=paid`). */
const PAID_SQL = 'COALESCE(p.paid_at, p.created_at)'

/** Accounts (joined as `a`) of a payment region: RU, CIS without Russia, WORLD (every other country, «XX» too), none. */
function payRegionCondition(region: PayRegion): { sql: string; args: string[] } {
  if (region === 'none') return { sql: 'a.country IS NULL', args: [] }
  if (region === 'RU') return { sql: "a.country = 'RU'", args: [] }
  if (region === 'CIS') return { sql: `a.country IN (${placeholders(CIS_PAYMENT_COUNTRIES)})`, args: [...CIS_PAYMENT_COUNTRIES] }
  // WORLD: every country that is neither Russia nor of the CIS price (paymentRegionOf).
  const cisPrice = ['RU', ...CIS_PAYMENT_COUNTRIES]
  return { sql: `a.country IS NOT NULL AND a.country NOT IN (${placeholders(cisPrice)})`, args: cisPrice }
}
const payRegionOf = (country: unknown): PayRegion => paymentRegionOf(country == null ? undefined : String(country)) ?? 'none'

/**
 * SubscriptionSource of an account row (kind, paid_until, trial_ends_at, trial_denied, paid_count, friend_reward) at `now`.
 */
function sourceOf(row: Row, now: number): SubscriptionSource | undefined {
  if (row.kind === 'streamer') return 'lifetime'
  const paidUntil = row.paid_until == null ? undefined : Number(row.paid_until)
  if (paidUntil !== undefined && paidUntil > now) {
    if (paidUntil >= LIFETIME_UNTIL) return 'lifetime'
    if (Number(row.paid_count ?? 0) > 0) return 'money'
    return Number(row.friend_reward ?? 0) ? 'friend' : 'grant'
  }
  if (row.trial_ends_at != null && !Number(row.trial_denied ?? 0) && Number(row.trial_ends_at) > now) return 'trial'
  return undefined
}

/**
 * The condition of a region tab of «Пользователи» (owner, 13.10.2026: «в разделе пользователи, разделение снг и Европа»).
 * The lists are those of src/shared/countries.ts; «Другие» is every other country, «Не указана» an account without one.
 */
function regionCondition(region: Exclude<RegionFilter, 'all'>): { sql: string; args: string[] } {
  if (region === 'none') return { sql: 'a.country IS NULL', args: [] }
  if (region === 'russia') return { sql: "a.country = 'RU'", args: [] }
  if (region === 'cis') {
    const cis = CIS_COUNTRIES.filter((code) => code !== 'RU')
    return { sql: `a.country IN (${placeholders(cis)})`, args: [...cis] }
  }
  if (region === 'world') return { sql: `a.country IS NOT NULL AND a.country NOT IN (${placeholders(CIS_COUNTRIES)})`, args: [...CIS_COUNTRIES] }
  if (region === 'europe') return { sql: `a.country IN (${placeholders(EUROPE_COUNTRIES)})`, args: [...EUROPE_COUNTRIES] }
  const listed = [...CIS_COUNTRIES, ...EUROPE_COUNTRIES]
  return { sql: `a.country IS NOT NULL AND a.country NOT IN (${placeholders(listed)})`, args: listed }
}

export class AdminStore {
  private readonly db: DatabaseSync
  private readonly accounts: AccountStore
  private readonly payments: PaymentStore
  private readonly now: () => number
  private readonly online: OnlineStatsStore

  constructor(accounts: AccountStore, payments: PaymentStore, options: { now?: () => number } = {}) {
    this.accounts = accounts
    this.payments = payments
    this.db = accounts.database
    this.now = options.now ?? accounts.clock
    if (payments.database !== this.db) throw new Error('AdminStore: accounts and payments must share one database')
    this.db.exec(SCHEMA)
    this.online = new OnlineStatsStore(this.db, { now: this.now })
  }

  // ------------------------------------------------------------------------------------------------------------
  // Audit log
  // ------------------------------------------------------------------------------------------------------------

  audit(actor: string, action: AuditAction, target?: string, details?: Record<string, unknown>) {
    this.db.prepare('INSERT INTO owner_audit_log (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)')
      .run(this.now(), actor, action, target ?? null, details && Object.keys(details).length ? JSON.stringify(details).slice(0, 2000) : null)
  }

  auditLog(limit: number, offset: number): { entries: AuditEntry[]; total: number } {
    const total = Number((this.db.prepare('SELECT COUNT(*) AS n FROM owner_audit_log').get() as Row).n)
    const rows = this.db.prepare('SELECT * FROM owner_audit_log ORDER BY at DESC, id DESC LIMIT ? OFFSET ?').all(limit, offset) as Row[]
    return {
      total,
      entries: rows.map((row) => {
        let details: Record<string, unknown> | undefined
        try { details = row.details == null ? undefined : JSON.parse(String(row.details)) as Record<string, unknown> } catch { details = undefined }
        return { id: Number(row.id), at: iso(row.at)!, actor: String(row.actor), action: String(row.action) as AuditAction, ...(row.target == null ? {} : { target: String(row.target) }), ...(details ? { details } : {}) }
      }),
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Summary and series
  // ------------------------------------------------------------------------------------------------------------

  overview() {
    const now = this.now()
    const today = mskDayStart(now)
    const monthKey = mskKey(now).slice(0, 7)
    const monthStart = Date.parse(`${monthKey}-01T00:00:00.000Z`) - MSK_MS
    const count = (sql: string, ...args: Array<string | number>) => Number((this.db.prepare(sql).get(...args) as Row).n)
    const users = {
      // Deleted accounts (anonymous stubs kept for the payments) are not users: never counted as registrations.
      total: count('SELECT COUNT(*) AS n FROM accounts WHERE deleted_at IS NULL'),
      today: count('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ? AND deleted_at IS NULL', today),
      days7: count('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ? AND deleted_at IS NULL', now - 7 * DAY_MS),
      days30: count('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ? AND deleted_at IS NULL', now - 30 * DAY_MS),
      blocked: count('SELECT COUNT(*) AS n FROM accounts WHERE blocked_at IS NOT NULL AND deleted_at IS NULL'),
    }
    const subscriptions = {
      // Only those who really paid (owner, 20.10.2026): a paid period now and a succeeded payment with money in it —
      // granted days, trials, streamers and the «Легенда» rank are not paid subscriptions.
      active: count(`SELECT COUNT(*) AS n FROM subscriptions s JOIN accounts a ON a.id = s.account_id WHERE a.kind = 'user' AND a.deleted_at IS NULL AND s.paid_until > ?
        AND EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded' AND p.amount > 0)`, now),
      trials: count("SELECT COUNT(*) AS n FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id WHERE a.kind = 'user' AND a.deleted_at IS NULL AND COALESCE(a.trial_denied, 0) = 0 AND a.trial_ends_at > ? AND (s.paid_until IS NULL OR s.paid_until <= ?)", now, now),
      autopay: count("SELECT COUNT(*) AS n FROM recurring_subscriptions WHERE status = 'active'"),
      streamers: count("SELECT COUNT(*) AS n FROM accounts WHERE kind = 'streamer'"),
    }
    // Every succeeded payment by its stored rouble amount: ЮKassa and the archived ones alike.
    const revenueSince = (since: number) => {
      const row = this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ?").get(since) as Row
      return { total: rub(row.total), payments: Number(row.n) }
    }
    const payouts = this.tableExists('streamer_payouts')
      ? this.db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending, COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS open FROM streamer_payouts").get() as Row
      : { paid: 0, pending: 0, open: 0 }
    const earned = Number((this.db.prepare("SELECT COALESCE(SUM(streamer_earning), 0) AS n FROM payments WHERE status = 'succeeded'").get() as Row).n)
    // «Подписки по срокам» (owner, 20.10.2026): paid payments of each plan, this month and all the time.
    const plansSince = (since: number) => {
      const plans = Object.fromEntries(PLAN_IDS.map((id) => [id, { count: 0, revenue: 0 }])) as Record<PlanId, { count: number; revenue: number }>
      for (const item of this.db.prepare("SELECT plan, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'succeeded' AND paid_at >= ? GROUP BY plan").all(since) as Row[]) {
        const plan = String(item.plan) as PlanId
        if (plans[plan]) plans[plan] = { count: Number(item.n), revenue: rub(item.total) }
      }
      return plans
    }
    return {
      generatedAt: new Date(now).toISOString(),
      users,
      subscriptions,
      revenue: { today: revenueSince(today), month: revenueSince(monthStart), all: revenueSince(0) },
      plans: { month: plansSince(monthStart), all: plansSince(0) },
      squads: this.squadStats(now),
      payouts: { paid: rub(payouts.paid), pending: rub(payouts.pending), pendingRequests: Number(payouts.open), earned: rub(earned) },
    }
  }

  /**
   * «Отряды» (owner, 20.10.2026: «сколько создано отрядов вообще, сколько расформировано, сколько сейчас и сколько человек
   * в них играет»): created since squad_log exists (services/squadStore.ts; the squads of that moment counted in),
   * disbanded = created and gone since.
   */
  private squadStats(now: number) {
    if (!this.tableExists('squads') || !this.tableExists('squad_members')) return { created: 0, disbanded: 0, active: 0, players: 0, created30: 0, since: null }
    const count = (sql: string, ...args: number[]) => Number((this.db.prepare(sql).get(...args) as Row).n)
    const active = count('SELECT COUNT(*) AS n FROM squads')
    const players = count('SELECT COUNT(*) AS n FROM squad_members')
    if (!this.tableExists('squad_log')) return { created: active, disbanded: 0, active, players, created30: 0, since: null }
    const created = count('SELECT COUNT(*) AS n FROM squad_log')
    const first = (this.db.prepare('SELECT MIN(created_at) AS at FROM squad_log').get() as Row).at
    return {
      created, disbanded: Math.max(0, created - active), active, players,
      created30: count('SELECT COUNT(*) AS n FROM squad_log WHERE created_at >= ?', now - 30 * DAY_MS),
      since: first == null ? null : new Date(Number(first)).toISOString(),
    }
  }

  onlineStats(days = 30) {
    return this.online.summary(days)
  }

  /** Registrations and payments per Moscow day (last 31), month (last 12) or year (all), newest first. */
  series(period: StatsPeriod) {
    const now = this.now()
    const length = PERIOD_LENGTH[period]
    type SeriesRow = { period: string; registrations: number; payments: number; revenue: number; plans: Record<PlanId, { count: number; revenue: number }> }
    const rows = new Map<string, SeriesRow>()
    const row = (key: string) => {
      let entry = rows.get(key)
      if (!entry) {
        entry = { period: key, registrations: 0, payments: 0, revenue: 0, plans: Object.fromEntries(PLAN_IDS.map((id) => [id, { count: 0, revenue: 0 }])) as SeriesRow['plans'] }
        rows.set(key, entry)
      }
      return entry
    }
    const today = mskKey(now)
    if (period === 'day') for (let i = 0; i < 31; i++) row(mskKey(now - i * DAY_MS))
    if (period === 'month') for (let i = 0; i < 12; i++) { const date = new Date(`${today.slice(0, 7)}-15T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - i); row(date.toISOString().slice(0, 7)) }
    if (period === 'year') row(today.slice(0, 4))
    const cutoff = period === 'year' ? '' : [...rows.keys()].sort()[0]!
    const key = periodKeySql(period)
    for (const item of this.db.prepare(`SELECT ${key('created_at')} AS k, COUNT(*) AS n FROM accounts WHERE deleted_at IS NULL GROUP BY k`).all() as Row[]) {
      if (String(item.k) >= cutoff) row(String(item.k)).registrations = Number(item.n)
    }
    for (const item of this.db.prepare(`SELECT ${key('paid_at')} AS k, plan, COUNT(*) AS n, SUM(amount) AS total FROM payments WHERE status = 'succeeded' AND paid_at IS NOT NULL GROUP BY k, plan`).all() as Row[]) {
      if (String(item.k) < cutoff) continue
      const entry = row(String(item.k))
      const total = rub(item.total)
      entry.payments += Number(item.n)
      entry.revenue = Math.round((entry.revenue + total) * 100) / 100
      const plan = entry.plans[String(item.plan) as PlanId]
      if (plan) { plan.count += Number(item.n); plan.revenue = Math.round((plan.revenue + total) * 100) / 100 }
    }
    return [...rows.values()].filter((entry) => entry.period >= cutoff && entry.period <= today.slice(0, length)).sort((a, b) => b.period.localeCompare(a.period))
  }

  /**
   * «Календарь» in «Сводка»: every Moscow day of `month` (YYYY-MM) with registrations, succeeded payments and revenue
   * (also per plan). Days after today are included with zeros.
   */
  calendar(month: string) {
    const first = Date.parse(`${month}-01T00:00:00.000Z`)
    const next = new Date(first)
    next.setUTCMonth(next.getUTCMonth() + 1)
    const daysInMonth = Math.round((next.getTime() - first) / DAY_MS)
    const start = first - MSK_MS
    const end = next.getTime() - MSK_MS
    type Day = { date: string; registrations: number; payments: number; revenue: number; plans: Record<PlanId, { count: number; revenue: number }> }
    const days: Day[] = Array.from({ length: daysInMonth }, (_, index) => ({
      date: `${month}-${String(index + 1).padStart(2, '0')}`, registrations: 0, payments: 0, revenue: 0,
      plans: Object.fromEntries(PLAN_IDS.map((id) => [id, { count: 0, revenue: 0 }])) as Day['plans'],
    }))
    const byDate = new Map(days.map((day) => [day.date, day]))
    const key = periodKeySql('day')
    for (const item of this.db.prepare(`SELECT ${key('created_at')} AS k, COUNT(*) AS n FROM accounts WHERE created_at >= ? AND created_at < ? AND deleted_at IS NULL GROUP BY k`).all(start, end) as Row[]) {
      const day = byDate.get(String(item.k))
      if (day) day.registrations = Number(item.n)
    }
    for (const item of this.db.prepare(`SELECT ${key('paid_at')} AS k, plan, COUNT(*) AS n, SUM(amount) AS total FROM payments WHERE status = 'succeeded' AND paid_at >= ? AND paid_at < ? GROUP BY k, plan`).all(start, end) as Row[]) {
      const day = byDate.get(String(item.k))
      if (!day) continue
      const total = rub(item.total)
      day.payments += Number(item.n)
      day.revenue = Math.round((day.revenue + total) * 100) / 100
      const plan = day.plans[String(item.plan) as PlanId]
      if (plan) { plan.count += Number(item.n); plan.revenue = Math.round((plan.revenue + total) * 100) / 100 }
    }
    return { month, today: mskKey(this.now()), days }
  }

  /**
   * The window that opens on a calendar day (YYYY-MM-DD, Moscow): who registered, every payment started or paid that day,
   * the owner's manual grants and «Пригласи друга» rewards. Lists are capped (registrations 200, payments 500).
   */
  day(date: string) {
    const { start, end } = mskDayRange(date)
    const summary = this.calendar(date.slice(0, 7)).days.find((day) => day.date === date)!
    const hasInvites = this.tableExists('invite_rewards')
    // The inviter of a friend-invited registration by one LEFT JOIN (owner, 14.10.2026: the e-mail instead of a bare flag).
    const invitedBy = hasInvites || this.hasColumn('accounts', 'invited_by')
    const registrations = (this.db.prepare(`SELECT a.id, a.email, a.kind, a.created_at, a.referred_by, ${invitedBy ? 'a.invited_by, i.email AS inviter_email, i.deleted_at AS inviter_deleted_at' : 'NULL AS invited_by'}
      FROM accounts a ${invitedBy ? 'LEFT JOIN accounts i ON i.id = a.invited_by' : ''} WHERE a.created_at >= ? AND a.created_at < ? AND a.deleted_at IS NULL ORDER BY a.created_at, a.rowid LIMIT 200`).all(start, end) as Row[])
      .map((row) => ({
        id: String(row.id), email: String(row.email), kind: row.kind === 'streamer' ? 'streamer' as const : 'user' as const, createdAt: iso(row.created_at)!,
        ...(row.referred_by == null ? {} : { referredBy: String(row.referred_by) }),
        ...(row.invited_by == null ? {} : { invitedByFriend: true as const, invitedBy: inviterOf(row) }),
      }))
    const payments = (this.db.prepare(`${PAYMENT_SELECT} WHERE (p.created_at >= ? AND p.created_at < ?) OR (p.paid_at >= ? AND p.paid_at < ?) ORDER BY p.created_at, p.rowid LIMIT 500`).all(start, end, start, end) as Row[]).map(toPayment)
    const earned = Number((this.db.prepare("SELECT COALESCE(SUM(streamer_earning), 0) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ? AND paid_at < ?").get(start, end) as Row).n)
    const grants = (this.db.prepare('SELECT g.*, a.email AS email FROM owner_subscription_grants g JOIN accounts a ON a.id = g.account_id WHERE g.at >= ? AND g.at < ? ORDER BY g.at, g.id').all(start, end) as Row[])
      .map((row) => ({ email: String(row.email), days: Number(row.days), reason: String(row.reason), actor: String(row.actor), at: iso(row.at)! }))
    const invites = hasInvites
      // Both sides of a friend reward with their game nicknames (owner, 17.10.2026: who invited whom, plainly).
      ? (this.db.prepare(`SELECT r.kind, r.days, r.status, r.created_at, r.decided_at, r.comment, i.email AS inviter, i.nicknames AS inviter_nicknames,
          f.email AS friend, f.nicknames AS friend_nicknames, f.deleted_at AS friend_deleted_at
          FROM invite_rewards r JOIN accounts i ON i.id = r.inviter_id LEFT JOIN accounts f ON f.id = r.friend_id
          WHERE (r.created_at >= ? AND r.created_at < ?) OR (r.decided_at >= ? AND r.decided_at < ?) ORDER BY r.created_at, r.id LIMIT 200`).all(start, end, start, end) as Row[])
        .map((row) => {
          const inviterNickname = storedNickname(row.inviter_nicknames)
          const friendNickname = row.friend_deleted_at == null ? storedNickname(row.friend_nicknames) : undefined
          return {
            inviter: String(row.inviter), ...(inviterNickname ? { inviterNickname } : {}),
            ...(row.friend == null ? {} : row.friend_deleted_at != null ? { friendDeleted: true as const } : { friend: String(row.friend) }),
            ...(friendNickname ? { friendNickname } : {}),
            kind: String(row.kind), days: row.kind === 'legend' ? 'lifetime' as const : Number(row.days), status: String(row.status), createdAt: iso(row.created_at)!,
            ...(row.decided_at == null ? {} : { decidedAt: iso(row.decided_at) }),
            ...(row.comment == null ? {} : { comment: String(row.comment) }),
          }
        })
      : []
    return {
      date,
      totals: { registrations: summary.registrations, payments: summary.payments, revenue: summary.revenue, streamerEarnings: rub(earned), plans: summary.plans },
      registrations, payments, grants, invites,
    }
  }

  /**
   * One aggregate for the owner app (GET /me/admin/stats): the Moscow days `fromDay`..`toDay` (inclusive) for everything
   * «in range», the state now for the rest. Deleted accounts are never users (their payments still count as revenue, with
   * region 'none': the country is erased with the account). Revenue: succeeded payments by paid_at (else created_at),
   * roubles; refunds by refunded_at. Docs: docs/codex/owner-admin-api.md.
   */
  stats(from?: string, to?: string) {
    const now = this.now()
    const toDay = to ?? mskKey(now)
    const fromDay = from ?? mskKey(mskDayRange(toDay).start - (STATS_DEFAULT_DAYS - 1) * DAY_MS)
    if (fromDay > toDay) throw new AccountError(400, 'Начало периода позже конца')
    const start = mskDayRange(fromDay).start
    const end = mskDayRange(toDay).end
    const inRange = (time: unknown) => time != null && Number(time) >= start && Number(time) < end
    const hasInvites = this.tableExists('invite_rewards')
    const accounts = this.db.prepare(`SELECT a.id, a.kind, a.country, a.created_at, a.trial_ends_at, a.trial_pending_ms, a.trial_denied, a.invited_by, a.referred_by, s.paid_until,
        (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_count,
        (SELECT MIN(${PAID_SQL}) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS first_paid_at,
        EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded' AND ${PAID_SQL} >= ? AND ${PAID_SQL} < ?) AS paid_in_range,
        EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded' AND p.discount_percent IS NOT NULL) AS paid_discount,
        EXISTS (SELECT 1 FROM recurring_subscriptions r WHERE r.account_id = a.id AND r.status = 'active') AS autopay,
        ${this.friendRewardSql()} AS friend_reward
      FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id WHERE a.deleted_at IS NULL`).all(start, end) as Row[]

    type Bucket = { users: number; new: number; paying: number; active: number; revenue: number }
    const bucket = (): Bucket => ({ users: 0, new: 0, paying: 0, active: 0, revenue: 0 })
    const byRegion = Object.fromEntries(PAY_REGIONS.map((region) => [region, bucket()])) as Record<PayRegion, Bucket>
    const byCountry = new Map<string, Bucket>()
    const legacyRegion: Record<CountryRegion | 'none', number> = { cis: 0, europe: 0, other: 0, none: 0 }
    const users = { total: 0, new: 0, deletedExcluded: 0, streamers: 0, blocked: 0 }
    const subscriptions = { activePaid: 0, activeGranted: 0, grantedBy: { owner: 0, friend: 0 }, trials: 0, trialsPending: 0, expiringIn7Days: 0, expiringIn30Days: 0, lifetime: { total: 0, streamers: 0, legend: 0 }, autopay: 0 }
    const payers = { everPaid: 0, paidInRange: 0, newInRange: 0 }
    const referrals = { friendInvited: 0, friendInvitedInRange: 0, friendPaid: 0, friendPaidDiscount: 0, streamerReferred: 0, rewardsByStatus: { pending: 0, review: 0, granted: 0, canceled: 0 } as Record<string, number> }
    const trialConversion = { trialStarted: 0, laterPaid: 0, rate: 0 }
    for (const row of accounts) {
      const source = sourceOf(row, now)
      const country = row.country == null ? undefined : String(row.country)
      const isNew = inRange(row.created_at)
      const paying = source === 'money'
      const active = source !== undefined && source !== 'trial'
      const paid = Number(row.paid_count) > 0
      users.total++
      if (isNew) users.new++
      if (row.kind === 'streamer') users.streamers++
      for (const target of [byRegion[payRegionOf(country)], ...(country ? [byCountry.get(country) ?? byCountry.set(country, bucket()).get(country)!] : [])]) {
        target.users++
        if (isNew) target.new++
        if (paying) target.paying++
        if (active) target.active++
      }
      legacyRegion[country ? regionOf(country) : 'none']++
      if (source === 'money') subscriptions.activePaid++
      if (source === 'grant' || source === 'friend') { subscriptions.activeGranted++; subscriptions.grantedBy[source === 'grant' ? 'owner' : 'friend']++ }
      if (source === 'trial') subscriptions.trials++
      if (row.kind === 'user' && row.trial_pending_ms != null && !Number(row.trial_denied ?? 0) && source !== 'money') subscriptions.trialsPending++
      if (source === 'money' || source === 'grant' || source === 'friend') {
        const left = Number(row.paid_until) - now
        if (left <= 7 * DAY_MS) subscriptions.expiringIn7Days++
        if (left <= 30 * DAY_MS) subscriptions.expiringIn30Days++
      }
      if (source === 'lifetime') { subscriptions.lifetime.total++; subscriptions.lifetime[row.kind === 'streamer' ? 'streamers' : 'legend']++ }
      if (Number(row.autopay)) subscriptions.autopay++
      if (paid) payers.everPaid++
      if (Number(row.paid_in_range)) payers.paidInRange++
      if (inRange(row.first_paid_at)) payers.newInRange++
      if (row.invited_by != null) {
        referrals.friendInvited++
        if (isNew) referrals.friendInvitedInRange++
        if (paid) referrals.friendPaid++
        if (Number(row.paid_discount)) referrals.friendPaidDiscount++
      }
      if (row.referred_by != null) referrals.streamerReferred++
      // The cohort registered in the range whose free period has started (trial_ends_at is set when it starts).
      if (isNew && row.kind === 'user' && row.trial_ends_at != null && !Number(row.trial_denied ?? 0)) {
        trialConversion.trialStarted++
        if (paid) trialConversion.laterPaid++
      }
    }
    trialConversion.rate = trialConversion.trialStarted ? Math.round(trialConversion.laterPaid / trialConversion.trialStarted * 10_000) / 10_000 : 0
    users.deletedExcluded = Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE deleted_at IS NOT NULL').get() as Row).n)
    users.blocked = Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE blocked_at IS NOT NULL AND deleted_at IS NULL').get() as Row).n)
    if (hasInvites) {
      for (const row of this.db.prepare('SELECT status, COUNT(*) AS n FROM invite_rewards GROUP BY status').all() as Row[]) referrals.rewardsByStatus[String(row.status)] = Number(row.n)
    }

    // Revenue in kopecks while adding up, roubles in the answer.
    type Sum = { count: number; amount: number }
    const add = (sums: Record<string, Sum>, key: string, count: number, amount: number) => {
      const sum = sums[key] ?? (sums[key] = { count: 0, amount: 0 })
      sum.count += count
      sum.amount += amount
    }
    const byProvider: Record<string, Sum> = { yookassa: { count: 0, amount: 0 }, boosty: { count: 0, amount: 0 }, archive: { count: 0, amount: 0 } }
    const byMethod: Record<string, Sum> = {}
    const revenueByRegion: Record<string, Sum> = Object.fromEntries(PAY_REGIONS.map((region) => [region, { count: 0, amount: 0 }]))
    const byPlan: Record<string, Sum> = Object.fromEntries(PLAN_IDS.map((plan) => [plan, { count: 0, amount: 0 }]))
    const total: Sum = { count: 0, amount: 0 }
    let streamerEarnings = 0
    const grouped = this.db.prepare(`SELECT a.country AS country, ${PROVIDER_SQL} AS provider, ${METHOD_SQL} AS method, p.plan AS plan, COUNT(*) AS n, SUM(p.amount) AS amount, SUM(COALESCE(p.streamer_earning, 0)) AS earned
      FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.status = 'succeeded' AND ${PAID_SQL} >= ? AND ${PAID_SQL} < ? GROUP BY 1, 2, 3, 4`).all(start, end) as Row[]
    for (const row of grouped) {
      const count = Number(row.n)
      const amount = Number(row.amount ?? 0)
      const region = payRegionOf(row.country)
      total.count += count
      total.amount += amount
      streamerEarnings += Number(row.earned ?? 0)
      add(byProvider, String(row.provider), count, amount)
      add(byMethod, String(row.method), count, amount)
      add(revenueByRegion, region, count, amount)
      add(byPlan, String(row.plan), count, amount)
      byRegion[region].revenue += amount
      if (row.country != null) { const target = byCountry.get(String(row.country)); if (target) target.revenue += amount }
    }
    const refundRow = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS amount FROM payments p WHERE p.status = 'refunded' AND COALESCE(p.refunded_at, ${PAID_SQL}) >= ? AND COALESCE(p.refunded_at, ${PAID_SQL}) < ?`).get(start, end) as Row
    const rubles = (sums: Record<string, Sum>) => Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, { count: sum.count, amount: rub(sum.amount) }]))
    const regionView = (item: Bucket) => ({ ...item, revenue: rub(item.revenue) })

    return {
      generatedAt: new Date(now).toISOString(),
      range: { from: fromDay, to: toDay, timezone: 'Europe/Moscow', start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      users,
      byRegion: Object.fromEntries(PAY_REGIONS.map((region) => [region, regionView(byRegion[region])])) as Record<PayRegion, Bucket>,
      legacyRegion,
      byCountry: [...byCountry.entries()].map(([country, item]) => ({ country, ...regionView(item) }))
        .sort((a, b) => b.users - a.users || b.revenue - a.revenue || a.country.localeCompare(b.country)),
      subscriptions,
      payers,
      revenue: {
        total: rub(total.amount),
        payments: total.count,
        streamerEarnings: rub(streamerEarnings),
        byProvider: rubles(byProvider),
        byMethod: rubles(byMethod),
        byRegion: rubles(revenueByRegion),
        byPlan: rubles(byPlan),
        refunds: { count: Number(refundRow.n), amount: rub(refundRow.amount) },
      },
      referrals,
      trialConversion,
    }
  }

  private hasColumn(table: string, column: string) {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some((row) => row.name === column)
  }

  // ------------------------------------------------------------------------------------------------------------
  // Payments
  // ------------------------------------------------------------------------------------------------------------

  private paymentWhere(filter: PaymentFilter) {
    const where: string[] = []
    const args: Array<string | number> = []
    const date = filter.dateField === 'paid' ? PAID_SQL : 'p.created_at'
    if (filter.from) { where.push(`${date} >= ?`); args.push(mskDayRange(filter.from).start) }
    if (filter.to) { where.push(`${date} < ?`); args.push(mskDayRange(filter.to).end) }
    if (filter.status) { where.push('p.status = ?'); args.push(filter.status) }
    if (filter.plan) { where.push('p.plan = ?'); args.push(filter.plan) }
    if (filter.q) { where.push("a.email LIKE ? ESCAPE '\\'"); args.push(likePattern(filter.q.toLowerCase())) }
    if (filter.provider) { where.push(`${PROVIDER_SQL} = ?`); args.push(filter.provider) }
    if (filter.method) { where.push(`${METHOD_SQL} = ?`); args.push(filter.method) }
    if (filter.region) { const condition = payRegionCondition(filter.region); where.push(condition.sql); args.push(...condition.args) }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
  }

  /** Newest first by the date the filter is on. */
  private paymentOrder(filter: PaymentFilter) {
    return filter.dateField === 'paid' ? `ORDER BY ${PAID_SQL} DESC, p.rowid DESC` : 'ORDER BY p.created_at DESC, p.rowid DESC'
  }

  paymentList(filter: PaymentFilter, limit: number, offset: number) {
    const { sql, args } = this.paymentWhere(filter)
    const totals = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN p.amount ELSE 0 END), 0) AS revenue, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN COALESCE(p.streamer_earning, 0) ELSE 0 END), 0) AS earned FROM payments p JOIN accounts a ON a.id = p.account_id ${sql}`).get(...args) as Row
    const rows = this.db.prepare(`${PAYMENT_SELECT} ${sql} ${this.paymentOrder(filter)} LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    // «Чистыми» (the commission taken off where the owner told it, else the whole sum) and the paid ones by plan
    // (owner, 20.10.2026: «сколько штук на 1, 3, 6 и 12 месяцев»).
    const net = Number((this.db.prepare(`SELECT COALESCE(SUM(COALESCE(p.net_amount, p.amount)), 0) AS n FROM payments p JOIN accounts a ON a.id = p.account_id ${sql ? `${sql} AND` : 'WHERE'} p.status = 'succeeded'`).get(...args) as Row).n)
    const plans = Object.fromEntries(PLAN_IDS.map((id) => [id, { count: 0, revenue: 0 }])) as Record<PlanId, { count: number; revenue: number }>
    for (const item of this.db.prepare(`SELECT p.plan, COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS total FROM payments p JOIN accounts a ON a.id = p.account_id ${sql ? `${sql} AND` : 'WHERE'} p.status = 'succeeded' GROUP BY p.plan`).all(...args) as Row[]) {
      const plan = String(item.plan) as PlanId
      if (plans[plan]) plans[plan] = { count: Number(item.n), revenue: rub(item.total) }
    }
    return {
      payments: rows.map(toPayment),
      total: Number(totals.n),
      totals: { succeeded: Number(totals.ok), revenue: rub(totals.revenue), net: rub(net), streamerEarnings: rub(totals.earned), plans },
    }
  }

  /** CSV for Excel (UTF-8 with BOM, «;» separated, Moscow time). Cells that look like formulas are neutralised. */
  paymentsCsv(filter: PaymentFilter, maxRows = 50_000) {
    const { sql, args } = this.paymentWhere(filter)
    const rows = this.db.prepare(`${PAYMENT_SELECT} ${sql} ${this.paymentOrder(filter)} LIMIT ?`).all(...args, maxRows) as Row[]
    const header = ['Создан (МСК)', 'Оплачен (МСК)', 'E-mail', 'Тариф', 'Способ', 'Статус', 'Сумма, ₽', 'Сумма в валюте', 'Валюта', 'Автопродление', 'Код стримера', 'Доля стримера, ₽', 'ID платежа', 'Ник', 'Пригласил (друг)', 'Сумма до изменения, ₽']
    const status: Record<string, string> = { pending: 'Ожидает', succeeded: 'Оплачен', canceled: 'Отменён' }
    const lines = [header, ...rows.map(toPayment).map((item) => [
      mskText(item.createdAt), item.paidAt ? mskText(item.paidAt) : '', item.email, item.plan, PROVIDER_NAME[item.provider], status[item.status] ?? item.status,
      money(item.amount), item.original ? money(item.original.amount) : '', item.original?.currency ?? '', item.renewal ? 'да' : '', item.referralCode ?? '',
      item.streamerEarning === undefined ? '' : money(item.streamerEarning), item.id, item.nickname ?? '',
      item.invitedBy ? (item.invitedBy.deleted ? 'удалённый аккаунт' : [item.invitedBy.email, item.invitedBy.nickname].filter(Boolean).join(' · ')) : '',
      item.amountEdited ? money(item.amountEdited.before) : '',
    ])]
    return { csv: `\uFEFF${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`, rows: rows.length }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------------------------------------------------

  /**
   * `pc_seen_at`: the latest use of the account's PC devices (services/entitlement.ts: written at sign-in, on every
   * entitlement refresh and by data requests). The desktop app names its device after the system
   * (electron/entitlement.ts deviceName: «Windows · DESKTOP-1234 · Raid OS 0.6.0»); the phone and browser builds send
   * «Android · Raid OS», «iOS · Raid OS», «Браузер · Raid OS» (src/sync/webEntitlement.ts) and do not count.
   */
  private userSelect() {
    // USER_FROM: accounts with the subscription, the bound game account and the inviter of a friend-invited account
    // (accounts.invited_by → accounts, one LEFT JOIN: the e-mail and nickname in the same row, no query per user).
    const devices = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_devices'").get() !== undefined
    const pcSeen = devices
      ? "(SELECT MAX(d.last_seen_at) FROM account_devices d WHERE d.account_id = a.id AND (d.name LIKE 'Windows%' OR d.name LIKE 'macOS%' OR d.name LIKE 'Linux%'))"
      : 'NULL'
    return `
    SELECT a.id, a.email, a.kind, a.created_at, a.referral_code, a.referred_by, a.referred_at, a.trial_ends_at, a.trial_pending_ms, a.trial_denied, a.blocked_at, a.last_seen_at, a.country, a.country_other, a.nicknames, s.paid_until,
      ${pcSeen} AS pc_seen_at,
      (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_count,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_total,
      (SELECT r.provider || '|' || r.status || '|' || r.plan FROM recurring_subscriptions r WHERE r.account_id = a.id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS autopay,
      e.eft_hint, e.bound_at AS eft_bound_at,
      a.invited_by, i.email AS inviter_email, i.nicknames AS inviter_nicknames, i.deleted_at AS inviter_deleted_at,
      CASE WHEN a.invited_by IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.discount_percent IS NOT NULL AND p.status IN ('succeeded', 'refunded')) END AS friend_discount_paid,
      ${this.friendRewardSql()} AS friend_reward
    ${USER_FROM}`
  }

  /** 1 when the account (joined as `a`) got days from a granted «Пригласи друга» reward (services/invites.ts). */
  private friendRewardSql() {
    return this.tableExists('invite_rewards') ? "EXISTS (SELECT 1 FROM invite_rewards r WHERE r.inviter_id = a.id AND r.status = 'granted')" : '0'
  }

  /**
   * WHERE of «Пользователи» for a UserQuery: `base` without the legacy region tab (its counts ignore the chosen tab),
   * `all` with it. Deleted accounts are never users.
   */
  private userWhere(query: UserQuery) {
    const now = this.now()
    const where: string[] = ['a.deleted_at IS NULL']
    const args: Array<string | number> = []
    const q = query.q ?? ''
    if (q) {
      // The e-mail or the game nickname (owner, 13.10.2026: the nickname found by the PC app shows under each account).
      // A broken nicknames value never breaks the list: CASE reads JSON only when it is valid. The inviter's e-mail too
      // (owner, 14.10.2026): searching a player's e-mail also lists the friends who came with that player's code.
      const nick = ACCOUNT_MODES.map((mode) => `json_extract(a.nicknames, '$.${mode}') LIKE ? ESCAPE '\\'`).join(' OR ')
      where.push(`(a.email LIKE ? ESCAPE '\\' OR CASE WHEN json_valid(a.nicknames) THEN (${nick}) ELSE 0 END OR (i.email LIKE ? ESCAPE '\\' AND i.deleted_at IS NULL))`)
      args.push(likePattern(q.toLowerCase()), ...ACCOUNT_MODES.map(() => likePattern(q)), likePattern(q.toLowerCase()))
    }
    const filter = query.filter ?? 'all'
    const active = "(a.kind = 'user' AND s.paid_until > ?)"
    const trial = "(a.kind = 'user' AND (s.paid_until IS NULL OR s.paid_until <= ?) AND COALESCE(a.trial_denied, 0) = 0 AND a.trial_ends_at > ?)"
    if (filter === 'active') { where.push(active); args.push(now) }
    if (filter === 'trial') { where.push(trial); args.push(now, now) }
    if (filter === 'inactive') { where.push("(a.kind = 'user' AND COALESCE(s.paid_until, 0) <= ? AND NOT (COALESCE(a.trial_denied, 0) = 0 AND COALESCE(a.trial_ends_at, 0) > ?))"); args.push(now, now) }
    if (filter === 'streamers') where.push("a.kind = 'streamer'")
    if (filter === 'blocked') where.push('a.blocked_at IS NOT NULL')
    if (query.country) { where.push('a.country = ?'); args.push(query.country) }
    if (query.payRegion) { const condition = payRegionCondition(query.payRegion); where.push(condition.sql); args.push(...condition.args) }
    if (query.payer) where.push(`${query.payer === 'yes' ? '' : 'NOT '}EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded')`)
    if (query.expiresBefore) { where.push('s.paid_until > ? AND s.paid_until < ?'); args.push(now, mskDayRange(query.expiresBefore).end) }
    if (query.registeredFrom) { where.push('a.created_at >= ?'); args.push(mskDayRange(query.registeredFrom).start) }
    if (query.registeredTo) { where.push('a.created_at < ?'); args.push(mskDayRange(query.registeredTo).end) }
    if (query.seenSince) { where.push('a.last_seen_at >= ?'); args.push(mskDayRange(query.seenSince).start) }
    if (query.autopay) where.push(`${query.autopay === 'yes' ? '' : 'NOT '}EXISTS (SELECT 1 FROM recurring_subscriptions r WHERE r.account_id = a.id AND r.status = 'active')`)
    const base = { where: [...where], args: [...args] }
    if (query.region && query.region !== 'all') {
      const condition = regionCondition(query.region)
      where.push(condition.sql)
      args.push(...condition.args)
    }
    return { base, all: { sql: `WHERE ${where.join(' AND ')}`, args } }
  }

  /** ORDER BY of «Пользователи» (the columns of userSelect); newest registration first by default. */
  private userOrder(query: UserQuery) {
    const dir = query.order === 'asc' ? 'ASC' : 'DESC'
    const column = query.sort === 'paidUntil' ? 'COALESCE(s.paid_until, 0)'
      : query.sort === 'lastSeen' ? 'COALESCE(a.last_seen_at, 0)'
        : query.sort === 'payments' ? `paid_total ${dir}, paid_count`
          : 'a.created_at'
    return `ORDER BY ${column} ${dir}, a.rowid ${dir}`
  }

  /**
   * `region`: the tab of «Пользователи» by country. `regions` counts the users of every tab within the search and the
   * status filter (not the chosen tab), so the numbers stay put while the owner switches tabs.
   */
  users(q: string, filter: UserFilter, limit: number, offset: number, region: RegionFilter = 'all', extra: Omit<UserQuery, 'q' | 'filter' | 'region'> = {}) {
    return this.userList({ ...extra, q, filter, region }, limit, offset)
  }

  /** «Пользователи» for a UserQuery (see users()); `regions` counts the legacy region tabs within every other filter. */
  userList(query: UserQuery, limit: number, offset: number) {
    const { base, all } = this.userWhere(query)
    const regions: RegionCounts = { all: 0, russia: 0, cis: 0, world: 0, europe: 0, other: 0, none: 0 }
    for (const row of this.db.prepare(`SELECT a.country AS country, COUNT(*) AS n ${USER_FROM} WHERE ${base.where.join(' AND ')} GROUP BY a.country`).all(...base.args) as Row[]) {
      const amount = Number(row.n)
      const country = row.country == null ? null : String(row.country)
      regions.all += amount
      if (!country) { regions.none += amount; continue }
      if (country === 'RU') regions.russia += amount
      else if (CIS_COUNTRIES.includes(country as never)) regions.cis += amount
      else {
        regions.world += amount
        regions[regionOf(country)] += amount
      }
    }
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n ${USER_FROM} ${all.sql}`).get(...all.args) as Row).n)
    const rows = this.db.prepare(`${this.userSelect()} ${all.sql} ${this.userOrder(query)} LIMIT ? OFFSET ?`).all(...all.args, limit, offset) as Row[]
    return { users: rows.map((row) => this.toUser(row)), total, regions }
  }

  /**
   * «Пользователи» as CSV for Excel (UTF-8 with BOM, «;», Moscow time; formula-like cells neutralised), in the list's
   * order, at most `maxRows` rows.
   */
  usersCsv(query: UserQuery, maxRows = 50_000) {
    const { all } = this.userWhere(query)
    const rows = this.db.prepare(`${this.userSelect()} ${all.sql} ${this.userOrder(query)} LIMIT ?`).all(...all.args, maxRows) as Row[]
    const header = ['email', 'nickname', 'country', 'payRegion', 'created', 'lastSeen', 'status', 'paidUntil', 'source', 'paymentsCount', 'paymentsTotal', 'invitedBy']
    const lines = [header, ...rows.map((row) => this.toUser(row)).map((user) => [
      user.email, user.nickname ?? '', user.country === 'XX' && user.countryOther ? `XX (${user.countryOther})` : user.country ?? '', user.payRegion,
      mskText(user.createdAt), user.lastSeenAt ? mskText(user.lastSeenAt) : '', user.blockedAt ? 'blocked' : user.subscription.status,
      user.subscription.paidUntil ? mskText(user.subscription.paidUntil) : '', user.source ?? '', String(user.payments.count), money(user.payments.total),
      user.invitedBy ? user.invitedBy.email ?? 'deleted' : '',
    ])]
    return { csv: `\uFEFF${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`, rows: rows.length }
  }

  /** One user with his last payments and the owner's manual grants. */
  user(id: string) {
    const row = this.db.prepare(`${this.userSelect()} WHERE a.id = ?`).get(id) as Row | undefined
    if (!row) throw new AccountError(404, 'Пользователь не найден')
    const payments = (this.db.prepare(`${PAYMENT_SELECT} WHERE p.account_id = ? ORDER BY p.created_at DESC, p.rowid DESC LIMIT 20`).all(id) as Row[]).map(toPayment)
    const grants = (this.db.prepare('SELECT * FROM owner_subscription_grants WHERE account_id = ? ORDER BY at DESC, id DESC LIMIT 20').all(id) as Row[])
      .map((grant) => ({ days: Number(grant.days), reason: String(grant.reason), actor: String(grant.actor), at: iso(grant.at)!, paidUntil: iso(grant.paid_until_after)! }))
    return { user: this.toUser(row), payments, grants }
  }

  private toUser(row: Row): AdminUser {
    const now = this.now()
    const kind = row.kind === 'streamer' ? 'streamer' : 'user'
    const paidUntil = row.paid_until == null ? undefined : Number(row.paid_until)
    const trialEnds = row.trial_ends_at == null || Number(row.trial_denied ?? 0) ? undefined : Number(row.trial_ends_at)
    let subscription: AdminUser['subscription'] = { status: 'inactive', ...(paidUntil ? { paidUntil: iso(paidUntil) } : {}) }
    if (trialEnds !== undefined && trialEnds > now) subscription = { status: 'trial', trialEndsAt: iso(trialEnds) }
    else if (row.trial_pending_ms != null && !Number(row.trial_denied ?? 0)) subscription = { ...subscription, trialPendingDays: Math.max(1, Math.round(Number(row.trial_pending_ms) / DAY_MS)) }
    if (paidUntil !== undefined && paidUntil > now) subscription = { status: 'active', paidUntil: iso(paidUntil) }
    if (kind === 'streamer') subscription = { status: 'active', lifetime: true }
    const [provider, status, plan] = row.autopay == null ? [] : String(row.autopay).split('|')
    const email = String(row.email)
    const nickname = storedNickname(row.nicknames)
    const source = sourceOf(row, now)
    return {
      id: String(row.id),
      email,
      kind,
      ...(this.accounts.owners.has(email) ? { owner: true as const } : {}),
      createdAt: iso(row.created_at)!,
      ...(row.referred_by == null ? {} : { referredBy: String(row.referred_by) }),
      ...(row.referral_code == null ? {} : { referralCode: String(row.referral_code) }),
      subscription,
      autopay: provider ? { provider: providerOf(provider), status: status ?? '', plan: plan ?? '' } : null,
      ...(row.last_seen_at == null ? {} : { lastSeenAt: iso(row.last_seen_at) }),
      ...(row.pc_seen_at == null ? {} : { pcSeenAt: iso(row.pc_seen_at) }),
      ...(row.blocked_at == null ? {} : { blockedAt: iso(row.blocked_at) }),
      payments: { count: Number(row.paid_count ?? 0), total: rub(row.paid_total) },
      ...(row.eft_hint == null ? {} : { eftAccount: { masked: `••••${String(row.eft_hint)}`, boundAt: iso(row.eft_bound_at)! } }),
      ...(row.country == null ? {} : { country: String(row.country) }),
      ...(row.country_other == null ? {} : { countryOther: String(row.country_other) }),
      ...(nickname ? { nickname } : {}),
      ...(row.invited_by == null ? {} : { invitedBy: { ...inviterOf(row), discount: row.friend_discount_paid ? 'used' as const : Number(row.paid_count ?? 0) > 0 ? 'lost' as const : 'unused' as const } }),
      payRegion: payRegionOf(row.country),
      ...(source ? { source } : {}),
    }
  }

  private mustUser(id: string) {
    const row = this.db.prepare('SELECT id, email FROM accounts WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AccountError(404, 'Пользователь не найден')
    return { id: String(row.id), email: String(row.email) }
  }

  /**
   * «Отметить возврат»: the owner refunded a payment outside the ЮKassa webhook (bank, by hand). The paid days,
   * the streamer's share and friend rewards are taken back (PaymentStore.markRefunded). Audited as `payment.refund`.
   */
  markRefunded(actor: string, paymentId: string) {
    const row = this.db.prepare('SELECT p.status, p.plan, a.email FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.id = ?').get(paymentId) as Row | undefined
    if (!row) throw new AccountError(404, 'Платёж не найден')
    if (row.status !== 'succeeded') throw new AccountError(409, 'Отметить возврат можно только у оплаченного платежа')
    if (this.payments.markRefunded(paymentId)) this.audit(actor, 'payment.refund', String(row.email), { paymentId, plan: String(row.plan) })
    return { ok: true }
  }

  /**
   * «Изменить сумму»: the owner corrects what a payment brought (PaymentStore.setAmount: the streamer's share is recounted,
   * statistics read the new amount). Audited as `payment.amount` with the old and new roubles and the owner's comment.
   */
  setPaymentAmount(actor: string, paymentId: string, amount: number, comment?: string) {
    let change: { before: number; after: number }
    try {
      change = this.payments.setAmount(paymentId, amount)
    } catch (error) {
      if (error instanceof PaymentError) throw new AccountError(error.status, error.status === 404 ? 'Платёж не найден' : 'Сумму платежа из архива менять нельзя')
      throw error
    }
    const row = this.db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(paymentId) as Row
    const note = comment?.trim()
    this.audit(actor, 'payment.amount', String(row.email), { paymentId, plan: String(row.plan), before: rub(change.before), after: rub(change.after), ...(note ? { comment: note } : {}) })
    return toPayment(row)
  }

  /** «Выдать / продлить подписку на N дней»: from the end of the running paid period (or now), logged with the reason. */
  grant(actor: string, id: string, days: number, reason: string) {
    const target = this.mustUser(id)
    transaction(this.db, () => {
      const { until } = this.applyGrant(actor, id, days, reason)
      this.audit(actor, 'subscription.grant', target.email, { days, reason, paidUntil: new Date(until).toISOString() })
    })
    return this.user(id)
  }

  /** The grant itself (inside the caller's transaction): the new paid-until and the row in the account's grant history. */
  private applyGrant(actor: string, id: string, days: number, reason: string) {
    const before = this.payments.paidUntil(id)
    const until = Math.max(this.now(), before ?? 0) + days * DAY_MS
    this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(id, until)
    this.db.prepare('INSERT INTO owner_subscription_grants (account_id, days, reason, actor, at, paid_until_before, paid_until_after) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, days, reason, actor, this.now(), before ?? null, until)
    return { before, until }
  }

  /**
   * «Выдать дни» to many accounts at once (the owner app): `ids` (at most BULK_GRANT_MAX) or a UserQuery (as the list;
   * more than BULK_GRANT_MAX matches is refused, BulkGrantLimitError). Deleted accounts and streamers (lifetime access)
   * are skipped. Each account gets the same grant as the single one (grant history with the reason); the audit log gets
   * one `subscription.bulk-grant` entry with the count. `dryRun`: nothing changes, the answer shows what would.
   */
  bulkGrant(actor: string, input: { ids?: string[]; query?: UserQuery; days: number; reason: string; dryRun?: boolean }) {
    type Target = { id: string; email: string; before?: number }
    let targets: Target[]
    let skipped = 0
    const toTarget = (row: Row): Target => ({ id: String(row.id), email: String(row.email), ...(row.paid_until == null ? {} : { before: Number(row.paid_until) }) })
    if (input.ids) {
      const ids = [...new Set(input.ids)]
      if (ids.length > BULK_GRANT_MAX) throw new BulkGrantLimitError(ids.length)
      const rows = ids.length ? this.db.prepare(`SELECT a.id, a.email, a.kind, a.deleted_at, s.paid_until FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id WHERE a.id IN (${placeholders(ids)})`).all(...ids) as Row[] : []
      const byId = new Map(rows.map((row) => [String(row.id), row]))
      targets = ids.map((id) => byId.get(id)).filter((row): row is Row => row !== undefined && row.deleted_at == null && row.kind === 'user').map(toTarget)
      skipped = ids.length - targets.length
    } else {
      const { all } = this.userWhere(input.query ?? {})
      const sql = `${all.sql} AND a.kind = 'user'`
      const matched = Number((this.db.prepare(`SELECT COUNT(*) AS n ${USER_FROM} ${sql}`).get(...all.args) as Row).n)
      if (matched > BULK_GRANT_MAX && !input.dryRun) throw new BulkGrantLimitError(matched)
      targets = (this.db.prepare(`SELECT a.id, a.email, s.paid_until ${USER_FROM} ${sql} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`).all(...all.args, BULK_GRANT_MAX) as Row[]).map(toTarget)
      if (matched > BULK_GRANT_MAX) {
        return { affected: matched, sample: this.grantSample(targets, input.days), skipped, dryRun: true as const, tooMany: true as const, max: BULK_GRANT_MAX }
      }
    }
    if (input.dryRun) return { affected: targets.length, sample: this.grantSample(targets, input.days), skipped, dryRun: true as const }
    const applied = transaction(this.db, () => {
      const done = targets.map((target) => ({ ...target, after: this.applyGrant(actor, target.id, input.days, input.reason).until }))
      if (done.length) {
        this.audit(actor, 'subscription.bulk-grant', undefined, {
          count: done.length, days: input.days, reason: input.reason,
          ...(input.ids ? { ids: new Set(input.ids).size } : { filter: userQueryDetails(input.query ?? {}) }),
        })
      }
      return done
    })
    return {
      affected: applied.length,
      sample: applied.slice(0, 20).map((item) => ({ id: item.id, email: item.email, ...(item.before === undefined ? {} : { paidUntilBefore: iso(item.before) }), paidUntilAfter: iso(item.after)! })),
      skipped,
      dryRun: false as const,
    }
  }

  /** The first 20 targets with the paid-until they would get. */
  private grantSample(targets: Array<{ id: string; email: string; before?: number }>, days: number) {
    const now = this.now()
    return targets.slice(0, 20).map((item) => ({ id: item.id, email: item.email, ...(item.before === undefined ? {} : { paidUntilBefore: iso(item.before) }), paidUntilAfter: iso(Math.max(now, item.before ?? 0) + days * DAY_MS)! }))
  }

  /**
   * «Списать дни подписки» (owner, 11.10.2026): takes N days off the end of the paid period, never back past now (taking
   * more than is left simply ends the subscription today). Logged next to the grants with negative days, audited as
   * `subscription.revoke`. A trial or a streamer's lifetime access has no paid days to take.
   */
  revoke(actor: string, id: string, days: number, reason: string) {
    const target = this.mustUser(id)
    const kind = (this.db.prepare('SELECT kind FROM accounts WHERE id = ?').get(id) as Row | undefined)?.kind
    if (kind === 'streamer') throw new AccountError(409, 'У стримера бессрочный доступ: списывать нечего')
    transaction(this.db, () => {
      const before = this.payments.paidUntil(id)
      const now = this.now()
      if (before == null || before <= now) throw new AccountError(409, 'У пользователя нет оплаченных дней')
      const until = Math.max(now, before - days * DAY_MS)
      this.db.prepare('UPDATE subscriptions SET paid_until = ? WHERE account_id = ?').run(until, id)
      this.db.prepare('INSERT INTO owner_subscription_grants (account_id, days, reason, actor, at, paid_until_before, paid_until_after) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, -days, reason, actor, now, before, until)
      this.audit(actor, 'subscription.revoke', target.email, { days, reason, paidUntil: new Date(until).toISOString() })
    })
    return this.user(id)
  }

  /**
   * «Отменить автопродление» for the user (ЮKassa: the saved method is deleted). An archived autopayment is only closed
   * here: the owner stops it with that payment service by hand (PaymentStore.cancelAutopay).
   */
  async cancelAutopay(actor: string, id: string) {
    const target = this.mustUser(id)
    await this.payments.cancelAutopay({ id: target.id }, { byOwner: true })
    this.audit(actor, 'autopay.cancel', target.email)
    return this.user(id)
  }

  /** Blocks sign-in: every session is revoked at once and new ones are refused (login answers 403). */
  setBlocked(actor: string, id: string, blocked: boolean, reason?: string) {
    const target = this.mustUser(id)
    if (blocked && this.accounts.owners.has(target.email)) throw new AccountError(409, 'Аккаунт владельца заблокировать нельзя')
    transaction(this.db, () => {
      if (blocked) {
        this.db.prepare('UPDATE accounts SET blocked_at = COALESCE(blocked_at, ?) WHERE id = ?').run(this.now(), id)
        this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id)
      } else {
        this.db.prepare('UPDATE accounts SET blocked_at = NULL WHERE id = ?').run(id)
      }
      this.audit(actor, blocked ? 'account.block' : 'account.unblock', target.email, reason ? { reason } : undefined)
    })
    return this.user(id)
  }

  /**
   * «Отвязать аккаунт Escape from Tarkov» (a player changed game accounts, support case): the game account is free and
   * the player's app binds the one in its logs at the next start (AccountStore.unbindEftAccount).
   */
  unbindEftAccount(actor: string, id: string) {
    const target = this.mustUser(id)
    if (this.accounts.unbindEftAccount(id)) this.audit(actor, 'eft.unbind', target.email)
    return this.user(id)
  }

  /**
   * «Удалить аккаунт» from the admin panel (owner, 13.10.2026): the same erasure as the user's own «Удалить аккаунт»
   * (AccountStore.deleteAccount — personal data gone, payments kept anonymously, the e-mail free again). Not the owner's
   * account, and an active autopayment is cancelled first (its own button, the provider has to be told).
   */
  deleteUser(actor: string, id: string) {
    const target = this.mustUser(id)
    if (this.accounts.owners.has(target.email)) throw new AccountError(409, 'Аккаунт владельца удалить нельзя')
    if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_subscriptions'").get()
      && this.db.prepare("SELECT 1 FROM recurring_subscriptions WHERE account_id = ? AND status = 'active'").get(id)) {
      throw new AccountError(409, 'Сначала отмените автопродление — кнопка «Отменить автопродление» выше')
    }
    // deleteAccount runs its own transaction; the e-mail for the journal was read before it was erased.
    this.accounts.deleteAccount(id)
    this.audit(actor, 'account.delete', target.email)
    return { deleted: true as const }
  }

  /** «Изменить e-mail» (AccountStore.changeEmail): the journal keeps the old and the new address. */
  changeEmail(actor: string, id: string, email: string) {
    this.mustUser(id)
    const done = this.accounts.changeEmail(id, email)
    if (done.changed) this.audit(actor, 'account.email', done.email, { previous: done.previous })
    return this.user(id)
  }

  /** «Сбросить сессии»: the user is signed out everywhere (site, app, phone) and signs in again. */
  revokeSessions(actor: string, id: string) {
    const target = this.mustUser(id)
    const removed = Number(this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(id).changes)
    this.audit(actor, 'sessions.revoke', target.email, { sessions: removed })
    return { revoked: removed, ...this.user(id) }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Streamers
  // ------------------------------------------------------------------------------------------------------------

  streamerSettings() {
    const overrides = this.payments.percentOverrides()
    const rows = this.db.prepare("SELECT referral_code, email, referral_disabled_at FROM accounts WHERE kind = 'streamer' AND referral_code IS NOT NULL ORDER BY created_at").all() as Row[]
    return {
      defaultPercent: this.payments.streamerPercent,
      streamers: rows.map((row) => {
        const code = String(row.referral_code)
        const custom = overrides.get(code)
        return { code, email: String(row.email), percent: custom ?? this.payments.streamerPercent, custom: custom !== undefined, linkEnabled: row.referral_disabled_at == null, ...(row.referral_disabled_at == null ? {} : { linkDisabledAt: iso(row.referral_disabled_at) }) }
      }),
    }
  }

  private mustStreamer(code: string) {
    const row = this.db.prepare("SELECT id FROM accounts WHERE referral_code = ? AND kind = 'streamer'").get(code) as Row | undefined
    if (!row) throw new AccountError(404, 'Стример не найден')
  }

  setStreamerPercent(actor: string, code: string, percent: number | null) {
    this.mustStreamer(code)
    this.payments.setPercentOverride(code, percent)
    this.audit(actor, 'streamer.percent', code, { percent: percent ?? `по умолчанию (${this.payments.streamerPercent})` })
    return this.streamerSettings()
  }

  /** Switches the streamer's referral link off (new visits and registrations are not attributed) or back on. */
  setStreamerLink(actor: string, code: string, enabled: boolean) {
    this.mustStreamer(code)
    if (enabled) this.db.prepare("UPDATE accounts SET referral_disabled_at = NULL WHERE referral_code = ? AND kind = 'streamer'").run(code)
    else this.db.prepare("UPDATE accounts SET referral_disabled_at = COALESCE(referral_disabled_at, ?) WHERE referral_code = ? AND kind = 'streamer'").run(this.now(), code)
    this.audit(actor, 'streamer.link', code, { enabled })
    return this.streamerSettings()
  }

  /**
   * Takes the streamer status away: the account becomes an ordinary user (no streamer cabinet, no free lifetime
   * subscription) and the link stops attributing. The code stays reserved on the account, so it is never handed to
   * someone else and the users and payments already attributed to it keep their history.
   */
  revokeStreamer(actor: string, code: string) {
    this.mustStreamer(code)
    this.db.prepare("UPDATE accounts SET kind = 'user', referral_disabled_at = COALESCE(referral_disabled_at, ?) WHERE referral_code = ? AND kind = 'streamer'").run(this.now(), code)
    this.audit(actor, 'streamer.revoke', code)
    return this.streamerSettings()
  }

  // ------------------------------------------------------------------------------------------------------------
  // Sales settings (read-only: the keys live in the owner's desktop app)
  // ------------------------------------------------------------------------------------------------------------

  salesSettings() {
    const config = this.payments.config
    return {
      enabled: this.payments.enabled,
      providers: this.payments.providers(),
      plans: this.payments.plans(),
      yookassa: config ? { monthPrice: config.monthPrice, receipts: config.receipts, autopay: config.autopay === true, publicUrl: config.publicUrl ?? null } : null,
      streamerPercent: this.payments.streamerPercent,
      trialDays: Math.round(REFERRAL_TRIAL_MS / DAY_MS),
      welcomeTrialDays: Math.round(WELCOME_TRIAL_MS / DAY_MS),
    }
  }

  private tableExists(name: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
  }
}

function toPayment(row: Row): AdminPayment {
  const other = paidInOtherCurrency(row)
  const nickname = storedNickname(row.payer_nicknames)
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    email: String(row.email),
    ...(nickname ? { nickname } : {}),
    plan: String(row.plan) as PlanId,
    provider: providerOf(row.provider),
    status: String(row.status) as AdminPayment['status'],
    amount: rub(row.amount),
    ...(other ? { original: { amount: rub(other.minor), currency: other.currency } } : {}),
    createdAt: iso(row.created_at)!,
    ...(row.paid_at == null ? {} : { paidAt: iso(row.paid_at) }),
    ...(row.recurring_id == null ? {} : { renewal: true as const }),
    ...(row.referral_code == null ? {} : { referralCode: String(row.referral_code) }),
    ...(row.streamer_earning == null ? {} : { streamerEarning: rub(row.streamer_earning) }),
    ...(row.discount_percent == null ? {} : {
      friendDiscount: {
        percent: Number(row.discount_percent),
        ...(row.inviter_email == null ? {} : row.inviter_deleted_at != null ? { inviterDeleted: true as const } : { inviter: String(row.inviter_email) }),
      },
    }),
    ...(row.invited_by == null ? {} : { invitedBy: inviterOf(row) }),
    ...(row.amount_edited_at == null ? {} : { amountEdited: { before: rub(row.amount_before_edit), at: iso(row.amount_edited_at)! } }),
    ...(row.net_amount == null ? {} : { netAmount: rub(row.net_amount) }),
    method: row.method_view == null ? 'unknown' : String(row.method_view),
  }
}

const mskText = (value: string) => new Date(Date.parse(value) + MSK_MS).toISOString().slice(0, 16).replace('T', ' ')
const money = (value: number) => value.toFixed(2).replace('.', ',')
/** Quotes a CSV cell; a leading = + - @ (or tab / CR) is prefixed with «'» so Excel never runs it as a formula. */
export function csvCell(raw: string) {
  const value = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(,\d+)?$/.test(raw) ? `'${raw}` : raw
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
