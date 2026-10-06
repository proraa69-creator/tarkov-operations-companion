import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'

/** «Правки карты сразу у всех»: an app waiting on /v1/map-updates hears about the owner's save at once. */
test('map updates: a waiting app is answered as soon as the owner saves a quest point or a boss', async () => {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }
  try {
    const owner = (await call('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token as string
    const start = (await call('GET', '/map-updates')).json.version as number
    assert.equal(typeof start, 'number')
    assert.equal((await call('GET', '/map-updates?since=abc')).status, 400)
    // An outdated version is answered at once.
    assert.equal((await call('GET', `/map-updates?since=${start - 1}`)).json.version, start)

    const waiting = call('GET', `/map-updates?since=${start}`)
    let answered = false
    void waiting.then(() => { answered = true })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(answered, false)
    const saved = await call('PUT', '/accounts/me/admin/quest-points', owner, { questId: 'q1', markerId: 'quest-zone-q1-a', mapId: 'customs', x: 1, z: 2, kind: 'move' })
    assert.equal(saved.status, 200)
    const after = (await waiting).json.version as number
    assert.ok(after > start)

    const next = call('GET', `/map-updates?since=${after}`)
    assert.equal((await call('POST', '/accounts/me/admin/map-bosses', owner, { mapId: 'customs', bossKey: 'reshala', bossName: 'Решала', x: 3, z: 4 })).status, 201)
    assert.ok(((await next).json.version as number) > after)

    // A refused write changes nothing.
    const version = (await call('GET', '/map-updates')).json.version
    assert.equal((await call('PUT', '/accounts/me/admin/quest-points', owner, { questId: 'q1', mapId: 'customs', x: 1, z: 2, kind: 'move' })).status, 400)
    assert.equal((await call('GET', '/map-updates')).json.version, version)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('map updates: the wait ends by itself and a closed request is forgotten', async () => {
  const { MapUpdates } = await import('./mapUpdates.js')
  const updates = new MapUpdates(100, 20)
  const answers: unknown[] = []
  const fake = () => {
    const handlers: Record<string, () => void> = {}
    return { writableEnded: false, destroyed: false, json: (value: unknown) => { answers.push(value) }, on: (event: string, handler: () => void) => { handlers[event] = handler }, close: () => handlers.close?.() }
  }
  const one = fake()
  updates.wait(one as never, 'a', 100)
  assert.equal(updates.waiting, 1)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(answers, [{ version: 100 }])
  assert.equal(updates.waiting, 0)
  const two = fake()
  updates.wait(two as never, 'a', 100)
  two.close()
  assert.equal(updates.waiting, 0)
  updates.changed()
  assert.equal(answers.length, 1)
  // At most 8 waiting requests per address: the ninth is answered at once.
  for (let index = 0; index < 9; index += 1) updates.wait(fake() as never, 'b', 101)
  assert.equal(updates.waiting, 8)
  assert.equal(answers.length, 2)
  updates.changed()
  assert.equal(updates.waiting, 0)
  assert.equal(answers.length, 10)
})
