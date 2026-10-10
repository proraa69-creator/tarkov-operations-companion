import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore, canonicalEmail, createAccountsHandlers, MAX_SESSIONS_PER_ACCOUNT, REFERRAL_TRIAL_MS, REGISTRATION_REFUSED_MESSAGE, type AccountView } from '../services/accountStore.js'

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
  // The streamer sees his share, never the revenue; streamers use the service free of charge.
  assert.deepEqual(me.stats, { visits: 2, registrations: 2, activeSubscriptions: 0, earnings: { amount: 0, currency: 'RUB' } })
  assert.deepEqual(me.subscription, { status: 'active', lifetime: true })

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
    // «Выйти на всех устройствах»: Bearer only, every session ends (this one too).
    const login = async () => ((await (await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'http@example.com', password }) })).json()) as { token: string }).token
    const [one, two] = [await login(), await login()]
    assert.equal((await fetch(`${base}/me/sessions/revoke-all`, { method: 'POST' })).status, 401)
    const revoked = await fetch(`${base}/me/sessions/revoke-all`, { method: 'POST', headers: { authorization: `Bearer ${one}` } })
    assert.equal(revoked.status, 200)
    assert.deepEqual(await revoked.json(), { revoked: 2 })
    for (const session of [one, two]) assert.equal((await fetch(`${base}/me`, { headers: { authorization: `Bearer ${session}` } })).status, 401)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('streamer invitation links work once, for the invited code, and expire', async () => {
  const { store, api, advance } = setup()
  const { token: session } = (await api.register({ ip: '1', body: { email: 'tv@example.com', password } })).body as { token: string }
  const invite = store.createStreamerInvite('hunter_tv')
  assert.equal(invite.code, 'HUNTER_TV')
  assert.match(invite.token, /^[A-Za-z0-9_-]{32}$/)
  assert.throws(() => store.createStreamerInvite('x'), /3–24/)

  assert.deepEqual((await api.streamerInvite({ ip: '1', body: { token: invite.token } })).body, { code: 'HUNTER_TV', expiresAt: invite.expiresAt })
  assert.equal((await api.streamerInvite({ ip: '1', body: { token: 'y'.repeat(32) } })).status, 404)
  assert.equal((await api.redeemStreamerInvite({ body: { token: invite.token } })).status, 401)

  const redeemed = await api.redeemStreamerInvite({ authorization: auth(session), body: { token: invite.token } })
  assert.equal(redeemed.status, 200)
  assert.equal((redeemed.body as AccountView).kind, 'streamer')
  assert.equal((redeemed.body as AccountView).referralCode, 'HUNTER_TV')
  assert.equal((await api.streamerInvite({ ip: '1', body: { token: invite.token } })).status, 404, 'used once')
  assert.throws(() => store.createStreamerInvite('HUNTER_TV'), /занят/)
  assert.deepEqual(store.streamers().streamers.map((row) => [row.email, row.code]), [['tv@example.com', 'HUNTER_TV']])

  const late = store.createStreamerInvite('LATE_TV')
  assert.equal(store.streamers().invites.length, 1)
  advance(8 * 24 * 60 * 60 * 1000)
  assert.equal((await api.streamerInvite({ ip: '2', body: { token: late.token } })).status, 404, 'expired')
  assert.equal(store.streamers().invites.length, 0)
})

test('revoke-all signs every session of the account out, the current one included; other accounts keep theirs', async () => {
  const { api } = setup()
  const first = ((await api.register({ ip: '1', body: { email: 'all@example.com', password } })).body as { token: string }).token
  const second = ((await api.login({ ip: '2', body: { email: 'all@example.com', password } })).body as { token: string }).token
  const other = ((await api.register({ ip: '1', body: { email: 'other@example.com', password } })).body as { token: string }).token
  assert.equal((await api.revokeAllSessions({})).status, 401)
  const revoked = await api.revokeAllSessions({ authorization: auth(second) })
  assert.deepEqual([revoked.status, revoked.body], [200, { revoked: 2 }])
  assert.equal((await api.me({ authorization: auth(first) })).status, 401)
  assert.equal((await api.me({ authorization: auth(second) })).status, 401)
  assert.equal((await api.me({ authorization: auth(other) })).status, 200)
})

test('at most MAX_SESSIONS_PER_ACCOUNT open sessions: the oldest end first', async () => {
  const { api, advance } = setup()
  const tokens = [((await api.register({ ip: '1', body: { email: 'many@example.com', password } })).body as { token: string }).token]
  for (let n = 1; n < MAX_SESSIONS_PER_ACCOUNT + 2; n += 1) {
    tokens.push(((await api.login({ ip: String(n), body: { email: 'many@example.com', password } })).body as { token: string }).token)
    if (n % 2) advance(1000)
  }
  const alive = await Promise.all(tokens.map(async (token) => (await api.me({ authorization: auth(token) })).status === 200))
  assert.deepEqual(alive, [false, false, ...Array<boolean>(MAX_SESSIONS_PER_ACCOUNT).fill(true)])
})

test('failed password sign-ins are limited per e-mail across IPs; success does not count', async () => {
  const { api, advance } = setup({ authRateLimit: { max: 1000, windowMs: 15 * 60 * 1000 }, loginFailuresPerEmail: 4 })
  await api.register({ ip: '1', body: { email: 'target@example.com', password } })
  for (let n = 0; n < 3; n += 1) assert.equal((await api.login({ ip: `10.0.0.${n}`, body: { email: 'target@example.com', password: 'wrong password' } })).status, 401)
  // A successful sign-in is not a failure (and does not reset anything either).
  assert.equal((await api.login({ ip: '10.0.1.1', body: { email: 'target@example.com', password } })).status, 200)
  assert.equal((await api.login({ ip: '10.0.0.9', body: { email: 'Target+x@Example.com', password: 'wrong password' } })).status, 401, 'aliases count for the same mailbox')
  const limited = await api.login({ ip: '10.0.2.2', body: { email: 'target@example.com', password } })
  assert.equal(limited.status, 429, 'even the right password waits: the e-mail is under attack')
  assert.ok(Number(limited.headers?.['Retry-After']) > 0)
  // Unknown addresses are limited the same way (no enumeration through the 429).
  for (let n = 0; n < 4; n += 1) assert.equal((await api.login({ ip: `10.1.0.${n}`, body: { email: 'ghost@example.com', password } })).status, 401)
  assert.equal((await api.login({ ip: '10.1.0.9', body: { email: 'ghost@example.com', password } })).status, 429)
  // Another e-mail is unaffected; an hour later the target signs in again.
  assert.equal((await api.login({ ip: '10.0.2.2', body: { email: 'nobody@example.com', password } })).status, 401)
  advance(60 * 60 * 1000)
  assert.equal((await api.login({ ip: '10.0.2.2', body: { email: 'target@example.com', password } })).status, 200)
})

test('canonical e-mail: Gmail dots / googlemail and +tags are one mailbox; registration refuses it like a taken address', async () => {
  assert.equal(canonicalEmail(' J.O.H.N+stream@GoogleMail.com '), 'john@gmail.com')
  assert.equal(canonicalEmail('j.o.h.n+a+b@example.com'), 'j.o.h.n@example.com', 'dots matter outside Gmail')
  assert.equal(canonicalEmail('+only@example.com'), '+only@example.com')
  const { api, store } = setup()
  assert.equal((await api.register({ ip: '1', body: { email: 'john.doe@gmail.com', password } })).status, 201)
  for (const alias of ['johndoe@gmail.com', 'John.Doe+farm@googlemail.com', 'j.o.h.n.d.o.e+1@gmail.com']) {
    const refused = await api.register({ ip: '1', body: { email: alias, password } })
    assert.deepEqual([refused.status, refused.body], [409, { error: REGISTRATION_REFUSED_MESSAGE }], alias)
  }
  // Once the account is deleted the canonical form is free again.
  const token = ((await api.login({ ip: '1', body: { email: 'john.doe@gmail.com', password } })).body as { token: string }).token
  store.deleteAccount(store.authenticate(token)!)
  assert.equal((await api.register({ ip: '1', body: { email: 'johndoe+new@gmail.com', password } })).status, 201)
})

test('streamer-code trial: once per canonical e-mail, also after deleting the account; the referral still counts', async () => {
  const { api, store } = setup()
  await api.register({ ip: '1', body: { email: 'tv@example.com', password } })
  store.promoteToStreamer('tv@example.com', 'hunter_tv')
  const first = (await api.register({ ip: '2', body: { email: 'fan.one@gmail.com', password, referralCode: 'HUNTER_TV' } })).body as { token: string; account: AccountView }
  assert.equal(first.account.subscription.status, 'trial')
  store.deleteAccount(store.authenticate(first.token)!)
  const again = await api.register({ ip: '3', body: { email: 'fanone+2@googlemail.com', password, referralCode: 'HUNTER_TV' } })
  assert.equal(again.status, 201)
  const view = (again.body as { account: AccountView; referralApplied: boolean })
  assert.equal(view.referralApplied, true)
  assert.equal(view.account.referredBy, 'HUNTER_TV')
  assert.deepEqual(view.account.subscription, { status: 'inactive' }, 'no second trial for the same mailbox')
  // Applying the code later does not help either.
  const later = ((await api.register({ ip: '4', body: { email: 'fan.one+3@gmail.com', password } })).body as { token: string })
  assert.equal(later.token, undefined, 'the canonical form belongs to a working account: refused')
  // A different mailbox gets its trial; both registrations count for the streamer.
  const other = (await api.register({ ip: '5', body: { email: 'fan.two@gmail.com', password } })).body as { token: string }
  const applied = await api.applyReferral({ authorization: auth(other.token), body: { code: 'hunter_tv' } })
  assert.equal((applied.body as AccountView).subscription.status, 'trial')
  const streamer = ((await api.login({ ip: '1', body: { email: 'tv@example.com', password } })).body as { account: AccountView }).account
  assert.equal(streamer.stats?.registrations, 3)
})
