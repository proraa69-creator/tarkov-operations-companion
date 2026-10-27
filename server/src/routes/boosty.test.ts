import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { BOOSTY_LINKS, boostyLink } from '../services/boosty.js'
import { openDatabase } from '../services/database.js'
import { audienceMatches } from '../services/noticeStore.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { CIS_COUNTRIES } from '../../../src/shared/countries.js'
import { CIS_PAYMENT_COUNTRIES, paymentRegionOf } from '../../../src/shared/paymentRegions.js'

/** Payment regions and Boosty (docs/payments/payment-regions-and-announcements.md, the owner's spec). */
const password = 'correct horse battery'
const DAY = 86_400_000
const WORLD = ['4136082', '4136112']
const CIS = ['4136107', '4136111']
let clock = Date.parse('2026-10-15T10:00:00.000Z')

async function setup() {
  clock = Date.parse('2026-10-15T10:00:00.000Z')
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [], now: () => clock })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => clock })
  const yookassa = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}')) as { metadata?: unknown; amount?: unknown }
    return new Response(JSON.stringify({ id: '2d0000000001-000f-5000-9000-1b68e7b15f3f', status: 'pending', metadata: body.metadata, amount: body.amount, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/x' } }), { status: 200 })
  }) as unknown as typeof fetch
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_x', monthPrice: 300, receipts: false, streamerPercent: 0, publicUrl: 'https://raidos.example.com' }, { fetch: yookassa, now: () => clock })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T }
  }
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  /** A player of `country` (null: an account from before the question), optionally with a friend's code. */
  const player = async (email: string, country: string | null, referralCode?: string) => {
    const registered = await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: country ?? 'RU', ...(referralCode ? { referralCode } : {}) })
    assert.equal(registered.status, 201, JSON.stringify(registered.json))
    if (country === null) db.prepare('UPDATE accounts SET country = NULL WHERE email = ?').run(email)
    return registered.json.token
  }
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  return { db, accounts, payments, call, owner, player, idOf, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

type Choice = { region: string | null; provider: string | null; boosty: { offers: string[] } | null; friendDiscount: unknown }
type Link = { url: string; region: string; offer: string; error?: string; code?: string }
const ack = (offer: string, extra: Record<string, unknown> = {}) => ({ offer, acknowledged: true, ...extra })

test('region from the saved country: RU, CIS without Russia, WORLD for everything else; none without a country', () => {
  assert.equal(paymentRegionOf('RU'), 'RU')
  assert.equal(paymentRegionOf(' ru '), 'RU')
  for (const code of ['BY', 'KZ', 'KG', 'TJ', 'UZ', 'TM', 'AM', 'AZ', 'MD']) assert.equal(paymentRegionOf(code), 'CIS', code)
  // Europe (Ukraine included), Georgia, Türkiye, the USA and a country typed by hand: WORLD.
  for (const code of ['UA', 'DE', 'PL', 'GE', 'TR', 'US', 'CN', 'XX']) assert.equal(paymentRegionOf(code), 'WORLD', code)
  for (const value of [undefined, null, '', 'R', 'RUS']) assert.equal(paymentRegionOf(value), undefined)
  assert.deepEqual([...CIS_PAYMENT_COUNTRIES].sort(), CIS_COUNTRIES.filter((code) => code !== 'RU').sort())
  assert.ok(!CIS_PAYMENT_COUNTRIES.includes('RU'))
})

test('links: each region only its own offers, Russia none', () => {
  assert.equal(boostyLink('RU', 'standard'), undefined)
  assert.equal(boostyLink('RU', 'friend'), undefined)
  assert.match(boostyLink('CIS', 'standard')!, /\/purchase\/4136107\?/)
  assert.match(boostyLink('CIS', 'friend')!, /\/purchase\/4136111\?/)
  assert.match(boostyLink('WORLD', 'standard')!, /\/purchase\/4136082\?/)
  assert.match(boostyLink('WORLD', 'friend')!, /\/purchase\/4136112\?/)
  for (const url of Object.values(BOOSTY_LINKS.CIS)) assert.ok(!WORLD.some((id) => url.includes(id)))
  for (const url of Object.values(BOOSTY_LINKS.WORLD)) assert.ok(!CIS.some((id) => url.includes(id)))
  assert.deepEqual(Object.keys(BOOSTY_LINKS).sort(), ['CIS', 'WORLD'])
})

test('GET /v1/payments and POST /v1/payments/boosty follow the saved country; the request cannot pick a region', async () => {
  const t = await setup()
  try {
    const ru = await t.player('ru@example.com', 'RU')
    const kz = await t.player('kz@example.com', 'KZ')
    const de = await t.player('de@example.com', 'DE')
    const none = await t.player('none@example.com', null)

    const ruChoice = (await t.call<Choice>('GET', '/payments', ru)).json
    assert.deepEqual([ruChoice.region, ruChoice.provider, ruChoice.boosty], ['RU', 'yookassa', null])
    const kzChoice = (await t.call<Choice>('GET', '/payments', kz)).json
    assert.deepEqual([kzChoice.region, kzChoice.provider, kzChoice.boosty], ['CIS', 'boosty', { offers: ['standard'] }])
    const deChoice = (await t.call<Choice>('GET', '/payments', de)).json
    assert.deepEqual([deChoice.region, deChoice.provider, deChoice.boosty], ['WORLD', 'boosty', { offers: ['standard'] }])
    const noneChoice = (await t.call<Choice>('GET', '/payments', none)).json
    assert.deepEqual([noneChoice.region, noneChoice.provider, noneChoice.boosty], [null, null, null])

    // The warning must be acknowledged first.
    assert.equal((await t.call('POST', '/payments/boosty', kz, { offer: 'standard' })).status, 400)
    assert.equal((await t.call('POST', '/payments/boosty', kz, { offer: 'standard', acknowledged: false })).status, 400)
    assert.equal((await t.call('POST', '/payments/boosty', undefined, ack('standard'))).status, 401)

    const cis = await t.call<Link>('POST', '/payments/boosty', kz, ack('standard'))
    assert.equal(cis.status, 200)
    assert.deepEqual([cis.json.region, cis.json.offer], ['CIS', 'standard'])
    assert.equal(cis.json.url, BOOSTY_LINKS.CIS.standard)
    // A cheaper region asked for in the body changes nothing: WORLD stays WORLD, CIS stays CIS.
    const world = await t.call<Link>('POST', '/payments/boosty', de, ack('standard', { region: 'CIS', country: 'KZ' }))
    assert.equal(world.status, 200)
    assert.equal(world.json.url, BOOSTY_LINKS.WORLD.standard)
    assert.ok(!CIS.some((id) => world.json.url.includes(id)))
    const cisAgain = await t.call<Link>('POST', '/payments/boosty', kz, ack('standard', { region: 'WORLD' }))
    assert.ok(!WORLD.some((id) => cisAgain.json.url.includes(id)))

    // Russia never gets a Boosty link; no country — nothing until it is named.
    const ruLink = await t.call<Link>('POST', '/payments/boosty', ru, ack('standard', { region: 'CIS' }))
    assert.equal(ruLink.status, 409)
    assert.equal(ruLink.json.url, undefined)
    const noneLink = await t.call<Link>('POST', '/payments/boosty', none, ack('standard'))
    assert.deepEqual([noneLink.status, noneLink.json.code], [409, 'COUNTRY_REQUIRED'])
    // No friend's code: the friend offer is never handed out.
    const friend = await t.call<Link>('POST', '/payments/boosty', de, ack('friend'))
    assert.equal(friend.status, 403)
    assert.equal(friend.json.url, undefined)

    // The owner sees which links were opened.
    const view = await t.call<{ region: string; requests: Array<{ offer: string; region: string }> }>('GET', `/accounts/me/admin/users/${t.idOf('kz@example.com')}/boosty`, t.owner)
    assert.equal(view.json.region, 'CIS')
    assert.deepEqual(view.json.requests.map((item) => [item.offer, item.region]), [['standard', 'CIS'], ['standard', 'CIS']])
  } finally {
    await t.close()
  }
})

test('ЮKassa is Russia only: no country blocks paying, CIS / WORLD are sent to Boosty', async () => {
  const t = await setup()
  try {
    const body = { plan: '1m', consent: { version: '2026-09-30' }, region: 'RU', country: 'RU' }
    const none = await t.player('none@example.com', null)
    const blocked = await t.call<{ code: string }>('POST', '/payments', none, body)
    assert.deepEqual([blocked.status, blocked.json.code], [409, 'COUNTRY_REQUIRED'])
    const kz = await t.player('kz@example.com', 'KZ')
    const cis = await t.call<{ code: string }>('POST', '/payments', kz, body)
    assert.deepEqual([cis.status, cis.json.code], [409, 'BOOSTY_REGION'])
    const ru = await t.player('ru@example.com', 'RU')
    const ok = await t.call<{ confirmationUrl: string }>('POST', '/payments', ru, body)
    assert.equal(ok.status, 201)
    assert.match(ok.json.confirmationUrl, /^https:\/\/yoomoney\.ru\//)
  } finally {
    await t.close()
  }
})

test('the friend discount: only with a friend\'s code, spent once by the owner\'s confirmation, never back', async () => {
  const t = await setup()
  try {
    const inviter = await t.player('inviter@example.com', 'RU')
    const code = (await t.call<{ code: string }>('GET', '/accounts/me/invites', inviter)).json.code
    const friend = await t.player('friend@example.com', 'KZ', code)
    const choice = (await t.call<Choice>('GET', '/payments', friend)).json
    assert.deepEqual(choice.boosty, { offers: ['standard', 'friend'] })
    const link = await t.call<Link>('POST', '/payments/boosty', friend, ack('friend'))
    assert.equal(link.json.url, BOOSTY_LINKS.CIS.friend)

    // Owner only (404 for a player, 401 without a session).
    const input = { email: 'Friend@Example.com', offer: 'friend', months: 1, amount: 240, reference: 'boosty-001' }
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', friend, input)).status, 404)
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', undefined, input)).status, 401)
    // The friend discount is for the 1-month plan.
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', t.owner, { ...input, months: 3 })).status, 400)
    // A period is required: months or «оплачено до», not both.
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', t.owner, { email: input.email, offer: 'friend' })).status, 400)
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', t.owner, { ...input, paidUntil: '2026-11-20' })).status, 400)

    const confirmed = await t.call<{ payment: { offer: string; region: string; plan: string; amount: number; status: string; email: string; reference: string }; user: { subscription: { status: string; paidUntil: string } } }>('POST', '/accounts/me/admin/boosty/payments', t.owner, input)
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.json))
    assert.deepEqual([confirmed.json.payment.offer, confirmed.json.payment.region, confirmed.json.payment.plan, confirmed.json.payment.amount, confirmed.json.payment.status, confirmed.json.payment.email, confirmed.json.payment.reference],
      ['friend', 'CIS', '1m', 240, 'succeeded', 'friend@example.com', 'boosty-001'])
    assert.equal(confirmed.json.user.subscription.status, 'active')
    assert.equal(Date.parse(confirmed.json.user.subscription.paidUntil), clock + 30 * DAY)

    // Spent: not offered again (also after a reload), the link is refused, a second confirmation with it is refused.
    const after = (await t.call<Choice>('GET', '/payments', friend)).json
    assert.deepEqual([after.boosty, after.friendDiscount], [{ offers: ['standard'] }, null])
    assert.equal((await t.call('POST', '/payments/boosty', friend, ack('friend'))).status, 403)
    const again = await t.call<{ code: string }>('POST', '/accounts/me/admin/boosty/payments', t.owner, { ...input, reference: 'boosty-002' })
    assert.deepEqual([again.status, again.json.code], [409, 'friend_without_referral'])
    // The same Boosty payment twice: refused.
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', t.owner, { ...input, offer: 'standard' })).status, 409)
    // A standard renewal goes on top of the paid period.
    const renewed = await t.call<{ payment: { offer: string } }>('POST', '/accounts/me/admin/boosty/payments', t.owner, { email: 'friend@example.com', offer: 'standard', months: 3 })
    assert.equal(renewed.status, 201)
    assert.equal(renewed.json.payment.offer, 'standard')
    assert.equal(t.payments.paidUntil(t.idOf('friend@example.com')), clock + 120 * DAY)

    // The inviter's reward follows the discounted first payment (services/invites.ts; on review here: one test address).
    const rewards = t.db.prepare("SELECT kind, status FROM invite_rewards WHERE inviter_id = ?").all(t.idOf('inviter@example.com')) as Array<{ kind: string; status: string }>
    assert.deepEqual(rewards.map((row) => row.kind), ['friend'])
    assert.ok(['pending', 'review'].includes(rewards[0]!.status))

    const list = await t.call<{ total: number; payments: Array<{ offer: string; plan: string; region: string }> }>('GET', '/accounts/me/admin/boosty/payments?email=friend@example.com', t.owner)
    assert.equal(list.json.total, 2)
    assert.deepEqual(list.json.payments.map((item) => [item.offer, item.plan, item.region]), [['standard', '3m', 'CIS'], ['friend', '1m', 'CIS']])
    assert.equal((await t.call('GET', '/accounts/me/admin/boosty/payments', friend)).status, 404)
  } finally {
    await t.close()
  }
})

test('the owner\'s confirmation refuses Russia, accounts without a country, unknown e-mails, other regions and a friend discount nobody has', async () => {
  const t = await setup()
  try {
    await t.player('ru@example.com', 'RU')
    await t.player('none@example.com', null)
    await t.player('us@example.com', 'US')
    const confirm = (email: string, extra: Record<string, unknown> = {}) => t.call<{ error: string; code: string }>('POST', '/accounts/me/admin/boosty/payments', t.owner, { email, offer: 'standard', months: 1, ...extra })
    assert.deepEqual([(await confirm('ru@example.com')).status, (await confirm('ru@example.com')).json.code], [409, 'region_mismatch'])
    assert.deepEqual([(await confirm('ru@example.com', { region: 'CIS' })).json.code], ['region_mismatch'])
    assert.deepEqual([(await confirm('none@example.com')).status, (await confirm('none@example.com')).json.code], [409, 'no_country'])
    assert.deepEqual([(await confirm('nobody@example.com')).status, (await confirm('nobody@example.com')).json.code], [404, 'unknown_email'])
    assert.equal((await confirm('us@example.com', { offer: 'friend' })).json.code, 'friend_without_referral')
    // A CIS offer bought by a WORLD account: refused, nothing granted.
    assert.equal((await confirm('us@example.com', { region: 'CIS' })).json.code, 'region_mismatch')
    assert.equal(t.payments.paidUntil(t.idOf('us@example.com')), undefined)
    const ok = await t.call<{ payment: { region: string; amount: number; source: string; offerKey: string } }>('POST', '/accounts/me/admin/boosty/payments', t.owner, { email: 'us@example.com', offer: 'standard', region: 'WORLD', paidUntil: '2026-11-20' })
    assert.deepEqual([ok.status, ok.json.payment.region, ok.json.payment.amount, ok.json.payment.source, ok.json.payment.offerKey], [201, 'WORLD', 0, 'manual', 'WORLD_STANDARD'])
    // «Оплачено до» 20.11 (end of the day, Moscow) + 1 day of grace.
    assert.equal(t.payments.paidUntil(t.idOf('us@example.com')), Date.parse('2026-11-20T23:59:59+03:00') + DAY)
    // Unknown fields are refused (the tool must not send a price or an account of its own); dates in the past too.
    assert.equal((await confirm('us@example.com', { price: 1 })).status, 400)
    assert.equal((await confirm('us@example.com', { months: undefined, paidUntil: '2026-10-01' })).status, 400)
  } finally {
    await t.close()
  }
})

test('the owner\'s confirmation: days instead of months, the sum after the commission, and «Выдать с перерасчётом» for another region (20.10.2026)', async () => {
  const t = await setup()
  try {
    await t.player('kz@example.com', 'KZ')
    await t.player('de@example.com', 'DE')
    type Answer = { payment: { amount: number }; recalculatedDays?: number; error?: string; code?: string }
    const confirm = (body: Record<string, unknown>) => t.call<Answer>('POST', '/accounts/me/admin/boosty/payments', t.owner, body)
    // Days from now (no period yet), and the net sum kept on the payment.
    const days = await confirm({ email: 'kz@example.com', offer: 'standard', region: 'CIS', days: 10, amount: 300, netAmount: 270 })
    assert.equal(days.status, 201)
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), clock + 10 * DAY)
    assert.equal(Number((t.db.prepare('SELECT net_amount FROM payments WHERE account_id = ?').get(t.idOf('kz@example.com')) as { net_amount: number }).net_amount), 27000)
    assert.equal((await confirm({ email: 'kz@example.com', offer: 'standard', region: 'CIS', months: 1, days: 3 })).status, 400)
    assert.equal((await confirm({ email: 'kz@example.com', offer: 'standard', region: 'CIS', days: 0 })).status, 400)
    // A German account bought the CIS level: refused as before; with «перерасчёт» the days the sum is worth at the WORLD price.
    const cis = { email: 'de@example.com', offer: 'standard', region: 'CIS', months: 1, amount: 240 }
    assert.equal((await confirm(cis)).json.code, 'region_mismatch')
    const unknownPrice = await confirm({ ...cis, recalculate: true })
    assert.deepEqual([unknownPrice.status, unknownPrice.json.code], [409, 'region_mismatch'])
    t.db.prepare("INSERT INTO boosty_levels (level_id, name, price, last_seen_at) VALUES ('4136082', 'Мир', 480, ?) ON CONFLICT(level_id) DO UPDATE SET price = excluded.price").run(clock)
    const recalculated = await confirm({ ...cis, recalculate: true })
    assert.deepEqual([recalculated.status, recalculated.json.recalculatedDays], [201, 15])
    assert.equal(t.payments.paidUntil(t.idOf('de@example.com')), clock + 15 * DAY)
  } finally {
    await t.close()
  }
})

test('announcement audiences: the legacy Boosty ones still read; the regions «Россия», «СНГ» (without Russia), «Мир» (16.10.2026)', async () => {
  const facts = (country: string | null) => ({ id: 'a', kind: 'user', country, countrySetAt: null, createdAt: 0, paidUntil: 0 })
  const matches = (payRegion: 'CIS' | 'WORLD' | 'ALL_PAID_REGIONS', country: string | null) => audienceMatches({ regions: [], payment: 'all', payRegion }, 1, facts(country), 1)
  assert.deepEqual(['RU', 'KZ', 'BY', 'DE', 'US', 'XX', null].map((country) => matches('CIS', country)), [false, true, true, false, false, false, false])
  assert.deepEqual(['RU', 'KZ', 'BY', 'DE', 'US', 'XX', null].map((country) => matches('WORLD', country)), [false, false, false, true, true, true, false])
  assert.deepEqual(['RU', 'KZ', 'BY', 'DE', 'US', 'XX', null].map((country) => matches('ALL_PAID_REGIONS', country)), [false, true, true, true, true, true, false])
  // «Россия» is its own region now; «СНГ» is the CIS without Russia, like the Boosty one.
  assert.equal(audienceMatches({ regions: ['ru'], payment: 'all' }, 1, facts('RU'), 1), true)
  assert.equal(audienceMatches({ regions: ['cis'], payment: 'all' }, 1, facts('RU'), 1), false)

  const t = await setup()
  try {
    const tokens: Record<string, string> = {}
    for (const [email, country] of [['ru@example.com', 'RU'], ['kz@example.com', 'KZ'], ['am@example.com', 'AM'], ['de@example.com', 'DE'], ['us@example.com', 'US'], ['none@example.com', null]] as const) tokens[email] = await t.player(email, country)
    clock += 1000
    const send = (audience: Record<string, unknown>) => t.call<{ notice: { id: number; targeted: number; audience: { regions: string[]; payRegion?: string } } }>('POST', '/accounts/me/admin/notices', t.owner, { title: 'Boosty', text: 'Оплата через Boosty', audience })
    const cis = await send({ regions: [], payment: 'all', payRegion: 'CIS' })
    assert.equal(cis.status, 201)
    assert.deepEqual([cis.json.notice.targeted, cis.json.notice.audience.payRegion], [2, 'CIS'])
    const world = await send({ regions: [], payment: 'all', payRegion: 'WORLD' })
    assert.equal(world.json.notice.targeted, 2)
    const all = await send({ regions: [], payment: 'all', payRegion: 'ALL_PAID_REGIONS' })
    assert.equal(all.json.notice.targeted, 4)
    assert.equal((await send({ regions: ['world'], payment: 'all', payRegion: 'WORLD' })).status, 400)
    assert.equal((await send({ regions: [], payment: 'all', payRegion: 'RU' })).status, 400)
    // The regions: «Россия» (the RU player and the RU owner), «СНГ» without Russia (KZ, AM), and everybody.
    assert.equal((await send({ regions: ['ru'], payment: 'all' })).json.notice.targeted, 2)
    assert.equal((await send({ regions: ['cis'], payment: 'all' })).json.notice.targeted, 2)
    assert.equal((await send({ regions: [], payment: 'all' })).json.notice.targeted, 7)
    // Delivery: a Russian player never gets a Boosty announcement, a Kazakh one gets the CIS one.
    const inbox = async (email: string) => {
      const response = await t.call<{ notices: Array<{ id: number }> }>('GET', '/me/notices', tokens[email])
      assert.equal(response.status, 200, JSON.stringify(response.json))
      return response.json.notices.map((item) => item.id)
    }
    const ids = { cis: cis.json.notice.id, world: world.json.notice.id, all: all.json.notice.id }
    const boostyOnly = (list: number[]) => list.filter((id) => Object.values(ids).includes(id)).sort((a, b) => a - b)
    assert.deepEqual(boostyOnly(await inbox('ru@example.com')), [])
    assert.deepEqual(boostyOnly(await inbox('kz@example.com')), [ids.cis, ids.all])
    assert.deepEqual(boostyOnly(await inbox('us@example.com')), [ids.world, ids.all])
    assert.deepEqual(boostyOnly(await inbox('none@example.com')), [])
  } finally {
    await t.close()
  }
})

test('BZB tariffs (owner, 20.10.2026): CIS in roubles, the rest of the world in dollars, never Russia; each plan its own page with the offer consent', async () => {
  const { call, player, close, accounts, idOf } = await setup()
  try {
    const cis = await player('bzb-kz@example.com', 'KZ')
    const ru = await player('bzb-ru@example.com', 'RU')
    const world = await player('bzb-de@example.com', 'DE')
    const none = await player('bzb-none@example.com', null)
    type WithBzb = { bezebee: { currency: string; plans: Array<{ plan: string; months: number; price: number; url?: string }>; friend: unknown } | null }
    assert.deepEqual((await call<WithBzb>('GET', '/payments', cis)).json.bezebee, { currency: 'RUB', plans: [{ plan: '1m', months: 1, price: 300 }, { plan: '3m', months: 3, price: 800 }, { plan: '6m', months: 6, price: 1500 }, { plan: '12m', months: 12, price: 2400 }], friend: null })
    assert.deepEqual((await call<WithBzb>('GET', '/payments', world)).json.bezebee, { currency: 'USD', plans: [{ plan: '1m', months: 1, price: 7 }, { plan: '3m', months: 3, price: 19 }, { plan: '6m', months: 6, price: 35 }, { plan: '12m', months: 12, price: 60 }], friend: null })
    for (const token of [ru, none]) assert.equal((await call<WithBzb>('GET', '/payments', token)).json.bezebee, null)

    const consent = { version: '2026-10-20.2' }
    const pages = (token: string) => Promise.all(['1m', '3m', '6m', '12m'].map(async (plan) => {
      const answer = await call<{ url: string; plan: string }>('POST', '/payments/bezebee', token, { plan, consent })
      assert.equal(answer.status, 200)
      assert.equal(answer.json.plan, plan)
      // The page with the account's e-mail already typed in (BZB's form reads `?email=`).
      assert.match(answer.json.url, /^https:\/\/pay\.bezebee\.com\/[A-Za-z0-9]+\?email=bzb-[a-z]+%40example\.com$/)
      return answer.json.url
    }))
    const cisPages = await pages(cis)
    const worldPages = await pages(world)
    assert.equal(new Set([...cisPages, ...worldPages]).size, 8, 'each plan and region its own page')
    // The offer / personal data consent is stored like a ЮKassa payment's.
    assert.ok(accounts.consents(idOf('bzb-kz@example.com')).some((entry) => entry.kind === 'payment' && entry.version === '2026-10-20.2'))
    assert.equal((await call('POST', '/payments/bezebee', cis, { plan: '1m' })).status, 400, 'no page without the consent')
    assert.equal((await call('POST', '/payments/bezebee', cis, { plan: '1m', consent: { version: 'yes' } })).status, 400)
    assert.equal((await call('POST', '/payments/bezebee', cis, { plan: '2m', consent })).status, 400)
    assert.equal((await call<{ code: string }>('POST', '/payments/bezebee', ru, { plan: '1m', consent })).json.code, 'BEZEBEE_REGION')
    assert.equal((await call<{ code: string }>('POST', '/payments/bezebee', none, { plan: '1m', consent })).json.code, 'COUNTRY_REQUIRED')
    assert.equal((await call('POST', '/payments/bezebee', undefined, { plan: '1m', consent })).status, 401)
    // No friend's code: no referral page.
    assert.equal((await call('POST', '/payments/bezebee', cis, { plan: '1m', friend: true, consent })).status, 403)
  } finally {
    await close()
  }
})

test('BZB referral page (owner, 20.10.2026): the first month at the friend price, only for an invited account, 1 month only', async () => {
  const { call, player, close } = await setup()
  try {
    const inviter = await player('bzb-inviter@example.com', 'RU')
    const code = (await call<{ code: string }>('GET', '/accounts/me/invites', inviter)).json.code
    const consent = { version: '2026-10-20.2' }
    for (const [email, country, price, page] of [['bzb-friend-kz@example.com', 'KZ', 240, 'DBmUzkAn'], ['bzb-friend-de@example.com', 'DE', 5.5, 'Xw98gnXM']] as const) {
      const friend = await player(email, country, code)
      const offer = (await call<{ bezebee: { friend: { plan: string; price: number } | null } }>('GET', '/payments', friend)).json.bezebee
      assert.deepEqual(offer.friend, { plan: '1m', price })
      const answer = await call<{ url: string; friend: boolean }>('POST', '/payments/bezebee', friend, { plan: '1m', friend: true, consent })
      assert.equal(answer.status, 200)
      assert.equal(answer.json.url, `https://pay.bezebee.com/${page}?email=${encodeURIComponent(email)}`)
      assert.equal(answer.json.friend, true)
      assert.equal((await call('POST', '/payments/bezebee', friend, { plan: '3m', friend: true, consent })).status, 403, 'the discount is for the first month only')
    }
  } finally {
    await close()
  }
})

test('owner preview (owner, 20.10.2026): ?as=CIS|WORLD&friend=1 shows that checkout to the owner only; anybody else gets their own region', async () => {
  const { call, owner, player, close } = await setup()
  try {
    type Overview = { region: string | null; bezebee: { currency: string; friend: { price: number } | null } | null; preview?: boolean }
    const asCis = (await call<Overview>('GET', '/payments?as=CIS', owner)).json
    assert.equal(asCis.region, 'CIS')
    assert.equal(asCis.bezebee?.currency, 'RUB')
    assert.equal(asCis.bezebee?.friend, null)
    assert.equal(asCis.preview, true)
    const asWorldFriend = (await call<Overview>('GET', '/payments?as=WORLD&friend=1', owner)).json
    assert.equal(asWorldFriend.bezebee?.currency, 'USD')
    assert.deepEqual(asWorldFriend.bezebee?.friend, { plan: '1m', price: 5.5 })
    const consent = { version: '2026-10-20.2' }
    assert.equal((await call<{ url: string }>('POST', '/payments/bezebee', owner, { plan: '1m', friend: true, as: 'CIS', consent })).json.url, 'https://pay.bezebee.com/DBmUzkAn?email=owner%40example.com')
    assert.equal((await call<{ url: string }>('POST', '/payments/bezebee', owner, { plan: '12m', as: 'WORLD', consent })).json.url, 'https://pay.bezebee.com/sOGFWBn6?email=owner%40example.com')
    // A player cannot pick another region or the friend price this way.
    const ru = await player('preview-ru@example.com', 'RU')
    const view = (await call<Overview>('GET', '/payments?as=CIS&friend=1', ru)).json
    assert.equal(view.region, 'RU')
    assert.equal(view.bezebee, null)
    assert.equal(view.preview, undefined)
    assert.equal((await call<{ code: string }>('POST', '/payments/bezebee', ru, { plan: '1m', as: 'CIS', consent })).json.code, 'BEZEBEE_REGION')
    const kz = await player('preview-kz@example.com', 'KZ')
    assert.equal((await call('POST', '/payments/bezebee', kz, { plan: '1m', friend: true, as: 'CIS', consent })).status, 403)
  } finally {
    await close()
  }
})

test('BZB confirmation (owner; the same path BZB\'s API will use): months added, the referral price spends the friend discount and the cabinet shows the full price again', async () => {
  const { call, owner, player, close, payments, idOf } = await setup()
  try {
    const inviter = await player('confirm-inviter@example.com', 'RU')
    const code = (await call<{ code: string }>('GET', '/accounts/me/invites', inviter)).json.code
    const friend = await player('confirm-friend@example.com', 'KZ', code)
    type Offer = { bezebee: { friend: { price: number } | null } | null }
    assert.deepEqual((await call<Offer>('GET', '/payments', friend)).json.bezebee?.friend, { plan: '1m', price: 240 })
    const confirmed = await call<{ payment: { provider: string; amount: number; discountPercent?: number } }>('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'confirm-friend@example.com', plan: '1m', friend: true })
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.json))
    assert.equal(confirmed.json.payment.provider, 'bezebee')
    assert.equal(confirmed.json.payment.amount, 240)
    assert.equal(confirmed.json.payment.discountPercent, 20)
    assert.ok((payments.paidUntil(idOf('confirm-friend@example.com')) ?? 0) > clock + 29 * DAY)
    // The discount is spent: the referral price is gone, only the full prices remain.
    assert.equal((await call<Offer>('GET', '/payments', friend)).json.bezebee?.friend, null)
    assert.equal((await call('POST', '/payments/bezebee', friend, { plan: '1m', friend: true, consent: { version: '2026-10-20.2' } })).status, 403)
    assert.equal((await call<{ code: string }>('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'confirm-friend@example.com', plan: '1m', friend: true })).json.code, 'friend_without_referral')
    // A WORLD account: the roubles received are required (the page is in dollars); Russia never.
    await player('confirm-de@example.com', 'DE')
    assert.equal((await call<{ code: string }>('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'confirm-de@example.com', plan: '3m' })).json.code, 'amount_required')
    assert.equal((await call('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'confirm-de@example.com', plan: '3m', amount: 1700 })).status, 201)
    assert.equal((await call<{ code: string }>('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'confirm-inviter@example.com', plan: '1m' })).json.code, 'region_mismatch')
    assert.equal((await call('POST', '/accounts/me/admin/bezebee/payments', friend, { email: 'confirm-friend@example.com', plan: '1m' })).status, 404, 'owner only')
  } finally {
    await close()
  }
})
