import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { PaymentStore, type PaymentConfig } from './paymentStore.js'
import { maskPhone, normalizePhone, PayoutStore } from './payoutStore.js'
import { ProgressStore } from './progressStore.js'

const password = 'correct horse battery'
const DAY = 86_400_000
const details = { phone: '8 (999) 123-45-67', bank: 'Т-Банк', recipient: 'Иван Петров' }

/** Fake ЮKassa that accepts every payment at once. */
function fakeYooKassa() {
  const payments = new Map<string, Record<string, unknown>>()
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      const payment = { id, status: 'succeeded', paid: true, amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } }
      payments.set(id, payment)
      return new Response(JSON.stringify({ ...payment, status: 'pending', paid: false }), { status: 200 })
    }
    return new Response(JSON.stringify(payments.get(url.split('/').pop()!)), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return fetch
}

async function setup(percent = 10) {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const fetch = fakeYooKassa()
  const config: PaymentConfig = { shopId: '1', secretKey: 'test_x', monthPrice: 1000, receipts: false, streamerPercent: percent }
  const payments = new PaymentStore(db, config, { now, fetch })
  accounts.attachSubscriptions(payments)
  const payouts = new PayoutStore(db, payments, { now })
  await accounts.register('streamer@example.com', password)
  accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  const streamerId = accounts.authenticate((await accounts.login('streamer@example.com', password)).token)!
  const { token } = await accounts.register('viewer@example.com', password, 'HUNTER')
  const viewerId = accounts.authenticate(token)!
  /** The viewer pays for `plan`; the streamer earns his share of it. */
  const pay = async (plan: '1m' | '3m' | '6m' | '12m', store = payments) => {
    const created = await store.create(accounts.billingInfo(viewerId), plan, 'https://tarkov.example.com', { version: '2026-09-30' })
    await store.sync(new URL(created.confirmationUrl).searchParams.get('orderId')!)
  }
  return { db, accounts, payments, payouts, streamerId, viewerId, pay, fetch, now, advance: (ms: number) => { clock += ms } }
}

test('phone numbers are normalized and masked; card numbers are refused', () => {
  assert.equal(normalizePhone('8 (999) 123-45-67'), '+79991234567')
  assert.equal(normalizePhone('+7 999 1234567'), '+79991234567')
  assert.equal(normalizePhone('9991234567'), '+79991234567')
  assert.equal(normalizePhone('4276 1234 5678 9012'), undefined)
  assert.equal(maskPhone('+79991234567'), '+7 ••• •••-45-67')
})

test('the streamer share is fixed per payment: a later percent change never rewrites history', async () => {
  const { db, accounts, payments, payouts, pay, now, fetch } = await setup(10)
  await pay('1m') // 1000 ₽ → 100 ₽ at 10 %
  assert.equal(payouts.balance('HUNTER').earned, 100_00)
  // The owner raises the share to 20 %: the next payment earns 20 %, the old one stays at 10 %.
  const raised = new PaymentStore(db, { ...payments.config!, streamerPercent: 20 }, { now, fetch })
  const ledger = new PayoutStore(db, raised, { now })
  await pay('1m', raised)
  assert.equal(ledger.balance('HUNTER').earned, 100_00 + 200_00)
  assert.equal(accounts.view(accounts.authenticate((await accounts.login('streamer@example.com', password)).token)!).stats?.earnings.amount, 300)
})

test('balance = earned − paid − pending; requests are bounded and never make it negative; one open request at a time', async () => {
  const { payouts, streamerId, pay } = await setup(10)
  await pay('12m') // 12 000 × 0.67 = 8040 ₽ → 804 ₽
  assert.equal(payouts.balance('HUNTER').available, 804_00)

  assert.throws(() => payouts.request(streamerId, 'HUNTER', 200), /реквизиты/)
  payouts.saveSettings(streamerId, { ...details, auto: false })
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 99.99), /Минимальная выплата/)
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 804.01), /Доступно к выплате только 804/)
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 100.001), /двух знаков/)

  const first = payouts.request(streamerId, 'HUNTER', 500)
  assert.equal(first.status, 'pending')
  assert.equal(first.destination, '+7 ••• •••-45-67 · Т-Банк')
  assert.deepEqual(payouts.balance('HUNTER'), { earned: 804_00, paid: 0, pending: 500_00, available: 304_00 })
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 100), /ещё ждёт выплаты/)

  payouts.decide(first.id, 'paid', 'СБП, чек 123')
  assert.throws(() => payouts.decide(first.id, 'rejected'), /уже обработана/)
  assert.deepEqual(payouts.balance('HUNTER'), { earned: 804_00, paid: 500_00, pending: 0, available: 304_00 })

  const second = payouts.request(streamerId, 'HUNTER', 304)
  assert.equal(payouts.balance('HUNTER').available, 0)
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 100), /ещё ждёт выплаты/)
  payouts.decide(second.id, 'rejected', 'неверный номер')
  assert.equal(payouts.balance('HUNTER').available, 304_00, 'a rejected request returns to the balance')

  const overview = payouts.overview(streamerId, 'HUNTER')
  assert.equal(overview.percent, 10)
  assert.deepEqual([overview.earned, overview.paidOut, overview.pending, overview.available, overview.minimum], [804, 500, 0, 304, 100])
  assert.deepEqual(overview.details, { phone: '+7 ••• •••-45-67', bank: 'Т-Банк', recipient: 'Иван Петров' })
  assert.deepEqual(overview.payouts.map((item) => [item.amount, item.status]), [[304, 'rejected'], [500, 'paid']])
})

test('auto-payout requests the whole balance every N days (3 by default); the streamer picks N within the owner limits', async () => {
  const { accounts, payouts, streamerId, pay, advance } = await setup(10)
  const codeOf = (id: string) => accounts.streamerCode(id)
  payouts.saveSettings(streamerId, details) // auto is on by default, every 3 days
  let overview = payouts.overview(streamerId, 'HUNTER')
  assert.equal(overview.autoPayout.enabled, true)
  assert.equal(overview.autoPayout.intervalDays, 3)
  assert.equal(overview.autoPayout.nextAt, '2026-10-04T10:00:00.000Z')

  await pay('3m') // 3000 ₽ → 300 ₽
  advance(2 * DAY)
  assert.deepEqual(payouts.runAuto(codeOf), [], 'not yet: the cycle is 3 days')
  advance(DAY)
  const created = payouts.runAuto(codeOf)
  assert.equal(created.length, 1)
  assert.equal(created[0]!.amount, 300)
  assert.equal(created[0]!.auto, true)
  assert.deepEqual(payouts.runAuto(codeOf), [], 'the next cycle starts now')

  // Nothing pending is duplicated: while the request waits, the next cycle creates nothing.
  await pay('1m')
  advance(3 * DAY)
  assert.deepEqual(payouts.runAuto(codeOf), [])
  payouts.decide(created[0]!.id, 'paid')
  advance(3 * DAY)
  assert.deepEqual(payouts.runAuto(codeOf).map((item) => item.amount), [100])

  // The streamer chooses 7 days; the owner narrows the limits to 5–14.
  assert.throws(() => payouts.saveSettings(streamerId, { intervalDays: 31 }), /1–30/)
  payouts.saveSettings(streamerId, { intervalDays: 7 })
  overview = payouts.overview(streamerId, 'HUNTER')
  assert.equal(overview.autoPayout.intervalDays, 7)
  assert.equal(overview.details?.phone, '+7 ••• •••-45-67', 'details are kept when only the interval changes')
  assert.deepEqual(payouts.setIntervalLimits(5, 14), { min: 5, max: 14 })
  assert.throws(() => payouts.saveSettings(streamerId, { intervalDays: 3 }), /5–14/)
  assert.throws(() => payouts.setIntervalLimits(10, 2), /минимум/)
  payouts.setIntervalLimits(10, 14)
  assert.equal(payouts.overview(streamerId, 'HUNTER').autoPayout.intervalDays, 10, 'moved into the new limits')

  // Auto-payout off: nothing is requested.
  payouts.saveSettings(streamerId, { auto: false })
  await pay('1m')
  advance(30 * DAY)
  assert.deepEqual(payouts.runAuto(codeOf), [])
})

test('payout routes: streamer only for his own, owner only for the list; streamers never pay for a subscription', async () => {
  const { accounts, payments, payouts, pay } = await setup(10)
  await pay('1m')
  const db = payments.database
  // Owner e-mail listed after it was registered.
  await accounts.register('owner@example.com', password)
  const ownerAccounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  ownerAccounts.attachSubscriptions(payments)
  const server = createApi(new ProgressStore(':memory:'), undefined, ownerAccounts, { payments, payouts }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  const streamer = (await ownerAccounts.login('streamer@example.com', password)).token
  const viewer = (await ownerAccounts.login('viewer@example.com', password)).token
  const owner = (await ownerAccounts.login('owner@example.com', password)).token
  try {
    assert.equal((await call('GET', '/v1/accounts/me/payouts')).status, 401)
    assert.equal((await call('GET', '/v1/accounts/me/payouts', viewer)).status, 403)
    const overview = await call('GET', '/v1/accounts/me/payouts', streamer)
    assert.equal(overview.status, 200)
    assert.equal(overview.body.percent, 10)
    assert.equal(overview.body.available, 100)
    assert.equal(overview.body.details, null)
    assert.equal((await call('PUT', '/v1/accounts/me/payout-settings', streamer, { phone: '4276123456789012', bank: 'Сбер', recipient: 'Иван Петров' })).status, 400)
    const saved = await call('PUT', '/v1/accounts/me/payout-settings', streamer, { ...details, auto: true, intervalDays: 7 })
    assert.equal(saved.status, 200)
    assert.equal(JSON.stringify(saved.body).includes('1234567'), false, 'the streamer sees his phone masked')
    const requested = await call('POST', '/v1/accounts/me/payouts', streamer, { amount: 100 })
    assert.equal(requested.status, 201)
    assert.equal((await call('POST', '/v1/accounts/me/payouts', streamer, { amount: 100 })).status, 409)

    assert.equal((await call('GET', '/v1/accounts/me/admin/payouts', streamer)).status, 404)
    const list = await call('GET', '/v1/accounts/me/admin/payouts', owner)
    assert.equal(list.status, 200)
    const [item] = list.body.payouts as Array<{ id: string; phone: string; email: string; code: string }>
    assert.deepEqual([item!.phone, item!.email, item!.code], ['+79991234567', 'streamer@example.com', 'HUNTER'])
    assert.equal((await call('POST', '/v1/accounts/me/admin/payouts/decide', streamer, { id: item!.id, status: 'paid' })).status, 404)
    assert.equal((await call('POST', '/v1/accounts/me/admin/payouts/decide', owner, { id: item!.id, status: 'paid', comment: 'СБП' })).status, 200)
    assert.equal((await call('PUT', '/v1/accounts/me/admin/payout-limits', owner, { min: 2, max: 20 })).status, 200)
    assert.equal((await call('PUT', '/v1/accounts/me/admin/payout-limits', viewer, { min: 2, max: 20 })).status, 404)

    // Streamers use the service for free: no payment can be started.
    const refused = await call('POST', '/v1/payments', streamer, { plan: '1m', consent: { version: '2026-09-30' } })
    assert.equal(refused.status, 409)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
