import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { PRESENCE_WINDOW_MS, presenceClientOf, PresenceTracker } from '../services/presence.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const MINUTE = 60 * 1000
const ONLINE = '/v1/accounts/me/admin/online'

/** A server with the owner account and a clock the test moves. */
async function setup() {
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
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) as Record<string, unknown> } catch { /* 204 */ }
    return { status: response.status, json, headers: response.headers }
  }
  const register = async (email: string) => {
    const answer = await call('POST', '/v1/accounts/register', undefined, { email, password, country: 'RU' })
    assert.equal(answer.status, 201, JSON.stringify(answer.json))
    return String(answer.json.token)
  }
  const login = async (email: string) => String((await call('POST', '/v1/accounts/login', undefined, { email, password })).json.token)
  /** The app signs this device in (POST /v1/entitlement registers it with its name, with or without a subscription). */
  const device = async (token: string, id: string, name: string) => {
    const answer = await call('POST', '/v1/entitlement', token, { deviceId: id, deviceName: name })
    assert.ok([200, 402].includes(answer.status), JSON.stringify(answer.json))
    return id
  }
  const beat = (token: string | undefined, deviceId?: string) => call('POST', '/v1/me/presence', token, undefined, deviceId)
  const online = async (owner: string) => {
    const answer = await call('GET', ONLINE, owner)
    assert.equal(answer.status, 200, JSON.stringify(answer.json))
    return answer.json as { online: number; pc: number; phone: number; windowMinutes: number; at: string }
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { call, register, login, device, beat, online, close, advance: (ms: number) => { clock += ms } }
}

const id = (letter: string) => letter.repeat(32)

test('device names: the PC app, the phone app; the browser and the rest do not count', () => {
  assert.equal(presenceClientOf('Windows · DESKTOP-1234 · Raid OS 0.6.0'), 'pc')
  assert.equal(presenceClientOf('macOS · mac · Raid OS 0.6.0'), 'pc')
  assert.equal(presenceClientOf('Linux · box · Raid OS 0.6.0'), 'pc')
  assert.equal(presenceClientOf('Android · Raid OS'), 'phone')
  assert.equal(presenceClientOf('iOS · Raid OS'), 'phone')
  assert.equal(presenceClientOf('Браузер · Raid OS'), undefined)
  assert.equal(presenceClientOf('Устройство'), undefined)
  assert.equal(presenceClientOf('Windowsill'), undefined)
})

test('the tracker counts distinct accounts within the window, PC and phone apart', () => {
  let clock = 0
  const presence = new PresenceTracker({ now: () => clock })
  presence.note('a', 'pc')
  presence.note('a', 'phone')
  presence.note('b', 'pc')
  presence.note('b', 'pc')
  presence.note('c', 'phone')
  assert.deepEqual(presence.count(), { online: 3, pc: 2, phone: 2, windowMinutes: 5, at: new Date(0).toISOString() })
  clock = 3 * MINUTE
  presence.note('c', 'phone')
  clock = PRESENCE_WINDOW_MS - 1
  assert.equal(presence.count().online, 3)
  clock = PRESENCE_WINDOW_MS
  // a and b were last seen 5 minutes ago: gone; c 2 minutes ago.
  assert.deepEqual({ ...presence.count(), at: '' }, { online: 1, pc: 0, phone: 1, windowMinutes: 5, at: '' })
})

test('online now: the apps heartbeat with their device, the owner reads the count; website traffic does not count', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const pcPlayer = await t.register('pc@example.com')
    const phonePlayer = await t.register('phone@example.com')
    const both = await t.register('both@example.com')
    const browser = await t.register('browser@example.com')
    const site = await t.register('site@example.com')
    const pc = await t.device(pcPlayer, id('p'), 'Windows · DESKTOP-1 · Raid OS 0.6.0')
    const phone = await t.device(phonePlayer, id('m'), 'Android · Raid OS')
    const bothPc = await t.device(both, id('b'), 'Windows · DESKTOP-2 · Raid OS 0.6.0')
    // The same account on the phone signs in with its own session: the device is bound to that one.
    const bothPhoneSession = await t.login('both@example.com')
    const bothPhone = await t.device(bothPhoneSession, id('i'), 'iOS · Raid OS')
    const preview = await t.device(browser, id('w'), 'Браузер · Raid OS')

    assert.deepEqual({ ...(await t.online(owner)), at: '' }, { online: 0, pc: 0, phone: 0, windowMinutes: 5, at: '' })

    assert.equal((await t.beat(undefined, pc)).status, 401)
    assert.equal((await t.beat(pcPlayer, pc)).status, 204)
    assert.equal((await t.beat(phonePlayer, phone)).status, 204)
    assert.equal((await t.beat(both, bothPc)).status, 204)
    assert.equal((await t.beat(bothPhoneSession, bothPhone)).status, 204)
    // Not counted, all answered 204: the browser preview, no device (the website), a device of another session or account.
    assert.equal((await t.beat(browser, preview)).status, 204)
    assert.equal((await t.beat(site)).status, 204)
    assert.equal((await t.beat(site, pc)).status, 204)
    assert.equal((await t.beat(both, bothPhone)).status, 204)
    // The website's own requests (the cabinet) count for nothing either.
    assert.equal((await t.call('GET', '/v1/accounts/me', site)).status, 200)

    const counted = await t.online(owner)
    assert.deepEqual({ online: counted.online, pc: counted.pc, phone: counted.phone, windowMinutes: counted.windowMinutes }, { online: 3, pc: 2, phone: 2, windowMinutes: 5 })
    assert.equal(counted.at, '2026-10-14T12:00:00.000Z')

    // Four minutes later only the phone sends again; at five the others drop out.
    t.advance(4 * MINUTE)
    assert.equal((await t.beat(phonePlayer, phone)).status, 204)
    assert.equal((await t.online(owner)).online, 3)
    t.advance(MINUTE)
    const later = await t.online(owner)
    assert.deepEqual([later.online, later.pc, later.phone], [1, 0, 1])
  } finally { await t.close() }
})

test('online now is for the owner only, never cached', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const pc = await t.device(player, id('p'), 'Windows · DESKTOP-1 · Raid OS 0.6.0')
    await t.beat(player, pc)
    assert.equal((await t.call('GET', ONLINE)).status, 401)
    const denied = await t.call('GET', ONLINE, player)
    assert.equal(denied.status, 404)
    assert.equal('online' in denied.json, false)
    const allowed = await t.call('GET', ONLINE, owner)
    assert.equal(allowed.status, 200)
    assert.equal(allowed.json.online, 1)
    assert.equal(allowed.headers.get('cache-control'), 'no-store')
  } finally { await t.close() }
})

test('heartbeats are rate limited per account', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const pc = await t.device(player, id('p'), 'Windows · DESKTOP-1 · Raid OS 0.6.0')
    for (let i = 0; i < 12; i++) assert.equal((await t.beat(player, pc)).status, 204)
    assert.equal((await t.beat(player, pc)).status, 429)
  } finally { await t.close() }
})
