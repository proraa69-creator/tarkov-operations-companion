import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { DEFAULT_LAVA_OFFER_ID, extractPrices, LavaClient, lavaConfigFromEnv, lavaWebhookAuthorized, parseLavaEvent } from './lavaTop.js'
import { PaymentStore, RENEW_MAX_ATTEMPTS, type AutopayNotice, type PaymentConfig } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'

const DAY = 86_400_000
const MONTH = 30 * DAY
const password = 'correct horse battery'
const consent = { version: '2026-10-01' }
const yooConfig: PaymentConfig = { shopId: '123456', secretKey: 'test_secret', monthPrice: 300, receipts: true, streamerPercent: 20, autopay: true }
const lavaConfig = { apiKey: 'lava-api-key-123', webhookKey: 'hook-secret-456', offerId: DEFAULT_LAVA_OFFER_ID, currency: 'USD' as const, rubRate: 90 }

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

/** What the fake Lava.top charges per periodicity (USD), in its invoice answers. */
const LAVA_INVOICE_PRICES: Record<string, number> = { MONTHLY: 4.99, PERIOD_90_DAYS: 12.99, PERIOD_180_DAYS: 24.99, PERIOD_YEAR: 39.99 }

/** A fake Lava.top API: invoices, subscription cancel and products. */
function fakeLava() {
  const requests: Req[] = []
  let next = 1
  let cancelStatus = 200
  let invoiceAmount = true
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ method: String(init.method), url, headers, body })
    const path = new URL(url).pathname
    if (init.method === 'POST' && path === '/api/v2/invoice') {
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
      const total = invoiceAmount ? { amountTotal: { currency: body!.currency, amount: LAVA_INVOICE_PRICES[String(body!.periodicity)] } } : {}
      return new Response(JSON.stringify({ id, status: 'in-progress', ...total, paymentUrl: `https://app.lava.top/pay/${id}` }), { status: 200 })
    }
    if (init.method === 'DELETE' && path === '/api/v1/subscriptions') return new Response(cancelStatus === 200 ? '' : '{"error":"subscription not active"}', { status: cancelStatus })
    if (path === '/api/v2/products') {
      return new Response(JSON.stringify({ items: [{ id: 'p1', offers: [{ id: DEFAULT_LAVA_OFFER_ID, prices: [{ currency: 'USD', amount: 4.99, periodicity: 'MONTHLY' }, { currency: 'USD', amount: 12.99, periodicity: 'PERIOD_90_DAYS' }, { currency: 'EUR', amount: 4.5, periodicity: 'MONTHLY' }] }] }] }), { status: 200 })
    }
    return new Response('{"error":"not found"}', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests, failCancel: (status: number) => { cancelStatus = status }, omitInvoiceAmount: () => { invoiceAmount = false } }
}

async function setup(options: { config?: PaymentConfig | undefined; lava?: boolean } = {}) {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const yoo = fakeYooKassa()
  const lavaApi = fakeLava()
  const notices: AutopayNotice[] = []
  const lava = options.lava ? new LavaClient(lavaConfig, { fetch: lavaApi.fetch }) : undefined
  const payments = new PaymentStore(db, 'config' in options ? options.config : yooConfig, { now, fetch: yoo.fetch, ...(lava ? { lava } : {}), notify: (notice) => notices.push(notice) })
  accounts.attachSubscriptions(payments)
  await accounts.register('streamer@example.com', password)
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const { token } = await accounts.register('player@example.com', password, 'HUNTER')
  const accountId = accounts.authenticate(token)!
  return { db, accounts, payments, yoo, lavaApi, notices, accountId, token, advance: (ms: number) => { clock += ms }, now }
}

const orderId = (url: string) => new URL(url).searchParams.get('orderId')!
const hook = { apiKey: lavaConfig.webhookKey }

// ───────────────────────────── Lava.top ─────────────────────────────

test('lava config needs both keys, a UUID offer, USD/EUR and a rouble rate', () => {
  const env = { LAVA_API_KEY: 'k', LAVA_WEBHOOK_KEY: 'hook-secret', LAVA_OFFER_ID: DEFAULT_LAVA_OFFER_ID, LAVA_CURRENCY: 'eur', LAVA_RUB_RATE: '95.5' }
  assert.deepEqual(lavaConfigFromEnv(env), { apiKey: 'k', webhookKey: 'hook-secret', offerId: DEFAULT_LAVA_OFFER_ID, currency: 'EUR', rubRate: 95.5 })
  assert.equal(lavaConfigFromEnv({ ...env, LAVA_CURRENCY: 'RUB' }), undefined)
  assert.equal(lavaConfigFromEnv({ ...env, LAVA_OFFER_ID: 'not-a-uuid' }), undefined)
  assert.equal(lavaConfigFromEnv({ ...env, LAVA_RUB_RATE: '' }), undefined)
  assert.equal(lavaConfigFromEnv({ ...env, LAVA_WEBHOOK_KEY: '' }), undefined)
})

test('lava webhook authentication: X-Api-Key or Basic auth with the webhook key, nothing else', () => {
  const key = lavaConfig.webhookKey
  assert.equal(lavaWebhookAuthorized({ apiKey: key }, key), true)
  assert.equal(lavaWebhookAuthorized({ apiKey: `${key}x` }, key), false)
  assert.equal(lavaWebhookAuthorized({}, key), false)
  assert.equal(lavaWebhookAuthorized({ authorization: `Basic ${Buffer.from(`lava:${key}`).toString('base64')}` }, key), true)
  assert.equal(lavaWebhookAuthorized({ authorization: `Basic ${Buffer.from(key).toString('base64')}` }, key), true)
  assert.equal(lavaWebhookAuthorized({ authorization: `Basic ${Buffer.from('lava:wrong').toString('base64')}` }, key), false)
  assert.equal(lavaWebhookAuthorized({ authorization: `Bearer ${key}` }, key), false)
  assert.equal(lavaWebhookAuthorized({ apiKey: '' }, ''), false, 'no configured key never authorizes')
})

test('lava events are read defensively', () => {
  assert.equal(parseLavaEvent('text'), undefined)
  assert.equal(parseLavaEvent({ eventType: 'something.new' })?.kind, 'unknown')
  const event = parseLavaEvent({ eventType: 'subscription.recurring.payment.success', contractId: 'c2', parentContractId: 'c1', buyer: { email: 'A@B.com' }, amount: 12.99, currency: 'usd', periodicity: 'PERIOD_90_DAYS' })
  assert.deepEqual(event, { kind: 'recurring.success', type: 'subscription.recurring.payment.success', contractId: 'c2', parentContractId: 'c1', email: 'a@b.com', amount: 12.99, currency: 'USD', plan: '3m' })
  assert.equal(parseLavaEvent({ eventType: 'payment.success', contractId: 'c1' })?.kind, 'payment.success')
  assert.equal(parseLavaEvent({ eventType: 'payment.failed', contractId: 'c1' })?.kind, 'payment.failed')
  assert.equal(parseLavaEvent({ eventType: 'subscription.cancelled', contractId: 'c1' })?.kind, 'subscription.cancelled')
  assert.deepEqual(extractPrices({ items: [] }, DEFAULT_LAVA_OFFER_ID, 'USD'), null)
})

test('lava invoice: offer, currency, periodicity per plan, buyer language; autopay consent required', async () => {
  const { accounts, payments, lavaApi, accountId } = await setup({ lava: true })
  const billing = accounts.billingInfo(accountId)
  await assert.rejects(payments.createLava(billing, '3m', consent, undefined, 'EN'), /автоматическое списание/)
  const created = await payments.createLava(billing, '3m', consent, consent, 'EN')
  assert.match(created.confirmationUrl, /^https:\/\/app\.lava\.top\/pay\//)
  const request = lavaApi.requests.find((item) => item.method === 'POST')!
  assert.equal(request.url, 'https://gate.lava.top/api/v2/invoice')
  assert.equal(request.headers['x-api-key'], lavaConfig.apiKey)
  assert.deepEqual(request.body, { email: 'player@example.com', offerId: DEFAULT_LAVA_OFFER_ID, currency: 'USD', periodicity: 'PERIOD_90_DAYS', buyerLanguage: 'EN' })
  for (const [plan, periodicity] of [['1m', 'MONTHLY'], ['6m', 'PERIOD_180_DAYS'], ['12m', 'PERIOD_YEAR']] as const) {
    const other = await accounts.register(`p-${plan}@example.com`, password)
    await payments.createLava(accounts.billingInfo(accounts.authenticate(other.token)!), plan, consent, consent, 'RU')
    assert.equal(lavaApi.requests.filter((item) => item.method === 'POST').at(-1)!.body!.periodicity, periodicity)
  }
  assert.deepEqual(await payments.foreignPrices(), { '1m': 4.99, '3m': 12.99 })
  assert.deepEqual(payments.providers(), { yookassa: true, lava: true, autopay: true, lavaCurrency: 'USD' })
})

test('lava webhooks: auth, first payment, duplicates, renewals and cancellation', async () => {
  const { accounts, payments, accountId, advance, now } = await setup({ lava: true })
  const { confirmationUrl } = await payments.createLava(accounts.billingInfo(accountId), '3m', consent, consent, 'EN')
  const contractId = confirmationUrl.split('/').pop()!
  const paid = { eventType: 'payment.success', contractId, buyer: { email: 'player@example.com' }, amount: 12.99, currency: 'USD', status: 'subscription-active' }

  assert.equal(payments.lavaWebhook({}, paid).status, 401)
  assert.equal(payments.lavaWebhook({ apiKey: 'wrong' }, paid).status, 401)
  assert.equal(accounts.view(accountId).subscription.status, 'trial', 'an unauthenticated webhook changes nothing')
  assert.equal(payments.lavaWebhook(hook, 'garbage').status, 400)

  assert.deepEqual(payments.lavaWebhook(hook, paid), { status: 200, result: 'paid' })
  const firstUntil = Date.parse(accounts.view(accountId).subscription.paidUntil!)
  assert.equal(firstUntil, now() + 90 * DAY + 3 * DAY, 'Lava\'s 90 days plus 3 days of grace')
  assert.deepEqual(payments.lavaWebhook(hook, paid), { status: 200, result: 'duplicate' })
  assert.equal(Date.parse(accounts.view(accountId).subscription.paidUntil!), firstUntil, 'a repeated webhook extends once')
  const [payment] = payments.list(accountId)
  assert.deepEqual([payment!.provider, payment!.amount, payment!.currency, payment!.status], ['lava', 12.99, 'USD', 'succeeded'])
  // Streamer share like ЮKassa: 20% of the rouble equivalent (12.99 USD × 90 ₽ = 1169.10 ₽ → 233.82 ₽).
  assert.deepEqual(payments.referralStats('HUNTER'), { activeSubscriptions: 1, revenue: 116910, earnings: 23382 })
  const autopay = payments.autopay(accountId)!
  assert.deepEqual([autopay.provider, autopay.status, autopay.plan, autopay.amount, autopay.currency, autopay.consentVersion], ['lava', 'active', '3m', 12.99, 'USD', consent.version])

  // Lava renews the subscription itself: each recurring success extends by the plan period, once.
  advance(3 * MONTH - DAY)
  const renewal = { eventType: 'subscription.recurring.payment.success', contractId: '11111111-0000-4000-8000-000000000001', parentContractId: contractId, amount: 12.99, currency: 'USD' }
  assert.deepEqual(payments.lavaWebhook({ authorization: `Basic ${Buffer.from(`lava:${lavaConfig.webhookKey}`).toString('base64')}` }, renewal), { status: 200, result: 'renewed' })
  assert.equal(Date.parse(accounts.view(accountId).subscription.paidUntil!), firstUntil + 3 * MONTH)
  assert.equal(payments.lavaWebhook(hook, renewal).result, 'duplicate')
  assert.equal(payments.lavaWebhook(hook, { ...renewal, eventId: 'another-delivery' }).result, 'already-applied', 'even under another event id the same contract pays once')
  assert.equal(Date.parse(accounts.view(accountId).subscription.paidUntil!), firstUntil + 3 * MONTH)
  assert.equal(payments.list(accountId).filter((item) => item.renewal).length, 1)
  assert.equal(payments.referralStats('HUNTER').earnings, 2 * 23382)

  // Cancelled (in Lava, by the buyer): the renewal stops, the paid period stays.
  assert.equal(payments.lavaWebhook(hook, { eventType: 'subscription.cancelled', contractId }).result, 'cancelled')
  assert.equal(payments.autopay(accountId)!.status, 'canceled')
  assert.equal(accounts.view(accountId).subscription.status, 'active')
  // Events of contracts that are not ours are acknowledged and ignored.
  assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: 'foreign-contract' }).result, 'not-ours')
})

test('lava: «Отменить автопродление» cancels through the Lava API; a refusal changes nothing', async () => {
  const { accounts, payments, lavaApi, accountId } = await setup({ lava: true })
  const { confirmationUrl } = await payments.createLava(accounts.billingInfo(accountId), '1m', consent, consent, 'RU')
  const contractId = confirmationUrl.split('/').pop()!
  payments.lavaWebhook(hook, { eventType: 'payment.success', contractId, amount: 4.99, currency: 'USD' })
  await assert.rejects(payments.createLava(accounts.billingInfo(accountId), '3m', consent, consent, 'RU'), /уже включено/, 'no second subscription while one renews')

  lavaApi.failCancel(500)
  await assert.rejects(payments.cancelAutopay(accounts.billingInfo(accountId)), /Lava\.top/)
  assert.equal(payments.autopay(accountId)!.status, 'active')
  lavaApi.failCancel(200)
  const view = await payments.cancelAutopay(accounts.billingInfo(accountId))
  assert.equal(view?.status, 'canceled')
  const cancel = lavaApi.requests.find((item) => item.method === 'DELETE' && lavaApi.requests.indexOf(item) === lavaApi.requests.length - 1)!
  assert.equal(new URL(cancel.url).searchParams.get('contractId'), contractId)
  assert.equal(new URL(cancel.url).searchParams.get('email'), 'player@example.com')
  assert.equal(accounts.view(accountId).subscription.status, 'active', 'the paid month stays')
})

test('lava webhook over HTTP: 401 without the key, 200 and applied with it', async () => {
  const { accounts, payments, accountId } = await setup({ lava: true })
  const { confirmationUrl } = await payments.createLava(accounts.billingInfo(accountId), '1m', consent, consent, 'RU')
  const contractId = confirmationUrl.split('/').pop()!
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const post = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${address.port}/v1/payments/lava/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ eventType: 'payment.success', contractId, amount: 4.99, currency: 'USD' }) })
  try {
    assert.equal((await post({})).status, 401)
    assert.equal((await post({ 'x-api-key': 'nope' })).status, 401)
    const ok = await post({ 'x-api-key': lavaConfig.webhookKey })
    assert.equal(ok.status, 200)
    assert.equal(accounts.view(accountId).subscription.status, 'active')
    assert.deepEqual(await (await post({ 'x-api-key': lavaConfig.webhookKey })).json(), { ok: true, result: 'duplicate' })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

/** Runs `body` with console.warn captured (the store logs Lava mismatches there). */
async function withWarnings(body: (warnings: string[]) => Promise<void> | void) {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (message: unknown) => { warnings.push(String(message)) }
  try { await body(warnings) } finally { console.warn = original }
}

test('lava webhooks never decide the plan or the amount: a mismatch is recorded and grants nothing', async () => {
  const { db, accounts, payments, accountId, now } = await setup({ lava: true })
  const { confirmationUrl, paymentId } = await payments.createLava(accounts.billingInfo(accountId), '12m', consent, consent, 'EN')
  const contractId = confirmationUrl.split('/').pop()!
  await withWarnings((warnings) => {
    // Paid less than the invoice (the monthly price for the yearly invoice): nothing is granted.
    assert.deepEqual(payments.lavaWebhook(hook, { eventType: 'payment.success', eventId: 'e1', contractId, amount: 4.99, currency: 'USD', periodicity: 'MONTHLY' }), { status: 200, result: 'amount-mismatch' })
    // The same number in another currency is not the invoice either.
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', eventId: 'e2', contractId, amount: 39.99, currency: 'EUR' }).result, 'amount-mismatch')
    assert.equal(accounts.view(accountId).subscription.status, 'trial')
    assert.equal(payments.list(accountId)[0]!.status, 'pending')
    assert.equal(payments.autopay(accountId), null)
    const recorded = db.prepare('SELECT payment_id, contract_id, expected_amount, expected_currency, got_amount, got_currency FROM lava_mismatches ORDER BY id').all().map((row) => ({ ...row }))
    assert.deepEqual(recorded, [
      { payment_id: paymentId, contract_id: contractId, expected_amount: 3999, expected_currency: 'USD', got_amount: 499, got_currency: 'USD' },
      { payment_id: paymentId, contract_id: contractId, expected_amount: 3999, expected_currency: 'USD', got_amount: 3999, got_currency: 'EUR' },
    ])
    assert.equal(warnings.length, 2)
    assert.match(warnings[0]!, /NOT applied: webhook 4\.99 USD, expected 39\.99 USD/)

    // The invoice's own amount is granted — for the invoice's plan (12 months), whatever periodicity the body names.
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', eventId: 'e3', contractId, amount: 39.99, currency: 'USD', periodicity: 'MONTHLY' }).result, 'paid')
    const firstUntil = Date.parse(accounts.view(accountId).subscription.paidUntil!)
    assert.equal(firstUntil, now() + 365 * DAY + 3 * DAY)
    assert.equal(payments.autopay(accountId)!.plan, '12m')
    assert.equal(payments.list(accountId)[0]!.amount, 39.99)

    // Renewals: the subscription's own plan, amount and currency; a different amount renews nothing.
    const renewal = { eventType: 'subscription.recurring.payment.success', parentContractId: contractId, currency: 'USD', periodicity: 'MONTHLY' }
    assert.equal(payments.lavaWebhook(hook, { ...renewal, contractId: 'renewal-1', amount: 4.99 }).result, 'amount-mismatch')
    assert.equal(Date.parse(accounts.view(accountId).subscription.paidUntil!), firstUntil)
    assert.equal(payments.lavaWebhook(hook, { ...renewal, contractId: 'renewal-2', amount: 39.99 }).result, 'renewed')
    assert.equal(Date.parse(accounts.view(accountId).subscription.paidUntil!), firstUntil + 12 * MONTH)
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM lava_mismatches WHERE recurring_id IS NOT NULL').get()!.n), 1)
    assert.equal(warnings.length, 3)
  })
})

test('lava: an invoice answer without an amount takes the offer price; an unknown amount is never granted', async () => {
  const { db, accounts, payments, lavaApi, accountId } = await setup({ lava: true })
  lavaApi.omitInvoiceAmount()
  const quarter = await payments.createLava(accounts.billingInfo(accountId), '3m', consent, consent, 'EN')
  assert.equal(payments.list(accountId)[0]!.amount, 12.99, 'the 3-month price from Lava\'s product list')
  // The fake product list has no yearly price: the invoice amount stays unknown.
  const year = await payments.createLava(accounts.billingInfo(accountId), '12m', consent, consent, 'EN')
  await withWarnings((warnings) => {
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: year.confirmationUrl.split('/').pop()!, amount: 39.99, currency: 'USD' }).result, 'amount-mismatch')
    assert.equal(accounts.view(accountId).subscription.status, 'trial')
    assert.deepEqual({ ...db.prepare('SELECT payment_id, expected_amount, got_amount FROM lava_mismatches').get() }, { payment_id: year.paymentId, expected_amount: null, got_amount: 3999 })
    assert.match(warnings[0]!, /expected unknown/)
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: quarter.confirmationUrl.split('/').pop()!, amount: 12.99, currency: 'USD' }).result, 'paid')
    assert.equal(accounts.view(accountId).subscription.status, 'active')
  })
})

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
  assert.deepEqual(charge.body!.amount, { value: '900.00', currency: 'RUB' })
  assert.equal((charge.body!.receipt as { customer: { email: string } }).customer.email, 'player@example.com')
  assert.match(charge.headers['idempotence-key']!, /^renew-/)
  assert.equal(until(), firstEnd + 3 * MONTH, 'extended from the end of the paid period')
  assert.equal(notices.at(-1)!.type, 'charged')

  // Running again (every hour) in the same period never charges twice.
  for (let i = 0; i < 5; i++) { advance(60 * 60 * 1000); await payments.runRecurring() }
  assert.equal(yoo.charges().length, 1)
  const renewals = payments.list(accountId).filter((item) => item.renewal)
  assert.equal(renewals.length, 1)
  assert.equal(payments.referralStats('HUNTER').earnings, 2 * 18000, 'the streamer gets his share of the renewal too')

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
