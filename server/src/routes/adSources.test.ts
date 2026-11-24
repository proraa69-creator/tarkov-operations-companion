import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, createAccountsHandlers } from '../services/accountStore.js'
import { createEmailHandlers, EmailAuthService } from '../services/emailAuth.js'
import { FakeEmailSender } from '../services/email/index.js'
import { AdminStore } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore, planPrice } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { adLink, normalizeAdCampaign, normalizeAdMark } from '../../../src/shared/adSources'

const password = 'correct horse battery'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A fake ЮKassa (as in ownerAdmin.test.ts): `pay()` makes a created payment succeed. */
function fakeYooKassa() {
  const remote = new Map<string, Record<string, unknown>>()
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    if (init.method === 'POST') {
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      const payment = { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } }
      remote.set(id, payment)
      return new Response(JSON.stringify(payment), { status: 200 })
    }
    const payment = remote.get(url.split('/').pop()!)
    return payment ? new Response(JSON.stringify(payment), { status: 200 }) : new Response('{}', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, pay: (id: string) => Object.assign(remote.get(id)!, { status: 'succeeded', paid: true }) }
}

async function setup() {
  // 10:00 UTC = 17:00 in Bangkok: the owner's day is the UTC date.
  let clock = Date.parse('2026-11-09T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, now, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, now, ownerEmails: ['owner@example.com'] })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_secret', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  const pay = async (token: string, plan: '1m' | '3m') => {
    const created = await call<{ paymentId: string; confirmationUrl: string }>('POST', '/payments', token, { plan, consent: { version: '2026-09-01' } })
    assert.equal(created.status, 201, JSON.stringify(created.json))
    yoo.pay(new URL(created.json.confirmationUrl).searchParams.get('orderId')!)
    await call('GET', `/payments/${created.json.paymentId}`, token)
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { db, accounts, admin: new AdminStore(accounts, payments, { now }), call, login, pay, close, advance: (ms: number) => { clock += ms } }
}

const adSourceOf = (db: ReturnType<typeof openDatabase>, email: string) => ({ ...(db.prepare('SELECT ad_source, ad_campaign FROM accounts WHERE email = ?').get(email) as { ad_source: string | null; ad_campaign: string | null }) })

test('ad labels: only known platforms, campaigns cleaned, the link for the ad', () => {
  assert.deepEqual(normalizeAdMark('Reddit', 'Spring Sale!'), { source: 'reddit', campaign: 'spring-sale' })
  assert.deepEqual(normalizeAdMark('reddit'), { source: 'reddit' })
  assert.deepEqual(normalizeAdMark('reddit', '!!!'), { source: 'reddit' })
  assert.equal(normalizeAdMark('google', 'x'), undefined)
  assert.equal(normalizeAdMark(undefined), undefined)
  assert.equal(normalizeAdCampaign('a'.repeat(40)), 'a'.repeat(32))
  assert.equal(adLink('reddit', 'tarkov'), 'https://raidos.app/?utm_source=reddit&utm_campaign=tarkov')
  assert.equal(adLink('reddit'), 'https://raidos.app/?utm_source=reddit')
})

test('ad visits: counted once a day per visitor, the network marks an account made in the app within 7 days', async () => {
  const t = await setup()
  try {
    // The site's visit: a known platform answers 200, an unknown one 404 (and nothing is counted).
    assert.equal((await t.call('POST', '/accounts/ad-visits', undefined, { source: 'reddit', campaign: 'tarkov' })).status, 200)
    assert.equal((await t.call('POST', '/accounts/ad-visits', undefined, { source: 'google' })).status, 404)
    assert.equal((await t.call('POST', '/accounts/ad-visits', undefined, {})).status, 404)

    // Two visitors on public addresses; the first comes back the same day (one visit) and the next day (another one).
    assert.equal(t.accounts.recordAdVisit('reddit', 'tarkov', '203.0.113.5'), true)
    assert.equal(t.accounts.recordAdVisit('reddit', 'tarkov', '203.0.113.5'), true)
    assert.equal(t.accounts.recordAdVisit('reddit', undefined, '198.51.100.7'), true)
    assert.equal(t.accounts.recordAdVisit('facebook', 'x', '198.51.100.8'), false)

    // Registered in the PC app (no label) from the network that opened the link: marked with its campaign.
    await t.accounts.register('app@example.com', password, undefined, '203.0.113.5', 'US')
    assert.deepEqual(adSourceOf(t.db, 'app@example.com'), { ad_source: 'reddit', ad_campaign: 'tarkov' })
    // From another network: nothing.
    await t.accounts.register('other@example.com', password, undefined, '192.0.2.44', 'US')
    assert.deepEqual(adSourceOf(t.db, 'other@example.com'), { ad_source: null, ad_campaign: null })
    // A friend's or streamer's code does not hide the ad: both are kept.
    await t.accounts.register('nocampaign@example.com', password, 'NO-SUCH-CODE', '198.51.100.7', 'DE')
    assert.deepEqual(adSourceOf(t.db, 'nocampaign@example.com'), { ad_source: 'reddit', ad_campaign: null })

    t.advance(DAY)
    t.accounts.recordAdVisit('reddit', 'tarkov', '203.0.113.5')
    // After 7 days the network no longer counts.
    t.advance(7 * DAY + HOUR)
    await t.accounts.register('late@example.com', password, undefined, '198.51.100.7', 'US')
    assert.deepEqual(adSourceOf(t.db, 'late@example.com'), { ad_source: null, ad_campaign: null })

    const stats = t.admin.adSources('day')
    const reddit = stats.sources.find((item) => item.source === 'reddit')!
    // 1 (HTTP, loopback) + 2 on 09.11, 1 on 10.11.
    assert.equal(reddit.totals.visits, 4)
    assert.equal(reddit.totals.registrations, 2)
    assert.equal(reddit.rows.find((row) => row.period === '2026-11-09')!.visits, 3)
    assert.equal(reddit.rows.find((row) => row.period === '2026-11-10')!.visits, 1)
    assert.equal(reddit.rows.find((row) => row.period === '2026-11-09')!.registrations, 2)
    assert.deepEqual(reddit.campaigns.map((row) => [row.campaign, row.visits, row.registrations]), [['tarkov', 3, 1], ['', 1, 1]])
  } finally {
    await t.close()
  }
})

test('ad registrations: the site sends its label, payments count; admin only for the owner', async () => {
  const t = await setup()
  try {
    // Registered on the site with the label from the ad's link (the request comes from loopback: no network match).
    const site = await t.call<{ token: string }>('POST', '/accounts/register', undefined, { email: 'site@example.com', password, country: 'RU', adSource: 'reddit', adCampaign: 'Launch' })
    assert.equal(site.status, 201)
    assert.deepEqual(adSourceOf(t.db, 'site@example.com'), { ad_source: 'reddit', ad_campaign: 'launch' })
    // An unknown or broken label is ignored and never blocks the registration.
    assert.equal((await t.call('POST', '/accounts/register', undefined, { email: 'junk@example.com', password, country: 'US', adSource: 'google', adCampaign: 42 })).status, 201)
    assert.deepEqual(adSourceOf(t.db, 'junk@example.com'), { ad_source: null, ad_campaign: null })
    // Without the label and from loopback: nothing.
    assert.equal((await t.call('POST', '/accounts/register', undefined, { email: 'plain@example.com', password, country: 'RU' })).status, 201)

    await t.pay(site.json.token, '1m')
    await t.pay(site.json.token, '3m')
    await t.pay(await t.login('plain@example.com'), '1m')

    const owner = await t.login('owner@example.com')
    const player = await t.login('plain@example.com')
    assert.equal((await t.call('GET', '/accounts/me/admin/ads?period=day')).status, 401)
    assert.equal((await t.call('GET', '/accounts/me/admin/ads?period=day', player)).status, 404)
    const answer = await t.call<{ period: string; sources: Array<{ source: string; label: string; totals: Record<string, number>; rows: Array<Record<string, number | string>>; campaigns: Array<Record<string, number | string>> }> }>('GET', '/accounts/me/admin/ads?period=month', owner)
    assert.equal(answer.status, 200)
    assert.equal(answer.json.period, 'month')
    const reddit = answer.json.sources[0]!
    assert.equal(reddit.label, 'Reddit')
    assert.deepEqual(reddit.totals, { visits: 0, registrations: 1, payments: 2, revenue: (planPrice(300, '1m') + planPrice(300, '3m')) / 100, payers: 1 })
    assert.equal(reddit.rows.length, 12)
    assert.deepEqual(reddit.rows[0], { period: '2026-11', visits: 0, registrations: 1, payments: 2, revenue: reddit.totals.revenue })
    assert.deepEqual(reddit.campaigns, [{ campaign: 'launch', visits: 0, registrations: 1, payments: 2, revenue: reddit.totals.revenue }])
    assert.equal((await t.call<{ sources: unknown[] }>('GET', '/accounts/me/admin/ads?period=year', owner)).json.sources.length, 1)
  } finally {
    await t.close()
  }
})

test('ad registrations with the e-mail code: the label waits in the pending registration', async () => {
  const now = () => Date.parse('2026-11-09T10:00:00.000Z')
  const accounts = new AccountStore({ now, ownerEmails: [] })
  const sender = new FakeEmailSender()
  const emails = new EmailAuthService(accounts, { sender, now, log: () => undefined, limits: { dailyLimit: 500, addressDailyLimit: 10, ipDailyLimit: 1000 } })
  const api = createAccountsHandlers(accounts, { now, registrations: emails, authRateLimit: { max: 1000, windowMs: 15 * 60 * 1000 } })
  const email = createEmailHandlers(accounts, emails, { now, limits: { start: 1000, verify: 1000, account: 1000 } })
  const started = await api.register({ ip: '127.0.0.1', body: { email: 'coded@example.com', password, country: 'RU', adSource: 'reddit', adCampaign: 'tarkov' } })
  assert.equal(started.status, 202, JSON.stringify(started.body))
  await emails.settled()
  const confirmed = await email.registerConfirm({ ip: '127.0.0.1', body: { challengeId: (started.body as { challengeId: string }).challengeId, code: sender.lastCode('coded@example.com') } })
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body))
  assert.deepEqual(adSourceOf(accounts.database, 'coded@example.com'), { ad_source: 'reddit', ad_campaign: 'tarkov' })
})
