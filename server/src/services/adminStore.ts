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
import { AccountError, ACCOUNT_MODES, periodKeySql, REFERRAL_TRIAL_MS, storedNickname, WELCOME_TRIAL_MS, type AccountStore, type StatsPeriod } from './accountStore.js'
import { transaction } from './database.js'
import { paidInOtherCurrency, PLAN_MONTHS, providerOf, type PaymentProvider, type PaymentStore, type PlanId } from './paymentStore.js'

type Row = Record<string, unknown>
const DAY_MS = 24 * 60 * 60 * 1000
/** Statistics days follow Moscow time (UTC+3, no daylight saving), as in the streamer tables. */
const MSK_MS = 3 * 60 * 60 * 1000
const PLAN_IDS = Object.keys(PLAN_MONTHS) as PlanId[]
const PERIOD_LENGTH: Record<StatsPeriod, number> = { day: 10, month: 7, year: 4 }

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
  | 'payment.refund' | 'map.boss-place' | 'map.boss-remove' | 'map.quest-point' | 'invite.decide' | 'bug.status' | 'bug.reward' | 'bug.mail'
  | 'eft.unbind' | 'account.delete' | 'map.quest-text' | 'announcement.set' | 'features.minimap' | 'features.minimapOverlay' | 'support.reply' | 'support.resolve'
  | 'requests-key.create' | 'requests-key.revoke'

export interface AuditEntry { id: number; at: string; actor: string; action: AuditAction; target?: string; details?: Record<string, unknown> }

export type UserFilter = 'all' | 'active' | 'trial' | 'inactive' | 'streamers' | 'blocked'
/** «Пользователи» by the country named at registration: «СНГ», «Европа», «Другие», «Не указана» (src/shared/countries.ts). */
export type RegionFilter = 'all' | CountryRegion | 'none'
/** Users per region tab, within the search and the status filter. */
export type RegionCounts = Record<RegionFilter, number>
export interface PaymentFilter {
  from?: string
  to?: string
  status?: 'pending' | 'succeeded' | 'canceled' | 'refunded'
  plan?: PlanId
  q?: string
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
  email: string
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
/** «Способ» in the CSV: ЮKassa, or «Архив» for a payment service that is no longer connected. */
const PROVIDER_NAME: Record<PaymentProvider, string> = { yookassa: 'ЮKassa', archive: 'Архив' }
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
const PAYMENT_SELECT = 'SELECT p.*, a.email AS email, i.email AS inviter_email, i.deleted_at AS inviter_deleted_at FROM payments p JOIN accounts a ON a.id = p.account_id LEFT JOIN accounts i ON i.id = a.invited_by'

/**
 * The condition of a region tab of «Пользователи» (owner, 13.10.2026: «в разделе пользователи, разделение снг и Европа»).
 * The lists are those of src/shared/countries.ts; «Другие» is every other country, «Не указана» an account without one.
 */
function regionCondition(region: Exclude<RegionFilter, 'all'>): { sql: string; args: string[] } {
  if (region === 'none') return { sql: 'a.country IS NULL', args: [] }
  if (region === 'cis') return { sql: `a.country IN (${placeholders(CIS_COUNTRIES)})`, args: [...CIS_COUNTRIES] }
  if (region === 'europe') return { sql: `a.country IN (${placeholders(EUROPE_COUNTRIES)})`, args: [...EUROPE_COUNTRIES] }
  const listed = [...CIS_COUNTRIES, ...EUROPE_COUNTRIES]
  return { sql: `a.country IS NOT NULL AND a.country NOT IN (${placeholders(listed)})`, args: listed }
}

export class AdminStore {
  private readonly db: DatabaseSync
  private readonly accounts: AccountStore
  private readonly payments: PaymentStore
  private readonly now: () => number

  constructor(accounts: AccountStore, payments: PaymentStore, options: { now?: () => number } = {}) {
    this.accounts = accounts
    this.payments = payments
    this.db = accounts.database
    this.now = options.now ?? accounts.clock
    if (payments.database !== this.db) throw new Error('AdminStore: accounts and payments must share one database')
    this.db.exec(SCHEMA)
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
      total: count('SELECT COUNT(*) AS n FROM accounts'),
      today: count('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?', today),
      days7: count('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?', now - 7 * DAY_MS),
      days30: count('SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ?', now - 30 * DAY_MS),
      blocked: count('SELECT COUNT(*) AS n FROM accounts WHERE blocked_at IS NOT NULL AND deleted_at IS NULL'),
    }
    const subscriptions = {
      active: count("SELECT COUNT(*) AS n FROM subscriptions s JOIN accounts a ON a.id = s.account_id WHERE a.kind = 'user' AND s.paid_until > ?", now),
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
    return {
      generatedAt: new Date(now).toISOString(),
      users,
      subscriptions,
      revenue: { today: revenueSince(today), month: revenueSince(monthStart), all: revenueSince(0) },
      payouts: { paid: rub(payouts.paid), pending: rub(payouts.pending), pendingRequests: Number(payouts.open), earned: rub(earned) },
    }
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
    for (const item of this.db.prepare(`SELECT ${key('created_at')} AS k, COUNT(*) AS n FROM accounts GROUP BY k`).all() as Row[]) {
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
    for (const item of this.db.prepare(`SELECT ${key('created_at')} AS k, COUNT(*) AS n FROM accounts WHERE created_at >= ? AND created_at < ? GROUP BY k`).all(start, end) as Row[]) {
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
      ? (this.db.prepare("SELECT r.kind, r.days, r.status, r.created_at, r.decided_at, i.email AS inviter FROM invite_rewards r JOIN accounts i ON i.id = r.inviter_id WHERE (r.created_at >= ? AND r.created_at < ?) OR (r.decided_at >= ? AND r.decided_at < ?) ORDER BY r.created_at, r.id LIMIT 200").all(start, end, start, end) as Row[])
        .map((row) => ({ inviter: String(row.inviter), kind: String(row.kind), days: row.kind === 'legend' ? 'lifetime' as const : Number(row.days), status: String(row.status), createdAt: iso(row.created_at)!, ...(row.decided_at == null ? {} : { decidedAt: iso(row.decided_at) }) }))
      : []
    return {
      date,
      totals: { registrations: summary.registrations, payments: summary.payments, revenue: summary.revenue, streamerEarnings: rub(earned), plans: summary.plans },
      registrations, payments, grants, invites,
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
    if (filter.from) { where.push('p.created_at >= ?'); args.push(mskDayRange(filter.from).start) }
    if (filter.to) { where.push('p.created_at < ?'); args.push(mskDayRange(filter.to).end) }
    if (filter.status) { where.push('p.status = ?'); args.push(filter.status) }
    if (filter.plan) { where.push('p.plan = ?'); args.push(filter.plan) }
    if (filter.q) { where.push("a.email LIKE ? ESCAPE '\\'"); args.push(likePattern(filter.q.toLowerCase())) }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
  }

  paymentList(filter: PaymentFilter, limit: number, offset: number) {
    const { sql, args } = this.paymentWhere(filter)
    const totals = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN p.amount ELSE 0 END), 0) AS revenue, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN COALESCE(p.streamer_earning, 0) ELSE 0 END), 0) AS earned FROM payments p JOIN accounts a ON a.id = p.account_id ${sql}`).get(...args) as Row
    const rows = this.db.prepare(`${PAYMENT_SELECT} ${sql} ORDER BY p.created_at DESC, p.rowid DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    return {
      payments: rows.map(toPayment),
      total: Number(totals.n),
      totals: { succeeded: Number(totals.ok), revenue: rub(totals.revenue), streamerEarnings: rub(totals.earned) },
    }
  }

  /** CSV for Excel (UTF-8 with BOM, «;» separated, Moscow time). Cells that look like formulas are neutralised. */
  paymentsCsv(filter: PaymentFilter, maxRows = 50_000) {
    const { sql, args } = this.paymentWhere(filter)
    const rows = this.db.prepare(`SELECT p.*, a.email AS email FROM payments p JOIN accounts a ON a.id = p.account_id ${sql} ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?`).all(...args, maxRows) as Row[]
    const header = ['Создан (МСК)', 'Оплачен (МСК)', 'E-mail', 'Тариф', 'Способ', 'Статус', 'Сумма, ₽', 'Сумма в валюте', 'Валюта', 'Автопродление', 'Код стримера', 'Доля стримера, ₽', 'ID платежа']
    const status: Record<string, string> = { pending: 'Ожидает', succeeded: 'Оплачен', canceled: 'Отменён' }
    const lines = [header, ...rows.map(toPayment).map((item) => [
      mskText(item.createdAt), item.paidAt ? mskText(item.paidAt) : '', item.email, item.plan, PROVIDER_NAME[item.provider], status[item.status] ?? item.status,
      money(item.amount), item.original ? money(item.original.amount) : '', item.original?.currency ?? '', item.renewal ? 'да' : '', item.referralCode ?? '',
      item.streamerEarning === undefined ? '' : money(item.streamerEarning), item.id,
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
    SELECT a.id, a.email, a.kind, a.created_at, a.referral_code, a.referred_by, a.referred_at, a.trial_ends_at, a.trial_pending_ms, a.trial_denied, a.blocked_at, a.last_seen_at, a.country, a.nicknames, s.paid_until,
      ${pcSeen} AS pc_seen_at,
      (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_count,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_total,
      (SELECT r.provider || '|' || r.status || '|' || r.plan FROM recurring_subscriptions r WHERE r.account_id = a.id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS autopay,
      e.eft_hint, e.bound_at AS eft_bound_at,
      a.invited_by, i.email AS inviter_email, i.nicknames AS inviter_nicknames, i.deleted_at AS inviter_deleted_at,
      CASE WHEN a.invited_by IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM payments p WHERE p.account_id = a.id AND p.discount_percent IS NOT NULL AND p.status IN ('succeeded', 'refunded')) END AS friend_discount_paid
    ${USER_FROM}`
  }

  /**
   * `region`: the tab of «Пользователи» by country. `regions` counts the users of every tab within the search and the
   * status filter (not the chosen tab), so the numbers stay put while the owner switches tabs.
   */
  users(q: string, filter: UserFilter, limit: number, offset: number, region: RegionFilter = 'all') {
    const now = this.now()
    // Deleted accounts (anonymous stubs kept for the payment records) are not users any more.
    const where: string[] = ['a.deleted_at IS NULL']
    const args: Array<string | number> = []
    if (q) {
      // The e-mail or the game nickname (owner, 13.10.2026: the nickname found by the PC app shows under each account).
      // A broken nicknames value never breaks the list: CASE reads JSON only when it is valid. The inviter's e-mail too
      // (owner, 14.10.2026): searching a player's e-mail also lists the friends who came with that player's code.
      const nick = ACCOUNT_MODES.map((mode) => `json_extract(a.nicknames, '$.${mode}') LIKE ? ESCAPE '\\'`).join(' OR ')
      where.push(`(a.email LIKE ? ESCAPE '\\' OR CASE WHEN json_valid(a.nicknames) THEN (${nick}) ELSE 0 END OR (i.email LIKE ? ESCAPE '\\' AND i.deleted_at IS NULL))`)
      args.push(likePattern(q.toLowerCase()), ...ACCOUNT_MODES.map(() => likePattern(q)), likePattern(q.toLowerCase()))
    }
    const active = "(a.kind = 'user' AND s.paid_until > ?)"
    const trial = "(a.kind = 'user' AND (s.paid_until IS NULL OR s.paid_until <= ?) AND COALESCE(a.trial_denied, 0) = 0 AND a.trial_ends_at > ?)"
    if (filter === 'active') { where.push(active); args.push(now) }
    if (filter === 'trial') { where.push(trial); args.push(now, now) }
    if (filter === 'inactive') { where.push("(a.kind = 'user' AND COALESCE(s.paid_until, 0) <= ? AND NOT (COALESCE(a.trial_denied, 0) = 0 AND COALESCE(a.trial_ends_at, 0) > ?))"); args.push(now, now) }
    if (filter === 'streamers') where.push("a.kind = 'streamer'")
    if (filter === 'blocked') where.push('a.blocked_at IS NOT NULL')
    const regions: RegionCounts = { all: 0, cis: 0, europe: 0, other: 0, none: 0 }
    for (const row of this.db.prepare(`SELECT a.country AS country, COUNT(*) AS n ${USER_FROM} WHERE ${where.join(' AND ')} GROUP BY a.country`).all(...args) as Row[]) {
      regions.all += Number(row.n)
      regions[row.country == null ? 'none' : regionOf(String(row.country))] += Number(row.n)
    }
    if (region !== 'all') {
      const condition = regionCondition(region)
      where.push(condition.sql)
      args.push(...condition.args)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n ${USER_FROM} ${clause}`).get(...args) as Row).n)
    const rows = this.db.prepare(`${this.userSelect()} ${clause} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    return { users: rows.map((row) => this.toUser(row)), total, regions }
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
      ...(nickname ? { nickname } : {}),
      ...(row.invited_by == null ? {} : { invitedBy: { ...inviterOf(row), discount: row.friend_discount_paid ? 'used' as const : Number(row.paid_count ?? 0) > 0 ? 'lost' as const : 'unused' as const } }),
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

  /** «Выдать / продлить подписку на N дней»: from the end of the running paid period (or now), logged with the reason. */
  grant(actor: string, id: string, days: number, reason: string) {
    const target = this.mustUser(id)
    transaction(this.db, () => {
      const before = this.payments.paidUntil(id)
      const until = Math.max(this.now(), before ?? 0) + days * DAY_MS
      this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(id, until)
      this.db.prepare('INSERT INTO owner_subscription_grants (account_id, days, reason, actor, at, paid_until_before, paid_until_after) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, days, reason, actor, this.now(), before ?? null, until)
      this.audit(actor, 'subscription.grant', target.email, { days, reason, paidUntil: new Date(until).toISOString() })
    })
    return this.user(id)
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
  return {
    id: String(row.id),
    email: String(row.email),
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
  }
}

const mskText = (value: string) => new Date(Date.parse(value) + MSK_MS).toISOString().slice(0, 16).replace('T', ' ')
const money = (value: number) => value.toFixed(2).replace('.', ',')
/** Quotes a CSV cell; a leading = + - @ (or tab / CR) is prefixed with «'» so Excel never runs it as a formula. */
function csvCell(raw: string) {
  const value = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(,\d+)?$/.test(raw) ? `'${raw}` : raw
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
