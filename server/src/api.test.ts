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
      // Through the website server / public link (X-Forwarded-For): only ok, service and database — no build or flags.
      const proxied = await fetch(endpoint, { headers: { 'x-forwarded-for': '203.0.113.7' } })
      assert.equal(proxied.status, 200)
      assert.deepEqual(await proxied.json(), { ok: true, service: 'tarkov-operations-api', database: true })
      assert.deepEqual(Object.keys(await (await fetch(endpoint, { headers: { 'cf-connecting-ip': '203.0.113.7' } })).json() as object).sort(), ['database', 'ok', 'service'])
    } finally {
      for (const key of ['TARKOV_APP_VERSION', 'TARKOV_APP_BUILD', 'TARKOV_APP_COMMIT', 'TARKOV_APP_EDITION']) Reflect.deleteProperty(process.env, key)
    }
    accounts.close() // the database goes away under the running server
    const broken = await fetch(endpoint)
    assert.equal(broken.status, 503)
    assert.deepEqual(await broken.json().then((value: { ok: boolean; database: boolean }) => [value.ok, value.database]), [false, false])
    const brokenProxied = await fetch(endpoint, { headers: { 'x-forwarded-for': '203.0.113.7' } })
    assert.equal(brokenProxied.status, 503, 'monitors through the public link still see the failing database')
    assert.deepEqual(await brokenProxied.json(), { ok: false, service: 'tarkov-operations-api', database: false })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})

test('security headers on every answer, accounts never cached, 5xx without internal details', async () => {
  const store = new ProgressStore(':memory:')
  const server = createApi(store, 'local-test-token').listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const logged: unknown[][] = []
  const originalError = console.error
  try {
    for (const path of ['/health', '/v1/accounts/no-such-route', '/no-such-route']) {
      const answer = await fetch(`${base}${path}`)
      assert.equal(answer.headers.get('x-content-type-options'), 'nosniff', path)
      assert.equal(answer.headers.get('x-frame-options'), 'DENY', path)
    }
    // Personal: unknown account paths and broken requests are not cacheable either.
    assert.equal((await fetch(`${base}/v1/accounts/no-such-route`)).headers.get('cache-control'), 'no-store')
    const broken = await fetch(`${base}/v1/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' })
    assert.equal(broken.status, 400)
    assert.equal(broken.headers.get('cache-control'), 'no-store')

    // 4xx keep their message.
    const invalid = await fetch(`${base}/v1/catalog/invalid`)
    assert.equal(invalid.status, 400)
    assert.deepEqual(await invalid.json(), { error: 'Некорректные данные запроса' })

    // A failure inside the server (here: its database is gone) answers a generic message; the details go to the log.
    console.error = (...args: unknown[]) => { logged.push(args) }
    store.close()
    const body = { mode: 'pvp', accountId: 100, characterId: '0123456789abcdef01234567', events: [] }
    const failed = await fetch(`${base}/v1/sync/events`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer local-test-token' }, body: JSON.stringify(body) })
    assert.equal(failed.status, 502)
    assert.deepEqual(await failed.json(), { error: 'Внутренняя ошибка сервера' })
    assert.equal(logged.length, 1)
    assert.match(String(logged[0]![0]), /POST \/v1\/sync\/events -> 502/)
    assert.ok(String(logged[0]![1]).length > 0, 'the real reason is in the server log')
  } finally {
    console.error = originalError
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('public catalog and player lookups are rate limited per IP with Retry-After', async () => {
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, undefined, { rateLimits: { catalog: 2, players: 2 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  // Invalid requests (400, no upstream call) still count: the limit applies before validation.
  const catalog = (ip?: string) => fetch(`${base}/v1/catalog/invalid`, { headers: ip ? { 'x-forwarded-for': ip } : {} })
  const resolve = () => fetch(`${base}/v1/players/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'pvp', nickname: 'x' }) })
  try {
    assert.equal((await catalog()).status, 400)
    assert.equal((await catalog()).status, 400)
    const limited = await catalog()
    assert.equal(limited.status, 429)
    const retry = Number(limited.headers.get('retry-after'))
    assert.ok(retry > 0 && retry <= 60, `Retry-After ${retry}`)
    assert.match((await limited.json() as { error: string }).error, /Слишком много запросов/)
    // Another visitor behind the site proxy (X-Forwarded-For from loopback) has its own bucket.
    assert.equal((await catalog('203.0.113.7')).status, 400)

    // resolve and profile share one bucket, separate from the catalog.
    assert.equal((await resolve()).status, 400)
    assert.equal((await fetch(`${base}/v1/players/invalid/1`)).status, 400)
    const players = await resolve()
    assert.equal(players.status, 429)
    assert.ok(Number(players.headers.get('retry-after')) > 0)
    assert.equal((await fetch(`${base}/v1/players/invalid/1`)).status, 429)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})
