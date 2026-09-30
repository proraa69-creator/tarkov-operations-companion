import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { PaymentStore, paymentConfigFromEnv, planPrice } from './paymentStore.js'

const config = { shopId: '123456', secretKey: 'test_secret', monthPrice: 300, receipts: true, streamerPercent: 20 }

/** A fake ЮKassa: remembers created payments; `pay()` / `cancel()` change their state like the real one would. */
function fakeYooKassa() {
  const payments = new Map<string, Record<string, unknown>>()
  const requests: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = []
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method: String(init.method), url, headers, body })
    if (init.method === 'POST') {
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      const payment = { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}` } }
      payments.set(id, payment)
      return new Response(JSON.stringify(payment), { status: 200 })
    }
    const payment = payments.get(url.split('/').pop()!)
    return payment ? new Response(JSON.stringify(payment), { status: 200 }) : new Response('{"description":"not found"}', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return {
    fetch, requests,
    pay: (id: string) => Object.assign(payments.get(id)!, { status: 'succeeded', paid: true }),
    cancel: (id: string) => Object.assign(payments.get(id)!, { status: 'canceled' }),
    tamper: (id: string, value: string) => Object.assign(payments.get(id)!, { amount: { value, currency: 'RUB' } }),
  }
}

async function setup() {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, config, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  await accounts.register('streamer@example.com', 'correct horse battery')
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const { token } = await accounts.register('player@example.com', 'correct horse battery', 'HUNTER')
  const accountId = accounts.authenticate(token)!
  return { accounts, payments, yoo, accountId, advance: (ms: number) => { clock += ms } }
}

const providerId = (url: string) => new URL(url).searchParams.get('orderId')!

test('plans: 1, 3, 6 months at the monthly price, the year 33% off', () => {
  const store = new PaymentStore(openDatabase(':memory:'), config)
  assert.deepEqual(store.plans().map((plan) => [plan.id, plan.price, plan.discountPercent]), [['1m', 300, 0], ['3m', 900, 0], ['6m', 1800, 0], ['12m', 2412, 33]])
  assert.equal(planPrice(299, '12m'), 240396)
  assert.equal(new PaymentStore(openDatabase(':memory:'), undefined).enabled, false)
})

test('config comes only from a complete environment', () => {
  assert.equal(paymentConfigFromEnv({}), undefined)
  assert.equal(paymentConfigFromEnv({ YOOKASSA_SHOP_ID: '1', YOOKASSA_SECRET_KEY: 'k' }), undefined)
  const parsed = paymentConfigFromEnv({ YOOKASSA_SHOP_ID: '1', YOOKASSA_SECRET_KEY: 'k', TARKOV_PRICE_MONTH_RUB: '249', TARKOV_PUBLIC_URL: 'https://tarkov.example.com/' })
  assert.equal(parsed?.monthPrice, 249)
  assert.equal(parsed?.publicUrl, 'https://tarkov.example.com')
  assert.equal(parsed?.receipts, false)
})

test('a paid payment activates the subscription once and credits the streamer', async () => {
  const { accounts, payments, yoo, accountId, advance } = await setup()
  const created = await payments.create(accounts.billingInfo(accountId), '3m', 'https://tarkov.example.com')
  const request = yoo.requests[0]!
  assert.equal(request.headers.authorization, `Basic ${Buffer.from('123456:test_secret').toString('base64')}`)
  assert.ok(request.headers['idempotence-key'])
  assert.deepEqual((request.body as { amount: unknown }).amount, { value: '900.00', currency: 'RUB' })
  assert.equal((request.body as { confirmation: { return_url: string } }).confirmation.return_url, `https://tarkov.example.com/cabinet?payment=${created.paymentId}`)
  assert.equal((request.body as { receipt: { customer: { email: string } } }).receipt.customer.email, 'player@example.com')

  const id = providerId(created.confirmationUrl)
  await payments.sync(id)
  assert.equal(accounts.view(accountId).subscription.status, 'trial', 'not paid yet: still the referral trial')

  yoo.pay(id)
  await payments.sync(id)
  await payments.sync(id) // a repeated webhook changes nothing
  const view = accounts.view(accountId)
  assert.equal(view.subscription.status, 'active')
  assert.equal(view.subscription.paidUntil, new Date(Date.parse('2026-10-01T10:00:00.000Z') + 90 * 86_400_000).toISOString())
  assert.equal((await payments.status(accountId, created.paymentId)).status, 'succeeded')

  const streamer = accounts.view(accounts.authenticate((await accounts.login('streamer@example.com', 'correct horse battery')).token)!)
  assert.equal(streamer.stats?.activeSubscriptions, 1)
  assert.equal(streamer.stats?.revenue, undefined, 'the streamer never sees what his viewers paid')
  assert.deepEqual(streamer.stats?.earnings, { amount: 180, currency: 'RUB' })
  assert.deepEqual(accounts.streamers().streamers[0]!.stats.revenue, { amount: 900, currency: 'RUB' }, 'the owner does')

  // A second payment extends the period from its end, not from today.
  advance(10 * 86_400_000)
  const again = await payments.create(accounts.billingInfo(accountId), '1m', 'https://tarkov.example.com')
  yoo.pay(providerId(again.confirmationUrl))
  await payments.sync(providerId(again.confirmationUrl))
  assert.equal(accounts.view(accountId).subscription.paidUntil, new Date(Date.parse('2026-10-01T10:00:00.000Z') + 120 * 86_400_000).toISOString())
})

test('canceled, tampered and unknown payments never grant a subscription', async () => {
  const { accounts, payments, yoo, accountId } = await setup()
  const first = await payments.create(accounts.billingInfo(accountId), '1m', 'https://tarkov.example.com')
  yoo.cancel(providerId(first.confirmationUrl))
  await payments.sync(providerId(first.confirmationUrl))
  assert.equal((await payments.status(accountId, first.paymentId)).status, 'canceled')

  const second = await payments.create(accounts.billingInfo(accountId), '12m', 'https://tarkov.example.com')
  yoo.pay(providerId(second.confirmationUrl))
  yoo.tamper(providerId(second.confirmationUrl), '1.00')
  await payments.sync(providerId(second.confirmationUrl))
  await payments.sync('2d9999999999-000f-5000-9000-1b68e7b15f3f')
  await payments.sync('../../etc')
  assert.notEqual(accounts.view(accountId).subscription.status, 'active')
  await assert.rejects(payments.status('someone-else', first.paymentId), /не найден/)
})

test('streamer statistics by day, month and year: visits, sign-ups and paid plans', async () => {
  const { accounts, payments, yoo, accountId, advance } = await setup()
  const streamerId = accounts.authenticate((await accounts.login('streamer@example.com', 'correct horse battery')).token)!
  accounts.recordReferralVisit('HUNTER', '1.1.1.1')
  accounts.recordReferralVisit('HUNTER', '2.2.2.2')
  const paid = await payments.create(accounts.billingInfo(accountId), '3m', 'https://tarkov.example.com')
  yoo.pay(providerId(paid.confirmationUrl))
  await payments.sync(providerId(paid.confirmationUrl))

  const days = accounts.referralSeries(streamerId, 'day')
  assert.equal(days.length, 31)
  assert.deepEqual(days[0], { period: '2026-10-01', visits: 2, registrations: 1, payments: 1, months: { '1m': 0, '3m': 1, '6m': 0, '12m': 0 }, earnings: 180 })
  assert.equal(accounts.streamerSeries('HUNTER', 'day')[0]!.revenue, 900, 'the owner sees the revenue per period')
  assert.equal(days[1]!.period, '2026-09-30')

  advance(40 * 86_400_000)
  accounts.recordReferralVisit('HUNTER', '1.1.1.1')
  const months = accounts.referralSeries(streamerId, 'month')
  assert.equal(months.length, 12)
  assert.deepEqual(months.slice(0, 2).map((row) => [row.period, row.visits, row.payments]), [['2026-11', 1, 0], ['2026-10', 2, 1]])
  assert.deepEqual(accounts.referralSeries(streamerId, 'year').map((row) => [row.period, row.visits, row.registrations, row.earnings]), [['2026', 3, 1, 180]])
  assert.throws(() => accounts.referralSeries(accountId, 'day'), /только стримерам/)
})
