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
 * «Другие страны» is no longer sold (owner, 13.10.2026: «удали с сервера всю инфу о лава топ»): what that payment
 * service left in the database is cleaned up on start (removeOldProvider). Its paid payments and still active
 * autopayments stay as financial history with the provider 'archive': counted by the rouble amount stored when they
 * were paid, shown with what was paid, never charged, re-read or sent anywhere.
 *
 * Configuration comes from the environment of the server process (the desktop app passes it from its encrypted
 * settings, electron/ownerAdmin.ts): YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, TARKOV_PRICE_MONTH_RUB, optional
 * YOOKASSA_RECEIPTS=1 (send a 54-ФЗ receipt with each payment), YOOKASSA_AUTOPAY=1,
 * YOOKASSA_PAYMENT_METHODS=sbp,sberbank,tinkoff_bank, TARKOV_STREAMER_PERCENT and TARKOV_PUBLIC_URL (the site address
 * for the return link). Without a shop id, key and price ЮKassa is switched off. Secret keys are never logged, stored
 * in the database or sent to a client.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

export type PlanId = '1m' | '3m' | '6m' | '12m'
export type YooKassaPaymentMethod = 'sbp' | 'sberbank' | 'tinkoff_bank'
export const YOOKASSA_PAYMENT_METHODS: readonly YooKassaPaymentMethod[] = ['sbp', 'sberbank', 'tinkoff_bank']
export const PLAN_MONTHS: Record<PlanId, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
/** Public prices: six months cost five monthly payments; a year costs eight. */
// 3 months −10 % (270 ₽ a month at 300 ₽: 810 ₽, the owner's price of 10.10.2026), 6 months −1/6, 12 months −1/3
const PLAN_DISCOUNTS: Partial<Record<PlanId, number>> = { '3m': 0.1, '6m': 1 / 6, '12m': 1 / 3 }
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
  /** Methods enabled for this YooKassa shop. Unlisted methods are rejected server-side and never shown by the site. */
  paymentMethods?: YooKassaPaymentMethod[]
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
  const requestedMethods = (env.YOOKASSA_PAYMENT_METHODS ?? 'sbp').split(',').map((item) => item.trim()).filter(Boolean)
  const paymentMethods = YOOKASSA_PAYMENT_METHODS.filter((method) => requestedMethods.includes(method))
  return {
    shopId,
    secretKey,
    monthPrice: Math.round(monthPrice * 100) / 100,
    receipts: env.YOOKASSA_RECEIPTS === '1',
    streamerPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
    ...(publicUrl && PUBLIC_URL.test(publicUrl) ? { publicUrl } : {}),
    ...(env.YOOKASSA_AUTOPAY === '1' ? { autopay: true } : {}),
    paymentMethods: paymentMethods.length ? paymentMethods : ['sbp'],
  }
}

/** Plan price in kopecks. */
export function planPrice(monthPrice: number, plan: PlanId) {
  const months = PLAN_MONTHS[plan]
  const full = monthPrice * months
  return Math.round(full * (1 - (PLAN_DISCOUNTS[plan] ?? 0)) * 100)
}

/** `price` in roubles. */
export interface PlanView { id: PlanId; months: number; price: number; currency: 'RUB'; discountPercent: number }
/** `refunded`: the money went back (ЮKassa refund, or marked by the owner); the paid days and shares are taken back. */
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled' | 'refunded'
/**
 * Who took the money: ЮKassa; Boosty (CIS / WORLD, confirmed by the owner by hand: services/boosty.ts); or 'archive' — a
 * payment service that is no longer connected (owner, 13.10.2026). Archived rows are history only: nothing here charges,
 * re-reads or cancels them with anybody. A Boosty row is never re-read either: it is created already succeeded.
 */
export type PaymentProvider = 'yookassa' | 'boosty' | 'archive'
/** A stored row's provider: NULL (the first payments) and 'yookassa' are ЮKassa, 'boosty' Boosty, anything else is archived. */
export const providerOf = (value: unknown): PaymentProvider => (value == null || value === 'yookassa' ? 'yookassa' : value === 'boosty' ? 'boosty' : 'archive')
/** What an archived payment was paid in when that was not roubles (minor units), else undefined. */
export function paidInOtherCurrency(row: Record<string, unknown>) {
  return providerOf(row.provider) === 'archive' && row.amount_original != null && row.currency != null && row.currency !== 'RUB'
    ? { minor: Number(row.amount_original), currency: String(row.currency) }
    : undefined
}
export interface PaymentView {
  id: string
  plan: PlanId
  /** Major units of `currency`: roubles, or what an archived payment was paid in. */
  amount: number
  currency: string
  status: PaymentStatus
  createdAt: string
  paidAt?: string
  provider: PaymentProvider
  /** An automatic renewal. */
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
  // Boosty (services/boosty.ts): the payment region of the account when the owner confirmed it, and who confirmed it.
  ['region', 'TEXT'],
  ['confirmed_by', 'TEXT'],
  // How the payer paid (owner statistics, adminStore.ts): ЮKassa's payment_method.type of the paid payment (sbp,
  // sberbank = SberPay, tinkoff_bank = T-Pay, bank_card, yoo_money, …; the type asked for at creation until ЮKassa
  // reports it), 'boosty' for Boosty. NULL for payments from before this column (statistics show them as 'unknown').
  ['method', 'TEXT'],
]

/** A payment method type as ЮKassa names it (`payment_method.type`), else undefined: nothing else is stored. */
export function paymentMethodType(value: unknown) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value) ? value : undefined
}

/** The removed provider's own tables: its webhook log, the keys of processed events and the amount mismatches. */
const OLD_PROVIDER_TABLES = ['lava_events', 'lava_mismatches', 'lava_webhook_log']

/**
 * Lava.top («Другие страны») is removed (owner, 13.10.2026: «удали с сервера всю инфу о лава топ»). Runs on every start
 * and does something once: its tables (logs, no accounting value) are dropped, its unpaid invoices (pending / canceled)
 * and its autopayments that no longer run are deleted. Paid payments, refunded ones too, and still active autopayments
 * stay as financial history (the owner has not decided about them) and read as 'archive' everywhere (providerOf).
 * One line in the server log with the counts, never personal data.
 */
function removeOldProvider(db: DatabaseSync, log: (line: string) => void) {
  const tables = OLD_PROVIDER_TABLES.filter((name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined)
  const unpaid = "provider = 'lava' AND status IN ('pending', 'canceled')"
  const stopped = "provider = 'lava' AND status <> 'active'"
  const any = (table: string, where: string) => db.prepare(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`).get() !== undefined
  // Every later start: nothing to remove, so nothing is written.
  if (!tables.length && !any('payments', unpaid) && !any('recurring_subscriptions', stopped)) return
  const removed = transaction(db, () => {
    for (const name of tables) db.exec(`DROP TABLE IF EXISTS ${name}`)
    return {
      invoices: Number(db.prepare(`DELETE FROM payments WHERE ${unpaid}`).run().changes),
      autopayments: Number(db.prepare(`DELETE FROM recurring_subscriptions WHERE ${stopped}`).run().changes),
    }
  })
  const kept = db.prepare("SELECT (SELECT COUNT(*) FROM payments WHERE provider = 'lava') AS payments, (SELECT COUNT(*) FROM recurring_subscriptions WHERE provider = 'lava') AS autopayments").get() as Row
  log(`Payments: the removed foreign provider is cleaned up: ${tables.length} tables dropped, ${removed.invoices} unpaid invoices and ${removed.autopayments} inactive autopayments deleted; ${Number(kept.payments)} payments and ${Number(kept.autopayments)} active autopayments kept as archive.`)
}

/** A payment that has just succeeded (PaymentStore.onSucceeded). */
export interface SucceededPayment {
  id: string; accountId: string; plan: PlanId; amount: number; methodKey?: string
  /** ЮKassa or Boosty (confirmed by the owner): «Пригласи друга» pays a Boosty friend's reward at once. */
  provider?: PaymentProvider
  /** «Пригласи друга»: the first month was paid with the friend's discount, % (services/invites.ts counts only these). */
  discountPercent?: number
}

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
   * The first-month invitation discount is spent: a payment went through, or a discounted one was refunded. The one rule
   * for the price the cabinet shows (services/invites.ts) and the amount create() asks the bank for. An abandoned
   * pending attempt does not spend it.
   */
  friendDiscountUsed(accountId: string) {
    return this.db.prepare("SELECT 1 FROM payments WHERE account_id = ? AND (status = 'succeeded' OR (status = 'refunded' AND discount_percent IS NOT NULL))").get(accountId) !== undefined
  }

  /**
   * `notify`: called for autopayment notices (upcoming charge 3 days ahead, charged, failed, stopped).
   * TODO(e-mail): send these to the account's e-mail once a mail service (SendPulse / Unisender Go) is connected;
   * until then the cabinet shows the amount and date of the next charge and the hook does nothing.
   * `log`: the server log (the start-up clean-up of the removed provider writes one line there).
   */
  constructor(db: DatabaseSync, config: PaymentConfig | undefined, options: { now?: () => number; fetch?: Fetch; notify?: (notice: AutopayNotice) => void; log?: (line: string) => void } = {}) {
    this.db = db
    this.yooConfig = config
    this.now = options.now ?? Date.now
    this.fetch = options.fetch ?? fetch
    this.notify = options.notify ?? (() => {})
    this.db.exec(SCHEMA)
    const columns = new Set((this.db.prepare('PRAGMA table_info(payments)').all() as Row[]).map((row) => String(row.name)))
    for (const [name, type] of ADDED_COLUMNS) if (!columns.has(name)) this.db.exec(`ALTER TABLE payments ADD COLUMN ${name} ${type}`)
    // Boosty payments from before the `method` column: their method is Boosty itself (a no-op on every later start).
    this.db.prepare("UPDATE payments SET method = 'boosty' WHERE provider = 'boosty' AND method IS NULL").run()
    removeOldProvider(this.db, options.log ?? ((line) => console.log(line)))
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

  /** Paying is switched on (ЮKassa is configured). */
  get enabled() {
    return this.config !== undefined
  }

  /** Whether ЮKassa takes payments now, its autopayments and the methods of the shop. */
  providers() {
    return {
      yookassa: this.config !== undefined,
      autopay: this.config?.autopay === true,
      methods: this.config?.paymentMethods ?? ['sbp'],
    }
  }

  plans(): PlanView[] {
    const month = this.config?.monthPrice
    if (month === undefined) return []
    return (Object.keys(PLAN_MONTHS) as PlanId[]).map((id) => {
      const months = PLAN_MONTHS[id]
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
    return (this.db.prepare('SELECT * FROM payments WHERE account_id = ? ORDER BY created_at DESC LIMIT 50').all(accountId) as Row[]).map(toView)
  }

  /**
   * Starts a ЮKassa payment; returns our payment id and the ЮKassa page the user is sent to. `consent` is the version of
   * the offer / personal data documents the payer accepted with the checkbox; it is stored with the payment. `autopay`
   * is the separate autopayment consent: only with it ЮKassa is asked to save the payment method.
   */
  async create(account: { id: string; email: string; referredBy?: string }, plan: PlanId, siteUrl: string, consent?: { version: string }, autopay?: { version: string }, discount?: { percent: number }, method: YooKassaPaymentMethod = 'sbp') {
    const config = this.config
    if (!config) throw new PaymentError(503, 'Оплата пока не подключена')
    if (!(config.paymentMethods ?? ['sbp']).includes(method)) throw new PaymentError(409, 'Этот способ оплаты пока не подключён')
    if (autopay && !config.autopay) throw new PaymentError(409, 'Автоплатежи пока не подключены — оплатите без автопродления')
    if (autopay) this.assertNoActiveAutopay(account.id)
    const id = randomBytes(12).toString('hex')
    const listAmount = planPrice(config.monthPrice, plan)
    // The friend's discount (services/invites.ts) is only for the first month.
    // …and for the first completed payment only (friendDiscountUsed — the same rule the cabinet's price uses). An abandoned
    // bank redirect must not consume the advertised discount: the provider may leave that attempt pending for minutes,
    // while the buyer needs to retry immediately.
    const discountUsed = this.friendDiscountUsed(account.id)
    const percent = discount && !discountUsed && plan === '1m' && discount.percent > 0 && discount.percent < 100 ? discount.percent : undefined
    const amount = percent === undefined ? listAmount : Math.round(listAmount * (100 - percent) / 100)
    const description = `Raid OS: подписка на ${monthsText(PLAN_MONTHS[plan])}${percent === undefined ? '' : ` (скидка ${percent} % по приглашению)`}`
    const body: Record<string, unknown> = {
      amount: { value: rub(amount), currency: 'RUB' },
      capture: true,
      payment_method_data: { type: method },
      confirmation: { type: 'redirect', return_url: `${siteUrl}/cabinet?payment=${id}` },
      description,
      metadata: { paymentId: id, accountId: account.id, plan },
      ...(autopay ? { save_payment_method: true } : {}),
    }
    if (config.receipts) body.receipt = receipt(account.email, description, amount)
    const now = this.now()
    this.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, referral_code, created_at, consent_version, consent_at, provider, currency, amount_original, autopay_consent_version, autopay_consent_at, list_amount, discount_percent, method) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'yookassa', 'RUB', ?, ?, ?, ?, ?, ?)")
      .run(id, account.id, plan, amount, account.referredBy ?? null, now, consent?.version ?? null, consent ? now : null, amount, autopay?.version ?? null, autopay ? now : null, listAmount, percent ?? null, method)
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
   * A Boosty payment (services/boosty.ts grant: the owner's «Подтвердить оплату Boosty» or the automatic Boosty sync),
   * stored already succeeded with the amount in kopecks and applied like a ЮKassa one in one transaction: the paid period
   * is set, the streamer's share fixed and the listeners told (a friend-discount payment is what spends the discount:
   * friendDiscountUsed, and what earns the inviter his reward: services/invites.ts). The period: `until` — paid until that
   * moment, never shorter than the account already has; without it the plan's months are added (extend). `reference`:
   * the payment's own id (the owner's note, or the Boosty subscription period); the same one is never applied twice (409).
   * `assert` runs inside the transaction first (the one-time rules of the caller), `after` last (the caller's own rows).
   */
  confirmManual(account: { id: string; referredBy?: string }, input: { provider: 'boosty'; plan: PlanId; amount: number; region: string; actor: string; reference?: string; discountPercent?: number; until?: number }, assert?: () => void, after?: (payment: PaymentView) => void) {
    if (!Number.isInteger(input.amount) || input.amount < 0) throw new PaymentError(400, 'Сумма платежа указана неверно')
    if (input.until !== undefined && !Number.isFinite(input.until)) throw new PaymentError(400, 'Срок оплаты указан неверно')
    const providerId = input.reference ? `${input.provider}:${input.reference}` : null
    return transaction(this.db, () => {
      assert?.()
      if (providerId && this.db.prepare('SELECT 1 FROM payments WHERE provider_id = ?').get(providerId)) throw new PaymentError(409, 'Этот платёж уже подтверждён')
      const id = randomBytes(12).toString('hex')
      const now = this.now()
      this.db.prepare("INSERT INTO payments (id, account_id, provider_id, plan, amount, status, referral_code, created_at, provider, currency, amount_original, discount_percent, region, confirmed_by, method) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'RUB', ?, ?, ?, ?, ?)")
        .run(id, account.id, providerId, input.plan, input.amount, account.referredBy ?? null, now, input.provider, input.amount, input.discountPercent ?? null, input.region, input.actor, input.provider)
      const row = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Row
      if (!this.markSucceeded(row, input.amount)) throw new PaymentError(409, 'Платёж уже применён')
      if (input.until === undefined) this.extend(account.id, input.plan)
      else this.extendTo(account.id, input.until)
      const view = toView(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Row)
      after?.(view)
      return view
    })
  }

  /** Paid until `until` unless the account already has a longer period (never shortened). Inside a caller's transaction. */
  extendTo(accountId: string, until: number) {
    const current = this.paidUntil(accountId) ?? 0
    if (until <= current) return current
    this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(accountId, until)
    return until
  }

  /** The user's own payment, re-checked with ЮKassa while it is pending (sync() never touches an archived one). */
  async status(accountId: string, id: string) {
    const row = this.db.prepare('SELECT * FROM payments WHERE id = ? AND account_id = ?').get(id, accountId) as Row | undefined
    if (!row) throw new PaymentError(404, 'Платёж не найден')
    if (row.status === 'pending' && row.provider_id) await this.sync(String(row.provider_id)).catch(() => {})
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
      // The method ЮKassa reports for the paid payment (statistics only; it never changes what is applied).
      const type = paymentMethodType(method?.type)
      if (type) this.db.prepare("UPDATE payments SET method = ? WHERE id = ? AND status = 'pending'").run(type, String(row.id))
      if (!this.markSucceeded(row, Number(row.amount), key)) return
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
  private markSucceeded(row: Row, rubKopecks: number, methodKey?: string) {
    const percent = row.referral_code == null ? null : this.percentFor(String(row.referral_code))
    const earning = percent === null ? null : Math.floor(rubKopecks * percent / 100)
    const changed = this.db.prepare("UPDATE payments SET status = 'succeeded', paid_at = ?, amount = ?, streamer_percent = ?, streamer_earning = ?, amount_original = COALESCE(amount_original, ?), currency = COALESCE(currency, 'RUB') WHERE id = ? AND status = 'pending'")
      .run(this.now(), rubKopecks, percent, earning, rubKopecks, String(row.id))
    if (!Number(changed.changes)) return false
    const done: SucceededPayment = {
      id: String(row.id), accountId: String(row.account_id), plan: row.plan as PlanId, amount: rubKopecks, ...(methodKey ? { methodKey } : {}), provider: providerOf(row.provider),
      ...(row.discount_percent == null ? {} : { discountPercent: Number(row.discount_percent) }),
    }
    for (const listener of this.succeededListeners) {
      try { listener(done) } catch (error) { console.error('Payment listener failed', error instanceof Error ? error.message : 'unknown error') }
    }
    return true
  }

  /** Adds the plan's period to the account, from the end of the current paid period if it is still running. */
  private extend(accountId: string, plan: PlanId) {
    const from = Math.max(this.now(), this.paidUntil(accountId) ?? 0)
    const until = from + PLAN_MONTHS[plan] * MONTH_MS
    this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(accountId, until)
  }

  private assertNoActiveAutopay(accountId: string) {
    const current = this.currentRecurring(accountId)
    if (current?.status === 'active') throw new PaymentError(409, 'Автопродление уже включено. Чтобы сменить тариф или способ оплаты, сначала отмените автопродление')
  }

  private currentRecurring(accountId: string) {
    return this.db.prepare('SELECT * FROM recurring_subscriptions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(accountId) as Row | undefined
  }

  /** The account's autopayment for the cabinet, or null. */
  autopay(accountId: string): AutopayView | null {
    const row = this.currentRecurring(accountId)
    if (!row) return null
    const paidUntil = this.paidUntil(accountId)
    const status = String(row.status) as AutopayStatus
    const provider = providerOf(row.provider)
    // Only ЮKassa autopayments are charged from here; an archived one has no next charge this server knows of.
    const next = status === 'active' && paidUntil !== undefined && provider === 'yookassa'
      ? Math.max(this.now(), paidUntil - RENEW_BEFORE_MS, Number(row.next_attempt_at ?? 0))
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
   * so no further charge is possible. The paid period stays until its end. An archived autopayment cannot be stopped
   * from here (that payment service is not connected any more): the user is sent to support, and the owner closes it
   * in the admin panel (`byOwner`) after stopping it with that service by hand.
   */
  async cancelAutopay(account: { id: string }, options: { byOwner?: boolean } = {}) {
    const row = this.currentRecurring(account.id)
    if (!row || row.status !== 'active') throw new PaymentError(404, 'Автопродление не включено')
    if (providerOf(row.provider) !== 'yookassa' && !options.byOwner) throw new PaymentError(409, 'Это автопродление оформлено через платёжный сервис, который больше не подключён. Напишите в поддержку — его отменят вручную')
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
  // The payer sees what he paid: roubles, or the currency of an archived payment.
  const other = paidInOtherCurrency(row)
  return {
    id: String(row.id),
    plan: row.plan as PlanId,
    amount: (other ? other.minor : Number(row.amount)) / 100,
    currency: other ? other.currency : 'RUB',
    status: row.status as PaymentStatus,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    ...(row.paid_at == null ? {} : { paidAt: new Date(Number(row.paid_at)).toISOString() }),
    provider: providerOf(row.provider),
    ...(row.recurring_id == null ? {} : { renewal: true as const }),
    ...(row.discount_percent == null ? {} : { discountPercent: Number(row.discount_percent) }),
  }
}
