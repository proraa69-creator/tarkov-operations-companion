import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, WELCOME_TRIAL_MS, type SubscriptionSource } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { EntitlementService } from '../services/entitlement.js'
import { LIVE_TTL_MS, LiveRelay } from '../services/liveRelay.js'

const PC = 'device-pcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpcpc'
const PHONE = 'device-phphphphphphphphphphphphphphphphph'
const DAY = 24 * 60 * 60 * 1000

interface Call { (method: string, path: string, options?: { token?: string; device?: string; body?: unknown }): Promise<Response> }

async function withLive(run: (ctx: { call: Call; accounts: AccountStore; paid: Map<string, number>; advance: (ms: number) => void; relay: LiveRelay; signIn: (email: string) => Promise<string> }) => Promise<void>, options: { waitMs?: number; limits?: { position?: number; item?: number } } = {}) {
  let clock = Date.now()
  const now = () => clock
  const paid = new Map<string, number>()
  const accounts = new AccountStore({ ownerEmails: ['owner@example.com'], now })
  const source: SubscriptionSource = { paidUntil: (id) => paid.get(id), referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0 }), referralSeries: () => [] }
  accounts.attachSubscriptions(source)
  const entitlements = new EntitlementService(accounts)
  const relay = new LiveRelay(now, options.waitMs ?? 25_000)
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, { entitlements, live: relay, livePublishLimits: options.limits }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call: Call = (method, path, request = {}) => fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(request.token ? { authorization: `Bearer ${request.token}` } : {}), ...(request.device ? { 'x-raid-device': request.device } : {}) },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  })
  /** A paying account with its PC and its phone registered as devices. */
  const signIn = async (email: string) => {
    const token = (await accounts.register(email, 'correct horse battery')).token
    paid.set(accounts.authenticate(token)!, clock + 30 * DAY)
    for (const deviceId of [PC, PHONE]) assert.equal((await call('POST', '/v1/entitlement', { token, body: { deviceId } })).status, 200)
    return token
  }
  try {
    await run({ call, accounts, paid, relay, signIn, advance: (ms) => { clock += ms } })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
}

const position = (at: number, extra: object = {}) => ({ x: 120.5, y: 3, z: -40.25, yaw: 90, at, map: 'customs', ...extra })
const item = (at: number) => ({
  itemId: '5c0e530286f7747fa1419862', name: 'Пропитал', shortName: 'Пропитал', iconUrl: 'https://assets.tarkov.dev/5c0e530286f7747fa1419862-icon.webp',
  fleaPrice: 41000, bestTrader: { name: 'Терапевт', price: 18000 },
  quests: [{ questId: 'q1', name: 'Санитарные нормы', trader: 'Терапевт', count: 2, kappa: true, purpose: 'сдать' }],
  kappa: true, collector: false, mate: true, mateNames: ['Friend_1'], at,
})
type State = { version: number; position: { x: number; at: number; map?: string } | null; item: { name: string; mateNames?: string[] } | null }

test('live relay: auth, access and the device, as for the game data', async () => {
  await withLive(async ({ call, accounts, advance, paid }) => {
    assert.equal((await call('GET', '/v1/live/pvp')).status, 401)
    assert.equal((await call('POST', '/v1/live/pvp/position', { body: position(1) })).status, 401)
    const token = (await accounts.register('free@example.com', 'correct horse battery')).token
    advance(WELCOME_TRIAL_MS + 1000)
    assert.equal((await call('GET', '/v1/live/pvp', { token, device: PHONE })).status, 402, 'no subscription')
    paid.set(accounts.authenticate(token)!, Date.now() + 60 * DAY)
    const inactive = await call('GET', '/v1/live/pvp', { token, device: PHONE })
    assert.equal(inactive.status, 403, 'the device is not registered')
    assert.equal((await inactive.json() as { code: string }).code, 'device_inactive')
  })
})

test('live relay: only the same account receives, per mode; bad input refused', async () => {
  await withLive(async ({ call, signIn }) => {
    const me = await signIn('me@example.com')
    const other = await signIn('other@example.com')
    const at = Date.now()
    assert.equal((await call('POST', '/v1/live/pve/position', { token: me, device: PC, body: position(at) })).status, 201)
    assert.equal((await call('POST', '/v1/live/pve/item', { token: me, device: PC, body: item(at) })).status, 201)
    const mine = await (await call('GET', '/v1/live/pve', { token: me, device: PHONE })).json() as State
    assert.equal(mine.position?.x, 120.5)
    assert.equal(mine.position?.map, 'customs')
    assert.equal(mine.item?.name, 'Пропитал')
    assert.deepEqual(mine.item?.mateNames, ['Friend_1'])
    const theirs = await (await call('GET', '/v1/live/pve', { token: other, device: PHONE })).json() as State
    assert.deepEqual([theirs.position, theirs.item], [null, null], 'another account sees nothing')
    const pvp = await (await call('GET', '/v1/live/pvp', { token: me, device: PHONE })).json() as State
    assert.deepEqual([pvp.position, pvp.item], [null, null], 'PvP, PvE and Season stay apart')

    assert.equal((await call('GET', '/v1/live/arena', { token: me, device: PHONE })).status, 400)
    assert.equal((await call('GET', '/v1/live/pvp?since=abc', { token: me, device: PHONE })).status, 400)
    assert.equal((await call('POST', '/v1/live/pvp/position', { token: me, device: PC, body: { ...position(at), x: 1e9 } })).status, 400)
    assert.equal((await call('POST', '/v1/live/pvp/position', { token: me, device: PC, body: { ...position(at), extra: 1 } })).status, 400)
    assert.equal((await call('POST', '/v1/live/pvp/item', { token: me, device: PC, body: { ...item(at), iconUrl: 'javascript:alert(1)' } })).status, 400)
    assert.equal((await call('POST', '/v1/live/pvp/item', { token: me, device: PC, body: { ...item(at), name: '' } })).status, 400)
  })
})

test('live relay: a waiting phone gets the PC\'s publish at once (well under a second)', async () => {
  await withLive(async ({ call, signIn }) => {
    const token = await signIn('wait@example.com')
    const first = await (await call('GET', '/v1/live/pvp', { token, device: PHONE })).json() as State
    // Nothing new yet: the phone waits with the version it has.
    const waiting = call('GET', `/v1/live/pvp?since=${first.version}`, { token, device: PHONE })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const sent = performance.now()
    assert.equal((await call('POST', '/v1/live/pvp/position', { token, device: PC, body: position(Date.now()) })).status, 201)
    const answer = await (await waiting).json() as State
    const latency = performance.now() - sent
    assert.notEqual(answer.version, first.version)
    assert.equal(answer.position?.x, 120.5)
    assert.ok(latency < 1000, `delivered in ${latency.toFixed(1)} ms`)
    console.log(`live relay: position delivered to the waiting phone in ${latency.toFixed(1)} ms`)

    // The item card the same way.
    const nextWait = call('GET', `/v1/live/pvp?since=${answer.version}`, { token, device: PHONE })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const itemSent = performance.now()
    assert.equal((await call('POST', '/v1/live/pvp/item', { token, device: PC, body: item(Date.now()) })).status, 201)
    const withItem = await (await nextWait).json() as State
    const itemLatency = performance.now() - itemSent
    assert.equal(withItem.item?.name, 'Пропитал')
    assert.ok(itemLatency < 1000)
    console.log(`live relay: item card delivered to the waiting phone in ${itemLatency.toFixed(1)} ms`)

    // A phone with an older version (it missed something) is answered at once, without waiting.
    const behind = performance.now()
    const caughtUp = await (await call('GET', `/v1/live/pvp?since=${first.version}`, { token, device: PHONE })).json() as State
    assert.equal(caughtUp.version, withItem.version)
    assert.ok(performance.now() - behind < 1000)
  })
})

test('live relay: a wait with nothing new ends with the same version', async () => {
  await withLive(async ({ call, signIn }) => {
    const token = await signIn('idle@example.com')
    const first = await (await call('GET', '/v1/live/seasonal', { token, device: PHONE })).json() as State
    const again = await (await call('GET', `/v1/live/seasonal?since=${first.version}`, { token, device: PHONE })).json() as State
    assert.equal(again.version, first.version)
  }, { waitMs: 50 })
})

test('live relay: kept in memory for a short time only (TTL); an older screenshot does not move the dot back', async () => {
  await withLive(async ({ call, signIn, advance, relay }) => {
    const token = await signIn('ttl@example.com')
    const at = Date.now()
    await call('POST', '/v1/live/pvp/position', { token, device: PC, body: position(at + 5000) })
    await call('POST', '/v1/live/pvp/position', { token, device: PC, body: position(at, { x: 1 }) })
    await call('POST', '/v1/live/pvp/item', { token, device: PC, body: item(at) })
    let state = await (await call('GET', '/v1/live/pvp', { token, device: PHONE })).json() as State
    assert.equal(state.position?.x, 120.5, 'the newer capture stays')
    advance(LIVE_TTL_MS.item + 1)
    state = await (await call('GET', '/v1/live/pvp', { token, device: PHONE })).json() as State
    assert.equal(state.item, null, 'the item card is gone after its TTL')
    assert.notEqual(state.position, null)
    advance(LIVE_TTL_MS.position)
    state = await (await call('GET', '/v1/live/pvp', { token, device: PHONE })).json() as State
    assert.equal(state.position, null, 'the position is gone after its TTL')
    relay.sweep(true)
    assert.equal(relay.size, 0, 'nothing left in memory')
  })
})

test('live relay: publishes are rate-limited per account', async () => {
  await withLive(async ({ call, signIn }) => {
    const token = await signIn('limit@example.com')
    for (let n = 0; n < 3; n += 1) assert.equal((await call('POST', '/v1/live/pvp/position', { token, device: PC, body: position(Date.now() + n) })).status, 201)
    const limited = await call('POST', '/v1/live/pvp/position', { token, device: PC, body: position(Date.now() + 10) })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    // Items have a limit of their own.
    assert.equal((await call('POST', '/v1/live/pvp/item', { token, device: PC, body: item(Date.now()) })).status, 201)
  }, { limits: { position: 3, item: 3 } })
})

test('older apps keep working: GET /v1/me/position also shows the live position; an old PC\'s POST reaches the live phone', async () => {
  await withLive(async ({ call, signIn }) => {
    const token = await signIn('old@example.com')
    const at = Date.now()
    await call('POST', '/v1/live/pve/position', { token, device: PC, body: position(at) })
    const old = await (await call('GET', '/v1/me/position/pve', { token })).json() as { position: { x: number } | null }
    assert.equal(old.position?.x, 120.5, 'an older phone polling the stored position sees the live one')
    assert.equal((await call('POST', '/v1/me/position/pvp', { token, body: position(at, { x: 7 }) })).status, 201)
    const live = await (await call('GET', '/v1/live/pvp', { token, device: PHONE })).json() as State
    assert.equal(live.position?.x, 7, 'an older PC\'s position reaches the new phone')
  })
})
