import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi, type ApiOptions } from '../app.js'
import { AccountStore, newPasswordHash, WELCOME_TRIAL_MS, type SubscriptionSource } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { EntitlementService } from '../services/entitlement.js'
import { PAID_CONTENT_PATH, isPaidContentPath } from '../../../src/shared/paidContent.js'

const DEVICE = 'device-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const DAY = 24 * 60 * 60 * 1000

/** Our own content and the account's synced data (src/shared/paidContent.ts): one read of each kind. */
const CONTENT_READS = [
  '/v1/quest-points', '/v1/quest-texts', '/v1/quest-requirements', '/v1/map-bosses', '/v1/event-quests', '/v1/owner-builds',
  '/v1/builds?mode=pvp', '/v1/me/progress/pvp', '/v1/me/story/pvp', '/v1/me/deferred-quests/pvp', '/v1/me/collector/pvp',
  '/v1/me/hideout/pvp', '/v1/me/items/pvp/quests', '/v1/me/quest-mirror/pvp', '/v1/me/position/pvp', '/v1/me/settings',
  '/v1/me/levels', '/v1/me/objectives/pvp', '/v1/me/state', '/v1/me/game-mode',
]

type Call = (method: string, path: string, options?: { token?: string; device?: string; body?: unknown }) => Promise<Response>

async function withApi(run: (ctx: { call: Call; accounts: AccountStore; paid: Map<string, number>; advance: (ms: number) => void }) => Promise<void>, extra: Partial<ApiOptions> = { paidContent: true }) {
  const paid = new Map<string, number>()
  let clock = Date.now()
  const accounts = new AccountStore({ ownerEmails: ['owner@example.com'], now: () => clock })
  const source: SubscriptionSource = { paidUntil: (id) => paid.get(id), referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0, payers: 0 }), referralSeries: () => [] }
  accounts.attachSubscriptions(source)
  const entitlements = new EntitlementService(accounts)
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, { entitlements, ...extra }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await run({
      accounts, paid,
      advance: (ms) => { clock += ms },
      call: (method, path, options = {}) => fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.device ? { 'x-raid-device': options.device } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
}

const statuses = async (call: Call, options: { token?: string; device?: string }) => Object.fromEntries(await Promise.all(CONTENT_READS.map(async (path) => {
  const response = await call('GET', path, options)
  await response.arrayBuffer()
  return [path, response.status] as const
})))
const all = (status: number) => Object.fromEntries(CONTENT_READS.map((path) => [path, status]))

test('paid content paths: our content and the synced lists; never sign-in, payments, support, notices, the cabinet or the signals', () => {
  for (const path of CONTENT_READS) assert.ok(isPaidContentPath(path), path)
  for (const path of ['/v1/me/quest-point-photos/0123456789abcdef01234567', '/v1/me/progress/pvp/events', '/v1/me/progress/pvp/reset', '/v1/builds/0123456789abcdef01234567/like', '/v1/me/state?since=5']) assert.ok(isPaidContentPath(path), path)
  for (const path of [
    '/v1/me/summary', '/v1/me/features', '/v1/me/social-events?since=1', '/v1/me/presence', '/v1/me/support/messages', '/v1/me/notices',
    '/v1/me/surveys/x/later', '/v1/map-updates?since=1', '/v1/map-tiles/maps.json', '/v1/map-tiles/maps/x/1/2/3.png', '/v1/announcement',
    '/v1/accounts/me', '/v1/accounts/me/invites', '/v1/accounts/me/admin/quest-points', '/v1/payments/plans', '/v1/entitlement',
    '/v1/player-news', '/v1/overview-defaults', '/v1/promo-codes', '/v1/me/settingsx', '/v1/quest-pointsx', '/health',
  ]) assert.ok(!isPaidContentPath(path), path)
  assert.ok(!PAID_CONTENT_PATH.test('/v1/me'))
})

test('paid content: 401 signed out, 402 without subscription, 403 without this session\'s device, 200 with all three', async () => {
  await withApi(async ({ call, accounts, paid, advance }) => {
    assert.deepEqual(await statuses(call, {}), all(401))
    const token = (await accounts.register('player@example.com', 'correct horse battery')).token
    const id = accounts.authenticate(token)!
    advance(WELCOME_TRIAL_MS) // the free days after registration are over
    const refused = await call('GET', '/v1/quest-points', { token, device: DEVICE })
    assert.equal(refused.status, 402)
    assert.deepEqual(await refused.json(), { error: 'Нужна подписка', code: 'subscription_required' })
    assert.deepEqual(await statuses(call, { token, device: DEVICE }), all(402))
    // Writes are refused before the routes too (nothing is kept, nothing removed).
    assert.equal((await call('PUT', '/v1/me/settings', { token, device: DEVICE, body: { settings: { theme: 'x' } } })).status, 402)
    assert.equal((await call('POST', '/v1/me/progress/pvp/reset', { token, device: DEVICE, body: {} })).status, 402)
    assert.equal((await call('POST', '/v1/builds', { token, device: DEVICE, body: {} })).status, 402)

    paid.set(id, Date.now() + 30 * DAY)
    const inactive = await call('GET', '/v1/me/settings', { token, device: DEVICE })
    assert.equal(inactive.status, 403)
    assert.equal((await inactive.json() as { code: string }).code, 'device_inactive')
    assert.deepEqual(await statuses(call, { token }), all(403), 'no device id at all')
    assert.equal((await call('POST', '/v1/entitlement', { token, body: { deviceId: DEVICE } })).status, 200)
    assert.deepEqual(await statuses(call, { token, device: DEVICE }), all(200))
    // A photo the server does not hold: past the check, the route's own 404.
    assert.equal((await call('GET', '/v1/me/quest-point-photos/0123456789abcdef01234567', { token, device: DEVICE })).status, 404)
    // Another session of the account on the same device id: not this session's device.
    const other = (await accounts.login('player@example.com', 'correct horse battery')).token
    assert.equal((await call('GET', '/v1/quest-texts', { token: other, device: DEVICE })).status, 403)
  })
})

test('paid content: the free period and the owner (no device) pass; the access ends, the data waits on the server', async () => {
  await withApi(async ({ call, accounts, paid, advance }) => {
    // Free days after registration: a trial with this device registered.
    const token = (await accounts.register('trial@example.com', 'correct horse battery')).token
    const id = accounts.authenticate(token)!
    const issued = await call('POST', '/v1/entitlement', { token, body: { deviceId: DEVICE } })
    assert.equal(issued.status, 200)
    assert.equal((await issued.json() as { plan: string }).plan, 'trial')
    assert.deepEqual(await statuses(call, { token, device: DEVICE }), all(200))
    const saved = await call('PUT', '/v1/me/settings', { token, device: DEVICE, body: { settings: { theme: 'dark' } } })
    assert.equal(saved.status, 200)

    // The free days end: refused, and the settings are still there once paid.
    advance(WELCOME_TRIAL_MS)
    assert.equal((await call('GET', '/v1/me/settings', { token, device: DEVICE })).status, 402)
    assert.equal((await call('PUT', '/v1/me/settings', { token, device: DEVICE, body: { settings: {} } })).status, 402)
    paid.set(id, Date.now() + 60 * DAY)
    const back = await call('GET', '/v1/me/settings', { token, device: DEVICE })
    assert.equal(back.status, 200)
    assert.deepEqual((await back.json() as { settings: unknown }).settings, { theme: 'dark' })

    // The owner's own account: no device (website, scripts, the admin app), as for the game data.
    const { salt, hash } = await newPasswordHash('correct horse battery')
    const owner = accounts.createVerifiedAccount('owner@example.com', salt, hash).token
    assert.deepEqual(await statuses(call, { token: owner }), all(200))
  })
})

test('paid content: without a subscription the account, the website cabinet, support, notices and the signals still work', async () => {
  await withApi(async ({ call, accounts, advance }) => {
    const token = (await accounts.register('free@example.com', 'correct horse battery')).token
    // The website: a session without a device.
    for (const path of ['/v1/accounts/me', '/v1/me/summary', '/v1/me/features', '/v1/me/notices', '/v1/me/support/messages', '/v1/accounts/me/devices']) {
      const response = await call('GET', path, { token })
      assert.equal(response.status, 200, path)
      await response.arrayBuffer()
    }
    for (const path of ['/v1/payments/plans', '/v1/map-updates', '/v1/map-tiles/status', '/v1/announcement', '/v1/player-news', '/v1/entitlement/public-key', '/health']) {
      const response = await call('GET', path)
      assert.equal(response.status, 200, path)
      await response.arrayBuffer()
    }
    // «Нужна подписка» in the app: the welcome days start with the first device (claimTrialDevice), so once they are over
    // POST /v1/entitlement answers 402 with the subscription state and the device stays registered.
    assert.equal((await call('POST', '/v1/entitlement', { token, body: { deviceId: DEVICE } })).status, 200)
    advance(WELCOME_TRIAL_MS)
    const refused = await call('POST', '/v1/entitlement', { token, body: { deviceId: DEVICE } })
    assert.equal(refused.status, 402)
    assert.equal((await refused.json() as { code: string }).code, 'subscription_required')
    assert.equal((await call('GET', '/v1/accounts/me/devices', { token })).status, 200)
  })
})

test('paid content: off unless asked for (the routes\' own tests, RAIDOS_PAID_CONTENT=0)', async () => {
  await withApi(async ({ call }) => {
    assert.equal((await call('GET', '/v1/quest-points')).status, 200)
    assert.equal((await call('GET', '/v1/map-bosses')).status, 200)
  }, {})
})
