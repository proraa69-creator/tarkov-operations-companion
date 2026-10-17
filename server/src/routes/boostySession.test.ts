import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { BoostyPayments } from '../services/boosty.js'
import { BoostyClient, BoostyTokenStore, boostySessionFrom, type BoostyCredentials } from '../services/boostyClient.js'
import { BoostySync } from '../services/boostySync.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

/** «Токен Boosty» in the owner's panel (owner, 17.10.2026): a pasted session starts the issuance, nothing is echoed. */
const password = 'correct horse battery'
const ACCESS = 'acc-SECRET-0123456789abcdefghijklmnop'
const REFRESH = 'ref-SECRET-0123456789abcdefghijklmnop'
const DEVICE = 'dev0123456789abcdef'
const AUTH = JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: Date.parse('2026-12-01T00:00:00Z') })

test('the bookmark\'s JSON, the two values apart, the quoted device id; anything else is no session', () => {
  assert.deepEqual(boostySessionFrom({ session: JSON.stringify({ auth: AUTH, clientId: `"${DEVICE}"` }) }, 'raidosapp'), { auth: AUTH, clientId: DEVICE, blog: 'raidosapp' })
  assert.deepEqual(boostySessionFrom({ auth: AUTH, clientId: DEVICE }, 'raidosapp'), { auth: AUTH, clientId: DEVICE, blog: 'raidosapp' })
  assert.equal(boostySessionFrom({ session: '{"auth":"nope","clientId":"dev0123456789"}' }, 'raidosapp'), undefined)
  assert.equal(boostySessionFrom({ session: 'not json' }, 'raidosapp'), undefined)
  assert.equal(boostySessionFrom({ auth: AUTH, clientId: 'bad id with spaces' }, 'raidosapp'), undefined)
})

test('PUT /me/admin/boosty/session: owner only, starts the issuance on a server without one, never echoes the session', async () => {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const boosty = new BoostyPayments(accounts, payments)
  const saved: BoostyCredentials[] = []
  const fakeFetch = (async () => new Response(JSON.stringify({ data: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
  const boostySession = {
    blog: 'raidosapp',
    save: (credentials: BoostyCredentials) => { saved.push(credentials) },
    connect: (credentials: BoostyCredentials) => new BoostySync(boosty, new BoostyClient(credentials, new BoostyTokenStore(undefined), { fetch: fakeFetch, pageDelayMs: 0 }), { periodMs: 5 * 60_000 }),
  }
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, boosty, boostySession, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, text: await response.text() }
  }
  try {
    const owner = JSON.parse((await call('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).text).token as string
    const player = JSON.parse((await call('POST', '/accounts/register', undefined, { email: 'p@example.com', password, country: 'KZ' })).text).token as string
    assert.equal(JSON.parse((await call('GET', '/accounts/me/admin/boosty', owner)).text).sync.configured, false)
    assert.equal((await call('PUT', '/accounts/me/admin/boosty/session', player, { session: JSON.stringify({ auth: AUTH, clientId: DEVICE }) })).status, 404)
    assert.equal((await call('PUT', '/accounts/me/admin/boosty/session', owner, { session: '{"auth":"x"}' })).status, 400)
    assert.equal(saved.length, 0)
    const done = await call('PUT', '/accounts/me/admin/boosty/session', owner, { session: JSON.stringify({ auth: AUTH, clientId: DEVICE }) })
    assert.equal(done.status, 200, done.text)
    assert.equal(JSON.parse(done.text).sync.configured, true)
    for (const secret of [ACCESS, REFRESH, DEVICE]) assert.ok(!done.text.includes(secret), 'the session was echoed')
    assert.deepEqual(saved, [{ auth: AUTH, clientId: DEVICE, blog: 'raidosapp' }])
    // a second session replaces the first one in the running issuance
    const again = await call('PUT', '/accounts/me/admin/boosty/session', owner, { auth: AUTH, clientId: DEVICE })
    assert.equal(again.status, 200)
    assert.equal(saved.length, 2)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
