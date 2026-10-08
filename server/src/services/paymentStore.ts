/**
 * Subscription payments.
 *
 * «Россия и СНГ» — ЮKassa (YooKassa API v3, https://yookassa.ru/developers/api): the signed-in user picks a plan on the
 * website → `create()` asks ЮKassa for a payment and returns its payment page → after paying, ЮKassa sends a webhook and
 * the user returns to the cabinet. Neither the webhook body nor the browser is trusted: `sync()` always re-reads the
 * payment from the ЮKassa API with the shop's secret key and only a `succeeded` payment with the expected amount and our
 * own metadata extends the subscription. Applying is idempotent (one payment extends once), so repeated webhooks and the
 * cabinet's own status checks are harmless.
 *
 * ЮKassa autopayments (YOOKASSA_AUTOPAY=1, off by default — the ЮKassa manager must switch recurring payments on for the
 * shop first): only when the payer ticked the separate, never pre-ticked «Согласен на автоматическое списание…» box
 * (376-ФЗ, from 01.03.2026) the first payment asks ЮKassa to save the payment method; its id is kept in
 * `recurring_subscriptions` with the consent version and time. `runRecurring()` (every hour, server/src/index.ts) charges
 * the same amount for the same period a day before the paid period ends, at most once per period, with a limited number
 * of retries. «Отменить автопродление» deletes the saved method id at once; nothing is charged after that.
 *
 * «Другие страны» — Lava.top (services/lavaTop.ts): the subscription and its renewals are run by Lava; its webhooks
 * (authenticated by the webhook key, idempotent) extend the paid period here — always by the plan stored with our
 * invoice / subscription, and only when the reported amount and currency match it (else lava_mismatches + the log).
 *
 * Configuration comes from the environment of the server process (the desktop app passes it from its encrypted
 * settings, electron/ownerAdmin.ts): YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, TARKOV_PRICE_MONTH_RUB, optional
 * YOOKASSA_RECEIPTS=1 (send a 54-ФЗ receipt with each payment), YOOKASSA_AUTOPAY=1, TARKOV_STREAMER_PERCENT and
 * TARKOV_PUBLIC_URL (the site address for the return link); LAVA_* for Lava.top (lavaTop.ts). Without a shop id, key
 * and price ЮKassa is switched off. Secret keys are never logged, stored in the database or sent to a client.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'
import { LavaClient, LavaError, lavaAuthSeen, lavaWebhookAuth, parseLavaEvent, type LavaConfig, type LavaEvent, type LavaPrices } from './lavaTop.js'

/** Results kept in lava_webhook_log (what the owner sees in «События Lava.top»). */
export type LavaWebhookResult = 'unauthorized' | 'bad-request' | 'ignored' | 'duplicate' | 'not-ours' | 'amount-mismatch' | 'already-applied' | 'paid' | 'failed' | 'error'
  | 'renewed' | 'renewal-failed' | 'cancelled'
export type LavaAuthMethod = 'none' | 'api-key' | 'basic'
/** The marker contract id of the desktop app's «Проверить вебхук» self-test (never a real invoice). */
export const LAVA_SELFTEST_PREFIX = 'raidos-selftest-'
export const LAVA_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
/** What a webhook call tells the log: filled in while the call is handled. Never keys, headers, e-mails or bodies. */
interface LavaLogContext {
  authMethod: LavaAuthMethod
  eventType?: string
  contractId?: string
  gotAmount?: number
  gotCurrency?: string
  expectedAmount?: number
  expectedCurrency?: string
  paymentId?: string
  selftest?: boolean
}
export interface LavaWebhookLogEntry {
  id: number
  at: string
  lastAt: string
  count: number
  result: string
  eventType?: string
  /** Last six characters of the contract id. */
  contract?: string
  got?: { amount?: number; currency?: string }
  expected?: { amount?: number; currency?: string }
  authMethod: LavaAuthMethod
  /** An amount-mismatch of a first payment that the owner can confirm. */
  confirmable: boolean
  confirmedAt?: string
}
export interface LavaPendingInvoice { paymentId: string; email: string; plan: PlanId; createdAt: string; ageMinutes: number; contract?: string; expected?: { amount: number; currency: string } }

export type PlanId = '1m' | '3m' | '6m' | '12m'
export const PLAN_MONTHS: Record<PlanId, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
/** The yearly plan is 33% cheaper than twelve monthly payments (docs/product-roadmap-and-business-model.md). */
const YEAR_DISCOUNT = 0.33
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const YOOKASSA_API = 'https://api.yookassa.ru/v3'
/** Streamer share when TARKOV_STREAMER_PERCENT is not set (the owner's app sends 10 by default too). */
export const DEFAULT_STREAMER_PERCENT = 10
/** ЮKassa autopayment: charge this long before the paid period ends (days add up, nothing is lost by paying early). */
export const RENEW_BEFORE_MS = DAY_MS
/** Failed automatic charges are retried once a day, at most this many attempts per period; then autopay stops. */
export const RENEW_MAX_ATTEMPTS = 3
export const RENEW_RETRY_MS = DAY_MS
/**
 * Lava.top charges on its own calendar (a month of 28–31 days, a year of 365 days), our plan months are 30 days. A Lava
 * payment therefore covers at least Lava's own period plus a few days of grace, so access never lapses between a
 * renewal that is due and its webhook.
 */
const LAVA_PERIOD_DAYS: Record<PlanId, number> = { '1m': 31, '3m': 90, '6m': 180, '12m': 365 }
export const LAVA_GRACE_MS = 3 * DAY_MS
/** «Upcoming charge» notice hook fires this long before the charge (e-mail is a TODO until a mail service exists). */
export const NOTICE_BEFORE_MS = 3 * DAY_MS

export interface PaymentConfig {
  shopId: string
  secretKey: string
  /** Price of one month in roubles. */
  monthPrice: number
  receipts: boolean
  /** Share of a referred user's payments credited to the streamer, 0–100. */
  streamerPercent: number
  /**
   * Public site address for ЮKassa's return link, e.g. https://tarkov.example.com (TARKOV_PUBLIC_URL; the owner's app
   * passes its permanent address, else the free link, else http://127.0.0.1:5202).
   */
  publicUrl?: string
  /** ЮKassa autopayments switched on by the owner (the shop must have recurring payments enabled by ЮKassa). */
  autopay?: boolean
}

/** A site origin for return links: https://host[:port], or this PC's own site (http://localhost / 127.0.0.1). */
const PUBLIC_URL = /^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1))(?::\d{1,5})?$/i

export function paymentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentConfig | undefined {
  const shopId = env.YOOKASSA_SHOP_ID?.trim() ?? ''
  const secretKey = env.YOOKASSA_SECRET_KEY?.trim() ?? ''
  const monthPrice = Number(env.TARKOV_PRICE_MONTH_RUB)
  if (!/^\d{1,12}$/.test(shopId) || !secretKey || !Number.isFinite(monthPrice) || monthPrice < 1) return undefined
  const percent = Number(env.TARKOV_STREAMER_PERCENT ?? DEFAULT_STREAMER_PERCENT)
  const publicUrl = env.TARKOV_PUBLIC_URL?.trim().replace(/\/+$/, '')
  return {
    shopId,
    secretKey,
    monthPrice: Math.round(monthPrice * 100) / 100,
    receipts: env.YOOKASSA_RECEIPTS === '1',
    streamerPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
    ...(publicUrl && PUBLIC_URL.test(publicUrl) ? { publicUrl } : {}),
    ...(env.YOOKASSA_AUTOPAY === '1' ? { autopay: true } : {}),
  }
}

/** Plan price in kopecks. */
export function planPrice(monthPrice: number, plan: PlanId) {
  const months = PLAN_MONTHS[plan]
  const full = monthPrice * months
  return Math.round((plan === '12m' ? full * (1 - YEAR_DISCOUNT) : full) * 100)
}

/** `price` in roubles, `null` when only foreign payments are on (the price is then shown by Lava.top). */
export interface PlanView { id: PlanId; months: number; price: number | null; currency: 'RUB'; discountPercent: number }
/** `refunded`: the money went back (ЮKassa refund, or marked by the owner); the paid days and shares are taken back. */
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled' | 'refunded'
export type PaymentProvider = 'yookassa' | 'lava'
export interface PaymentView {
  id: string
  plan: PlanId
  /** Major units of `currency` (roubles for ЮKassa, USD/EUR for Lava.top; 0 while a Lava invoice is unpaid). */
  amount: number
  currency: string
  status: PaymentStatus
  createdAt: string
  paidAt?: string
  provider: PaymentProvider
  /** An automatic renewal (ЮKassa autopayment or a Lava.top recurring charge). */
  renewal?: true
  /** «Пригласи друга»: the first month was paid with this discount, %. */
  discountPercent?: number
}
export type AutopayStatus = 'active' | 'canceled' | 'failed'
export interface AutopayView {
  provider: PaymentProvider
  plan: PlanId
  status: AutopayStatus
  /** Major units of `currency`: the amount the payer agreed to. */
  amount: number
  currency: string
  /** When the next automatic charge is expected (active only). */
  nextChargeAt?: string
  paidUntil?: string
  /** «Карта *4444», «СБП» … (ЮKassa). */
  method?: string
  consentVersion: string
  consentAt: string
  canceledAt?: string
}
/** What the notice hook receives (e-mail sending is a TODO — see `notify` in the constructor options). */
export interface AutopayNotice { type: 'upcoming' | 'charged' | 'failed' | 'stopped'; accountId: string; provider: PaymentProvider; amount: number; currency: string; at: string }

export class PaymentError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Row = Record<string, unknown>
type Fetch = typeof fetch

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
  CREATE TABLE IF NOT EXISTS recurring_subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    method_id TEXT,
    method_title TEXT,
    contract_id TEXT UNIQUE,
    referral_code TEXT,
    status TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    consent_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    noticed_until INTEGER,
    created_at INTEGER NOT NULL,
    canceled_at INTEGER);
  CREATE INDEX IF NOT EXISTS recurring_account ON recurring_subscriptions(account_id, created_at);
  CREATE TABLE IF NOT EXISTS lava_events (
    key TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS lava_mismatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payment_id TEXT,
    recurring_id TEXT,
    contract_id TEXT,
    expected_amount INTEGER,
    expected_currency TEXT,
    got_amount INTEGER,
    got_currency TEXT,
    received_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS lava_webhook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    result TEXT NOT NULL,
    event_type TEXT,
    contract_tail TEXT,
    got_amount INTEGER,
    got_currency TEXT,
    expected_amount INTEGER,
    expected_currency TEXT,
    auth_method TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    payment_id TEXT,
    selftest INTEGER NOT NULL DEFAULT 0,
    confirmed_at INTEGER);
  CREATE INDEX IF NOT EXISTS lava_webhook_log_at ON lava_webhook_log(received_at);
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
  // for statistics), the separate autopayment consent, and the renewal link / period of an automatic charge.
  ['provider', 'TEXT'],
  ['currency', 'TEXT'],
  ['amount_original', 'INTEGER'],
  ['autopay_consent_version', 'TEXT'],
  ['autopay_consent_at', 'INTEGER'],
  ['recurring_id', 'TEXT'],
  ['period_end', 'INTEGER'],
  // «Пригласи друга»: the plan price before the friend's discount and the discount itself (services/invites.ts), and a
  // digest of the card the payment was made with (first 6 + last 4 digits and expiry; never the number) for abuse checks.
  ['list_amount', 'INTEGER'],
  ['discount_percent', 'REAL'],
  ['method_key', 'TEXT'],
  ['refunded_at', 'INTEGER'],
]

/** A payment that has just succeeded (PaymentStore.onSucceeded). */
export interface SucceededPayment { id: string; accountId: string; plan: PlanId; amount: number; methodKey?: string }

const nullableText = (value: unknown) => (value == null ? null : String(value))
const rub = (kopecks: number) => (kopecks / 100).toFixed(2)
const monthsText = (months: number) => `${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}`

export class PaymentStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly fetch: Fetch
  private yooConfig: PaymentConfig | undefined
  get config() { return this.yooConfig }
  configureYookassa(config: PaymentConfig | undefined) { this.yooConfig = config }
  private lavaClient: LavaClient | undefined
  get lava() { return this.lavaClient }
  /** Applied only after the owner app persisted the settings; existing invoices keep their stored amounts. */
  configureLava(config: LavaConfig | undefined) { this.lavaClient = config ? new LavaClient(config) : undefined }
  private readonly notify: (notice: AutopayNotice) => void
  private renewing = false
  private readonly succeededListeners: Array<(payment: SucceededPayment) => void> = []

  private readonly refundedListeners: Array<(payment: { id: string; accountId: string; partial?: boolean }) => void> = []
  /** Called once per payment when it is refunded, inside the same transaction (services/invites.ts). */
  onRefunded(listener: (payment: { id: string; accountId: string; partial?: boolean }) => void) {
    this.refundedListeners.push(listener)
  }

  /**
   * The money of a succeeded payment went back: the payment becomes `refunded`, the plan's days are taken off the paid
   * period (never below now), the streamer's share of it is dropped and listeners (friend rewards) are told. Once only.
   */
  markRefunded(paymentId: string) {
    return transaction(this.db, () => {
      const row = this.db.prepare("SELECT * FROM payments WHERE id = ? AND status = 'succeeded'").get(paymentId) as Row | undefined
      if (!row) return false
      this.db.prepare("UPDATE payments SET status = 'refunded', refunded_at = ?, streamer_earning = 0 WHERE id = ? AND status = 'succeeded'").run(this.now(), paymentId)
      const accountId = String(row.account_id)
      const paidUntil = this.paidUntil(accountId)
      if (paidUntil !== undefined) {
        const until = Math.max(this.now(), paidUntil - PLAN_MONTHS[row.plan as PlanId] * MONTH_MS)
        this.db.prepare('UPDATE subscriptions SET paid_until = ? WHERE account_id = ?').run(until, accountId)
      }
      for (const listener of this.refundedListeners) {
        try { listener({ id: paymentId, accountId }) } catch (error) { console.error('Refund listener failed', error instanceof Error ? error.message : 'unknown error') }
      }
      return true
    })
  }

  /**
   * ЮKassa `refund.succeeded` webhook: the refund is re-read from the API (the body is only a hint) and a FULL refund
   * of one of our succeeded payments marks it refunded. A partial refund leaves the payment and the paid days to the owner
   * (logged), but listeners are told: a friend reward is cancelled by any refund (services/invites.ts).
   */
  async syncRefund(refundId: string) {
    if (!this.config || !/^[A-Za-z0-9-]{10,64}$/.test(refundId)) return
    const refund = await this.call('GET', `/refunds/${encodeURIComponent(refundId)}`)
    if (refund.status !== 'succeeded' || typeof refund.payment_id !== 'string') return
    const row = this.db.prepare("SELECT * FROM payments WHERE provider_id = ? AND (provider IS NULL OR provider = 'yookassa') AND status = 'succeeded'").get(refund.payment_id) as Row | undefined
    if (!row) return
    const amount = refund.amount as Row | undefined
    if (amount?.currency === 'RUB' && amount.value === rub(Number(row.amount))) this.markRefunded(String(row.id))
    else {
      console.warn(`ЮKassa partial refund ${refundId.slice(-6)} for payment ${String(row.id)}: ${String(amount?.value)} ${String(amount?.currency)} — not applied, check it by hand.`)
      this.partiallyRefunded(String(row.id))
    }
  }

  /** Part of a succeeded payment went back: the payment stays succeeded (the owner adjusts the days); listeners hear it. */
  partiallyRefunded(paymentId: string) {
    const row = this.db.prepare("SELECT account_id FROM payments WHERE id = ? AND status = 'succeeded'").get(paymentId) as Row | undefined
    if (!row) return false
    transaction(this.db, () => {
      for (const listener of this.refundedListeners) {
        try { listener({ id: paymentId, accountId: String(row.account_id), partial: true }) } catch (error) { console.error('Refund listener failed', error instanceof Error ? error.message : 'unknown error') }
      }
    })
    return true
  }

  /** Called once per payment when it succeeds, inside the same transaction (services/invites.ts). */
  onSucceeded(listener: (payment: SucceededPayment) => void) {
    this.succeededListeners.push(listener)
  }

  /** Whether the account has paid at least once. */
  hasSucceeded(accountId: string) {
    return this.db.prepare("SELECT 1 FROM payments WHERE account_id = ? AND status = 'succeeded'").get(accountId) !== undefined
  }

  /**
   * `notify`: called for autopayment notices (upcoming charge 3 days ahead, charged, failed, stopped).
   * TODO(e-mail): send these to the account's e-mail once a mail service (SendPulse / Unisender Go) is connected;
   * until then the cabinet shows the amount and date of the next charge and the hook does nothing.
   */
  constructor(db: DatabaseSync, config: PaymentConfig | undefined, options: { now?: () => number; fetch?: Fetch; lava?: LavaClient; notify?: (notice: AutopayNotice) => void } = {}) {
    this.db = db
    this.yooConfig = config
    this.lavaClient = options.lava
    this.now = options.now ?? Date.now
    this.fetch = options.fetch ?? fetch
    this.notify = options.notify ?? (() => {})
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(payments)').all() as Row[]).map((row) => String(row.name)))
    for (const [name, type] of ADDED_COLUMNS) if (!columns.has(name)) this.db.exec(`ALTER TABLE payments ADD COLUMN ${name} ${type}`)
    // Payments that succeeded before the share was stored per payment keep the share in force today, once and for all.
    const percent = this.streamerPercent
    this.db.prepare("UPDATE payments SET streamer_percent = ?, streamer_earning = CAST(amount * ? / 100 AS INTEGER) WHERE status = 'succeeded' AND referral_code IS NOT NULL AND streamer_earning IS NULL").run(percent, percent)
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

  /** Any way to pay is switched on. */
  get enabled() {
    return this.config !== undefined || this.lava !== undefined
  }

  /** Which regions can pay now, and whether ЮKassa autopayments are on. */
  providers() {
    return {
      yookassa: this.config !== undefined,
      lava: this.lava !== undefined,
      autopay: this.config?.autopay === true,
      ...(this.lava ? { lavaCurrency: this.lava.config.currency } : {}),
    }
  }

  /** Lava.top offer prices (major units), `null` if unknown — the cabinet then points to the Lava.top page. */
  async foreignPrices(): Promise<LavaPrices | null> {
    return this.lava ? this.lava.offerPrices() : null
  }

  plans(): PlanView[] {
    if (!this.enabled) return []
    const month = this.config?.monthPrice
    return (Object.keys(PLAN_MONTHS) as PlanId[]).map((id) => {
      const months = PLAN_MONTHS[id]
      if (month === undefined) return { id, months, price: null, currency: 'RUB', discountPercent: id === '12m' ? Math.round(YEAR_DISCOUNT * 100) : 0 }
      const price = planPrice(month, id) / 100
      return { id, months, price, currency: 'RUB', discountPercent: Math.round((1 - price / (month * months)) * 100) }
    })
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

  /**
   * Starts a ЮKassa payment; returns our payment id and the ЮKassa page the user is sent to. `consent` is the version of
   * the offer / personal data documents the payer accepted with the checkbox; it is stored with the payment. `autopay`
   * is the separate autopayment consent: only with it ЮKassa is asked to save the payment method.
   */
  async create(account: { id: string; email: string; referredBy?: string }, plan: PlanId, siteUrl: string, consent?: { version: string }, autopay?: { version: string }, discount?: { percent: number }) {
    const config = this.config
    if (!config) throw new PaymentError(503, 'Оплата пока не подключена')
    if (autopay && !config.autopay) throw new PaymentError(409, 'Автоплатежи пока не подключены — оплатите без автопродления')
    if (autopay) this.assertNoActiveAutopay(account.id)
    const id = randomBytes(12).toString('hex')
    const listAmount = planPrice(config.monthPrice, plan)
    // The friend's discount (services/invites.ts) is only for the first month.
    // …and for one payment only: not while another discounted payment of this account is open or already paid.
    const discountUsed = this.db.prepare("SELECT 1 FROM payments WHERE account_id = ? AND discount_percent IS NOT NULL AND (status IN ('succeeded', 'refunded') OR (status = 'pending' AND created_at > ?))").get(account.id, this.now() - DAY_MS) !== undefined
    const percent = discount && !discountUsed && plan === '1m' && discount.percent > 0 && discount.percent < 100 ? discount.percent : undefined
    const amount = percent === undefined ? listAmount : Math.round(listAmount * (100 - percent) / 100)
    const description = `Raid OS: подписка на ${monthsText(PLAN_MONTHS[plan])}${percent === undefined ? '' : ` (скидка ${percent} % по коду друга)`}`
    const body: Record<string, unknown> = {
      amount: { value: rub(amount), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `${siteUrl}/cabinet?payment=${id}` },
      description,
      metadata: { paymentId: id, accountId: account.id, plan },
      ...(autopay ? { save_payment_method: true } : {}),
    }
    if (config.receipts) body.receipt = receipt(account.email, description, amount)
    const now = this.now()
    this.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, referral_code, created_at, consent_version, consent_at, provider, currency, amount_original, autopay_consent_version, autopay_consent_at, list_amount, discount_percent) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'yookassa', 'RUB', ?, ?, ?, ?, ?)")
      .run(id, account.id, plan, amount, account.referredBy ?? null, now, consent?.version ?? null, consent ? now : null, amount, autopay?.version ?? null, autopay ? now : null, listAmount, percent ?? null)
    const answer = await this.call('POST', '/payments', body, randomUUID())
    const providerId = typeof answer.id === 'string' ? answer.id : ''
    const confirmation = answer.confirmation as Row | undefined
    const url = typeof confirmation?.confirmation_url === 'string' ? confirmation.confirmation_url : ''
    if (!providerId || !/^https:\/\//.test(url)) {
      this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").run(id)
      throw new PaymentError(502, 'ЮKassa вернула неожиданный ответ')
    }
    this.db.prepare('UPDATE payments SET provider_id = ? WHERE id = ?').run(providerId, id)
    return { paymentId: id, confirmationUrl: url }
  }

  /**
   * Starts a Lava.top subscription («Другие страны»). Lava renews it itself, so the separate autopayment consent is
   * required. Returns the Lava.top payment page.
   */
  async createLava(account: { id: string; email: string; referredBy?: string }, plan: PlanId, consent: { version: string }, autopay: { version: string } | undefined, language: 'RU' | 'EN') {
    const lava = this.lava
    if (!lava) throw new PaymentError(503, 'Оплата из других стран пока не подключена')
    if (!autopay) throw new PaymentError(400, 'Подписка через Lava.top продлевается автоматически: отметьте согласие на автоматическое списание')
    this.assertNoActiveAutopay(account.id)
    const id = randomBytes(12).toString('hex')
    const now = this.now()
    this.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, referral_code, created_at, consent_version, consent_at, provider, currency, autopay_consent_version, autopay_consent_at) VALUES (?, ?, ?, 0, 'pending', ?, ?, ?, ?, 'lava', ?, ?, ?)")
      .run(id, account.id, plan, account.referredBy ?? null, now, consent.version, now, lava.config.currency, autopay.version, now)
    try {
      const invoice = await lava.createInvoice({ email: account.email, plan, language })
      // The amount this invoice must be paid with (its webhook is checked against it): Lava's own answer, else the offer
      // price of the plan in the configured currency. Unknown stays NULL, and such a payment is never granted by webhook.
      const amount = invoice.amount ?? (!invoice.currency || invoice.currency === lava.config.currency ? (await lava.offerPrices())?.[plan] : undefined)
      this.db.prepare('UPDATE payments SET provider_id = ?, amount_original = ?, currency = COALESCE(?, currency) WHERE id = ?')
        .run(invoice.contractId, amount === undefined ? null : Math.round(amount * 100), invoice.currency ?? null, id)
      return { paymentId: id, confirmationUrl: invoice.paymentUrl }
    } catch (error) {
      this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").run(id)
      if (error instanceof LavaError) throw new PaymentError(error.status, error.message)
      if (error instanceof Error && /UNIQUE/.test(error.message)) throw new PaymentError(502, 'Lava.top вернула неожиданный ответ')
      throw error
    }
  }

  /** The user's own payment, re-checked with ЮKassa while it is pending (Lava.top payments arrive by webhook). */
  async status(accountId: string, id: string) {
    const row = this.db.prepare('SELECT * FROM payments WHERE id = ? AND account_id = ?').get(id, accountId) as Row | undefined
    if (!row) throw new PaymentError(404, 'Платёж не найден')
    if (row.status === 'pending' && row.provider_id && row.provider !== 'lava') await this.sync(String(row.provider_id)).catch(() => {})
    return toView(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Row)
  }

  /**
   * Webhook / status check: reads the payment from ЮKassa itself and applies it once. Unknown ids are ignored, so a
   * forged notification can at most make the server look up a payment that is not ours.
   */
  async sync(providerId: string) {
    if (!this.config || !/^[A-Za-z0-9-]{10,64}$/.test(providerId)) return
    const row = this.db.prepare("SELECT * FROM payments WHERE provider_id = ? AND (provider IS NULL OR provider = 'yookassa')").get(providerId) as Row | undefined
    if (!row || row.status !== 'pending') return
    this.applyYooKassa(row, await this.call('GET', `/payments/${encodeURIComponent(providerId)}`))
  }

  /** Applies a payment object read from the ЮKassa API (never from a webhook body) to our pending row. */
  private applyYooKassa(row: Row, remote: Row) {
    const metadata = remote.metadata as Row | undefined
    const amount = remote.amount as Row | undefined
    if (metadata?.paymentId !== row.id) return
    const recurringId = row.recurring_id == null ? undefined : String(row.recurring_id)
    if (remote.status === 'canceled') {
      const changed = this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(String(row.id))
      if (Number(changed.changes) && recurringId) this.renewalFailed(recurringId, String((remote.cancellation_details as Row | undefined)?.reason ?? ''))
      return
    }
    if (remote.status !== 'succeeded' || remote.paid !== true) return
    if (amount?.currency !== 'RUB' || amount.value !== rub(Number(row.amount))) return
    const method = remote.payment_method as Row | undefined
    transaction(this.db, () => {
      const key = method ? methodKey(method) : undefined
      if (key) this.db.prepare("UPDATE payments SET method_key = ? WHERE id = ? AND status = 'pending'").run(key, String(row.id))
      if (!this.markSucceeded(row, Number(row.amount), undefined, key)) return
      const accountId = String(row.account_id)
      this.extend(accountId, row.plan as PlanId)
      if (recurringId) {
        this.db.prepare('UPDATE recurring_subscriptions SET attempts = 0, next_attempt_at = NULL WHERE id = ?').run(recurringId)
        return
      }
      // First payment with the separate autopayment consent: keep the saved method (only if ЮKassa really saved it).
      if (row.autopay_consent_version != null && method?.saved === true && typeof method.id === 'string' && method.id) {
        this.db.prepare("UPDATE recurring_subscriptions SET status = 'canceled', canceled_at = ?, method_id = NULL WHERE account_id = ? AND status = 'active'").run(this.now(), accountId)
        this.db.prepare("INSERT INTO recurring_subscriptions (id, account_id, provider, plan, amount, currency, method_id, method_title, referral_code, status, consent_version, consent_at, created_at) VALUES (?, ?, 'yookassa', ?, ?, 'RUB', ?, ?, ?, 'active', ?, ?, ?)")
          .run(randomBytes(12).toString('hex'), accountId, String(row.plan), Number(row.list_amount ?? row.amount), method.id.slice(0, 64), methodTitle(method), nullableText(row.referral_code), String(row.autopay_consent_version), Number(row.autopay_consent_at), this.now())
      }
    })
  }

  /** pending → succeeded with the streamer's share fixed now; false if the row was already applied. */
  private markSucceeded(row: Row, rubKopecks: number, original?: { amount: number; currency: string }, methodKey?: string) {
    const percent = row.referral_code == null ? null : this.percentFor(String(row.referral_code))
    const earning = percent === null ? null : Math.floor(rubKopecks * percent / 100)
    const changed = this.db.prepare("UPDATE payments SET status = 'succeeded', paid_at = ?, amount = ?, streamer_percent = ?, streamer_earning = ?, amount_original = COALESCE(?, amount_original, ?), currency = COALESCE(?, currency, 'RUB') WHERE id = ? AND status = 'pending'")
      .run(this.now(), rubKopecks, percent, earning, original?.amount ?? null, rubKopecks, original?.currency ?? null, String(row.id))
    if (!Number(changed.changes)) return false
    const done: SucceededPayment = { id: String(row.id), accountId: String(row.account_id), plan: row.plan as PlanId, amount: rubKopecks, ...(methodKey ? { methodKey } : {}) }
    for (const listener of this.succeededListeners) {
      try { listener(done) } catch (error) { console.error('Payment listener failed', error instanceof Error ? error.message : 'unknown error') }
    }
    return true
  }

  /**
   * Adds the plan's period to the account, from the end of the current paid period if it is still running. `lava`:
   * at least Lava's own period plus grace from now (see LAVA_PERIOD_DAYS).
   */
  private extend(accountId: string, plan: PlanId, lava = false) {
    const from = Math.max(this.now(), this.paidUntil(accountId) ?? 0)
    const until = Math.max(from + PLAN_MONTHS[plan] * MONTH_MS, lava ? this.now() + LAVA_PERIOD_DAYS[plan] * DAY_MS + LAVA_GRACE_MS : 0)
    this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(accountId, until)
  }

  private assertNoActiveAutopay(accountId: string) {
    const current = this.currentRecurring(accountId)
    if (current?.status === 'active') throw new PaymentError(409, 'Автопродление уже включено. Чтобы сменить тариф или способ оплаты, сначала отмените автопродление')
  }

  private currentRecurring(accountId: string) {
    return this.db.prepare('SELECT * FROM recurring_subscriptions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(accountId) as Row | undefined
  }

  /** The account's autopayment / foreign subscription for the cabinet, or null. */
  autopay(accountId: string): AutopayView | null {
    const row = this.currentRecurring(accountId)
    if (!row) return null
    const paidUntil = this.paidUntil(accountId)
    const status = String(row.status) as AutopayStatus
    const provider = String(row.provider) as PaymentProvider
    const next = status === 'active' && paidUntil !== undefined
      ? provider === 'yookassa' ? Math.max(this.now(), paidUntil - RENEW_BEFORE_MS, Number(row.next_attempt_at ?? 0)) : paidUntil
      : undefined
    return {
      provider,
      plan: String(row.plan) as PlanId,
      status,
      amount: Number(row.amount) / 100,
      currency: String(row.currency),
      ...(next === undefined ? {} : { nextChargeAt: new Date(next).toISOString() }),
      // Only a period that still runs (the cabinet says «Подписка действует до …»).
      ...(paidUntil === undefined || paidUntil <= this.now() ? {} : { paidUntil: new Date(paidUntil).toISOString() }),
      ...(row.method_title == null ? {} : { method: String(row.method_title) }),
      consentVersion: String(row.consent_version),
      consentAt: new Date(Number(row.consent_at)).toISOString(),
      ...(row.canceled_at == null ? {} : { canceledAt: new Date(Number(row.canceled_at)).toISOString() }),
    }
  }

  /**
   * «Отменить автопродление» — one click in the cabinet. ЮKassa: the saved payment method id is deleted here at once,
   * so no further charge is possible. Lava.top: the subscription is cancelled through the Lava API first (if Lava
   * refuses, nothing changes and the user sees the reason). The paid period stays until its end.
   */
  async cancelAutopay(account: { id: string; email: string }) {
    const row = this.currentRecurring(account.id)
    if (!row || row.status !== 'active') throw new PaymentError(404, 'Автопродление не включено')
    if (row.provider === 'lava') {
      if (!this.lava) throw new PaymentError(503, 'Lava.top сейчас не подключена — напишите в поддержку, подписку отменят вручную')
      try {
        await this.lava.cancelSubscription(String(row.contract_id), account.email)
      } catch (error) {
        if (error instanceof LavaError) throw new PaymentError(error.status, error.message)
        throw error
      }
    }
    this.db.prepare("UPDATE recurring_subscriptions SET status = 'canceled', canceled_at = ?, method_id = NULL, next_attempt_at = NULL WHERE id = ? AND status = 'active'").run(this.now(), String(row.id))
    return this.autopay(account.id)
  }

  /**
   * ЮKassa autopayments, run every hour by the server. For each active autopayment whose paid period ends within
   * RENEW_BEFORE_MS: one charge of the agreed amount with the saved method (capture, receipt, Idempotence-Key), at most
   * one successful charge per period, failed charges retried daily up to RENEW_MAX_ATTEMPTS. Nothing is charged when
   * the owner switched autopayments off, without a stored consent or after «Отменить автопродление».
   */
  async runRecurring() {
    const summary = { charged: 0, pending: 0, failed: 0, noticed: 0 }
    const config = this.config
    if (!config?.autopay || this.renewing) return summary
    this.renewing = true
    try {
      const rows = this.db.prepare("SELECT r.*, s.paid_until AS paid_until, a.email AS email FROM recurring_subscriptions r JOIN subscriptions s ON s.account_id = r.account_id JOIN accounts a ON a.id = r.account_id WHERE r.provider = 'yookassa' AND r.status = 'active' AND r.method_id IS NOT NULL AND r.consent_version IS NOT NULL").all() as Row[]
      for (const rec of rows) {
        const recId = String(rec.id)
        const paidUntil = Number(rec.paid_until)
        const now = this.now()
        const pending = this.db.prepare("SELECT provider_id FROM payments WHERE recurring_id = ? AND status = 'pending'").get(recId) as Row | undefined
        if (pending) {
          // A charge of this period is still being processed by ЮKassa: only re-read it, never charge twice.
          if (pending.provider_id) await this.sync(String(pending.provider_id)).catch(() => {})
          summary.pending++
          continue
        }
        if (paidUntil - now > RENEW_BEFORE_MS) {
          if (paidUntil - now <= NOTICE_BEFORE_MS + RENEW_BEFORE_MS && Number(rec.noticed_until ?? 0) < paidUntil) {
            this.db.prepare('UPDATE recurring_subscriptions SET noticed_until = ? WHERE id = ?').run(paidUntil, recId)
            this.safeNotify({ type: 'upcoming', accountId: String(rec.account_id), provider: 'yookassa', amount: Number(rec.amount) / 100, currency: 'RUB', at: new Date(paidUntil - RENEW_BEFORE_MS).toISOString() })
            summary.noticed++
          }
          continue
        }
        if (rec.next_attempt_at != null && Number(rec.next_attempt_at) > now) continue
        const done = this.db.prepare("SELECT 1 FROM payments WHERE recurring_id = ? AND period_end = ? AND status = 'succeeded'").get(recId, paidUntil)
        if (done) continue
        const result = await this.charge(rec, paidUntil, config)
        summary[result]++
      }
    } finally {
      this.renewing = false
    }
    return summary
  }

  private async charge(rec: Row, periodEnd: number, config: PaymentConfig): Promise<'charged' | 'pending' | 'failed'> {
    const recId = String(rec.id)
    const plan = String(rec.plan) as PlanId
    const amount = Number(rec.amount)
    const id = randomBytes(12).toString('hex')
    const description = `Raid OS: автопродление подписки на ${monthsText(PLAN_MONTHS[plan])}`
    const body: Record<string, unknown> = {
      amount: { value: rub(amount), currency: 'RUB' },
      capture: true,
      payment_method_id: String(rec.method_id),
      description,
      metadata: { paymentId: id, accountId: String(rec.account_id), plan, recurringId: recId },
    }
    if (config.receipts) body.receipt = receipt(String(rec.email), description, amount)
    this.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, referral_code, created_at, consent_version, consent_at, provider, currency, amount_original, recurring_id, period_end, autopay_consent_version, autopay_consent_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, 'yookassa', 'RUB', ?, ?, ?, ?, ?)")
      .run(id, String(rec.account_id), plan, amount, nullableText(rec.referral_code), this.now(), amount, recId, periodEnd, String(rec.consent_version), Number(rec.consent_at))
    let answer: Row
    try {
      // The same key for the same period and attempt: a repeated request never creates a second charge at ЮKassa.
      answer = await this.call('POST', '/payments', body, `renew-${recId}-${periodEnd}-${Number(rec.attempts)}`)
    } catch {
      this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").run(id)
      this.renewalFailed(recId, '')
      return 'failed'
    }
    const providerId = typeof answer.id === 'string' ? answer.id : ''
    if (!providerId) {
      this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").run(id)
      this.renewalFailed(recId, '')
      return 'failed'
    }
    this.db.prepare('UPDATE payments SET provider_id = ? WHERE id = ?').run(providerId, id)
    const row = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Row
    this.applyYooKassa(row, answer)
    const status = String((this.db.prepare('SELECT status FROM payments WHERE id = ?').get(id) as Row).status)
    if (status === 'succeeded') {
      this.safeNotify({ type: 'charged', accountId: String(rec.account_id), provider: 'yookassa', amount: amount / 100, currency: 'RUB', at: new Date(this.now()).toISOString() })
      return 'charged'
    }
    return status === 'pending' ? 'pending' : 'failed'
  }

  /** One more failed attempt; the method is dropped at once if the payer revoked it, autopay stops after the limit. */
  private renewalFailed(recId: string, reason: string) {
    const rec = this.db.prepare('SELECT * FROM recurring_subscriptions WHERE id = ?').get(recId) as Row | undefined
    if (!rec || rec.status !== 'active') return
    const attempts = Number(rec.attempts) + 1
    const stop = reason === 'permission_revoked' || attempts >= RENEW_MAX_ATTEMPTS
    if (stop) this.db.prepare("UPDATE recurring_subscriptions SET attempts = ?, status = 'failed', method_id = NULL, next_attempt_at = NULL, canceled_at = ? WHERE id = ?").run(attempts, this.now(), recId)
    else this.db.prepare('UPDATE recurring_subscriptions SET attempts = ?, next_attempt_at = ? WHERE id = ?').run(attempts, this.now() + RENEW_RETRY_MS, recId)
    this.safeNotify({ type: stop ? 'stopped' : 'failed', accountId: String(rec.account_id), provider: 'yookassa', amount: Number(rec.amount) / 100, currency: 'RUB', at: new Date(this.now()).toISOString() })
  }

  private safeNotify(notice: AutopayNotice) {
    try { this.notify(notice) } catch { /* a notice never breaks payments */ }
  }

  /**
   * POST /v1/payments/lava/webhook. Returns the HTTP status to answer: 401 without the webhook key, 400 for a body that
   * is not a Lava event, 200 otherwise (also for duplicates and events that are not ours, so Lava stops retrying).
   * Each event is applied once (lava_events keeps its key); an error rolls the whole event back for Lava to retry.
   */
  lavaWebhook(headers: { apiKey?: string; authorization?: string }, body: unknown): { status: number; result: string } {
    const seen = lavaAuthSeen(headers)
    const ctx: LavaLogContext = { authMethod: seen }
    let outcome: { status: number; result: string }
    try {
      outcome = this.handleLavaWebhook(headers, body, ctx)
    } catch {
      // The transaction was rolled back; Lava retries on 500.
      outcome = { status: 500, result: 'error' }
    }
    try { this.logLavaWebhook(outcome.result as LavaWebhookResult, ctx) } catch { /* the log never breaks a payment */ }
    return outcome
  }

  private handleLavaWebhook(headers: { apiKey?: string; authorization?: string }, body: unknown, ctx: LavaLogContext): { status: number; result: string } {
    const matched = this.lava ? lavaWebhookAuth(headers, this.lava.config.webhookKey) : undefined
    if (!this.lava || !matched) return { status: 401, result: 'unauthorized' }
    ctx.authMethod = matched
    const event = parseLavaEvent(body)
    if (!event) return { status: 400, result: 'bad-request' }
    ctx.eventType = event.type.replace(/[^\w.:-]/g, '?').slice(0, 40) || undefined
    const contract = event.contractId ?? event.parentContractId
    if (contract) {
      ctx.contractId = contract
      ctx.selftest = contract.startsWith(LAVA_SELFTEST_PREFIX)
    }
    if (event.amount !== undefined && Math.abs(event.amount) < 1e9) ctx.gotAmount = Math.round(event.amount * 100)
    if (event.currency && /^[A-Z]{2,8}$/.test(event.currency)) ctx.gotCurrency = event.currency
    if (event.kind === 'unknown' || (!event.contractId && !event.parentContractId)) return { status: 200, result: 'ignored' }
    const key = [event.type, event.eventId ?? '', event.contractId ?? '', event.parentContractId ?? '', /fail/.test(event.kind) ? event.timestamp ?? '' : ''].join('|').slice(0, 400)
    return transaction(this.db, () => {
      const inserted = this.db.prepare('INSERT INTO lava_events (key, received_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(key, this.now())
      if (!Number(inserted.changes)) return { status: 200, result: 'duplicate' }
      return { status: 200, result: this.applyLava(event, ctx) }
    })
  }

  private lastLavaPrune = 0

  /**
   * One row per webhook call, whatever its result (lava_webhook_log). Repeated unauthorized calls with the same
   * credential kind within a minute collapse into one row with a counter (a scanner cannot fill the table). Only the
   * last six characters of the contract id are kept; keys, headers, e-mails and bodies never are. 90 days retention.
   */
  private logLavaWebhook(result: LavaWebhookResult, ctx: LavaLogContext) {
    const now = this.now()
    if (now - this.lastLavaPrune > 60 * 60 * 1000) {
      this.lastLavaPrune = now
      this.db.prepare('DELETE FROM lava_webhook_log WHERE received_at < ?').run(now - LAVA_LOG_RETENTION_MS)
    }
    if (result === 'unauthorized') {
      const same = this.db.prepare("SELECT id FROM lava_webhook_log WHERE result = 'unauthorized' AND auth_method = ? AND last_at > ? ORDER BY id DESC LIMIT 1").get(ctx.authMethod, now - 60_000) as Row | undefined
      if (same) {
        this.db.prepare('UPDATE lava_webhook_log SET count = count + 1, last_at = ? WHERE id = ?').run(now, Number(same.id))
        return
      }
    }
    this.db.prepare('INSERT INTO lava_webhook_log (received_at, last_at, result, event_type, contract_tail, got_amount, got_currency, expected_amount, expected_currency, auth_method, payment_id, selftest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(now, now, result, ctx.eventType ?? null, ctx.contractId ? ctx.contractId.slice(-6) : null, ctx.gotAmount ?? null, ctx.gotCurrency ?? null, ctx.expectedAmount ?? null, ctx.expectedCurrency ?? null, ctx.authMethod, ctx.paymentId ?? null, ctx.selftest ? 1 : 0)
    if (!ctx.selftest && (result === 'unauthorized' || result === 'not-ours' || result === 'error')) {
      const why = result === 'unauthorized' ? `key not accepted (credential seen: ${ctx.authMethod}${this.lava ? '' : '; Lava.top is not configured on this server'})` : result === 'not-ours' ? 'no invoice of ours for this contract' : 'handler failed, answered 500 for a retry'
      console.warn(`Lava.top webhook ${result}: ${why}${ctx.eventType ? `, event ${ctx.eventType}` : ''}${ctx.contractId ? `, contract …${ctx.contractId.slice(-6)}` : ''}`)
    }
  }

  /** The newest real (not self-test) webhook call, for the desktop app's status line. */
  lastLavaWebhook(): { at: string; result: string; eventType?: string } | null {
    const row = this.db.prepare('SELECT last_at, result, event_type FROM lava_webhook_log WHERE selftest = 0 ORDER BY id DESC LIMIT 1').get() as Row | undefined
    return row ? { at: new Date(Number(row.last_at)).toISOString(), result: String(row.result), ...(row.event_type ? { eventType: String(row.event_type) } : {}) } : null
  }

  /** The last webhook calls, newest first (owner panel «События Lava.top»); self-tests are left out. */
  lavaWebhookLog(limit = 100): LavaWebhookLogEntry[] {
    const rows = this.db.prepare('SELECT * FROM lava_webhook_log WHERE selftest = 0 ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(500, limit))) as Row[]
    const iso = (value: unknown) => new Date(Number(value)).toISOString()
    const money = (amount: unknown, currency: unknown) => (amount == null && currency == null ? undefined : { ...(amount == null ? {} : { amount: Number(amount) / 100 }), ...(currency == null ? {} : { currency: String(currency) }) })
    return rows.map((row) => {
      const got = money(row.got_amount, row.got_currency)
      const expected = money(row.expected_amount, row.expected_currency)
      return {
        id: Number(row.id), at: iso(row.received_at), lastAt: iso(row.last_at), count: Number(row.count), result: String(row.result),
        ...(row.event_type ? { eventType: String(row.event_type) } : {}), ...(row.contract_tail ? { contract: String(row.contract_tail) } : {}),
        ...(got ? { got } : {}), ...(expected ? { expected } : {}), authMethod: String(row.auth_method) as LavaAuthMethod,
        confirmable: row.result === 'amount-mismatch' && row.payment_id != null && row.confirmed_at == null,
        ...(row.confirmed_at == null ? {} : { confirmedAt: iso(row.confirmed_at) }),
      }
    })
  }

  /** Lava invoices that were started and not confirmed (newest first): the buyer may have left the page, or the webhook never arrived. */
  lavaPendingInvoices(limit = 50): LavaPendingInvoice[] {
    const now = this.now()
    const rows = this.db.prepare("SELECT p.id, p.plan, p.created_at, p.provider_id, p.amount_original, p.currency, a.email FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.provider = 'lava' AND p.status = 'pending' AND p.recurring_id IS NULL ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?").all(Math.max(1, Math.min(200, limit))) as Row[]
    return rows.map((row) => ({
      paymentId: String(row.id), email: String(row.email), plan: row.plan as PlanId, createdAt: new Date(Number(row.created_at)).toISOString(), ageMinutes: Math.max(0, Math.floor((now - Number(row.created_at)) / 60_000)),
      ...(row.provider_id ? { contract: String(row.provider_id).slice(-6) } : {}),
      ...(row.amount_original == null ? {} : { expected: { amount: Number(row.amount_original) / 100, currency: String(row.currency ?? '') } }),
    }))
  }

  private rubOf(minor: number, currency: string, fallbackMinor?: number, fallbackCurrency?: string): number {
    const rate = this.lava!.config.rubRate
    const config = this.lava!.config.currency
    if (currency === 'RUB') return minor
    if (currency === config) return Math.round(minor * rate)
    // A currency we have no rate for: count the invoice's own (expected) amount, else nothing.
    return fallbackMinor !== undefined && fallbackCurrency === config ? Math.round(fallbackMinor * rate) : 0
  }

  /**
   * The owner's «Подтвердить и выдать подписку» for an amount-mismatch row of a FIRST payment: the owner has checked in
   * the Lava cabinet that the payment is genuine. Grants exactly the plan stored with our invoice, once: the payment is
   * marked succeeded with the amount the webhook reported, the same way a matching webhook would. Idempotent (a second
   * call, or a payment that was applied meanwhile, grants nothing and answers `already`). Call it inside a transaction
   * together with the audit entry (AdminStore.confirmLavaMismatch).
   */
  confirmLavaMismatch(logId: number): { already: boolean; paymentId: string; accountId: string; plan: PlanId; amount: number; currency: string } {
    const log = this.db.prepare('SELECT * FROM lava_webhook_log WHERE id = ? AND selftest = 0').get(logId) as Row | undefined
    if (!log || log.result !== 'amount-mismatch' || log.payment_id == null) throw new PaymentError(404, 'Не найдено')
    const payment = this.db.prepare("SELECT * FROM payments WHERE id = ? AND provider = 'lava'").get(String(log.payment_id)) as Row | undefined
    if (!payment) throw new PaymentError(404, 'Не найдено')
    const plan = payment.plan as PlanId
    const view = (already: boolean, amount: number, currency: string) => ({ already, paymentId: String(payment.id), accountId: String(payment.account_id), plan, amount, currency })
    if (log.confirmed_at != null || payment.status !== 'pending') {
      const amount = payment.amount_original == null ? 0 : Number(payment.amount_original)
      return view(true, amount, String(payment.currency ?? ''))
    }
    // The amount the webhook reported (the owner has seen it in the list); without one there is nothing to record.
    if (log.got_amount == null) throw new PaymentError(409, 'В уведомлении Lava.top не было суммы: выдайте подписку вручную в карточке пользователя')
    const minor = Number(log.got_amount)
    const currency = String(log.got_currency ?? log.expected_currency ?? payment.currency ?? this.lava!.config.currency)
    const expectedMinor = log.expected_amount == null ? undefined : Number(log.expected_amount)
    this.markSucceeded(payment, this.rubOf(minor, currency, expectedMinor, log.expected_currency == null ? undefined : String(log.expected_currency)), { amount: minor, currency })
    this.finishLavaFirstPayment(payment, minor, currency)
    this.db.prepare('UPDATE lava_webhook_log SET confirmed_at = ? WHERE id = ?').run(this.now(), logId)
    return view(false, minor, currency)
  }

  /** After a first Lava payment succeeded: the access period and, with the autopay consent, the renewal record. */
  private finishLavaFirstPayment(row: Row, minor: number, currency: string, hasRecurring = this.db.prepare("SELECT 1 FROM recurring_subscriptions WHERE provider = 'lava' AND contract_id = ?").get(String(row.provider_id)) !== undefined) {
    const accountId = String(row.account_id)
    const plan = row.plan as PlanId
    this.extend(accountId, plan, true)
    if (row.autopay_consent_version != null && row.provider_id != null && !hasRecurring) {
      this.db.prepare("UPDATE recurring_subscriptions SET status = 'canceled', canceled_at = ?, method_id = NULL WHERE account_id = ? AND status = 'active'").run(this.now(), accountId)
      this.db.prepare("INSERT INTO recurring_subscriptions (id, account_id, provider, plan, amount, currency, contract_id, referral_code, status, consent_version, consent_at, created_at) VALUES (?, ?, 'lava', ?, ?, ?, ?, ?, 'active', ?, ?, ?)")
        .run(randomBytes(12).toString('hex'), accountId, plan, minor, currency, String(row.provider_id), nullableText(row.referral_code), String(row.autopay_consent_version), Number(row.autopay_consent_at), this.now())
    }
  }

  /**
   * Whether a Lava payment event agrees with what we stored when the invoice / subscription was made. The webhook body
   * never decides the plan or the amount: it may only confirm them. A reported amount or currency that differs, or an
   * invoice whose amount was never known, is not granted; the mismatch is stored in lava_mismatches and logged.
   */
  private lavaAgrees(event: LavaEvent, expected: { amount?: number; currency: string }, ref: { paymentId?: string; recurringId?: string }) {
    const got = event.amount === undefined ? undefined : Math.round(event.amount * 100)
    if (expected.amount !== undefined && (got === undefined || got === expected.amount) && (event.currency === undefined || event.currency === expected.currency)) return true
    this.db.prepare('INSERT INTO lava_mismatches (event_type, payment_id, recurring_id, contract_id, expected_amount, expected_currency, got_amount, got_currency, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(event.type, ref.paymentId ?? null, ref.recurringId ?? null, event.contractId ?? event.parentContractId ?? null, expected.amount ?? null, expected.currency, got ?? null, event.currency ?? null, this.now())
    const money = (minor: number | undefined, currency: string | undefined) => (minor === undefined ? 'unknown' : `${(minor / 100).toFixed(2)} ${currency ?? '?'}`)
    console.warn(`Lava.top ${event.type.replace(/[^\w.:-]/g, '?')} (${ref.paymentId ? `payment ${ref.paymentId}` : `subscription ${ref.recurringId}`}) NOT applied: webhook ${money(got, event.currency)}, expected ${money(expected.amount, expected.currency)}. Check it in Lava.top; add the days by hand if the payment is genuine.`)
    return false
  }

  private applyLava(event: LavaEvent, ctx: LavaLogContext): string {
    const rubOf = (minor: number, currency: string) => this.rubOf(minor, currency)
    const lava = this.lava!
    const findRecurring = () => {
      for (const id of [event.parentContractId, event.contractId]) {
        if (!id) continue
        const row = this.db.prepare("SELECT * FROM recurring_subscriptions WHERE provider = 'lava' AND contract_id = ?").get(id) as Row | undefined
        if (row) return row
      }
      return undefined
    }
    switch (event.kind) {
      case 'payment.success': {
        const row = this.findLavaPayment(event)
        if (!row) return 'not-ours'
        const currency = String(row.currency ?? lava.config.currency)
        const expected = row.amount_original == null ? undefined : Number(row.amount_original)
        ctx.paymentId = String(row.id)
        if (expected !== undefined) ctx.expectedAmount = expected
        ctx.expectedCurrency = currency
        if (row.status !== 'pending') return 'already-applied'
        // The plan, amount and currency of our own invoice; the webhook only confirms them (lavaAgrees).
        if (!this.lavaAgrees(event, { amount: expected, currency }, { paymentId: String(row.id) }) || expected === undefined) return 'amount-mismatch'
        const minor = expected
        this.markSucceeded(row, rubOf(minor, currency), { amount: minor, currency })
        this.finishLavaFirstPayment(row, minor, currency, findRecurring() !== undefined)
        return 'paid'
      }
      case 'recurring.success': {
        const rec = findRecurring()
        if (!rec) return 'not-ours'
        ctx.expectedAmount = Number(rec.amount)
        ctx.expectedCurrency = String(rec.currency)
        const providerId = event.contractId && event.contractId !== rec.contract_id ? event.contractId : `${String(rec.contract_id)}:${event.timestamp ?? this.now()}`
        if (this.db.prepare('SELECT 1 FROM payments WHERE provider_id = ?').get(providerId)) return 'already-applied'
        // A renewal of the subscription the payer agreed to: its plan, amount and currency (never the webhook's).
        const currency = String(rec.currency)
        const minor = Number(rec.amount)
        if (!this.lavaAgrees(event, { amount: minor, currency }, { recurringId: String(rec.id) })) return 'amount-mismatch'
        const plan = rec.plan as PlanId
        const id = randomBytes(12).toString('hex')
        this.db.prepare("INSERT INTO payments (id, account_id, provider_id, plan, amount, status, referral_code, created_at, provider, currency, amount_original, recurring_id, autopay_consent_version, autopay_consent_at) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, 'lava', ?, ?, ?, ?, ?)")
          .run(id, String(rec.account_id), providerId, plan, nullableText(rec.referral_code), this.now(), currency, minor, String(rec.id), String(rec.consent_version), Number(rec.consent_at))
        this.markSucceeded(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Row, rubOf(minor, currency), { amount: minor, currency })
        this.extend(String(rec.account_id), plan, true)
        this.db.prepare('UPDATE recurring_subscriptions SET attempts = 0 WHERE id = ?').run(String(rec.id))
        return 'renewed'
      }
      case 'recurring.failed': {
        const rec = findRecurring()
        if (!rec) return 'not-ours'
        // Lava retries and cancels by itself; only counted here for the owner.
        this.db.prepare('UPDATE recurring_subscriptions SET attempts = attempts + 1 WHERE id = ?').run(String(rec.id))
        return 'renewal-failed'
      }
      case 'payment.failed': {
        const row = this.findLavaPayment(event)
        if (!row || row.status !== 'pending') return 'not-ours'
        this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(String(row.id))
        return 'failed'
      }
      case 'subscription.cancelled': {
        const rec = findRecurring()
        if (!rec) return 'not-ours'
        // The renewal stops; the paid period stays until its end.
        this.db.prepare("UPDATE recurring_subscriptions SET status = 'canceled', canceled_at = COALESCE(canceled_at, ?) WHERE id = ? AND status = 'active'").run(this.now(), String(rec.id))
        return 'cancelled'
      }
      default:
        return 'ignored'
    }
  }

  /**
   * Our Lava payment for an event: by the contract id Lava returned for the invoice; if Lava reports a different id,
   * the only pending Lava invoice of that buyer's e-mail from the last two days (never a guess between several).
   */
  private findLavaPayment(event: LavaEvent) {
    for (const id of [event.contractId, event.parentContractId]) {
      if (!id) continue
      const row = this.db.prepare("SELECT * FROM payments WHERE provider = 'lava' AND provider_id = ?").get(id) as Row | undefined
      if (row) return row
    }
    if (!event.email) return undefined
    const rows = this.db.prepare("SELECT p.* FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.provider = 'lava' AND p.status = 'pending' AND p.recurring_id IS NULL AND lower(a.email) = ? AND p.created_at > ?").all(event.email, this.now() - 2 * DAY_MS) as Row[]
    return rows.length === 1 ? rows[0] : undefined
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, idempotenceKey?: string): Promise<Row> {
    const config = this.config!
    let response: Response
    try {
      response = await this.fetch(`${YOOKASSA_API}${path}`, {
        method,
        signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}`,
          'content-type': 'application/json',
          ...(idempotenceKey ? { 'idempotence-key': idempotenceKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new PaymentError(502, 'ЮKassa недоступна, попробуйте позже')
    }
    const result = await response.json().catch(() => ({})) as Row
    if (!response.ok) {
      // ЮKassa explains the problem in `description`; the key itself is never part of the message.
      const reason = typeof result.description === 'string' ? result.description : `HTTP ${response.status}`
      throw new PaymentError(response.status === 401 ? 503 : 502, `ЮKassa: ${reason}`)
    }
    return result
  }
}

function receipt(email: string, description: string, amount: number) {
  return {
    customer: { email },
    items: [{ description, quantity: '1.00', amount: { value: rub(amount), currency: 'RUB' }, vat_code: 1, payment_subject: 'service', payment_mode: 'full_payment' }],
  }
}

/**
 * A digest that is the same for one card across accounts (first 6 + last 4 digits and expiry, as ЮKassa reports them),
 * or for one saved payment method; undefined when ЮKassa tells nothing that identifies the payer's method.
 */
function methodKey(method: Row) {
  const card = method.card as Row | undefined
  const parts = card && typeof card.first6 === 'string' && typeof card.last4 === 'string'
    ? ['card', card.first6, card.last4, String(card.expiry_year ?? ''), String(card.expiry_month ?? '')]
    : method.saved === true && typeof method.id === 'string' && method.id ? ['method', method.id] : undefined
  return parts ? createHash('sha256').update(parts.join('|')).digest('hex') : undefined
}

/** «Карта *4444», «СБП», «SberPay», «ЮMoney» — what the cabinet shows next to the autopayment. */
function methodTitle(method: Row) {
  const type = typeof method.type === 'string' ? method.type : ''
  const card = method.card as Row | undefined
  if (type === 'bank_card' && typeof card?.last4 === 'string' && /^\d{4}$/.test(card.last4)) return `Карта *${card.last4}`
  const names: Record<string, string> = { bank_card: 'Банковская карта', sbp: 'СБП', sberbank: 'SberPay', yoo_money: 'ЮMoney', tinkoff_bank: 'T-Pay', mir_pay: 'Mir Pay' }
  return names[type] ?? 'Сохранённый способ оплаты'
}

function toView(row: Row): PaymentView {
  const provider: PaymentProvider = row.provider === 'lava' ? 'lava' : 'yookassa'
  const original = row.amount_original == null ? undefined : Number(row.amount_original)
  return {
    id: String(row.id),
    plan: row.plan as PlanId,
    amount: (provider === 'lava' ? original ?? 0 : Number(row.amount)) / 100,
    currency: provider === 'lava' ? String(row.currency ?? 'USD') : 'RUB',
    status: row.status as PaymentStatus,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    ...(row.paid_at == null ? {} : { paidAt: new Date(Number(row.paid_at)).toISOString() }),
    provider,
    ...(row.recurring_id == null ? {} : { renewal: true as const }),
    ...(row.discount_percent == null ? {} : { discountPercent: Number(row.discount_percent) }),
  }
}
