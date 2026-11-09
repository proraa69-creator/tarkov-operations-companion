/**
 * The subscription through Apple In-App Purchase in the iPhone app (owner, 09.11.2026: «оплата была и в Apple, и на
 * сайте»). StoreKit 2 through `@capgo/native-purchases` (loaded only on the iPhone); the server checks Apple's signature
 * and opens the same paid period as a payment on the site (server/src/services/appleSubscriptions.ts, routes/apple.ts).
 *
 * Apple's rules kept here (guideline 3.1.2): the name, period and price come from StoreKit (never typed by us), the terms
 * of the auto-renewal and links to the terms of use and the privacy policy stand next to the button, «Восстановить
 * покупки» is always there. Paying on the site is offered only where Apple allows it: guideline 3.1.1(a) permits buttons
 * and links to other ways to pay on the United States storefront only (09.11.2026; the server's list, siteLinkStorefronts,
 * checked against StoreKit's storefront of the player's Apple ID, never the account's country).
 */
import { webServiceRequest } from '../sync/webAccount'

export interface AppleIapProduct { id: string; months: number }
export interface AppleSubscriptionInfo { productId: string; months: number; expiresAt: string; active: boolean }
export interface AppleIapInfo {
  enabled: boolean
  products: AppleIapProduct[]
  appAccountToken?: string
  subscription?: AppleSubscriptionInfo
  /** App Store storefronts (alpha-3) where «Оплатить на сайте» may stand next to Apple's plans. */
  siteLinkStorefronts: string[]
  /** «Raid OS для ПК» with raidos.app/pc is shown: always, unless the server turns it off (APPLE_PC_APP_LINK=0). */
  pcAppLink: boolean
}
/** A product as StoreKit names and prices it in the player's App Store country. */
export interface StoreProduct {
  id: string
  months: number
  title: string
  /** StoreKit's own price text («$7.00», «299,00 ₽»). */
  price: string
  /** The same price as a number, for the saving of a longer period (savingPercent). */
  amount?: number
}
export type AppleSendStatus = 'applied' | 'known' | 'revoked' | 'expired' | 'other-account' | 'no-account' | 'ignored'
export interface AppleSendResult { results: Array<{ status: AppleSendStatus; reason?: string }>; subscription?: AppleSubscriptionInfo }

/** Apple's standard licence agreement (the «Terms of Use» Apple asks subscription apps to link). */
export const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function parseIapInfo(value: unknown): AppleIapInfo {
  // On unless the server says no: an older server without /v1/apple/iap still gets the way to the PC app.
  const pcAppLink = !(isRecord(value) && value.pcAppLink === false)
  if (!isRecord(value) || value.enabled !== true || !Array.isArray(value.products)) return { enabled: false, products: [], siteLinkStorefronts: [], pcAppLink }
  const products = value.products.filter((entry): entry is AppleIapProduct => isRecord(entry) && typeof entry.id === 'string' && typeof entry.months === 'number')
  const token = typeof value.appAccountToken === 'string' && /^[0-9a-f-]{36}$/i.test(value.appAccountToken) ? value.appAccountToken : undefined
  const subscription = parseSubscription(value.subscription)
  const siteLinkStorefronts = Array.isArray(value.siteLinkStorefronts) ? value.siteLinkStorefronts.filter((code): code is string => typeof code === 'string' && /^[A-Z]{3}$/.test(code)) : []
  return { enabled: products.length > 0, products, ...(token ? { appAccountToken: token } : {}), ...(subscription ? { subscription } : {}), siteLinkStorefronts, pcAppLink }
}

function parseSubscription(value: unknown): AppleSubscriptionInfo | undefined {
  if (!isRecord(value) || typeof value.productId !== 'string' || typeof value.expiresAt !== 'string') return undefined
  return { productId: value.productId, months: Number(value.months) || 1, expiresAt: value.expiresAt, active: value.active === true }
}

/** GET /v1/apple/iap: whether the server sells through Apple, the products, the account's token and Apple period. */
export async function loadIapInfo(): Promise<AppleIapInfo> {
  return parseIapInfo(await webServiceRequest('GET', '/v1/apple/iap'))
}

/** Sends transactions Apple signed (JWS) to the server, which applies each once. */
export async function sendTransactions(signed: string[]): Promise<AppleSendResult> {
  const answer = await webServiceRequest('POST', '/v1/apple/transactions', { transactions: signed.slice(0, 20) })
  if (!isRecord(answer) || !Array.isArray(answer.results)) throw new Error('Не удалось проверить покупку. Нажмите «Восстановить покупки».')
  const subscription = parseSubscription(answer.subscription)
  return { results: answer.results.filter(isRecord).map((entry) => ({ status: String(entry.status) as AppleSendStatus, ...(typeof entry.reason === 'string' ? { reason: entry.reason } : {}) })), ...(subscription ? { subscription } : {}) }
}

/** What the player reads after a purchase or a restore; undefined when it went through. */
export function sendOutcome(result: AppleSendResult): string | undefined {
  const statuses = result.results.map((entry) => entry.status)
  if (statuses.some((status) => status === 'applied' || status === 'known')) return undefined
  if (statuses.includes('other-account')) return 'Эта подписка Apple оформлена на другой аккаунт Raid OS.'
  if (statuses.includes('revoked')) return 'Apple вернул деньги за эту покупку: подписка не действует.'
  if (statuses.length && statuses.every((status) => status === 'expired')) return 'Подписка Apple закончилась. Оформите её снова.'
  return 'Не удалось проверить покупку. Нажмите «Восстановить покупки».'
}

/** «1 месяц» / «3 месяца» / «12 месяцев». */
export function periodText(months: number) {
  return `${months} ${months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}`
}

/**
 * «−10 %»: how much a longer period saves against paying month by month, from StoreKit's own prices of this storefront
 * (the site's system: $7 a month, $19 for 3, $35 for 6, $60 for 12 — 10, 17 and 29 % off). 0 without a monthly product, for
 * the monthly one itself, or under 3 %.
 */
export function savingPercent(product: Pick<StoreProduct, 'months' | 'amount'>, products: ReadonlyArray<Pick<StoreProduct, 'months' | 'amount'>>) {
  const monthly = products.find((entry) => entry.months === 1)?.amount
  if (!monthly || !product.amount || product.months <= 1) return 0
  const percent = Math.round((1 - product.amount / (monthly * product.months)) * 100)
  return percent >= 3 ? percent : 0
}

/** The player closed Apple's sheet: nothing to say. */
export const purchaseCancelled = (reason: unknown) => /cancel|отмен/i.test(reason instanceof Error ? reason.message : String(reason))

// ---- StoreKit (the iPhone only) ---------------------------------------------------------------------------------------

/** The plugin, loaded once (a second load while the first is on its way would race it); again after a failed load. */
let loading: Promise<{ purchases: typeof import('@capgo/native-purchases').NativePurchases; SUBS: import('@capgo/native-purchases').PURCHASE_TYPE }> | undefined
const store = () => {
  loading ??= import('@capgo/native-purchases')
    .then((module) => ({ purchases: module.NativePurchases, SUBS: module.PURCHASE_TYPE.SUBS }))
    .catch((error: unknown) => { loading = undefined; throw error })
  return loading
}

/** The products with StoreKit's own names and prices, in the server's order; unknown to the App Store ones are left out. */
export async function storeProducts(products: AppleIapProduct[]): Promise<StoreProduct[]> {
  if (!products.length) return []
  const { purchases, SUBS } = await store()
  const { products: found } = await purchases.getProducts({ productIdentifiers: products.map((product) => product.id), productType: SUBS })
  return products.flatMap((product) => {
    const item = found.find((entry) => entry.identifier === product.id)
    return item ? [{ id: product.id, months: product.months, title: item.title || periodText(product.months), price: item.priceString, ...(Number.isFinite(item.price) && item.price > 0 ? { amount: item.price } : {}) }] : []
  })
}

/** Apple's purchase sheet; the transaction it signed, or an error (a cancel included: purchaseCancelled). */
export async function buyProduct(productId: string, appAccountToken: string | undefined): Promise<string> {
  const { purchases, SUBS } = await store()
  const transaction = await purchases.purchaseProduct({ productIdentifier: productId, productType: SUBS, quantity: 1, ...(appAccountToken ? { appAccountToken } : {}) })
  if (!transaction.jwsRepresentation) throw new Error('Не удалось проверить покупку. Нажмите «Восстановить покупки».')
  return transaction.jwsRepresentation
}

/** «Восстановить покупки»: the App Store is asked again, then the subscriptions the Apple ID has now. */
export async function restoreTransactions(ask = true): Promise<string[]> {
  const { purchases, SUBS } = await store()
  if (ask) await purchases.restorePurchases()
  const { purchases: owned } = await purchases.getPurchases({ productType: SUBS, onlyCurrentEntitlements: true })
  return owned.flatMap((entry) => (entry.jwsRepresentation ? [entry.jwsRepresentation] : []))
}

/** The App Store country of the player's Apple ID (alpha-3, «USA»), '' when StoreKit does not tell. */
export async function storefrontCountry(): Promise<string> {
  try {
    const { purchases } = await store()
    const { countryCode } = await purchases.getStorefront()
    return typeof countryCode === 'string' ? countryCode.toUpperCase() : ''
  } catch { return '' }
}

/** Apple's subscription page for this app (change or cancel). */
export async function manageSubscriptions() {
  const { purchases } = await store()
  await purchases.manageSubscriptions()
}

let following = false
/**
 * Once per app run: what StoreKit tells the app later (a renewal, an «Ask to Buy» approved, a refund) goes to the server
 * too. Apple's notifications reach the server anyway; this only makes the app quicker.
 */
export async function followStoreUpdates(onApplied: () => void) {
  if (following) return
  following = true
  try {
    const { purchases } = await store()
    await purchases.addListener('transactionUpdated', (transaction) => {
      if (!transaction.jwsRepresentation) return
      void sendTransactions([transaction.jwsRepresentation]).then((result) => { if (!sendOutcome(result)) onApplied() }).catch(() => {})
    })
  } catch { following = false }
}
