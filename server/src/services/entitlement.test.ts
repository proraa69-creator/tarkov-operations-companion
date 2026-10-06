import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { AccountStore, newPasswordHash, type SubscriptionSource } from './accountStore.js'
import { ENTITLEMENT_GRACE_MS, ENTITLEMENT_KEY_FILE, ENTITLEMENT_TTL_MS, EntitlementService, loadEntitlementKey, publicKeyX } from './entitlement.js'
import { checkEntitlementClaims, parseEntitlementToken } from '../../../src/shared/entitlementToken'
import { createApi } from '../app.js'
import { ProgressStore } from './progressStore.js'
import { DataGateway } from './dataGateway.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const device = (n: number) => `device-${String(n).padStart(2, '0')}-abcdefghijklmnopqrstu`

function setup(options: { maxDevices?: number } = {}) {
  let now = Date.parse('2026-10-01T12:00:00Z')
  const paid = new Map<string, number>()
  const accounts = new AccountStore({ now: () => now, ownerEmails: ['owner@example.com'] })
  const source: SubscriptionSource = { paidUntil: (id) => paid.get(id), referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0 }), referralSeries: () => [] }
  accounts.attachSubscriptions(source)
  const privateKey = generateKeyPairSync('ed25519').privateKey
  const entitlements = new EntitlementService(accounts, { privateKey, maxDevices: options.maxDevices })
  return { accounts, entitlements, paid, privateKey, clock: { get now() { return now }, set now(value: number) { now = value } } }
}

function verifyToken(token: string, publicKey: string) {
  const parsed = parseEntitlementToken(token)
  assert.ok(parsed, 'token parses')
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' })
  return { ok: verify(null, parsed.signed, key, parsed.signature), claims: parsed.claims }
}

test('access: inactive gets nothing, paid / trial / streamer / owner get a signed token with the right expiry', async () => {
  const { accounts, entitlements, paid, clock } = setup()
  const user = await accounts.register('user@example.com', 'correct horse battery')
  const id = accounts.authenticate(user.token)!
  assert.equal(entitlements.access(id), undefined)
  assert.equal(entitlements.issue(id, device(1)), undefined)

  // Paid for 10 days: the token lives 72 h (offline grace).
  paid.set(id, clock.now + 10 * DAY)
  const long = entitlements.issue(id, device(1))!
  assert.equal(long.claims.plan, 'paid')
  assert.equal(long.claims.exp - long.claims.iat, ENTITLEMENT_TTL_MS)
  const checked = verifyToken(long.token, entitlements.publicKey)
  assert.equal(checked.ok, true)
  assert.deepEqual(checked.claims, long.claims)

  // Paid for 2 more hours: never beyond the paid period + grace.
  paid.set(id, clock.now + 2 * HOUR)
  const short = entitlements.issue(id, device(1))!
  assert.equal(short.claims.exp, clock.now + 2 * HOUR + ENTITLEMENT_GRACE_MS)

  // Owner (proven e-mail) and his plan.
  const { salt, hash } = await newPasswordHash('correct horse battery')
  const owner = accounts.createVerifiedAccount('owner@example.com', salt, hash)
  assert.equal(entitlements.access(accounts.authenticate(owner.token)!)?.plan, 'owner')
})

test('token check: signature, device, expiry and a clock turned back', async () => {
  const { accounts, entitlements, paid, clock } = setup()
  const user = await accounts.register('user@example.com', 'correct horse battery')
  const id = accounts.authenticate(user.token)!
  paid.set(id, clock.now + 30 * DAY)
  const { token, claims } = entitlements.issue(id, device(1))!
  assert.deepEqual(checkEntitlementClaims(claims, { deviceId: device(1), now: clock.now + HOUR }), { ok: true })
  assert.deepEqual(checkEntitlementClaims(claims, { deviceId: device(2), now: clock.now }), { ok: false, reason: 'device' })
  assert.deepEqual(checkEntitlementClaims(claims, { deviceId: device(1), now: claims.exp }), { ok: false, reason: 'expired' })
  assert.deepEqual(checkEntitlementClaims(claims, { deviceId: device(1), now: clock.now - DAY }), { ok: false, reason: 'clock' })
  assert.deepEqual(checkEntitlementClaims(claims, { deviceId: device(1), now: clock.now, seenAt: clock.now + DAY }), { ok: false, reason: 'clock' })

  // Another key (a forged token) or a changed claim does not verify.
  const other = generateKeyPairSync('ed25519').privateKey
  assert.equal(verifyToken(token, publicKeyX(other)).ok, false)
  const [prefix, body, signature] = token.split('.')
  const forgedBody = Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 365 * DAY })).toString('base64url')
  assert.equal(verifyToken(`${prefix}.${forgedBody}.${signature}`, entitlements.publicKey).ok, false)
  assert.ok(body)
  assert.equal(parseEntitlementToken('RE1.bad'), null)
})

test('devices: at most 3 active, the least recently used one is switched off and signed out; the owner has no limit', async () => {
  const { accounts, entitlements, paid, clock } = setup()
  const sessions: string[] = []
  for (let n = 0; n < 4; n += 1) sessions.push(n === 0 ? (await accounts.register('user@example.com', 'correct horse battery')).token : (await accounts.login('user@example.com', 'correct horse battery')).token)
  const id = accounts.authenticate(sessions[0])!
  paid.set(id, clock.now + 30 * DAY)
  const { tokenDigest } = await import('./accountStore.js')
  for (let n = 0; n < 3; n += 1) {
    clock.now += 60_000
    assert.deepEqual(entitlements.registerDevice(id, device(n), `PC ${n}`, tokenDigest(sessions[n]!)).revoked, [])
  }
  // Device 0 is used again later, so device 1 is now the least recently used one.
  clock.now += 10 * 60_000
  assert.equal(entitlements.isActiveDevice(id, device(0), tokenDigest(sessions[0]!)), true)
  clock.now += 60_000
  const fourth = entitlements.registerDevice(id, device(3), 'Laptop', tokenDigest(sessions[3]!))
  assert.deepEqual(fourth.revoked.map((entry) => entry.name), ['PC 1'])
  assert.equal(entitlements.isActiveDevice(id, device(1), tokenDigest(sessions[1]!)), false)
  assert.equal(entitlements.revokedReason(id, device(1)), 'limit')
  assert.equal(accounts.authenticate(sessions[1]), undefined, 'the switched-off device is signed out')
  assert.ok(accounts.authenticate(sessions[0]))
  assert.equal(entitlements.devices(id).filter((entry) => entry.active).length, 3)

  // Re-activation of a switched-off device again pushes the least recently used out.
  clock.now += 60_000
  const back = entitlements.registerDevice(id, device(1), 'PC 1')
  assert.equal(back.revoked.length, 1)
  assert.equal(entitlements.devices(id).filter((entry) => entry.active).length, 3)

  // Owner: unlimited devices.
  const { salt, hash } = await newPasswordHash('correct horse battery')
  const owner = accounts.authenticate(accounts.createVerifiedAccount('owner@example.com', salt, hash).token)!
  for (let n = 0; n < 6; n += 1) assert.deepEqual(entitlements.registerDevice(owner, device(10 + n), 'owner PC').revoked, [])
  assert.equal(entitlements.devices(owner).filter((entry) => entry.active).length, 6)
})

test('device activations are rate limited per account and day', async () => {
  let now = Date.now()
  const accounts = new AccountStore({ now: () => now })
  const entitlements = new EntitlementService(accounts, { activationsPerDay: 2 })
  const id = accounts.authenticate((await accounts.register('user@example.com', 'correct horse battery')).token)!
  entitlements.registerDevice(id, device(1), 'a')
  entitlements.registerDevice(id, device(2), 'b')
  // Refreshing a known device is not an activation.
  entitlements.registerDevice(id, device(1), 'a')
  assert.throws(() => entitlements.registerDevice(id, device(3), 'c'), (error: Error & { status?: number }) => error.status === 429)
  now += 25 * HOUR
  assert.doesNotThrow(() => entitlements.registerDevice(id, device(3), 'c'))
})

test('the signing key: environment first, else a 0600 file next to the database that survives restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-key-'))
  const first = loadEntitlementKey({ dir, env: '' })
  const file = join(dir, ENTITLEMENT_KEY_FILE)
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(publicKeyX(loadEntitlementKey({ dir, env: '' })), publicKeyX(first), 'same key after a restart')
  const pem = readFileSync(file, 'utf8')
  assert.equal(publicKeyX(loadEntitlementKey({ env: Buffer.from(pem).toString('base64') })), publicKeyX(first), 'base64 PEM in the environment')
  const other = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  assert.notEqual(publicKeyX(loadEntitlementKey({ dir, env: other })), publicKeyX(first), 'the environment wins')
})

test('HTTP: public key, issue with device registration, 402 without a subscription, owner device list and revoke', async () => {
  const { accounts, entitlements, paid, clock } = setup()
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, { entitlements }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, token?: string, body?: unknown) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  try {
    const key = await (await call('GET', '/v1/entitlement/public-key')).json() as { publicKey: string; algorithm: string; deviceLimit: number }
    assert.deepEqual(key, { algorithm: 'Ed25519', publicKey: entitlements.publicKey, deviceLimit: 3 })

    assert.equal((await call('POST', '/v1/entitlement', undefined, { deviceId: device(1) })).status, 401)
    const user = (await accounts.register('user@example.com', 'correct horse battery')).token
    const id = accounts.authenticate(user)!
    assert.equal((await call('POST', '/v1/entitlement', user, { deviceId: 'short' })).status, 400)
    const denied = await call('POST', '/v1/entitlement', user, { deviceId: device(1), deviceName: 'Windows · Raid OS' })
    assert.equal(denied.status, 402)
    const deniedBody = await denied.json() as { error: string; code: string; subscription: { status: string } }
    assert.equal(deniedBody.error, 'Нужна подписка')
    assert.equal(deniedBody.subscription.status, 'inactive')

    paid.set(id, clock.now + 30 * DAY)
    const granted = await call('POST', '/v1/entitlement', user, { deviceId: device(1), deviceName: 'Windows · Raid OS' })
    assert.equal(granted.status, 200)
    const answer = await granted.json() as { token: string; plan: string; expiresAt: string }
    assert.equal(answer.plan, 'paid')
    assert.equal(verifyToken(answer.token, key.publicKey).ok, true)
    const own = await (await call('GET', '/v1/accounts/me/devices', user)).json() as { devices: Array<{ name: string; active: boolean }> }
    assert.deepEqual(own.devices.map((entry) => [entry.name, entry.active]), [['Windows · Raid OS', true]])

    // Owner admin: other accounts get 404, the owner lists and revokes (and the device's session is signed out).
    assert.equal((await call('GET', `/v1/accounts/me/admin/users/${id}/devices`, user)).status, 404)
    const { salt, hash } = await newPasswordHash('correct horse battery')
    const owner = accounts.createVerifiedAccount('owner@example.com', salt, hash).token
    const listed = await (await call('GET', `/v1/accounts/me/admin/users/${id}/devices`, owner)).json() as { devices: Array<{ id: string }>; limit: number }
    assert.equal(listed.devices[0]!.id, device(1))
    assert.equal(listed.limit, 3)
    const revoked = await call('POST', `/v1/accounts/me/admin/users/${id}/devices/${device(1)}/revoke`, owner)
    assert.equal(revoked.status, 200)
    assert.equal(((await revoked.json()) as { devices: Array<{ active: boolean; revokedReason?: string }> }).devices[0]!.revokedReason, 'owner')
    assert.equal(accounts.authenticate(user), undefined)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})

test('one session per device: the gateway checks device AND session, a new session on the device signs the old one out', async () => {
  const { accounts, entitlements, paid, clock } = setup()
  const { tokenDigest } = await import('./accountStore.js')
  const first = (await accounts.register('user@example.com', 'correct horse battery')).token
  const second = (await accounts.login('user@example.com', 'correct horse battery')).token
  const id = accounts.authenticate(first)!
  paid.set(id, clock.now + 30 * DAY)
  entitlements.registerDevice(id, device(1), 'PC', tokenDigest(first))
  assert.equal(entitlements.isActiveDevice(id, device(1), tokenDigest(first)), true)
  // Another session sending the same device id is not that device.
  assert.equal(entitlements.isActiveDevice(id, device(1), tokenDigest(second)), false)
  assert.equal(entitlements.isActiveDevice(id, device(1), undefined), false)
  assert.equal(entitlements.revokedReason(id, device(1)), undefined, 'answered as device_inactive')
  // Registering the device with the second session takes it over: the first session ends.
  assert.deepEqual(entitlements.registerDevice(id, device(1), 'PC', tokenDigest(second)).revoked, [])
  assert.equal(accounts.authenticate(first), undefined)
  assert.equal(entitlements.isActiveDevice(id, device(1), tokenDigest(second)), true)
  // Refreshing with the same session changes nothing.
  entitlements.registerDevice(id, device(1), 'PC', tokenDigest(second))
  assert.ok(accounts.authenticate(second))
})

test('streamer-code trial: a device that already served another account\'s trial gives none to the next account', async () => {
  const { accounts, entitlements } = setup()
  await accounts.register('tv@example.com', 'correct horse battery')
  accounts.promoteToStreamer('tv@example.com', 'hunter_tv')
  const { tokenDigest } = await import('./accountStore.js')
  const a = (await accounts.register('first@example.com', 'correct horse battery', 'HUNTER_TV')).token
  const b = (await accounts.register('second@example.com', 'correct horse battery', 'HUNTER_TV')).token
  const c = (await accounts.register('third@example.com', 'correct horse battery', 'HUNTER_TV')).token
  const [idA, idB, idC] = [a, b, c].map((token) => accounts.authenticate(token)!)
  entitlements.registerDevice(idA, device(1), 'PC', tokenDigest(a))
  assert.equal(entitlements.issue(idA, device(1))?.claims.plan, 'trial')
  // Same PC, another account: the trial is gone (status inactive → 402), the referral still counts.
  entitlements.registerDevice(idB, device(1), 'PC', tokenDigest(b))
  assert.equal(entitlements.issue(idB, device(1)), undefined)
  assert.deepEqual(accounts.view(idB).subscription, { status: 'inactive' })
  assert.equal(accounts.view(idB).referredBy, 'HUNTER_TV')
  entitlements.registerDevice(idB, device(4), 'Laptop B', tokenDigest(b))
  assert.equal(accounts.view(idB).subscription.status, 'inactive', 'also on a fresh device afterwards')
  // The first account keeps its trial (also on its other devices), another PC gives the third account its own.
  entitlements.registerDevice(idA, device(2), 'Laptop', tokenDigest((await accounts.login('first@example.com', 'correct horse battery')).token))
  assert.equal(accounts.view(idA).subscription.status, 'trial')
  entitlements.registerDevice(idC, device(3), 'PC 3', tokenDigest(c))
  assert.equal(accounts.view(idC).subscription.status, 'trial')
  const tv = accounts.authenticate((await accounts.login('tv@example.com', 'correct horse battery')).token)!
  assert.equal(accounts.view(tv).stats?.registrations, 3)
})

test('HTTP data gate: a session that did not register the device gets 403 device_inactive; re-registering signs the other PC out', async () => {
  const { accounts, entitlements, paid, clock } = setup()
  const fetcher = (async () => new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, { entitlements, data: new DataGateway({ fetch: fetcher }) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (path: string, token: string, body: unknown, deviceId?: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(deviceId ? { 'x-raid-device': deviceId } : {}) }, body: JSON.stringify(body) })
  try {
    const pcA = (await accounts.register('user@example.com', 'correct horse battery')).token
    const pcB = (await accounts.login('user@example.com', 'correct horse battery')).token
    paid.set(accounts.authenticate(pcA)!, clock.now + 30 * DAY)
    const query = { query: '{ items { id } }' }
    assert.equal((await call('/v1/entitlement', pcA, { deviceId: device(1) })).status, 200)
    assert.equal((await call('/v1/data/graphql', pcA, query, device(1))).status, 200)
    // PC B copies the device id but has its own session: refused.
    const copied = await call('/v1/data/graphql', pcB, query, device(1))
    assert.equal(copied.status, 403)
    assert.equal((await copied.json() as { code: string }).code, 'device_inactive')
    // PC B registers the device for itself: PC A's session ends (401), PC B works.
    assert.equal((await call('/v1/entitlement', pcB, { deviceId: device(1) })).status, 200)
    assert.equal((await call('/v1/data/graphql', pcA, query, device(1))).status, 401)
    assert.equal((await call('/v1/data/graphql', pcB, query, device(1))).status, 200)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})
