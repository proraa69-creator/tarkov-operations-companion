import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { BoostyPayments, parseLevelMap } from './boosty.js'
import { BOOSTY_TOKEN_DEAD, BoostyClient, BoostyTokenStore, boostyCredentialsFromEnv, boostyPeriodMs, normalizeSubscriber, parseBoostyAuth, sanitizeBoostyError, type BoostyCredentials } from './boostyClient.js'
import { BoostySync } from './boostySync.js'
import { openDatabase } from './database.js'
import { InviteProgram } from './invites.js'
import { PaymentStore } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'

/**
 * Automatic Boosty issuance (services/boostyClient.ts, boosty.ts, boostySync.ts; docs/payments/payment-regions-and-
 * announcements.md «Automatic issuance»). No network: Boosty is a fake fetch.
 */
const DAY = 86_400_000
const password = 'correct horse battery'
const ACCESS = 'acc-SECRET-0123456789abcdefghijklmnop'
const REFRESH = 'ref-SECRET-0123456789abcdefghijklmnop'
const DEVICE = 'dev-SECRET-0123456789abcdef'
const AUTH = JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: Date.parse('2026-12-01T00:00:00Z') })
const credentials = (auth = AUTH): BoostyCredentials => ({ auth, clientId: DEVICE, blog: 'raidosapp' })
const SECRETS = [ACCESS, REFRESH, DEVICE, 'NEW-ACCESS-0123456789abcdefghij', 'NEW-REFRESH-0123456789abcdefghij']
const noSecrets = (text: string) => { for (const secret of SECRETS) assert.ok(!text.includes(secret), 'a secret leaked') }

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }
/** A fake Boosty: `routes` answers by URL; every call is recorded. */
function fakeBoosty(routes: (call: Call, index: number) => Response) {
  const calls: Call[] = []
  const fetchFake: typeof globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call: Call = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), ...(typeof init.body === 'string' ? { body: init.body } : {}) }
    calls.push(call)
    return routes(call, calls.length - 1)
  }) as unknown as typeof fetch
  return { fetch: fetchFake, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** A raw subscriber as Boosty sends it (fields of the unofficial clients). */
const raw = (id: number, email: string, levelId: number, nextPay: number | undefined, extra: Record<string, unknown> = {}) => ({
  id, name: `user${id}`, email, status: 'active', subscribed: true, price: 300, payments: 300,
  level: { id: levelId, name: `level ${levelId}`, price: 300, isFree: false }, onTime: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000),
  ...(nextPay === undefined ? {} : { nextPayTime: Math.floor(nextPay / 1000) }), ...extra,
})

test('environment: both values needed; primary names and aliases; the blog and the period', () => {
  assert.equal(boostyCredentialsFromEnv({}), undefined)
  assert.equal(boostyCredentialsFromEnv({ BOOSTY_AUTH: AUTH }), undefined)
  assert.equal(boostyCredentialsFromEnv({ BOOSTY_CLIENT_ID: DEVICE }), undefined)
  assert.deepEqual(boostyCredentialsFromEnv({ BOOSTY_AUTH: AUTH, BOOSTY_CLIENT_ID: DEVICE }), { auth: AUTH, clientId: DEVICE, blog: 'raidosapp' })
  for (const env of [{ BOOSTY_AUTH_JSON: AUTH, BOOSTY_DEVICE_ID: DEVICE }, { BOOSTY_AUTH: AUTH, BOOSTY_CLIENTID: DEVICE }]) assert.equal(boostyCredentialsFromEnv(env)?.clientId, DEVICE)
  assert.equal(boostyCredentialsFromEnv({ BOOSTY_AUTH: AUTH, BOOSTY_CLIENT_ID: DEVICE, BOOSTY_BLOG: 'other_blog' })?.blog, 'other_blog')
  assert.equal(boostyCredentialsFromEnv({ BOOSTY_AUTH: AUTH, BOOSTY_CLIENT_ID: DEVICE, BOOSTY_BLOG: '../x?' })?.blog, 'raidosapp')
  assert.equal(boostyPeriodMs(undefined), 5 * 60_000)
  assert.equal(boostyPeriodMs('10'), 10 * 60_000)
  assert.equal(boostyPeriodMs('0'), 5 * 60_000)
})

test('the auth value: localStorage JSON, snake_case, URL-encoded, a JSON string; anything else is no token', () => {
  assert.deepEqual(parseBoostyAuth(AUTH), { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: Date.parse('2026-12-01T00:00:00Z') })
  assert.equal(parseBoostyAuth(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1_800_000_000 }))?.expiresAt, 1_800_000_000_000)
  assert.equal(parseBoostyAuth(encodeURIComponent(AUTH))?.accessToken, ACCESS)
  assert.equal(parseBoostyAuth(JSON.stringify(AUTH))?.refreshToken, REFRESH)
  for (const bad of ['', 'nope', '{}', JSON.stringify({ accessToken: 'a' })]) assert.equal(parseBoostyAuth(bad), undefined)
})

test('subscribers: every page, the Bearer token, numeric offsets; fields read defensively', async () => {
  const boosty = fakeBoosty((call) => {
    const offset = Number(new URL(call.url).searchParams.get('offset'))
    const count = offset === 0 ? 100 : 50
    return json({ data: Array.from({ length: count }, (_, i) => raw(offset + i + 1, `u${offset + i}@example.com`, 4136082, Date.parse('2026-11-15T00:00:00Z'))), total: 150, offset, limit: 100 })
  })
  const client = new BoostyClient(credentials(), new BoostyTokenStore(undefined), { fetch: boosty.fetch, now: () => Date.parse('2026-10-16T00:00:00Z'), pageDelayMs: 0 })
  const list = await client.subscribers()
  assert.equal(list.length, 150)
  assert.deepEqual(boosty.calls.map((call) => new URL(call.url).pathname + new URL(call.url).search), ['/v1/blog/raidosapp/subscribers?limit=100&offset=0', '/v1/blog/raidosapp/subscribers?limit=100&offset=100'])
  assert.ok(boosty.calls.every((call) => call.headers.authorization === `Bearer ${ACCESS}` && call.url.startsWith('https://api.boosty.to/')))
  assert.deepEqual(list[0], { userId: '1', email: 'u0@example.com', levelId: '4136082', levelName: 'level 4136082', price: 300, active: true, paidUntil: Date.parse('2026-11-15T00:00:00Z'), since: Date.parse('2026-10-01T00:00:00Z') })
  // A RUB price among several currencies; a free follower, a cancelled one and junk are not active / skipped.
  assert.equal(normalizeSubscriber({ ...raw(2, 'A@B.C', 1, undefined), level: { id: 1, price: 5, currencyPrices: { RUB: 450, USD: 5 } } })?.price, 450)
  assert.equal(normalizeSubscriber({ ...raw(2, 'A@B.C', 1, undefined) })?.email, 'a@b.c')
  assert.equal(normalizeSubscriber({ ...raw(3, 'x@y.z', 1, undefined), price: 0, level: { id: 1, price: 0, isFree: true } })?.active, false)
  assert.equal(normalizeSubscriber({ ...raw(4, 'x@y.z', 1, undefined), subscribed: false })?.active, false)
  assert.equal(normalizeSubscriber({ name: 'no id' }), undefined)
  assert.equal(normalizeSubscriber(null), undefined)
})

test('a 401 refreshes the token once (form body, device id), the rotated pair is saved with mode 600 and survives a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-boosty-'))
  try {
    const file = join(dir, 'boosty-tokens.json')
    let now = Date.parse('2026-10-16T00:00:00Z')
    const boosty = fakeBoosty((call) => {
      if (call.url.endsWith('/oauth/token/')) return json({ access_token: SECRETS[3], refresh_token: SECRETS[4], expires_in: 3600 })
      if (call.headers.authorization === `Bearer ${ACCESS}`) return json({ error: 'unauthorized' }, 401)
      return json({ data: [raw(1, 'a@example.com', 4136082, now + 20 * DAY)], total: 1 })
    })
    const client = new BoostyClient(credentials(), new BoostyTokenStore(file), { fetch: boosty.fetch, now: () => now, pageDelayMs: 0 })
    assert.equal((await client.subscribers()).length, 1)
    assert.deepEqual(boosty.calls.map((call) => call.method), ['GET', 'POST', 'GET'])
    const refresh = boosty.calls[1]!
    assert.equal(refresh.headers['content-type'], 'application/x-www-form-urlencoded')
    const form = new URLSearchParams(refresh.body)
    assert.deepEqual([form.get('grant_type'), form.get('refresh_token'), form.get('device_id'), form.get('device_os')], ['refresh_token', REFRESH, DEVICE, 'web'])
    assert.equal(boosty.calls[2]!.headers.authorization, `Bearer ${SECRETS[3]}`)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    assert.deepEqual([saved.accessToken, saved.refreshToken, saved.expiresAt], [SECRETS[3], SECRETS[4], now + 3600_000])
    assert.ok(!JSON.stringify(saved).includes(AUTH) && !JSON.stringify(saved).includes(DEVICE), 'the seed itself is not stored')

    // A restart with the same environment uses the rotated tokens; a new BOOSTY_AUTH replaces them.
    boosty.calls.length = 0
    await new BoostyClient(credentials(), new BoostyTokenStore(file), { fetch: boosty.fetch, now: () => now, pageDelayMs: 0 }).subscribers()
    assert.deepEqual(boosty.calls.map((call) => [call.method, call.headers.authorization]), [['GET', `Bearer ${SECRETS[3]}`]])
    const otherSeed = JSON.stringify({ accessToken: 'fresh-from-owner-0123456789abcdef', refreshToken: 'r2-0123456789abcdefgh', expiresAt: now + DAY })
    boosty.calls.length = 0
    await new BoostyClient(credentials(otherSeed), new BoostyTokenStore(file), { fetch: boosty.fetch, now: () => now, pageDelayMs: 0 }).subscribers()
    assert.equal(boosty.calls[0]!.headers.authorization, 'Bearer fresh-from-owner-0123456789abcdef')

    // An access token about to expire is refreshed before the request.
    now += 10 * DAY
    boosty.calls.length = 0
    await new BoostyClient(credentials(), new BoostyTokenStore(file), { fetch: boosty.fetch, now: () => now, pageDelayMs: 0 }).subscribers()
    assert.deepEqual(boosty.calls.map((call) => call.method), ['POST', 'GET'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('errors are sanitised: a dead token says «обновите BOOSTY_AUTH»; no token, device id or Boosty body anywhere', async () => {
  const dead = fakeBoosty((call) => (call.url.endsWith('/oauth/token/') ? json({ error: 'invalid_grant', error_description: `bad ${REFRESH}` }, 400) : json({ error: 'unauthorized' }, 401)))
  const client = new BoostyClient(credentials(), new BoostyTokenStore(undefined), { fetch: dead.fetch, now: () => Date.parse('2026-10-16T00:00:00Z'), pageDelayMs: 0 })
  await assert.rejects(client.subscribers(), (error: Error & { tokenDead?: boolean }) => error.message === BOOSTY_TOKEN_DEAD && error.tokenDead === true)

  const leaky = fakeBoosty(() => json({ error: `boom ${ACCESS}`, detail: REFRESH }, 500))
  const second = new BoostyClient(credentials(), new BoostyTokenStore(undefined), { fetch: leaky.fetch, now: () => Date.parse('2026-10-16T00:00:00Z'), pageDelayMs: 0 })
  await assert.rejects(second.subscribers(), (error: Error) => { noSecrets(error.message); assert.match(error.message, /500/); return true })
  assert.equal(sanitizeBoostyError(new Error(`x ${ACCESS}`)), 'Ошибка синхронизации с Boosty')
  assert.equal(sanitizeBoostyError(Object.assign(new Error('t'), { name: 'TimeoutError' })), 'Boosty не ответил вовремя')
  assert.equal(sanitizeBoostyError(new TypeError('fetch failed')), 'Нет связи с Boosty')
})

/** A server with the Boosty job wired as index.ts does, a fake Boosty behind it. */
async function setup(subscribers: () => unknown[]) {
  const clock = Date.parse('2026-10-16T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [], now })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now })
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_x', monthPrice: 300, receipts: false, streamerPercent: 0, publicUrl: 'https://raidos.example.com' }, { now })
  accounts.attachSubscriptions(payments)
  const invites = new InviteProgram(accounts, payments, { now })
  const boosty = new BoostyPayments(accounts, payments, invites, { now, levelMap: JSON.stringify({ 'name:raid os мир скидка': 'WORLD_FRIEND' }) })
  const fake = fakeBoosty((call) => (call.url.endsWith('/oauth/token/') ? json({ error: 'invalid_grant' }, 400) : json({ data: subscribers(), total: subscribers().length })))
  const client = new BoostyClient(credentials(), new BoostyTokenStore(undefined), { fetch: fake.fetch, now, pageDelayMs: 0 })
  const sync = new BoostySync(boosty, client, { periodMs: 5 * 60_000, now })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, invites, boosty, boostySync: sync, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = undefined }
    return { status: response.status, json: parsed as T, text }
  }
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  const player = async (email: string, country: string, referralCode?: string) => {
    const registered = await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country, ...(referralCode ? { referralCode } : {}) })
    assert.equal(registered.status, 201, JSON.stringify(registered.json))
    return registered.json.token
  }
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  return {
    db, accounts, payments, boosty, sync, fake, call, owner, player, idOf,
    get now() { return clock },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

type Review = { items: Array<{ id: number; reason: string; email: string; levelId?: string; status: string }>; total: number }
const boostyPayments = (db: ReturnType<typeof openDatabase>, accountId: string) => (db.prepare("SELECT plan, amount, discount_percent FROM payments WHERE provider = 'boosty' AND account_id = ? ORDER BY created_at").all(accountId) as Array<Record<string, unknown>>).map((row) => ({ ...row }))

test('the sync grants by e-mail and level up to Boosty\'s paid-until + 1 day, once per period; the rest goes to the review list', async () => {
  let list: unknown[] = []
  const t = await setup(() => list)
  const silenced = console.warn
  const logged: string[] = []
  console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  try {
    const inviter = await t.player('inviter@example.com', 'RU')
    const code = (await t.call<{ code: string }>('GET', '/accounts/me/invites', inviter)).json.code
    await t.player('kz@example.com', 'KZ')
    await t.player('de@example.com', 'DE')
    await t.player('ru@example.com', 'RU')
    const friendToken = await t.player('friend@example.com', 'BY', code)
    await t.player('nofriend@example.com', 'AM')
    await t.player('long@example.com', 'US')
    // A long subscription already there: Boosty never shortens it.
    t.payments.extendTo(t.idOf('long@example.com'), t.now + 300 * DAY)
    const until = t.now + 25 * DAY
    list = [
      raw(1, 'KZ@Example.com', 4136107, until), // CIS standard → granted (e-mail case-insensitive)
      raw(2, 'de@example.com', 4136107, until), // CIS offer, WORLD account → review
      raw(3, 'ru@example.com', 4136082, until), // Russia → review
      raw(4, 'stranger@example.com', 4136082, until), // no account → review
      raw(5, 'friend@example.com', 4136111, until, { price: 240, level: { id: 4136111, name: 'CIS friend', price: 240 } }), // friend with a code → granted, spent
      raw(6, 'nofriend@example.com', 4136111, until), // friend offer without a code → review
      raw(7, 'kz2@example.com', 999, until, { level: { id: 999, name: 'Mystery', price: 777 } }), // unknown level → review
      raw(8, 'long@example.com', 4136082, until), // WORLD standard on a longer subscription → recorded, not shortened
      raw(9, 'de@example.com', 4136082, undefined), // no paid-until → review
      raw(10, 'free@example.com', 1, until, { price: 0, level: { id: 1, name: 'Follower', price: 0, isFree: true } }), // free: ignored
    ]
    const status = await t.sync.runOnce()
    assert.equal(status.lastError, undefined)
    assert.deepEqual(status.lastResult, { subscribers: 10, active: 9, granted: 3, adopted: 0, review: 6, unchanged: 0 })
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), until + DAY)
    assert.deepEqual(boostyPayments(t.db, t.idOf('kz@example.com')), [{ plan: '1m', amount: 30000, discount_percent: null }])
    assert.equal(t.payments.paidUntil(t.idOf('friend@example.com')), until + DAY)
    assert.deepEqual(boostyPayments(t.db, t.idOf('friend@example.com')), [{ plan: '1m', amount: 24000, discount_percent: 20 }])
    // The friend discount is spent: not offered again, also after a reload.
    assert.deepEqual((await t.call<{ boosty: unknown }>('GET', '/payments', friendToken)).json.boosty, { offers: ['standard'] })
    assert.equal(t.payments.paidUntil(t.idOf('long@example.com')), t.now + 300 * DAY)
    assert.equal(boostyPayments(t.db, t.idOf('long@example.com')).length, 1)
    for (const email of ['de@example.com', 'ru@example.com', 'nofriend@example.com']) assert.equal(t.payments.paidUntil(t.idOf(email)), undefined, email)

    const panel = await t.call<{ sync: { configured: boolean; lastSyncAt: string; tokenDead: boolean }; review: Review; levels: Array<{ levelId: string; name: string; price: number }> }>('GET', '/accounts/me/admin/boosty', t.owner)
    assert.equal(panel.status, 200)
    assert.equal(panel.json.sync.configured, true)
    assert.equal(panel.json.sync.tokenDead, false)
    const reasons = Object.fromEntries(panel.json.review.items.map((item) => [`${item.email}|${item.levelId}`, item.reason]))
    assert.deepEqual(reasons, {
      'de@example.com|4136107': 'region_mismatch', 'ru@example.com|4136082': 'region_mismatch', 'stranger@example.com|4136082': 'unknown_email',
      'nofriend@example.com|4136111': 'friend_without_referral', 'kz2@example.com|999': 'unknown_level', 'de@example.com|4136082': 'no_period',
    })
    assert.deepEqual(panel.json.levels.map((level) => [level.levelId, level.name, level.price]), [['999', 'Mystery', 777]])
    assert.ok(logged.some((line) => line.includes('unmatched level 999')))

    // Idempotent: the same list again changes nothing and repeats no review item.
    const again = await t.sync.runOnce()
    assert.deepEqual(again.lastResult, { subscribers: 10, active: 9, granted: 0, adopted: 0, review: 6, unchanged: 3 })
    assert.equal(boostyPayments(t.db, t.idOf('kz@example.com')).length, 1)
    assert.equal((await t.call<Review>('GET', '/accounts/me/admin/boosty/review', t.owner)).json.total, 6)

    // The stranger registers: the next pass issues it and settles the review item. The owner maps the unknown level.
    await t.player('stranger@example.com', 'FR')
    await t.player('kz2@example.com', 'KZ')
    assert.equal((await t.call('PUT', '/accounts/me/admin/boosty/levels/999', t.owner, { offer: 'CIS_STANDARD' })).status, 200)
    assert.equal((await t.call('PUT', '/accounts/me/admin/boosty/levels/4136082', t.owner, { offer: 'CIS_STANDARD' })).status, 409)
    const third = await t.sync.runOnce()
    assert.equal(third.lastResult?.granted, 2)
    assert.equal(t.payments.paidUntil(t.idOf('stranger@example.com')), until + DAY)
    assert.equal(t.payments.paidUntil(t.idOf('kz2@example.com')), until + DAY)
    const open = (await t.call<Review>('GET', '/accounts/me/admin/boosty/review', t.owner)).json
    assert.deepEqual(open.items.map((item) => item.reason).sort(), ['friend_without_referral', 'no_period', 'region_mismatch', 'region_mismatch'])

    // A renewal: Boosty's paid-until moves a month on → one more payment, the subscription follows.
    list = [raw(1, 'kz@example.com', 4136107, until + 30 * DAY)]
    assert.equal((await t.sync.runOnce()).lastResult?.granted, 1)
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), until + 31 * DAY)
    assert.equal(boostyPayments(t.db, t.idOf('kz@example.com')).length, 2)

    // The owner dismisses a review item; the list for the subscription tool shows the source of each payment.
    const dismissed = open.items.find((item) => item.reason === 'no_period')!
    assert.equal((await t.call('POST', `/accounts/me/admin/boosty/review/${dismissed.id}/dismiss`, t.owner)).status, 200)
    assert.equal((await t.call('POST', `/accounts/me/admin/boosty/review/${dismissed.id}/dismiss`, t.owner)).status, 404)
    const tool = await t.call<{ payments: Array<{ source: string; offerKey: string; email: string; periodEnd: string; boostyUserId: string }>; total: number }>('GET', '/accounts/me/admin/boosty/payments?email=kz@example.com', t.owner)
    assert.deepEqual(tool.json.payments.map((item) => [item.source, item.offerKey, item.boostyUserId]), [['auto', 'CIS_STANDARD', '1'], ['auto', 'CIS_STANDARD', '1']])
    assert.equal((await t.call('GET', '/accounts/me/admin/boosty/payments', friendToken)).status, 404)
    assert.equal((await t.call('GET', '/accounts/me/admin/boosty', friendToken)).status, 404)
    assert.equal((await t.call('GET', '/accounts/me/admin/boosty')).status, 401)
    for (const line of logged) noSecrets(line)
  } finally {
    console.warn = silenced
    await t.close()
  }
})

test('a friend-offer subscription renews by itself once its first period spent the referral; a new friend subscriber without one is reviewed', async () => {
  let list: unknown[] = []
  const t = await setup(() => list)
  const silenced = console.warn
  console.warn = () => undefined
  try {
    const inviter = await t.player('inviter@example.com', 'RU')
    const code = (await t.call<{ code: string }>('GET', '/accounts/me/invites', inviter)).json.code
    await t.player('friend@example.com', 'KZ', code)
    await t.player('other@example.com', 'KZ')
    const first = t.now + 25 * DAY
    list = [raw(31, 'friend@example.com', 4136111, first)]
    assert.equal((await t.sync.runOnce()).lastResult?.granted, 1)
    assert.equal(t.boosty.friendAvailable(t.idOf('friend@example.com')), false, 'the first grant spent the referral')
    // Next period of the same subscription: extended automatically, no review item, no second discount mark.
    list = [raw(31, 'friend@example.com', 4136111, first + 30 * DAY), raw(32, 'other@example.com', 4136111, first)]
    const renewal = await t.sync.runOnce()
    assert.equal(renewal.lastResult?.granted, 1)
    assert.equal(renewal.lastResult?.review, 1)
    assert.equal(t.payments.paidUntil(t.idOf('friend@example.com')), first + 31 * DAY)
    assert.deepEqual(boostyPayments(t.db, t.idOf('friend@example.com')).map((row) => row.discount_percent), [20, null])
    const review = (await t.call<Review>('GET', '/accounts/me/admin/boosty/review', t.owner)).json
    assert.deepEqual(review.items.map((item) => [item.email, item.reason]), [['other@example.com', 'friend_without_referral']])
    assert.equal(t.payments.paidUntil(t.idOf('other@example.com')), undefined)
    const tool = await t.call<{ payments: Array<{ offer: string; offerKey: string }> }>('GET', '/accounts/me/admin/boosty/payments?email=friend@example.com', t.owner)
    assert.deepEqual(tool.json.payments.map((item) => [item.offer, item.offerKey]), [['friend', 'CIS_FRIEND'], ['friend', 'CIS_FRIEND']])
  } finally {
    console.warn = silenced
    await t.close()
  }
})

test('the owner\'s confirmation and the sync share one path: a review item confirmed by hand, a manual payment adopted', async () => {
  let list: unknown[] = []
  const t = await setup(() => list)
  const silenced = console.warn
  console.warn = () => undefined
  try {
    const until = t.now + 20 * DAY
    list = [raw(21, 'later@example.com', 4136082, until)]
    await t.sync.runOnce()
    const item = (await t.call<Review>('GET', '/accounts/me/admin/boosty/review', t.owner)).json.items[0]!
    assert.equal(item.reason, 'unknown_email')
    // The buyer used another e-mail on Boosty; the owner confirms for the Raid OS account, settling the item.
    await t.player('real@example.com', 'GB')
    const confirmed = await t.call<{ payment: { source: string; boostyUserId: string; periodEnd: string } }>('POST', '/accounts/me/admin/boosty/payments', t.owner, { email: 'real@example.com', offer: 'standard', paidUntil: new Date(until).toISOString(), reviewId: item.id })
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.json))
    assert.deepEqual([confirmed.json.payment.source, confirmed.json.payment.boostyUserId], ['manual', '21'])
    assert.equal((await t.call<Review>('GET', '/accounts/me/admin/boosty/review', t.owner)).json.total, 0)

    // Manual first, then the sync sees the subscriber: tied to the manual payment, no second one.
    await t.player('quick@example.com', 'KZ')
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', t.owner, { email: 'quick@example.com', offer: 'standard', months: 1 })).status, 201)
    list = [raw(22, 'quick@example.com', 4136107, t.now + 31 * DAY)]
    const pass = await t.sync.runOnce()
    assert.equal(pass.lastResult?.adopted, 1)
    assert.equal(boostyPayments(t.db, t.idOf('quick@example.com')).length, 1)
    assert.equal(t.payments.paidUntil(t.idOf('quick@example.com')), t.now + 32 * DAY)
    assert.equal((await t.sync.runOnce()).lastResult?.unchanged, 1)
  } finally {
    console.warn = silenced
    await t.close()
  }
})

test('pause, «Проверить сейчас», a dead token in the panel; nothing secret in any answer', async () => {
  const t = await setup(() => [])
  const silenced = console.warn
  const logged: string[] = []
  console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  try {
    const paused = await t.call<{ sync: { paused: boolean } }>('PUT', '/accounts/me/admin/boosty/pause', t.owner, { paused: true })
    assert.equal(paused.json.sync.paused, true)
    const before = t.fake.calls.length
    await t.sync.runOnce()
    assert.equal(t.fake.calls.length, before, 'paused: Boosty is not called')
    // «Проверить сейчас» runs even while paused.
    const run = await t.call<{ sync: { lastSuccessAt?: string; tokenDead: boolean } }>('POST', '/accounts/me/admin/boosty/sync', t.owner)
    assert.equal(run.status, 200)
    assert.ok(t.fake.calls.length > before)
    assert.ok(run.json.sync.lastSuccessAt)
    assert.equal(run.json.sync.tokenDead, false)
    assert.equal((await t.call('PUT', '/accounts/me/admin/boosty/pause', t.owner, { paused: false })).status, 200)
    for (const answer of [run.text, (await t.call('GET', '/accounts/me/admin/boosty', t.owner)).text]) noSecrets(answer)
  } finally {
    console.warn = silenced
    await t.close()
  }

  // A dead token: the panel says so; the log and the answer carry no secret.
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db })
  const payments = new PaymentStore(db, undefined)
  const boosty = new BoostyPayments(accounts, payments)
  const dead = fakeBoosty((call) => (call.url.endsWith('/oauth/token/') ? json({ error: 'invalid_grant', error_description: REFRESH }, 401) : json({ error: ACCESS }, 401)))
  const sync = new BoostySync(boosty, new BoostyClient(credentials(), new BoostyTokenStore(undefined), { fetch: dead.fetch, pageDelayMs: 0 }), { periodMs: 300_000 })
  const lines: string[] = []
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    const status = await sync.runOnce()
    assert.equal(status.lastError, 'Токен Boosty истёк — обновите BOOSTY_AUTH')
    assert.equal(status.tokenDead, true)
    noSecrets(JSON.stringify(status))
    for (const line of [...lines, ...logged]) noSecrets(line)
  } finally {
    console.warn = silenced
  }
})

test('without the Boosty secrets the job does not exist: the panel says so, manual confirmation still works', async () => {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const token = ((await (await fetch(`${base}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password }) })).json()) as { token: string }).token
    const panel = await (await fetch(`${base}/accounts/me/admin/boosty`, { headers: { authorization: `Bearer ${token}` } })).json() as { sync: { configured: boolean } }
    assert.equal(panel.sync.configured, false)
    assert.equal((await fetch(`${base}/accounts/me/admin/boosty/sync`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status, 409)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('BOOSTY_LEVEL_MAP: by level id, by name, by price; junk ignored', () => {
  const rules = parseLevelMap(JSON.stringify({ 123: 'cis_standard', 'name:Мир скидка': 'WORLD_FRIEND', 'price:450': 'WORLD_STANDARD', 456: 'RU_CHEAP', 'x:y': 'CIS_FRIEND' }))
  assert.deepEqual([...rules.ids], [['123', 'CIS_STANDARD']])
  assert.deepEqual([...rules.names], [['мир скидка', 'WORLD_FRIEND']])
  assert.deepEqual([...rules.prices], [[450, 'WORLD_STANDARD']])
  const silenced = console.warn
  console.warn = () => undefined
  try { assert.equal(parseLevelMap('{').ids.size, 0) } finally { console.warn = silenced }
  const db = openDatabase(':memory:')
  const boosty = new BoostyPayments(new AccountStore({ db }), new PaymentStore(db, undefined), undefined, { levelMap: JSON.stringify({ 'name:Raid OS Мир': 'WORLD_STANDARD', 'price:450': 'CIS_STANDARD' }) })
  assert.equal(boosty.offerForLevel('4136112', '', 0)?.key, 'WORLD_FRIEND')
  assert.equal(boosty.offerForLevel('1', 'raid os мир', 0)?.key, 'WORLD_STANDARD')
  assert.equal(boosty.offerForLevel('2', 'other', 450)?.key, 'CIS_STANDARD')
  assert.equal(boosty.offerForLevel('3', 'other', 1), undefined)
})
