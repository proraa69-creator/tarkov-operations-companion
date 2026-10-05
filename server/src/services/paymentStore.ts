/**
 * Subscription payments: the payment history, paid periods and streamer shares.
 *
 * No payment provider is connected: ЮKassa and Lava.top were removed, so `enabled` is false, `plans()` is empty and
 * nothing can be bought on the site until a new provider is added. Everything recorded earlier stays: old payments
 * (provider 'yookassa' / 'lava' in the history), paid periods, the streamers' shares of them and their payouts. The
 * owner's «Выдать дни» grants and the referral trial work as before (AccountStore / AdminStore).
 *
 * TARKOV_STREAMER_PERCENT (passed by the owner's app) is the global streamer share, 0–100, 10 by default.
 */
import type { DatabaseSync } from 'node:sqlite'

export type PlanId = '1m' | '3m' | '6m' | '12m'
export const PLAN_MONTHS: Record<PlanId, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
const DAY_MS = 24 * 60 * 60 * 1000
/** Streamer share when TARKOV_STREAMER_PERCENT is not set (the owner's app sends 10 by default too). */
export const DEFAULT_STREAMER_PERCENT = 10

export interface PaymentConfig {
  /** Share of a referred user's payments credited to the streamer, 0–100. */
  streamerPercent: number
}

export function paymentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentConfig {
  const percent = Number(env.TARKOV_STREAMER_PERCENT ?? DEFAULT_STREAMER_PERCENT)
  return { streamerPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : DEFAULT_STREAMER_PERCENT }
}

/** `price` in roubles. */
export interface PlanView { id: PlanId; months: number; price: number | null; currency: 'RUB'; discountPercent: number }
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled'
export interface PaymentView {
  id: string
  plan: PlanId
  /** Major units of `currency`. */
  amount: number
  currency: string
  status: PaymentStatus
  createdAt: string
  paidAt?: string
  /** Who took the payment: 'yookassa' / 'lava' for the payments made before they were removed. */
  provider: string
  /** An automatic renewal. */
  renewal?: true
}

export class PaymentError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Row = Record<string, unknown>

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider_id TEXT UNIQUE,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    referral_code TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER);
  CREATE INDEX IF NOT EXISTS payments_account ON payments(account_id, created_at);
  CREATE INDEX IF NOT EXISTS payments_referral ON payments(referral_code, status);
  CREATE TABLE IF NOT EXISTS subscriptions (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    paid_until INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS streamer_percent_overrides (
    code TEXT PRIMARY KEY,
    percent REAL NOT NULL,
    updated_at INTEGER NOT NULL);
`
/** Columns added after the first release; older databases get them on start. */
const ADDED_COLUMNS: Array<[string, string]> = [
  ['consent_version', 'TEXT'],
  ['consent_at', 'INTEGER'],
  // The streamer's share is fixed when a payment succeeds, so a later change of the percent never rewrites history.
  ['streamer_percent', 'REAL'],
  ['streamer_earning', 'INTEGER'],
  // Payments v2: provider (NULL = ЮKassa), the paid currency and amount in its minor units (`amount` stays in kopecks
  // for statistics), the autopayment consent, and the renewal link / period of an automatic charge.
  ['provider', 'TEXT'],
  ['currency', 'TEXT'],
  ['amount_original', 'INTEGER'],
  ['autopay_consent_version', 'TEXT'],
  ['autopay_consent_at', 'INTEGER'],
  ['recurring_id', 'TEXT'],
  ['period_end', 'INTEGER'],
]

export class PaymentStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  readonly config: PaymentConfig | undefined

  constructor(db: DatabaseSync, config: PaymentConfig | undefined, options: { now?: () => number } = {}) {
    this.db = db
    this.config = config
    this.now = options.now ?? Date.now
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(payments)').all() as Row[]).map((row) => String(row.name)))
    for (const [name, type] of ADDED_COLUMNS) if (!columns.has(name)) this.db.exec(`ALTER TABLE payments ADD COLUMN ${name} ${type}`)
    // Payments that succeeded before the share was stored per payment keep the share in force today, once and for all.
    const percent = this.streamerPercent
    this.db.prepare("UPDATE payments SET streamer_percent = ?, streamer_earning = CAST(amount * ? / 100 AS INTEGER) WHERE status = 'succeeded' AND referral_code IS NOT NULL AND streamer_earning IS NULL").run(percent, percent)
    this.closeAutopayments()
  }

  /**
   * Autopayments of the removed providers can no longer be charged here: they are closed once, so nothing shows them
   * as active. A Lava.top subscription is renewed by Lava.top itself — it has to be cancelled in the Lava.top cabinet.
   */
  private closeAutopayments() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_subscriptions'").get()) return
    const lava = Number((this.db.prepare("SELECT COUNT(*) AS n FROM recurring_subscriptions WHERE status = 'active' AND provider = 'lava'").get() as Row).n)
    this.db.prepare("UPDATE recurring_subscriptions SET status = 'canceled', canceled_at = ?, method_id = NULL, next_attempt_at = NULL WHERE status = 'active'").run(this.now())
    if (lava) console.warn(`${lava} Lava.top subscription(s) were active: Lava.top keeps renewing them by itself — cancel them in the Lava.top cabinet.`)
  }

  /** Share of referred users' payments credited to the streamer now, 0–100. */
  get streamerPercent() {
    return this.config?.streamerPercent ?? DEFAULT_STREAMER_PERCENT
  }

  /**
   * The streamer's share for new payments, 0–100: the owner's individual percent for this code (admin panel), else the
   * global one. Applied when a payment succeeds and stored with it, so a change never rewrites earlier earnings.
   */
  percentFor(code: string) {
    const row = this.db.prepare('SELECT percent FROM streamer_percent_overrides WHERE code = ?').get(code) as Row | undefined
    const value = row == null ? NaN : Number(row.percent)
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : this.streamerPercent
  }

  /** Individual percents set by the owner, by code. */
  percentOverrides() {
    return new Map((this.db.prepare('SELECT code, percent FROM streamer_percent_overrides').all() as Row[]).map((row) => [String(row.code), Number(row.percent)]))
  }

  /** Sets (or with `null` removes) the individual percent of one streamer code. */
  setPercentOverride(code: string, percent: number | null) {
    if (percent === null) { this.db.prepare('DELETE FROM streamer_percent_overrides WHERE code = ?').run(code); return }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new PaymentError(400, 'Доля стримера: от 0 до 100 %')
    this.db.prepare('INSERT INTO streamer_percent_overrides (code, percent, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET percent = excluded.percent, updated_at = excluded.updated_at')
      .run(code, Math.round(percent * 10) / 10, this.now())
  }

  /** The shared database handle (payouts live next to the payments). */
  get database() {
    return this.db
  }

  /** Everything the streamer has earned (kopecks): the stored share of every succeeded referred payment. */
  streamerEarned(code: string) {
    return Number((this.db.prepare("SELECT COALESCE(SUM(streamer_earning), 0) AS total FROM payments WHERE referral_code = ? AND status = 'succeeded'").get(code) as Row).total)
  }

  /** Any way to pay is switched on (none is connected now). */
  get enabled() {
    return false
  }

  plans(): PlanView[] {
    return []
  }

  /** End of the paid period (ms), if the account ever paid. */
  paidUntil(accountId: string) {
    const row = this.db.prepare('SELECT paid_until FROM subscriptions WHERE account_id = ?').get(accountId) as Row | undefined
    return row ? Number(row.paid_until) : undefined
  }

  /** Streamer dashboard: referred users with an active paid period and their paid revenue (kopecks). */
  referralStats(code: string) {
    const active = Number((this.db.prepare('SELECT COUNT(*) AS n FROM subscriptions s JOIN accounts a ON a.id = s.account_id WHERE a.referred_by = ? AND s.paid_until > ?').get(code, this.now()) as Row).n)
    const revenue = Number((this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE referral_code = ? AND status = 'succeeded'").get(code) as Row).total)
    return { activeSubscriptions: active, revenue, earnings: this.streamerEarned(code) }
  }

  referralSeries(code: string, keySql: (column: string) => string) {
    const rows = this.db.prepare(`SELECT ${keySql('paid_at')} AS k, plan, COUNT(*) AS n, SUM(amount) AS total, COALESCE(SUM(streamer_earning), 0) AS earned FROM payments WHERE referral_code = ? AND status = 'succeeded' GROUP BY k, plan`).all(code) as Row[]
    const byKey = new Map<string, { key: string; payments: number; months: Record<string, number>; revenue: number; earnings: number }>()
    for (const row of rows) {
      const key = String(row.k)
      const entry = byKey.get(key) ?? { key, payments: 0, months: {}, revenue: 0, earnings: 0 }
      entry.payments += Number(row.n)
      entry.months[String(row.plan)] = (entry.months[String(row.plan)] ?? 0) + Number(row.n)
      entry.revenue += Number(row.total)
      entry.earnings += Number(row.earned)
      byKey.set(key, entry)
    }
    return [...byKey.values()]
  }

  /** The consent stored with a payment (tests, disputes). */
  consentOf(id: string) {
    const row = this.db.prepare('SELECT consent_version, consent_at FROM payments WHERE id = ?').get(id) as Row | undefined
    return row?.consent_version == null ? undefined : { version: String(row.consent_version), acceptedAt: new Date(Number(row.consent_at)).toISOString() }
  }

  list(accountId: string): PaymentView[] {
    // Lava invoices that were never paid stay out of the history (the buyer may just have closed the page).
    return (this.db.prepare("SELECT * FROM payments WHERE account_id = ? AND NOT (provider = 'lava' AND status = 'pending' AND created_at < ?) ORDER BY created_at DESC LIMIT 50").all(accountId, this.now() - DAY_MS) as Row[]).map(toView)
  }
}

function toView(row: Row): PaymentView {
  const currency = row.currency == null ? 'RUB' : String(row.currency)
  const original = row.amount_original == null ? undefined : Number(row.amount_original)
  return {
    id: String(row.id),
    plan: row.plan as PlanId,
    // What the payer paid in their currency; roubles are kept in `amount` for statistics.
    amount: (currency === 'RUB' ? Number(row.amount) : original ?? 0) / 100,
    currency,
    status: row.status as PaymentStatus,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    ...(row.paid_at == null ? {} : { paidAt: new Date(Number(row.paid_at)).toISOString() }),
    provider: row.provider == null ? 'yookassa' : String(row.provider),
    ...(row.recurring_id == null ? {} : { renewal: true as const }),
  }
}
