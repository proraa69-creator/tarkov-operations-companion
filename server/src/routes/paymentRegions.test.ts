import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { BEZEBEE_CARD_TARIFFS, BEZEBEE_TARIFFS } from '../services/bezebee.js'
import { openDatabase } from '../services/database.js'
import { audienceMatches, NoticeStore } from '../services/noticeStore.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { CIS_COUNTRIES } from '../../../src/shared/countries.js'
import { CIS_PAYMENT_COUNTRIES, paymentRegionOf } from '../../../src/shared/paymentRegions.js'
import type { NoticeRegion } from '../../../src/shared/notices.js'

/** Payment regions: ЮKassa for Russia, BZB for the CIS and the world (docs/payments/payment-regions-and-announcements.md). */
const password = 'correct horse battery'
const DAY = 86_400_000
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

type Choice = { region: string | null; provider: string | null }

test('region from the saved country: RU, CIS without Russia, WORLD for everything else; none without a country', () => {
  assert.equal(paymentRegionOf('RU'), 'RU')
  assert.equal(paymentRegionOf(' ru '), 'RU')
  for (const code of ['BY', 'KZ', 'KG', 'TJ', 'UZ', 'TM', 'AM', 'AZ', 'MD']) assert.equal(paymentRegionOf(code), 'CIS', code)
  // Asia and the low-income countries pay the CIS price too (owner, 01.11.2026).
  for (const code of ['GE', 'TR', 'CN', 'IN', 'JP', 'NG']) assert.equal(paymentRegionOf(code), 'CIS', code)
  // Europe (Ukraine included), the USA and a country typed by hand: WORLD.
  for (const code of ['UA', 'DE', 'PL', 'US', 'BR', 'XX']) assert.equal(paymentRegionOf(code), 'WORLD', code)
  for (const value of [undefined, null, '', 'R', 'RUS']) assert.equal(paymentRegionOf(value), undefined)
  for (const code of CIS_COUNTRIES.filter((code) => code !== 'RU')) assert.ok(CIS_PAYMENT_COUNTRIES.includes(code), code)
  assert.ok(!CIS_PAYMENT_COUNTRIES.includes('RU'))
})

test('GET /v1/payments follows the saved country: ЮKassa for Russia, BZB for the CIS and the world; Boosty is gone (03.11.2026)', async () => {
  const t = await setup()
  try {
    const ru = await t.player('ru@example.com', 'RU')
    const kz = await t.player('kz@example.com', 'KZ')
    const de = await t.player('de@example.com', 'DE')
    const none = await t.player('none@example.com', null)
    const choice = async (token: string) => {
      const json = (await t.call<Choice>('GET', '/payments', token)).json
      return [json.region, json.provider, 'boosty' in json]
    }
    assert.deepEqual(await choice(ru), ['RU', 'yookassa', false])
    assert.deepEqual(await choice(kz), ['CIS', 'bezebee', false])
    assert.deepEqual(await choice(de), ['WORLD', 'bezebee', false])
    assert.deepEqual(await choice(none), [null, null, false])
    // No Boosty route is left: neither the players' links nor the owner's tools.
    assert.equal((await t.call('POST', '/payments/boosty', kz, { offer: 'standard', acknowledged: true })).status, 404)
    assert.equal((await t.call('GET', '/payments/boosty/public')).status, 404)
    for (const path of ['/accounts/me/admin/boosty', '/accounts/me/admin/boosty/payments', `/accounts/me/admin/users/${t.idOf('kz@example.com')}/boosty`]) {
      assert.equal((await t.call('GET', path, t.owner)).status, 404, path)
    }
    assert.equal((await t.call('POST', '/accounts/me/admin/boosty/payments', t.owner, { email: 'kz@example.com', offer: 'standard', months: 1 })).status, 404)
    assert.equal(t.payments.paidUntil(t.idOf('kz@example.com')), undefined)
  } finally {
    await t.close()
  }
})

test('ЮKassa is Russia only: no country blocks paying, CIS / WORLD are sent to BZB', async () => {
  const t = await setup()
  try {
    const body = { plan: '1m', consent: { version: '2026-09-30' }, region: 'RU', country: 'RU' }
    const none = await t.player('none@example.com', null)
    const blocked = await t.call<{ code: string }>('POST', '/payments', none, body)
    assert.deepEqual([blocked.status, blocked.json.code], [409, 'COUNTRY_REQUIRED'])
    const kz = await t.player('kz@example.com', 'KZ')
    const cis = await t.call<{ code: string }>('POST', '/payments', kz, body)
    assert.deepEqual([cis.status, cis.json.code], [409, 'YOOKASSA_REGION'])
    const ru = await t.player('ru@example.com', 'RU')
    const ok = await t.call<{ confirmationUrl: string }>('POST', '/payments', ru, body)
    assert.equal(ok.status, 201)
    assert.match(ok.json.confirmationUrl, /^https:\/\/yoomoney\.ru\//)
  } finally {
    await t.close()
  }
})

test('announcement audiences: the regions «Россия», «СНГ» (without Russia), «Мир» (16.10.2026); a Boosty audience is refused (03.11.2026)', async () => {
  const facts = (country: string | null) => ({ id: 'a', kind: 'user', country, countrySetAt: null, createdAt: 0, paidUntil: 0 })
  const countries = ['RU', 'KZ', 'BY', 'DE', 'US', 'XX', null]
  const matches = (regions: NoticeRegion[]) => countries.map((country) => audienceMatches({ regions, payment: 'all' }, 1, facts(country), 1))
  assert.deepEqual(matches(['ru']), [true, false, false, false, false, false, false])
  assert.deepEqual(matches(['cis']), [false, true, true, false, false, false, false])
  assert.deepEqual(matches(['world']), [false, false, false, true, true, true, false])
  assert.deepEqual(matches(['cis', 'world']), [false, true, true, true, true, true, false])
  assert.deepEqual(matches([]), [true, true, true, true, true, true, true])

  const t = await setup()
  try {
    const tokens: Record<string, string> = {}
    for (const [email, country] of [['ru@example.com', 'RU'], ['kz@example.com', 'KZ'], ['am@example.com', 'AM'], ['de@example.com', 'DE'], ['us@example.com', 'US'], ['none@example.com', null]] as const) tokens[email] = await t.player(email, country)
    clock += 1000
    const send = (audience: Record<string, unknown>) => t.call<{ notice: { id: number; targeted: number } }>('POST', '/accounts/me/admin/notices', t.owner, { title: 'Новости', text: 'Текст объявления', audience })
    // «Россия» (the RU player and the RU owner), «СНГ» without Russia (KZ, AM), «Мир» (DE, US), and everybody.
    const ru = await send({ regions: ['ru'], payment: 'all' })
    const cis = await send({ regions: ['cis'], payment: 'all' })
    const world = await send({ regions: ['world'], payment: 'all' })
    assert.deepEqual([ru.json.notice.targeted, cis.json.notice.targeted, world.json.notice.targeted], [2, 2, 2])
    assert.equal((await send({ regions: [], payment: 'all' })).json.notice.targeted, 7)
    // An older form's Boosty audience is refused, never sent to everybody.
    for (const payRegion of ['CIS', 'WORLD', 'ALL_PAID_REGIONS']) assert.equal((await send({ regions: [], payment: 'all', payRegion })).status, 400, payRegion)
    const inbox = async (email: string) => {
      const response = await t.call<{ notices: Array<{ id: number }> }>('GET', '/me/notices', tokens[email])
      assert.equal(response.status, 200, JSON.stringify(response.json))
      return response.json.notices.map((item) => item.id)
    }
    const ids = [ru.json.notice.id, cis.json.notice.id, world.json.notice.id]
    const regional = (list: number[]) => list.filter((id) => ids.includes(id))
    assert.deepEqual(regional(await inbox('ru@example.com')), [ru.json.notice.id])
    assert.deepEqual(regional(await inbox('kz@example.com')), [cis.json.notice.id])
    assert.deepEqual(regional(await inbox('us@example.com')), [world.json.notice.id])
    assert.deepEqual(regional(await inbox('none@example.com')), [])
  } finally {
    await t.close()
  }
})

test('notices sent to a Boosty audience before 16.10.2026: the same regions from now on, the live ones withdrawn, the column dropped; once (03.11.2026)', () => {
  const db = openDatabase(':memory:')
  new NoticeStore(db, () => 1)
  // The column as an older server added it, with its three audiences and a notice of the regions.
  db.exec('ALTER TABLE owner_notices ADD COLUMN pay_region TEXT')
  const insert = db.prepare("INSERT INTO owner_notices (kind, title, body, regions, payment, pay_region, created_by, created_at, withdrawn_at) VALUES ('announcement', 'Boosty', 'Оплата через Boosty', ?, 'all', ?, 'owner', 1, ?)")
  insert.run('[]', 'CIS', null)
  insert.run('[]', 'WORLD', null)
  insert.run('[]', 'ALL_PAID_REGIONS', 5)
  insert.run('["ru"]', null, null)
  const rows = () => db.prepare('SELECT id, regions, withdrawn_at FROM owner_notices ORDER BY id').all().map((row) => [row.id, row.regions, row.withdrawn_at])
  new NoticeStore(db, () => 100)
  const columns = (db.prepare('PRAGMA table_info(owner_notices)').all() as Array<{ name: string }>).map((row) => row.name)
  assert.ok(!columns.includes('pay_region'))
  assert.deepEqual(rows(), [[1, '["cis"]', 100], [2, '["world"]', 100], [3, '["cis","world"]', 5], [4, '["ru"]', null]])
  new NoticeStore(db, () => 200)
  assert.deepEqual(rows(), [[1, '["cis"]', 100], [2, '["world"]', 100], [3, '["cis","world"]', 5], [4, '["ru"]', null]])
})

test('BZB tariffs (owner, 20.10.2026): CIS in roubles, the rest of the world in dollars, never Russia; each plan its own page with the offer consent', async () => {
  const { call, player, close, accounts, idOf } = await setup()
  try {
    const cis = await player('bzb-kz@example.com', 'KZ')
    const ru = await player('bzb-ru@example.com', 'RU')
    const world = await player('bzb-de@example.com', 'DE')
    const none = await player('bzb-none@example.com', null)
    // A CIS account also gets the CIS price in dollars by a foreign card (owner, 02.11.2026); a plan BZB has not approved yet
    // is not listed (services/bezebee.ts BEZEBEE_CARD_TARIFFS).
    const CARD = { currency: 'USD', plans: BEZEBEE_CARD_TARIFFS.plans.filter((entry) => entry.url).map(({ plan, months, price }) => ({ plan, months, price })), friend: null }
    assert.ok(CARD.plans.length >= 3)
    type WithBzb = { bezebee: { currency: string; plans: Array<{ plan: string; months: number; price: number; url?: string }>; friend: unknown } | null }
    assert.deepEqual((await call<WithBzb>('GET', '/payments', cis)).json.bezebee, { currency: 'RUB', plans: [{ plan: '1m', months: 1, price: 300 }, { plan: '3m', months: 3, price: 800 }, { plan: '6m', months: 6, price: 1500 }, { plan: '12m', months: 12, price: 2400 }], friend: null, card: CARD })
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
    // A foreign card: the dollar page of the CIS price; outside the CIS the flag changes nothing.
    const cardPage = await call<{ url: string }>('POST', '/payments/bezebee', cis, { plan: '1m', card: true, consent })
    assert.equal(cardPage.json.url.split('?')[0], BEZEBEE_CARD_TARIFFS.plans[0].url)
    assert.ok(!cisPages.includes(cardPage.json.url))
    assert.equal((await call<{ url: string }>('POST', '/payments/bezebee', world, { plan: '1m', card: true, consent })).json.url, worldPages[0])
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

test('BZB for one account from Russia (owner, 02.11.2026: «добавь именно ему в личный кабинет оплату через bzb в снг»): ЮKassa stays, the CIS pages join, BZB\'s confirmation opens the subscription', async () => {
  const { call, player, owner, close, idOf, payments } = await setup()
  try {
    const ru = await player('bzb-ru-open@example.com', 'RU')
    await player('bzb-kz-open@example.com', 'KZ')
    const id = idOf('bzb-ru-open@example.com')
    const consent = { version: '2026-10-20.2' }
    type Overview = { region: string | null; provider: string | null; bezebee: { currency: string; plans: Array<{ plan: string; price: number }>; card?: unknown } | null }
    const toggle = (token: string, account: string, allowed: boolean) => call<{ user: { bezebeeAllowed?: boolean; payRegion: string }; error?: string }>('POST', `/accounts/me/admin/users/${account}/bezebee`, token, { allowed })
    assert.equal((await call<Overview>('GET', '/payments', ru)).json.bezebee, null)
    assert.equal((await call<{ code: string }>('POST', '/payments/bezebee', ru, { plan: '1m', consent })).json.code, 'BEZEBEE_REGION')

    // The owner only, and for Russia only: the other countries have BZB by their country anyway.
    assert.equal((await toggle(ru, id, true)).status, 404)
    assert.equal((await toggle(owner, idOf('bzb-kz-open@example.com'), true)).status, 409)
    const opened = await toggle(owner, id, true)
    assert.deepEqual([opened.status, opened.json.user.bezebeeAllowed, opened.json.user.payRegion], [200, true, 'RU'])

    const overview = (await call<Overview>('GET', '/payments', ru)).json
    assert.deepEqual([overview.region, overview.provider], ['RU', 'yookassa'], 'ЮKassa stays')
    assert.equal(overview.bezebee?.currency, 'RUB')
    assert.deepEqual(overview.bezebee?.plans.map((entry) => [entry.plan, entry.price]), [['1m', 300], ['3m', 800], ['6m', 1500], ['12m', 2400]])
    const page = await call<{ url: string }>('POST', '/payments/bezebee', ru, { plan: '3m', consent })
    assert.equal(page.status, 200)
    assert.equal(page.json.url.split('?')[0], BEZEBEE_TARIFFS.CIS.plans[1].url)

    // BZB's confirmation (the owner's here; the webhook and the sale letters take the same path) at the CIS price.
    const confirmed = await call<{ payment: { provider: string; amount: number } }>('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'bzb-ru-open@example.com', plan: '1m' })
    assert.deepEqual([confirmed.status, confirmed.json.payment.provider, confirmed.json.payment.amount], [201, 'bezebee', 300])
    assert.ok((payments.paidUntil(id) ?? 0) > clock)

    // Closed again: Russia pays through ЮKassa only.
    assert.equal((await toggle(owner, id, false)).json.user.bezebeeAllowed, undefined)
    assert.equal((await call<Overview>('GET', '/payments', ru)).json.bezebee, null)
    assert.equal((await call<{ code: string }>('POST', '/accounts/me/admin/bezebee/payments', owner, { email: 'bzb-ru-open@example.com', plan: '1m' })).json.code, 'region_mismatch')
    const audit = await call<{ entries: Array<{ action: string; target?: string; details?: { allowed?: boolean } }> }>('GET', '/accounts/me/admin/audit?limit=10&offset=0', owner)
    assert.deepEqual(audit.json.entries.filter((entry) => entry.action === 'payment.bezebee-ru').map((entry) => entry.details?.allowed), [false, true])
  } finally {
    await close()
  }
})
