import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { AdminStore } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { PayoutStore } from '../services/payoutStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const DAY = 24 * 60 * 60 * 1000

/** A fake ЮKassa (as in payments.test.ts): `pay()` makes a created payment succeed. */
function fakeYooKassa() {
  const remote = new Map<string, Record<string, unknown>>()
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    if (init.method === 'POST') {
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      const payment = { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } }
      remote.set(id, payment)
      return new Response(JSON.stringify(payment), { status: 200 })
    }
    const payment = remote.get(url.split('/').pop()!)
    return payment ? new Response(JSON.stringify(payment), { status: 200 }) : new Response('{}', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, pay: (id: string) => Object.assign(remote.get(id)!, { status: 'succeeded', paid: true }) }
}

/** The owner registers before the e-mail is listed (as the desktop app / build default requires). */
async function setup() {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id) // owner rights need a confirmed e-mail
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_secret', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  const payouts = new PayoutStore(db, payments, { now })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, payouts }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown> & Record<string, never>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown = text
    try { json = JSON.parse(text) } catch { /* CSV */ }
    return { status: response.status, json: json as T, text, headers: response.headers }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  const register = async (email: string, referralCode?: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, ...(referralCode ? { referralCode } : {}) })).json.token
  /** A succeeded ЮKassa payment of `plan` for the account behind `token`. */
  const pay = async (token: string, plan: '1m' | '3m' | '6m' | '12m') => {
    const created = await call('POST', '/payments', token, { plan, consent: { version: '2026-09-01' } })
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const { paymentId, confirmationUrl } = created.json as unknown as { paymentId: string; confirmationUrl: string }
    yoo.pay(new URL(confirmationUrl).searchParams.get('orderId')!)
    await call('GET', `/payments/${paymentId}`, token)
    return paymentId
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { db, accounts, payments, call, login, register, pay, close, advance: (ms: number) => { clock += ms } }
}

const ADMIN_GETS = ['/accounts/me/admin/overview', '/accounts/me/admin/series?period=month', '/accounts/me/admin/payments', '/accounts/me/admin/payments.csv', '/accounts/me/admin/users', '/accounts/me/admin/streamer-settings', '/accounts/me/admin/sales-settings', '/accounts/me/admin/audit']

test('admin routes: 401 without a session, 404 for a non-owner, 200 for the owner', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    for (const path of ADMIN_GETS) {
      assert.equal((await t.call('GET', path)).status, 401, path)
      const denied = await t.call('GET', path, player)
      assert.equal(denied.status, 404, path)
      assert.equal(JSON.stringify(denied.json).includes('player@example.com'), false)
      assert.equal((await t.call('GET', path, owner)).status, 200, path)
    }
    const users = (await t.call('GET', '/accounts/me/admin/users', owner)).json as unknown as { users: Array<{ id: string; email: string }> }
    const target = users.users.find((user) => user.email === 'player@example.com')!
    for (const [method, path, body] of [
      ['POST', `/accounts/me/admin/users/${target.id}/grant`, { days: 30, reason: 'подарок' }],
      ['POST', `/accounts/me/admin/users/${target.id}/block`, {}],
      ['POST', `/accounts/me/admin/users/${target.id}/revoke-sessions`, {}],
      ['PUT', '/accounts/me/admin/streamers/HUNTER/percent', { percent: 50 }],
    ] as const) {
      assert.equal((await t.call(method, path, player, body)).status, 404, path)
    }
    // Nothing changed for the player.
    const me = (await t.call('GET', '/accounts/me', player)).json as unknown as { subscription: { status: string } }
    assert.equal(me.subscription.status, 'inactive')
  } finally { await t.close() }
})

test('users list and details never contain password hashes, salts or session tokens', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    const list = await t.call('GET', '/accounts/me/admin/users?q=PLAYER', owner)
    const body = JSON.stringify(list.json)
    assert.equal((list.json as unknown as { total: number }).total, 1)
    for (const secret of ['salt', 'password', 'hash', 'digest', player]) assert.equal(body.includes(secret), false, secret)
    const id = (list.json as unknown as { users: Array<{ id: string; lastSeenAt?: string }> }).users[0]!
    assert.ok(id.lastSeenAt, 'last activity is known after sign-in')
    const detail = await t.call('GET', `/accounts/me/admin/users/${id.id}`, owner)
    assert.equal(detail.status, 200)
    assert.equal(JSON.stringify(detail.json).includes(player), false)
    assert.equal((await t.call('GET', '/accounts/me/admin/users/zzz', owner)).status, 400)
    assert.equal((await t.call('GET', `/accounts/me/admin/users/${'0'.repeat(24)}`, owner)).status, 404)
  } finally { await t.close() }
})

test('manual grant extends the paid period from its end, validates input and is logged with the reason', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    const id = ((await t.call('GET', '/accounts/me/admin/users?q=player', owner)).json as unknown as { users: Array<{ id: string }> }).users[0]!.id
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id}/grant`, owner, { days: 0, reason: 'x' })).status, 400)
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id}/grant`, owner, { days: 10, reason: '' })).status, 400)
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id}/grant`, owner, { days: 99999, reason: 'много' })).status, 400)

    const first = await t.call('POST', `/accounts/me/admin/users/${id}/grant`, owner, { days: 10, reason: 'компенсация за сбой' })
    assert.equal(first.status, 200)
    const firstUntil = Date.parse((first.json as unknown as { user: { subscription: { paidUntil: string } } }).user.subscription.paidUntil)
    assert.equal(firstUntil, Date.parse('2026-10-11T10:00:00.000Z'))
    const second = await t.call('POST', `/accounts/me/admin/users/${id}/grant`, owner, { days: 5, reason: 'конкурс' })
    const detail = second.json as unknown as { user: { subscription: { status: string; paidUntil: string } }; grants: Array<{ days: number; reason: string; actor: string }> }
    assert.equal(detail.user.subscription.status, 'active')
    assert.equal(Date.parse(detail.user.subscription.paidUntil), firstUntil + 5 * DAY)
    assert.deepEqual(detail.grants.map((grant) => [grant.days, grant.reason, grant.actor]), [[5, 'конкурс', 'owner@example.com'], [10, 'компенсация за сбой', 'owner@example.com']])

    // The user sees the subscription; a manual grant is not revenue.
    const me = (await t.call('GET', '/accounts/me', player)).json as unknown as { subscription: { status: string } }
    assert.equal(me.subscription.status, 'active')
    const overview = (await t.call('GET', '/accounts/me/admin/overview', owner)).json as unknown as { subscriptions: { active: number }; revenue: { all: { total: number } } }
    assert.equal(overview.subscriptions.active, 1)
    assert.equal(overview.revenue.all.total, 0)

    const audit = (await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string; actor: string; target: string; details: { reason: string } }> }
    assert.deepEqual(audit.entries.map((entry) => [entry.action, entry.actor, entry.target, entry.details.reason]), [
      ['subscription.grant', 'owner@example.com', 'player@example.com', 'конкурс'],
      ['subscription.grant', 'owner@example.com', 'player@example.com', 'компенсация за сбой'],
    ])
  } finally { await t.close() }
})

test('blocking revokes sessions, refuses login with 403 and cannot target the owner; unblocking restores login', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const second = await t.login('player@example.com')
    const owner = await t.login('owner@example.com')
    const users = ((await t.call('GET', '/accounts/me/admin/users', owner)).json as unknown as { users: Array<{ id: string; email: string }> }).users
    const id = users.find((user) => user.email === 'player@example.com')!.id
    const ownerId = users.find((user) => user.email === 'owner@example.com')!.id

    const blocked = await t.call('POST', `/accounts/me/admin/users/${id}/block`, owner, { reason: 'чарджбэк' })
    assert.equal(blocked.status, 200)
    assert.ok((blocked.json as unknown as { user: { blockedAt: string } }).user.blockedAt)
    for (const token of [player, second]) assert.equal((await t.call('GET', '/accounts/me', token)).status, 401)
    const login = await t.call('POST', '/accounts/login', undefined, { email: 'player@example.com', password })
    assert.equal(login.status, 403)
    assert.match(String(login.json.error), /заблокирован/)
    // A wrong password does not reveal the block.
    assert.equal((await t.call('POST', '/accounts/login', undefined, { email: 'player@example.com', password: 'wrong password!' })).status, 401)
    assert.equal(t.accounts.isBlocked(id), true)
    assert.throws(() => t.accounts.startSession(id), /заблокирован/)

    assert.equal((await t.call('POST', `/accounts/me/admin/users/${ownerId}/block`, owner, {})).status, 409)
    const filtered = (await t.call('GET', '/accounts/me/admin/users?filter=blocked', owner)).json as unknown as { total: number }
    assert.equal(filtered.total, 1)

    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id}/unblock`, owner)).status, 200)
    assert.equal((await t.call('POST', '/accounts/login', undefined, { email: 'player@example.com', password })).status, 200)

    // «Сбросить сессии»: signed out everywhere, can sign in again.
    const fresh = await t.login('player@example.com')
    const reset = await t.call('POST', `/accounts/me/admin/users/${id}/revoke-sessions`, owner)
    // The session of the check above and `fresh`.
    assert.equal((reset.json as unknown as { revoked: number }).revoked, 2)
    assert.equal((await t.call('GET', '/accounts/me', fresh)).status, 401)

    const actions = ((await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string }> }).entries.map((entry) => entry.action)
    assert.deepEqual(actions, ['sessions.revoke', 'account.unblock', 'account.block'])
  } finally { await t.close() }
})

test('statistics: users, revenue by provider and plan per day / month, payouts, filters and CSV', async () => {
  const t = await setup()
  try {
    // A streamer and two referred players; one pays 1 month, the other 12 months the next day; a Lava payment by SQL.
    await t.register('streamer@example.com')
    t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
    const a = await t.register('a@example.com', 'HUNTER')
    await t.pay(a, '1m')
    t.advance(DAY)
    const b = await t.register('b@example.com', 'HUNTER')
    await t.pay(b, '12m')
    const bId = t.accounts.authenticate(b)!
    t.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, paid_at, provider, currency, amount_original) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaa', ?, '3m', 90000, 'succeeded', ?, ?, 'lava', 'USD', 1000)").run(bId, Date.parse('2026-10-02T11:00:00.000Z'), Date.parse('2026-10-02T11:00:00.000Z'))
    t.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, provider, currency) VALUES ('bbbbbbbbbbbbbbbbbbbbbbbb', ?, '6m', 180000, 'canceled', ?, 'yookassa', 'RUB')").run(bId, Date.parse('2026-10-02T11:30:00.000Z'))
    const owner = await t.login('owner@example.com')

    const overview = (await t.call('GET', '/accounts/me/admin/overview', owner)).json as unknown as {
      users: { total: number; today: number; days7: number }; subscriptions: { active: number; trials: number; streamers: number }
      revenue: { today: { yookassa: number; lava: number; total: number }; month: { total: number }; all: { total: number; payments: number }; lavaOriginal: Array<{ currency: string; amount: number }> }
      payouts: { earned: number }
    }
    assert.deepEqual([overview.users.total, overview.users.today, overview.users.days7], [4, 1, 4])
    assert.equal(overview.subscriptions.active, 2)
    assert.equal(overview.subscriptions.streamers, 1)
    // 12 months: 300 × 12 × 0.67 = 2412 ₽ today (ЮKassa) + 900 ₽ (Lava at the owner's rate).
    assert.deepEqual(overview.revenue.today, { yookassa: 2412, lava: 900, total: 3312, payments: 2 })
    assert.equal(overview.revenue.all.total, 3612)
    assert.equal(overview.revenue.all.payments, 3)
    assert.deepEqual(overview.revenue.lavaOriginal, [{ currency: 'USD', amount: 10 }])
    // 10 % of the two referred ЮKassa payments (the Lava row was inserted without a referral code).
    assert.equal(overview.payouts.earned, 271.2)

    const days = (await t.call('GET', '/accounts/me/admin/series?period=day', owner)).json as unknown as { rows: Array<{ period: string; registrations: number; payments: number; revenue: number; yookassa: number; lava: number; plans: Record<string, { count: number; revenue: number }> }> }
    assert.equal(days.rows.length, 31)
    const [today, yesterday] = days.rows
    assert.equal(today!.period, '2026-10-02')
    assert.deepEqual([today!.registrations, today!.payments, today!.revenue, today!.yookassa, today!.lava], [1, 2, 3312, 2412, 900])
    assert.deepEqual(today!.plans['12m'], { count: 1, revenue: 2412 })
    assert.deepEqual(today!.plans['3m'], { count: 1, revenue: 900 })
    assert.deepEqual([yesterday!.period, yesterday!.registrations, yesterday!.payments, yesterday!.revenue], ['2026-10-01', 3, 1, 300])
    const months = (await t.call('GET', '/accounts/me/admin/series?period=month', owner)).json as unknown as { rows: Array<{ period: string; payments: number; revenue: number }> }
    assert.equal(months.rows.length, 12)
    assert.deepEqual([months.rows[0]!.period, months.rows[0]!.payments, months.rows[0]!.revenue], ['2026-10', 3, 3612])
    const years = (await t.call('GET', '/accounts/me/admin/series?period=year', owner)).json as unknown as { rows: Array<{ period: string; registrations: number }> }
    assert.deepEqual(years.rows.map((row) => [row.period, row.registrations]), [['2026', 4]])
    assert.equal((await t.call('GET', '/accounts/me/admin/series?period=week', owner)).status, 400)

    // Payments: filters and totals.
    const all = (await t.call('GET', '/accounts/me/admin/payments', owner)).json as unknown as { total: number; totals: { succeeded: number; revenue: number; lava: number; yookassa: number } }
    assert.deepEqual([all.total, all.totals.succeeded, all.totals.revenue, all.totals.lava, all.totals.yookassa], [4, 3, 3612, 900, 2712])
    const lava = (await t.call('GET', '/accounts/me/admin/payments?provider=lava', owner)).json as unknown as { payments: Array<{ original: { amount: number; currency: string } }> }
    assert.deepEqual(lava.payments.map((item) => item.original), [{ amount: 10, currency: 'USD' }])
    const canceled = (await t.call('GET', '/accounts/me/admin/payments?status=canceled&plan=6m', owner)).json as unknown as { total: number }
    assert.equal(canceled.total, 1)
    const byEmail = (await t.call('GET', '/accounts/me/admin/payments?q=A%40EXAMPLE', owner)).json as unknown as { total: number; payments: Array<{ email: string }> }
    assert.deepEqual(byEmail.payments.map((item) => item.email), ['a@example.com'])
    const firstDay = (await t.call('GET', '/accounts/me/admin/payments?from=2026-10-01&to=2026-10-01', owner)).json as unknown as { total: number }
    assert.equal(firstDay.total, 1)
    assert.equal((await t.call('GET', '/accounts/me/admin/payments?from=2026-10-03&to=2026-10-01', owner)).status, 400)
    assert.equal((await t.call('GET', '/accounts/me/admin/payments?status=lost', owner)).status, 400)
    // LIKE wildcards are literal.
    assert.equal(((await t.call('GET', '/accounts/me/admin/payments?q=%25', owner)).json as unknown as { total: number }).total, 0)

    const csv = await t.call('GET', '/accounts/me/admin/payments.csv?status=succeeded', owner)
    assert.equal(csv.status, 200)
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/)
    assert.match(csv.headers.get('content-disposition') ?? '', /attachment; filename="raidos-payments-/)
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n')
    assert.equal(lines.length, 4)
    assert.equal(lines[0]!.split(';')[2], 'E-mail')
    assert.ok(lines.some((line) => line.includes('b@example.com;12m;ЮKassa;Оплачен;2412,00')), lines.join('\n'))
    assert.ok(lines.some((line) => line.includes('Lava.top;Оплачен;900,00;10,00;USD')))
    const exported = ((await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string; details: { rows: number } }> }).entries[0]!
    assert.deepEqual([exported.action, exported.details.rows], ['payments.export', 3])
  } finally { await t.close() }
})

test('CSV cells that look like formulas are neutralised', async () => {
  const t = await setup()
  try {
    await t.register('+cmd@example.com')
    const id = t.accounts.authenticate(await t.login('+cmd@example.com'))!
    t.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, provider, currency) VALUES ('cccccccccccccccccccccccc', ?, '1m', 30000, 'pending', ?, 'yookassa', 'RUB')").run(id, Date.parse('2026-10-01T10:00:00.000Z'))
    const csv = await t.call('GET', '/accounts/me/admin/payments.csv', await t.login('owner@example.com'))
    assert.ok(csv.text.includes(";'+cmd@example.com;"), csv.text)
  } finally { await t.close() }
})

test('streamer percent per streamer applies to new payments only; a disabled link stops attribution', async () => {
  const t = await setup()
  try {
    await t.register('streamer@example.com')
    t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
    const owner = await t.login('owner@example.com')
    const first = await t.register('first@example.com', 'HUNTER')
    await t.pay(first, '1m')
    assert.equal(t.payments.streamerEarned('HUNTER'), 3000)

    assert.equal((await t.call('PUT', '/accounts/me/admin/streamers/HUNTER/percent', owner, { percent: 101 })).status, 400)
    assert.equal((await t.call('PUT', '/accounts/me/admin/streamers/NOBODY/percent', owner, { percent: 20 })).status, 404)
    const settings = (await t.call('PUT', '/accounts/me/admin/streamers/hunter/percent', owner, { percent: 50 })).json as unknown as { defaultPercent: number; streamers: Array<{ code: string; percent: number; custom: boolean; linkEnabled: boolean }> }
    assert.equal(settings.defaultPercent, 10)
    assert.deepEqual(settings.streamers.map((row) => [row.code, row.percent, row.custom, row.linkEnabled]), [['HUNTER', 50, true, true]])
    const second = await t.register('second@example.com', 'HUNTER')
    await t.pay(second, '1m')
    // 10 % of the first payment stays, 50 % of the second.
    assert.equal(t.payments.streamerEarned('HUNTER'), 3000 + 15000)
    const streamer = await t.login('streamer@example.com')
    assert.equal(((await t.call('GET', '/accounts/me/payouts', streamer)).json as unknown as { percent: number }).percent, 50)

    // Back to the default.
    const reset = (await t.call('PUT', '/accounts/me/admin/streamers/HUNTER/percent', owner, { percent: null })).json as unknown as { streamers: Array<{ percent: number; custom: boolean }> }
    assert.deepEqual([reset.streamers[0]!.percent, reset.streamers[0]!.custom], [10, false])

    // Link off: visits are not counted, new registrations are not attributed; on again: attributed.
    const off = (await t.call('PUT', '/accounts/me/admin/streamers/HUNTER/link', owner, { enabled: false })).json as unknown as { streamers: Array<{ linkEnabled: boolean }> }
    assert.equal(off.streamers[0]!.linkEnabled, false)
    assert.equal((await t.call('POST', '/accounts/referral-visits', undefined, { code: 'HUNTER' })).status, 404)
    const third = await t.call('POST', '/accounts/register', undefined, { email: 'third@example.com', password, referralCode: 'HUNTER' })
    assert.equal((third.json as unknown as { referralApplied: boolean }).referralApplied, false)
    await t.call('PUT', '/accounts/me/admin/streamers/HUNTER/link', owner, { enabled: true })
    const fourth = await t.call('POST', '/accounts/register', undefined, { email: 'fourth@example.com', password, referralCode: 'HUNTER' })
    assert.equal((fourth.json as unknown as { referralApplied: boolean }).referralApplied, true)

    const actions = ((await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string; target: string }> }).entries.map((entry) => `${entry.action}:${entry.target}`)
    assert.deepEqual(actions, ['streamer.link:HUNTER', 'streamer.link:HUNTER', 'streamer.percent:HUNTER', 'streamer.percent:HUNTER'])
  } finally { await t.close() }
})

test('the owner can take the streamer status away: the cabinet goes, the code stays reserved', async () => {
  const t = await setup()
  try {
    await t.register('streamer@example.com')
    t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
    const owner = await t.login('owner@example.com')
    const streamer = await t.login('streamer@example.com')
    assert.equal(((await t.call('GET', '/accounts/me', streamer)).json as unknown as { kind: string }).kind, 'streamer')

    assert.equal((await t.call('POST', '/accounts/me/admin/streamers/NOBODY/revoke', owner)).status, 404)
    assert.equal((await t.call('POST', '/accounts/me/admin/streamers/HUNTER/revoke', streamer)).status, 404)
    const settings = (await t.call('POST', '/accounts/me/admin/streamers/hunter/revoke', owner)).json as unknown as { streamers: unknown[] }
    assert.deepEqual(settings.streamers, [])

    const me = (await t.call('GET', '/accounts/me', streamer)).json as unknown as { kind: string; referralCode?: string; subscription: { status: string } }
    assert.equal(me.kind, 'user')
    assert.equal(me.referralCode, undefined)
    assert.equal(me.subscription.status, 'inactive')
    assert.equal((await t.call('POST', '/accounts/referral-visits', undefined, { code: 'HUNTER' })).status, 404)
    assert.throws(() => t.accounts.promoteToStreamer('owner@example.com', 'HUNTER'), /already taken/)
    const actions = ((await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string; target: string }> }).entries.map((entry) => `${entry.action}:${entry.target}`)
    assert.deepEqual(actions, ['streamer.revoke:HUNTER'])
  } finally { await t.close() }
})

test("the owner's older actions (streamer invites, payout limits) are written to the audit log", async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    assert.equal((await t.call('POST', '/accounts/me/admin/streamer-invites', owner, { code: 'new_one' })).status, 201)
    assert.equal((await t.call('PUT', '/accounts/me/admin/payout-limits', owner, { min: 2, max: 14 })).status, 200)
    // Refused calls (and other people's) are not logged.
    assert.equal((await t.call('POST', '/accounts/me/admin/streamer-invites', owner, { code: '<b>' })).status, 400)
    assert.equal((await t.call('POST', '/accounts/me/admin/streamer-invites', player, { code: 'HACKER' })).status, 404)
    const entries = ((await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string; target?: string; details?: Record<string, unknown> }> }).entries
    assert.deepEqual(entries.map((entry) => [entry.action, entry.target ?? '', entry.details ?? {}]), [
      ['payout.limits', '', { min: 2, max: 14 }],
      ['streamer.invite', 'NEW_ONE', {}],
    ])
    // The invitation token is never written to the log.
    assert.equal(JSON.stringify(entries).includes('token'), false)
  } finally { await t.close() }
})

test('sales settings show prices and providers, never keys; the database migration is additive and repeatable', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const sales = await t.call('GET', '/accounts/me/admin/sales-settings', owner)
    const text = JSON.stringify(sales.json)
    assert.equal(text.includes('test_secret'), false)
    const body = sales.json as unknown as { yookassa: { monthPrice: number }; plans: Array<{ id: string; price: number }>; streamerPercent: number }
    assert.equal(body.yookassa.monthPrice, 300)
    assert.deepEqual(body.plans.map((plan) => plan.price), [300, 900, 1800, 2412])
    assert.equal(body.streamerPercent, 10)
  } finally { await t.close() }

  // An «old» database without the new columns/tables gets them on start, and starting twice changes nothing.
  const db = openDatabase(':memory:')
  db.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt BLOB NOT NULL, password_hash BLOB NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('user','streamer')), created_at INTEGER NOT NULL, referral_code TEXT UNIQUE, referred_by TEXT, referred_at INTEGER, nicknames TEXT NOT NULL DEFAULT '{}')")
  db.prepare("INSERT INTO accounts (id, email, salt, password_hash, kind, created_at) VALUES ('a', 'old@example.com', x'00', x'00', 'user', 1)").run()
  for (let i = 0; i < 2; i++) {
    const accounts = new AccountStore({ db, ownerEmails: [] })
    new AdminStore(accounts, new PaymentStore(db, undefined))
  }
  const columns = (db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>).map((row) => row.name)
  for (const name of ['blocked_at', 'last_seen_at', 'referral_disabled_at']) assert.ok(columns.includes(name), name)
  assert.equal((db.prepare('SELECT email, blocked_at FROM accounts').get() as { email: string; blocked_at: null }).blocked_at, null)
  assert.throws(() => new AdminStore(new AccountStore({ db, ownerEmails: [] }), new PaymentStore(openDatabase(':memory:'), undefined)), /share one database/)
})
