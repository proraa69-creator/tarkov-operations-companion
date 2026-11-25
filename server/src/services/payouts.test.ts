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

test('balance = matured − paid − pending; only earnings older than 14 days are available; requests bounded; one open at a time', async () => {
  const { payouts, streamerId, pay, advance } = await setup(10)
  await pay('12m') // 12 000 ₽ at the monthly rate; yearly price is 8000 ₽ → 800 ₽
  // Earned at once, but available only 14 days later (in case of a refund) — src/shared/revenue.ts PAYOUT_MATURITY_DAYS.
  assert.deepEqual(payouts.balance('HUNTER'), { earned: 800_00, matured: 0, maturing: 800_00, paid: 0, pending: 0, available: 0 })

  assert.throws(() => payouts.request(streamerId, 'HUNTER', 200), /реквизиты/)
  payouts.saveSettings(streamerId, { ...details, auto: false })
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 200), /Доступно к выплате только 0/)
  advance(14 * DAY)
  assert.equal(payouts.balance('HUNTER').available, 800_00, 'matured after 14 days')
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 99.99), /Минимальная выплата/)
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 800.01), /Доступно к выплате только 800/)
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 100.001), /двух знаков/)

  const first = payouts.request(streamerId, 'HUNTER', 500)
  assert.equal(first.status, 'pending')
  assert.equal(first.destination, '+7 ••• •••-45-67 · Т-Банк')
  assert.deepEqual(payouts.balance('HUNTER'), { earned: 800_00, matured: 800_00, maturing: 0, paid: 0, pending: 500_00, available: 300_00 })
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 100), /ещё ждёт выплаты/)

  payouts.decide(first.id, 'paid', 'СБП, чек 123')
  assert.throws(() => payouts.decide(first.id, 'rejected'), /уже обработана/)
  assert.deepEqual(payouts.balance('HUNTER'), { earned: 800_00, matured: 800_00, maturing: 0, paid: 500_00, pending: 0, available: 300_00 })

  const second = payouts.request(streamerId, 'HUNTER', 300)
  assert.equal(payouts.balance('HUNTER').available, 0)
  assert.throws(() => payouts.request(streamerId, 'HUNTER', 100), /ещё ждёт выплаты/)
  payouts.decide(second.id, 'rejected', 'неверный номер')
  assert.equal(payouts.balance('HUNTER').available, 300_00, 'a rejected request returns to the balance')

  const overview = payouts.overview(streamerId, 'HUNTER')
  assert.equal(overview.percent, 10)
  assert.deepEqual([overview.earned, overview.paidOut, overview.pending, overview.available, overview.minimum], [800, 500, 0, 300, 100])
  assert.equal(overview.maturityDays, 14)
  assert.deepEqual(overview.details, { phone: '+7 ••• •••-45-67', bank: 'Т-Банк', recipient: 'Иван Петров' })
  assert.deepEqual(overview.payouts.map((item) => [item.amount, item.status]), [[300, 'rejected'], [500, 'paid']])
})

test('14-day rule and streamer notices: matured balance, a new payment and a paid payout become new-events; pendingCount', async () => {
  const { accounts, payouts, streamerId, pay, advance } = await setup(10)
  await pay('1m') // 100 ₽ earned
  let b = payouts.balance('HUNTER')
  assert.deepEqual([b.earned, b.matured, b.maturing, b.available], [100_00, 0, 100_00, 0], 'earned but not matured yet')
  const ov = payouts.overview(streamerId, 'HUNTER')
  assert.equal(ov.maturityDays, 14)
  assert.equal(ov.maturing, 100)
  advance(14 * DAY)
  b = payouts.balance('HUNTER')
  assert.deepEqual([b.matured, b.maturing, b.available], [100_00, 0, 100_00], 'available after 14 days')

  // The matured payment is a «new payment» event; opening the panel clears the red count.
  let notices = payouts.notices(streamerId, 'HUNTER')
  assert.equal(notices.unread, 1)
  assert.equal(notices.items[0]!.type, 'payment')
  payouts.markNoticesSeen(streamerId)
  assert.equal(payouts.notices(streamerId, 'HUNTER').unread, 0)

  // The owner pays a request → «выплата проведена» becomes a new unread event; pendingCount drops to 0.
  payouts.saveSettings(streamerId, { ...details, auto: false })
  const req = payouts.request(streamerId, 'HUNTER', 100)
  assert.equal(payouts.pendingCount(), 1)
  advance(DAY)
  payouts.decide(req.id, 'paid')
  assert.equal(payouts.pendingCount(), 0)
  notices = payouts.notices(streamerId, 'HUNTER')
  assert.equal(notices.unread, 1)
  assert.equal(notices.items[0]!.type, 'payout')
  assert.equal(notices.items[0]!.amount, 100)
  assert.ok(accounts.streamerCode(streamerId) === 'HUNTER')
})

test('auto-payout requests the whole balance every N days (3 by default); the streamer picks N within the owner limits', async () => {
  const { accounts, payouts, streamerId, pay, advance } = await setup(10)
  const codeOf = (id: string) => accounts.streamerCode(id)
  payouts.saveSettings(streamerId, details) // auto is on by default, every 3 days
  let overview = payouts.overview(streamerId, 'HUNTER')
  assert.equal(overview.autoPayout.enabled, true)
  assert.equal(overview.autoPayout.intervalDays, 3)
  assert.equal(overview.autoPayout.nextAt, '2026-10-04T10:00:00.000Z')

  await pay('3m') // 2666.67 ₽ (3 months −1/9) → 266.66 ₽, matures in 14 days
  advance(3 * DAY)
  assert.deepEqual(payouts.runAuto(codeOf), [], 'the cycle is up, but nothing has matured yet (14-day rule)')
  advance(14 * DAY)
  const created = payouts.runAuto(codeOf)
  assert.equal(created.length, 1)
  assert.equal(created[0]!.amount, 266.66)
  assert.equal(created[0]!.auto, true)
  assert.deepEqual(payouts.runAuto(codeOf), [], 'the next cycle starts now')

  // Nothing pending is duplicated: while the request waits, the next cycle creates nothing.
  await pay('1m')
  advance(3 * DAY)
  assert.deepEqual(payouts.runAuto(codeOf), [])
  payouts.decide(created[0]!.id, 'paid')
  advance(14 * DAY)
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
  const { accounts, payments, payouts, pay, advance } = await setup(10)
  await pay('1m')
  advance(14 * DAY) // the earning matures so it is available to withdraw
  const db = payments.database
  // Owner e-mail listed after it was registered.
  await accounts.register('owner@example.com', password)
  accounts.markEmailVerified(accounts.accountByEmail('owner@example.com')!.id) // owner rights need a confirmed e-mail
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

    // Streamer new-events: the matured payment is a «new payment»; viewers see it, others get 403.
    assert.equal((await call('GET', '/v1/accounts/me/streamer-notifications', viewer)).status, 403)
    const notices = await call('GET', '/v1/accounts/me/streamer-notifications', streamer)
    assert.equal(notices.status, 200)
    assert.equal((notices.body as { unread: number }).unread, 1)
    assert.equal(((await call('POST', '/v1/accounts/me/streamer-notifications/read', streamer)).body as { unread: number }).unread, 0)
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
    // «Стримеры» red count: one request waits for the owner; others cannot read it.
    assert.equal((await call('GET', '/v1/accounts/me/admin/payouts/attention', viewer)).status, 404)
    assert.equal(((await call('GET', '/v1/accounts/me/admin/payouts/attention', owner)).body as { count: number }).count, 1)
    assert.equal((await call('POST', '/v1/accounts/me/admin/payouts/decide', streamer, { id: item!.id, status: 'paid' })).status, 404)
    assert.equal((await call('POST', '/v1/accounts/me/admin/payouts/decide', owner, { id: item!.id, status: 'paid', comment: 'СБП' })).status, 200)
    assert.equal(((await call('GET', '/v1/accounts/me/admin/payouts/attention', owner)).body as { count: number }).count, 0)
    assert.equal((await call('PUT', '/v1/accounts/me/admin/payout-limits', owner, { min: 2, max: 20 })).status, 200)
    assert.equal((await call('PUT', '/v1/accounts/me/admin/payout-limits', viewer, { min: 2, max: 20 })).status, 404)

    // Streamers use the service for free: no payment can be started.
    const refused = await call('POST', '/v1/payments', streamer, { plan: '1m', consent: { version: '2026-09-30' } })
    assert.equal(refused.status, 409)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
