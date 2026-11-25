/**
 * Who reaches the owner's admin panel and a streamer's cabinet is decided by the server from the session alone (owner,
 * 25.11.2026: «при подмене ссылок в браузере, либо подмене кода в браузере, никто не смог зайти в админ-панель и в
 * личный кабинет стримера»). Every way a client can lie is tried here against the real routes: forged headers, role
 * fields in the body or the query, another streamer's code or id, other spellings of the owner's e-mail, forged or dead
 * sessions, another site's page, and the letter case or trailing slash of the path.
 *
 * Covered elsewhere and not repeated: /v1/admin and /health/detail only for a direct request on this PC
 * (serverGuard.test.ts), owner rights only with a confirmed e-mail (email.test.ts), the per-e-mail limit of failed
 * sign-ins (accounts.test.ts), Google's token checks (google.test.ts).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { createApi, DEFAULT_WEB_ORIGINS, type ApiOptions } from '../app.js'
import { AccountStore, newPasswordHash, OWNER_SESSION_TTL_MS, REGISTRATION_REFUSED_MESSAGE, SESSION_TTL_MS } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { EmailAuthService } from '../services/emailAuth.js'
import { FakeEmailSender } from '../services/email/index.js'
import { ProgressStore } from '../services/progressStore.js'

const PASSWORD = 'correct horse battery'
const OWNER = 'owner@example.com'

interface Session { id: string; token: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Answer { status: number; body: any; text: string; headers: IncomingHttpHeaders }
type Send = (method: string, path: string, options?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Answer>

/** The API on a free port; requests through node:http, so every header (Origin, Host, Cookie) goes out as written. */
async function serve(accounts: AccountStore, options: Partial<ApiOptions> = {}) {
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, options).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const port = (server.address() as AddressInfo).port
  const send: Send = (method, path, opts = {}) => new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const request = httpRequest({
      host: '127.0.0.1', port, method, path, agent: false,
      headers: {
        ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body: unknown
        try { body = JSON.parse(text) } catch { body = undefined }
        resolve({ status: response.statusCode ?? 0, body, text, headers: response.headers })
      })
    })
    request.on('error', reject)
    if (payload !== undefined) request.write(payload)
    request.end()
  })
  return { send, close: () => new Promise<void>((resolve) => server.close(() => { store.close(); resolve() })) }
}

interface World {
  send: Send
  accounts: AccountStore
  db: DatabaseSync
  now: () => number
  advance: (ms: number) => void
  /** The owner (TARKOV_OWNER_EMAILS, e-mail confirmed), a player, and the streamers ALPHA and BRAVO. */
  owner: Session
  player: Session
  alpha: Session
  bravo: Session
}

async function withWorld(run: (world: World) => Promise<void>, options: { owners?: string[]; api?: (accounts: AccountStore, now: () => number) => Partial<ApiOptions> } = {}) {
  let time = Date.parse('2026-11-25T08:00:00.000Z')
  const now = () => time
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: options.owners ?? [OWNER] })
  const session = (token: string): Session => ({ id: accounts.authenticate(token)!, token })
  const { salt, hash } = await newPasswordHash(PASSWORD)
  const owner = session(accounts.createVerifiedAccount(OWNER, salt, hash).token)
  const player = session((await accounts.register('player@example.com', PASSWORD, undefined, undefined, 'DE')).token)
  const alpha = session((await accounts.register('alpha@example.com', PASSWORD, undefined, undefined, 'DE')).token)
  accounts.promoteToStreamer('alpha@example.com', 'ALPHA')
  const bravo = session((await accounts.register('bravo@example.com', PASSWORD, undefined, undefined, 'DE')).token)
  accounts.promoteToStreamer('bravo@example.com', 'BRAVO')
  const api = await serve(accounts, options.api?.(accounts, now) ?? {})
  try {
    await run({ send: api.send, accounts, db, now, advance: (ms) => { time += ms }, owner, player, alpha, bravo })
  } finally {
    await api.close()
  }
}

/** A refusal carries nothing but the reason: no data of the route. */
function refused(answer: Answer, statuses: number[], label: string) {
  assert.ok(statuses.includes(answer.status), `${label}: ${answer.status} ${answer.text.slice(0, 160)}`)
  const extra = Object.keys(answer.body ?? {}).filter((key) => key !== 'error' && key !== 'code')
  assert.deepEqual(extra, [], `${label}: ${answer.text.slice(0, 160)}`)
}

/** Everything a page whose code was changed could add to its requests to look like the owner or a local call. */
const FORGED_HEADERS: Record<string, string> = {
  'x-owner': '1', 'x-admin': 'true', 'x-is-admin': '1', 'x-role': 'owner', 'x-user-role': 'admin', 'x-account-kind': 'streamer',
  'x-user-email': OWNER, 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', forwarded: 'for=127.0.0.1;host=localhost',
  'x-forwarded-host': '127.0.0.1:8787', 'x-forwarded-proto': 'https', origin: 'https://raidos.app', referer: 'https://raidos.app/admin',
  'user-agent': 'Raid OS Owner', 'x-requested-with': 'XMLHttpRequest',
}
const forgedQuery = (ownerId: string) => `owner=true&isOwner=1&admin=1&role=owner&kind=streamer&email=${encodeURIComponent(OWNER)}&accountId=${ownerId}&as=owner`
const withQuery = (path: string, query: string) => `${path}${path.includes('?') ? '&' : '?'}${query}`

/** The owner's read routes of every admin panel (website, PC app, phone app — they all call these). */
const ownerReads = (world: World) => [
  '/v1/accounts/me/admin/overview', '/v1/accounts/me/admin/stats', '/v1/accounts/me/admin/series?period=day', '/v1/accounts/me/admin/ads?period=day',
  '/v1/accounts/me/admin/calendar?month=2026-11', '/v1/accounts/me/admin/day?date=2026-11-25', '/v1/accounts/me/admin/online-stats',
  '/v1/accounts/me/admin/update-history', '/v1/accounts/me/admin/users', '/v1/accounts/me/admin/users.csv',
  `/v1/accounts/me/admin/users/${world.player.id}`, `/v1/accounts/me/admin/users/${world.player.id}/profile`,
  `/v1/accounts/me/admin/users/${world.player.id}/devices`, '/v1/accounts/me/admin/payments', '/v1/accounts/me/admin/payments.csv',
  '/v1/accounts/me/admin/audit', '/v1/accounts/me/admin/streamers', '/v1/accounts/me/admin/streamer-stats?code=BRAVO&period=day',
  '/v1/accounts/me/admin/streamer-settings', '/v1/accounts/me/admin/payouts', '/v1/accounts/me/admin/sales-settings',
  '/v1/accounts/me/admin/online', '/v1/accounts/me/admin/phones', '/v1/accounts/me/admin/security', '/v1/accounts/me/admin/security/events',
  '/v1/accounts/me/admin/bug-reports', '/v1/accounts/me/admin/bug-reports/table', '/v1/accounts/me/admin/support/threads',
  '/v1/accounts/me/admin/support/search?q=player', `/v1/accounts/me/admin/support/threads/${world.player.id}`, '/v1/accounts/me/admin/notices',
  '/v1/accounts/me/admin/invite-rewards', '/v1/accounts/me/admin/invite-rewards/attention', '/v1/accounts/me/admin/referrals',
  '/v1/accounts/me/admin/eft-cases', '/v1/accounts/me/admin/requests-key', '/v1/accounts/me/admin/quest-points',
  '/v1/accounts/me/admin/quest-texts', '/v1/accounts/me/admin/quest-requirements', '/v1/accounts/me/admin/event-quests',
  '/v1/accounts/me/admin/overview-defaults', '/v1/accounts/me/admin/hideout-modules', '/v1/accounts/me/admin/player-news',
  '/v1/accounts/me/admin/announcement', '/v1/accounts/me/admin/announcement/history', '/v1/accounts/me/admin/features',
  '/v1/accounts/me/admin/trial-features', '/v1/accounts/me/admin/stickers', '/v1/accounts/me/admin/bezebee/status',
  '/v1/accounts/me/admin/bezebee/events', '/v1/accounts/me/admin/update',
]
/** Owner routes whose answer to the owner is no plain 200 in a test (no exe on this server, no owner app, a long wait). */
const OWNER_ROUTES_NOT_200_HERE = [
  '/v1/accounts/me/admin/server-exe-manifest', '/v1/accounts/me/admin/payment-settings/yookassa', '/v1/accounts/me/admin/requests/events',
  '/v1/accounts/me/admin/quest-base',
]

test('every owner route: 401 signed out, 404 for a player and a streamer, whatever headers, query or path spelling they send', async () => {
  await withWorld(async (world) => {
    const { send, owner, player, alpha } = world
    const query = forgedQuery(owner.id)
    for (const path of [...ownerReads(world), ...OWNER_ROUTES_NOT_200_HERE]) {
      refused(await send('GET', withQuery(path, query), { headers: FORGED_HEADERS }), [401, 404], `signed out ${path}`)
      refused(await send('GET', withQuery(path, query), { token: player.token, headers: FORGED_HEADERS }), [404], `player ${path}`)
      refused(await send('GET', withQuery(path, query), { token: alpha.token, headers: FORGED_HEADERS }), [404], `streamer ${path}`)
    }
    // Other spellings of the same routes (Express matches them case-insensitively and with a trailing slash).
    for (const path of ['/v1/accounts/me/admin/overview/', '/v1/ACCOUNTS/ME/ADMIN/OVERVIEW', '/v1/accounts/me/Admin/Users', '/v1/accounts/me/admin/payouts/', '/v1/accounts/me/admin/Streamers', '/v1/Accounts/Me/Admin/Audit']) {
      refused(await send('GET', path), [401, 404], `signed out ${path}`)
      refused(await send('GET', path, { token: player.token, headers: FORGED_HEADERS }), [404], `player ${path}`)
      refused(await send('GET', path, { token: alpha.token }), [404], `streamer ${path}`)
    }
    // The same routes answer the owner (the session is the only thing that differs).
    for (const path of ownerReads(world)) {
      const answer = await send('GET', path, { token: owner.token })
      assert.equal(answer.status, 200, `owner ${path}: ${answer.text.slice(0, 160)}`)
    }
  })
})

test('owner actions: a player or a streamer gets 404 and nothing changes, whatever the body claims', async () => {
  await withWorld(async ({ send, accounts, db, owner, player, alpha, bravo }) => {
    // A request of BRAVO's waiting for the owner.
    const payoutId = 'b'.repeat(24)
    db.prepare("INSERT INTO streamer_payouts (id, account_id, code, amount, status, auto, phone, bank, recipient, created_at) VALUES (?, ?, 'BRAVO', 50000, 'pending', 0, '+79991234567', 'Т-Банк', 'Иван Петров', ?)").run(payoutId, bravo.id, Date.now())
    const claims = { owner: true, isOwner: true, admin: true, role: 'owner', kind: 'streamer', actor: OWNER, email: OWNER, accountId: owner.id }
    const attempts: Array<[string, string, Session, unknown]> = [
      ['POST', `/v1/accounts/me/admin/users/${player.id}/grant`, player, { days: 3650, reason: 'self grant', ...claims }],
      ['POST', '/v1/accounts/me/admin/users/bulk-grant', player, { ids: [player.id], days: 3650, reason: 'self grant' }],
      ['POST', `/v1/accounts/me/admin/users/${owner.id}/block`, player, { reason: 'x', ...claims }],
      ['POST', `/v1/accounts/me/admin/users/${owner.id}/revoke-sessions`, alpha, claims],
      ['POST', `/v1/accounts/me/admin/users/${player.id}/email`, player, { ...claims, email: 'owner2@example.com' }],
      ['POST', `/v1/accounts/me/admin/users/${bravo.id}/delete`, alpha, claims],
      ['POST', `/v1/accounts/me/admin/users/${player.id}/devices/device-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/revoke`, player, claims],
      ['PUT', '/v1/accounts/me/admin/streamers/ALPHA/percent', alpha, { percent: 100, ...claims }],
      ['PUT', '/v1/accounts/me/admin/streamers/BRAVO/link', alpha, { enabled: false }],
      ['POST', '/v1/accounts/me/admin/streamers/BRAVO/revoke', alpha, claims],
      ['POST', '/v1/accounts/me/admin/streamer-invites', alpha, { code: 'EVILCODE', ...claims }],
      ['POST', '/v1/accounts/me/admin/payouts/decide', bravo, { id: payoutId, status: 'paid', ...claims }],
      ['POST', '/v1/accounts/me/admin/payouts/decide', alpha, { id: payoutId, status: 'rejected' }],
      ['PUT', '/v1/accounts/me/admin/payout-limits', alpha, { min: 1, max: 1 }],
      ['POST', '/v1/accounts/me/admin/security/allowlist', player, { ip: '203.0.113.9' }],
      ['POST', '/v1/accounts/me/admin/security/bans', player, { ip: '198.51.100.7', hours: 720 }],
      ['POST', '/v1/accounts/me/admin/requests-key', player, claims],
      ['POST', '/v1/accounts/me/admin/server-exe-link', player, claims],
      ['PUT', '/v1/accounts/me/admin/announcement', player, { text: 'Сервер закрыт', enabled: true }],
      ['POST', '/v1/accounts/me/admin/notices', player, { title: 'x', text: 'y' }],
      ['PUT', '/v1/accounts/me/admin/trial-features', player, claims],
      ['PUT', '/v1/accounts/me/admin/player-news', player, claims],
      ['POST', '/v1/accounts/me/admin/bezebee/payments', player, { email: 'player@example.com', plan: '12m' }],
      ['PUT', '/v1/accounts/me/admin/bezebee/credentials', player, { apiToken: 'x' }],
      ['POST', '/v1/accounts/me/admin/invite-rewards/1/decide', player, { decision: 'approve' }],
      ['POST', '/v1/accounts/me/admin/bug-reports/1/reward', player, { days: 365 }],
      ['POST', `/v1/accounts/me/admin/support/threads/${bravo.id}/messages`, alpha, { text: 'hi' }],
      ['DELETE', `/v1/accounts/me/admin/support/threads/${bravo.id}`, alpha, undefined],
    ]
    for (const [method, path, who, body] of attempts) {
      refused(await send(method, path, { body, headers: FORGED_HEADERS }), [401, 404], `signed out ${method} ${path}`)
      refused(await send(method, path, { token: who.token, body, headers: FORGED_HEADERS }), [404], `${method} ${path}`)
    }
    // Nothing happened.
    assert.notEqual(accounts.view(player.id).subscription.status, 'active')
    assert.equal(accounts.view(player.id).email, 'player@example.com')
    assert.equal(accounts.isBlocked(owner.id), false)
    assert.equal(accounts.authenticate(owner.token), owner.id)
    assert.equal(accounts.streamerCode(bravo.id), 'BRAVO')
    assert.equal(accounts.holderOfCode('EVILCODE'), undefined)
    assert.equal((db.prepare('SELECT status FROM streamer_payouts WHERE id = ?').get(payoutId) as { status: string }).status, 'pending')
    const settings = await send('GET', '/v1/accounts/me/admin/streamer-settings', { token: owner.token })
    const alphaShare = (settings.body.streamers as Array<{ code: string; percent: number; custom: boolean; linkEnabled: boolean }>).find((row) => row.code === 'ALPHA')!
    assert.equal(alphaShare.custom, false)
    assert.notEqual(alphaShare.percent, 100)
    assert.equal((settings.body.streamers as Array<{ code: string; linkEnabled: boolean }>).find((row) => row.code === 'BRAVO')!.linkEnabled, true)
    const security = await send('GET', '/v1/accounts/me/admin/security', { token: owner.token })
    assert.equal(JSON.stringify(security.body.allowlist).includes('203.0.113.9'), false)
    assert.equal(JSON.stringify(security.body.bans).includes('198.51.100'), false)
    assert.equal((await send('GET', '/v1/accounts/me/admin/audit', { token: owner.token })).body.total, 0, 'no owner action was taken')
  })
})

test('streamer cabinet: each streamer reads and changes only his own; another streamer\'s code or id anywhere in the request is ignored', async () => {
  await withWorld(async ({ send, accounts, db, owner, player, alpha, bravo }) => {
    // BRAVO: a visit of his link with a campaign label, his payout details and a request waiting for the owner.
    assert.equal(accounts.recordReferralVisit('BRAVO', '203.0.113.5', 'yt'), true)
    assert.equal((await send('PUT', '/v1/accounts/me/payout-settings', { token: bravo.token, body: { phone: '+79991234567', bank: 'Т-Банк', recipient: 'Иван Петров' } })).status, 200)
    const payoutId = 'c'.repeat(24)
    db.prepare("INSERT INTO streamer_payouts (id, account_id, code, amount, status, auto, phone, bank, recipient, created_at) VALUES (?, ?, 'BRAVO', 50000, 'pending', 0, '+79991234567', 'Т-Банк', 'Иван Петров', ?)").run(payoutId, bravo.id, Date.now())
    const visits = (rows: Array<{ visits: number }>) => rows.reduce((sum, row) => sum + row.visits, 0)
    const others = `code=BRAVO&referralCode=BRAVO&accountId=${bravo.id}&account_id=${bravo.id}&streamer=BRAVO`

    // Statistics: ALPHA asking for BRAVO's gets his own (nothing), BRAVO his own.
    const alphaStats = await send('GET', `/v1/accounts/me/referral-stats?period=day&${others}`, { token: alpha.token, headers: FORGED_HEADERS })
    assert.equal(alphaStats.status, 200)
    assert.equal(visits(alphaStats.body.rows), 0)
    assert.equal(visits((await send('GET', '/v1/accounts/me/referral-stats?period=day', { token: bravo.token })).body.rows), 1)
    assert.deepEqual((await send('GET', `/v1/accounts/me/referral-campaigns?${others}`, { token: alpha.token })).body.campaigns, [])
    assert.equal((await send('GET', '/v1/accounts/me/referral-campaigns', { token: bravo.token })).body.campaigns[0].campaign, 'yt')
    const alphaMe = await send('GET', `/v1/accounts/me?${others}`, { token: alpha.token, headers: FORGED_HEADERS })
    assert.equal(alphaMe.body.referralCode, 'ALPHA')
    assert.equal(alphaMe.body.stats.visits, 0)
    assert.equal(alphaMe.body.owner, undefined)
    // One streamer's table for the owner only.
    refused(await send('GET', '/v1/accounts/me/admin/streamer-stats?code=BRAVO&period=day', { token: alpha.token }), [404], 'ALPHA reads BRAVO\'s table')
    refused(await send('GET', '/v1/accounts/me/admin/streamer-stats?code=BRAVO&period=day', { token: bravo.token }), [404], 'BRAVO reads his own table as the owner')
    const ownerView = await send('GET', '/v1/accounts/me/admin/streamer-stats?code=BRAVO&period=day', { token: owner.token })
    assert.equal(visits(ownerView.body.rows), 1)

    // Payouts: ALPHA's cabinet never shows BRAVO's details or requests.
    const alphaPayouts = await send('GET', `/v1/accounts/me/payouts?${others}`, { token: alpha.token, headers: FORGED_HEADERS })
    assert.equal(alphaPayouts.status, 200)
    assert.deepEqual(alphaPayouts.body.payouts, [])
    assert.equal(alphaPayouts.body.details, null)
    assert.equal(/Иван|4567|Т-Банк/.test(alphaPayouts.text), false)
    // ALPHA's details with BRAVO's id and code in the body change ALPHA's only.
    const saved = await send('PUT', '/v1/accounts/me/payout-settings', { token: alpha.token, body: { phone: '+79990000000', bank: 'Сбер', recipient: 'Пётр Сидоров', accountId: bravo.id, account_id: bravo.id, code: 'BRAVO', percent: 100 } })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.details.recipient, 'Пётр Сидоров')
    const bravoPayouts = await send('GET', '/v1/accounts/me/payouts', { token: bravo.token })
    assert.equal(bravoPayouts.body.details.recipient, 'Иван Петров')
    assert.equal(bravoPayouts.body.details.phone, '+7 ••• •••-45-67', 'the streamer himself sees his phone masked')
    // A request «for BRAVO» from ALPHA is ALPHA's (no balance), BRAVO's request stays as it was.
    assert.equal((await send('POST', '/v1/accounts/me/payouts', { token: alpha.token, body: { amount: 100, code: 'BRAVO', accountId: bravo.id } })).status, 400)
    assert.deepEqual(db.prepare('SELECT code, status FROM streamer_payouts ORDER BY code').all().map((row) => ({ ...row })), [{ code: 'BRAVO', status: 'pending' }])
    // Nobody but the owner marks a request paid — the streamer least of all his own.
    refused(await send('POST', '/v1/accounts/me/admin/payouts/decide', { token: bravo.token, body: { id: payoutId, status: 'paid' } }), [404], 'BRAVO marks his own request paid')
    assert.equal((db.prepare('SELECT status FROM streamer_payouts WHERE id = ?').get(payoutId) as { status: string }).status, 'pending')
    const decided = await send('POST', '/v1/accounts/me/admin/payouts/decide', { token: owner.token, body: { id: payoutId, status: 'paid' } })
    assert.equal(decided.status, 200)
    assert.equal((await send('GET', '/v1/accounts/me/payouts', { token: bravo.token })).body.payouts[0].status, 'paid')

    // A player has no cabinet, whatever he sends.
    for (const [method, path, body] of [
      ['GET', `/v1/accounts/me/payouts?${others}`, undefined], ['GET', `/v1/accounts/me/referral-stats?period=day&${others}`, undefined],
      ['GET', `/v1/accounts/me/referral-campaigns?${others}`, undefined], ['PUT', '/v1/accounts/me/payout-settings', { phone: '+79990000001', bank: 'Сбер', recipient: 'Пётр Сидоров', kind: 'streamer', code: 'BRAVO' }],
      ['POST', '/v1/accounts/me/payouts', { amount: 100, code: 'BRAVO', kind: 'streamer' }],
    ] as Array<[string, string, unknown]>) refused(await send(method, path, { token: player.token, body, headers: FORGED_HEADERS }), [403], `player ${method} ${path}`)
    // And a streamer cannot make himself one by asking: a forged invitation token is unknown.
    refused(await send('POST', '/v1/accounts/me/streamer-invite', { token: player.token, body: { token: 'A'.repeat(32) } }), [404], 'forged streamer invitation')
    assert.equal(accounts.streamerCode(player.id), undefined)
  })
})

test('registration and profile updates ignore role fields: kind, referral code, owner, share, confirmed e-mail', async () => {
  await withWorld(async ({ send, db }) => {
    const roleFields = {
      kind: 'streamer', referral_code: 'MASSCODE', referralCodeOwn: 'MASSCODE', owner: true, isOwner: true, role: 'owner', admin: true, percent: 100,
      email_verified_at: 1, emailVerifiedAt: '2026-01-01T00:00:00.000Z', email_grandfathered: 1, blocked_at: null,
      subscription: { status: 'active', lifetime: true }, stats: { earnings: { amount: 1_000_000, currency: 'RUB' } }, statsOnly: true,
    }
    const created = await send('POST', '/v1/accounts/register', { body: { email: 'mass@example.com', password: PASSWORD, country: 'DE', ...roleFields }, headers: FORGED_HEADERS })
    assert.equal(created.status, 201, created.text)
    const token = created.body.token as string
    for (const view of [created.body.account, (await send('GET', '/v1/accounts/me', { token })).body]) {
      assert.equal(view.kind, 'user')
      assert.equal(view.referralCode, undefined)
      assert.equal(view.owner, undefined)
      assert.equal(view.emailVerifiedAt, undefined)
      assert.notEqual(view.subscription.status, 'active')
      assert.equal(view.stats, undefined)
    }
    const nicknames = await send('PUT', '/v1/accounts/me/nicknames', { token, body: { nickname: 'Mass_1', ...roleFields, email: OWNER } })
    assert.equal(nicknames.status, 200)
    assert.equal(nicknames.body.kind, 'user')
    assert.equal(nicknames.body.email, 'mass@example.com')
    assert.notEqual((await send('POST', '/v1/accounts/me/initial-country', { token, body: { country: 'DE', kind: 'streamer' } })).status, 200)
    assert.deepEqual({ ...db.prepare("SELECT kind, referral_code, email_verified_at, email_grandfathered FROM accounts WHERE email = 'mass@example.com'").get() }, { kind: 'user', referral_code: null, email_verified_at: null, email_grandfathered: 0 })
    refused(await send('GET', '/v1/accounts/me/admin/overview', { token }), [404], 'mass assignment → admin')
    refused(await send('GET', '/v1/accounts/me/payouts', { token }), [403], 'mass assignment → cabinet')
  })
})

test('the owner\'s e-mail in other spellings gives no owner rights: case, spaces, +tags, Gmail dots, googlemail, Kelvin sign, look-alike letters', async () => {
  const gmailOwner = 'boss.kapitan@gmail.com'
  await withWorld(async ({ send, owner, player }) => {
    let address = 0
    // Each attempt from its own address, so the per-IP sign-up limit plays no part.
    const register = (email: string) => send('POST', '/v1/accounts/register', { body: { email, password: PASSWORD, country: 'DE' }, headers: { 'x-forwarded-for': `198.51.100.${++address}` } })
    // The owner's own addresses, however written, are never registered again (the same answer as any taken address).
    for (const email of ['OWNER@EXAMPLE.COM', '  owner@example.com  ', 'owner@EXAMPLE.com', 'BOSS.KAPITAN@GMAIL.COM', ' Boss.Kapitan@Gmail.Com', 'boss.Kapitan@gmail.com']) {
      const answer = await register(email)
      assert.equal(answer.status, 409, `${JSON.stringify(email)}: ${answer.text}`)
      assert.equal(answer.body.error, REGISTRATION_REFUSED_MESSAGE)
    }
    // Similar addresses are other mailboxes' accounts: they may exist, but never as the owner.
    for (const email of ['owner+admin@example.com', 'bosskapitan@gmail.com', 'boss.kapitan@googlemail.com', 'boss.kapitan+x@gmail.com', 'b.o.s.s.kapitan@gmail.com', 'оwner@example.com', 'ｏwner@example.com', 'owner@example.com.', 'owner@examp1e.com']) {
      const answer = await register(email)
      assert.ok([201, 400].includes(answer.status), `${JSON.stringify(email)}: ${answer.text}`)
      if (answer.status !== 201) continue
      assert.equal(answer.body.account.owner, undefined, email)
      refused(await send('GET', '/v1/accounts/me/admin/overview', { token: answer.body.token }), [404], `${email} → admin`)
    }
    // «Изменить e-mail» in the admin panel never moves a player onto an owner's address, however written.
    for (const email of ['OWNER@example.com', ' Owner@Example.Com ', gmailOwner, 'BOSS.KAPITAN@gmail.com']) {
      const answer = await send('POST', `/v1/accounts/me/admin/users/${player.id}/email`, { token: owner.token, body: { email } })
      assert.equal(answer.status, 409, `${JSON.stringify(email)}: ${answer.text}`)
    }
    refused(await send('GET', '/v1/accounts/me/admin/overview', { token: player.token }), [404], 'the player after the refused e-mail changes')
  }, { owners: [OWNER, gmailOwner] })
})

test('«Войти через Google» never signs in as the owner, whatever letter case Google\'s address comes in', async () => {
  // The verifier stands in for Google: it «confirms» whatever address the test names.
  const verify = async (token: unknown) => ({ email: String(token), subject: '1' })
  await withWorld(async ({ send }) => {
    for (const email of [OWNER, 'Owner@Example.COM', ' owner@example.com ']) {
      const answer = await send('POST', '/v1/accounts/google', { body: { credential: email, country: 'DE' } })
      assert.equal(answer.status, 403, `${email}: ${answer.text}`)
      assert.equal(answer.body.token, undefined)
    }
  }, { api: () => ({ googleVerifier: verify }) })
})

test('sessions: only a live token in the Authorization header counts — forged, altered, expired, revoked tokens and tokens elsewhere get nothing', async () => {
  await withWorld(async ({ send, accounts, db, now, advance, owner, player }) => {
    const admin = '/v1/accounts/me/admin/overview'
    assert.equal((await send('GET', admin, { token: owner.token })).status, 200)
    const flipped = owner.token.slice(0, -1) + (owner.token.endsWith('A') ? 'B' : 'A')
    for (const headers of [
      { authorization: `Bearer ${'A'.repeat(43)}` }, { authorization: `Bearer ${flipped}` }, { authorization: `Bearer ${owner.token.toUpperCase()}` },
      { authorization: `Bearer ${owner.token}x` }, { authorization: `bearer ${owner.token}` }, { authorization: `Token ${owner.token}` },
      { authorization: `Basic ${Buffer.from(`${OWNER}:${PASSWORD}`).toString('base64')}` }, { authorization: `Bearer ${owner.token} ${owner.token}` },
      { cookie: `token=${owner.token}; session=${owner.token}` }, { 'x-auth-token': owner.token }, { 'x-access-token': owner.token }, { 'x-session': owner.token },
    ] as Array<Record<string, string>>) refused(await send('GET', admin, { headers }), [401], JSON.stringify(Object.keys(headers)))
    for (const query of [`token=${owner.token}`, `access_token=${owner.token}`, `authorization=Bearer%20${owner.token}`]) {
      refused(await send('GET', `${admin}?${query}`), [401], query.split('=')[0]!)
    }
    refused(await send('POST', '/v1/accounts/me/admin/users/bulk-grant', { body: { token: owner.token, ids: [player.id], days: 30, reason: 'grant' } }), [401], 'token in the body')

    // Signing out ends that session only; «Выйти на всех устройствах» and a new password end them all.
    const second = (await accounts.login(OWNER, PASSWORD)).token
    assert.equal((await send('POST', '/v1/accounts/logout', { token: second })).status, 204)
    refused(await send('GET', admin, { token: second }), [401], 'after sign-out')
    assert.equal((await send('GET', admin, { token: owner.token })).status, 200)
    const playerSecond = (await accounts.login('player@example.com', PASSWORD)).token
    assert.equal((await send('POST', '/v1/accounts/me/sessions/revoke-all', { token: player.token })).status, 200)
    refused(await send('GET', '/v1/accounts/me', { token: playerSecond }), [401], 'after revoke-all')
    // Expiry: a player's week, the owner's 90 days without use.
    const fresh = (await accounts.login('player@example.com', PASSWORD)).token
    advance(SESSION_TTL_MS + 1)
    refused(await send('GET', '/v1/accounts/me', { token: fresh }), [401], 'expired player session')
    const ownerIdle = (await accounts.login(OWNER, PASSWORD)).token
    advance(OWNER_SESSION_TTL_MS + 1)
    refused(await send('GET', admin, { token: ownerIdle }), [401], 'owner session idle past its term')
    // A blocked account's sessions end at once.
    const owner2 = (await accounts.login(OWNER, PASSWORD)).token
    const blocked = (await accounts.login('player@example.com', PASSWORD)).token
    assert.equal((await send('POST', `/v1/accounts/me/admin/users/${player.id}/block`, { token: owner2, body: {} })).status, 200)
    refused(await send('GET', '/v1/accounts/me', { token: blocked }), [401], 'blocked account')
    // Owner rights follow the server's list: the same session without the e-mail on the list is an ordinary one.
    const unlisted = new AccountStore({ db, now, ownerEmails: [] })
    const other = await serve(unlisted)
    try {
      refused(await other.send('GET', admin, { token: owner2 }), [404], 'owner e-mail removed from the list')
      assert.equal((await other.send('GET', '/v1/accounts/me', { token: owner2 })).body.owner, undefined)
    } finally {
      await other.close()
    }
  })
})

test('another site cannot use a visitor\'s session: no CORS answer for a foreign origin, no cookies at all', async () => {
  await withWorld(async ({ send, player }) => {
    const allowed = (process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGINS).split(',').map((origin) => origin.trim()).filter(Boolean)[0]!
    for (const origin of ['https://evil.example', 'https://raidos.app.evil.example', 'null', 'https://raidos-app.example']) {
      const preflight = await send('OPTIONS', '/v1/accounts/me/admin/overview', { headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })
      assert.equal(preflight.headers['access-control-allow-origin'], undefined, origin)
      const read = await send('GET', '/v1/accounts/me', { token: player.token, headers: { origin } })
      assert.equal(read.headers['access-control-allow-origin'], undefined, origin)
      assert.equal(read.headers['access-control-allow-credentials'], undefined, origin)
    }
    const own = await send('GET', '/v1/accounts/me', { token: player.token, headers: { origin: allowed } })
    assert.equal(own.headers['access-control-allow-origin'], allowed)
    assert.equal(own.headers['access-control-allow-credentials'], undefined, 'the session never rides on browser credentials')
    const login = await send('POST', '/v1/accounts/login', { body: { email: 'player@example.com', password: PASSWORD } })
    assert.equal(login.status, 200)
    assert.equal(login.headers['set-cookie'], undefined, 'no cookie: nothing for a forged cross-site request to carry')
  })
})

test('paid content cannot be reached past the subscription and device check by another letter case of the path', async () => {
  await withWorld(async ({ send, player, alpha }) => {
    // The player has no subscription (402); the streamer has access but no registered device for this session (403).
    for (const path of [
      '/v1/me/progress/pvp', '/v1/ME/progress/pvp', '/v1/me/PROGRESS/pvp', '/v1/Me/Settings', '/v1/me/Story/pvp', '/v1/me/progress/pvp/',
      '/v1/QUEST-POINTS', '/v1/Quest-Texts', '/v1/Map-Bosses', '/V1/owner-builds', '/v1/Event-Quests',
    ]) {
      refused(await send('GET', path, { token: player.token }), [402], `player ${path}`)
      refused(await send('GET', path, { token: alpha.token }), [403], `streamer without this device ${path}`)
    }
  }, { api: () => ({ paidContent: true }) })
})

test('failed sign-ins count for the security guard whatever the letter case of the path: password guessing over many e-mails is banned', async () => {
  await withWorld(async ({ send }) => {
    const from = { 'x-forwarded-for': '203.0.113.60' }
    for (let attempt = 0; attempt < 6; attempt++) {
      const path = attempt % 2 ? '/v1/accounts/LOGIN' : '/v1/Accounts/Login'
      const answer = await send('POST', path, { body: { email: `victim${attempt}@example.com`, password: 'wrong password 1' }, headers: from })
      assert.equal(answer.status, 401, `${path}: ${answer.text}`)
    }
    const after = await send('GET', '/v1/accounts/me', { headers: from })
    assert.equal(after.status, 403, `the address is banned for credential stuffing: ${after.text}`)
  })
})

test('the owner\'s older actions are written to the audit log whatever the letter case or trailing slash of the path', async () => {
  await withWorld(async ({ send, db, owner, bravo }) => {
    const payoutId = 'd'.repeat(24)
    db.prepare("INSERT INTO streamer_payouts (id, account_id, code, amount, status, auto, phone, bank, recipient, created_at) VALUES (?, ?, 'BRAVO', 50000, 'pending', 0, '+79991234567', 'Т-Банк', 'Иван Петров', ?)").run(payoutId, bravo.id, Date.now())
    assert.equal((await send('POST', '/v1/accounts/me/admin/Streamer-Invites', { token: owner.token, body: { code: 'CASEONE' } })).status, 201)
    assert.equal((await send('POST', '/v1/accounts/me/admin/streamer-invites/', { token: owner.token, body: { code: 'CASETWO' } })).status, 201)
    assert.equal((await send('POST', '/v1/accounts/me/admin/PAYOUTS/decide', { token: owner.token, body: { id: payoutId, status: 'rejected' } })).status, 200)
    const audit = await send('GET', '/v1/accounts/me/admin/audit', { token: owner.token })
    const entries = (audit.body.entries as Array<{ action: string; target?: string; actor: string }>).map(({ action, target, actor }) => `${actor} ${action} ${target}`).sort()
    assert.deepEqual(entries, [`${OWNER} payout.decide ${payoutId}`, `${OWNER} streamer.invite CASEONE`, `${OWNER} streamer.invite CASETWO`])
  })
})

test('codes from e-mails reach only the account they were sent for: a reset or sign-in code of one account opens no other', async () => {
  const sender = new FakeEmailSender()
  let emails: EmailAuthService | undefined
  await withWorld(async ({ send, accounts, advance, owner }) => {
    const start = async (kind: 'reset' | 'login', email: string) => {
      const answer = await send('POST', `/v1/accounts/email/${kind}/start`, { body: { email } })
      assert.equal(answer.status, 200, answer.text)
      return answer.body.challengeId as string
    }
    const playerReset = await start('reset', 'player@example.com')
    const ownerReset = await start('reset', OWNER)
    await emails!.settled()
    const playerCode = sender.lastCode('player@example.com')!
    const ownerCode = sender.lastCode(OWNER)!
    assert.ok(playerCode && ownerCode)
    // The player's own code with the owner's challenge, and the other way round: refused.
    refused(await send('POST', '/v1/accounts/email/reset', { body: { challengeId: ownerReset, code: playerCode, password: 'a new password 1' } }), [401], 'player code on the owner challenge')
    refused(await send('POST', '/v1/accounts/email/reset', { body: { challengeId: playerReset, code: ownerCode, password: 'a new password 1' } }), [401], 'owner code on the player challenge')
    // The player's code resets the player's password and signs the player in — never anybody else.
    const reset = await send('POST', '/v1/accounts/email/reset', { body: { challengeId: playerReset, code: playerCode, password: 'a new password 1' } })
    assert.equal(reset.status, 200, reset.text)
    assert.equal(reset.body.account.email, 'player@example.com')
    assert.equal(reset.body.account.owner, undefined)
    assert.equal(accounts.authenticate(owner.token), owner.id, 'the owner keeps his session and his password')
    assert.ok((await accounts.login(OWNER, PASSWORD)).token)
    // Sign-in by code: the same.
    advance(61_000)
    const playerLogin = await start('login', 'player@example.com')
    const ownerLogin = await start('login', OWNER)
    await emails!.settled()
    refused(await send('POST', '/v1/accounts/email/login', { body: { challengeId: ownerLogin, code: sender.lastCode('player@example.com') } }), [401], 'player code signs in as the owner')
    const signedIn = await send('POST', '/v1/accounts/email/login', { body: { challengeId: playerLogin, code: sender.lastCode('player@example.com') } })
    assert.equal(signedIn.status, 200, signedIn.text)
    assert.equal(signedIn.body.account.email, 'player@example.com')
  }, { api: (accounts, now) => ({ emails: (emails = new EmailAuthService(accounts, { sender, now, log: () => {} })) }) })
})
