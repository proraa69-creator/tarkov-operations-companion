import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { createGoonsRouter, GOON_ADDRESS_LIMIT, type GoonsRouterOptions } from './goons.js'
import { MemoryGoonStore, summarizeGoons } from '../services/goonStore.js'

async function withApi(run: (api: { get: (mode: string) => Promise<Response>; post: (mode: string, body: unknown, ip?: string, token?: string) => Promise<Response>; advance: (ms: number) => void }) => Promise<void>, options: Omit<GoonsRouterOptions, 'now'> = {}) {
  let clock = Date.parse('2026-09-28T10:00:00.000Z')
  const app = express()
  app.set('trust proxy', true) // lets the test pose as different clients through X-Forwarded-For
  app.use('/v1/goons', createGoonsRouter(new MemoryGoonStore(), { now: () => clock, ...options }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/goons`
  try {
    await run({
      get: (mode) => fetch(`${base}/${mode}`),
      post: (mode, body, ip = '10.0.0.1', token) => fetch(`${base}/${mode}/sightings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }),
      advance: (ms) => { clock += ms },
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('goons: stores sightings with server time, keeps modes apart and summarizes 5 hours', async () => {
  await withApi(async ({ get, post, advance }) => {
    assert.deepEqual(await (await get('pvp')).json(), { latest: null, last5h: [], recent: [] })
    const first = await post('pvp', { mapId: 'woods', reportedAt: '2001-01-01T00:00:00.000Z' }, '10.0.0.1')
    assert.equal(first.status, 201)
    assert.equal(((await first.json()) as { accepted: boolean }).accepted, true)
    advance(10_000)
    assert.equal((await post('pvp', { mapId: 'woods' }, '10.0.0.2')).status, 201)
    advance(10_000)
    assert.equal((await post('pvp', { mapId: 'customs' }, '10.0.0.3')).status, 201)
    assert.equal((await post('pve', { mapId: 'lighthouse' }, '10.0.0.4')).status, 201)

    const pvp = await (await get('pvp')).json() as { latest: { mapId: string; reportedAt: string }; last5h: Array<{ mapId: string; count: number; lastAt: string }> }
    assert.deepEqual(pvp.latest, { mapId: 'customs', reportedAt: '2026-09-28T10:00:20.000Z' })
    assert.deepEqual(pvp.last5h, [
      { mapId: 'woods', count: 2, lastAt: '2026-09-28T10:00:10.000Z' },
      { mapId: 'customs', count: 1, lastAt: '2026-09-28T10:00:20.000Z' },
    ])
    const pve = await (await get('pve')).json() as { last5h: unknown[]; latest: { mapId: string } }
    assert.equal(pve.latest.mapId, 'lighthouse')
    assert.equal(pve.last5h.length, 1)
    assert.deepEqual(await (await get('seasonal')).json(), { latest: null, last5h: [], recent: [] })

    advance(5 * 60 * 60 * 1000 + 60_000)
    const later = await (await get('pvp')).json() as { latest: { mapId: string }; last5h: unknown[] }
    assert.equal(later.latest.mapId, 'customs', 'latest survives the 5 h stats window')
    assert.deepEqual(later.last5h, [])
    advance(19 * 60 * 60 * 1000)
    assert.deepEqual(await (await get('pvp')).json(), { latest: null, last5h: [], recent: [] }, 'entries older than 24 h are pruned')
  })
})

test('goons: validates mode and map', async () => {
  await withApi(async ({ get, post }) => {
    assert.equal((await get('arena')).status, 400)
    assert.equal((await post('arena', { mapId: 'woods' })).status, 400)
    assert.equal((await post('pvp', { mapId: 'factory' })).status, 400)
    assert.equal((await post('pvp', {})).status, 400)
    assert.equal((await post('pvp', { mapId: 'woods' })).status, 201, 'rejected requests do not count against the rate limit')
  })
})

test('goons: one report per minute per address and duplicate map ignored for two minutes', async () => {
  await withApi(async ({ get, post, advance }) => {
    assert.equal((await post('pvp', { mapId: 'woods' })).status, 201)
    advance(5_000)
    const duplicate = await post('pvp', { mapId: 'woods' })
    assert.equal(duplicate.status, 200)
    assert.deepEqual(((await duplicate.json()) as { accepted: boolean; reason: string }).reason, 'duplicate')
    const tooFast = await post('pve', { mapId: 'customs' })
    assert.equal(tooFast.status, 429)
    assert.ok(Number(tooFast.headers.get('retry-after')) > 0)
    assert.equal((await post('pvp', { mapId: 'customs' }, '10.0.0.9')).status, 201, 'other addresses are not limited')
    advance(60_000)
    assert.equal(((await (await post('pvp', { mapId: 'woods' })).json()) as { reason?: string }).reason, 'duplicate', 'same map still deduped within 2 minutes')
    assert.equal((await post('pvp', { mapId: 'shoreline' })).status, 201)
    advance(125_000)
    assert.equal((await post('pvp', { mapId: 'woods' })).status, 201)
    const snapshot = await (await get('pvp')).json() as { last5h: Array<{ mapId: string; count: number }> }
    assert.deepEqual(snapshot.last5h.map((row) => [row.mapId, row.count]), [['woods', 2], ['shoreline', 1], ['customs', 1]])
  })
})

test('goons store: summary ignores other modes and prunes old entries', () => {
  const store = new MemoryGoonStore()
  const now = Date.parse('2026-09-28T12:00:00.000Z')
  store.add({ mapId: 'woods', mode: 'pvp', reportedAt: '2026-09-27T11:00:00.000Z', reporter: 'a' })
  store.add({ mapId: 'customs', mode: 'pvp', reportedAt: '2026-09-28T06:00:00.000Z', reporter: 'a' })
  store.add({ mapId: 'shoreline', mode: 'seasonal', reportedAt: '2026-09-28T11:00:00.000Z', reporter: 'b' })
  assert.deepEqual(summarizeGoons(store, 'pvp', now), { latest: { mapId: 'customs', reportedAt: '2026-09-28T06:00:00.000Z' }, last5h: [], recent: [] })
  store.prune(now - 24 * 60 * 60 * 1000)
  assert.equal(store.list('pvp', 0).length, 1)
  assert.equal(store.lastByReporter('b')?.mapId, 'shoreline')
})

test('goons: the rate limit counts an IPv6 /64 prefix as one client (IPv4 stays per address)', async () => {
  await withApi(async ({ post }) => {
    assert.equal((await post('pvp', { mapId: 'woods' }, '2001:db8:1:2::1')).status, 201)
    // Another address of the same /64 (also written differently) is the same client: 429.
    const rotated = await post('pvp', { mapId: 'customs' }, '2001:0db8:0001:0002:ffff:eeee:dddd:cccc')
    assert.equal(rotated.status, 429)
    assert.ok(Number(rotated.headers.get('retry-after')) > 0)
    // A different /64 is another client.
    assert.equal((await post('pvp', { mapId: 'customs' }, '2001:db8:1:3::1')).status, 201)
    // IPv4: neighbours are separate clients.
    assert.equal((await post('pvp', { mapId: 'woods' }, '198.51.100.1')).status, 201)
    assert.equal((await post('pvp', { mapId: 'customs' }, '198.51.100.2')).status, 201)
  })
})

/** The real server: who reports is the signed-in account, his nickname for the mode is what everybody sees. */
const ACCOUNTS: Record<string, { account: string; nicknames: Partial<Record<string, string>> }> = {
  'token-a': { account: 'acc-a', nicknames: { pvp: 'SHAURMA', pve: 'ShaurmaPve' } },
  'token-b': { account: 'acc-b', nicknames: { pvp: 'Bober' } },
  'token-c': { account: 'acc-c', nicknames: {} },
}
const identify: GoonsRouterOptions['identify'] = (req, mode) => {
  const entry = ACCOUNTS[(req.get('authorization') ?? '').replace(/^Bearer /, '')]
  if (!entry) return null
  const nickname = entry.nicknames[mode]
  return { account: entry.account, ...(nickname ? { nickname } : {}) }
}

test('goons: a signed-in account reports under his Tarkov nickname for that mode; everybody sees it', async () => {
  let notified = 0
  await withApi(async ({ get, post, advance }) => {
    const anonymous = await (await post('pvp', { mapId: 'woods' })).json() as { accepted: boolean; reason: string }
    assert.deepEqual([anonymous.accepted, anonymous.reason], [false, 'signin'])
    const nameless = await (await post('pvp', { mapId: 'woods' }, '10.0.0.3', 'token-c')).json() as { accepted: boolean; reason: string }
    assert.deepEqual([nameless.accepted, nameless.reason], [false, 'nickname'])
    // The nickname of the PvE account is not used on PvP, and the body cannot choose one.
    assert.equal((await post('pvp', { mapId: 'woods', nickname: 'Someone' }, '10.0.0.1', 'token-a')).status, 201)
    advance(70_000)
    assert.equal((await post('pvp', { mapId: 'customs' }, '10.0.0.2', 'token-b')).status, 201)
    assert.equal((await post('pve', { mapId: 'lighthouse' }, '10.0.0.4', 'token-a')).status, 201)
    assert.equal(notified, 3)
    const pvp = await (await get('pvp')).json() as { latest: unknown; recent: unknown[] }
    assert.deepEqual(pvp.latest, { mapId: 'customs', reportedAt: '2026-09-28T10:01:10.000Z', nickname: 'Bober' })
    assert.deepEqual(pvp.recent, [
      { mapId: 'customs', reportedAt: '2026-09-28T10:01:10.000Z', nickname: 'Bober' },
      { mapId: 'woods', reportedAt: '2026-09-28T10:00:00.000Z', nickname: 'SHAURMA' },
    ])
    assert.deepEqual((await (await get('pve')).json() as { recent: unknown[] }).recent, [{ mapId: 'lighthouse', reportedAt: '2026-09-28T10:01:10.000Z', nickname: 'ShaurmaPve' }])
  }, { identify, onSighting: () => { notified += 1 } })
})

test('goons: limits are per account (another address does not help) and per address (several accounts)', async () => {
  await withApi(async ({ post, advance }) => {
    assert.equal((await post('pvp', { mapId: 'woods' }, '10.0.0.1', 'token-a')).status, 201)
    assert.equal((await post('pvp', { mapId: 'customs' }, '10.0.0.7', 'token-a')).status, 429, 'same account, other address')
    for (let index = 0; index < 20; index += 1) {
      advance(61_000)
      const answer = await post('pvp', { mapId: index % 2 ? 'customs' : 'shoreline' }, '10.0.0.9', index % 2 ? 'token-a' : 'token-b')
      if (index < GOON_ADDRESS_LIMIT) assert.equal(answer.status, 201)
      else { assert.equal(answer.status, 429); break }
    }
  }, { identify })
})

test('goons through the real API: the account nickname is attached and every app is told at once', async () => {
  const { createApi } = await import('../app.js')
  const { AccountStore } = await import('../services/accountStore.js')
  const { openDatabase } = await import('../services/database.js')
  const { PaymentStore } = await import('../services/paymentStore.js')
  const { ProgressStore } = await import('../services/progressStore.js')
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }
  try {
    await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password: 'correct horse battery' })
    const token = (await call('POST', '/accounts/login', undefined, { email: 'player@example.com', password: 'correct horse battery' })).json.token as string
    assert.equal(((await call('POST', '/goons/pvp/sightings', token, { mapId: 'woods' })).json as { reason?: string }).reason, 'nickname')
    assert.equal((await call('PUT', '/accounts/me/nicknames', token, { pvp: 'SHAURMA' })).status, 200)
    const before = (await call('GET', '/map-updates')).json.version as number
    assert.equal((await call('POST', '/goons/pvp/sightings', token, { mapId: 'woods' })).status, 201)
    const goons = (await call('GET', '/goons/pvp')).json as { latest: { mapId: string; nickname: string } }
    assert.deepEqual([goons.latest.mapId, goons.latest.nickname], ['woods', 'SHAURMA'])
    assert.ok(((await call('GET', '/map-updates')).json.version as number) > before)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
