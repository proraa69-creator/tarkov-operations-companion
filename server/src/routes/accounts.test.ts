import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore, createAccountsHandlers, REFERRAL_TRIAL_MS, type AccountView } from '../services/accountStore.js'

const password = 'correct horse battery'

function setup(options: Parameters<typeof createAccountsHandlers>[1] = {}) {
  let clock = Date.parse('2026-09-28T10:00:00.000Z')
  const now = () => clock
  const store = new AccountStore({ now })
  const api = createAccountsHandlers(store, { now, ...options })
  return { store, api, advance: (ms: number) => { clock += ms } }
}

const auth = (token: string) => `Bearer ${token}`

test('register, login and /me return an opaque token and an ordinary user view', async () => {
  const { api } = setup()
  const registered = await api.register({ ip: '1', body: { email: '  Player@Example.com ', password } })
  assert.equal(registered.status, 201)
  const { token, account } = registered.body as { token: string; account: AccountView }
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(account.email, 'player@example.com')
  assert.equal(account.kind, 'user')
  assert.equal(account.stats, undefined)
  assert.equal(account.referralCode, undefined)
  assert.deepEqual(account.subscription, { status: 'inactive' })
  assert.ok(!JSON.stringify(registered.body).includes(password))

  assert.equal((await api.register({ ip: '1', body: { email: 'player@example.com', password } })).status, 409)
  assert.equal((await api.login({ ip: '1', body: { email: 'player@example.com', password: 'wrong password' } })).status, 401)
  assert.equal((await api.login({ ip: '1', body: { email: 'nobody@example.com', password } })).status, 401)

  const login = await api.login({ ip: '1', body: { email: 'PLAYER@example.com', password } })
  assert.equal(login.status, 200)
  const loginToken = (login.body as { token: string }).token
  assert.notEqual(loginToken, token)
  const me = await api.me({ authorization: auth(loginToken) })
  assert.equal(me.status, 200)
  assert.equal((me.body as AccountView).email, 'player@example.com')

  assert.equal((await api.me({})).status, 401)
  assert.equal((await api.me({ authorization: auth('x'.repeat(43)) })).status, 401)
  assert.equal((await api.logout({ authorization: auth(loginToken) })).status, 204)
  assert.equal((await api.me({ authorization: auth(loginToken) })).status, 401)
  assert.equal((await api.me({ authorization: auth(token) })).status, 200)
})

test('input is validated', async () => {
  const { api } = setup()
  assert.equal((await api.register({ ip: '1', body: { email: 'not-an-email', password } })).status, 400)
  assert.equal((await api.register({ ip: '1', body: { email: 'a@example.com', password: 'short' } })).status, 400)
  assert.equal((await api.register({ ip: '1', body: 'garbage' })).status, 400)
  const { token } = (await api.register({ ip: '1', body: { email: 'a@example.com', password } })).body as { token: string }
  assert.equal((await api.setNicknames({ authorization: auth(token), body: { pvp: 'bad nick!' } })).status, 400)
  assert.equal((await api.applyReferral({ authorization: auth(token), body: { code: '<script>' } })).status, 400)
})

test('sessions expire', async () => {
  const { api, advance } = setup()
  const { token } = (await api.register({ ip: '1', body: { email: 'a@example.com', password } })).body as { token: string }
  advance(7 * 24 * 60 * 60 * 1000 + 1)
  assert.equal((await api.me({ authorization: auth(token) })).status, 401)
})

test('streamer promotion is server-side only and exposes referral stats only to the streamer', async () => {
  const { store, api, advance } = setup()
  const streamer = (await api.register({ ip: '1', body: { email: 'streamer@example.com', password } })).body as { token: string }
  assert.throws(() => store.promoteToStreamer('missing@example.com', 'CODE'), /not found/)
  assert.throws(() => store.promoteToStreamer('streamer@example.com', 'x'), /3-24/)
  assert.equal(store.promoteToStreamer('streamer@example.com', 'hunter_tv'), 'HUNTER_TV')

  // Unknown referral codes never block registration.
  const stranger = await api.register({ ip: '2', body: { email: 'stranger@example.com', password, referralCode: 'NOPE123' } })
  assert.equal(stranger.status, 201)
  assert.equal((stranger.body as { referralApplied: boolean }).referralApplied, false)

  assert.equal((await api.referralVisit({ ip: '9', body: { code: 'hunter_tv' } })).status, 200)
  assert.equal((await api.referralVisit({ ip: '9', body: { code: 'HUNTER_TV' } })).status, 200) // same visitor, deduplicated
  assert.equal((await api.referralVisit({ ip: '8', body: { code: 'HUNTER_TV' } })).status, 200)
  assert.equal((await api.referralVisit({ ip: '8', body: { code: 'UNKNOWN' } })).status, 404)

  const referred = await api.register({ ip: '3', body: { email: 'fan@example.com', password, referralCode: 'hunter_tv' } })
  const referredBody = referred.body as { token: string; referralApplied: boolean; account: AccountView }
  assert.equal(referredBody.referralApplied, true)
  assert.equal(referredBody.account.referredBy, 'HUNTER_TV')
  assert.equal(referredBody.account.subscription.status, 'trial')
  assert.equal(referredBody.account.stats, undefined)
  assert.equal(referredBody.account.referralCode, undefined)

  // Ordinary users can attach a code later, but only once.
  const { token: strangerToken } = stranger.body as { token: string }
  assert.equal((await api.applyReferral({ authorization: auth(strangerToken), body: { code: 'UNKNOWN' } })).status, 404)
  assert.equal((await api.applyReferral({ authorization: auth(strangerToken), body: { code: 'hunter_tv' } })).status, 200)
  assert.equal((await api.applyReferral({ authorization: auth(strangerToken), body: { code: 'hunter_tv' } })).status, 409)
  // A streamer cannot attach a referral code.
  assert.equal((await api.applyReferral({ authorization: auth(streamer.token), body: { code: 'hunter_tv' } })).status, 403)

  const me = (await api.me({ authorization: auth(streamer.token) })).body as AccountView
  assert.equal(me.kind, 'streamer')
  assert.equal(me.referralCode, 'HUNTER_TV')
  assert.deepEqual(me.stats, { visits: 2, registrations: 2, activeSubscriptions: 0, revenue: { amount: 0, currency: 'RUB' }, earnings: { amount: 0, currency: 'RUB' } })

  advance(REFERRAL_TRIAL_MS + 1)
  const fan = (await api.me({ authorization: auth(referredBody.token) })).body as AccountView
  assert.deepEqual(fan.subscription, { status: 'inactive' })
  assert.throws(() => store.promoteToStreamer('fan@example.com', 'hunter_tv'), /already taken/)
})

test('nicknames are stored separately per mode', async () => {
  const { api } = setup()
  const { token } = (await api.register({ ip: '1', body: { email: 'a@example.com', password } })).body as { token: string }
  let view = (await api.setNicknames({ authorization: auth(token), body: { pvp: 'Pvp_Main', pve: 'PveAlt' } })).body as AccountView
  assert.deepEqual(view.nicknames, { pvp: 'Pvp_Main', pve: 'PveAlt' })
  view = (await api.setNicknames({ authorization: auth(token), body: { pve: '', seasonal: 'Season-1' } })).body as AccountView
  assert.deepEqual(view.nicknames, { pvp: 'Pvp_Main', seasonal: 'Season-1' })
})

test('login and register are rate limited per IP', async () => {
  const { api, advance } = setup({ authRateLimit: { max: 3, windowMs: 60_000 } })
  for (let i = 0; i < 3; i += 1) assert.equal((await api.login({ ip: '5', body: { email: 'x@example.com', password } })).status, 401)
  const blocked = await api.login({ ip: '5', body: { email: 'x@example.com', password } })
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers?.['Retry-After']) > 0)
  assert.equal((await api.register({ ip: '5', body: { email: 'y@example.com', password } })).status, 429)
  assert.equal((await api.login({ ip: '6', body: { email: 'x@example.com', password } })).status, 401)
  advance(60_000)
  assert.equal((await api.login({ ip: '5', body: { email: 'x@example.com', password } })).status, 401)
})

test('express router wires the handlers (skipped when server dependencies are not installed)', async (t) => {
  let express: typeof import('express')
  let createAccountsRouter: typeof import('./accounts.js').createAccountsRouter
  try {
    express = (await import('express')).default
    ;({ createAccountsRouter } = await import('./accounts.js'))
  } catch {
    t.skip('express is not installed (run npm --prefix server ci)')
    return
  }
  const store = new AccountStore()
  const app = express()
  app.use(express.json())
  app.use('/v1/accounts', createAccountsRouter(store))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/v1/accounts`
  try {
    const registered = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'http@example.com', password }) })
    assert.equal(registered.status, 201)
    assert.equal(registered.headers.get('cache-control'), 'no-store')
    const { token } = await registered.json() as { token: string }
    const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(me.status, 200)
    assert.equal((await me.json() as AccountView).kind, 'user')
    assert.equal((await fetch(`${base}/me`)).status, 401)
    assert.equal((await fetch(`${base}/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status, 204)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
