/**
 * Lava.top client: foreign cards (Visa/Mastercard, PayPal…) for buyers outside Russia and the CIS. Lava.top is the
 * merchant / payment agent; it charges the buyer, renews the subscription itself and sends webhooks.
 *
 * IMPORTANT: the public API docs (https://gate.lava.top/docs) could not be opened while this was written, so every
 * request and webhook shape below comes from search snippets and the lava-top SDKs and is UNVERIFIED. The client is
 * therefore defensive: it reads several spellings of each field, never trusts a missing field and reports shape
 * problems as a clear error instead of crashing. Check against a real test payment before switching it on.
 *
 *   POST   /api/v2/invoice        X-Api-Key  { email, offerId, currency, periodicity, buyerLanguage?, paymentMethod? }
 *                                 -> { id (contract id), status, amountTotal: { amount, currency }, paymentUrl }
 *   DELETE /api/v1/subscriptions  X-Api-Key  ?contractId=…&email=…        (cancel the renewal)
 *   GET    /api/v2/products       X-Api-Key  -> products with offers and prices per currency / periodicity
 *
 * Configuration (environment of the API process, passed by the owner's desktop app from its encrypted settings):
 * LAVA_API_KEY, LAVA_WEBHOOK_KEY, LAVA_OFFER_ID, LAVA_CURRENCY (USD | EUR), LAVA_RUB_RATE (roubles counted per 1 USD/EUR
 * for statistics and the streamer's share), optional LAVA_PAYMENT_METHOD (UNLIMINT | PAYPAL | STRIPE) and LAVA_API_URL.
 * Neither key is ever logged, stored in the database or sent to a client.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { PlanId } from './paymentStore.js'

export type LavaCurrency = 'USD' | 'EUR'
export type LavaPeriodicity = 'MONTHLY' | 'PERIOD_90_DAYS' | 'PERIOD_180_DAYS' | 'PERIOD_YEAR'
export type LavaPaymentMethod = 'UNLIMINT' | 'PAYPAL' | 'STRIPE'

/** Plan → Lava periodicity. The Lava offer needs a price for each of them in the configured currency. */
export const LAVA_PERIODICITY: Record<PlanId, LavaPeriodicity> = { '1m': 'MONTHLY', '3m': 'PERIOD_90_DAYS', '6m': 'PERIOD_180_DAYS', '12m': 'PERIOD_YEAR' }
const PLAN_BY_PERIODICITY = Object.fromEntries(Object.entries(LAVA_PERIODICITY).map(([plan, periodicity]) => [periodicity, plan])) as Record<LavaPeriodicity, PlanId>

export const LAVA_API = 'https://gate.lava.top'
/** The owner's product in lava.top (https://app.lava.top/products/3cb41c8c-…/dde8abeb-…). */
export const DEFAULT_LAVA_OFFER_ID = 'dde8abeb-b5ae-4a23-87b8-6bda4c7789e1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface LavaConfig {
  apiKey: string
  webhookKey: string
  offerId: string
  currency: LavaCurrency
  /** Roubles per one unit of `currency`: turns foreign payments into roubles for statistics and streamer shares. */
  rubRate: number
  paymentMethod?: LavaPaymentMethod
  apiUrl?: string
}

export function lavaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LavaConfig | undefined {
  const apiKey = env.LAVA_API_KEY?.trim() ?? ''
  const webhookKey = env.LAVA_WEBHOOK_KEY?.trim() ?? ''
  const offerId = env.LAVA_OFFER_ID?.trim() ?? ''
  const currency = env.LAVA_CURRENCY?.trim().toUpperCase()
  const rubRate = Number(env.LAVA_RUB_RATE)
  if (!apiKey || webhookKey.length < 8 || !UUID.test(offerId)) return undefined
  if (currency !== 'USD' && currency !== 'EUR') return undefined
  if (!Number.isFinite(rubRate) || rubRate <= 0 || rubRate > 100_000) return undefined
  const method = env.LAVA_PAYMENT_METHOD?.trim().toUpperCase()
  const apiUrl = env.LAVA_API_URL?.trim().replace(/\/+$/, '')
  return {
    apiKey, webhookKey, offerId, currency, rubRate,
    ...(method === 'UNLIMINT' || method === 'PAYPAL' || method === 'STRIPE' ? { paymentMethod: method } : {}),
    ...(apiUrl && /^https:\/\/[^/]+$/.test(apiUrl) ? { apiUrl } : {}),
  }
}

export class LavaError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Row = Record<string, unknown>
type Fetch = typeof fetch

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined)
const num = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}
const obj = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined)

/** Compares secrets in constant time (both sides hashed first, so lengths never leak either). */
export function sameSecret(supplied: string, expected: string) {
  if (!expected) return false
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Webhook authentication as configured in lava.top (webhook settings, auth type): the webhook key in the `X-Api-Key`
 * header ("API key" mode; an integrator's lava.top setup notes say the key «приходит в X-Api-Key»,
 * github.com/inite-ai/inite-billing-service PR #162), or Basic auth whose password (or whole «login:password») is the key.
 */
export function lavaWebhookAuthorized(headers: { apiKey?: string; authorization?: string }, webhookKey: string) {
  return lavaWebhookAuth(headers, webhookKey) !== undefined
}

/** Which method matched the webhook key (`undefined` if none did). */
export function lavaWebhookAuth(headers: { apiKey?: string; authorization?: string }, webhookKey: string): 'api-key' | 'basic' | undefined {
  if (!webhookKey) return undefined
  const byKey = headers.apiKey ? sameSecret(headers.apiKey.trim(), webhookKey) : false
  let byBasic = false
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(headers.authorization ?? '')
  if (basic) {
    const decoded = Buffer.from(basic[1]!, 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    const password = colon >= 0 ? decoded.slice(colon + 1) : decoded
    // Both comparisons always run: the time does not depend on which one matched.
    const whole = sameSecret(decoded, webhookKey)
    const onlyPassword = sameSecret(password, webhookKey)
    byBasic = whole || onlyPassword
  }
  return byKey ? 'api-key' : byBasic ? 'basic' : undefined
}

/** Which credential a request carried, for diagnostics only (never its value). */
export function lavaAuthSeen(headers: { apiKey?: string; authorization?: string }): 'none' | 'api-key' | 'basic' {
  if (headers.apiKey) return 'api-key'
  if (/^Basic\s+\S+/i.test(headers.authorization ?? '')) return 'basic'
  return 'none'
}

export type LavaEventKind = 'payment.success' | 'payment.failed' | 'recurring.success' | 'recurring.failed' | 'subscription.cancelled' | 'unknown'

/** A webhook reduced to what the store needs. Everything else in the body is ignored. */
export interface LavaEvent {
  kind: LavaEventKind
  /** The raw event type, for the idempotency key and diagnostics. */
  type: string
  /** Contract of this payment (the invoice id for the first payment, a new one for each renewal). */
  contractId?: string
  /** The subscription's first contract (renewals and cancellations). */
  parentContractId?: string
  /** An event id if Lava sends one. */
  eventId?: string
  email?: string
  /** Major units (e.g. 4.99). */
  amount?: number
  currency?: string
  status?: string
  timestamp?: string
  plan?: PlanId
}

/**
 * Reads a webhook body. Unknown event types come back as `unknown` (answered 200 and ignored).
 *
 * Evidence for the shape (gate.lava.top/docs itself was not reachable from the build machine): the lava-top SDKs
 * (pypi.org/project/lava-top-sdk, npmjs.com/package/lava-top-sdk) expose `eventType` (PAYMENT_SUCCESS / PAYMENT_FAILED
 * and the subscription recurring variants), `contractId` and `errorMessage`; integrators report that lava.top sends
 * `contractId` (= the id of the invoice we created) and that refund / chargeback events have another shape WITHOUT a
 * contractId (inite-ai/inite-billing-service PR #162; STEALTHNET-APP/remnawave-STEALTHNET-Bot issue #166). Event names
 * are matched loosely (dots, underscores, case) for that reason. `status` is not used to decide anything: the API
 * spells it in upper case («COMPLETED»), and a payment is granted only on a success event for our own invoice.
 * The amount / currency spellings are NOT confirmed; whatever is missing or different is caught by the strict amount
 * check (paymentStore.lavaAgrees) and shown to the owner instead of being trusted.
 */
export function parseLavaEvent(body: unknown): LavaEvent | undefined {
  const root = obj(body)
  if (!root) return undefined
  const type = text(root.eventType) ?? text(root.event) ?? text(root.type) ?? ''
  const lower = type.toLowerCase()
  const kind: LavaEventKind = /cancel/.test(lower) ? 'subscription.cancelled'
    : /recurr/.test(lower) && /success|succeed|completed/.test(lower) ? 'recurring.success'
      : /recurr/.test(lower) && /fail/.test(lower) ? 'recurring.failed'
        : /payment/.test(lower) && /success|succeed|completed/.test(lower) ? 'payment.success'
          : /payment/.test(lower) && /fail/.test(lower) ? 'payment.failed'
            : 'unknown'
  const buyer = obj(root.buyer)
  const amountObject = obj(root.amount) ?? obj(root.amountTotal)
  const periodicity = (text(root.periodicity) ?? text(obj(root.offer)?.periodicity) ?? '').toUpperCase() as LavaPeriodicity
  const contractId = text(root.contractId) ?? text(root.contract_id) ?? text(root.invoiceId) ?? text(obj(root.contract)?.id)
  const parentContractId = text(root.parentContractId) ?? text(root.parent_contract_id) ?? text(root.subscriptionId)
  const event: LavaEvent = { kind, type: type.slice(0, 80) }
  const put = <K extends keyof LavaEvent>(key: K, value: LavaEvent[K] | undefined) => { if (value !== undefined) event[key] = value }
  put('contractId', contractId?.slice(0, 80))
  put('parentContractId', parentContractId?.slice(0, 80))
  put('eventId', (text(root.eventId) ?? text(root.id))?.slice(0, 80))
  put('email', (text(buyer?.email) ?? text(root.email))?.slice(0, 254).toLowerCase())
  put('amount', num(amountObject ? amountObject.amount : root.amount))
  put('currency', (text(amountObject?.currency) ?? text(root.currency))?.toUpperCase().slice(0, 8))
  put('status', text(root.status)?.slice(0, 64))
  put('timestamp', text(root.timestamp)?.slice(0, 64))
  put('plan', PLAN_BY_PERIODICITY[periodicity])
  return event
}

export interface LavaInvoice { contractId: string; paymentUrl: string; amount?: number; currency?: string }
/** Prices of the offer per plan, major units of the configured currency; missing periodicities are left out. */
export type LavaPrices = Partial<Record<PlanId, number>>

export class LavaClient {
  readonly config: LavaConfig
  private readonly fetch: Fetch
  private pricesCache?: { at: number; prices: LavaPrices | null }

  constructor(config: LavaConfig, options: { fetch?: Fetch } = {}) {
    this.config = config
    this.fetch = options.fetch ?? fetch
  }

  async createInvoice(input: { email: string; plan: PlanId; language: 'RU' | 'EN' }): Promise<LavaInvoice> {
    const body: Row = {
      email: input.email,
      offerId: this.config.offerId,
      currency: this.config.currency,
      periodicity: LAVA_PERIODICITY[input.plan],
      buyerLanguage: input.language,
      ...(this.config.paymentMethod ? { paymentMethod: this.config.paymentMethod } : {}),
    }
    const answer = await this.call('POST', '/api/v2/invoice', body)
    const contractId = text(answer.id) ?? text(answer.contractId)
    const paymentUrl = text(answer.paymentUrl) ?? text(answer.url)
    if (!contractId || !paymentUrl || !/^https:\/\//.test(paymentUrl)) throw new LavaError(502, 'Lava.top вернула неожиданный ответ')
    const total = obj(answer.amountTotal) ?? obj(answer.amount)
    return {
      contractId: contractId.slice(0, 80),
      paymentUrl,
      ...(num(total?.amount) !== undefined ? { amount: num(total?.amount)! } : {}),
      ...(text(total?.currency) ? { currency: text(total?.currency)!.toUpperCase() } : {}),
    }
  }

  /** Stops the renewal of a subscription (its first contract id and the buyer's e-mail). */
  async cancelSubscription(contractId: string, email: string) {
    const query = new URLSearchParams({ contractId, email })
    await this.call('DELETE', `/api/v1/subscriptions?${query}`, undefined, [404])
  }

  /**
   * Offer prices for the cabinet, cached for an hour. `null` when the products API is unavailable or its answer is not
   * understood: the cabinet then says the price is shown on the Lava.top page.
   */
  async offerPrices(): Promise<LavaPrices | null> {
    const cached = this.pricesCache
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.prices
    let prices: LavaPrices | null = null
    try {
      const answer = await this.call('GET', '/api/v2/products')
      prices = extractPrices(answer, this.config.offerId, this.config.currency)
    } catch { /* keep null */ }
    this.pricesCache = { at: Date.now(), prices }
    return prices
  }

  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, okStatuses: number[] = []): Promise<Row> {
    let response: Response
    try {
      response = await this.fetch(`${this.config.apiUrl ?? LAVA_API}${path}`, {
        method,
        signal: AbortSignal.timeout(20_000),
        headers: { 'x-api-key': this.config.apiKey, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new LavaError(502, 'Lava.top недоступна, попробуйте позже')
    }
    const result = await response.json().catch(() => ({})) as unknown
    if (!response.ok && !okStatuses.includes(response.status)) {
      // Only Lava's own error text; the key is never part of it.
      const row = obj(result)
      const reason = text(row?.error) ?? text(row?.message) ?? text(row?.detail) ?? `HTTP ${response.status}`
      throw new LavaError(response.status === 401 || response.status === 403 ? 503 : 502, `Lava.top: ${reason.slice(0, 200)}`)
    }
    return obj(result) ?? { items: Array.isArray(result) ? result : [] }
  }
}

/** Finds the offer in a products answer ({ items: [...] } or a bare list) and reads its price per periodicity. */
export function extractPrices(answer: Row, offerId: string, currency: LavaCurrency): LavaPrices | null {
  const products = Array.isArray(answer.items) ? answer.items : Array.isArray(answer.products) ? answer.products : Array.isArray(answer.data) ? answer.data : []
  for (const product of products) {
    const offers = obj(product)?.offers
    if (!Array.isArray(offers)) continue
    const offer = offers.map(obj).find((item) => item && text(item.id) === offerId)
    if (!offer || !Array.isArray(offer.prices)) continue
    const prices: LavaPrices = {}
    for (const price of offer.prices.map(obj)) {
      if (!price || text(price.currency)?.toUpperCase() !== currency) continue
      const plan = PLAN_BY_PERIODICITY[(text(price.periodicity) ?? '').toUpperCase() as LavaPeriodicity]
      const amount = num(price.amount)
      if (plan && amount !== undefined && amount > 0) prices[plan] = amount
    }
    return Object.keys(prices).length ? prices : null
  }
  return null
}
