import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { PaymentStore } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'

/**
 * What is left of Lava.top, the removed «Другие страны» provider (owner, 13.10.2026: «удали с сервера всю инфу о лава
 * топ»): the clean-up of an older database on start, and the paid history it keeps, read as 'archive' everywhere.
 */

const password = 'correct horse battery'
const DAY = 24 * 60 * 60 * 1000
const PAID = Date.parse('2026-10-02T11:00:00.000Z')
/** «Today» in these tests: the day after the archived payment. */
const now = () => Date.parse('2026-10-03T10:00:00.000Z')

/** The provider's own tables as the previous server created them, one row each. */
function oldProviderTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE lava_events (key TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
    CREATE TABLE lava_mismatches (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, payment_id TEXT, recurring_id TEXT, contract_id TEXT,
      expected_amount INTEGER, expected_currency TEXT, got_amount INTEGER, got_currency TEXT, received_at INTEGER NOT NULL);
    CREATE TABLE lava_webhook_log (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, last_at INTEGER NOT NULL, result TEXT NOT NULL,
      event_type TEXT, contract_tail TEXT, got_amount INTEGER, got_currency TEXT, expected_amount INTEGER, expected_currency TEXT, auth_method TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1, payment_id TEXT, selftest INTEGER NOT NULL DEFAULT 0, confirmed_at INTEGER);
    CREATE INDEX lava_webhook_log_at ON lava_webhook_log(received_at);
    INSERT INTO lava_events (key, received_at) VALUES ('payment.success|e1|c1||', 1);
    INSERT INTO lava_mismatches (event_type, received_at) VALUES ('payment.success', 1);
    INSERT INTO lava_webhook_log (received_at, last_at, result, auth_method) VALUES (1, 1, 'paid', 'api-key');
  `)
}

interface PaymentRow { id: string; account: string; status: string; provider: string | null; plan?: string; amount?: number; currency?: string; original?: number; paidAt?: number; referral?: string; earning?: number; contract?: string }
function insertPayment(db: DatabaseSync, row: PaymentRow) {
  db.prepare('INSERT INTO payments (id, account_id, provider_id, plan, amount, status, referral_code, created_at, paid_at, provider, currency, amount_original, streamer_percent, streamer_earning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.account, row.contract ?? null, row.plan ?? '1m', row.amount ?? 0, row.status, row.referral ?? null, row.paidAt ?? PAID, row.paidAt ?? null, row.provider, row.currency ?? null, row.original ?? null, row.earning === undefined ? null : 10, row.earning ?? null)
}

interface RecurringRow { id: string; account: string; status: string; provider: string; contract?: string; amount?: number; currency?: string }
function insertRecurring(db: DatabaseSync, row: RecurringRow) {
  db.prepare("INSERT INTO recurring_subscriptions (id, account_id, provider, plan, amount, currency, contract_id, status, consent_version, consent_at, created_at) VALUES (?, ?, ?, '3m', ?, ?, ?, ?, '2026-10-01', ?, ?)")
    .run(row.id, row.account, row.provider, row.amount ?? 1000, row.currency ?? 'USD', row.contract ?? null, row.status, PAID, PAID)
}

const ids = (db: DatabaseSync, table: 'payments' | 'recurring_subscriptions') => (db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id)

test('start-up clean-up: the old provider\'s logs, unpaid invoices and inactive autopayments go; its paid history stays; once only', async () => {
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [] })
  new PaymentStore(db, undefined)
  const a = accounts.authenticate((await accounts.register('a@example.com', password)).token)!
  const b = accounts.authenticate((await accounts.register('b@example.com', password)).token)!
  oldProviderTables(db)
  insertPayment(db, { id: 'old-pending', account: a, status: 'pending', provider: 'lava', currency: 'USD', original: 1000, contract: 'c-pending' })
  insertPayment(db, { id: 'old-canceled', account: a, status: 'canceled', provider: 'lava', currency: 'USD', contract: 'c-canceled' })
  insertPayment(db, { id: 'old-paid', account: a, status: 'succeeded', provider: 'lava', amount: 90000, currency: 'USD', original: 1000, paidAt: PAID, contract: 'c-paid' })
  insertPayment(db, { id: 'old-refunded', account: b, status: 'refunded', provider: 'lava', amount: 90000, currency: 'USD', original: 1000, paidAt: PAID, contract: 'c-refunded' })
  insertPayment(db, { id: 'yoo-pending', account: b, status: 'pending', provider: 'yookassa', currency: 'RUB', amount: 30000 })
  insertPayment(db, { id: 'yoo-canceled', account: b, status: 'canceled', provider: null, amount: 30000 })
  insertRecurring(db, { id: 'old-active', account: a, status: 'active', provider: 'lava', contract: 'c-paid' })
  insertRecurring(db, { id: 'old-canceled', account: b, status: 'canceled', provider: 'lava', contract: 'c-refunded' })
  insertRecurring(db, { id: 'yoo-canceled', account: b, status: 'canceled', provider: 'yookassa', currency: 'RUB', amount: 81000 })

  const lines: string[] = []
  new PaymentStore(db, undefined, { log: (line) => lines.push(line) })
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'lava%'").all(), [], 'tables and their index are gone')
  assert.deepEqual(ids(db, 'payments'), ['old-paid', 'old-refunded', 'yoo-canceled', 'yoo-pending'], 'paid and refunded stay; ЮKassa rows untouched')
  assert.deepEqual(ids(db, 'recurring_subscriptions'), ['old-active', 'yoo-canceled'])
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /3 tables dropped, 2 unpaid invoices and 1 inactive autopayments deleted; 2 payments and 1 active autopayments kept as archive/)
  assert.doesNotMatch(lines[0]!, /@|old-|c-paid|lava/i, 'counts only: no e-mails, ids or the provider\'s name')

  // The next start finds nothing to do and says nothing.
  new PaymentStore(db, undefined, { log: (line) => lines.push(line) })
  assert.equal(lines.length, 1)
  assert.deepEqual(ids(db, 'payments'), ['old-paid', 'old-refunded', 'yoo-canceled', 'yoo-pending'])
})

/** The owner, a streamer and a referred player with an archived paid payment, an active archived autopayment and a ЮKassa payment. */
async function archived() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  let external = 0
  // ЮKassa is configured, but no archived row may ever reach out to anybody.
  const fetch = (async () => { external += 1; throw new Error('no network in this test') }) as unknown as typeof globalThis.fetch
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_secret', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch })
  accounts.attachSubscriptions(payments)
  await accounts.register('streamer@example.com', password)
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const player = accounts.authenticate((await accounts.register('player@example.com', password, 'HUNTER')).token)!
  insertPayment(db, { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', account: player, status: 'succeeded', provider: 'lava', plan: '3m', amount: 90000, currency: 'USD', original: 1000, paidAt: PAID, referral: 'HUNTER', earning: 9000, contract: 'contract-1' })
  insertPayment(db, { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', account: player, status: 'succeeded', provider: 'yookassa', plan: '1m', amount: 30000, currency: 'RUB', original: 30000, paidAt: PAID + 60_000, referral: 'HUNTER', earning: 3000, contract: '2d0000000001-000f-5000-9000-1b68e7b15f3f' })
  insertRecurring(db, { id: 'old-active', account: player, status: 'active', provider: 'lava', contract: 'contract-1' })
  db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?)').run(player, PAID + 120 * DAY)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await globalThis.fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown = text
    try { json = JSON.parse(text) } catch { /* CSV, HTML */ }
    return { status: response.status, json: json as T, text }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/v1/accounts/login', undefined, { email, password })).json.token
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { db, payments, player, call, login, close, external: () => external }
}

test('an archived payment and autopayment read in the cabinet without any call outside; only the owner can close the autopayment', async () => {
  const t = await archived()
  try {
    assert.deepEqual(t.payments.list(t.player).map((item) => [item.provider, item.amount, item.currency, item.status]), [['yookassa', 300, 'RUB', 'succeeded'], ['archive', 10, 'USD', 'succeeded']])
    const autopay = t.payments.autopay(t.player)!
    assert.deepEqual([autopay.provider, autopay.status, autopay.amount, autopay.currency, autopay.nextChargeAt], ['archive', 'active', 10, 'USD', undefined])
    assert.equal((await t.payments.status(t.player, 'aaaaaaaaaaaaaaaaaaaaaaaa')).provider, 'archive')
    // The streamer's statistics count it by the rouble amount stored when it was paid.
    assert.deepEqual(t.payments.referralStats('HUNTER'), { activeSubscriptions: 1, revenue: 120000, earnings: 12000 })

    const player = await t.login('player@example.com')
    const cabinet = await t.call<{ payments: Array<{ provider: string }>; autopay: { provider: string } }>('GET', '/v1/payments', player)
    assert.deepEqual([cabinet.json.payments.map((item) => item.provider), cabinet.json.autopay.provider], [['yookassa', 'archive'], 'archive'])
    assert.doesNotMatch(cabinet.text, /lava/i)
    // The user cannot stop it here (the old service is not connected any more): support does, nothing changes.
    const refused = await t.call<{ error: string }>('POST', '/v1/payments/autopay/cancel', player, {})
    assert.equal(refused.status, 409)
    assert.match(refused.json.error, /поддержку/)
    assert.equal(t.payments.autopay(t.player)?.status, 'active')

    const owner = await t.login('owner@example.com')
    const closed = await t.call<{ user: { autopay: { provider: string; status: string } } }>('POST', `/v1/accounts/me/admin/users/${t.player}/cancel-autopay`, owner, {})
    assert.equal(closed.status, 200)
    assert.deepEqual(closed.json.user.autopay, { provider: 'archive', status: 'canceled', plan: '3m' })
    assert.equal(t.payments.autopay(t.player)?.status, 'canceled')
    assert.equal(t.external(), 0, 'nothing was sent anywhere')
  } finally { await t.close() }
})

test('the admin panel counts archived payments by their rouble amount and labels them «Архив»', async () => {
  const t = await archived()
  try {
    const owner = await t.login('owner@example.com')
    const overview = await t.call<{ revenue: { all: Record<string, number> } }>('GET', '/v1/accounts/me/admin/overview', owner)
    assert.deepEqual(overview.json.revenue.all, { total: 1200, payments: 2 })
    assert.doesNotMatch(overview.text, /lava/i)
    const series = await t.call<{ rows: Array<Record<string, unknown>> }>('GET', '/v1/accounts/me/admin/series?period=day', owner)
    const day = series.json.rows.find((row) => row.period === '2026-10-02')!
    assert.deepEqual([day.payments, day.revenue, (day.plans as Record<string, unknown>)['3m']], [2, 1200, { count: 1, revenue: 900 }])
    const calendar = await t.call<{ days: Array<{ date: string; revenue: number }> }>('GET', '/v1/accounts/me/admin/calendar?month=2026-10', owner)
    assert.equal(calendar.json.days.find((item) => item.date === '2026-10-02')?.revenue, 1200)
    const opened = await t.call<{ totals: Record<string, unknown>; payments: Array<{ provider: string; amount: number; original?: unknown }> }>('GET', '/v1/accounts/me/admin/day?date=2026-10-02', owner)
    assert.deepEqual([opened.json.totals.revenue, opened.json.totals.streamerEarnings], [1200, 120])
    assert.deepEqual(opened.json.payments.map((item) => [item.provider, item.amount, item.original]), [['archive', 900, { amount: 10, currency: 'USD' }], ['yookassa', 300, undefined]])

    const list = await t.call<{ payments: Array<{ provider: string }>; totals: Record<string, number> }>('GET', '/v1/accounts/me/admin/payments', owner)
    const plans = { '1m': { count: 1, revenue: 300 }, '3m': { count: 1, revenue: 900 }, '6m': { count: 0, revenue: 0 }, '12m': { count: 0, revenue: 0 } }
    assert.deepEqual(list.json.totals, { succeeded: 2, revenue: 1200, net: 1200, streamerEarnings: 120, plans })
    assert.deepEqual(list.json.payments.map((item) => item.provider), ['yookassa', 'archive'])
    const csv = await t.call('GET', '/v1/accounts/me/admin/payments.csv', owner)
    assert.ok(csv.text.includes(';player@example.com;3m;Архив;Оплачен;900,00;10,00;USD;;HUNTER;90,00;aaaaaaaaaaaaaaaaaaaaaaaa'), csv.text)
    assert.ok(csv.text.includes(';player@example.com;1m;ЮKassa;Оплачен;300,00;;;;HUNTER;30,00;bbbbbbbbbbbbbbbbbbbbbbbb'), csv.text)
    const users = await t.call<{ users: Array<{ email: string; autopay: { provider: string } | null; payments: { count: number; total: number } }> }>('GET', '/v1/accounts/me/admin/users', owner)
    const player = users.json.users.find((user) => user.email === 'player@example.com')!
    assert.deepEqual([player.autopay?.provider, player.payments], ['archive', { count: 2, total: 1200 }])
    assert.equal(t.external(), 0)
  } finally { await t.close() }
})

test('the provider\'s routes and settings are gone', async () => {
  const t = await archived()
  try {
    const owner = await t.login('owner@example.com')
    assert.equal((await t.call('POST', '/v1/payments/lava/webhook', undefined, { eventType: 'payment.success', contractId: 'contract-1' })).status, 404)
    assert.equal((await t.call('GET', '/v1/payments/lava/webhook')).status, 404)
    for (const path of ['/v1/accounts/me/admin/lava/events', '/v1/accounts/me/admin/payment-settings/lava']) assert.equal((await t.call('GET', path, owner)).status, 404, path)
    assert.equal((await t.call('POST', '/v1/accounts/me/admin/lava/events/1/confirm', owner, {})).status, 404)
    const plans = await t.call<Record<string, unknown>>('GET', '/v1/payments/plans')
    assert.deepEqual(Object.keys(plans.json), ['enabled', 'plans', 'providers'])
    assert.deepEqual(Object.keys(plans.json.providers as object), ['yookassa', 'autopay', 'methods'])
    const sales = await t.call('GET', '/v1/accounts/me/admin/sales-settings', owner)
    assert.equal(sales.status, 200)
    assert.doesNotMatch(sales.text, /lava|USD|EUR/i)
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM payments WHERE provider = 'lava'").get()!.n, 1, 'the paid history stays')
  } finally { await t.close() }
})
