import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, newPasswordHash, type SubscriptionSource } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { EntitlementService } from '../services/entitlement.js'
import { ALLOWED_OPERATIONS, canonicalQuery, checkQueryAllowed, DataGateway, GatewayError, inspectQuery, PRICE_TTL_MS, STATIC_TTL_MS } from '../services/dataGateway.js'

const DEVICE = 'device-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const DAY = 24 * 60 * 60 * 1000

test('query check: one read-only operation, allowlisted name or safe top-level fields only', () => {
  assert.deepEqual(inspectQuery('{ items(lang: ru) { id name } tasks { id } }'), { fields: ['items', 'tasks'] })
  assert.deepEqual(inspectQuery('query RaidOsGuns($lang: LanguageCode) { guns: items(type: gun, lang: $lang) { id ...F } } fragment F on Item { name }'), { operationName: 'RaidOsGuns', fields: ['items'] })
  // Strings and comments cannot hide anything.
  assert.deepEqual(inspectQuery('# mutation\n{ item(id: "x { mutation }") { id } }').fields, ['item'])

  const status = (query: string) => { try { checkQueryAllowed(query); return 200 } catch (error) { return (error as GatewayError).status } }
  assert.equal(status('{ items { id } fleaMarket { enabled } }'), 200)
  assert.equal(status('query RaidOsAmmo { ammo { caliber } }'), 200)
  assert.equal(status('mutation { addItem { id } }'), 403)
  assert.equal(status('subscription { items { id } }'), 403)
  assert.equal(status('{ __schema { types { name } } }'), 403)
  assert.equal(status('{ items { __type(name: "X") { name } } }'), 403, 'introspection anywhere')
  assert.equal(status('{ items { id } } { tasks { id } }'), 400, 'several operations')
  assert.equal(status('{ secretAdminField { id } }'), 403, 'unknown field without an allowlisted name')
  assert.equal(status('query Whatever { secretAdminField { id } }'), 403)
  assert.equal(status('{ ...on Query { items { id } } }'), 403, 'top-level spreads')
  assert.equal(status('{ items { id }'), 400)
  assert.equal(status('x'.repeat(30_000)), 413)
  // A name alone opens nothing: named operations, allowlisted ones too, may use only the safe top-level fields.
  ALLOWED_OPERATIONS.push('RaidOsTestOnly')
  try {
    assert.equal(status('query RaidOsTestOnly { lootContainers { id } }'), 403)
    assert.equal(status('query RaidOsGuns { items { id } secretAdminField { id } }'), 403)
    assert.equal(status('query RaidOsTestOnly { items { id } }'), 200)
  } finally { ALLOWED_OPERATIONS.pop() }
  // The same field twice (under aliases) is refused: no multiplying the upstream work.
  assert.equal(status('{ a: items { id } b: items { id } }'), 400)
})

test('query check: every query the app really sends passes (src/data/bosses.ts, src/arsenal/gunQueries.ts)', async () => {
  // The app's own module (outside the server's TypeScript project, hence the computed specifier).
  const appQueries = new URL('../../../src/arsenal/gunQueries.ts', import.meta.url).href
  const { GUNS_QUERY, MODS_QUERY, AMMO_QUERY } = await import(appQueries) as Record<string, string>
  const bosses = 'query RaidOsBosses {\n  bosses(lang: ru) {\n    name\n    health { max }\n    equipment { item { id properties { ... on ItemPropertiesWeapon { defaultPreset { iconLink } } } } attributes { name value } }\n  }\n}'
  for (const query of [GUNS_QUERY!, MODS_QUERY!, AMMO_QUERY!, bosses]) {
    assert.ok(ALLOWED_OPERATIONS.includes(checkQueryAllowed(query).operationName ?? ''), query.slice(0, 40))
    // No aliases in them: what goes upstream is the same query.
    assert.equal(canonicalQuery(query), canonicalQuery(canonicalQuery(query)))
    assert.doesNotMatch(canonicalQuery(query), /\b\w+\s*:\s*items\b/)
  }
})

test('gateway: aliases are not part of the cache key nor of the upstream query; arguments keep their colons', async () => {
  assert.equal(canonicalQuery('query RaidOsGuns($lang: LanguageCode = ru) { guns: items(type: gun, lang: $lang, filter: { a: 1 }) { n: name id } }'),
    'query RaidOsGuns ( $ lang : LanguageCode = ru ) { items ( type : gun lang : $ lang filter : { a : 1 } ) { name id } }')
  assert.equal(canonicalQuery('{ item(id: "a: b  c") { x: id } }'), '{ item ( id : "a: b  c" ) { id } }')
  const upstream = fakeUpstream()
  const gateway = new DataGateway({ fetch: upstream.fetcher })
  await gateway.graphql('{ items(lang: ru) { id name } }', undefined)
  await gateway.graphql('{ x1: items(lang: ru) { id nm: name } }', undefined)
  await gateway.graphql('{ x2: items(lang: ru) { y: id name } }', undefined)
  assert.equal(upstream.calls.length, 1, 'one cache entry whatever the aliases')
  assert.doesNotMatch(String(JSON.parse(upstream.calls[0]!.body!).query), /x1|nm:/)
})

test('gateway: upstream calls in flight are capped globally (503) and per account (429) with Retry-After; a stale copy is served instead', async () => {
  let now = 0
  const waiting: Array<() => void> = []
  let calls = 0
  const fetcher = (async (input: string | URL | Request) => {
    calls += 1
    await new Promise<void>((resolve) => waiting.push(resolve))
    return new Response(JSON.stringify({ data: { url: String(input) } }), { status: 200 })
  }) as typeof fetch
  const gateway = new DataGateway({ fetch: fetcher, now: () => now, maxInFlight: 3, maxInFlightPerAccount: 2 })
  const release = async () => { while (waiting.length) waiting.shift()!(); await new Promise((resolve) => setTimeout(resolve, 5)) }
  const a1 = gateway.json('regular/tasks', { accountId: 'a' })
  const a2 = gateway.json('regular/maps', { accountId: 'a' })
  await assert.rejects(gateway.json('regular/items', { accountId: 'a' }), (error: GatewayError) => error.status === 429 && error.retryAfter! > 0)
  // An identical request in flight is shared, not counted again.
  const shared = gateway.json('regular/tasks', { accountId: 'a' })
  const b1 = gateway.json('regular/traders', { accountId: 'b' })
  assert.equal(gateway.upstreamInFlight, 3)
  await assert.rejects(gateway.json('pve/tasks', { accountId: 'c' }), (error: GatewayError) => error.status === 503 && error.retryAfter! > 0)
  await assert.rejects(gateway.graphql('{ items { id } }', undefined), (error: GatewayError) => error.status === 503)
  await release()
  await Promise.all([a1, a2, shared, b1])
  assert.equal(calls, 3)
  assert.equal(gateway.upstreamInFlight, 0, 'slots are given back')
  // Full again, but the expired copy of tasks exists: served instead of an error.
  now += 7 * 60 * 60 * 1000
  const hold = [gateway.json('pve/items'), gateway.json('pve/maps'), gateway.json('pve/traders')]
  assert.match(await gateway.json('regular/tasks'), /regular\/tasks/)
  await release()
  await Promise.all(hold)
  // A failed upstream call frees its slot too.
  const failing = new DataGateway({ fetch: (async () => { throw new Error('down') }) as typeof fetch, maxInFlight: 1 })
  await assert.rejects(failing.json('regular/tasks'), (error: GatewayError) => error.status === 502)
  await assert.rejects(failing.json('regular/tasks'), (error: GatewayError) => error.status === 502)
  assert.equal(failing.upstreamInFlight, 0)
})

test('gateway: the size cap still applies to a streamed answer (multi-byte text decoded across chunks)', async () => {
  const text = JSON.stringify({ data: { name: 'Тарков'.repeat(50) } })
  const bytes = Buffer.from(text)
  const chunked = () => new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.subarray(index, index + 7)); controller.close() } })
  const ok = new DataGateway({ fetch: (async () => new Response(chunked())) as typeof fetch })
  assert.equal(await ok.graphql('{ items { name } }', undefined), text)
  const small = new DataGateway({ fetch: (async () => new Response(chunked())) as typeof fetch, maxResponseBytes: bytes.length - 1 })
  await assert.rejects(small.graphql('{ items { name } }', undefined), (error: GatewayError) => error.status === 502)
})

function fakeUpstream() {
  const calls: Array<{ url: string; body?: string }> = []
  let payload = (url: string, body?: string) => JSON.stringify(url.includes('graphql') ? { data: { items: [{ id: 'a', body }] } } : { data: { tasks: {} } })
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    return new Response(payload(url, typeof init?.body === 'string' ? init.body : undefined), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetcher, setPayload: (next: typeof payload) => { payload = next } }
}

test('gateway cache: shared per query + variables (gameMode), price data 10 min, static data hours, size cap', async () => {
  let now = 0
  const upstream = fakeUpstream()
  const gateway = new DataGateway({ fetch: upstream.fetcher, now: () => now, maxResponseBytes: 2000 })
  const query = 'query RaidOsAmmo($gameMode: GameMode) { ammo(gameMode: $gameMode) { caliber } }'
  await gateway.graphql(query, { gameMode: 'regular' })
  await gateway.graphql(`${query}\n`, { gameMode: 'regular' })
  assert.equal(upstream.calls.length, 1, 'same query (whitespace aside) and variables: one upstream call')
  await gateway.graphql(query, { gameMode: 'pve' })
  assert.equal(upstream.calls.length, 2, 'PvE is cached separately')
  now += PRICE_TTL_MS + 1
  await gateway.graphql(query, { gameMode: 'regular' })
  assert.equal(upstream.calls.length, 3, 'prices refresh after 10 minutes')

  // Trader restock times: a minute.
  await gateway.graphql('{ traders { resetTime } }', undefined)
  now += 61_000
  await gateway.graphql('{ traders { resetTime } }', undefined)
  assert.equal(upstream.calls.length, 5)

  await gateway.graphql('{ tasks { id } }', undefined)
  now += PRICE_TTL_MS + 1
  await gateway.graphql('{ tasks { id } }', undefined)
  assert.equal(upstream.calls.length, 6, 'static data stays cached for hours')
  now += STATIC_TTL_MS
  await gateway.graphql('{ tasks { id } }', undefined)
  assert.equal(upstream.calls.length, 7)

  // Parallel identical requests share one upstream call.
  await Promise.all([gateway.json('pve/tasks'), gateway.json('pve/tasks'), gateway.json('pve/tasks')])
  assert.equal(upstream.calls.filter((call) => call.url.endsWith('/pve/tasks')).length, 1)
  // Quests (and their translations) are refetched within PRICE_TTL_MS: a new quest does not wait STATIC_TTL_MS.
  await gateway.json('pve/tasks_en')
  now += PRICE_TTL_MS + 1
  await Promise.all([gateway.json('pve/tasks'), gateway.json('pve/tasks_en')])
  assert.equal(upstream.calls.filter((call) => call.url.endsWith('/pve/tasks')).length, 2)
  assert.equal(upstream.calls.filter((call) => call.url.endsWith('/pve/tasks_en')).length, 2)
  await assert.rejects(gateway.json('pve/secrets'), (error: GatewayError) => error.status === 404)
  await assert.rejects(gateway.json('../etc/passwd'), (error: GatewayError) => error.status === 404)

  // Oversized answers are refused and never cached.
  upstream.setPayload(() => JSON.stringify({ data: { items: 'x'.repeat(5000) } }))
  await assert.rejects(gateway.graphql('{ items { id } }', { gameMode: 'big' }), (error: GatewayError) => error.status === 502)
  // An answer without data (tarkov.dev error) is not cached either.
  upstream.setPayload(() => JSON.stringify({ errors: [{ message: 'boom' }] }))
  await assert.rejects(gateway.graphql('{ items { name } }', undefined), (error: GatewayError) => error.status === 502)
  await assert.rejects(gateway.graphql('{ items { id } }', { nested: { object: true } }), (error: GatewayError) => error.status === 400)
})

async function withApi(run: (ctx: { call: (method: string, path: string, options?: { token?: string; device?: string; body?: unknown; ip?: string }) => Promise<Response>; accounts: AccountStore; paid: Map<string, number>; upstream: ReturnType<typeof fakeUpstream>; entitlements: EntitlementService }) => Promise<void>, limits?: { perIp?: number; perAccount?: number }) {
  const paid = new Map<string, number>()
  const accounts = new AccountStore({ ownerEmails: ['owner@example.com'] })
  const source: SubscriptionSource = { paidUntil: (id) => paid.get(id), referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0 }), referralSeries: () => [] }
  accounts.attachSubscriptions(source)
  const entitlements = new EntitlementService(accounts)
  const upstream = fakeUpstream()
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, { entitlements, data: new DataGateway({ fetch: upstream.fetcher }), dataRateLimits: limits }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await run({
      accounts, paid, upstream, entitlements,
      call: (method, path, options = {}) => fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.device ? { 'x-raid-device': options.device } : {}), ...(options.ip ? { 'x-forwarded-for': options.ip } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
}

test('HTTP gateway: 401 signed out, 402 without subscription, 403 without an active device, data with all three', async () => {
  await withApi(async ({ call, accounts, paid, upstream, entitlements }) => {
    const graphql = { query: '{ items { id } }' }
    assert.equal((await call('POST', '/v1/data/graphql', { body: graphql })).status, 401)
    const token = (await accounts.register('user@example.com', 'correct horse battery')).token
    const id = accounts.authenticate(token)!
    const denied = await call('POST', '/v1/data/graphql', { token, device: DEVICE, body: graphql })
    assert.equal(denied.status, 402)
    assert.deepEqual(await denied.json(), { error: 'Нужна подписка', code: 'subscription_required' })
    // The same gate guards the catalog and the player lookups.
    assert.equal((await call('GET', '/v1/catalog/pvp', { token, device: DEVICE })).status, 402)
    assert.equal((await call('POST', '/v1/players/resolve', { token, device: DEVICE, body: { mode: 'pvp', nickname: 'abc' } })).status, 402)
    assert.equal((await call('GET', '/v1/players/pvp/1', { token, device: DEVICE })).status, 402)
    assert.equal(upstream.calls.length, 0, 'nothing reaches tarkov.dev without access')

    paid.set(id, Date.now() + 30 * DAY)
    const unknownDevice = await call('POST', '/v1/data/graphql', { token, device: DEVICE, body: graphql })
    assert.equal(unknownDevice.status, 403)
    assert.equal((await unknownDevice.json() as { code: string }).code, 'device_inactive')
    assert.equal((await call('POST', '/v1/entitlement', { token, body: { deviceId: DEVICE } })).status, 200)
    const ok = await call('POST', '/v1/data/graphql', { token, device: DEVICE, body: graphql })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await ok.json(), { data: { items: [{ id: 'a', body: JSON.stringify(graphql) }] } })
    assert.equal((await call('GET', '/v1/data/json/regular/items_en', { token, device: DEVICE })).status, 200)
    assert.equal((await call('POST', '/v1/data/graphql', { token, device: DEVICE, body: { query: 'mutation { x }' } })).status, 403)
    assert.equal((await call('POST', '/v1/data/graphql', { token, device: DEVICE, body: { query: '{ __schema { types { name } } }' } })).status, 403)

    // The owner switches the device off: the app is told why.
    entitlements.revoke(id, DEVICE, 'owner')
    const login = (await accounts.login('user@example.com', 'correct horse battery')).token
    const revoked = await call('POST', '/v1/data/graphql', { token: login, device: DEVICE, body: graphql })
    assert.equal(revoked.status, 403)
    assert.equal((await revoked.json() as { code: string }).code, 'device_revoked')

    // The owner's own account needs no device (website, scripts).
    const { salt, hash } = await newPasswordHash('correct horse battery')
    const owner = accounts.createVerifiedAccount('owner@example.com', salt, hash).token
    assert.equal((await call('POST', '/v1/data/graphql', { token: owner, body: graphql })).status, 200)
  })
})

test('HTTP gateway: per-IP limit counted first, per-account limit after the checks', async () => {
  await withApi(async ({ call, accounts, paid }) => {
    const token = (await accounts.register('user@example.com', 'correct horse battery')).token
    paid.set(accounts.authenticate(token)!, Date.now() + DAY)
    assert.equal((await call('POST', '/v1/entitlement', { token, body: { deviceId: DEVICE } })).status, 200)
    const body = { query: '{ tasks { id } }' }
    for (let n = 0; n < 3; n += 1) assert.equal((await call('POST', '/v1/data/graphql', { token, device: DEVICE, body, ip: `198.51.100.${n}` })).status, 200)
    const limited = await call('POST', '/v1/data/graphql', { token, device: DEVICE, body, ip: '198.51.100.9' })
    assert.equal(limited.status, 429, 'per account, whatever the address')
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    // Per IP: signed-out requests from one address run into the IP limit (no account lookup needed).
    for (let n = 0; n < 5; n += 1) assert.equal((await call('POST', '/v1/data/graphql', { body, ip: '203.0.113.5' })).status, 401)
    assert.equal((await call('POST', '/v1/data/graphql', { body, ip: '203.0.113.5' })).status, 429)
  }, { perIp: 5, perAccount: 3 })
})
