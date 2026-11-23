import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { AdminStore, deviceKindOf, type AccountProfile } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { InviteProgram } from '../services/invites.js'
import { PaymentStore } from '../services/paymentStore.js'
import { PresenceTracker } from '../services/presence.js'
import { ProgressStore } from '../services/progressStore.js'

/**
 * «Посмотреть профиль» (owner, 24.11.2026: «когда зарегистрирован, когда первая оплата, сколько оплат, какие тарифы по
 * месяцам… когда был последний раз… привёл ли он людей, сколько привёл, сколько оплатил… заходил ли в приложение на
 * телефоне»): GET /v1/accounts/me/admin/users/:id/profile, AdminStore.profile.
 */
const password = 'correct horse battery'
const DAY = 24 * 60 * 60 * 1000

/** A fake ЮKassa: a created payment succeeds when `pay` is called. */
function fakeYooKassa() {
  const remote = new Map<string, Record<string, unknown>>()
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      remote.set(id, { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } })
      return new Response(JSON.stringify(remote.get(id)), { status: 200 })
    }
    return new Response(JSON.stringify(remote.get(url.split('/').pop()!)), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, pay: (id: string) => Object.assign(remote.get(id)!, { status: 'succeeded', paid: true }) }
}

/** The stores on one database, the owner registered first; the clock moves. */
async function stores() {
  let clock = Date.parse('2026-09-20T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_x', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  const invites = new InviteProgram(accounts, payments, { now })
  const admin = new AdminStore(accounts, payments, { now })
  const register = async (email: string, code?: string) => accounts.authenticate((await accounts.register(email, password, code)).token)!
  const pay = async (accountId: string, plan: '1m' | '3m' | '6m' | '12m' = '1m') => {
    const discount = invites.discountPercent(accountId)
    const created = await payments.create(accounts.billingInfo(accountId), plan, 'https://raidos.example.com', { version: '2026-10-06' }, undefined, discount ? { percent: discount } : undefined)
    const providerId = new URL(created.confirmationUrl).searchParams.get('orderId')!
    yoo.pay(providerId)
    await payments.sync(providerId)
    return created.paymentId
  }
  return { db, accounts, payments, invites, admin, register, pay, advance: (ms: number) => { clock += ms } }
}

test('the profile: account, the first payment, payments by the owner\'s months and plans, refunds apart', async () => {
  const t = await stores()
  const player = await t.register('player@example.com')
  t.accounts.setNicknames(player, { nickname: 'Kotik_Pro' })
  const empty = t.admin.profile(player)
  assert.equal(empty.account.email, 'player@example.com')
  assert.equal(empty.account.nickname, 'Kotik_Pro')
  assert.equal(empty.account.createdAt, '2026-09-20T10:00:00.000Z')
  assert.equal(empty.account.country, undefined, 'no country was given: nothing made up')
  assert.equal(empty.payments.count, 0)
  assert.equal(empty.payments.first, undefined)
  assert.deepEqual(empty.payments.months, [])
  assert.deepEqual(empty.activity.devices, [])
  assert.deepEqual(empty.activity.phone, { used: false, android: false, ios: false })
  assert.equal(empty.activity.online, undefined, 'no presence passed: nothing said about «now»')

  t.advance(DAY)
  const first = await t.pay(player, '1m')
  t.advance(2 * DAY)
  const refunded = await t.pay(player, '1m')
  t.payments.markRefunded(refunded)
  // 20.10 17:30 UTC is already 21.10 00:30 in Bangkok, still October; 31.10 18:00 UTC is 1 November there.
  t.advance(Date.parse('2026-10-31T18:00:00.000Z') - Date.parse('2026-09-23T10:00:00.000Z'))
  await t.pay(player, '3m')
  t.advance(DAY)
  await t.pay(player, '1m')

  const profile = t.admin.profile(player)
  assert.equal(profile.payments.count, 3)
  // 3 months: 900 less a ninth (paymentStore.ts PLAN_DISCOUNTS).
  assert.equal(profile.payments.total, 1400)
  assert.deepEqual(profile.payments.refunded, { count: 1, total: 300 })
  assert.deepEqual(profile.payments.first, { at: '2026-09-21T10:00:00.000Z', plan: '1m', amount: 300 })
  assert.deepEqual(profile.payments.last, { at: '2026-11-01T18:00:00.000Z', plan: '1m', amount: 300 })
  assert.deepEqual(profile.payments.months, [
    { month: '2026-11', count: 2, revenue: 1100, plans: { '3m': 1, '1m': 1 } },
    { month: '2026-09', count: 1, revenue: 300, plans: { '1m': 1 } },
  ])
  assert.deepEqual(profile.payments.plans['1m'], { count: 2, revenue: 600 })
  assert.deepEqual(profile.payments.plans['3m'], { count: 1, revenue: 800 })
  assert.deepEqual(profile.payments.plans['12m'], { count: 0, revenue: 0 })
  assert.deepEqual(profile.payments.list.map((payment) => payment.status), ['succeeded', 'succeeded', 'refunded', 'succeeded'])
  assert.equal(profile.payments.list.at(-1)!.id, first)
  assert.equal(profile.payments.more, false)
  assert.equal(profile.subscription.status, 'active')
  assert.equal(profile.subscription.source, 'money')
})

test('the profile: friends brought with the player\'s code, who paid and how much, the reward days; who invited the friend', async () => {
  const t = await stores()
  const inviter = await t.register('inviter@example.com')
  const code = t.invites.code(inviter)
  t.advance(DAY)
  const paying = await t.register('paying@example.com', code)
  t.accounts.setNicknames(paying, { nickname: 'Paying_Nick' })
  t.advance(DAY)
  const idle = await t.register('idle@example.com', code)
  t.advance(DAY)
  await t.pay(paying, '1m')
  await t.pay(paying, '1m')

  const profile = t.admin.profile(inviter)
  assert.equal(profile.referrals.inviteCode, code)
  assert.equal(profile.referrals.invited, 2)
  assert.equal(profile.referrals.paid, 1)
  // The friend's discount on the first month: 300 − 20 % + 300.
  assert.equal(profile.referrals.revenue, 540)
  assert.deepEqual(profile.referrals.friends.map((friend) => [friend.email, friend.payments, friend.amount]), [['idle@example.com', 0, 0], ['paying@example.com', 2, 540]])
  const friend = profile.referrals.friends.find((item) => item.id === paying)!
  assert.equal(friend.nickname, 'Paying_Nick')
  assert.equal(friend.firstPlan, '1m')
  assert.equal(friend.firstPaidAt, '2026-09-23T10:00:00.000Z')
  assert.equal(profile.referrals.rewards.pending + profile.referrals.rewards.review + profile.referrals.rewards.granted, 1, 'one reward for the discounted first month')
  assert.equal(profile.referrals.streamer, undefined)

  const invited = t.admin.profile(idle)
  assert.equal(invited.origin.invitedBy?.email, 'inviter@example.com')
  assert.equal(invited.origin.invitedBy?.discount, 'unused')
  assert.equal(invited.referrals.invited, 0)
})

test('the profile of a deleted account keeps its payments and dates, never its e-mail or nickname', async () => {
  const t = await stores()
  const player = await t.register('gone@example.com')
  t.accounts.setNicknames(player, { nickname: 'Gone_Nick' })
  await t.pay(player, '1m')
  t.accounts.deleteAccount(player)
  const profile = t.admin.profile(player)
  assert.equal(profile.account.deleted, true)
  assert.equal(profile.account.email, undefined)
  assert.equal(profile.account.nickname, undefined)
  assert.equal(profile.payments.count, 1)
  assert.equal(JSON.stringify(profile).includes('gone@example.com'), false)
  assert.equal(JSON.stringify(profile).includes('Gone_Nick'), false)
  assert.throws(() => t.admin.profile('0123456789abcdef01234567'), /Пользователь не найден/)
})

test('device names tell the PC app, the phone app on each system and the browser build apart', () => {
  assert.equal(deviceKindOf('Windows · DESKTOP-1234 · Raid OS 0.6.0'), 'pc')
  assert.equal(deviceKindOf('macOS · mac · Raid OS 0.6.0'), 'pc')
  assert.equal(deviceKindOf('Android · Raid OS'), 'android')
  assert.equal(deviceKindOf('iOS · Raid OS'), 'ios')
  assert.equal(deviceKindOf('Браузер · Raid OS'), 'browser')
  assert.equal(deviceKindOf('Устройство'), 'other')
})

test('presence of one account: the PC app and the phone app within the window, nothing after it', () => {
  let clock = 0
  const presence = new PresenceTracker({ now: () => clock })
  assert.deepEqual(presence.of('a'), { pc: false, phone: false, windowMinutes: 5 })
  presence.note('a', 'pc')
  presence.note('a', 'phone', 'android')
  assert.deepEqual(presence.of('a'), { pc: true, phone: true, platform: 'android', windowMinutes: 5 })
  assert.deepEqual(presence.of('b'), { pc: false, phone: false, windowMinutes: 5 })
  clock += 5 * 60 * 1000
  assert.deepEqual(presence.of('a'), { pc: false, phone: false, windowMinutes: 5 })
})

/** The API with the owner account; devices sign in through POST /v1/entitlement, the heartbeat through /v1/me/presence. */
async function api() {
  let clock = Date.parse('2026-10-14T12:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined, { now })
  accounts.attachSubscriptions(payments)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, token?: string, body?: unknown, device?: string) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(device ? { 'x-raid-device': device } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json: unknown = {}
    try { json = JSON.parse(text) } catch { /* 204 */ }
    return { status: response.status, json, text, headers: response.headers }
  }
  const register = async (email: string) => String(((await call('POST', '/v1/accounts/register', undefined, { email, password, country: 'RU' })).json as { token: string }).token)
  const login = async (email: string) => String(((await call('POST', '/v1/accounts/login', undefined, { email, password })).json as { token: string }).token)
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { accounts, call, register, login, close, advance: (ms: number) => { clock += ms } }
}

test('GET /me/admin/users/:id/profile: 401 without a session, 404 for a player (even about himself), the owner only', async () => {
  const t = await api()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    const id = t.accounts.accountByEmail('player@example.com')!.id
    const path = `/v1/accounts/me/admin/users/${id}/profile`
    assert.equal((await t.call('GET', path)).status, 401)
    const denied = await t.call('GET', path, player)
    assert.equal(denied.status, 404)
    assert.equal(denied.text.includes('player@example.com'), false)
    const answer = await t.call('GET', path, owner)
    assert.equal(answer.status, 200, answer.text)
    assert.equal(answer.headers.get('cache-control'), 'no-store')
    assert.equal((answer.json as AccountProfile).account.email, 'player@example.com')
    assert.equal((await t.call('GET', '/v1/accounts/me/admin/users/0123456789abcdef01234567/profile', owner)).status, 404)
    assert.equal((await t.call('GET', '/v1/accounts/me/admin/users/not-an-id/profile', owner)).status, 400)
    // Never the secrets of the account.
    for (const secret of ['password', 'salt', 'hash', player]) assert.equal(answer.text.includes(secret), false, secret)
  } finally { await t.close() }
})

test('the profile tells the PC and the phone apart, when each was used last, and who is in an app right now', async () => {
  const t = await api()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    const id = t.accounts.accountByEmail('player@example.com')!.id
    const profile = async () => (await t.call('GET', `/v1/accounts/me/admin/users/${id}/profile`, owner)).json as AccountProfile
    const before = await profile()
    assert.deepEqual(before.activity.phone, { used: false, android: false, ios: false })
    assert.equal(before.activity.pcSeenAt, undefined)
    assert.deepEqual(before.activity.online, { pc: false, phone: false, windowMinutes: 5 })

    t.advance(60 * 60 * 1000)
    const pc = 'pc-0001-abcdefghijklmnopqrstu'
    assert.ok([200, 402].includes((await t.call('POST', '/v1/entitlement', player, { deviceId: pc, deviceName: 'Windows · DESKTOP-1 · Raid OS 0.6.0' })).status))
    t.advance(DAY)
    assert.ok([200, 402].includes((await t.call('POST', '/v1/entitlement', player, { deviceId: 'phone-01-abcdefghijklmnopqrstu', deviceName: 'Android · Raid OS' })).status))
    t.advance(60 * 60 * 1000)
    assert.equal((await t.call('POST', '/v1/me/presence', player, undefined, pc)).status, 204)

    const after = await profile()
    assert.deepEqual(after.activity.phone, { used: true, android: true, ios: false })
    assert.equal(after.activity.pcSeenAt, '2026-10-14T13:00:00.000Z')
    assert.equal(after.activity.phoneSeenAt, '2026-10-15T13:00:00.000Z')
    assert.equal(after.activity.firstAppAt, '2026-10-14T13:00:00.000Z')
    assert.deepEqual(after.activity.devices.map((device) => [device.kind, device.name, device.active]), [['android', 'Android · Raid OS', true], ['pc', 'Windows · DESKTOP-1 · Raid OS 0.6.0', true]])
    assert.deepEqual(after.activity.online, { pc: true, phone: false, windowMinutes: 5 })
    // The device ids stay on the server: the card shows names and times only.
    const text = JSON.stringify(after)
    assert.equal(text.includes(pc), false)
    assert.equal(text.includes('phone-01-'), false)
  } finally { await t.close() }
})
