/**
 * Subscription payments through ЮKassa (YooKassa API v3, https://yookassa.ru/developers/api).
 *
 * Flow: the signed-in user picks a plan on the website → `create()` asks ЮKassa for a payment and returns its payment
 * page → after paying, ЮKassa sends a webhook and the user returns to the cabinet. Neither the webhook body nor the
 * browser is trusted: `sync()` always re-reads the payment from the ЮKassa API with the shop's secret key and only a
 * `succeeded` payment with the expected amount and our own metadata extends the subscription. Applying is idempotent
 * (one payment extends once), so repeated webhooks and the cabinet's own status checks are harmless.
 *
 * Configuration comes from the environment of the server process (the desktop app passes it from its encrypted
 * settings, electron/localServer.ts): YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, TARKOV_PRICE_MONTH_RUB, optional
 * YOOKASSA_RECEIPTS=1 (send a 54-ФЗ receipt with each payment), TARKOV_STREAMER_PERCENT and TARKOV_PUBLIC_URL (the
 * site address for the return link). Without a shop id, key and price, payments are simply switched off.
 * The secret key is never logged, stored in the database or sent to a client.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

export type PlanId = '1m' | '3m' | '6m' | '12m'
export const PLAN_MONTHS: Record<PlanId, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
/** The yearly plan is 33% cheaper than twelve monthly payments (docs/product-roadmap-and-business-model.md). */
const YEAR_DISCOUNT = 0.33
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
const YOOKASSA_API = 'https://api.yookassa.ru/v3'

export interface PaymentConfig {
  shopId: string
  secretKey: string
  /** Price of one month in roubles. */
  monthPrice: number
  receipts: boolean
  /** Share of a referred user's payments credited to the streamer, 0–100. */
  streamerPercent: number
  /** Public site address for ЮKassa's return link, e.g. https://tarkov.example.com. */
  publicUrl?: string
}

export function paymentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentConfig | undefined {
  const shopId = env.YOOKASSA_SHOP_ID?.trim() ?? ''
  const secretKey = env.YOOKASSA_SECRET_KEY?.trim() ?? ''
  const monthPrice = Number(env.TARKOV_PRICE_MONTH_RUB)
  if (!/^\d{1,12}$/.test(shopId) || !secretKey || !Number.isFinite(monthPrice) || monthPrice < 1) return undefined
  const percent = Number(env.TARKOV_STREAMER_PERCENT ?? 0)
  const publicUrl = env.TARKOV_PUBLIC_URL?.trim().replace(/\/+$/, '')
  return {
    shopId,
    secretKey,
    monthPrice: Math.round(monthPrice * 100) / 100,
    receipts: env.YOOKASSA_RECEIPTS === '1',
    streamerPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
    ...(publicUrl && /^https:\/\/[^/]+$/.test(publicUrl) ? { publicUrl } : {}),
  }
}

/** Plan price in kopecks. */
export function planPrice(monthPrice: number, plan: PlanId) {
  const months = PLAN_MONTHS[plan]
  const full = monthPrice * months
  return Math.round((plan === '12m' ? full * (1 - YEAR_DISCOUNT) : full) * 100)
}

export interface PlanView { id: PlanId; months: number; price: number; currency: 'RUB'; discountPercent: number }
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled'
export interface PaymentView { id: string; plan: PlanId; amount: number; currency: 'RUB'; status: PaymentStatus; createdAt: string; paidAt?: string }

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
`

const rub = (kopecks: number) => (kopecks / 100).toFixed(2)

export class PaymentStore {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly fetch: Fetch
  readonly config: PaymentConfig | undefined

  constructor(db: DatabaseSync, config: PaymentConfig | undefined, options: { now?: () => number; fetch?: Fetch } = {}) {
    this.db = db
    this.config = config
    this.now = options.now ?? Date.now
    this.fetch = options.fetch ?? fetch
    this.db.exec(SCHEMA)
  }

  get enabled() {
    return this.config !== undefined
  }

  plans(): PlanView[] {
    if (!this.config) return []
    const month = this.config.monthPrice
    return (Object.keys(PLAN_MONTHS) as PlanId[]).map((id) => {
      const price = planPrice(month, id) / 100
      const months = PLAN_MONTHS[id]
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
    const percent = this.config?.streamerPercent ?? 0
    return { activeSubscriptions: active, revenue, earnings: Math.floor(revenue * percent / 100) }
  }

  referralSeries(code: string, keySql: (column: string) => string) {
    const percent = this.config?.streamerPercent ?? 0
    const rows = this.db.prepare(`SELECT ${keySql('paid_at')} AS k, plan, COUNT(*) AS n, SUM(amount) AS total FROM payments WHERE referral_code = ? AND status = 'succeeded' GROUP BY k, plan`).all(code) as Row[]
    const byKey = new Map<string, { key: string; payments: number; months: Record<string, number>; revenue: number; earnings: number }>()
    for (const row of rows) {
      const key = String(row.k)
      const entry = byKey.get(key) ?? { key, payments: 0, months: {}, revenue: 0, earnings: 0 }
      entry.payments += Number(row.n)
      entry.months[String(row.plan)] = (entry.months[String(row.plan)] ?? 0) + Number(row.n)
      entry.revenue += Number(row.total)
      entry.earnings = Math.floor(entry.revenue * percent / 100)
      byKey.set(key, entry)
    }
    return [...byKey.values()]
  }

  list(accountId: string): PaymentView[] {
    return (this.db.prepare('SELECT * FROM payments WHERE account_id = ? ORDER BY created_at DESC LIMIT 50').all(accountId) as Row[]).map(toView)
  }

  /** Starts a payment; returns our payment id and the ЮKassa page the user is sent to. */
  async create(account: { id: string; email: string; referredBy?: string }, plan: PlanId, siteUrl: string) {
    const config = this.config
    if (!config) throw new PaymentError(503, 'Оплата пока не подключена')
    const id = randomBytes(12).toString('hex')
    const amount = planPrice(config.monthPrice, plan)
    const months = PLAN_MONTHS[plan]
    const description = `Tarkov Operator: подписка на ${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}`
    const body: Record<string, unknown> = {
      amount: { value: rub(amount), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `${siteUrl}/cabinet?payment=${id}` },
      description,
      metadata: { paymentId: id, accountId: account.id, plan },
    }
    if (config.receipts) {
      body.receipt = {
        customer: { email: account.email },
        items: [{ description, quantity: '1.00', amount: { value: rub(amount), currency: 'RUB' }, vat_code: 1, payment_subject: 'service', payment_mode: 'full_payment' }],
      }
    }
    this.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, referral_code, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
      .run(id, account.id, plan, amount, account.referredBy ?? null, this.now())
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

  /** The user's own payment, re-checked with ЮKassa while it is pending. */
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
    const row = this.db.prepare('SELECT * FROM payments WHERE provider_id = ?').get(providerId) as Row | undefined
    if (!row || row.status !== 'pending') return
    const remote = await this.call('GET', `/payments/${encodeURIComponent(providerId)}`)
    const metadata = remote.metadata as Row | undefined
    const amount = remote.amount as Row | undefined
    if (metadata?.paymentId !== row.id) return
    if (remote.status === 'canceled') { this.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(String(row.id)); return }
    if (remote.status !== 'succeeded' || remote.paid !== true) return
    if (amount?.currency !== 'RUB' || amount.value !== rub(Number(row.amount))) return
    transaction(this.db, () => {
      const changed = this.db.prepare("UPDATE payments SET status = 'succeeded', paid_at = ? WHERE id = ? AND status = 'pending'").run(this.now(), String(row.id))
      if (!Number(changed.changes)) return
      const accountId = String(row.account_id)
      const from = Math.max(this.now(), this.paidUntil(accountId) ?? 0)
      const until = from + PLAN_MONTHS[row.plan as PlanId] * MONTH_MS
      this.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(accountId, until)
    })
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

function toView(row: Row): PaymentView {
  return {
    id: String(row.id),
    plan: row.plan as PlanId,
    amount: Number(row.amount) / 100,
    currency: 'RUB',
    status: row.status as PaymentStatus,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    ...(row.paid_at == null ? {} : { paidAt: new Date(Number(row.paid_at)).toISOString() }),
  }
}
