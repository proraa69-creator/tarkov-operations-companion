import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from './app.js'
import { ProgressStore } from './services/progressStore.js'

test('sync requires a device token, validates requests, isolates modes and is idempotent', async () => {
  const store = new ProgressStore(':memory:')
  const server = createApi(store, 'local-test-token').listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/v1/sync/events`
  const body = { mode: 'pvp', accountId: 100, characterId: '0123456789abcdef01234567', events: [{ taskId: '5936d90786f7742b1420ba5b', status: 'active', timestamp: '2026-09-25T10:00:00.000Z' }] }
  const send = (data: unknown, authenticated = true) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer local-test-token' } : {}) }, body: JSON.stringify(data) })
  try {
    assert.equal((await send(body, false)).status, 401)
    assert.equal((await send({ ...body, mode: 'invalid' })).status, 400)
    const first = await (await send(body)).json() as { revision: string; records: unknown[] }
    const repeated = await (await send(body)).json()
    assert.deepEqual(first, repeated)
    assert.equal(first.records.length, 1)
    const otherMode = await (await send({ ...body, mode: 'pve', events: [] })).json() as { records: unknown[] }
    assert.equal(otherMode.records.length, 0)
    const newCharacter = await (await send({ ...body, characterId: '1123456789abcdef01234567', events: [] })).json() as { records: unknown[] }
    assert.equal(newCharacter.records.length, 0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})

test('older events never override newer progress, and owners remain isolated', () => {
  const store = new ProgressStore(':memory:')
  const scope = { mode: 'pvp' as const, accountId: 100, characterId: '0123456789abcdef01234567' }
  const taskId = '5936d90786f7742b1420ba5b'
  try {
    store.sync('a', { ...scope, events: [{ taskId, status: 'completed', timestamp: '2026-09-25T12:00:00.000Z' }] })
    const result = store.sync('a', { ...scope, events: [{ taskId, status: 'active', timestamp: '2026-09-25T10:00:00.000Z' }] })
    assert.equal(result.records[0].status, 'completed')
    assert.equal(store.sync('b', { ...scope, events: [] }).records.length, 0)
  } finally { store.close() }
})

test('/health reports the database check (additive, backwards compatible)', async () => {
  const { AccountStore } = await import('./services/accountStore.js')
  const store = new ProgressStore(':memory:')
  const accounts = new AccountStore()
  const server = createApi(store, undefined, accounts).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/health`
  try {
    const healthy = await fetch(endpoint)
    assert.equal(healthy.status, 200)
    const body = await healthy.json() as { ok: boolean; database: boolean; service: string; accounts: boolean }
    assert.equal(body.ok, true)
    assert.equal(body.database, true)
    assert.equal(body.service, 'tarkov-operations-api')
    assert.equal(body.accounts, true)
    assert.equal('build' in body, false) // started on its own: no app build
    process.env.TARKOV_APP_VERSION = '0.5.4'; process.env.TARKOV_APP_BUILD = '42'; process.env.TARKOV_APP_COMMIT = 'abc1234'; process.env.TARKOV_APP_EDITION = 'owner'
    try {
      const built = await (await fetch(endpoint)).json() as { build?: unknown }
      assert.deepEqual(built.build, { version: '0.5.4', build: 42, commit: 'abc1234', edition: 'owner' })
    } finally {
      for (const key of ['TARKOV_APP_VERSION', 'TARKOV_APP_BUILD', 'TARKOV_APP_COMMIT', 'TARKOV_APP_EDITION']) Reflect.deleteProperty(process.env, key)
    }
    accounts.close() // the database goes away under the running server
    const broken = await fetch(endpoint)
    assert.equal(broken.status, 503)
    assert.deepEqual(await broken.json().then((value: { ok: boolean; database: boolean }) => [value.ok, value.database]), [false, false])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})
