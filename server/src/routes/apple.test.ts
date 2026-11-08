import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { appleIapConfigFromEnv, createAppleVerifier, DEFAULT_APPLE_PRODUCTS, type AppleIapConfig, type AppleVerifier } from '../services/appleSubscriptions.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

/**
 * The subscription through Apple In-App Purchase (owner, 09.11.2026: «оплата была и в Apple, и на сайте»): only what Apple
 * signed counts, a period applies once, renewals and refunds come from Apple's notifications, one paid period with the site.
 */
const password = 'correct horse battery'
const DAY = 86_400_000
const MONTH = 30 * DAY
const BUNDLE = 'com.tarkovoperator.app'
const MONTHLY = 'com.tarkovoperator.app.sub.1m'
const SIGNATURE = 'c2lnbmVkLWJ5LWFwcGxl'

/** A JWS as the fake verifier takes it: Apple's signature stands for the last part being SIGNATURE. */
const signed = (payload: unknown, signature = SIGNATURE) => `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`
const decode = (jws: string) => {
  const [, payload, signature] = jws.split('.')
  if (signature !== SIGNATURE) throw new Error('bad signature')
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
}
const verifier: AppleVerifier = {
  async transaction(jws) { return decode(jws) },
  async notification(jws) {
    const body = decode(jws) as { notificationType?: string; subtype?: string; data?: { bundleId?: string; signedTransactionInfo?: string } }
    return { notificationType: body.notificationType, subtype: body.subtype, bundleId: body.data?.bundleId, ...(body.data?.signedTransactionInfo ? { transaction: decode(body.data.signedTransactionInfo) } : {}) }
  },
}

async function setup(config: AppleIapConfig | null = { bundleId: BUNDLE, products: [...DEFAULT_APPLE_PRODUCTS] }) {
  let clock = Date.parse('2026-11-10T10:00:00.000Z')
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [], now: () => clock })
  const payments = new PaymentStore(db, undefined, { now: () => clock })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, ...(config ? { appleIap: { config, verifier } } : {}), guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T }
  }
  const player = async (email: string) => {
    const registered = await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: 'US' })
    assert.equal(registered.status, 201, JSON.stringify(registered.json))
    return registered.json.token
  }
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  /** A fresh session (a month on the clock outlives the first one). */
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  return { payments, call, player, login, idOf, now: () => clock, advance: (ms: number) => { clock += ms }, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

type Iap = { enabled: boolean; products: Array<{ id: string; months: number }>; appAccountToken?: string; subscription?: { productId: string; expiresAt: string; active: boolean } }
type Sent = { results: Array<{ status: string; reason?: string; transactionId?: string }>; paidUntil?: string }

const transaction = (fields: Record<string, unknown>) => ({
  bundleId: BUNDLE, productId: MONTHLY, type: 'Auto-Renewable Subscription', inAppOwnershipType: 'PURCHASED', environment: 'Sandbox',
  price: 299_000, currency: 'RUB', storefront: 'RUS', ...fields,
})
const notification = (notificationType: string, tx: Record<string, unknown>, subtype?: string) => signed({ notificationType, ...(subtype ? { subtype } : {}), data: { bundleId: BUNDLE, environment: 'Sandbox', signedTransactionInfo: signed(tx) } })

test('off without the configuration: the app is told so, purchases and notifications are refused', async () => {
  const t = await setup(null)
  try {
    const token = await t.player('off@example.com')
    assert.deepEqual((await t.call<Iap>('GET', '/apple/iap', token)).json, { enabled: false, products: [] })
    assert.equal((await t.call('POST', '/apple/transactions', token, { transactions: [signed(transaction({ transactionId: '1', originalTransactionId: '1' }))] })).status, 503)
    assert.equal((await t.call('POST', '/apple/notifications', undefined, { signedPayload: notification('DID_RENEW', transaction({ transactionId: '1' })) })).status, 503)
    assert.equal((await t.call('GET', '/apple/iap')).status, 401)
  } finally { await t.close() }
})

test('a purchase opens the paid period up to Apple\'s end once; the renewal from Apple\'s notification follows without a gap; a refund takes it back', async () => {
  const t = await setup()
  try {
    const token = await t.player('buyer@example.com')
    const iap = (await t.call<Iap>('GET', '/apple/iap', token)).json
    assert.equal(iap.enabled, true)
    assert.deepEqual(iap.products.map((product) => product.months), [1, 3, 6, 12])
    assert.match(iap.appAccountToken ?? '', /^[0-9a-f-]{36}$/)
    assert.equal((await t.call<Iap>('GET', '/apple/iap', token)).json.appAccountToken, iap.appAccountToken, 'the same token every time')

    const start = t.now()
    const first = transaction({ transactionId: '2000000001', originalTransactionId: '2000000001', appAccountToken: iap.appAccountToken, purchaseDate: start, expiresDate: start + MONTH })
    const bought = await t.call<Sent>('POST', '/apple/transactions', token, { transactions: [signed(first)] })
    assert.equal(bought.status, 200)
    assert.equal(bought.json.results[0]?.status, 'applied')
    assert.equal(bought.json.paidUntil, new Date(start + MONTH).toISOString())
    const id = t.idOf('buyer@example.com')
    const [payment] = t.payments.list(id)
    assert.equal(payment?.provider, 'apple')
    assert.equal(payment?.status, 'succeeded')
    assert.equal(payment?.amount, 299)
    assert.equal(payment?.currency, 'RUB')
    assert.equal(payment?.plan, '1m')

    // «Восстановить покупки» sends it again: nothing more.
    const again = await t.call<Sent>('POST', '/apple/transactions', token, { transactions: [signed(first)] })
    assert.equal(again.json.results[0]?.status, 'known')
    assert.equal(t.payments.paidUntil(id), start + MONTH)
    assert.equal(t.payments.list(id).length, 1)

    // Apple renews: the notification alone (no app open), the next period from Apple's end.
    t.advance(MONTH - DAY)
    const renewal = transaction({ transactionId: '2000000002', originalTransactionId: '2000000001', appAccountToken: iap.appAccountToken, purchaseDate: start + MONTH, expiresDate: start + 2 * MONTH })
    assert.equal((await t.call('POST', '/apple/notifications', undefined, { signedPayload: notification('DID_RENEW', renewal) })).status, 200)
    assert.equal(t.payments.paidUntil(id), start + 2 * MONTH)
    assert.equal(t.payments.list(id).length, 2)
    // The same notification again (Apple retries): once only.
    await t.call('POST', '/apple/notifications', undefined, { signedPayload: notification('DID_RENEW', renewal) })
    assert.equal(t.payments.paidUntil(id), start + 2 * MONTH)

    // Apple refunds the renewal: its period goes, the payment is refunded.
    const refunded = { ...renewal, revocationDate: t.now(), revocationReason: 0 }
    assert.equal((await t.call('POST', '/apple/notifications', undefined, { signedPayload: notification('REFUND', refunded) })).status, 200)
    assert.equal(t.payments.paidUntil(id), start + MONTH)
    assert.equal(t.payments.list(id).find((entry) => entry.status === 'refunded')?.plan, '1m')
    const view = (await t.call<Iap>('GET', '/apple/iap', await t.login('buyer@example.com'))).json.subscription
    assert.equal(view?.expiresAt, new Date(start + MONTH).toISOString())
  } finally { await t.close() }
})

test('free days never burn: days paid on the site run first, Apple\'s period follows them', async () => {
  const t = await setup()
  try {
    const token = await t.player('site@example.com')
    const id = t.idOf('site@example.com')
    const start = t.now()
    t.payments.extendTo(id, start + 10 * DAY)
    const iap = (await t.call<Iap>('GET', '/apple/iap', token)).json
    const tx = transaction({ transactionId: '3000000001', originalTransactionId: '3000000001', appAccountToken: iap.appAccountToken, purchaseDate: start, expiresDate: start + MONTH, price: 4990, currency: 'USD', storefront: 'USA' })
    const sent = await t.call<Sent>('POST', '/apple/transactions', token, { transactions: [signed(tx)] })
    assert.equal(sent.json.results[0]?.status, 'applied')
    assert.equal(t.payments.paidUntil(id), start + 10 * DAY + MONTH)
    // Dollars: shown as paid; roubles counted 0 until the owner sets them.
    const [payment] = t.payments.list(id)
    assert.equal(payment?.currency, 'USD')
    assert.equal(payment?.amount, 4.99)
  } finally { await t.close() }
})

test('a purchase of another Raid OS account is never moved; a restore without a token goes to the account it was first applied to', async () => {
  const t = await setup()
  try {
    const owner = await t.player('first@example.com')
    const other = await t.player('second@example.com')
    const ownerToken = (await t.call<Iap>('GET', '/apple/iap', owner)).json.appAccountToken
    const start = t.now()
    const tx = transaction({ transactionId: '4000000001', originalTransactionId: '4000000001', appAccountToken: ownerToken, purchaseDate: start, expiresDate: start + MONTH })
    assert.equal((await t.call<Sent>('POST', '/apple/transactions', other, { transactions: [signed(tx)] })).json.results[0]?.status, 'other-account')
    assert.equal(t.payments.paidUntil(t.idOf('second@example.com')), undefined)
    assert.equal((await t.call<Sent>('POST', '/apple/transactions', owner, { transactions: [signed(tx)] })).json.results[0]?.status, 'applied')
    // Without a token (bought before the app sent one): bound to the first account, not to the one that restores.
    const renewal = transaction({ transactionId: '4000000002', originalTransactionId: '4000000001', purchaseDate: start + MONTH, expiresDate: start + 2 * MONTH })
    t.advance(MONTH - DAY)
    assert.equal((await t.call<Sent>('POST', '/apple/transactions', await t.login('second@example.com'), { transactions: [signed(renewal)] })).json.results[0]?.status, 'other-account')
    assert.equal((await t.call<Sent>('POST', '/apple/transactions', await t.login('first@example.com'), { transactions: [signed(renewal)] })).json.results[0]?.status, 'applied')
    assert.equal(t.payments.paidUntil(t.idOf('first@example.com')), start + 2 * MONTH)
  } finally { await t.close() }
})

test('only what Apple signed for this app and its subscriptions counts; a period already over adds nothing', async () => {
  const t = await setup()
  try {
    const token = await t.player('checks@example.com')
    const id = t.idOf('checks@example.com')
    const start = t.now()
    const base = { purchaseDate: start, expiresDate: start + MONTH }
    const send = async (jws: string) => (await t.call<Sent>('POST', '/apple/transactions', token, { transactions: [jws] })).json.results[0]
    assert.deepEqual(await send(signed(transaction({ transactionId: '5000000001', ...base }), 'Zm9yZ2Vk')), { status: 'ignored', reason: 'signature' })
    assert.equal((await send(signed(transaction({ transactionId: '5000000002', ...base, bundleId: 'com.other.app' }))))?.reason, 'bundle')
    assert.equal((await send(signed(transaction({ transactionId: '5000000003', ...base, productId: 'com.tarkovoperator.app.coins' }))))?.reason, 'product')
    assert.equal((await send(signed(transaction({ transactionId: '5000000004', ...base, inAppOwnershipType: 'FAMILY_SHARED' }))))?.reason, 'family')
    assert.equal((await send(signed(transaction({ transactionId: '5000000005', ...base, type: 'Consumable' }))))?.reason, 'type')
    assert.equal((await send(signed(transaction({ transactionId: '5000000006', purchaseDate: start - 2 * MONTH, expiresDate: start - MONTH }))))?.status, 'expired')
    assert.equal(t.payments.paidUntil(id), undefined)
    assert.equal(t.payments.list(id).length, 0)
    assert.equal((await t.call('POST', '/apple/transactions', token, { transactions: ['not a jws'] })).status, 400)
    assert.equal((await t.call('POST', '/apple/notifications', undefined, { signedPayload: signed({ notificationType: 'DID_RENEW' }, 'Zm9yZ2Vk') })).status, 400)
    assert.equal((await t.call('POST', '/apple/notifications', undefined, { signedPayload: signed({ notificationType: 'TEST', data: { bundleId: BUNDLE } }) })).status, 200)
  } finally { await t.close() }
})

test('the configuration: off unless APPLE_IAP=1; products as productId:months', () => {
  assert.equal(appleIapConfigFromEnv({}), undefined)
  assert.deepEqual(appleIapConfigFromEnv({ APPLE_IAP: '1' })?.products, [...DEFAULT_APPLE_PRODUCTS])
  assert.deepEqual(appleIapConfigFromEnv({ APPLE_IAP: '1', APPLE_APP_ID: '1234567890', APPLE_IAP_PRODUCTS: 'raidos.month:1, raidos.year:12' }), {
    bundleId: BUNDLE, appAppleId: 1234567890, products: [{ id: 'raidos.month', months: 1 }, { id: 'raidos.year', months: 12 }],
  })
  assert.throws(() => appleIapConfigFromEnv({ APPLE_IAP: '1', APPLE_IAP_PRODUCTS: 'raidos.week:0.25' }))
})

test("the real verifier (Apple's library) refuses what Apple did not sign", async () => {
  const real = createAppleVerifier({ bundleId: BUNDLE, appAppleId: 1234567890, products: [...DEFAULT_APPLE_PRODUCTS] }, [])
  await assert.rejects(real.transaction(signed(transaction({ transactionId: '6000000001', environment: 'Sandbox' }))))
  await assert.rejects(real.transaction(signed(transaction({ transactionId: '6000000002', environment: 'Production' }))))
  await assert.rejects(real.notification(notification('DID_RENEW', transaction({ transactionId: '6000000003' }))))
})
