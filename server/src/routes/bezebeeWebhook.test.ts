import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { BezebeeCredentialStore, bezebeeSignatureValid, readBezebeeNotice } from '../services/bezebeeWebhook.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

/** BZB payment notifications (owner, 20.10.2026: «подтверждаться должно само»): signed, matched by e-mail, applied once. */
const password = 'correct horse battery'
const DAY = 86_400_000
const SECRET = 'whsec_test_secret'

async function setup() {
  let clock = Date.parse('2026-10-20T10:00:00.000Z')
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [], now: () => clock })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => clock })
  const payments = new PaymentStore(db, undefined, { now: () => clock })
  const credentials = new BezebeeCredentialStore(undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, bezebeeCredentials: credentials, bezebeeUsdRub: 100, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T }
  }
  /** BZB posting a notification: the exact bytes, signed with `secret` (none: an empty v1 like an unsigned key). */
  const notify = async (body: unknown, secret: string | null = SECRET) => {
    const raw = JSON.stringify(body)
    const signature = secret ? `v1=${createHmac('sha256', secret).update(raw).digest('hex')}` : 'v1='
    const response = await fetch(`${base}/payments/bezebee/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bzb-signature': signature }, body: raw })
    return { status: response.status, json: await response.json() as { ok: boolean; status?: string } }
  }
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  const player = async (email: string, country: string, referralCode?: string) => {
    const registered = await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country, ...(referralCode ? { referralCode } : {}) })
    assert.equal(registered.status, 201, JSON.stringify(registered.json))
    return registered.json.token
  }
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  return { db, payments, call, notify, owner, player, idOf, advance: (ms: number) => { clock += ms }, now: () => clock, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

/** A notification as BZB might send it (no public schema): nested payment, link id, buyer e-mail, amount, status. */
const paid = (id: string, link: string, email: string | null, amount: number, currency = 'RUB', extra: Record<string, unknown> = {}) => ({
  event: 'payment.succeeded',
  data: { id, status: 'succeeded', amount, currency, payment_link: { id: link, url: `https://pay.bezebee.com/${link}` }, customer: { ...(email ? { email } : {}), telegram: email ? null : '@buyer' }, ...extra },
})

test('the signature: HMAC-SHA256 of the raw body in v1 (hex or base64, with or without t=); anything else refused', () => {
  const body = Buffer.from('{"a":1}')
  const hex = createHmac('sha256', SECRET).update(body).digest('hex')
  const b64 = createHmac('sha256', SECRET).update(body).digest('base64')
  const timed = createHmac('sha256', SECRET).update(`1700000000.${body.toString()}`).digest('hex')
  assert.ok(bezebeeSignatureValid(`v1=${hex}`, body, SECRET))
  assert.ok(bezebeeSignatureValid(`v1=${b64}`, body, SECRET))
  assert.ok(bezebeeSignatureValid(`t=1700000000,v1=${timed}`, body, SECRET))
  assert.ok(!bezebeeSignatureValid('v1=', body, SECRET))
  assert.ok(!bezebeeSignatureValid(`v1=${hex}`, Buffer.from('{"a":2}'), SECRET))
  assert.ok(!bezebeeSignatureValid(`v1=${hex}`, body, 'another'))
  assert.ok(!bezebeeSignatureValid(undefined, body, SECRET))
})

test('the notification is read loosely: link → plan and region, e-mail, amount, paid or failed', () => {
  const cis = readBezebeeNotice(paid('p1', 'EIV5foW0', 'Buyer@Example.com', 800))
  assert.deepEqual([cis.status, cis.email, cis.amount, cis.paymentId, cis.tariff?.region, cis.tariff?.plan, cis.tariff?.friend], ['paid', 'buyer@example.com', 800, 'p1', 'CIS', '3m', false])
  const friend = readBezebeeNotice({ status: 'paid', link_url: 'https://pay.bezebee.com/Xw98gnXM', email: 'x@example.com', amount: 5.5 })
  assert.deepEqual([friend.tariff?.region, friend.tariff?.plan, friend.tariff?.friend], ['WORLD', '1m', true])
  assert.equal(readBezebeeNotice({ status: 'failed', link: 'EIV5foW0' }).status, 'failed')
  assert.equal(readBezebeeNotice({ status: 'pending', link: 'EIV5foW0' }).status, 'unknown')
  assert.equal(readBezebeeNotice({ status: 'paid', link: 'zzzzzzzz' }).tariff, undefined)
  // The API names links by UUID (owner's screenshot): the sum, in roubles or kopecks, with or without a currency, names the tariff.
  const byUuid = (amount: number, currency?: string) => readBezebeeNotice({ status: 'succeeded', payment_link_id: 'c69b2878-546d-4dee-8384-a6680e71e42b', amount, ...(currency ? { currency } : {}) }).tariff
  assert.deepEqual([byUuid(800, 'RUB')?.region, byUuid(800, 'RUB')?.plan], ['CIS', '3m'])
  assert.deepEqual([byUuid(24000)?.plan, byUuid(24000)?.friend], ['1m', true])
  assert.deepEqual([byUuid(5.5, 'USD')?.region, byUuid(5.5, 'USD')?.friend], ['WORLD', true])
  assert.equal(byUuid(60, 'USD')?.plan, '12m')
  assert.equal(byUuid(999, 'RUB'), undefined)
  assert.equal(byUuid(7, 'RUB'), undefined, 'another currency\'s price is no match')
})

test('a signed paid notification opens the subscription of the account with that e-mail; the same payment once', async () => {
  const t = await setup()
  try {
    await t.player('kz@example.com', 'KZ')
    // Without a secret nothing is applied (anybody could post): kept as «unverified».
    assert.deepEqual((await t.notify(paid('p0', 'NMTIra0O', 'kz@example.com', 300), null)).json, { ok: true, status: 'unverified' })
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), undefined)
    const saved = await t.call<{ webhookSecret: boolean; webhookUrl: string }>('PUT', '/accounts/me/admin/bezebee/credentials', t.owner, { apiToken: 'tok_1', webhookSecret: SECRET })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.webhookSecret, true)
    assert.match(saved.json.webhookUrl, /\/v1\/payments\/bezebee\/webhook$/)
    assert.equal(JSON.stringify(saved.json).includes(SECRET), false, 'the secret is never sent back')

    assert.equal((await t.notify(paid('p1', 'NMTIra0O', 'kz@example.com', 300), 'forged')).status, 401)
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), undefined)
    assert.deepEqual((await t.notify(paid('p1', 'NMTIra0O', 'KZ@example.com', 300))).json, { ok: true, status: 'confirmed' })
    assert.ok((t.payments.paidUntil(t.idOf('kz@example.com')) ?? 0) > t.now() + 29 * DAY)
    const until = t.payments.paidUntil(t.idOf('kz@example.com'))
    // BZB retrying the same payment adds nothing.
    assert.deepEqual((await t.notify(paid('p1', 'NMTIra0O', 'kz@example.com', 300))).json, { ok: true, status: 'duplicate' })
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), until)
    const row = t.db.prepare("SELECT provider, amount FROM payments WHERE account_id = ? AND status = 'succeeded'").get(t.idOf('kz@example.com')) as { provider: string; amount: number }
    assert.deepEqual([row.provider, row.amount], ['bezebee', 30000])
    // A failed or unpaid notice does nothing.
    assert.equal((await t.notify({ data: { id: 'p2', status: 'failed', payment_link: 'NMTIra0O', email: 'kz@example.com' } })).json.status, 'ignored')
  } finally { await t.close() }
})

test('the friend price spends the discount; a WORLD payment is kept in roubles at the configured rate', async () => {
  const t = await setup()
  try {
    await t.call('PUT', '/accounts/me/admin/bezebee/credentials', t.owner, { webhookSecret: SECRET })
    const inviter = await t.player('inviter@example.com', 'RU')
    const code = (await t.call<{ code: string }>('GET', '/accounts/me/invites', inviter)).json.code
    const friend = await t.player('friend@example.com', 'KZ', code)
    assert.equal((await t.notify(paid('f1', 'DBmUzkAn', 'friend@example.com', 240))).json.status, 'confirmed')
    assert.equal((await t.call<{ bezebee: { friend: unknown } }>('GET', '/payments', friend)).json.bezebee.friend, null)
    // The referral page paid again (the discount is spent): not applied, waits for the owner.
    assert.equal((await t.notify(paid('f2', 'DBmUzkAn', 'friend@example.com', 240))).json.status, 'unmatched')

    await t.player('de@example.com', 'DE')
    assert.equal((await t.notify(paid('w1', 'EpGyVETp', 'de@example.com', 19, 'USD'))).json.status, 'confirmed')
    const row = t.db.prepare("SELECT amount FROM payments WHERE account_id = ? AND status = 'succeeded'").get(t.idOf('de@example.com')) as { amount: number }
    assert.equal(row.amount, 190000, '$19 at 100 ₽')
  } finally { await t.close() }
})

test('unmatched (Telegram only, unknown e-mail, Russia) waits in the owner\'s panel and is attached to an account by hand', async () => {
  const t = await setup()
  try {
    await t.call('PUT', '/accounts/me/admin/bezebee/credentials', t.owner, { webhookSecret: SECRET })
    const buyer = await t.player('tg-buyer@example.com', 'BY')
    assert.equal((await t.notify(paid('t1', 'iPnQLAib', null, 1500))).json.status, 'unmatched')
    assert.equal((await t.notify(paid('t2', 'iPnQLAib', 'nobody@example.com', 1500))).json.status, 'unmatched')
    await t.player('ru@example.com', 'RU')
    assert.equal((await t.notify(paid('t3', 'iPnQLAib', 'ru@example.com', 1500))).json.status, 'unmatched')

    type Events = { events: Array<{ id: number; status: string; plan?: string; telegram?: string; detail?: string }>; unmatched: number }
    const list = (await t.call<Events>('GET', '/accounts/me/admin/bezebee/events?status=unmatched', t.owner)).json
    assert.equal(list.unmatched, 3)
    const tg = list.events.find((event) => event.telegram === '@buyer')!
    assert.equal(tg.plan, '6m')
    assert.equal((await t.call('GET', `/accounts/me/admin/bezebee/events/${tg.id}/payload`, t.owner)).status, 200)
    assert.equal((await t.call('GET', '/accounts/me/admin/bezebee/events', buyer)).status, 404, 'owner only')
    assert.equal((await t.call('POST', `/accounts/me/admin/bezebee/events/${tg.id}/attach`, buyer, { email: 'tg-buyer@example.com' })).status, 404, 'owner only')

    const attached = await t.call<{ event: { status: string } }>('POST', `/accounts/me/admin/bezebee/events/${tg.id}/attach`, t.owner, { email: 'tg-buyer@example.com' })
    assert.equal(attached.status, 200, JSON.stringify(attached.json))
    assert.equal(attached.json.event.status, 'confirmed')
    assert.ok((t.payments.paidUntil(t.idOf('tg-buyer@example.com')) ?? 0) > t.now() + 170 * DAY)
    assert.equal((await t.call('POST', `/accounts/me/admin/bezebee/events/${tg.id}/attach`, t.owner, { email: 'tg-buyer@example.com' })).status, 409, 'once')
    const status = (await t.call<{ apiToken: boolean; webhookSecret: boolean; lastEventAt?: string }>('GET', '/accounts/me/admin/bezebee/status', t.owner)).json
    assert.deepEqual([status.apiToken, status.webhookSecret, Boolean(status.lastEventAt)], [false, true, true])

    // «Убрать»: a waiting notification that is no payment leaves the list; a confirmed one cannot be dismissed.
    const stray = list.events.find((event) => event.id !== tg.id)!
    assert.equal((await t.call('POST', `/accounts/me/admin/bezebee/events/${stray.id}/dismiss`, buyer)).status, 404, 'owner only')
    const dismissed = await t.call<{ event: { status: string } }>('POST', `/accounts/me/admin/bezebee/events/${stray.id}/dismiss`, t.owner)
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.json))
    assert.equal(dismissed.json.event.status, 'ignored')
    assert.equal((await t.call<Events>('GET', '/accounts/me/admin/bezebee/events', t.owner)).json.unmatched, 1)
    assert.equal((await t.call('POST', `/accounts/me/admin/bezebee/events/${tg.id}/dismiss`, t.owner)).status, 409)
    assert.equal((await t.call('POST', '/accounts/me/admin/bezebee/events/99999/dismiss', t.owner)).status, 404)
  } finally { await t.close() }
})
