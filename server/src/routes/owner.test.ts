import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from '../app.js'
import { AccountStore, createAccountsHandlers, parseOwnerEmails, type AccountView } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const auth = (token: string) => `Bearer ${token}`

/** The owner registers first; only then is the e-mail listed (what the desktop app enforces). */
async function setup() {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  // Owner rights need a confirmed e-mail (or an account older than e-mail codes, see AccountStore.isOwner).
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const store = new AccountStore({ db, now, ownerEmails: ['Owner@Example.com'] })
  const api = createAccountsHandlers(store, { now })
  const login = async (email: string) => ((await api.login({ ip: 'x', body: { email, password } })).body as { token: string }).token
  return { store, api, login, advance: (ms: number) => { clock += ms } }
}

test('owner e-mails are parsed from TARKOV_OWNER_EMAILS', () => {
  assert.deepEqual(parseOwnerEmails(' A@Example.com, b@example.com;a@example.com  not-an-email '), ['a@example.com', 'b@example.com'])
  assert.deepEqual(parseOwnerEmails(undefined), [])
})

test('only the configured owner account is marked owner and reaches the owner routes', async () => {
  const { api, login } = await setup()
  const ownerToken = await login('owner@example.com')
  const owner = (await api.me({ authorization: auth(ownerToken) })).body as AccountView
  assert.equal(owner.owner, true)
  assert.equal(owner.kind, 'user')

  const player = await api.register({ ip: 'x', body: { email: 'player@example.com', password } })
  const playerToken = (player.body as { token: string }).token
  assert.equal((player.body as { account: AccountView }).account.owner, undefined)

  // Non-owners and anonymous callers get 401/404, never data.
  assert.equal((await api.ownerStreamers({})).status, 401)
  assert.equal((await api.ownerStreamers({ authorization: auth(playerToken) })).status, 404)
  assert.equal((await api.ownerCreateStreamerInvite({ authorization: auth(playerToken), body: { code: 'HACKER' } })).status, 404)
  assert.equal((await api.ownerStreamerStats({ authorization: auth(playerToken), query: { code: 'HACKER' } })).status, 404)

  const list = await api.ownerStreamers({ authorization: auth(ownerToken) })
  assert.equal(list.status, 200)
  assert.deepEqual(list.body, { streamers: [], invites: [] })
})

test('a listed owner e-mail cannot be registered by somebody else', async () => {
  const db = openDatabase(':memory:')
  const store = new AccountStore({ db, ownerEmails: ['boss@example.com'] })
  const api = createAccountsHandlers(store)
  const attempt = await api.register({ ip: 'x', body: { email: 'BOSS@example.com', password } })
  assert.equal(store.hasAccount('boss@example.com'), false)
  // Same answer as for an address that is already taken: the reply does not reveal the owner's e-mail.
  await api.register({ ip: 'y', body: { email: 'player@example.com', password } })
  const taken = await api.register({ ip: 'z', body: { email: 'player@example.com', password } })
  assert.equal(attempt.status, 409)
  assert.deepEqual(attempt.body, taken.body)
  assert.equal(taken.status, 409)
})

test('owner generates a streamer link, sees the streamer and the same per-period table the streamer sees', async () => {
  const { api, store, login } = await setup()
  const ownerToken = await login('owner@example.com')
  const created = await api.ownerCreateStreamerInvite({ authorization: auth(ownerToken), body: { code: 'hunter_tv' } })
  assert.equal(created.status, 201)
  const invite = created.body as { token: string; code: string; expiresAt: string }
  assert.equal(invite.code, 'HUNTER_TV')
  assert.match(invite.token, /^[A-Za-z0-9_-]{32}$/)
  assert.equal((await api.ownerCreateStreamerInvite({ authorization: auth(ownerToken), body: { code: '<b>' } })).status, 400)

  const open = (await api.ownerStreamers({ authorization: auth(ownerToken) })).body as { invites: Array<{ code: string }> }
  assert.deepEqual(open.invites.map((item) => item.code), ['HUNTER_TV'])

  // The streamer registers and redeems the link.
  const streamerToken = ((await api.register({ ip: 'y', body: { email: 'streamer@example.com', password } })).body as { token: string }).token
  assert.equal((await api.redeemStreamerInvite({ authorization: auth(streamerToken), body: { token: invite.token } })).status, 200)
  assert.equal((await api.ownerCreateStreamerInvite({ authorization: auth(ownerToken), body: { code: 'HUNTER_TV' } })).status, 409)

  // Audience visits with and without a campaign label, one registration.
  store.recordReferralVisit('HUNTER_TV', 'viewer-1', 'YouTube')
  store.recordReferralVisit('HUNTER_TV', 'viewer-2', 'twitch')
  store.recordReferralVisit('HUNTER_TV', 'viewer-3', 'youtube')
  store.recordReferralVisit('HUNTER_TV', 'viewer-4')
  store.recordReferralVisit('HUNTER_TV', 'viewer-5', 'bad label!')
  await api.register({ ip: 'z', body: { email: 'viewer@example.com', password, referralCode: 'hunter_tv' } })

  const listed = (await api.ownerStreamers({ authorization: auth(ownerToken) })).body as { streamers: Array<{ email: string; code: string; stats: { visits: number; registrations: number } }>; invites: unknown[] }
  assert.equal(listed.invites.length, 0)
  assert.equal(listed.streamers.length, 1)
  assert.equal(listed.streamers[0]!.email, 'streamer@example.com')
  assert.equal(listed.streamers[0]!.stats.visits, 5)
  assert.equal(listed.streamers[0]!.stats.registrations, 1)

  for (const period of ['day', 'month', 'year'] as const) {
    const own = await api.referralSeries({ authorization: auth(streamerToken), query: { period } })
    const seen = await api.ownerStreamerStats({ authorization: auth(ownerToken), query: { code: 'hunter_tv', period } })
    assert.equal(seen.status, 200)
    const body = seen.body as { code: string; period: string; rows: unknown[] }
    assert.equal(body.code, 'HUNTER_TV')
    // Same table as the streamer's, plus the revenue column only the owner sees.
    assert.deepEqual(body.rows.map((row) => { const { revenue, ...rest } = row as { revenue?: number }; assert.equal(typeof revenue, 'number'); return rest }), (own.body as { rows: unknown[] }).rows)
  }
  assert.equal((await api.ownerStreamerStats({ authorization: auth(ownerToken), query: { code: 'NOBODY' } })).status, 404)
  assert.equal((await api.ownerStreamerStats({ authorization: auth(ownerToken), query: {} })).status, 400)

  // Campaign visits: labels are lower-cased, invalid labels are dropped (the visit itself still counts).
  const campaigns = await api.referralCampaigns({ authorization: auth(streamerToken) })
  assert.equal(campaigns.status, 200)
  assert.deepEqual((campaigns.body as { campaigns: Array<{ campaign: string; visits: number }> }).campaigns.map(({ campaign, visits }) => [campaign, visits]), [['youtube', 2], ['twitch', 1]])
  const ownerView = (await api.ownerStreamerStats({ authorization: auth(ownerToken), query: { code: 'HUNTER_TV' } })).body as { campaigns: unknown }
  assert.deepEqual(ownerView.campaigns, (campaigns.body as { campaigns: unknown }).campaigns)
  assert.equal((await api.referralCampaigns({ authorization: auth(ownerToken) })).status, 403)
})

test('referral visit accepts an optional campaign and stays backward compatible', async () => {
  const { api, store } = await setup()
  await store.register('s@example.com', password)
  store.promoteToStreamer('s@example.com', 'CAMP')
  assert.equal((await api.referralVisit({ ip: '1', body: { code: 'camp' } })).status, 200)
  assert.equal((await api.referralVisit({ ip: '2', body: { code: 'camp', campaign: 'shorts' } })).status, 200)
  assert.equal((await api.referralVisit({ ip: '3', body: { code: 'camp', campaign: 'x'.repeat(65) } })).status, 400)
  const token = (await store.login('s@example.com', password)).token
  const view = (await api.me({ authorization: auth(token) })).body as AccountView
  assert.equal(view.stats?.visits, 2)
})

test('registration and payment consent is stored with its version and time', async () => {
  const { api, store } = await setup()
  const registered = await api.register({ ip: 'x', body: { email: 'consent@example.com', password } })
  const token = (registered.body as { token: string }).token
  assert.equal((await api.recordConsent({ authorization: auth(token), body: { kind: 'registration', version: 'yesterday' } })).status, 400)
  assert.equal((await api.recordConsent({ body: { kind: 'registration', version: '2026-09-30' } })).status, 401)
  const saved = await api.recordConsent({ authorization: auth(token), body: { kind: 'registration', version: '2026-09-30' } })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body, { consents: [{ kind: 'registration', version: '2026-09-30', acceptedAt: '2026-10-01T10:00:00.000Z' }] })
  // Repeating is harmless.
  await api.recordConsent({ authorization: auth(token), body: { kind: 'registration', version: '2026-09-30' } })
  assert.equal(store.consents(store.authenticate(token)!).length, 1)
})

test('no checkout: /v1/payments shows no plans and the payment history only', async () => {
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [] })
  const payments = new PaymentStore(db, undefined)
  accounts.attachSubscriptions(payments)
  const { token } = await accounts.register('payer@example.com', password)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/v1/payments`
  try {
    assert.deepEqual(await (await fetch(`${base}/plans`)).json(), { enabled: false, plans: [] })
    assert.equal((await fetch(base)).status, 401)
    assert.deepEqual(await (await fetch(base, { headers: { authorization: auth(token) } })).json(), { payments: [] })
    const checkout = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth(token) }, body: JSON.stringify({ plan: '1m', consent: { version: '2026-09-30' } }) })
    assert.equal(checkout.status, 404)
    for (const path of ['/yookassa/webhook', '/lava/webhook', '/autopay/cancel']) assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 404, path)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('older payment tables get the consent columns on start', () => {
  const db = openDatabase(':memory:')
  new AccountStore({ db, ownerEmails: [] })
  db.exec("CREATE TABLE payments (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT UNIQUE, plan TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, referral_code TEXT, created_at INTEGER NOT NULL, paid_at INTEGER)")
  new PaymentStore(db, undefined)
  const columns = (db.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string }>).map((row) => row.name)
  assert.ok(columns.includes('consent_version') && columns.includes('consent_at'))
  new PaymentStore(db, undefined) // idempotent
})
