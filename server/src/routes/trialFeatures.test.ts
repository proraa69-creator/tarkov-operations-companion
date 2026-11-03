import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const PATH = '/accounts/me/admin/trial-features'

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  let now = Date.parse('2026-11-01T12:00:00Z')
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => now })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), translateAnnouncement: async () => { throw new Error('offline') } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const player = (await call<{ token: string }>('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })).json.token
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  return { call, player, owner, later: (ms: number) => { now += ms }, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('the owner turns the quest screen search on for one player for a day; the player hears it at once; it ends by itself', async () => {
  const { call, player, owner, later, close } = await setup()
  try {
    const features = async () => (await call<{ features: { questTableScan: string | null } }>('GET', '/me/features', player)).json.features.questTableScan
    assert.equal(await features(), null)
    // Nobody but the owner, and only an existing account.
    assert.equal((await call('PUT', PATH, player, { email: 'player@example.com', feature: 'questTableScan', hours: 24 })).status, 404)
    assert.equal((await call('PUT', PATH, owner, { email: 'nobody@example.com', feature: 'questTableScan', hours: 24 })).status, 404)
    assert.equal((await call('PUT', PATH, owner, { email: 'не почта', feature: 'questTableScan', hours: 24 })).status, 400)

    // The player's app waits on its social events: the grant answers it at once.
    const version = (await call<{ version: number }>('GET', '/me/social-events', player)).json.version
    const waiting = call<{ version: number }>('GET', `/me/social-events?since=${version}`, player)
    const saved = await call<{ grant: { email: string; until: string; grantedBy: string } }>('PUT', PATH, owner, { email: ' Player@Example.com ', feature: 'questTableScan', hours: 24 })
    assert.equal(saved.status, 200)
    assert.deepEqual([saved.json.grant.email, saved.json.grant.until, saved.json.grant.grantedBy], ['player@example.com', '2026-11-02T12:00:00.000Z', 'owner@example.com'])
    assert.notEqual((await waiting).json.version, version)
    assert.equal(await features(), '2026-11-02T12:00:00.000Z')
    assert.deepEqual((await call<{ grants: Array<{ email: string }> }>('GET', PATH, owner)).json.grants.map((grant) => grant.email), ['player@example.com'])

    // A day later it is off by itself; «Выключить» ends it at once.
    later(24 * 3600_000)
    assert.equal(await features(), null)
    assert.deepEqual((await call<{ grants: unknown[] }>('GET', PATH, owner)).json.grants, [])
    await call('PUT', PATH, owner, { email: 'player@example.com', feature: 'questTableScan', hours: 24 })
    await call('PUT', PATH, owner, { email: 'player@example.com', feature: 'questTableScan', hours: 0 })
    assert.equal(await features(), null)
  } finally {
    await close()
  }
})
