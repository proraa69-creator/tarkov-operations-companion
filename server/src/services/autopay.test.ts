import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { PaymentStore, RENEW_MAX_ATTEMPTS, type AutopayNotice, type PaymentConfig } from './paymentStore.js'

const DAY = 86_400_000
const MONTH = 30 * DAY
const password = 'correct horse battery'
const consent = { version: '2026-10-01' }
const yooConfig: PaymentConfig = { shopId: '123456', secretKey: 'test_secret', monthPrice: 300, receipts: true, streamerPercent: 20, autopay: true }

type Req = { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> }

/** A fake ЮKassa that also understands charges with a saved payment method. */
function fakeYooKassa() {
  const payments = new Map<string, Record<string, unknown>>()
  const requests: Req[] = []
  const byKey = new Map<string, Record<string, unknown>>()
  let next = 1
  /** What the next charge with a saved method ends with. */
  let chargeOutcome: { status: 'succeeded' | 'canceled' | 'pending'; reason?: string } = { status: 'succeeded' }
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ method: String(init.method), url, headers, body })
    if (init.method === 'POST') {
      const key = headers['idempotence-key']!
      const repeated = byKey.get(key)
      if (repeated) return new Response(JSON.stringify(repeated), { status: 200 })
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      const payment: Record<string, unknown> = body!.payment_method_id
        ? { id, status: chargeOutcome.status, paid: chargeOutcome.status === 'succeeded', amount: body!.amount, metadata: body!.metadata, payment_method: { id: body!.payment_method_id, saved: true, type: 'bank_card' }, ...(chargeOutcome.reason ? { cancellation_details: { party: 'yoo_money', reason: chargeOutcome.reason } } : {}) }
        : { id, status: 'pending', paid: false, amount: body!.amount, metadata: body!.metadata, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}` } }
      payments.set(id, payment)
      byKey.set(key, payment)
      return new Response(JSON.stringify(payment), { status: 200 })
    }
    const payment = payments.get(url.split('/').pop()!)
    return payment ? new Response(JSON.stringify(payment), { status: 200 }) : new Response('{"description":"not found"}', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return {
    fetch, requests,
    charges: () => requests.filter((request) => request.method === 'POST' && request.body?.payment_method_id),
    /** The payer paid on the ЮKassa page; `saved` — whether ЮKassa saved the method. */
    pay: (id: string, saved: boolean) => Object.assign(payments.get(id)!, { status: 'succeeded', paid: true, payment_method: { id: `pm-${id}`, saved, type: 'bank_card', card: { last4: '4444' } } }),
    setChargeOutcome: (outcome: typeof chargeOutcome) => { chargeOutcome = outcome },
  }
}

async function setup(options: { config?: PaymentConfig | undefined } = {}) {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const yoo = fakeYooKassa()
  const notices: AutopayNotice[] = []
  const payments = new PaymentStore(db, 'config' in options ? options.config : yooConfig, { now, fetch: yoo.fetch, notify: (notice) => notices.push(notice) })
  accounts.attachSubscriptions(payments)
  await accounts.register('streamer@example.com', password)
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const { token } = await accounts.register('player@example.com', password, 'HUNTER')
  const accountId = accounts.authenticate(token)!
  // The player has signed in to the app: the referral trial runs (it starts there, owner 12.10.2026).
  accounts.claimTrialDevice(accountId, 'test-pc-player-abcdefghijklmnop')
  return { db, accounts, payments, yoo, notices, accountId, token, advance: (ms: number) => { clock += ms }, now }
}

const orderId = (url: string) => new URL(url).searchParams.get('orderId')!

// ───────────────────────────── ЮKassa autopayments ─────────────────────────────

test('ЮKassa: the method is saved only with the separate autopay consent', async () => {
  const { accounts, payments, yoo, accountId } = await setup()
  const oneOff = await payments.create(accounts.billingInfo(accountId), '1m', 'https://raidos.app', consent)
  assert.equal(yoo.requests.at(-1)!.body!.save_payment_method, undefined)
  // Even if ЮKassa reports a saved method, a payment without the consent never becomes an autopayment.
  yoo.pay(orderId(oneOff.confirmationUrl), true)
  await payments.sync(orderId(oneOff.confirmationUrl))
  assert.equal(payments.autopay(accountId), null)

  const withAutopay = await payments.create(accounts.billingInfo(accountId), '1m', 'https://raidos.app', consent, consent)
  assert.equal(yoo.requests.at(-1)!.body!.save_payment_method, true)
  yoo.pay(orderId(withAutopay.confirmationUrl), true)
  await payments.sync(orderId(withAutopay.confirmationUrl))
  const view = payments.autopay(accountId)!
  assert.deepEqual([view.provider, view.status, view.amount, view.method, view.consentVersion], ['yookassa', 'active', 300, 'Карта *4444', consent.version])

  // ЮKassa did not save the method (e.g. the payer's bank refused): no autopayment either.
  const other = await accounts.register('other@example.com', password)
  const otherId = accounts.authenticate(other.token)!
  const notSaved = await payments.create(accounts.billingInfo(otherId), '1m', 'https://raidos.app', consent, consent)
  yoo.pay(orderId(notSaved.confirmationUrl), false)
  await payments.sync(orderId(notSaved.confirmationUrl))
  assert.equal(payments.autopay(otherId), null)

  const off = await setup({ config: { ...yooConfig, autopay: false } })
  await assert.rejects(off.payments.create(off.accounts.billingInfo(off.accountId), '1m', 'https://raidos.app', consent, consent), /не подключены/)
})

async function subscribed(options: Parameters<typeof setup>[0] = {}) {
  const context = await setup(options)
  const { accounts, payments, yoo, accountId } = context
  const created = await payments.create(accounts.billingInfo(accountId), '3m', 'https://raidos.app', consent, consent)
  yoo.pay(orderId(created.confirmationUrl), true)
  await payments.sync(orderId(created.confirmationUrl))
  return { ...context, firstProviderId: orderId(created.confirmationUrl) }
}

test('ЮKassa scheduler: charges once per period with the saved method, a day before the end', async () => {
  const { accounts, payments, yoo, accountId, advance, notices, firstProviderId } = await subscribed()
  const until = () => Date.parse(accounts.view(accountId).subscription.paidUntil!)
  const firstEnd = until()

  assert.equal((await payments.runRecurring()).charged, 0, 'nothing to charge right after paying')
  advance(3 * MONTH - 4 * DAY - 1)
  await payments.runRecurring()
  assert.equal(notices.length, 0)
  advance(2)
  assert.equal((await payments.runRecurring()).noticed, 1, 'the «upcoming charge» hook fires 3 days before the charge')
  assert.equal((await payments.runRecurring()).noticed, 0, 'once per period')
  assert.equal(yoo.charges().length, 0)

  advance(3 * DAY)
  const run = await payments.runRecurring()
  assert.equal(run.charged, 1)
  const charge = yoo.charges()[0]!
  assert.equal(charge.body!.payment_method_id, `pm-${firstProviderId}`, 'the method ЮKassa saved with the first payment')
  assert.equal(charge.body!.capture, true)
  assert.equal(charge.body!.confirmation, undefined)
  assert.deepEqual(charge.body!.amount, { value: '800.00', currency: 'RUB' })
  assert.equal((charge.body!.receipt as { customer: { email: string } }).customer.email, 'player@example.com')
  assert.match(charge.headers['idempotence-key']!, /^renew-/)
  assert.equal(until(), firstEnd + 3 * MONTH, 'extended from the end of the paid period')
  assert.equal(notices.at(-1)!.type, 'charged')

  // Running again (every hour) in the same period never charges twice.
  for (let i = 0; i < 5; i++) { advance(60 * 60 * 1000); await payments.runRecurring() }
  assert.equal(yoo.charges().length, 1)
  const renewals = payments.list(accountId).filter((item) => item.renewal)
  assert.equal(renewals.length, 1)
  assert.equal(payments.referralStats('HUNTER').earnings, 2 * 16000, 'the streamer gets his share of the renewal too')

  // Next period: one more charge.
  advance(3 * MONTH)
  await payments.runRecurring()
  assert.equal(yoo.charges().length, 2)
})

test('ЮKassa scheduler: nothing after «Отменить автопродление», the paid period stays', async () => {
  const { accounts, payments, yoo, accountId, advance } = await subscribed()
  const view = await payments.cancelAutopay(accounts.billingInfo(accountId))
  assert.equal(view?.status, 'canceled')
  assert.equal(view?.method, 'Карта *4444')
  const stored = payments.database.prepare('SELECT method_id FROM recurring_subscriptions').get() as { method_id: string | null }
  assert.equal(stored.method_id, null, 'the saved payment method id is deleted')
  await assert.rejects(payments.cancelAutopay(accounts.billingInfo(accountId)), /не включено/)
  assert.equal(accounts.view(accountId).subscription.status, 'active')
  advance(3 * MONTH - DAY / 2)
  await payments.runRecurring()
  advance(2 * DAY)
  await payments.runRecurring()
  assert.equal(yoo.charges().length, 0)
  assert.equal(accounts.view(accountId).subscription.status, 'inactive', 'ends with the paid period')
})

test('ЮKassa scheduler: never charges when the owner switched autopayments off', async () => {
  const context = await subscribed()
  const paused = new PaymentStore(context.db, { ...yooConfig, autopay: false }, { now: context.now, fetch: context.yoo.fetch })
  context.advance(3 * MONTH - DAY / 2)
  assert.deepEqual(await paused.runRecurring(), { charged: 0, pending: 0, failed: 0, noticed: 0 })
  assert.equal(context.yoo.charges().length, 0)
})

test('ЮKassa scheduler: failed charges retry daily, a limited number of times; a revoked method stops at once', async () => {
  const { payments, yoo, accountId, advance } = await subscribed()
  yoo.setChargeOutcome({ status: 'canceled', reason: 'insufficient_funds' })
  advance(3 * MONTH - DAY / 2)
  assert.equal((await payments.runRecurring()).failed, 1)
  assert.equal((await payments.runRecurring()).failed, 0, 'no retry within the same day')
  for (let attempt = 2; attempt <= RENEW_MAX_ATTEMPTS + 2; attempt++) { advance(DAY); await payments.runRecurring() }
  assert.equal(yoo.charges().length, RENEW_MAX_ATTEMPTS)
  assert.equal(new Set(yoo.charges().map((charge) => charge.headers['idempotence-key'])).size, RENEW_MAX_ATTEMPTS, 'each attempt has its own Idempotence-Key')
  assert.equal(payments.autopay(accountId)!.status, 'failed')

  const revoked = await subscribed()
  revoked.yoo.setChargeOutcome({ status: 'canceled', reason: 'permission_revoked' })
  revoked.advance(3 * MONTH - DAY / 2)
  await revoked.payments.runRecurring()
  revoked.advance(DAY)
  await revoked.payments.runRecurring()
  assert.equal(revoked.yoo.charges().length, 1)
  assert.equal(revoked.payments.autopay(revoked.accountId)!.status, 'failed')
})

test('older payment tables get the payments v2 columns on start', () => {
  const db = openDatabase(':memory:')
  new AccountStore({ db, ownerEmails: [] })
  db.exec("CREATE TABLE payments (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT UNIQUE, plan TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, referral_code TEXT, created_at INTEGER NOT NULL, paid_at INTEGER)")
  db.exec("INSERT INTO payments (id, account_id, plan, amount, status, created_at) VALUES ('old', 'nobody', '1m', 30000, 'succeeded', 1)")
  new PaymentStore(db, undefined)
  const columns = (db.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string }>).map((row) => row.name)
  for (const name of ['provider', 'currency', 'amount_original', 'autopay_consent_version', 'recurring_id', 'period_end']) assert.ok(columns.includes(name), name)
  new PaymentStore(db, undefined)
})
