import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password })
  return { call, login, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const killa = { mapId: 'interchange', bossKey: 'killa', bossName: 'Килла', x: -12.5, z: 40 }

test('map bosses: the owner places and removes, everybody reads, players cannot write', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.deepEqual((await call('GET', '/map-bosses')).json, { placements: [] })

    assert.equal((await call('POST', '/accounts/me/admin/map-bosses', undefined, killa)).status, 401)
    assert.equal((await call('POST', '/accounts/me/admin/map-bosses', player, killa)).status, 404)
    assert.equal((await call('POST', '/accounts/me/admin/map-bosses', owner, { ...killa, x: 'far' })).status, 400)
    assert.equal((await call('POST', '/accounts/me/admin/map-bosses', owner, { ...killa, mapId: '../etc' })).status, 400)

    const placed = await call<{ placement: { id: string; mapId: string; bossKey: string; x: number; z: number; floor?: string } }>('POST', '/accounts/me/admin/map-bosses', owner, { ...killa, floor: 'Второй этаж' })
    assert.equal(placed.status, 201)
    assert.match(placed.json.placement.id, /^[a-f0-9]{24}$/)
    assert.equal(placed.json.placement.floor, 'Второй этаж')

    const listed = await call<{ placements: Array<{ id: string; bossName: string; x: number; z: number }> }>('GET', '/map-bosses')
    assert.equal(listed.json.placements.length, 1)
    assert.deepEqual([listed.json.placements[0].bossName, listed.json.placements[0].x, listed.json.placements[0].z], ['Килла', -12.5, 40])

    const id = placed.json.placement.id
    assert.equal((await call('POST', `/accounts/me/admin/map-bosses/${id}/remove`, player)).status, 404)
    const removed = await call<{ placements: unknown[] }>('POST', `/accounts/me/admin/map-bosses/${id}/remove`, owner)
    assert.equal(removed.status, 200)
    assert.deepEqual(removed.json.placements, [])
    assert.equal((await call('POST', `/accounts/me/admin/map-bosses/${id}/remove`, owner)).status, 404)

    const audit = await call<{ entries: Array<{ action: string }> }>('GET', '/accounts/me/admin/audit', owner)
    assert.deepEqual(audit.json.entries.map((entry) => entry.action).sort(), ['map.boss-place', 'map.boss-remove'])
  } finally {
    await close()
  }
})
