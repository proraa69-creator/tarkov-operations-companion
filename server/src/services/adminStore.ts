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
 * Lava.top payments are counted in roubles at the owner's rate (as for streamer shares) and also in their own currency.
 */
import type { DatabaseSync } from 'node:sqlite'
import { AccountError, periodKeySql, REFERRAL_TRIAL_MS, type AccountStore, type StatsPeriod } from './accountStore.js'
import { transaction } from './database.js'
import { PLAN_MONTHS, type PaymentStore, type PlanId } from './paymentStore.js'

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
  | 'subscription.grant' | 'autopay.cancel' | 'account.block' | 'account.unblock' | 'sessions.revoke'
  | 'streamer.percent' | 'streamer.link' | 'streamer.revoke' | 'streamer.invite' | 'payout.decide' | 'payout.limits' | 'payments.export' | 'device.revoke'
  | 'payment.lava-confirm' | 'server.update-check' | 'server.update-install' | 'server.rollback' | 'server.download-link'
  | 'payments.lava-settings' | 'payments.lava-test' | 'payments.yookassa-settings'
  | 'map.boss-place' | 'map.boss-remove' | 'invite.decide'

export interface AuditEntry { id: number; at: string; actor: string; action: AuditAction; target?: string; details?: Record<string, unknown> }

export type UserFilter = 'all' | 'active' | 'trial' | 'inactive' | 'streamers' | 'blocked'
export interface PaymentFilter {
  from?: string
  to?: string
  status?: 'pending' | 'succeeded' | 'canceled'
  provider?: 'yookassa' | 'lava'
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
  subscription: { status: 'active' | 'trial' | 'inactive'; paidUntil?: string; trialEndsAt?: string; lifetime?: true }
  autopay: { provider: string; status: string; plan: string } | null
  lastSeenAt?: string
  blockedAt?: string
  payments: { count: number; total: number }
}

export interface AdminPayment {
  id: string
  email: string
  plan: PlanId
  provider: 'yookassa' | 'lava'
  status: 'pending' | 'succeeded' | 'canceled'
  /** Roubles (Lava.top at the owner's rate). */
  amount: number
  /** What the payer paid in his currency (Lava.top: USD/EUR). */
  original?: { amount: number; currency: string }
  createdAt: string
  paidAt?: string
  renewal?: true
  referralCode?: string
  streamerEarning?: number
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
      trials: count("SELECT COUNT(*) AS n FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id WHERE a.kind = 'user' AND a.referred_at IS NOT NULL AND a.referred_at + ? > ? AND (s.paid_until IS NULL OR s.paid_until <= ?)", REFERRAL_TRIAL_MS, now, now),
      autopay: count("SELECT COUNT(*) AS n FROM recurring_subscriptions WHERE status = 'active'"),
      streamers: count("SELECT COUNT(*) AS n FROM accounts WHERE kind = 'streamer'"),
    }
    const revenueSince = (since: number) => {
      const row = this.db.prepare("SELECT COALESCE(SUM(CASE WHEN provider = 'lava' THEN 0 ELSE amount END), 0) AS yookassa, COALESCE(SUM(CASE WHEN provider = 'lava' THEN amount ELSE 0 END), 0) AS lava, COUNT(*) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ?").get(since) as Row
      return { yookassa: rub(row.yookassa), lava: rub(row.lava), total: rub(Number(row.yookassa) + Number(row.lava)), payments: Number(row.n) }
    }
    const lavaOriginal = (this.db.prepare("SELECT currency, COALESCE(SUM(amount_original), 0) AS total FROM payments WHERE status = 'succeeded' AND provider = 'lava' GROUP BY currency").all() as Row[])
      .map((row) => ({ currency: String(row.currency ?? ''), amount: rub(row.total) }))
    const payouts = this.tableExists('streamer_payouts')
      ? this.db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending, COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS open FROM streamer_payouts").get() as Row
      : { paid: 0, pending: 0, open: 0 }
    const earned = Number((this.db.prepare("SELECT COALESCE(SUM(streamer_earning), 0) AS n FROM payments WHERE status = 'succeeded'").get() as Row).n)
    return {
      generatedAt: new Date(now).toISOString(),
      users,
      subscriptions,
      revenue: { today: revenueSince(today), month: revenueSince(monthStart), all: revenueSince(0), lavaOriginal },
      payouts: { paid: rub(payouts.paid), pending: rub(payouts.pending), pendingRequests: Number(payouts.open), earned: rub(earned) },
    }
  }

  /** Registrations and payments per Moscow day (last 31), month (last 12) or year (all), newest first. */
  series(period: StatsPeriod) {
    const now = this.now()
    const length = PERIOD_LENGTH[period]
    type SeriesRow = { period: string; registrations: number; payments: number; revenue: number; yookassa: number; lava: number; plans: Record<PlanId, { count: number; revenue: number }> }
    const rows = new Map<string, SeriesRow>()
    const row = (key: string) => {
      let entry = rows.get(key)
      if (!entry) {
        entry = { period: key, registrations: 0, payments: 0, revenue: 0, yookassa: 0, lava: 0, plans: Object.fromEntries(PLAN_IDS.map((id) => [id, { count: 0, revenue: 0 }])) as SeriesRow['plans'] }
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
    for (const item of this.db.prepare(`SELECT ${key('paid_at')} AS k, plan, CASE WHEN provider = 'lava' THEN 'lava' ELSE 'yookassa' END AS p, COUNT(*) AS n, SUM(amount) AS total FROM payments WHERE status = 'succeeded' AND paid_at IS NOT NULL GROUP BY k, plan, p`).all() as Row[]) {
      if (String(item.k) < cutoff) continue
      const entry = row(String(item.k))
      const total = rub(item.total)
      entry.payments += Number(item.n)
      entry.revenue = Math.round((entry.revenue + total) * 100) / 100
      if (item.p === 'lava') entry.lava = Math.round((entry.lava + total) * 100) / 100
      else entry.yookassa = Math.round((entry.yookassa + total) * 100) / 100
      const plan = entry.plans[String(item.plan) as PlanId]
      if (plan) { plan.count += Number(item.n); plan.revenue = Math.round((plan.revenue + total) * 100) / 100 }
    }
    return [...rows.values()].filter((entry) => entry.period >= cutoff && entry.period <= today.slice(0, length)).sort((a, b) => b.period.localeCompare(a.period))
  }

  /**
   * «Календарь» in «Сводка»: every Moscow day of `month` (YYYY-MM) with registrations, succeeded payments and revenue
   * (ЮKassa / Lava separately, per plan). Days after today are included with zeros.
   */
  calendar(month: string) {
    const first = Date.parse(`${month}-01T00:00:00.000Z`)
    const next = new Date(first)
    next.setUTCMonth(next.getUTCMonth() + 1)
    const daysInMonth = Math.round((next.getTime() - first) / DAY_MS)
    const start = first - MSK_MS
    const end = next.getTime() - MSK_MS
    type Day = { date: string; registrations: number; payments: number; revenue: number; yookassa: number; lava: number; plans: Record<PlanId, { count: number; revenue: number }> }
    const days: Day[] = Array.from({ length: daysInMonth }, (_, index) => ({
      date: `${month}-${String(index + 1).padStart(2, '0')}`, registrations: 0, payments: 0, revenue: 0, yookassa: 0, lava: 0,
      plans: Object.fromEntries(PLAN_IDS.map((id) => [id, { count: 0, revenue: 0 }])) as Day['plans'],
    }))
    const byDate = new Map(days.map((day) => [day.date, day]))
    const key = periodKeySql('day')
    for (const item of this.db.prepare(`SELECT ${key('created_at')} AS k, COUNT(*) AS n FROM accounts WHERE created_at >= ? AND created_at < ? GROUP BY k`).all(start, end) as Row[]) {
      const day = byDate.get(String(item.k))
      if (day) day.registrations = Number(item.n)
    }
    for (const item of this.db.prepare(`SELECT ${key('paid_at')} AS k, plan, CASE WHEN provider = 'lava' THEN 'lava' ELSE 'yookassa' END AS p, COUNT(*) AS n, SUM(amount) AS total FROM payments WHERE status = 'succeeded' AND paid_at >= ? AND paid_at < ? GROUP BY k, plan, p`).all(start, end) as Row[]) {
      const day = byDate.get(String(item.k))
      if (!day) continue
      const total = rub(item.total)
      day.payments += Number(item.n)
      day.revenue = Math.round((day.revenue + total) * 100) / 100
      if (item.p === 'lava') day.lava = Math.round((day.lava + total) * 100) / 100
      else day.yookassa = Math.round((day.yookassa + total) * 100) / 100
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
    const registrations = (this.db.prepare(`SELECT id, email, kind, created_at, referred_by, ${hasInvites || this.hasColumn('accounts', 'invited_by') ? 'invited_by' : 'NULL AS invited_by'} FROM accounts WHERE created_at >= ? AND created_at < ? AND deleted_at IS NULL ORDER BY created_at, rowid LIMIT 200`).all(start, end) as Row[])
      .map((row) => ({
        id: String(row.id), email: String(row.email), kind: row.kind === 'streamer' ? 'streamer' as const : 'user' as const, createdAt: iso(row.created_at)!,
        ...(row.referred_by == null ? {} : { referredBy: String(row.referred_by) }),
        ...(row.invited_by == null ? {} : { invitedByFriend: true as const }),
      }))
    const payments = (this.db.prepare('SELECT p.*, a.email AS email FROM payments p JOIN accounts a ON a.id = p.account_id WHERE (p.created_at >= ? AND p.created_at < ?) OR (p.paid_at >= ? AND p.paid_at < ?) ORDER BY p.created_at, p.rowid LIMIT 500').all(start, end, start, end) as Row[]).map(toPayment)
    const earned = Number((this.db.prepare("SELECT COALESCE(SUM(streamer_earning), 0) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ? AND paid_at < ?").get(start, end) as Row).n)
    const grants = (this.db.prepare('SELECT g.*, a.email AS email FROM owner_subscription_grants g JOIN accounts a ON a.id = g.account_id WHERE g.at >= ? AND g.at < ? ORDER BY g.at, g.id').all(start, end) as Row[])
      .map((row) => ({ email: String(row.email), days: Number(row.days), reason: String(row.reason), actor: String(row.actor), at: iso(row.at)! }))
    const invites = hasInvites
      ? (this.db.prepare("SELECT r.kind, r.days, r.status, r.created_at, r.decided_at, i.email AS inviter FROM invite_rewards r JOIN accounts i ON i.id = r.inviter_id WHERE (r.created_at >= ? AND r.created_at < ?) OR (r.decided_at >= ? AND r.decided_at < ?) ORDER BY r.created_at, r.id LIMIT 200").all(start, end, start, end) as Row[])
        .map((row) => ({ inviter: String(row.inviter), kind: String(row.kind), days: row.kind === 'legend' ? 'lifetime' as const : Number(row.days), status: String(row.status), createdAt: iso(row.created_at)!, ...(row.decided_at == null ? {} : { decidedAt: iso(row.decided_at) }) }))
      : []
    return {
      date,
      totals: { registrations: summary.registrations, payments: summary.payments, revenue: summary.revenue, yookassa: summary.yookassa, lava: summary.lava, streamerEarnings: rub(earned), plans: summary.plans },
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
    if (filter.provider === 'lava') where.push("p.provider = 'lava'")
    if (filter.provider === 'yookassa') where.push("(p.provider IS NULL OR p.provider = 'yookassa')")
    if (filter.plan) { where.push('p.plan = ?'); args.push(filter.plan) }
    if (filter.q) { where.push("a.email LIKE ? ESCAPE '\\'"); args.push(likePattern(filter.q.toLowerCase())) }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
  }

  paymentList(filter: PaymentFilter, limit: number, offset: number) {
    const { sql, args } = this.paymentWhere(filter)
    const totals = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN p.amount ELSE 0 END), 0) AS revenue, COALESCE(SUM(CASE WHEN p.status = 'succeeded' AND p.provider = 'lava' THEN p.amount ELSE 0 END), 0) AS lava, COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN COALESCE(p.streamer_earning, 0) ELSE 0 END), 0) AS earned FROM payments p JOIN accounts a ON a.id = p.account_id ${sql}`).get(...args) as Row
    const rows = this.db.prepare(`SELECT p.*, a.email AS email FROM payments p JOIN accounts a ON a.id = p.account_id ${sql} ORDER BY p.created_at DESC, p.rowid DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    const revenue = Number(totals.revenue)
    const lava = Number(totals.lava)
    return {
      payments: rows.map(toPayment),
      total: Number(totals.n),
      totals: { succeeded: Number(totals.ok), revenue: rub(revenue), yookassa: rub(revenue - lava), lava: rub(lava), streamerEarnings: rub(totals.earned) },
    }
  }

  /** CSV for Excel (UTF-8 with BOM, «;» separated, Moscow time). Cells that look like formulas are neutralised. */
  paymentsCsv(filter: PaymentFilter, maxRows = 50_000) {
    const { sql, args } = this.paymentWhere(filter)
    const rows = this.db.prepare(`SELECT p.*, a.email AS email FROM payments p JOIN accounts a ON a.id = p.account_id ${sql} ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?`).all(...args, maxRows) as Row[]
    const header = ['Создан (МСК)', 'Оплачен (МСК)', 'E-mail', 'Тариф', 'Способ', 'Статус', 'Сумма, ₽', 'Сумма в валюте', 'Валюта', 'Автопродление', 'Код стримера', 'Доля стримера, ₽', 'ID платежа']
    const status: Record<string, string> = { pending: 'Ожидает', succeeded: 'Оплачен', canceled: 'Отменён' }
    const lines = [header, ...rows.map(toPayment).map((item) => [
      mskText(item.createdAt), item.paidAt ? mskText(item.paidAt) : '', item.email, item.plan, item.provider === 'lava' ? 'Lava.top' : 'ЮKassa', status[item.status] ?? item.status,
      money(item.amount), item.original ? money(item.original.amount) : '', item.original?.currency ?? '', item.renewal ? 'да' : '', item.referralCode ?? '',
      item.streamerEarning === undefined ? '' : money(item.streamerEarning), item.id,
    ])]
    return { csv: `\uFEFF${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`, rows: rows.length }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------------------------------------------------

  private static readonly USER_SELECT = `
    SELECT a.id, a.email, a.kind, a.created_at, a.referral_code, a.referred_by, a.referred_at, a.blocked_at, a.last_seen_at, s.paid_until,
      (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_count,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.account_id = a.id AND p.status = 'succeeded') AS paid_total,
      (SELECT r.provider || '|' || r.status || '|' || r.plan FROM recurring_subscriptions r WHERE r.account_id = a.id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS autopay
    FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id`

  users(q: string, filter: UserFilter, limit: number, offset: number) {
    const now = this.now()
    // Deleted accounts (anonymous stubs kept for the payment records) are not users any more.
    const where: string[] = ['a.deleted_at IS NULL']
    const args: Array<string | number> = []
    if (q) { where.push("a.email LIKE ? ESCAPE '\\'"); args.push(likePattern(q.toLowerCase())) }
    const active = "(a.kind = 'user' AND s.paid_until > ?)"
    const trial = "(a.kind = 'user' AND (s.paid_until IS NULL OR s.paid_until <= ?) AND a.referred_at IS NOT NULL AND a.referred_at + ? > ?)"
    if (filter === 'active') { where.push(active); args.push(now) }
    if (filter === 'trial') { where.push(trial); args.push(now, REFERRAL_TRIAL_MS, now) }
    if (filter === 'inactive') { where.push("(a.kind = 'user' AND COALESCE(s.paid_until, 0) <= ? AND NOT (a.referred_at IS NOT NULL AND a.referred_at + ? > ?))"); args.push(now, REFERRAL_TRIAL_MS, now) }
    if (filter === 'streamers') where.push("a.kind = 'streamer'")
    if (filter === 'blocked') where.push('a.blocked_at IS NOT NULL')
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id ${clause}`).get(...args) as Row).n)
    const rows = this.db.prepare(`${AdminStore.USER_SELECT} ${clause} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    return { users: rows.map((row) => this.toUser(row)), total }
  }

  /** One user with his last payments and the owner's manual grants. */
  user(id: string) {
    const row = this.db.prepare(`${AdminStore.USER_SELECT} WHERE a.id = ?`).get(id) as Row | undefined
    if (!row) throw new AccountError(404, 'Пользователь не найден')
    const payments = (this.db.prepare('SELECT p.*, a.email AS email FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.account_id = ? ORDER BY p.created_at DESC, p.rowid DESC LIMIT 20').all(id) as Row[]).map(toPayment)
    const grants = (this.db.prepare('SELECT * FROM owner_subscription_grants WHERE account_id = ? ORDER BY at DESC, id DESC LIMIT 20').all(id) as Row[])
      .map((grant) => ({ days: Number(grant.days), reason: String(grant.reason), actor: String(grant.actor), at: iso(grant.at)!, paidUntil: iso(grant.paid_until_after)! }))
    return { user: this.toUser(row), payments, grants }
  }

  private toUser(row: Row): AdminUser {
    const now = this.now()
    const kind = row.kind === 'streamer' ? 'streamer' : 'user'
    const paidUntil = row.paid_until == null ? undefined : Number(row.paid_until)
    const trialEnds = row.referred_at == null ? undefined : Number(row.referred_at) + REFERRAL_TRIAL_MS
    let subscription: AdminUser['subscription'] = { status: 'inactive', ...(paidUntil ? { paidUntil: iso(paidUntil) } : {}) }
    if (trialEnds !== undefined && trialEnds > now) subscription = { status: 'trial', trialEndsAt: iso(trialEnds) }
    if (paidUntil !== undefined && paidUntil > now) subscription = { status: 'active', paidUntil: iso(paidUntil) }
    if (kind === 'streamer') subscription = { status: 'active', lifetime: true }
    const [provider, status, plan] = row.autopay == null ? [] : String(row.autopay).split('|')
    const email = String(row.email)
    return {
      id: String(row.id),
      email,
      kind,
      ...(this.accounts.owners.has(email) ? { owner: true as const } : {}),
      createdAt: iso(row.created_at)!,
      ...(row.referred_by == null ? {} : { referredBy: String(row.referred_by) }),
      ...(row.referral_code == null ? {} : { referralCode: String(row.referral_code) }),
      subscription,
      autopay: provider ? { provider, status: status ?? '', plan: plan ?? '' } : null,
      ...(row.last_seen_at == null ? {} : { lastSeenAt: iso(row.last_seen_at) }),
      ...(row.blocked_at == null ? {} : { blockedAt: iso(row.blocked_at) }),
      payments: { count: Number(row.paid_count ?? 0), total: rub(row.paid_total) },
    }
  }

  private mustUser(id: string) {
    const row = this.db.prepare('SELECT id, email FROM accounts WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new AccountError(404, 'Пользователь не найден')
    return { id: String(row.id), email: String(row.email) }
  }

  // Lava.top diagnostics (events of the webhook, started-but-unconfirmed invoices, the owner's confirmation)

  lavaEvents() {
    return { configured: Boolean(this.payments.lava), events: this.payments.lavaWebhookLog(100), pending: this.payments.lavaPendingInvoices(50) }
  }

  /**
   * «Подтвердить и выдать подписку» for an amount-mismatch webhook row: the owner has checked the payment in the Lava
   * cabinet. Grants the stored plan once (PaymentStore.confirmLavaMismatch), audited as `payment.lava-confirm`.
   */
  confirmLavaMismatch(actor: string, logId: number) {
    const result = transaction(this.db, () => {
      const done = this.payments.confirmLavaMismatch(logId)
      if (!done.already) {
        const target = this.db.prepare('SELECT email FROM accounts WHERE id = ?').get(done.accountId) as Row | undefined
        this.audit(actor, 'payment.lava-confirm', target ? String(target.email) : done.accountId, { paymentId: done.paymentId, plan: done.plan, amount: done.amount / 100, currency: done.currency })
      }
      return done
    })
    return { already: result.already, paymentId: result.paymentId, ...this.lavaEvents() }
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

  /** «Отменить автопродление» for the user (ЮKassa: the saved method is deleted; Lava.top: cancelled through the API). */
  async cancelAutopay(actor: string, id: string) {
    const target = this.mustUser(id)
    await this.payments.cancelAutopay({ id: target.id, email: target.email })
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
    const lava = this.payments.lava?.config
    return {
      enabled: this.payments.enabled,
      providers: this.payments.providers(),
      plans: this.payments.plans(),
      yookassa: config ? { monthPrice: config.monthPrice, receipts: config.receipts, autopay: config.autopay === true, publicUrl: config.publicUrl ?? null } : null,
      lava: lava ? { currency: lava.currency, rubRate: lava.rubRate, paymentMethod: lava.paymentMethod ?? null, offerId: lava.offerId } : null,
      streamerPercent: this.payments.streamerPercent,
      trialDays: Math.round(REFERRAL_TRIAL_MS / DAY_MS),
    }
  }

  private tableExists(name: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
  }
}

function toPayment(row: Row): AdminPayment {
  const provider = row.provider === 'lava' ? 'lava' : 'yookassa'
  return {
    id: String(row.id),
    email: String(row.email),
    plan: String(row.plan) as PlanId,
    provider,
    status: String(row.status) as AdminPayment['status'],
    amount: rub(row.amount),
    ...(provider === 'lava' && row.amount_original != null ? { original: { amount: rub(row.amount_original), currency: String(row.currency ?? '') } } : {}),
    createdAt: iso(row.created_at)!,
    ...(row.paid_at == null ? {} : { paidAt: iso(row.paid_at) }),
    ...(row.recurring_id == null ? {} : { renewal: true as const }),
    ...(row.referral_code == null ? {} : { referralCode: String(row.referral_code) }),
    ...(row.streamer_earning == null ? {} : { streamerEarning: rub(row.streamer_earning) }),
  }
}

const mskText = (value: string) => new Date(Date.parse(value) + MSK_MS).toISOString().slice(0, 16).replace('T', ' ')
const money = (value: number) => value.toFixed(2).replace('.', ',')
/** Quotes a CSV cell; a leading = + - @ (or tab / CR) is prefixed with «'» so Excel never runs it as a formula. */
function csvCell(raw: string) {
  const value = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(,\d+)?$/.test(raw) ? `'${raw}` : raw
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
