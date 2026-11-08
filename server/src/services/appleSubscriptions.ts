/**
 * The Raid OS subscription bought in the iPhone app through Apple In-App Purchase (owner, 09.11.2026: «можно ли сделать,
 * чтобы оплата была и в Apple, и на сайте?»; Apple guideline 3.1.3(b): a subscription bought on the site works in the app
 * when the same subscription is also sold in the app). One Raid OS account, paid either way: an Apple period is a payment
 * with the provider 'apple' (PaymentStore.confirmManual) and extends the same `subscriptions.paid_until` as ЮKassa and BZB.
 *
 * - The app buys with StoreKit 2 and passes the account's `appAccountToken` (a UUID this server keeps per account, never
 *   the account id itself), then sends the transaction Apple signed (JWS) to POST /v1/apple/transactions. Renewals,
 *   refunds and revocations come from Apple itself: App Store Server Notifications V2 at POST /v1/apple/notifications.
 *   Nothing from the app or a notification is trusted before Apple's signature is checked (AppleVerifier: Apple's own
 *   library, the chain up to Apple's root certificate, the bundle id, the environment).
 * - A transaction belongs to the account its `appAccountToken` names, or — a restore without one — to the account its
 *   original transaction was first applied to, or else to the signed-in account that sends it. A purchase of another
 *   Raid OS account is never moved («other-account»).
 * - Each transaction applies once (its id is the payment's reference). The period added is the one Apple sold (`expires`
 *   − `purchase`), after the paid and free periods still running (free days never burn), and never ends before Apple's
 *   own end — so a renewal never leaves a gap. A transaction already over adds nothing (history only). A refunded or
 *   revoked one takes its period off again (PaymentStore.markRefunded).
 * - Family Sharing is not counted (a family member has no Raid OS account here); a free offer adds its days without a
 *   payment row.
 *
 * Configuration (server environment, appleIapConfigFromEnv): APPLE_IAP=1 switches it on; APPLE_BUNDLE_ID
 * (com.tarkovoperator.app); APPLE_APP_ID — the app's numeric Apple ID, needed to accept production purchases; without it
 * only Sandbox / TestFlight purchases verify; APPLE_IAP_PRODUCTS — `productId:months,…` (1, 3, 6 or 12 months);
 * APPLE_ROOT_CA_DIR — Apple's root certificates (.cer), else they are fetched from apple.com once into the data folder.
 */
import { randomUUID, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library'
import { transaction } from './database.js'
import { PaymentError, type PaymentStore, type PlanId } from './paymentStore.js'

export type AppleMonths = 1 | 3 | 6 | 12
export interface AppleProduct { id: string; months: AppleMonths }
export interface AppleIapConfig {
  bundleId: string
  /** The app's numeric Apple ID (App Store Connect → App Information): required to verify production purchases. */
  appAppleId?: number
  products: AppleProduct[]
}

/** The subscriptions offered when APPLE_IAP_PRODUCTS is not set (create them with these ids in App Store Connect). */
export const DEFAULT_APPLE_PRODUCTS: readonly AppleProduct[] = [
  { id: 'com.tarkovoperator.app.sub.1m', months: 1 },
  { id: 'com.tarkovoperator.app.sub.3m', months: 3 },
  { id: 'com.tarkovoperator.app.sub.6m', months: 6 },
  { id: 'com.tarkovoperator.app.sub.12m', months: 12 },
]
const PRODUCT_ID = /^[A-Za-z0-9._-]{1,100}$/
const MONTHS = new Set([1, 3, 6, 12])

export function appleIapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppleIapConfig | undefined {
  if (env.APPLE_IAP !== '1') return undefined
  const bundleId = env.APPLE_BUNDLE_ID?.trim() || 'com.tarkovoperator.app'
  const appAppleId = Number(env.APPLE_APP_ID)
  const products = env.APPLE_IAP_PRODUCTS?.trim()
    ? env.APPLE_IAP_PRODUCTS.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [id, months] = entry.split(':')
      if (!PRODUCT_ID.test(id ?? '') || !MONTHS.has(Number(months))) throw new Error(`APPLE_IAP_PRODUCTS: «${entry}» is not productId:1|3|6|12`)
      return { id: id!, months: Number(months) as AppleMonths }
    })
    : [...DEFAULT_APPLE_PRODUCTS]
  return { bundleId, ...(Number.isInteger(appAppleId) && appAppleId > 0 ? { appAppleId } : {}), products }
}

/** What this server reads from a transaction Apple signed (the library's JWSTransactionDecodedPayload). */
export interface AppleTransaction {
  transactionId?: string
  originalTransactionId?: string
  bundleId?: string
  productId?: string
  type?: string
  purchaseDate?: number
  expiresDate?: number
  revocationDate?: number
  appAccountToken?: string
  inAppOwnershipType?: string
  environment?: string
  /** Milliunits of `currency` (4.99 USD → 4990). */
  price?: number
  currency?: string
  storefront?: string
}
export interface AppleNotification {
  notificationType?: string
  subtype?: string
  bundleId?: string
  environment?: string
  /** data.signedTransactionInfo, verified. */
  transaction?: AppleTransaction
}
/** Checks Apple's signature and decodes; throws on anything not signed by Apple for this app. */
export interface AppleVerifier {
  transaction(signed: string): Promise<AppleTransaction>
  notification(signedPayload: string): Promise<AppleNotification>
}

export type AppleAuditAction = 'payment.apple' | 'payment.apple-revoked'
export type AppleApplyStatus = 'applied' | 'known' | 'revoked' | 'expired' | 'other-account' | 'no-account' | 'ignored'
export interface AppleApplyResult {
  status: AppleApplyStatus
  transactionId?: string
  productId?: string
  /** Apple's end of this period. */
  expiresAt?: string
  /** Why it was ignored: bundle, product, type, family, data. */
  reason?: string
}
/** The account's Apple subscription for the app: the latest period that was not taken back. */
export interface AppleSubscriptionView { productId: string; months: AppleMonths; expiresAt: string; active: boolean; environment?: string }

/** The account side this module needs (AccountStore). */
export interface AppleAccounts {
  exists(accountId: string): boolean
  billingInfo(accountId: string): { id: string; email: string; referredBy?: string }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS apple_accounts (
    account_id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS apple_transactions (
    transaction_id TEXT PRIMARY KEY,
    original_transaction_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    purchase_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL,
    period_ms INTEGER NOT NULL,
    environment TEXT,
    price INTEGER,
    currency TEXT,
    storefront TEXT,
    payment_id TEXT,
    applied INTEGER NOT NULL DEFAULT 0,
    revoked_ms INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS apple_transactions_original ON apple_transactions (original_transaction_id);
  CREATE INDEX IF NOT EXISTS apple_transactions_account ON apple_transactions (account_id, expires_ms);
`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRANSACTION_ID = /^[0-9A-Za-z._-]{1,64}$/
type Row = Record<string, unknown>

export class AppleSubscriptions {
  private readonly db: DatabaseSync
  private readonly payments: PaymentStore
  private readonly accounts: AppleAccounts
  private readonly verifier: AppleVerifier | undefined
  private readonly config: AppleIapConfig | undefined
  private readonly now: () => number
  private readonly audit: (action: AppleAuditAction, accountId: string, details: Record<string, unknown>) => void

  constructor(db: DatabaseSync, payments: PaymentStore, accounts: AppleAccounts, config: AppleIapConfig | undefined, verifier: AppleVerifier | undefined, options: { now?: () => number; audit?: (action: AppleAuditAction, accountId: string, details: Record<string, unknown>) => void } = {}) {
    this.db = db
    this.payments = payments
    this.accounts = accounts
    this.config = config
    this.verifier = verifier
    this.now = options.now ?? Date.now
    this.audit = options.audit ?? (() => {})
    this.db.exec(SCHEMA)
  }

  /** On when configured and Apple's signatures can be checked. */
  get enabled() { return Boolean(this.config && this.verifier) }

  products(): AppleProduct[] { return this.enabled ? [...this.config!.products] : [] }

  /** The account's UUID for StoreKit's `appAccountToken` (made once, kept). */
  tokenFor(accountId: string) {
    const row = this.db.prepare('SELECT token FROM apple_accounts WHERE account_id = ?').get(accountId) as Row | undefined
    if (row) return String(row.token)
    const token = randomUUID()
    this.db.prepare('INSERT INTO apple_accounts (account_id, token, created_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO NOTHING').run(accountId, token, this.now())
    return String((this.db.prepare('SELECT token FROM apple_accounts WHERE account_id = ?').get(accountId) as Row).token)
  }

  /** The account's Apple subscription, or undefined. */
  view(accountId: string): AppleSubscriptionView | undefined {
    const row = this.db.prepare('SELECT * FROM apple_transactions WHERE account_id = ? AND revoked_ms IS NULL ORDER BY expires_ms DESC LIMIT 1').get(accountId) as Row | undefined
    if (!row) return undefined
    const product = this.config?.products.find((entry) => entry.id === row.product_id)
    const expires = Number(row.expires_ms)
    return {
      productId: String(row.product_id), months: product?.months ?? monthsOf(Number(row.period_ms)), expiresAt: new Date(expires).toISOString(),
      active: expires > this.now(), ...(row.environment == null ? {} : { environment: String(row.environment) }),
    }
  }

  /** Transactions the signed-in app sends (a purchase, a restore, a renewal StoreKit told it about). */
  async fromApp(accountId: string, signed: readonly string[]): Promise<AppleApplyResult[]> {
    if (!this.enabled) throw new PaymentError(503, 'Покупки Apple пока не подключены')
    const results: AppleApplyResult[] = []
    for (const jws of signed) {
      let decoded: AppleTransaction
      try { decoded = await this.verifier!.transaction(jws) } catch { results.push({ status: 'ignored', reason: 'signature' }); continue }
      results.push(this.apply(decoded, accountId))
    }
    return results
  }

  /** An App Store Server Notification V2 (its signed payload). Throws when Apple's signature does not hold. */
  async fromNotification(signedPayload: string): Promise<{ type: string; result?: AppleApplyResult }> {
    if (!this.enabled) throw new PaymentError(503, 'Покупки Apple пока не подключены')
    const notification = await this.verifier!.notification(signedPayload)
    const type = [notification.notificationType, notification.subtype].filter(Boolean).join('.') || 'unknown'
    if (notification.bundleId && notification.bundleId !== this.config!.bundleId) return { type, result: { status: 'ignored', reason: 'bundle' } }
    if (!notification.transaction) return { type }
    return { type, result: this.apply(notification.transaction) }
  }

  /** Applies one verified transaction (see the header). `requester`: the signed-in account that sent it, if any. */
  apply(tx: AppleTransaction, requester?: string): AppleApplyResult {
    const config = this.config
    if (!config) return { status: 'ignored', reason: 'off' }
    const transactionId = tx.transactionId
    const originalId = tx.originalTransactionId ?? tx.transactionId
    if (!transactionId || !originalId || !TRANSACTION_ID.test(transactionId) || !TRANSACTION_ID.test(originalId)) return { status: 'ignored', reason: 'data' }
    const base = { transactionId, ...(tx.productId ? { productId: tx.productId } : {}) }
    if (tx.bundleId !== config.bundleId) return { ...base, status: 'ignored', reason: 'bundle' }
    const product = config.products.find((entry) => entry.id === tx.productId)
    if (!product) return { ...base, status: 'ignored', reason: 'product' }
    if (tx.type !== undefined && tx.type !== 'Auto-Renewable Subscription') return { ...base, status: 'ignored', reason: 'type' }
    if (tx.inAppOwnershipType === 'FAMILY_SHARED') return { ...base, status: 'ignored', reason: 'family' }
    const purchase = Number(tx.purchaseDate)
    const expires = Number(tx.expiresDate)
    if (!Number.isFinite(purchase) || !Number.isFinite(expires) || expires <= purchase) return { ...base, status: 'ignored', reason: 'data' }
    const result = { ...base, expiresAt: new Date(expires).toISOString() }

    // No await from here on: node:sqlite is synchronous, so nothing else runs in between. The writes that must go together
    // share one transaction (the payment's, through confirmManual's `after`); transactions do not nest (database.ts).
    const bound = this.db.prepare('SELECT account_id FROM apple_transactions WHERE original_transaction_id = ? ORDER BY created_at LIMIT 1').get(originalId) as Row | undefined
    const byToken = tx.appAccountToken && UUID.test(tx.appAccountToken)
      ? this.db.prepare('SELECT account_id FROM apple_accounts WHERE token = ?').get(tx.appAccountToken.toLowerCase()) as Row | undefined
      : undefined
    const accountId = bound ? String(bound.account_id) : byToken ? String(byToken.account_id) : requester
    if (!accountId) return { ...result, status: 'no-account' }
    if (requester && accountId !== requester) return { ...result, status: 'other-account' }
    if (!this.accounts.exists(accountId)) return { ...result, status: 'no-account' }

    const existing = this.db.prepare('SELECT * FROM apple_transactions WHERE transaction_id = ?').get(transactionId) as Row | undefined
    if (existing) {
      if (!tx.revocationDate || existing.revoked_ms != null) return { ...result, status: existing.revoked_ms == null ? 'known' : 'revoked' }
      // Refund first (once only, its own transaction), then the mark: a retry after a crash in between finds the payment
      // refunded already and only sets the mark.
      if (existing.payment_id != null) this.payments.markRefunded(String(existing.payment_id), Number(existing.period_ms))
      else if (Number(existing.applied)) this.takeOff(accountId, Number(existing.period_ms))
      this.db.prepare('UPDATE apple_transactions SET revoked_ms = ? WHERE transaction_id = ?').run(Number(tx.revocationDate), transactionId)
      this.audit('payment.apple-revoked', accountId, { transactionId, productId: product.id })
      return { ...result, status: 'revoked' }
    }

    const periodMs = expires - purchase
    const price = Number.isFinite(Number(tx.price)) ? Math.max(0, Math.round(Number(tx.price))) : undefined
    const currency = typeof tx.currency === 'string' && /^[A-Z]{3}$/.test(tx.currency) ? tx.currency : undefined
    const insert = (applied: boolean, paymentId: string | null, revoked: number | null) => this.db.prepare(`INSERT INTO apple_transactions
      (transaction_id, original_transaction_id, account_id, product_id, purchase_ms, expires_ms, period_ms, environment, price, currency, storefront, payment_id, applied, revoked_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(transactionId, originalId, accountId, product.id, purchase, expires, periodMs, tx.environment ?? null, price ?? null, currency ?? null, tx.storefront ?? null, paymentId, applied ? 1 : 0, revoked, this.now())
    if (tx.revocationDate) { insert(false, null, Number(tx.revocationDate)); return { ...result, status: 'revoked' } }
    if (expires <= this.now()) { insert(false, null, null); return { ...result, status: 'expired' } }

    // Hundredths of the currency (Apple gives milliunits); roubles go to `amount` in kopecks, other currencies count 0
    // there until the owner sets the rouble amount (adminStore.setPaymentAmount), as BZB's dollars do.
    const hundredths = price === undefined ? 0 : Math.round(price / 10)
    if (!hundredths) {
      // A free offer: its days, no payment.
      transaction(this.db, () => {
        this.payments.extendTo(accountId, Math.max(expires, this.payments.periodStart(accountId) + periodMs))
        insert(true, null, null)
      })
    } else {
      this.payments.confirmManual(this.accounts.billingInfo(accountId), {
        provider: 'apple', plan: `${product.months}m` as PlanId, amount: currency === 'RUB' ? hundredths : 0, region: `APPLE:${(tx.storefront ?? '').slice(0, 3) || '?'}`,
        actor: 'apple', reference: transactionId, until: expires, forMs: periodMs, ...(currency ? { currency, amountOriginal: hundredths } : {}),
      }, undefined, (payment) => insert(true, payment.id, null))
    }
    this.audit('payment.apple', accountId, { transactionId, productId: product.id, environment: tx.environment ?? null, expiresAt: result.expiresAt })
    return { ...result, status: 'applied' }
  }

  /** A free offer's days taken back (it has no payment to refund). */
  private takeOff(accountId: string, periodMs: number) {
    const paidUntil = this.payments.paidUntil(accountId)
    if (paidUntil === undefined) return
    this.db.prepare('UPDATE subscriptions SET paid_until = ? WHERE account_id = ?').run(Math.max(this.now(), paidUntil - periodMs), accountId)
  }
}

const monthsOf = (periodMs: number): AppleMonths => {
  const months = periodMs / (30 * 24 * 3600 * 1000)
  return months > 9 ? 12 : months > 4.5 ? 6 : months > 1.5 ? 3 : 1
}

// ---- Apple's signature: the official library ------------------------------------------------------------------------

/** Apple's root certificates: every .cer/.der/.pem in `dir`. */
export function readAppleRootCertificates(dir: string): Buffer[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => /\.(cer|der|pem|crt)$/i.test(name)).map((name) => readFileSync(join(dir, name)))
}

export const APPLE_ROOT_CA_G3_URL = 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer'
/**
 * Apple Root CA - G3 (the root of App Store signatures) in `dir`, fetched once from apple.com over HTTPS when it is not
 * there yet; refused unless it is that self-signed root.
 */
export async function ensureAppleRootCertificate(dir: string, fetchImpl: typeof fetch = fetch): Promise<Buffer[]> {
  const present = readAppleRootCertificates(dir)
  if (present.length) return present
  const response = await fetchImpl(APPLE_ROOT_CA_G3_URL, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Apple root certificate: HTTP ${response.status}`)
  const der = Buffer.from(await response.arrayBuffer())
  const certificate = new X509Certificate(der)
  if (!/CN=Apple Root CA - G3/.test(certificate.subject) || certificate.subject !== certificate.issuer || !certificate.verify(certificate.publicKey)) throw new Error('Apple root certificate: unexpected certificate')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'AppleRootCA-G3.cer'), der)
  return [der]
}

/**
 * The real verifier: Apple's App Store Server Library. Production purchases need `appAppleId`; a Sandbox / TestFlight one
 * (App Review buys in Sandbox too) is checked against the Sandbox environment.
 */
export function createAppleVerifier(config: AppleIapConfig, rootCertificates: Buffer[]): AppleVerifier {
  const production = config.appAppleId ? new SignedDataVerifier(rootCertificates, true, Environment.PRODUCTION, config.bundleId, config.appAppleId) : undefined
  const sandbox = new SignedDataVerifier(rootCertificates, true, Environment.SANDBOX, config.bundleId)
  const environmentOf = (jws: string) => {
    try {
      const payload = JSON.parse(Buffer.from(jws.split('.')[1] ?? '', 'base64url').toString('utf8')) as { environment?: string; data?: { environment?: string } }
      return payload.environment ?? payload.data?.environment
    } catch { return undefined }
  }
  // The claimed environment only picks the verifier; the verifier itself checks the signature and that environment.
  const pick = (jws: string) => {
    const claimed = environmentOf(jws)
    if (claimed === 'Production') {
      if (!production) throw new Error('APPLE_APP_ID is not set: production purchases cannot be verified')
      return production
    }
    return sandbox
  }
  return {
    async transaction(signed) {
      const decoded = await pick(signed).verifyAndDecodeTransaction(signed)
      return decoded as AppleTransaction
    },
    async notification(signedPayload) {
      const verifier = pick(signedPayload)
      const decoded = await verifier.verifyAndDecodeNotification(signedPayload)
      const data = decoded.data
      const transaction = data?.signedTransactionInfo ? await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo) as AppleTransaction : undefined
      return {
        ...(decoded.notificationType ? { notificationType: String(decoded.notificationType) } : {}),
        ...(decoded.subtype ? { subtype: String(decoded.subtype) } : {}),
        ...(data?.bundleId ? { bundleId: data.bundleId } : {}),
        ...(data?.environment ? { environment: String(data.environment) } : {}),
        ...(transaction ? { transaction } : {}),
      }
    },
  }
}

/**
 * The verifier for the server's start, which cannot wait (index.ts is bundled as CommonJS, no top-level await): `make` runs
 * at the first check — Apple's root certificate may still have to be fetched — and again after a failure.
 */
export function lazyAppleVerifier(make: () => Promise<AppleVerifier>): AppleVerifier {
  let ready: Promise<AppleVerifier> | undefined
  const get = () => {
    ready ??= make().catch((error: unknown) => { ready = undefined; throw error })
    return ready
  }
  return {
    transaction: async (signed) => (await get()).transaction(signed),
    notification: async (signedPayload) => (await get()).notification(signedPayload),
  }
}
