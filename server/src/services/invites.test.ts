import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { HOLD_MS, InviteProgram, LIFETIME_UNTIL } from './invites.js'
import { PaymentStore } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'

const password = 'correct horse battery'
const DAY = 86_400_000

/** A fake ЮKassa: payments succeed when `pay(id, card)` is called; `card` is what ЮKassa reports about the card. */
function fakeYooKassa() {
  const remote = new Map<string, Record<string, unknown>>()
  const bodies: Array<Record<string, unknown>> = []
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      remote.set(id, { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } })
      return new Response(JSON.stringify(remote.get(id)), { status: 200 })
    }
    return new Response(JSON.stringify(remote.get(url.split('/').pop()!)), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  const pay = (id: string, card = { first6: '220220', last4: String(1000 + next) }) => Object.assign(remote.get(id)!, { status: 'succeeded', paid: true, payment_method: { type: 'bank_card', saved: false, card: { ...card, expiry_year: '2030', expiry_month: '01' } } })
  return { fetch, pay, bodies }
}

async function setup() {
  let clock = Date.parse('2026-10-06T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_x', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  const invites = new InviteProgram(accounts, payments, { now })
  const register = async (email: string, code?: string, ip?: string) => accounts.authenticate((await accounts.register(email, password, code, ip)).token)!
  /** The account pays for `plan` with a card ending in `last4` (a new card each time by default). */
  const pay = async (accountId: string, plan: '1m' | '3m' | '6m' | '12m' = '1m', last4?: string) => {
    const created = await payments.create(accounts.billingInfo(accountId), plan, 'https://raidos.example.com', { version: '2026-10-06' }, undefined, invites.discountPercent(accountId) ? { percent: invites.discountPercent(accountId) } : undefined)
    const providerId = new URL(created.confirmationUrl).searchParams.get('orderId')!
    yoo.pay(providerId, last4 ? { first6: '220220', last4 } : undefined)
    await payments.sync(providerId)
    return created.paymentId
  }
  const paidUntil = (id: string) => payments.paidUntil(id) ?? 0
  return { db, accounts, payments, invites, yoo, register, pay, paidUntil, now, advance: (ms: number) => { clock += ms } }
}

test('a friend registers with a player code and gets 20 % off the first month only', async () => {
  const t = await setup()
  const inviter = await t.register('inviter@example.com')
  const code = t.invites.code(inviter)
  assert.match(code, /^RAID-[A-Z2-9]{5}$/)
  assert.equal(t.invites.code(inviter), code, 'the code is stable')
  assert.equal(t.accounts.codeKind(code.toLowerCase()), 'friend')

  const friend = await t.register('friend@example.com', code)
  assert.equal(t.accounts.invitedBy(friend), inviter)
  assert.equal(t.accounts.view(friend).subscription.status, 'inactive', 'a friend code gives the discount, not the streamer trial')
  assert.equal(t.invites.discountPercent(friend), 20)
  await t.pay(friend, '1m')
  assert.deepEqual(t.yoo.bodies.at(-1)!.amount, { value: '240.00', currency: 'RUB' })
  assert.match(String(t.yoo.bodies.at(-1)!.description), /скидка 20 % по коду друга/)
  assert.equal(t.payments.list(friend)[0]!.discountPercent, 20)
  assert.equal(t.invites.discountPercent(friend), 0, 'only the first payment')
  await t.pay(friend, '1m')
  assert.deepEqual(t.yoo.bodies.at(-1)!.amount, { value: '300.00', currency: 'RUB' })

  // A longer plan never gets the discount.
  const other = await t.register('other@example.com', code)
  await t.pay(other, '12m')
  assert.deepEqual(t.yoo.bodies.at(-1)!.amount, { value: '2412.00', currency: 'RUB' })
})

test('the inviter gets 7 days only after the friend paid and 14 days passed; milestones at 3 friends', async () => {
  const t = await setup()
  const inviter = await t.register('inviter@example.com')
  const code = t.invites.code(inviter)
  const friends = [await t.register('a@example.com', code, '10.0.0.1'), await t.register('b@example.com', code, '10.0.0.2'), await t.register('c@example.com', code, '10.0.0.3')]
  assert.equal(t.invites.program(inviter).invited, 3)
  assert.equal(t.invites.program(inviter).rewards.length, 0, 'a registration alone earns nothing')

  for (const friend of friends) await t.pay(friend)
  let program = t.invites.program(inviter)
  assert.deepEqual([program.paid, program.confirmed, program.rank], [3, 0, null])
  assert.ok(program.rewards.every((reward) => reward.status === 'pending' && reward.days === 7 && reward.releaseAt))
  assert.match(program.rewards[0]!.friend!, /^[abc]\*\*\*@example\.com$/)

  t.advance(HOLD_MS - DAY)
  assert.deepEqual(t.invites.release(), { granted: 0 })
  assert.equal(t.paidUntil(inviter), 0)

  t.advance(DAY)
  assert.deepEqual(t.invites.release(), { granted: 3 })
  program = t.invites.program(inviter)
  assert.equal(program.confirmed, 3)
  assert.deepEqual(program.rank, { id: 'operator', title: 'Operator' })
  assert.equal(program.next?.id, 'squad-leader')
  assert.ok(program.rewards.some((reward) => reward.kind === 'operator' && reward.days === 30 && reward.status === 'granted'))
  // 3 × 7 days + a month for the rank Operator.
  assert.equal(t.paidUntil(inviter), t.now() + (21 + 30) * DAY)
  assert.deepEqual(t.invites.release(), { granted: 0 }, 'nothing twice')
  assert.equal(t.paidUntil(inviter), t.now() + 51 * DAY)
})

test('suspicious rewards wait for the owner: same card, same device, same address, a cancelled payment', async () => {
  const t = await setup()
  const inviter = await t.register('inviter@example.com', undefined, '10.0.0.1')
  await t.pay(inviter, '1m', '4242')
  const code = t.invites.code(inviter)
  const sameCard = await t.register('card@example.com', code, '10.0.0.2')
  await t.pay(sameCard, '1m', '4242')
  const sameAddress = await t.register('home@example.com', code, '10.0.0.1')
  await t.pay(sameAddress)
  const sameDevice = await t.register('device@example.com', code, '10.0.0.3')
  t.db.exec("CREATE TABLE IF NOT EXISTS account_devices (account_id TEXT, device_id TEXT, name TEXT, created_at INTEGER, last_seen_at INTEGER, session_digest TEXT, revoked_at INTEGER)")
  t.db.prepare("INSERT INTO account_devices (account_id, device_id, created_at) VALUES (?, 'pc-1', 0), (?, 'pc-1', 0)").run(inviter, sameDevice)
  await t.pay(sameDevice)
  const clean = await t.register('clean@example.com', code, '10.0.0.4')
  const cleanPayment = await t.pay(clean)

  const list = t.invites.adminList(undefined, 100, 0)
  const flags = Object.fromEntries(list.rewards.map((reward) => [reward.friend, [reward.status, reward.flags.join(',')]]))
  assert.deepEqual(flags['card@example.com'], ['review', 'same-card'])
  assert.deepEqual(flags['home@example.com'], ['review', 'same-address'])
  assert.deepEqual(flags['device@example.com'], ['review', 'same-device'])
  assert.deepEqual(flags['clean@example.com'], ['pending', ''])
  assert.deepEqual(list.counts, { review: 3, pending: 1 })

  // The clean friend's payment is cancelled during the hold: the reward goes to review instead of being granted.
  t.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").run(cleanPayment)
  t.advance(HOLD_MS)
  assert.deepEqual(t.invites.release(), { granted: 0 })
  assert.equal(t.paidUntil(inviter), t.now() - HOLD_MS + 30 * DAY, 'only the inviter\'s own month')

  // The owner decides.
  const review = t.invites.adminList('review', 100, 0).rewards
  const card = review.find((reward) => reward.friend === 'card@example.com')!
  const home = review.find((reward) => reward.friend === 'home@example.com')!
  assert.equal(t.invites.decide('owner@example.com', card.id, 'cancel', 'одна карта').status, 'canceled')
  assert.equal(t.invites.decide('owner@example.com', home.id, 'approve', 'брат, проверил').status, 'granted')
  assert.throws(() => t.invites.decide('owner@example.com', home.id, 'cancel'), /уже принято/)
  assert.equal(t.paidUntil(inviter), t.now() - HOLD_MS + 37 * DAY)
})

test('a friend code: not one\'s own, not after a payment, once; codes share one namespace with streamers', async () => {
  const t = await setup()
  const inviter = await t.register('inviter@example.com')
  const code = t.invites.code(inviter)
  assert.throws(() => t.accounts.applyReferral(inviter, code), /Свой код/)
  const late = await t.register('late@example.com')
  await t.pay(late)
  assert.throws(() => t.accounts.applyReferral(late, code), /до первой оплаты/)
  const fresh = await t.register('fresh@example.com')
  t.accounts.applyReferral(fresh, code.toLowerCase())
  assert.equal(t.accounts.invitedBy(fresh), inviter)
  assert.throws(() => t.accounts.applyReferral(fresh, code), /уже указан/)

  // Streamer codes keep the trial; a player cannot take a streamer's code or the other way round.
  await t.accounts.register('streamer@example.com', password)
  t.accounts.promoteToStreamer('streamer@example.com', 'HUNTER')
  assert.equal(t.accounts.codeKind('hunter'), 'streamer')
  const viewer = await t.register('viewer@example.com', 'HUNTER')
  assert.equal(t.accounts.view(viewer).subscription.status, 'trial')
  assert.equal(t.invites.discountPercent(viewer), 0)
  assert.throws(() => t.invites.setCode(fresh, 'hunter'), /занят/)
  assert.throws(() => t.accounts.promoteToStreamer('fresh@example.com', code), /taken/)

  // A code of one's own while nobody has used the current one.
  assert.equal(t.invites.setCode(fresh, 'shaurma10').code, 'SHAURMA10')
  assert.throws(() => t.invites.setCode(fresh, 'x'), /3–24/)
  assert.throws(() => t.invites.setCode(inviter, 'RAID-ARTEM'), /сменить его нельзя/)
  const streamerId = t.accounts.authenticate((await t.accounts.login('streamer@example.com', password)).token)!
  assert.throws(() => t.invites.code(streamerId), /стримеров/)
})

test('50 confirmed friends make Premium lifelong (rank Legend)', async () => {
  const t = await setup()
  const inviter = await t.register('inviter@example.com')
  const code = t.invites.code(inviter)
  for (let i = 0; i < 50; i++) await t.pay(await t.register(`f${i}@example.com`, code, `10.1.${i}.1`))
  // 50 rewards in one day are flagged as a burst after the first five: the owner approves them.
  for (const reward of t.invites.adminList('review', 500, 0).rewards) t.invites.decide('owner@example.com', reward.id, 'approve')
  t.advance(HOLD_MS)
  t.invites.release()
  // A year (25) and lifetime (50) wait for the owner's review; then they are granted.
  const milestones = t.invites.adminList('review', 500, 0).rewards.filter((reward) => reward.kind === 'raid-commander' || reward.kind === 'legend')
  assert.deepEqual(milestones.map((reward) => reward.kind).sort(), ['legend', 'raid-commander'])
  assert.notEqual(t.paidUntil(inviter), LIFETIME_UNTIL, 'not before the review')
  for (const reward of milestones) t.invites.decide('owner@example.com', reward.id, 'approve')
  const program = t.invites.program(inviter)
  assert.deepEqual([program.confirmed, program.rank?.id, program.next], [50, 'legend', null])
  assert.equal(t.paidUntil(inviter), LIFETIME_UNTIL)
  assert.ok(program.rewards.some((reward) => reward.kind === 'legend' && reward.days === 'lifetime'))
})

test('routes: the cabinet program, the friend discount in /v1/payments and the owner review', async () => {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }
  try {
    const { token } = await accounts.register('player@example.com', password)
    assert.equal((await call('GET', '/accounts/me/invites')).status, 401)
    const program = await call('GET', '/accounts/me/invites', token)
    assert.equal(program.status, 200)
    assert.equal(program.json.discountPercent, 20)
    const renamed = await call('PUT', '/accounts/me/invites/code', token, { code: 'raid-artem' })
    assert.equal(renamed.json.code, 'RAID-ARTEM')
    const visit = await call('POST', '/accounts/referral-visits', undefined, { code: 'raid-artem' })
    assert.deepEqual([visit.status, visit.json.kind], [200, 'friend'])

    const friend = await call('POST', '/accounts/register', undefined, { email: 'friend@example.com', password, referralCode: 'RAID-ARTEM' })
    assert.equal(friend.json.referralApplied, true)
    const own = await call('GET', '/payments', String(friend.json.token))
    assert.deepEqual(own.json.friendDiscount, { percent: 20, plan: '1m' })

    const owner = (await accounts.login('owner@example.com', password)).token
    assert.equal((await call('GET', '/accounts/me/admin/invite-rewards', token)).status, 404)
    const list = await call('GET', '/accounts/me/admin/invite-rewards?status=review', owner)
    assert.deepEqual([list.status, list.json.total], [200, 0])
    assert.equal((await call('POST', '/accounts/me/admin/invite-rewards/99/decide', owner, { decision: 'approve' })).status, 404)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('refunds take rewards back; the friend discount is for one payment; e-mail aliases are flagged', async () => {
  const t = await setup()
  const inviter = await t.register('me@gmail.com')
  const code = t.invites.code(inviter)
  const alias = await t.register('m.e+alt@gmail.com', code, '10.9.0.1')
  await t.pay(alias)
  assert.deepEqual(t.invites.adminList(undefined, 10, 0).rewards.map((reward) => [reward.status, reward.flags.join(',')]), [['review', 'same-email']])

  const friend = await t.register('friend@example.com', code, '10.9.0.2')
  // Two discounted invoices opened before paying: only the first one gets the discount.
  const first = await t.payments.create(t.accounts.billingInfo(friend), '1m', 'https://raidos.example.com', { version: '2026-10-06' }, undefined, { percent: 20 })
  assert.deepEqual(t.yoo.bodies.at(-1)!.amount, { value: '240.00', currency: 'RUB' })
  await t.payments.create(t.accounts.billingInfo(friend), '1m', 'https://raidos.example.com', { version: '2026-10-06' }, undefined, { percent: 20 })
  assert.deepEqual(t.yoo.bodies.at(-1)!.amount, { value: '300.00', currency: 'RUB' })
  const providerId = new URL(first.confirmationUrl).searchParams.get('orderId')!
  t.yoo.pay(providerId)
  await t.payments.sync(providerId)
  t.advance(HOLD_MS)
  t.invites.release()
  const before = t.paidUntil(inviter)
  assert.equal(before, t.now() + 7 * DAY)
  // The friend's payment is refunded: the reward is cancelled, its 7 days and the friend's month are taken back.
  assert.equal(t.payments.markRefunded(first.paymentId), true)
  assert.equal(t.payments.markRefunded(first.paymentId), false, 'once')
  assert.equal(t.paidUntil(inviter), t.now())
  assert.equal(t.payments.list(friend).find((item) => item.id === first.paymentId)?.status, 'refunded')
  assert.equal(t.invites.adminList('canceled', 10, 0).rewards[0]?.friend, 'friend@example.com')
})
