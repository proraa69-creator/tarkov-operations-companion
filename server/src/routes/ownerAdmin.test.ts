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
  const register = async (email: string, referralCode?: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: 'RU', ...(referralCode ? { referralCode } : {}) })).json.token
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

const ADMIN_GETS = ['/accounts/me/admin/overview', '/accounts/me/admin/online?days=30', '/accounts/me/admin/series?period=month', '/accounts/me/admin/payments', '/accounts/me/admin/payments.csv', '/accounts/me/admin/users', '/accounts/me/admin/streamer-settings', '/accounts/me/admin/sales-settings', '/accounts/me/admin/audit']

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
    // Nothing changed for the player: no paid days, only the free day (it waits for the first sign-in in the app).
    const me = (await t.call('GET', '/accounts/me', player)).json as unknown as { subscription: { status: string; paidUntil?: string; trialPendingDays?: number } }
    assert.deepEqual(me.subscription, { status: 'inactive', trialPendingDays: 1 })
  } finally { await t.close() }
})

test('online statistics: current users and daily minimum, maximum, average and unique count', async () => {
  const t = await setup()
  try {
    const a = await t.register('online-a@example.com')
    const b = await t.register('online-b@example.com')
    await t.call('GET', '/accounts/me', a)
    await t.call('GET', '/accounts/me', b)
    const owner = await t.login('owner@example.com')
    type Online = { current: number; today: { users: number; minimum: number; maximum: number; average: number; samples: number }; history: Array<{ date: string }> }
    const first = (await t.call<Online>('GET', '/accounts/me/admin/online?days=30', owner)).json
    assert.deepEqual([first.current, first.today.users, first.today.minimum, first.today.maximum, first.today.average, first.today.samples], [3, 3, 3, 3, 3, 1])
    t.advance(11 * 60 * 1000)
    const second = (await t.call<Online>('GET', '/accounts/me/admin/online?days=30', owner)).json
    assert.deepEqual([second.current, second.today.users, second.today.minimum, second.today.maximum, second.today.average, second.today.samples], [1, 3, 1, 3, 2, 2])
    assert.deepEqual(second.history.map((row) => row.date), ['2026-10-01'])
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

test('users list: «Вход с ПК» is the last use of the PC app, not of the site or the phone', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    const row = async () => ((await t.call('GET', '/accounts/me/admin/users?q=player', owner)).json as unknown as { users: Array<{ lastSeenAt?: string; pcSeenAt?: string }> }).users[0]!
    const signedUp = await row()
    assert.ok(signedUp.lastSeenAt, 'the site sign-in is activity')
    assert.equal(signedUp.pcSeenAt, undefined, 'but not a PC sign-in')

    // The phone build registers its device too: still no PC sign-in.
    t.advance(60 * 60 * 1000)
    assert.equal((await t.call('POST', '/entitlement', player, { deviceId: 'phone-01-abcdefghijklmnopqrstu', deviceName: 'Android · Raid OS' })).status, 200)
    assert.equal((await row()).pcSeenAt, undefined)

    t.advance(60 * 60 * 1000)
    const pcAt = new Date(Date.parse('2026-10-01T12:00:00.000Z')).toISOString()
    assert.equal((await t.call('POST', '/entitlement', player, { deviceId: 'pc-0001-abcdefghijklmnopqrstu', deviceName: 'Windows · DESKTOP-1 · Raid OS 0.6.0' })).status, 200)
    assert.equal((await row()).pcSeenAt, pcAt)

    // Later the site is used again: the PC time stays, the activity moves on. The next app start moves the PC time — also
    // after the free day is over (402: no subscription, the device is still registered).
    t.advance(DAY)
    assert.equal((await t.call('GET', '/accounts/me', player)).status, 200)
    const after = await row()
    assert.equal(after.pcSeenAt, pcAt)
    assert.equal(after.lastSeenAt, '2026-10-02T12:00:00.000Z')
    assert.equal((await t.call('POST', '/entitlement', player, { deviceId: 'pc-0001-abcdefghijklmnopqrstu', deviceName: 'Windows · DESKTOP-1 · Raid OS 0.6.0' })).status, 402)
    assert.equal((await row()).pcSeenAt, '2026-10-02T12:00:00.000Z')
    const id = ((await t.call('GET', '/accounts/me/admin/users?q=player', owner)).json as unknown as { users: Array<{ id: string }> }).users[0]!.id
    assert.equal(((await t.call('GET', `/accounts/me/admin/users/${id}`, owner)).json as unknown as { user: { pcSeenAt?: string } }).user.pcSeenAt, '2026-10-02T12:00:00.000Z')
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

test('«Отвязать аккаунт Escape from Tarkov»: shown masked in the user, freed by the owner, logged (owner, 13.10.2026)', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    assert.equal((await t.call('POST', '/accounts/me/eft-account', player, { accountId: '7654321' })).status, 200)
    const users = ((await t.call('GET', '/accounts/me/admin/users', owner)).json as unknown as { users: Array<{ id: string; email: string; eftAccount?: { masked: string } }> }).users
    const listed = users.find((user) => user.email === 'player@example.com')!
    assert.equal(listed.eftAccount?.masked, '••••321')
    assert.equal(users.find((user) => user.email === 'owner@example.com')!.eftAccount, undefined)
    // Nobody but the owner.
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${listed.id}/eft-account/unbind`, player)).status, 404)
    const freed = await t.call('POST', `/accounts/me/admin/users/${listed.id}/eft-account/unbind`, owner)
    assert.equal(freed.status, 200)
    assert.equal((freed.json as unknown as { user: { eftAccount?: unknown } }).user.eftAccount, undefined)
    // The game account is free: another account can take it.
    const other = await t.register('other@example.com')
    assert.equal((await t.call('POST', '/accounts/me/eft-account', other, { accountId: '7654321' })).status, 200)
    const actions = ((await t.call('GET', '/accounts/me/admin/audit', owner)).json as unknown as { entries: Array<{ action: string; target?: string }> }).entries
    assert.deepEqual(actions.map((entry) => [entry.action, entry.target]), [['eft.unbind', 'player@example.com']])
  } finally { await t.close() }
})

test('users by region: «Все · Россия · СНГ · Мир · Не указана» with counts, the country in rows and the card', async () => {
  const t = await setup()
  try {
    for (const [email, country] of [['moscow@example.com', 'RU'], ['almaty@example.com', 'KZ'], ['kyiv@example.com', 'UA'], ['berlin@example.com', 'DE'], ['tbilisi@example.com', 'GE']] as const) {
      const registered = await t.call('POST', '/accounts/register', undefined, { email, password, country })
      assert.equal(registered.status, 201, JSON.stringify(registered.json))
    }
    // An account from before the country became mandatory (14.10.2026): an older app registered it without one.
    await t.accounts.register('old-app@example.com', password)
    const owner = await t.login('owner@example.com')
    type List = { users: Array<{ id: string; email: string; country?: string }>; total: number; regions: Record<string, number> }
    const list = async (query = '') => {
      const response = await t.call<List>('GET', `/accounts/me/admin/users${query}`, owner)
      assert.equal(response.status, 200, JSON.stringify(response.json))
      return response.json
    }
    const emails = (body: List) => body.users.map((user) => user.email).sort()
    const all = await list()
    // The owner registered before the question: with the older app's account under «Не указана». Georgia is not Europe.
    assert.deepEqual(all.regions, { all: 7, russia: 1, cis: 1, world: 3, europe: 2, other: 1, none: 2 })
    assert.equal(all.total, 7)
    assert.equal(all.users.find((user) => user.email === 'almaty@example.com')!.country, 'KZ')
    assert.equal(all.users.find((user) => user.email === 'old-app@example.com')!.country, undefined)
    const cis = await list('?region=cis')
    assert.deepEqual([emails(cis), cis.total], [['almaty@example.com'], 1])
    assert.deepEqual(cis.regions, all.regions, 'the counts do not follow the chosen tab')
    assert.deepEqual(emails(await list('?region=russia')), ['moscow@example.com'])
    assert.deepEqual(emails(await list('?region=world')), ['berlin@example.com', 'kyiv@example.com', 'tbilisi@example.com'])
    assert.deepEqual(emails(await list('?region=europe')), ['berlin@example.com', 'kyiv@example.com'])
    assert.deepEqual(emails(await list('?region=other')), ['tbilisi@example.com'])
    assert.deepEqual(emails(await list('?region=none')), ['old-app@example.com', 'owner@example.com'])
    // The search and the status filter narrow the counts and combine with the region.
    assert.deepEqual((await list('?q=kyiv')).regions, { all: 1, russia: 0, cis: 0, world: 1, europe: 1, other: 0, none: 0 })
    assert.deepEqual(emails(await list('?q=example&region=europe&filter=trial')), [])
    assert.deepEqual((await list('?filter=streamers')).regions, { all: 0, russia: 0, cis: 0, world: 0, europe: 0, other: 0, none: 0 })
    assert.equal((await t.call('GET', '/accounts/me/admin/users?region=asia', owner)).status, 400)
    // A player from before the question sets it in the cabinet: he moves from «Не указана» to his region.
    const late = await t.login('old-app@example.com')
    assert.equal((await t.call('PUT', '/accounts/me/country', late, { country: 'AM' })).status, 200)
    assert.deepEqual((await list()).regions, { all: 7, russia: 1, cis: 2, world: 3, europe: 2, other: 1, none: 1 })
    // The user card has the country too.
    const kyiv = all.users.find((user) => user.email === 'kyiv@example.com')!.id
    assert.equal((await t.call<{ user: { country?: string } }>('GET', `/accounts/me/admin/users/${kyiv}`, owner)).json.user.country, 'UA')
  } finally { await t.close() }
})

test('users show the Escape from Tarkov nickname the PC app found, and the search finds it (owner, 13.10.2026)', async () => {
  const t = await setup()
  try {
    const found = await t.register('found@example.com')
    await t.register('waiting@example.com')
    const broken = await t.register('broken@example.com')
    // What the PC app sends once it read the nickname in the game logs.
    assert.equal((await t.call('PUT', '/accounts/me/nicknames', found, { nickname: 'Shaurma_1' })).status, 200)
    assert.equal((await t.call('PUT', '/accounts/me/nicknames', broken, { nickname: 'Broken_1' })).status, 200)
    t.db.prepare("UPDATE accounts SET nicknames = '{not json' WHERE email = 'broken@example.com'").run()
    const owner = await t.login('owner@example.com')
    type List = { users: Array<{ id: string; email: string; nickname?: string }>; total: number }
    const list = async (query = '') => {
      const response = await t.call<List>('GET', `/accounts/me/admin/users${query}`, owner)
      assert.equal(response.status, 200, JSON.stringify(response.json))
      return response.json
    }
    const all = await list()
    const nick = (email: string) => all.users.find((user) => user.email === email)!.nickname
    assert.equal(nick('found@example.com'), 'Shaurma_1')
    assert.equal(nick('waiting@example.com'), undefined)
    assert.equal(nick('broken@example.com'), undefined, 'a broken value reads as «not found», the list still loads')
    // The search takes the e-mail or the nickname, in any letter case; the JSON keys (pvp, pve…) are not a match.
    assert.deepEqual((await list('?q=shaurma')).users.map((user) => user.email), ['found@example.com'])
    assert.deepEqual((await list('?q=waiting')).users.map((user) => user.email), ['waiting@example.com'])
    assert.equal((await list('?q=pvp')).total, 0)
    assert.equal((await list('?q=broken_1')).total, 0)
    // The user card has it as well.
    const id = all.users.find((user) => user.email === 'found@example.com')!.id
    assert.equal((await t.call<{ user: { nickname?: string } }>('GET', `/accounts/me/admin/users/${id}`, owner)).json.user.nickname, 'Shaurma_1')
  } finally { await t.close() }
})

test('«Удалить аккаунт» from the admin panel: owner only, erased like the user\'s own deletion, logged; not the owner, not with an active autopay (owner, 13.10.2026)', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    const users = () => t.call<{ users: Array<{ id: string; email: string }> }>('GET', '/accounts/me/admin/users', owner)
    const list = (await users()).json.users
    const id = list.find((user) => user.email === 'player@example.com')!.id
    const ownerId = list.find((user) => user.email === 'owner@example.com')!.id
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id}/delete`, player)).status, 404, 'nobody but the owner')
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${ownerId}/delete`, owner)).status, 409)

    // An active autopayment has to be cancelled first (the provider is told by «Отменить автопродление»).
    const other = await t.register('payer@example.com')
    const payerId = (await users()).json.users.find((user) => user.email === 'payer@example.com')!.id
    t.db.prepare("INSERT INTO recurring_subscriptions (id, account_id, provider, plan, amount, currency, status, consent_version, consent_at, created_at) VALUES ('r1', ?, 'yookassa', '1m', 300, 'RUB', 'active', '2026-10-13.2', 0, 0)").run(payerId)
    const refused = await t.call<{ error: string }>('POST', `/accounts/me/admin/users/${payerId}/delete`, owner)
    assert.equal(refused.status, 409)
    assert.match(refused.json.error, /Отменить автопродление/)
    assert.equal((await t.call('GET', '/accounts/me', other)).status, 200)

    const deleted = await t.call('POST', `/accounts/me/admin/users/${id}/delete`, owner)
    assert.equal(deleted.status, 200)
    assert.deepEqual(deleted.json, { deleted: true })
    assert.equal((await t.call('GET', '/accounts/me', player)).status, 401, 'signed out everywhere')
    assert.equal((await users()).json.users.some((user) => user.email === 'player@example.com'), false)
    // The e-mail is free again, and the journal names the deleted account.
    assert.equal((await t.call('POST', '/accounts/register', undefined, { email: 'player@example.com', password: 'correct horse battery staple', country: 'RU' })).status, 201)
    const entries = (await t.call<{ entries: Array<{ action: string; target?: string }> }>('GET', '/accounts/me/admin/audit', owner)).json.entries
    assert.deepEqual(entries.map((entry) => [entry.action, entry.target]), [['account.delete', 'player@example.com']])
  } finally { await t.close() }
})

test('statistics: users, revenue by plan per day / month, payouts, filters and CSV', async () => {
  const t = await setup()
  try {
    // A streamer and two referred players; one pays 1 month, the other 12 months the next day; one more payment by SQL.
    await t.register('streamer@example.com')
    t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
    const a = await t.register('a@example.com', 'HUNTER')
    await t.pay(a, '1m')
    t.advance(DAY)
    const b = await t.register('b@example.com', 'HUNTER')
    await t.pay(b, '12m')
    const bId = t.accounts.authenticate(b)!
    t.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, paid_at, provider, currency, amount_original) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaa', ?, '3m', 90000, 'succeeded', ?, ?, 'yookassa', 'RUB', 90000)").run(bId, Date.parse('2026-10-02T11:00:00.000Z'), Date.parse('2026-10-02T11:00:00.000Z'))
    t.db.prepare("INSERT INTO payments (id, account_id, plan, amount, status, created_at, provider, currency) VALUES ('bbbbbbbbbbbbbbbbbbbbbbbb', ?, '6m', 180000, 'canceled', ?, 'yookassa', 'RUB')").run(bId, Date.parse('2026-10-02T11:30:00.000Z'))
    const owner = await t.login('owner@example.com')

    const overview = (await t.call('GET', '/accounts/me/admin/overview', owner)).json as unknown as {
      users: { total: number; today: number; days7: number }; subscriptions: { active: number; trials: number; streamers: number }
      revenue: { today: { total: number; payments: number }; month: { total: number }; all: { total: number; payments: number } }
      payouts: { earned: number }
    }
    assert.deepEqual([overview.users.total, overview.users.today, overview.users.days7], [4, 1, 4])
    assert.equal(overview.subscriptions.active, 2)
    assert.equal(overview.subscriptions.streamers, 1)
    // 12 months: 2400 ₽ today + 900 ₽ (the 3 months inserted by SQL).
    assert.deepEqual(overview.revenue.today, { total: 3300, payments: 2 })
    assert.equal(overview.revenue.all.total, 3600)
    assert.equal(overview.revenue.all.payments, 3)
    // 10 % of the two referred payments (the SQL row was inserted without a referral code); no streamer discount.
    assert.equal(overview.payouts.earned, 270)

    const days = (await t.call('GET', '/accounts/me/admin/series?period=day', owner)).json as unknown as { rows: Array<{ period: string; registrations: number; payments: number; revenue: number; plans: Record<string, { count: number; revenue: number }> }> }
    assert.equal(days.rows.length, 31)
    const [today, yesterday] = days.rows
    assert.equal(today!.period, '2026-10-02')
    assert.deepEqual([today!.registrations, today!.payments, today!.revenue], [1, 2, 3300])
    assert.deepEqual(today!.plans['12m'], { count: 1, revenue: 2400 })
    assert.deepEqual(today!.plans['3m'], { count: 1, revenue: 900 })
    assert.deepEqual([yesterday!.period, yesterday!.registrations, yesterday!.payments, yesterday!.revenue], ['2026-10-01', 3, 1, 300])
    const months = (await t.call('GET', '/accounts/me/admin/series?period=month', owner)).json as unknown as { rows: Array<{ period: string; payments: number; revenue: number }> }
    assert.equal(months.rows.length, 12)
    assert.deepEqual([months.rows[0]!.period, months.rows[0]!.payments, months.rows[0]!.revenue], ['2026-10', 3, 3600])
    const years = (await t.call('GET', '/accounts/me/admin/series?period=year', owner)).json as unknown as { rows: Array<{ period: string; registrations: number }> }
    assert.deepEqual(years.rows.map((row) => [row.period, row.registrations]), [['2026', 4]])
    assert.equal((await t.call('GET', '/accounts/me/admin/series?period=week', owner)).status, 400)

    // Payments: filters and totals.
    const all = (await t.call('GET', '/accounts/me/admin/payments', owner)).json as unknown as { total: number; totals: { succeeded: number; revenue: number; streamerEarnings: number } }
    assert.deepEqual([all.total, all.totals.succeeded, all.totals.revenue, all.totals.streamerEarnings], [4, 3, 3600, 270])
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
    assert.ok(lines.some((line) => line.includes('b@example.com;12m;ЮKassa;Оплачен;2400,00')), lines.join('\n'))
    assert.ok(lines.some((line) => line.includes('b@example.com;3m;ЮKassa;Оплачен;900,00;;;')), lines.join('\n'))
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
    // A streamer's code gives no discount (owner, 09.10.2026): 10 % of 300 ₽.
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
    const third = await t.call('POST', '/accounts/register', undefined, { email: 'third@example.com', password, country: 'RU', referralCode: 'HUNTER' })
    assert.equal((third.json as unknown as { referralApplied: boolean }).referralApplied, false)
    await t.call('PUT', '/accounts/me/admin/streamers/HUNTER/link', owner, { enabled: true })
    const fourth = await t.call('POST', '/accounts/register', undefined, { email: 'fourth@example.com', password, country: 'RU', referralCode: 'HUNTER' })
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

    const me = (await t.call('GET', '/accounts/me', streamer)).json as unknown as { kind: string; referralCode?: string; subscription: { status: string; lifetime?: true } }
    assert.equal(me.kind, 'user')
    assert.equal(me.referralCode, undefined)
    // An ordinary account again: no lifetime access, only its free day (never signed in to the app: still waiting).
    assert.deepEqual(me.subscription, { status: 'inactive', trialPendingDays: 1 })
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
    assert.deepEqual(body.plans.map((plan) => plan.price), [300, 810, 1500, 2400])
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
  for (const name of ['blocked_at', 'last_seen_at', 'referral_disabled_at', 'country']) assert.ok(columns.includes(name), name)
  const old = db.prepare('SELECT email, blocked_at, country FROM accounts').get() as { email: string; blocked_at: null; country: null }
  assert.equal(old.blocked_at, null)
  assert.equal(old.country, null)
  assert.throws(() => new AdminStore(new AccountStore({ db, ownerEmails: [] }), new PaymentStore(openDatabase(':memory:'), undefined)), /share one database/)
})

test('«Удалить аккаунт»: password required, personal data erased, payments kept, the e-mail is free again', async () => {
  const t = await setup()
  try {
    await t.register('streamer@example.com')
    t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
    const player = await t.register('player@example.com', 'HUNTER')
    await t.pay(player, '1m')
    const owner = await t.login('owner@example.com')
    const id = t.accounts.accountByEmail('player@example.com')!.id

    assert.equal((await t.call('POST', '/accounts/me/delete', undefined, { password })).status, 401)
    assert.equal((await t.call('POST', '/accounts/me/delete', player, {})).status, 400)
    assert.equal((await t.call('POST', '/accounts/me/delete', player, { password: 'wrong password' })).status, 403)
    assert.equal((await t.call('POST', '/accounts/me/delete', owner, { password })).status, 409)

    assert.equal((await t.call('POST', '/accounts/me/delete', player, { password })).status, 200)
    assert.equal((await t.call('GET', '/accounts/me', player)).status, 401)
    assert.equal((await t.call('POST', '/accounts/login', undefined, { email: 'player@example.com', password })).status, 401)
    const row = t.db.prepare('SELECT email, phone, nicknames, deleted_at FROM accounts WHERE id = ?').get(id) as Record<string, unknown>
    assert.equal(row.email, `deleted-${id}@deleted.invalid`)
    assert.equal(row.phone, null)
    assert.notEqual(row.deleted_at, null)
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?').get(id) as { n: number }).n, 0)
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE account_id = ?').get(id) as { n: number }).n, 0)
    // The payment and the streamer's earning stay for accounting.
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM payments WHERE account_id = ?').get(id) as { n: number }).n, 1)
    assert.equal(t.payments.streamerEarned('HUNTER'), 3000)
    // Gone from the owner's user list; the address can register again.
    const users = (await t.call('GET', '/accounts/me/admin/users', owner)).json as unknown as { users: Array<{ email: string }> }
    assert.ok(!users.users.some((user) => user.email.includes('player') || user.email.startsWith('deleted-')))
    assert.equal(typeof (await t.register('player@example.com')), 'string')
  } finally { await t.close() }
})

test('calendar: every day of the month with revenue; a day opens with registrations, payments and grants', async () => {
  const t = await setup()
  try {
    await t.register('streamer@example.com')
    t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
    const a = await t.register('a@example.com', 'HUNTER')
    await t.pay(a, '1m')
    t.advance(DAY)
    const b = await t.register('b@example.com')
    await t.pay(b, '12m')
    const owner = await t.login('owner@example.com')
    const bId = t.accounts.authenticate(b)!
    await t.call('POST', `/accounts/me/admin/users/${bId}/grant`, owner, { days: 5, reason: 'компенсация' })

    const calendar = (await t.call('GET', '/accounts/me/admin/calendar?month=2026-10', owner)).json as unknown as { month: string; today: string; days: Array<{ date: string; registrations: number; payments: number; revenue: number; plans: Record<string, { count: number }> }> }
    assert.equal(calendar.days.length, 31)
    assert.equal(calendar.today, '2026-10-02')
    const byDate = Object.fromEntries(calendar.days.map((day) => [day.date, day]))
    assert.deepEqual([byDate['2026-10-01']!.registrations, byDate['2026-10-01']!.payments, byDate['2026-10-01']!.revenue], [3, 1, 300])
    assert.deepEqual([byDate['2026-10-02']!.registrations, byDate['2026-10-02']!.payments, byDate['2026-10-02']!.revenue, byDate['2026-10-02']!.plans['12m']!.count], [1, 1, 2400, 1])
    assert.equal(byDate['2026-10-31']!.payments, 0)
    assert.equal(((await t.call('GET', '/accounts/me/admin/calendar?month=2026-02', owner)).json as unknown as { days: unknown[] }).days.length, 28)
    assert.equal((await t.call('GET', '/accounts/me/admin/calendar?month=2026-13', owner)).status, 400)

    const day = (await t.call('GET', '/accounts/me/admin/day?date=2026-10-02', owner)).json as unknown as {
      totals: { registrations: number; payments: number; revenue: number }
      registrations: Array<{ email: string; referredBy?: string }>
      payments: Array<{ email: string; plan: string; status: string; amount: number }>
      grants: Array<{ email: string; days: number; reason: string }>
    }
    assert.deepEqual([day.totals.registrations, day.totals.payments, day.totals.revenue], [1, 1, 2400])
    assert.deepEqual(day.registrations.map((item) => item.email), ['b@example.com'])
    assert.deepEqual(day.payments.map((item) => [item.email, item.plan, item.status, item.amount]), [['b@example.com', '12m', 'succeeded', 2400]])
    assert.deepEqual(day.grants.map((item) => [item.email, item.days, item.reason]), [['b@example.com', 5, 'компенсация']])
    const first = (await t.call('GET', '/accounts/me/admin/day?date=2026-10-01', owner)).json as unknown as { registrations: Array<{ email: string; referredBy?: string }> }
    assert.deepEqual(first.registrations.find((item) => item.email === 'a@example.com')?.referredBy, 'HUNTER')
    assert.equal((await t.call('GET', '/accounts/me/admin/day?date=2026-10-02', await t.login('a@example.com'))).status, 404)
    assert.equal((await t.call('GET', '/accounts/me/admin/day?date=nope', owner)).status, 400)
  } finally { await t.close() }
})
