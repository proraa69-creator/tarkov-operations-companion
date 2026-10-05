/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers read untyped JSON rows */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { DEFAULT_LAVA_OFFER_ID, LavaClient, lavaAuthSeen, lavaWebhookAuth, parseLavaEvent } from './lavaTop.js'
import { LAVA_LOG_RETENTION_MS, LAVA_SELFTEST_PREFIX, PaymentStore } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'

const DAY = 86_400_000
const password = 'correct horse battery'
const consent = { version: '2026-10-01' }
const lavaConfig = { apiKey: 'lava-api-key-123', webhookKey: 'hook-secret-456', offerId: DEFAULT_LAVA_OFFER_ID, currency: 'USD' as const, rubRate: 90 }
const hook = { apiKey: lavaConfig.webhookKey }
const PRICES: Record<string, number> = { MONTHLY: 4.99, PERIOD_90_DAYS: 12.99, PERIOD_180_DAYS: 24.99, PERIOD_YEAR: 39.99 }

/** A fake Lava.top API: invoices with or without an amount. */
function fakeLava() {
  let next = 1
  let withAmount = true
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    const id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
    const total = withAmount ? { amountTotal: { currency: body.currency, amount: PRICES[String(body.periodicity)] } } : {}
    return new Response(JSON.stringify({ id, status: 'in-progress', ...total, paymentUrl: `https://app.lava.top/pay/${id}` }), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, omitAmount: () => { withAmount = false } }
}

async function setup(options: { http?: boolean } = {}) {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  const lavaApi = fakeLava()
  const payments = new PaymentStore(db, undefined, { now, lava: new LavaClient(lavaConfig, { fetch: lavaApi.fetch }) })
  accounts.attachSubscriptions(payments)
  const playerToken = (await accounts.register('player@example.com', password)).token
  const playerId = accounts.authenticate(playerToken)!
  const strangerToken = (await accounts.register('stranger@example.com', password)).token
  const server = options.http ? createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1') : undefined
  if (server) await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = server ? `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` : ''
  const ownerToken = server ? ((await (await fetch(`${base}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password }) })).json()) as { token: string }).token : ''
  const call = async (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json().catch(() => ({})) as Record<string, any> }
  }
  const invoice = async (plan: '1m' | '3m' | '6m' | '12m') => {
    const created = await payments.createLava(accounts.billingInfo(playerId), plan, consent, consent, 'EN')
    return { paymentId: created.paymentId, contractId: created.confirmationUrl.split('/').pop()! }
  }
  const rows = () => db.prepare('SELECT * FROM lava_webhook_log ORDER BY id').all().map((row) => ({ ...row })) as Array<Record<string, any>>
  const close = () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  return { db, accounts, payments, lavaApi, playerId, ownerToken, playerToken, strangerToken, call, invoice, rows, close, advance: (ms: number) => { clock += ms }, now }
}

async function quiet<T>(body: (warnings: string[]) => Promise<T> | T) {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (message: unknown) => { warnings.push(String(message)) }
  try { return await body(warnings) } finally { console.warn = original }
}

test('lava parse fixtures: event names, field spellings and unusable bodies', () => {
  const kind = (eventType: string) => parseLavaEvent({ eventType, contractId: 'c' })!.kind
  assert.equal(kind('payment.success'), 'payment.success')
  assert.equal(kind('PAYMENT_SUCCESS'), 'payment.success')
  assert.equal(kind('payment.failed'), 'payment.failed')
  assert.equal(kind('subscription.recurring.payment.success'), 'recurring.success')
  assert.equal(kind('subscription.recurring.payment.failed'), 'recurring.failed')
  assert.equal(kind('subscription.cancelled'), 'subscription.cancelled')
  assert.equal(kind('refund.created'), 'unknown')
  const flat = parseLavaEvent({ eventType: 'payment.success', contractId: 'abc', amount: 4.99, currency: 'usd', buyer: { email: 'A@B.com' }, status: 'COMPLETED' })!
  assert.deepEqual([flat.contractId, flat.amount, flat.currency, flat.email, flat.status], ['abc', 4.99, 'USD', 'a@b.com', 'COMPLETED'])
  const nested = parseLavaEvent({ event: 'payment.success', contract: { id: 'abc' }, amount: { amount: '12.99', currency: 'EUR' } })!
  assert.deepEqual([nested.contractId, nested.amount, nested.currency], ['abc', 12.99, 'EUR'])
  assert.equal(parseLavaEvent('text'), undefined)
  assert.equal(parseLavaEvent([1]), undefined)
  // A refund-like event without a contract id is understood as an event but carries nothing to apply.
  assert.equal(parseLavaEvent({ eventType: 'payment.refund', amount: 1 })!.contractId, undefined)
})

test('lava auth helpers name the method, never the value', () => {
  assert.equal(lavaWebhookAuth({ apiKey: 'k-12345678' }, 'k-12345678'), 'api-key')
  assert.equal(lavaWebhookAuth({ authorization: `Basic ${Buffer.from('lava:k-12345678').toString('base64')}` }, 'k-12345678'), 'basic')
  assert.equal(lavaWebhookAuth({ apiKey: 'nope' }, 'k-12345678'), undefined)
  assert.equal(lavaAuthSeen({}), 'none')
  assert.equal(lavaAuthSeen({ apiKey: 'x' }), 'api-key')
  assert.equal(lavaAuthSeen({ authorization: 'Basic eA==' }), 'basic')
  assert.equal(lavaAuthSeen({ authorization: 'Bearer x' }), 'none')
})

test('every webhook call leaves a row: one per result, without keys, e-mails or bodies', async () => {
  const { accounts, payments, playerId, invoice, rows, advance } = await setup()
  await quiet(async (warnings) => {
    const good = await invoice('1m')
    const bad = await invoice('3m')
    const cancelled = await invoice('6m')
    const paid = { eventType: 'payment.success', contractId: good.contractId, buyer: { email: 'player@example.com' }, amount: 4.99, currency: 'USD' }
    assert.equal(payments.lavaWebhook({}, paid).result, 'unauthorized')
    assert.equal(payments.lavaWebhook({ authorization: `Basic ${Buffer.from('x:wrong').toString('base64')}` }, paid).result, 'unauthorized')
    assert.equal(payments.lavaWebhook(hook, 'garbage').result, 'bad-request')
    assert.equal(payments.lavaWebhook(hook, { eventType: 'refund.created', amount: 1 }).result, 'ignored')
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: 'foreign-contract-123456' }).result, 'not-ours')
    assert.equal(payments.lavaWebhook(hook, paid).result, 'paid')
    assert.equal(payments.lavaWebhook(hook, paid).result, 'duplicate')
    assert.equal(payments.lavaWebhook(hook, { ...paid, eventId: 'again' }).result, 'already-applied')
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: bad.contractId, amount: 1, currency: 'USD' }).result, 'amount-mismatch')
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.failed', contractId: cancelled.contractId, errorMessage: 'declined' }).result, 'failed')
    advance(1000)

    const log = rows()
    assert.deepEqual(log.map((row) => row.result), ['unauthorized', 'unauthorized', 'bad-request', 'ignored', 'not-ours', 'paid', 'duplicate', 'already-applied', 'amount-mismatch', 'failed'])
    assert.deepEqual(log.map((row) => row.auth_method), ['none', 'basic', 'api-key', 'api-key', 'api-key', 'api-key', 'api-key', 'api-key', 'api-key', 'api-key'])
    const mismatch = log.find((row) => row.result === 'amount-mismatch')!
    assert.deepEqual([mismatch.contract_tail, mismatch.got_amount, mismatch.got_currency, mismatch.expected_amount, mismatch.expected_currency, mismatch.event_type], [bad.contractId.slice(-6), 100, 'USD', 1299, 'USD', 'payment.success'])
    const paidRow = log.find((row) => row.result === 'paid')!
    assert.equal(paidRow.contract_tail, good.contractId.slice(-6))
    assert.equal(paidRow.contract_tail.length, 6)
    // Nothing secret or personal anywhere in the stored rows.
    const dump = JSON.stringify(log)
    for (const secret of [lavaConfig.webhookKey, lavaConfig.apiKey, 'player@example.com', 'wrong', good.contractId, 'declined', 'garbage']) assert.equal(dump.includes(secret), false, `${secret} leaked into the log`)
    // Warnings: unauthorized (2), not-ours (1); the mismatch warns from lavaAgrees; no key in any of them.
    assert.equal(warnings.filter((line) => /webhook unauthorized/.test(line)).length, 2)
    assert.equal(warnings.filter((line) => /webhook not-ours/.test(line)).length, 1)
    assert.ok(warnings.some((line) => /NOT applied/.test(line)))
    assert.equal(warnings.some((line) => line.includes(lavaConfig.webhookKey)), false)
    assert.equal(accounts.view(playerId).subscription.status, 'active')
  })
})

test('a failing handler is logged as error and answers 500 for a retry', async () => {
  const { payments, db, rows, invoice } = await setup()
  await quiet(async (warnings) => {
    const { contractId } = await invoice('1m')
    db.exec('DROP TABLE recurring_subscriptions')
    const outcome = payments.lavaWebhook(hook, { eventType: 'payment.success', contractId, amount: 4.99, currency: 'USD' })
    assert.deepEqual(outcome, { status: 500, result: 'error' })
    assert.equal(rows().at(-1)!.result, 'error')
    assert.equal(warnings.filter((line) => /webhook error/.test(line)).length, 1)
  })
})

test('repeated unauthorized calls collapse per minute; the table cannot be flooded', async () => {
  const { payments, rows, advance } = await setup()
  await quiet(async (warnings) => {
    for (let i = 0; i < 50; i++) payments.lavaWebhook({ apiKey: `guess-${i}` }, {})
    for (let i = 0; i < 5; i++) payments.lavaWebhook({}, {})
    assert.deepEqual(rows().map((row) => [row.auth_method, row.count]), [['api-key', 50], ['none', 5]])
    assert.equal(warnings.length, 2, 'one warning per new row, not per call')
    advance(61_000)
    payments.lavaWebhook({ apiKey: 'late' }, {})
    assert.equal(rows().length, 3, 'a minute later a new row starts')
  })
})

test('log rows older than 90 days are removed', async () => {
  const { payments, rows, advance } = await setup()
  await quiet(() => { payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: 'x-1' }) })
  assert.equal(rows().length, 1)
  advance(LAVA_LOG_RETENTION_MS + DAY)
  await quiet(() => { payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: 'x-2' }) })
  assert.deepEqual(rows().map((row) => row.contract_tail), ['x-2'.slice(-6)])
})

test('self-test calls are logged apart: not in the list, not in the last-call status, no warning', async () => {
  const { payments } = await setup()
  await quiet((warnings) => {
    assert.equal(payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: `${LAVA_SELFTEST_PREFIX}abc123` }).result, 'not-ours')
    assert.equal(payments.lastLavaWebhook(), null)
    assert.deepEqual(payments.lavaWebhookLog(), [])
    assert.equal(warnings.length, 0)
    payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: 'real-contract-000' })
    assert.equal(payments.lastLavaWebhook()!.result, 'not-ours')
  })
})

test('owner routes: login required, 404 for everybody else, owner sees events and pending invoices', async () => {
  const { call, ownerToken, playerToken, strangerToken, payments, invoice, close } = await setup({ http: true })
  try {
    await quiet(async () => {
      const { contractId } = await invoice('3m')
      payments.lavaWebhook({}, {})
      payments.lavaWebhook(hook, { eventType: 'payment.success', contractId, amount: 1, currency: 'USD' })
    })
    assert.equal((await call('GET', '/accounts/me/admin/lava/events')).status, 401)
    for (const token of [playerToken, strangerToken]) {
      assert.equal((await call('GET', '/accounts/me/admin/lava/events', token)).status, 404)
      assert.equal((await call('POST', '/accounts/me/admin/lava/events/1/confirm', token, {})).status, 404)
    }
    const listed = await call('GET', '/accounts/me/admin/lava/events', ownerToken)
    assert.equal(listed.status, 200)
    assert.equal(listed.json.configured, true)
    assert.deepEqual(listed.json.events.map((event: { result: string }) => event.result), ['amount-mismatch', 'unauthorized'])
    assert.equal(listed.json.events[0].confirmable, true)
    assert.equal(listed.json.pending.length, 1)
    assert.deepEqual([listed.json.pending[0].email, listed.json.pending[0].plan], ['player@example.com', '3m'])
    assert.equal(JSON.stringify(listed.json).includes(lavaConfig.webhookKey), false)
  } finally { await close() }
})

test('confirm: grants exactly the stored plan once, records the webhook amount, audited, idempotent', async () => {
  const { call, ownerToken, playerToken, accounts, playerId, payments, db, invoice, close, rows } = await setup({ http: true })
  try {
    // The invoice is for 3 months (12.99 USD); Lava reports 11.50 USD (fees / conversion): nothing is granted.
    const { contractId, paymentId } = await invoice('3m')
    await quiet(() => { payments.lavaWebhook(hook, { eventType: 'payment.success', contractId, amount: 11.5, currency: 'USD', periodicity: 'PERIOD_YEAR' }) })
    assert.equal(accounts.view(playerId).subscription.status, 'inactive')
    const id = rows().find((row) => row.result === 'amount-mismatch')!.id as number

    assert.equal((await call('POST', `/accounts/me/admin/lava/events/${id}/confirm`, playerToken, {})).status, 404)
    assert.equal(accounts.view(playerId).subscription.status, 'inactive', 'a non-owner cannot grant anything')
    assert.equal((await call('POST', '/accounts/me/admin/lava/events/999999/confirm', ownerToken, {})).status, 404)
    assert.equal((await call('POST', '/accounts/me/admin/lava/events/abc/confirm', ownerToken, {})).status, 400)

    const done = await call('POST', `/accounts/me/admin/lava/events/${id}/confirm`, ownerToken, {})
    assert.equal(done.status, 200, JSON.stringify(done.json))
    assert.equal(done.json.already, false)
    assert.equal(accounts.view(playerId).subscription.status, 'active')
    const until = Date.parse(accounts.view(playerId).subscription.paidUntil!)
    assert.ok(until > 0)
    const payment = db.prepare('SELECT status, plan, amount_original, currency, amount FROM payments WHERE id = ?').get(paymentId)!
    assert.deepEqual({ ...payment }, { status: 'succeeded', plan: '3m', amount_original: 1150, currency: 'USD', amount: 103500 }, 'the stored plan, the webhook amount in roubles at the owner rate')
    assert.equal(done.json.events.find((event: { id: number }) => event.id === id).confirmable, false)
    assert.equal(done.json.pending.length, 0)
    const recurring = db.prepare("SELECT plan, amount, status, contract_id FROM recurring_subscriptions WHERE account_id = ?").get(playerId)!
    assert.deepEqual({ ...recurring }, { plan: '3m', amount: 1150, status: 'active', contract_id: contractId })

    const again = await call('POST', `/accounts/me/admin/lava/events/${id}/confirm`, ownerToken, {})
    assert.equal(again.status, 200)
    assert.equal(again.json.already, true)
    assert.equal(Date.parse(accounts.view(playerId).subscription.paidUntil!), until, 'the second confirmation grants nothing')
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'succeeded'").get()!.n), 1)

    const audit = await call('GET', '/accounts/me/admin/audit', ownerToken)
    const entries = audit.json.entries.filter((entry: { action: string }) => entry.action === 'payment.lava-confirm')
    assert.equal(entries.length, 1, 'audited once')
    assert.deepEqual([entries[0].actor, entries[0].target, entries[0].details.plan, entries[0].details.amount, entries[0].details.currency], ['owner@example.com', 'player@example.com', '3m', 11.5, 'USD'])
  } finally { await close() }
})

test('confirm refuses rows that are not confirmable mismatches', async () => {
  const { call, ownerToken, payments, invoice, close, rows, lavaApi, accounts, playerId } = await setup({ http: true })
  try {
    await quiet(async () => {
      const ok = await invoice('1m')
      // A mismatch whose webhook reported no amount cannot be confirmed (nothing to record).
      lavaApi.omitAmount()
      const unknown = await invoice('12m')
      payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: ok.contractId, amount: 4.99, currency: 'USD' })
      payments.lavaWebhook({}, {})
      payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: 'nobody-123456' })
      payments.lavaWebhook(hook, { eventType: 'payment.success', contractId: unknown.contractId })
    })
    for (const result of ['paid', 'unauthorized', 'not-ours']) {
      const row = rows().find((item) => item.result === result)!
      assert.equal((await call('POST', `/accounts/me/admin/lava/events/${row.id}/confirm`, ownerToken, {})).status, 404, result)
    }
    const mismatch = rows().find((item) => item.result === 'amount-mismatch')!
    const refused = await call('POST', `/accounts/me/admin/lava/events/${mismatch.id}/confirm`, ownerToken, {})
    assert.equal(refused.status, 409)
    // The one-month payment from the matching webhook is the only grant.
    assert.equal(Number(accounts.database.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'succeeded'").get()!.n), 1)
    assert.equal(accounts.view(playerId).subscription.status, 'active')
  } finally { await close() }
})

test('confirm does nothing when the payment was applied meanwhile', async () => {
  const { call, ownerToken, payments, invoice, close, rows, db, accounts, playerId } = await setup({ http: true })
  try {
    const { contractId, paymentId } = await invoice('1m')
    await quiet(() => { payments.lavaWebhook(hook, { eventType: 'payment.success', contractId, amount: 1, currency: 'USD' }) })
    const id = rows()[0]!.id as number
    // The owner grants through another way first (the payment gets applied, e.g. by a correct retry).
    db.prepare("UPDATE payments SET status = 'succeeded' WHERE id = ?").run(paymentId)
    const done = await call('POST', `/accounts/me/admin/lava/events/${id}/confirm`, ownerToken, {})
    assert.equal(done.status, 200)
    assert.equal(done.json.already, true)
    assert.equal(accounts.view(playerId).subscription.status, 'inactive', 'no second grant')
  } finally { await close() }
})

test('owner dashboard status for the desktop app: last real call', async () => {
  const { payments } = await setup()
  assert.equal(payments.lastLavaWebhook(), null)
  await quiet(() => { payments.lavaWebhook({ apiKey: 'x' }, {}) })
  assert.equal(payments.lastLavaWebhook()!.result, 'unauthorized')
})
