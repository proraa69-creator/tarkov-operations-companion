import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { AdminStore } from './adminStore.js'
import { openDatabase } from './database.js'
import { InviteProgram } from './invites.js'
import { PaymentStore } from './paymentStore.js'

/** «Пользователи» → «Пришёл от»: who invited a friend-invited account (owner, 14.10.2026). */
const password = 'correct horse battery'

function fakeYooKassa() {
  const remote = new Map<string, Record<string, unknown>>()
  let next = 1
  const fetch = (async (url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const id = `2d${String(next++).padStart(10, '0')}-000f-5000-9000-1b68e7b15f3f`
      remote.set(id, { id, status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: `https://yoomoney.ru/checkout?orderId=${id}` } })
      return new Response(JSON.stringify(remote.get(id)), { status: 200 })
    }
    return new Response(JSON.stringify(remote.get(url.split('/').pop()!)), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  const pay = (id: string) => Object.assign(remote.get(id)!, { status: 'succeeded', paid: true, payment_method: { type: 'bank_card', saved: false, card: { first6: '220220', last4: String(1000 + next), expiry_year: '2030', expiry_month: '01' } } })
  return { fetch, pay }
}

async function setup() {
  const clock = Date.parse('2026-10-14T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [] })
  const yoo = fakeYooKassa()
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_x', monthPrice: 300, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.example.com' }, { now, fetch: yoo.fetch })
  accounts.attachSubscriptions(payments)
  const invites = new InviteProgram(accounts, payments, { now })
  const admin = new AdminStore(accounts, payments, { now })
  const register = async (email: string, code?: string) => accounts.authenticate((await accounts.register(email, password, code)).token)!
  const pay = async (accountId: string, plan: '1m' | '3m' = '1m') => {
    const discount = invites.discountPercent(accountId)
    const created = await payments.create(accounts.billingInfo(accountId), plan, 'https://raidos.example.com', { version: '2026-10-06' }, undefined, discount ? { percent: discount } : undefined)
    const providerId = new URL(created.confirmationUrl).searchParams.get('orderId')!
    yoo.pay(providerId)
    await payments.sync(providerId)
    return created.paymentId
  }
  const user = (email: string, q = '') => admin.users(q, 'all', 100, 0).users.find((item) => item.email === email)
  return { db, accounts, payments, invites, admin, register, pay, user }
}

test('the users list names the inviter of a friend, with the nickname and whether the discount was used', async () => {
  const t = await setup()
  const inviter = await t.register('inviter@example.com')
  t.accounts.setNicknames(inviter, { nickname: 'Inviter_Nick' })
  const code = t.invites.code(inviter)
  const friend = await t.register('friend@example.com', code)
  const later = await t.register('later@example.com', code)
  const longPlan = await t.register('longplan@example.com', code)

  assert.deepEqual(t.user('friend@example.com')!.invitedBy, { id: inviter, email: 'inviter@example.com', nickname: 'Inviter_Nick', discount: 'unused' })
  assert.equal(t.user('inviter@example.com')!.invitedBy, undefined)
  assert.equal(t.user('friend@example.com')!.referredBy, undefined)

  const paid = await t.pay(friend, '1m')
  assert.equal(t.user('friend@example.com')!.invitedBy!.discount, 'used')
  assert.equal(t.user('later@example.com')!.invitedBy!.discount, 'unused')
  // The first payment was a longer plan (no discount there): the discount is no longer offered.
  await t.pay(longPlan, '3m')
  assert.equal(t.user('longplan@example.com')!.invitedBy!.discount, 'lost')
  void later

  // The discounted payment shows its inviter in «Платежи» and in the user card.
  const listed = t.admin.paymentList({}, 50, 0).payments.find((payment) => payment.id === paid)!
  assert.deepEqual(listed.friendDiscount, { percent: 20, inviter: 'inviter@example.com' })
  assert.equal(t.admin.paymentList({}, 50, 0).payments.filter((payment) => payment.friendDiscount).length, 1)
  assert.deepEqual(t.admin.user(friend).payments[0]!.friendDiscount, { percent: 20, inviter: 'inviter@example.com' })

  // The calendar day: the inviter's e-mail instead of a bare flag.
  const day = t.admin.day('2026-10-14')
  const registration = day.registrations.find((item) => item.email === 'friend@example.com')!
  assert.equal(registration.invitedByFriend, true)
  assert.deepEqual(registration.invitedBy, { id: inviter, email: 'inviter@example.com' })
  assert.equal(day.registrations.find((item) => item.email === 'inviter@example.com')!.invitedBy, undefined)
  assert.deepEqual(day.payments.find((payment) => payment.id === paid)!.friendDiscount, { percent: 20, inviter: 'inviter@example.com' })

  // Searching the inviter's e-mail also lists the friends who came with that code.
  const found = t.admin.users('inviter@', 'all', 100, 0)
  assert.deepEqual(found.users.map((item) => item.email).sort(), ['friend@example.com', 'inviter@example.com', 'later@example.com', 'longplan@example.com'])
  assert.equal(found.total, 4)
  assert.equal(found.regions.all, 4)
})

test('a deleted inviter shows as deleted, without the e-mail of the stub', async () => {
  const t = await setup()
  const inviter = await t.register('gone@example.com')
  const friend = await t.register('friend@example.com', t.invites.code(inviter))
  const paid = await t.pay(friend, '1m')
  t.accounts.deleteAccount(inviter)
  assert.deepEqual(t.user('friend@example.com')!.invitedBy, { id: inviter, deleted: true, discount: 'used' })
  assert.deepEqual(t.admin.paymentList({}, 50, 0).payments.find((payment) => payment.id === paid)!.friendDiscount, { percent: 20, inviterDeleted: true })
  assert.deepEqual(t.admin.day('2026-10-14').registrations.find((item) => item.email === 'friend@example.com')!.invitedBy, { id: inviter, deleted: true })
  // The stub's e-mail is never matched by a search.
  assert.equal(t.admin.users('deleted.invalid', 'all', 100, 0).total, 0)
  assert.equal(JSON.stringify(t.admin.users('', 'all', 100, 0)).includes('deleted.invalid'), false)
})

test("a streamer's code stays in referredBy, with no inviter", async () => {
  const t = await setup()
  const streamer = await t.register('streamer@example.com')
  t.db.prepare("UPDATE accounts SET kind = 'streamer', referral_code = 'STREAMER1' WHERE id = ?").run(streamer)
  await t.register('viewer@example.com', 'STREAMER1')
  const viewer = t.user('viewer@example.com')!
  assert.equal(viewer.referredBy, 'STREAMER1')
  assert.equal(viewer.invitedBy, undefined)
  const registration = t.admin.day('2026-10-14').registrations.find((item) => item.email === 'viewer@example.com')!
  assert.equal(registration.referredBy, 'STREAMER1')
  assert.equal('invitedBy' in registration, false)
  assert.equal('invitedByFriend' in registration, false)
})
