import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore, canonicalEmail, COUNTRY_ALREADY_SET, COUNTRY_INVALID_MESSAGE, COUNTRY_REQUIRED_MESSAGE, createAccountsHandlers, MAX_SESSIONS_PER_ACCOUNT, REFERRAL_TRIAL_MS, REGISTRATION_REFUSED_MESSAGE, WELCOME_TRIAL_MS, type AccountView } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'

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
  const registered = await api.register({ ip: '1', body: { email: '  Player@Example.com ', password, country: 'RU' } })
  assert.equal(registered.status, 201)
  const { token, account } = registered.body as { token: string; account: AccountView }
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(account.email, 'player@example.com')
  assert.equal(account.kind, 'user')
  assert.equal(account.stats, undefined)
  assert.equal(account.referralCode, undefined)
  // Every new account has one free day (owner, 12.10.2026), counted from the first sign-in in an app, not from now.
  assert.deepEqual(account.subscription, { status: 'inactive', trialPendingDays: 1 })
  assert.ok(!JSON.stringify(registered.body).includes(password))

  assert.equal((await api.register({ ip: '1', body: { email: 'player@example.com', password, country: 'RU' } })).status, 409)
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
  assert.equal((await api.register({ ip: '1', body: { email: 'not-an-email', password, country: 'RU' } })).status, 400)
  assert.equal((await api.register({ ip: '1', body: { email: 'a@example.com', password: 'short' } })).status, 400)
  assert.equal((await api.register({ ip: '1', body: 'garbage' })).status, 400)
  const { token } = (await api.register({ ip: '1', body: { email: 'a@example.com', password, country: 'RU' } })).body as { token: string }
  assert.equal((await api.setNicknames({ authorization: auth(token), body: { pvp: 'bad nick!' } })).status, 400)
  assert.equal((await api.applyReferral({ authorization: auth(token), body: { code: '<script>' } })).status, 400)
})

test('sessions expire', async () => {
  const { api, advance } = setup()
  const { token } = (await api.register({ ip: '1', body: { email: 'a@example.com', password, country: 'RU' } })).body as { token: string }
  advance(7 * 24 * 60 * 60 * 1000 + 1)
  assert.equal((await api.me({ authorization: auth(token) })).status, 401)
})

test('streamer promotion is server-side only and exposes referral stats only to the streamer', async () => {
  const { store, api, advance } = setup()
  const streamer = (await api.register({ ip: '1', body: { email: 'streamer@example.com', password, country: 'RU' } })).body as { token: string }
  assert.throws(() => store.promoteToStreamer('missing@example.com', 'CODE'), /not found/)
  assert.throws(() => store.promoteToStreamer('streamer@example.com', 'x'), /3-24/)
  assert.equal(store.promoteToStreamer('streamer@example.com', 'hunter_tv'), 'HUNTER_TV')

  // Unknown referral codes never block registration.
  const stranger = await api.register({ ip: '2', body: { email: 'stranger@example.com', password, country: 'RU', referralCode: 'NOPE123' } })
  assert.equal(stranger.status, 201)
  assert.equal((stranger.body as { referralApplied: boolean }).referralApplied, false)

  assert.equal((await api.referralVisit({ ip: '9', body: { code: 'hunter_tv' } })).status, 200)
  assert.equal((await api.referralVisit({ ip: '9', body: { code: 'HUNTER_TV' } })).status, 200) // same visitor, deduplicated
  assert.equal((await api.referralVisit({ ip: '8', body: { code: 'HUNTER_TV' } })).status, 200)
  assert.equal((await api.referralVisit({ ip: '8', body: { code: 'UNKNOWN' } })).status, 404)

  const referred = await api.register({ ip: '3', body: { email: 'fan@example.com', password, country: 'RU', referralCode: 'hunter_tv' } })
  const referredBody = referred.body as { token: string; referralApplied: boolean; account: AccountView }
  assert.equal(referredBody.referralApplied, true)
  assert.equal(referredBody.account.referredBy, 'HUNTER_TV')
  assert.deepEqual(referredBody.account.subscription, { status: 'inactive', trialPendingDays: 3 })
  // The fan signs in to the app (POST /v1/entitlement registers the device): the three days start.
  store.claimTrialDevice(store.authenticate(referredBody.token)!, 'device-fan-abcdefghijklmnopqrstu')
  assert.equal(((await api.me({ authorization: auth(referredBody.token) })).body as AccountView).subscription.status, 'trial')
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
  // Over, and nothing was ever paid: the end stays in the view, so the app can say the trial is over.
  assert.deepEqual(fan.subscription, { status: 'inactive', trialEndsAt: '2026-10-01T10:00:00.000Z' })
  assert.throws(() => store.promoteToStreamer('fan@example.com', 'hunter_tv'), /already taken/)
})

test('one nickname for all modes (owner, 10.10.2026); builds that send per-mode keys still work', async () => {
  const { api } = setup()
  const { token } = (await api.register({ ip: '1', body: { email: 'a@example.com', password, country: 'RU' } })).body as { token: string }
  const all = (nickname: string) => ({ pvp: nickname, pve: nickname, seasonal: nickname })
  let view = (await api.setNicknames({ authorization: auth(token), body: { nickname: 'Shaurma_1' } })).body as AccountView
  assert.equal(view.nickname, 'Shaurma_1')
  assert.deepEqual(view.nicknames, all('Shaurma_1'))
  // The website before the change: every field, '' for the empty ones — the first filled one of PvP → PvE → «Сезон».
  view = (await api.setNicknames({ authorization: auth(token), body: { pvp: '', pve: 'PveAlt', seasonal: '' } })).body as AccountView
  assert.equal(view.nickname, 'PveAlt')
  assert.deepEqual(view.nicknames, all('PveAlt'))
  // The app before the change: one mode at a time — it becomes the nickname of every mode.
  view = (await api.setNicknames({ authorization: auth(token), body: { seasonal: 'Season-1' } })).body as AccountView
  assert.deepEqual(view.nicknames, all('Season-1'))
  // Keys that name no mode change nothing; all given keys empty remove the nickname.
  view = (await api.setNicknames({ authorization: auth(token), body: {} })).body as AccountView
  assert.equal(view.nickname, 'Season-1')
  view = (await api.setNicknames({ authorization: auth(token), body: { nickname: null } })).body as AccountView
  assert.equal(view.nickname, undefined)
  assert.deepEqual(view.nicknames, {})
  assert.equal((await api.setNicknames({ authorization: auth(token), body: { nickname: 'bad nick!' } })).status, 400)
})

test('login and register are rate limited per IP', async () => {
  const { api, advance } = setup({ authRateLimit: { max: 3, windowMs: 60_000 } })
  for (let i = 0; i < 3; i += 1) assert.equal((await api.login({ ip: '5', body: { email: 'x@example.com', password } })).status, 401)
  const blocked = await api.login({ ip: '5', body: { email: 'x@example.com', password } })
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers?.['Retry-After']) > 0)
  assert.equal((await api.register({ ip: '5', body: { email: 'y@example.com', password, country: 'RU' } })).status, 429)
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
    const registered = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'http@example.com', password, country: 'RU' }) })
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
  const { token: session } = (await api.register({ ip: '1', body: { email: 'tv@example.com', password, country: 'RU' } })).body as { token: string }
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
  const first = ((await api.register({ ip: '1', body: { email: 'all@example.com', password, country: 'RU' } })).body as { token: string }).token
  const second = ((await api.login({ ip: '2', body: { email: 'all@example.com', password } })).body as { token: string }).token
  const other = ((await api.register({ ip: '1', body: { email: 'other@example.com', password, country: 'RU' } })).body as { token: string }).token
  assert.equal((await api.revokeAllSessions({})).status, 401)
  const revoked = await api.revokeAllSessions({ authorization: auth(second) })
  assert.deepEqual([revoked.status, revoked.body], [200, { revoked: 2 }])
  assert.equal((await api.me({ authorization: auth(first) })).status, 401)
  assert.equal((await api.me({ authorization: auth(second) })).status, 401)
  assert.equal((await api.me({ authorization: auth(other) })).status, 200)
})

test('at most MAX_SESSIONS_PER_ACCOUNT open sessions: the oldest end first', async () => {
  const { api, advance } = setup()
  const tokens = [((await api.register({ ip: '1', body: { email: 'many@example.com', password, country: 'RU' } })).body as { token: string }).token]
  for (let n = 1; n < MAX_SESSIONS_PER_ACCOUNT + 2; n += 1) {
    tokens.push(((await api.login({ ip: String(n), body: { email: 'many@example.com', password } })).body as { token: string }).token)
    if (n % 2) advance(1000)
  }
  const alive = await Promise.all(tokens.map(async (token) => (await api.me({ authorization: auth(token) })).status === 200))
  assert.deepEqual(alive, [false, false, ...Array<boolean>(MAX_SESSIONS_PER_ACCOUNT).fill(true)])
})

test('failed password sign-ins are limited per e-mail across IPs; success does not count', async () => {
  const { api, advance } = setup({ authRateLimit: { max: 1000, windowMs: 15 * 60 * 1000 }, loginFailuresPerEmail: 4 })
  await api.register({ ip: '1', body: { email: 'target@example.com', password, country: 'RU' } })
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

test('canonical e-mail: Gmail dots / googlemail and +tags are one mailbox; a similar address registers, without a second free day (owner, 13.10.2026)', async () => {
  assert.equal(canonicalEmail(' J.O.H.N+stream@GoogleMail.com '), 'john@gmail.com')
  assert.equal(canonicalEmail('j.o.h.n+a+b@example.com'), 'j.o.h.n@example.com', 'dots matter outside Gmail')
  assert.equal(canonicalEmail('+only@example.com'), '+only@example.com')
  const { api } = setup()
  const first = await api.register({ ip: '1', body: { email: 'john.doe@gmail.com', password, country: 'RU' } })
  assert.equal(first.status, 201)
  assert.deepEqual((first.body as { account: AccountView }).account.subscription, { status: 'inactive', trialPendingDays: 1 })
  // «Блокировать по созданию похожей почты не нужно»: the app refuses the game account another Raid OS account holds.
  for (const alias of ['johndoe@gmail.com', 'John.Doe+farm@googlemail.com', 'j.o.h.n.d.o.e+1@gmail.com']) {
    const registered = await api.register({ ip: '1', body: { email: alias, password, country: 'RU' } })
    assert.equal(registered.status, 201, alias)
    assert.deepEqual((registered.body as { account: AccountView }).account.subscription, { status: 'inactive' }, `${alias}: the mailbox had its free day`)
  }
  // The very same address stays taken.
  const taken = await api.register({ ip: '1', body: { email: 'John.Doe@gmail.com', password, country: 'RU' } })
  assert.deepEqual([taken.status, taken.body], [409, { error: REGISTRATION_REFUSED_MESSAGE }])
})

test('streamer-code trial: once per canonical e-mail, also after deleting the account; the referral still counts', async () => {
  const { api, store } = setup()
  await api.register({ ip: '1', body: { email: 'tv@example.com', password, country: 'RU' } })
  store.promoteToStreamer('tv@example.com', 'hunter_tv')
  const first = (await api.register({ ip: '2', body: { email: 'fan.one@gmail.com', password, country: 'RU', referralCode: 'HUNTER_TV' } })).body as { token: string; account: AccountView }
  assert.deepEqual(first.account.subscription, { status: 'inactive', trialPendingDays: 3 })
  store.deleteAccount(store.authenticate(first.token)!)
  const again = await api.register({ ip: '3', body: { email: 'fanone+2@googlemail.com', password, country: 'RU', referralCode: 'HUNTER_TV' } })
  assert.equal(again.status, 201)
  const view = (again.body as { account: AccountView; referralApplied: boolean })
  assert.equal(view.referralApplied, true)
  assert.equal(view.account.referredBy, 'HUNTER_TV')
  assert.deepEqual(view.account.subscription, { status: 'inactive' }, 'no second trial for the same mailbox')
  // Another spelling of the mailbox registers (owner, 13.10.2026), still without a trial, also with the code applied later.
  const later = ((await api.register({ ip: '4', body: { email: 'fan.one+3@gmail.com', password, country: 'RU' } })).body as { token: string; account: AccountView })
  assert.deepEqual(later.account.subscription, { status: 'inactive' })
  const laterApplied = await api.applyReferral({ authorization: auth(later.token), body: { code: 'hunter_tv' } })
  assert.deepEqual((laterApplied.body as AccountView).subscription, { status: 'inactive' }, 'no trial for the same mailbox')
  // A different mailbox gets its trial; both registrations count for the streamer.
  const other = (await api.register({ ip: '5', body: { email: 'fan.two@gmail.com', password, country: 'RU' } })).body as { token: string }
  const applied = await api.applyReferral({ authorization: auth(other.token), body: { code: 'hunter_tv' } })
  assert.deepEqual((applied.body as AccountView).subscription, { status: 'inactive', trialPendingDays: 3 }, 'three days, from the first sign-in in an app')
  const streamer = ((await api.login({ ip: '1', body: { email: 'tv@example.com', password } })).body as { account: AccountView }).account
  assert.equal(streamer.stats?.registrations, 4)
})

test('one free day for every new account, from the first sign-in in an app (owner, 12.10.2026): once per mailbox and device; when it is over the view keeps its end', async () => {
  const { api, store, advance } = setup()
  const first = (await api.register({ ip: '1', body: { email: 'new.player@gmail.com', password, country: 'RU' } })).body as { token: string; account: AccountView }
  assert.deepEqual(first.account.subscription, { status: 'inactive', trialPendingDays: 1 })
  // Deleting the account and registering the same mailbox again gives no second day.
  store.deleteAccount(store.authenticate(first.token)!)
  const again = (await api.register({ ip: '2', body: { email: 'newplayer+2@googlemail.com', password, country: 'RU' } })).body as { token: string; account: AccountView }
  assert.deepEqual(again.account.subscription, { status: 'inactive' })
  // Another mailbox gets its day. It waits for the app («сутки должны начинаться после первого входа в приложение»):
  // three days later nothing has run out yet.
  const other = (await api.register({ ip: '3', body: { email: 'other@example.com', password, country: 'RU' } })).body as { token: string }
  advance(3 * WELCOME_TRIAL_MS)
  const me = async (token: string) => ((await api.me({ authorization: auth(token) })).body as AccountView).subscription
  assert.deepEqual(await me(other.token), { status: 'inactive', trialPendingDays: 1 })
  const device = 'device-pc-01-abcdefghijklmnopqrstu'
  store.claimTrialDevice(store.authenticate(other.token)!, device)
  assert.deepEqual(await me(other.token), { status: 'trial', trialEndsAt: '2026-10-02T10:00:00.000Z' })
  // Further sign-ins do not move the end; once it is over, the end stays in the view (the app says the trial is over).
  advance(WELCOME_TRIAL_MS / 2)
  store.claimTrialDevice(store.authenticate(other.token)!, device)
  advance(WELCOME_TRIAL_MS / 2)
  assert.deepEqual(await me(other.token), { status: 'inactive', trialEndsAt: '2026-10-02T10:00:00.000Z' })
  // A new account signing in on a PC that already served a free day gets none.
  const third = (await api.register({ ip: '4', body: { email: 'third@example.com', password, country: 'RU' } })).body as { token: string }
  store.claimTrialDevice(store.authenticate(third.token)!, device)
  assert.deepEqual(await me(third.token), { status: 'inactive' })
})

test('accounts from before the free day keep what they had: nothing, or the streamer-code trial — waiting for the app when it never signed in there', async () => {
  const db = openDatabase(':memory:')
  let clock = Date.parse('2026-10-10T10:00:00.000Z')
  const before = new AccountStore({ db, now: () => clock })
  await before.register('tv@example.com', password)
  before.promoteToStreamer('tv@example.com', 'hunter_tv')
  const plain = before.authenticate((await before.register('old@example.com', password)).token)!
  const fan = before.authenticate((await before.register('fan@example.com', password, 'HUNTER_TV')).token)!
  const player = before.authenticate((await before.register('player@example.com', password, 'HUNTER_TV')).token)!
  // The database as it was before 12.10.2026: no free-day columns yet. The player has used the app (a device).
  db.exec('ALTER TABLE accounts DROP COLUMN trial_ends_at')
  db.exec('ALTER TABLE accounts DROP COLUMN trial_pending_ms')
  db.exec('CREATE TABLE account_devices (account_id TEXT, device_id TEXT, name TEXT, created_at INTEGER, last_seen_at INTEGER, session_digest TEXT, revoked_at INTEGER, revoked_reason TEXT)')
  db.prepare("INSERT INTO account_devices (account_id, device_id, name, created_at, last_seen_at) VALUES (?, 'pc-1', 'Windows · PC · Raid OS 0.5.4', ?, ?)").run(player, clock, clock)
  clock += 60 * 60 * 1000
  const after = new AccountStore({ db, now: () => clock })
  assert.deepEqual(after.view(plain).subscription, { status: 'inactive' })
  // Signed in to the app before: the trial keeps running from the code.
  assert.deepEqual(after.view(player).subscription, { status: 'trial', trialEndsAt: new Date(Date.parse('2026-10-10T10:00:00.000Z') + REFERRAL_TRIAL_MS).toISOString() })
  // Never signed in to an app: the three days wait for that (owner, 12.10.2026).
  assert.deepEqual(after.view(fan).subscription, { status: 'inactive', trialPendingDays: 3 })
  after.claimTrialDevice(fan, 'device-fan-abcdefghijklmnopqrstu')
  assert.deepEqual(after.view(fan).subscription, { status: 'trial', trialEndsAt: new Date(clock + REFERRAL_TRIAL_MS).toISOString() })
  // A new account in the updated database: its day waits for the app too.
  const fresh = after.authenticate((await after.register('fresh@example.com', password)).token)!
  assert.deepEqual(after.view(fresh).subscription, { status: 'inactive', trialPendingDays: 1 })
})

test('registration asks the country (owner, 13.10.2026): stored upper-case, mandatory (14.10.2026), an unassigned code refused', async () => {
  const { api, store } = setup()
  const registered = await api.register({ ip: '1', body: { email: 'almaty@example.com', password, country: ' kz ' } })
  assert.equal(registered.status, 201)
  assert.equal((registered.body as { account: AccountView }).account.country, 'KZ')
  // owner, 14.10.2026: «на сайте сделай указывать страну обязательно при регистрации». Only an app from before the
  // question sends none (or an empty value): it is told to update, and no account is made.
  for (const [email, country] of [['old-app@example.com', undefined], ['empty@example.com', ''], ['blank@example.com', '  '], ['null@example.com', null]] as const) {
    const older = await api.register({ ip: '1', body: { email, password, ...(country === undefined ? {} : { country }) } })
    assert.deepEqual([older.status, older.body], [400, { error: COUNTRY_REQUIRED_MESSAGE }], email)
    assert.equal(store.hasAccount(email), false, email)
  }
  // A taken address gets the same answer: the refusal says nothing about the e-mail.
  const taken = await api.register({ ip: '1', body: { email: 'almaty@example.com', password } })
  assert.deepEqual([taken.status, taken.body], [400, { error: COUNTRY_REQUIRED_MESSAGE }])
  // Kosovo's XK, the old USSR code, a name instead of a code, a number: refused before any account exists.
  for (const [n, country] of (['XK', 'SU', 'Kazakhstan', 7] as const).entries()) {
    const refused = await api.register({ ip: '2', body: { email: `refused-${n}@example.com`, password, country } })
    assert.deepEqual([refused.status, refused.body], [400, { error: COUNTRY_INVALID_MESSAGE }], String(country))
    assert.equal(store.hasAccount(`refused-${n}@example.com`), false)
  }
  // The store checks it too (registration with an e-mail code creates the account there).
  await assert.rejects(store.register('direct@example.com', password, undefined, undefined, 'ZZ'), { status: 400, message: COUNTRY_INVALID_MESSAGE })
  assert.equal(store.hasAccount('direct@example.com'), false)
})

test('«Страна» in the cabinet: a country named at registration is never changed (owner, 16.10.2026); bad codes and strangers are refused', async () => {
  const { api } = setup()
  const { token } = (await api.register({ ip: '1', body: { email: 'before@example.com', password, country: 'RU' } })).body as { token: string }
  assert.equal((await api.setCountry({ body: { country: 'DE' } })).status, 401)
  const refused = await api.setCountry({ authorization: auth(token), body: { country: 'de' } })
  assert.deepEqual([refused.status, refused.body], [409, { error: COUNTRY_ALREADY_SET }])
  for (const body of [{ country: 'XK' }, { country: '' }, { country: null }, {}, 'UA']) {
    const invalid = await api.setCountry({ authorization: auth(token), body })
    assert.deepEqual([invalid.status, invalid.body], [400, { error: COUNTRY_INVALID_MESSAGE }], JSON.stringify(body))
  }
  assert.equal(((await api.me({ authorization: auth(token) })).body as AccountView).country, 'RU', 'the country named at registration stays')
})

test('«Удалить аккаунт» erases the country with the rest of the personal data', async () => {
  const { api, store } = setup()
  const { token } = (await api.register({ ip: '1', body: { email: 'gone@example.com', password, country: 'BY' } })).body as { token: string }
  const id = store.authenticate(token)!
  assert.equal(store.view(id).country, 'BY')
  store.deleteAccount(id)
  assert.equal((store.database.prepare('SELECT country FROM accounts WHERE id = ?').get(id) as { country: unknown }).country, null)
})

test('the country column is added to an older database, NULL for the accounts already there', async () => {
  const db = openDatabase(':memory:')
  const before = new AccountStore({ db })
  const old = before.authenticate((await before.register('old@example.com', password)).token)!
  db.exec('ALTER TABLE accounts DROP COLUMN country')
  const after = new AccountStore({ db })
  assert.equal((db.prepare('SELECT country FROM accounts WHERE id = ?').get(old) as { country: unknown }).country, null)
  assert.equal(after.view(old).country, undefined)
  after.setCountry(old, 'AM')
  assert.equal(after.view(old).country, 'AM')
})
