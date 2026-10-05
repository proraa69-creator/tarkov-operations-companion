import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { PaymentStore, paymentConfigFromEnv } from './paymentStore.js'
import { recordPayment } from './testPayments.js'

const START = Date.parse('2026-10-01T10:00:00.000Z')

async function setup() {
  let clock = START
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now })
  const payments = new PaymentStore(db, { streamerPercent: 20 }, { now })
  accounts.attachSubscriptions(payments)
  await accounts.register('streamer@example.com', 'correct horse battery')
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const { token } = await accounts.register('player@example.com', 'correct horse battery', 'HUNTER')
  const accountId = accounts.authenticate(token)!
  return { db, accounts, payments, accountId, now, advance: (ms: number) => { clock += ms } }
}

test('no payment provider is connected: nothing to buy', () => {
  const store = new PaymentStore(openDatabase(':memory:'), undefined)
  assert.equal(store.enabled, false)
  assert.deepEqual(store.plans(), [])
})

test('the streamer share comes from TARKOV_STREAMER_PERCENT, 10 % by default, clamped to 0–100', () => {
  assert.equal(paymentConfigFromEnv({}).streamerPercent, 10)
  assert.equal(paymentConfigFromEnv({ TARKOV_STREAMER_PERCENT: '15' }).streamerPercent, 15)
  assert.equal(paymentConfigFromEnv({ TARKOV_STREAMER_PERCENT: '150' }).streamerPercent, 100)
  assert.equal(paymentConfigFromEnv({ TARKOV_STREAMER_PERCENT: 'x' }).streamerPercent, 10)
})

test('a recorded payment activates the subscription and credits the streamer', async () => {
  const { accounts, payments, accountId, now, advance } = await setup()
  assert.equal(accounts.view(accountId).subscription.status, 'trial')
  recordPayment(payments, accountId, '3m', 900, { now: now() })
  const view = accounts.view(accountId)
  assert.equal(view.subscription.status, 'active')
  assert.equal(view.subscription.paidUntil, new Date(START + 90 * 86_400_000).toISOString())

  const streamer = accounts.view(accounts.authenticate((await accounts.login('streamer@example.com', 'correct horse battery')).token)!)
  assert.equal(streamer.stats?.activeSubscriptions, 1)
  assert.equal(streamer.stats?.revenue, undefined, 'the streamer never sees what his viewers paid')
  assert.deepEqual(streamer.stats?.earnings, { amount: 180, currency: 'RUB' })
  assert.deepEqual(accounts.streamers().streamers[0]!.stats.revenue, { amount: 900, currency: 'RUB' }, 'the owner does')

  advance(10 * 86_400_000)
  recordPayment(payments, accountId, '1m', 300, { now: now() })
  assert.equal(accounts.view(accountId).subscription.paidUntil, new Date(START + 120 * 86_400_000).toISOString())
})

test('the history keeps the payments of the removed providers', async () => {
  const { db, payments, accountId, now } = await setup()
  recordPayment(payments, accountId, '1m', 300, { now: now(), provider: 'yookassa' })
  db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, paid_at, provider, currency, amount_original) VALUES ('lava1', ?, '1m', 45000, 'succeeded', ?, ?, 'lava', 'USD', 500)").run(accountId, now() - 1, now() - 1)
  db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at) VALUES ('old1', ?, '1m', 30000, 'succeeded', ?)").run(accountId, now() - 2)
  db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, provider, currency) VALUES ('lava2', ?, '1m', 0, 'pending', ?, 'lava', 'USD')").run(accountId, now() - 2 * 86_400_000)
  assert.deepEqual(payments.list(accountId).map((item) => [item.provider, item.amount, item.currency]), [['yookassa', 300, 'RUB'], ['lava', 5, 'USD'], ['yookassa', 300, 'RUB']], 'an unpaid Lava invoice stays out')
})

test('autopayments of the removed providers are closed on start', async () => {
  const { db, payments, accountId } = await setup()
  db.exec('CREATE TABLE recurring_subscriptions (id TEXT PRIMARY KEY, account_id TEXT, provider TEXT, plan TEXT, amount INTEGER, currency TEXT, method_id TEXT, status TEXT, next_attempt_at INTEGER, canceled_at INTEGER)')
  db.prepare("INSERT INTO recurring_subscriptions VALUES ('r1', ?, 'yookassa', '1m', 30000, 'RUB', 'pm_1', 'active', NULL, NULL), ('r2', ?, 'lava', '1m', 500, 'USD', NULL, 'canceled', NULL, 5)").run(accountId, accountId)
  new PaymentStore(db, payments.config)
  const rows = db.prepare('SELECT id, status, method_id, canceled_at FROM recurring_subscriptions ORDER BY id').all() as Array<Record<string, unknown>>
  assert.deepEqual(rows.map((row) => [row.id, row.status, row.method_id]), [['r1', 'canceled', null], ['r2', 'canceled', null]])
  assert.equal(rows[1]!.canceled_at, 5, 'an already closed one keeps its date')
})

test('streamer statistics by day, month and year: visits, sign-ups and paid plans', async () => {
  const { accounts, payments, accountId, now, advance } = await setup()
  const streamerId = accounts.authenticate((await accounts.login('streamer@example.com', 'correct horse battery')).token)!
  accounts.recordReferralVisit('HUNTER', '1.1.1.1')
  accounts.recordReferralVisit('HUNTER', '2.2.2.2')
  recordPayment(payments, accountId, '3m', 900, { now: now() })

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
