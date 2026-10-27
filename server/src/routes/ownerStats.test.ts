import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { AdminStore } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

/** The owner app's statistics and management API (docs/codex/owner-admin-api.md). */
const password = 'correct horse battery'
const DAY = 24 * 60 * 60 * 1000

/** A fake ЮKassa: `pay(id, type)` makes a created payment succeed, optionally with the method ЮKassa reports. */
function fakeYooKassa() {
  const remote = new Map<string, Record<string, unknown>>()
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    if (init.method === 'POST') {
      const id = `3e${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      const payment = { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } }
      remote.set(id, payment)
      return new Response(JSON.stringify(payment), { status: 200 })
    }
    const payment = remote.get(url.split('/').pop()!)
    return payment ? new Response(JSON.stringify(payment), { status: 200 }) : new Response('{}', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return {
    fetch,
    pay: (id: string, type?: string) => Object.assign(remote.get(id)!, { status: 'succeeded', paid: true, ...(type ? { payment_method: { type, id: `pm-${id}`, saved: false } } : {}) }),
  }
}

async function setup(start = '2026-08-01T10:00:00.000Z') {
  let clock = Date.parse(start)
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_secret', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    // The BOM is kept (Response.text() would drop it): the CSV must start with one.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer())
    let json: unknown = text
    try { json = JSON.parse(text) } catch { /* CSV */ }
    return { status: response.status, json: json as T, text, headers: response.headers }
  }
  const login = async (email: string) => (await accounts.login(email, password)).token
  /** An account of `country` registered now (null: no country), with a fresh session. */
  const user = async (email: string, country: string | null) => {
    await accounts.register(email, password, undefined, undefined, country ?? 'RU')
    if (country === null) db.prepare('UPDATE accounts SET country = NULL WHERE email = ?').run(email)
    return { id: accounts.accountByEmail(email)!.id, token: await login(email) }
  }
  /** Starts a ЮKassa payment of `plan`; `finish(type)` pays it. */
  const startPayment = async (token: string, plan: '1m' | '3m') => {
    const created = await call<{ paymentId: string; confirmationUrl: string }>('POST', '/payments', token, { plan, consent: { version: '2026-09-01' } })
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const remoteId = new URL(created.json.confirmationUrl).searchParams.get('orderId')!
    return {
      id: created.json.paymentId,
      finish: async (type?: string) => { yoo.pay(remoteId, type); await call('GET', `/payments/${created.json.paymentId}`, token) },
    }
  }
  const pay = async (token: string, plan: '1m' | '3m', type?: string) => {
    const payment = await startPayment(token, plan)
    await payment.finish(type)
    return payment.id
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { db, accounts, payments, call, login, user, startPayment, pay, close, set: (iso: string) => { clock = Date.parse(iso) }, now }
}

/**
 * The seeded database (Moscow = UTC+3; the statistics range 2026-09-25 … 2026-10-01):
 *   ru1   RU  since August, paid 1m in August (out of range) and again on 25.09 (sbp)          → money
 *   ru2   RU  registered 24.09 23:30 MSK, 3m created then, paid 25.09 with a card, autopay     → money
 *   kz1   KZ  Boosty 1m 250 ₽ (owner's confirmation), invited by ru1, trial ended               → money
 *   de1   DE  10 days from the owner                                                           → grant
 *   de2   PL  7 days from a «Пригласи друга» reward                                            → friend
 *   us1   US  free period running                                                              → trial
 *   none1 —   paid 1m, refunded by the owner                                                   → nothing
 *   str1  DE  streamer                                                                         → lifetime
 *   del1  RU  paid 1m (sbp), then deleted                                                      → not a user
 */
async function seeded() {
  const t = await setup()
  const ru1 = await t.user('ru1@example.com', 'RU')
  await t.pay(ru1.token, '1m')
  t.set('2026-09-24T20:30:00.000Z')
  const ru2 = await t.user('ru2@example.com', 'RU')
  const ru2Payment = await t.startPayment(ru2.token, '3m')
  t.set('2026-09-25T09:00:00.000Z')
  await ru2Payment.finish('bank_card')
  const ru1Token = await t.login('ru1@example.com')
  await t.pay(ru1Token, '1m')
  const kz1 = await t.user('kz1@example.com', 'KZ')
  const de1 = await t.user('de1@example.com', 'DE')
  const de2 = await t.user('de2@example.com', 'PL')
  const us1 = await t.user('us1@example.com', 'US')
  const none1 = await t.user('none1@example.com', 'RU')
  const str1 = await t.user('str1@example.com', 'DE')
  const del1 = await t.user('del1@example.com', 'RU')
  const owner = await t.login('owner@example.com')
  const boosty = await t.call('POST', '/accounts/me/admin/boosty/payments', owner, { email: 'kz1@example.com', offer: 'standard', months: 1, amount: 250 })
  assert.equal(boosty.status, 201, JSON.stringify(boosty.json))
  assert.equal((await t.call('POST', `/accounts/me/admin/users/${de1.id}/grant`, owner, { days: 10, reason: 'тест' })).status, 200)
  const refunded = await t.pay(none1.token, '1m')
  assert.equal((await t.call('POST', `/accounts/me/admin/payments/${refunded}/refunded`, owner)).status, 200)
  t.db.prepare('UPDATE accounts SET country = NULL WHERE id = ?').run(none1.id)
  await t.pay(del1.token, '1m')
  assert.equal((await t.call('POST', `/accounts/me/admin/users/${del1.id}/delete`, owner)).status, 200)
  const now = t.now()
  t.db.prepare("UPDATE accounts SET kind = 'streamer', referral_code = 'STR1' WHERE id = ?").run(str1.id)
  t.db.prepare('UPDATE accounts SET invited_by = ? WHERE id = ?').run(ru1.id, kz1.id)
  t.db.prepare('UPDATE accounts SET trial_ends_at = ?, trial_pending_ms = NULL WHERE id = ?').run(now + DAY, kz1.id)
  t.db.prepare("INSERT INTO invite_rewards (inviter_id, kind, days, status, created_at) VALUES (?, 'friend', 7, 'granted', ?)").run(de2.id, now)
  t.db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?)').run(de2.id, now + 7 * DAY)
  t.db.prepare("INSERT INTO recurring_subscriptions (id, account_id, provider, plan, amount, currency, status, consent_version, consent_at, created_at) VALUES ('rec1', ?, 'yookassa', '3m', 81000, 'RUB', 'active', 'v1', ?, ?)").run(ru2.id, now, now)
  t.set('2026-10-01T10:00:00.000Z')
  t.db.prepare('UPDATE accounts SET trial_ends_at = ?, trial_pending_ms = NULL WHERE id = ?').run(t.now() + DAY, us1.id)
  t.db.prepare('UPDATE accounts SET last_seen_at = NULL').run()
  t.db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(t.now() - 60 * 60 * 1000, us1.id)
  t.db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(Date.parse('2026-09-20T10:00:00.000Z'), ru1.id)
  return { ...t, owner: await t.login('owner@example.com'), ids: { ru1: ru1.id, ru2: ru2.id, kz1: kz1.id, de1: de1.id, de2: de2.id, us1: us1.id, none1: none1.id, str1: str1.id, del1: del1.id }, us1Token: us1.token }
}

type Stats = {
  range: { from: string; to: string }
  users: { total: number; new: number; deletedExcluded: number; streamers: number }
  byRegion: Record<string, { users: number; new: number; paying: number; active: number; revenue: number }>
  legacyRegion: Record<string, number>
  byCountry: Array<{ country: string; users: number; paying: number; active: number; revenue: number }>
  subscriptions: { activePaid: number; activeGranted: number; grantedBy: { owner: number; friend: number }; trials: number; expiringIn7Days: number; expiringIn30Days: number; lifetime: { total: number; streamers: number; legend: number }; autopay: number }
  payers: { everPaid: number; paidInRange: number; newInRange: number }
  revenue: { total: number; payments: number; byProvider: Record<string, { count: number; amount: number }>; byMethod: Record<string, { count: number; amount: number }>; byRegion: Record<string, { count: number; amount: number }>; byPlan: Record<string, { count: number; amount: number }>; refunds: { count: number; amount: number } }
  referrals: { friendInvited: number; friendInvitedInRange: number; friendPaid: number; friendPaidDiscount: number; rewardsByStatus: Record<string, number> }
  trialConversion: { trialStarted: number; laterPaid: number; rate: number }
}
type User = { id: string; email: string; payRegion: string; source?: string }

test('stats: users, regions, countries, paying vs granted, revenue by provider / method / region on paid_at, refunds; deleted accounts excluded', async () => {
  const t = await seeded()
  try {
    const response = await t.call<Stats>('GET', '/accounts/me/admin/stats?from=2026-09-25&to=2026-10-01', t.owner)
    assert.equal(response.status, 200, JSON.stringify(response.json))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const stats = response.json
    assert.deepEqual(stats.range.from, '2026-09-25')
    assert.deepEqual(stats.users, { total: 9, new: 6, deletedExcluded: 1, streamers: 1, blocked: 0 })
    assert.deepEqual(stats.byRegion.RU, { users: 2, new: 0, paying: 2, active: 2, revenue: 1100 })
    assert.deepEqual(stats.byRegion.CIS, { users: 1, new: 1, paying: 1, active: 1, revenue: 250 })
    assert.deepEqual(stats.byRegion.WORLD, { users: 4, new: 4, paying: 0, active: 3, revenue: 0 })
    // The deleted account's payment stays revenue, with no country any more.
    assert.deepEqual(stats.byRegion.none, { users: 2, new: 1, paying: 0, active: 0, revenue: 300 })
    assert.deepEqual(stats.legacyRegion, { cis: 3, europe: 3, other: 1, none: 2 })
    assert.deepEqual(stats.byCountry.map((row) => [row.country, row.users, row.paying, row.active, row.revenue]), [['RU', 2, 2, 2, 1100], ['DE', 2, 0, 2, 0], ['KZ', 1, 1, 1, 250], ['PL', 1, 0, 1, 0], ['US', 1, 0, 0, 0]])
    const { trialsPending, ...subscriptions } = stats.subscriptions as Stats['subscriptions'] & { trialsPending: number }
    assert.equal(typeof trialsPending, 'number')
    assert.deepEqual(subscriptions, { activePaid: 3, activeGranted: 2, grantedBy: { owner: 1, friend: 1 }, trials: 1, expiringIn7Days: 2, expiringIn30Days: 4, lifetime: { total: 1, streamers: 1, legend: 0 }, autopay: 1 })
    assert.deepEqual(stats.payers, { everPaid: 3, paidInRange: 3, newInRange: 2 })
    assert.equal(stats.revenue.total, 1650)
    assert.equal(stats.revenue.payments, 4)
    assert.deepEqual(stats.revenue.byProvider, { yookassa: { count: 3, amount: 1400 }, boosty: { count: 1, amount: 250 }, archive: { count: 0, amount: 0 } })
    assert.deepEqual(stats.revenue.byMethod, { sbp: { count: 2, amount: 600 }, bank_card: { count: 1, amount: 800 }, boosty: { count: 1, amount: 250 } })
    assert.deepEqual(stats.revenue.byRegion, { RU: { count: 2, amount: 1100 }, CIS: { count: 1, amount: 250 }, WORLD: { count: 0, amount: 0 }, none: { count: 1, amount: 300 } })
    assert.deepEqual(stats.revenue.byPlan, { '1m': { count: 3, amount: 850 }, '3m': { count: 1, amount: 800 }, '6m': { count: 0, amount: 0 }, '12m': { count: 0, amount: 0 } })
    assert.deepEqual(stats.revenue.refunds, { count: 1, amount: 300 })
    assert.deepEqual(stats.referrals, { friendInvited: 1, friendInvitedInRange: 1, friendPaid: 1, friendPaidDiscount: 0, streamerReferred: 0, rewardsByStatus: { pending: 0, review: 0, granted: 1, canceled: 0 } })
    assert.deepEqual(stats.trialConversion, { trialStarted: 2, laterPaid: 1, rate: 0.5 })

    // A range before the payments: no revenue, the state «now» stays the same. The August payment of ru1 is there.
    const august = (await t.call<Stats>('GET', '/accounts/me/admin/stats?from=2026-08-01&to=2026-08-31', t.owner)).json
    assert.equal(august.revenue.total, 300)
    assert.equal(august.users.new, 2) // the owner and ru1
    assert.equal(august.subscriptions.activePaid, 3)
    // Default: the last 30 Moscow days up to today.
    const fallback = (await t.call<Stats>('GET', '/accounts/me/admin/stats', t.owner)).json
    assert.deepEqual([fallback.range.from, fallback.range.to], ['2026-09-02', '2026-10-01'])
    assert.equal(fallback.revenue.total, 1650)
    for (const query of ['from=2026-10-02&to=2026-10-01', 'from=2026-02-30', 'to=yesterday']) {
      assert.equal((await t.call('GET', `/accounts/me/admin/stats?${query}`, t.owner)).status, 400, query)
    }
    assert.equal((await t.call('GET', '/accounts/me/admin/stats')).status, 401)
    assert.equal((await t.call('GET', '/accounts/me/admin/stats', t.us1Token)).status, 404)

    // The existing summary no longer counts the deleted account as a registration.
    const overview = (await t.call<{ users: { total: number } }>('GET', '/accounts/me/admin/overview', t.owner)).json
    assert.equal(overview.users.total, 9)
    const september = (await t.call<{ days: Array<{ date: string; registrations: number }> }>('GET', '/accounts/me/admin/calendar?month=2026-09', t.owner)).json
    assert.equal(september.days.find((day) => day.date === '2026-09-25')!.registrations, 6)
    const days = (await t.call<{ rows: Array<{ period: string; registrations: number }> }>('GET', '/accounts/me/admin/series?period=month', t.owner)).json
    assert.equal(days.rows.find((row) => row.period === '2026-09')!.registrations, 7)

    // The method is stored with the payment.
    const methods = t.db.prepare("SELECT a.email, p.method, p.status FROM payments p JOIN accounts a ON a.id = p.account_id WHERE p.status <> 'pending' ORDER BY p.created_at, p.rowid").all() as Array<{ email: string; method: string }>
    assert.deepEqual(methods.map((row) => [row.email.startsWith('deleted-') ? 'deleted' : row.email, row.method]), [
      ['ru1@example.com', 'sbp'], ['ru2@example.com', 'bank_card'], ['ru1@example.com', 'sbp'], ['kz1@example.com', 'boosty'], ['none1@example.com', 'sbp'], ['deleted', 'sbp'],
    ])
  } finally { await t.close() }
})

test('users: country, payRegion, payer, expiresBefore, registeredFrom/To, seenSince, autopay filters and sorts; payRegion and source in every user', async () => {
  const t = await seeded()
  try {
    const list = async (query: string) => {
      const response = await t.call<{ users: User[]; total: number; regions: Record<string, number> }>('GET', `/accounts/me/admin/users?${query}`, t.owner)
      assert.equal(response.status, 200, `${query}: ${JSON.stringify(response.json)}`)
      return response.json
    }
    const emails = async (query: string) => (await list(query)).users.map((user) => user.email.split('@')[0]).sort()
    assert.deepEqual(await emails('country=ru'), ['ru1', 'ru2'])
    assert.deepEqual(await emails('payRegion=WORLD'), ['de1', 'de2', 'str1', 'us1'])
    assert.deepEqual(await emails('payRegion=CIS'), ['kz1'])
    assert.deepEqual(await emails('payRegion=none'), ['none1', 'owner'])
    assert.deepEqual(await emails('payer=yes'), ['kz1', 'ru1', 'ru2'])
    assert.equal((await list('payer=no')).total, 6)
    assert.deepEqual(await emails('expiresBefore=2026-10-05'), ['de1', 'de2'])
    assert.deepEqual(await emails('expiresBefore=2026-10-04'), ['de2'])
    assert.deepEqual(await emails('registeredFrom=2026-09-25'), ['de1', 'de2', 'kz1', 'none1', 'str1', 'us1'])
    assert.deepEqual(await emails('registeredTo=2026-09-24'), ['owner', 'ru1', 'ru2'])
    assert.deepEqual(await emails('registeredFrom=2026-09-24&registeredTo=2026-09-24'), ['ru2'])
    // The owner's own requests count as «seen» too.
    assert.deepEqual(await emails('seenSince=2026-09-30'), ['owner', 'us1'])
    assert.deepEqual(await emails('autopay=yes'), ['ru2'])
    assert.equal((await list('autopay=no')).total, 8)
    assert.deepEqual(await emails('payRegion=RU&payer=yes&autopay=no'), ['ru1'])
    // Region counts ignore the chosen tab; Russia is separate from CIS, as in the owner app.
    const cis = await list('payer=yes&region=cis')
    assert.equal(cis.total, 1)
    assert.deepEqual(cis.regions, { all: 3, russia: 2, cis: 1, world: 0, europe: 0, other: 0, none: 0 })

    const order = async (query: string) => (await list(query)).users.map((user) => user.email.split('@')[0])
    assert.deepEqual((await order('sort=payments&order=desc')).slice(0, 3), ['ru2', 'ru1', 'kz1'])
    assert.deepEqual((await order('sort=lastSeen')).slice(0, 3), ['owner', 'us1', 'ru1'])
    assert.equal((await order('sort=paidUntil&order=desc'))[0], 'ru2')
    assert.deepEqual((await order('sort=created&order=asc')).slice(0, 2), ['owner', 'ru1'])
    assert.deepEqual((await order('')).slice(-2), ['ru1', 'owner'])

    const byEmail = new Map((await list('limit=50')).users.map((user) => [user.email.split('@')[0], user]))
    assert.deepEqual([...byEmail.keys()].sort(), ['de1', 'de2', 'kz1', 'none1', 'owner', 'ru1', 'ru2', 'str1', 'us1'])
    const view = (name: string) => [byEmail.get(name)!.payRegion, byEmail.get(name)!.source]
    assert.deepEqual(view('ru1'), ['RU', 'money'])
    assert.deepEqual(view('kz1'), ['CIS', 'money'])
    assert.deepEqual(view('de1'), ['WORLD', 'grant'])
    assert.deepEqual(view('de2'), ['WORLD', 'friend'])
    assert.deepEqual(view('us1'), ['WORLD', 'trial'])
    assert.deepEqual(view('str1'), ['WORLD', 'lifetime'])
    assert.deepEqual(view('none1'), ['none', undefined])
    const card = await t.call<{ user: User }>('GET', `/accounts/me/admin/users/${t.ids.ru2}`, t.owner)
    assert.deepEqual([card.json.user.payRegion, card.json.user.source], ['RU', 'money'])

    for (const query of ['country=RUS', 'payRegion=EU', 'payer=maybe', 'expiresBefore=2026-02-30', 'registeredFrom=2026-10-02&registeredTo=2026-10-01', 'sort=email', 'order=up', 'seenSince=1.10.2026']) {
      assert.equal((await t.call('GET', `/accounts/me/admin/users?${query}`, t.owner)).status, 400, query)
    }
  } finally { await t.close() }
})

test('users.csv: the same filters, UTF-8 BOM, «;», the agreed columns; audited; export rate limit; owner only', async () => {
  const t = await seeded()
  try {
    assert.equal((await t.call('GET', '/accounts/me/admin/users.csv')).status, 401)
    assert.equal((await t.call('GET', '/accounts/me/admin/users.csv', t.us1Token)).status, 404)
    const response = await t.call('GET', '/accounts/me/admin/users.csv?payRegion=RU&sort=payments', t.owner)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/csv/)
    assert.match(response.headers.get('content-disposition') ?? '', /raidos-users-\d{4}-\d{2}-\d{2}\.csv/)
    assert.ok(response.text.startsWith('\uFEFF'))
    const lines = response.text.slice(1).trim().split('\r\n')
    assert.equal(lines[0], 'email;nickname;country;payRegion;created;lastSeen;status;paidUntil;source;paymentsCount;paymentsTotal;invitedBy')
    assert.equal(lines.length, 3)
    assert.equal(lines[1], 'ru2@example.com;;RU;RU;2026-09-24 23:30;;active;2026-12-24 12:00;money;1;800,00;')
    assert.match(lines[2]!, /^ru1@example\.com;;RU;RU;2026-08-01 13:00;2026-09-20 13:00;active;[^;]+;money;2;600,00;$/)
    const invited = await t.call('GET', '/accounts/me/admin/users.csv?country=KZ', t.owner)
    assert.match(invited.text, /kz1@example\.com;;KZ;CIS;.*;money;1;250,00;ru1@example\.com\r\n$/)
    const audit = await t.call<{ entries: Array<{ action: string; details?: Record<string, unknown> }> }>('GET', '/accounts/me/admin/audit', t.owner)
    const exports = audit.json.entries.filter((entry) => entry.action === 'users.export')
    assert.equal(exports.length, 2)
    assert.deepEqual(exports[1]!.details, { rows: 2, payRegion: 'RU' })
    assert.equal((await t.call('GET', '/accounts/me/admin/users.csv?country=RUS', t.owner)).status, 400)
    // 10 exports a minute (the two above and the refused one count).
    let limited = 0
    for (let i = 0; i < 9; i++) if ((await t.call('GET', '/accounts/me/admin/users.csv', t.owner)).status === 429) limited++
    assert.equal(limited, 2)
  } finally { await t.close() }
})

test('bulk grant: dryRun changes nothing, ids skip deleted accounts and streamers, one audit entry with the count, owner only', async () => {
  const t = await seeded()
  try {
    const body = { filter: { payRegion: 'WORLD' }, days: 5, reason: 'компенсация', dryRun: true }
    assert.equal((await t.call('POST', '/accounts/me/admin/users/bulk-grant', undefined, body)).status, 401)
    assert.equal((await t.call('POST', '/accounts/me/admin/users/bulk-grant', t.us1Token, body)).status, 404)
    const before = t.payments.paidUntil(t.ids.de1)
    type Result = { affected: number; skipped: number; dryRun: boolean; sample: Array<{ id: string; email: string; paidUntilBefore?: string; paidUntilAfter: string }> }
    const dry = await t.call<Result>('POST', '/accounts/me/admin/users/bulk-grant', t.owner, body)
    assert.equal(dry.status, 200, JSON.stringify(dry.json))
    assert.equal(dry.json.dryRun, true)
    assert.equal(dry.json.affected, 3) // de1, de2, us1 — the streamer has lifetime access
    assert.deepEqual(dry.json.sample.map((item) => item.email).sort(), ['de1@example.com', 'de2@example.com', 'us1@example.com'])
    const de1 = dry.json.sample.find((item) => item.id === t.ids.de1)!
    assert.equal(de1.paidUntilAfter, new Date(before! + 5 * DAY).toISOString())
    assert.equal(t.payments.paidUntil(t.ids.de1), before)
    const auditCount = async (action: string) => (await t.call<{ entries: Array<{ action: string; details?: Record<string, unknown> }> }>('GET', '/accounts/me/admin/audit', t.owner)).json.entries.filter((entry) => entry.action === action)
    assert.equal((await auditCount('subscription.bulk-grant')).length, 0)

    const real = await t.call<Result>('POST', '/accounts/me/admin/users/bulk-grant', t.owner, { ids: [t.ids.us1, t.ids.del1, t.ids.str1, t.ids.us1, 'f'.repeat(24)], days: 5, reason: 'компенсация' })
    assert.equal(real.status, 200, JSON.stringify(real.json))
    assert.deepEqual([real.json.affected, real.json.skipped, real.json.dryRun], [1, 3, false])
    assert.equal(t.payments.paidUntil(t.ids.us1), t.now() + 5 * DAY)
    assert.equal(t.payments.paidUntil(t.ids.del1), undefined)
    const history = await t.call<{ grants: Array<{ days: number; reason: string }> }>('GET', `/accounts/me/admin/users/${t.ids.us1}`, t.owner)
    assert.deepEqual(history.json.grants.map((grant) => [grant.days, grant.reason]), [[5, 'компенсация']])

    const filtered = await t.call<Result>('POST', '/accounts/me/admin/users/bulk-grant', t.owner, { filter: { payRegion: 'WORLD', payer: 'no' }, days: 2, reason: 'компенсация' })
    assert.equal(filtered.json.affected, 3)
    const entries = await auditCount('subscription.bulk-grant')
    assert.equal(entries.length, 2)
    assert.deepEqual(entries[0]!.details, { count: 3, days: 2, reason: 'компенсация', filter: { payRegion: 'WORLD', payer: 'no' } })
    assert.deepEqual(entries[1]!.details, { count: 1, days: 5, reason: 'компенсация', ids: 4 })
    assert.equal((await auditCount('subscription.grant')).filter((entry) => entry.details?.reason === 'компенсация').length, 0)

    for (const bad of [
      { ids: [t.ids.us1], filter: {}, days: 1, reason: 'abc' },
      { days: 1, reason: 'abc' },
      { filter: { contry: 'RU' }, days: 1, reason: 'abc' },
      { ids: [t.ids.us1], days: 0, reason: 'abc' },
      { ids: [t.ids.us1], days: 3651, reason: 'abc' },
      { ids: [t.ids.us1], days: 1, reason: 'ab' },
      { ids: ['not-an-id'], days: 1, reason: 'abc' },
    ]) assert.equal((await t.call('POST', '/accounts/me/admin/users/bulk-grant', t.owner, bad)).status, 400, JSON.stringify(bad))
    const tooMany = await t.call<{ code: string; affected: number; max: number }>('POST', '/accounts/me/admin/users/bulk-grant', t.owner, { ids: Array.from({ length: 501 }, () => randomBytes(12).toString('hex')), days: 1, reason: 'abc' })
    assert.equal(tooMany.status, 400)
    assert.deepEqual([tooMany.json.code, tooMany.json.affected, tooMany.json.max], ['too_many', 501, 500])
  } finally { await t.close() }
})

test('bulk grant: a filter matching more than 500 accounts is refused (dryRun shows the count); 30 writes a minute', async () => {
  const t = await setup('2026-10-01T10:00:00.000Z')
  try {
    const insert = t.db.prepare("INSERT INTO accounts (id, email, salt, password_hash, kind, created_at, country) VALUES (?, ?, x'00', x'00', 'user', ?, 'FR')")
    for (let i = 0; i < 501; i++) insert.run(randomBytes(12).toString('hex'), `fr${i}@example.com`, t.now())
    const owner = await t.login('owner@example.com')
    const refused = await t.call<{ code: string; affected: number }>('POST', '/accounts/me/admin/users/bulk-grant', owner, { filter: { country: 'FR' }, days: 1, reason: 'abc' })
    assert.equal(refused.status, 400)
    assert.deepEqual([refused.json.code, refused.json.affected], ['too_many', 501])
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get()!.n, 0)
    const dry = await t.call<{ affected: number; tooMany: boolean; sample: unknown[] }>('POST', '/accounts/me/admin/users/bulk-grant', owner, { filter: { country: 'FR' }, days: 1, reason: 'abc', dryRun: true })
    assert.deepEqual([dry.status, dry.json.affected, dry.json.tooMany, dry.json.sample.length], [200, 501, true, 20])
    // 30 writes a minute: the two above count.
    let status = 0
    let calls = 2
    while (calls < 30) { status = (await t.call('POST', '/accounts/me/admin/users/bulk-grant', owner, { ids: [randomBytes(12).toString('hex')], days: 1, reason: 'abc', dryRun: true })).status; calls++ }
    assert.equal(status, 200)
    const limited = await t.call('POST', '/accounts/me/admin/users/bulk-grant', owner, { ids: [randomBytes(12).toString('hex')], days: 1, reason: 'abc', dryRun: true })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
  } finally { await t.close() }
})

test('payments: provider, method, region and dateField=paid filters; every payment shows its method', async () => {
  const t = await seeded()
  try {
    type List = { payments: Array<{ email: string; method: string; provider: string; status: string }>; total: number; totals: { revenue: number } }
    const list = async (query: string) => {
      const response = await t.call<List>('GET', `/accounts/me/admin/payments?${query}`, t.owner)
      assert.equal(response.status, 200, `${query}: ${JSON.stringify(response.json)}`)
      return response.json
    }
    const settled = (payments: List['payments']) => payments.filter((payment) => payment.status !== 'pending')
    assert.deepEqual((await list('provider=boosty')).payments.map((payment) => [payment.email, payment.method]), [['kz1@example.com', 'boosty']])
    assert.equal(settled((await list('provider=yookassa')).payments).length, 5)
    assert.equal((await list('provider=archive')).total, 0)
    assert.deepEqual((await list('method=bank_card')).payments.map((payment) => payment.email), ['ru2@example.com'])
    assert.equal(settled((await list('method=sbp')).payments).length, 4)
    assert.deepEqual(settled((await list('region=RU')).payments).map((payment) => payment.email).sort(), ['ru1@example.com', 'ru1@example.com', 'ru2@example.com'])
    assert.equal(settled((await list('region=none')).payments).length, 2)
    assert.equal((await list('region=CIS&status=succeeded')).totals.revenue, 250)
    const created = settled((await list('from=2026-09-25&to=2026-10-01')).payments)
    const paid = settled((await list('from=2026-09-25&to=2026-10-01&dateField=paid')).payments)
    assert.equal(created.length, 4)
    assert.equal(paid.length, 5)
    assert.ok(paid.some((payment) => payment.email === 'ru2@example.com'))
    assert.equal((await list('from=2026-09-25&to=2026-10-01&dateField=paid&status=succeeded')).totals.revenue, 1650)
    const csv = await t.call('GET', '/accounts/me/admin/payments.csv?provider=boosty', t.owner)
    assert.equal(csv.text.trim().split('\r\n').length, 2)
    for (const query of ['provider=lava', 'method=SBP!', 'region=EU', 'dateField=updated']) {
      assert.equal((await t.call('GET', `/accounts/me/admin/payments?${query}`, t.owner)).status, 400, query)
    }
  } finally { await t.close() }
})

test('the method column is added to an old payments table: Boosty rows become boosty, older ЮKassa rows read as unknown; repeatable', () => {
  const db = openDatabase(':memory:')
  db.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt BLOB NOT NULL, password_hash BLOB NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('user','streamer')), created_at INTEGER NOT NULL, referral_code TEXT UNIQUE, referred_by TEXT, referred_at INTEGER, nicknames TEXT NOT NULL DEFAULT '{}')")
  db.exec('CREATE TABLE payments (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, provider_id TEXT UNIQUE, plan TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, referral_code TEXT, created_at INTEGER NOT NULL, paid_at INTEGER, provider TEXT)')
  db.prepare("INSERT INTO accounts (id, email, salt, password_hash, kind, created_at) VALUES ('a', 'old@example.com', x'00', x'00', 'user', 1)").run()
  const paidAt = Date.parse('2026-09-30T10:00:00.000Z')
  db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, paid_at, provider) VALUES ('p1', 'a', '1m', 30000, 'succeeded', ?, ?, NULL)").run(paidAt, paidAt)
  db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, paid_at, provider) VALUES ('p2', 'a', '1m', 25000, 'succeeded', ?, ?, 'boosty')").run(paidAt, paidAt)
  let admin: AdminStore | undefined
  for (let i = 0; i < 2; i++) {
    const accounts = new AccountStore({ db, ownerEmails: [], now: () => Date.parse('2026-10-01T10:00:00.000Z') })
    admin = new AdminStore(accounts, new PaymentStore(db, undefined, { log: () => {} }))
  }
  const columns = (db.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string }>).map((row) => row.name)
  assert.ok(columns.includes('method'))
  assert.deepEqual(db.prepare('SELECT id, method FROM payments ORDER BY id').all().map((row) => [row.id, row.method]), [['p1', null], ['p2', 'boosty']])
  assert.deepEqual(admin!.paymentList({}, 10, 0).payments.map((payment) => [payment.id, payment.method]).sort(), [['p1', 'unknown'], ['p2', 'boosty']])
  const stats = admin!.stats('2026-09-30', '2026-09-30')
  assert.deepEqual(stats.revenue.byMethod, { unknown: { count: 1, amount: 300 }, boosty: { count: 1, amount: 250 } })
  assert.deepEqual(stats.revenue.byRegion.none, { count: 2, amount: 550 })
})
