import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { createApi } from '../app.js'
import { AccountStore, eftDigest, newPasswordHash } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { ProgressStore } from '../services/progressStore.js'
import { DISPUTE_SETTLE_MS, maskEmail, type EftDispute } from '../services/eftLedger.js'
import { PaymentStore } from '../services/paymentStore.js'

/**
 * Owner, 15.11.2026: «удаляет аккаунт, 10 дней проходит, создаёт новый и использует 2 бонусных дня. И присылай мне
 * уведомление… сделай отдельную вкладку… аккаунты Таркова… какой первый аккаунт, какая почта, потом актуальный сейчас,
 * номер Таркова».
 */
async function withApi(run: (ctx: { store: AccountStore; base: string; ownerToken: string; get: (path: string, token?: string) => Promise<{ status: number; body: Record<string, unknown> }> }) => Promise<void>) {
  let now = Date.UTC(2026, 10, 1)
  const db = openDatabase(':memory:')
  const store = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => now })
  // the owner's rights need a confirmed e-mail: the account an e-mail code would create
  const { salt, hash } = await newPasswordHash('owner-password-1')
  const owner = store.createVerifiedAccount('owner@example.com', salt, hash)
  const server = createApi(new ProgressStore(':memory:'), undefined, store, {}).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const get = async (path: string, token = owner.token) => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  try { await run({ store, base, ownerToken: owner.token, get }) } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    now += 0
  }
}
const idOf = (store: AccountStore, token: string) => store.authenticate(token)!

test('maskEmail keeps two letters and the domain', () => {
  assert.equal(maskEmail('player@gmail.com'), 'pl•••@gmail.com')
  assert.equal(maskEmail('a@mail.ru'), 'a•••@mail.ru')
  assert.equal(maskEmail('no-at-sign'), '•••')
})

test('a game account back on a new account after the old one was deleted: a case with the first and the current account', async () => {
  await withApi(async ({ store, get, base, ownerToken }) => {
    const first = await store.register('first.player@gmail.com', 'password-12345', undefined, '203.0.113.7', 'DE')
    store.bindEftAccount(idOf(store, first.token), '9876543')
    const firstId = idOf(store, first.token)
    store.deleteAccount(firstId)

    // nothing to report yet
    assert.deepEqual((await get('/v1/accounts/me/admin/eft-cases')).body.counts, { active: 0, working: 0, closed: 0 })

    const again = await store.register('second.try@gmail.com', 'password-12345', undefined, '203.0.113.8', 'DE')
    const againId = idOf(store, again.token)
    let told = 0
    store.onEftRebind = () => { told += 1 }
    store.bindEftAccount(againId, '9876543')
    assert.equal(told, 1)

    const list = await get('/v1/accounts/me/admin/eft-cases?view=active')
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.counts, { active: 1, working: 0, closed: 0 })
    const [row] = list.body.rows as Array<{ id: number; eft: string; current: { email: string; deleted: boolean; trialDenied: boolean }; previous: Array<{ email: string; deleted: boolean; goneReason: string; accountId: string }> }>
    assert.equal(row!.eft, '••••543')
    assert.equal(row!.current.email, 'second.try@gmail.com')
    assert.equal(row!.current.deleted, false)
    assert.equal(row!.previous.length, 1)
    assert.equal(row!.previous[0]!.accountId, firstId)
    assert.equal(row!.previous[0]!.email, 'fi•••@gmail.com')
    assert.equal(row!.previous[0]!.deleted, true)
    assert.equal(row!.previous[0]!.goneReason, 'deleted')

    // binding again changes nothing (one case per game account and account)
    store.bindEftAccount(againId, '9876543')
    assert.equal(told, 1)

    // the owner's badge counts it
    const events = await get('/v1/accounts/me/admin/requests/events')
    assert.equal(events.body.open, 1)
    assert.equal(events.body.eftCases, 1)

    // statuses
    const moved = await fetch(`${base}/v1/accounts/me/admin/eft-cases/${row!.id}/status`, { method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'working' }) })
    assert.equal(moved.status, 200)
    assert.deepEqual((await get('/v1/accounts/me/admin/eft-cases?view=working')).body.counts, { active: 0, working: 1, closed: 0 })
    assert.equal((await get('/v1/accounts/me/admin/requests/events')).body.open, 0)
  })
})

test('an ordinary first binding and a game account still held by a live account make no case; only the owner sees the list', async () => {
  await withApi(async ({ store, get }) => {
    const one = await store.register('one@example.com', 'password-12345', undefined, '203.0.113.9', 'FR')
    store.bindEftAccount(idOf(store, one.token), '1112223')
    const two = await store.register('two@example.com', 'password-12345', undefined, '203.0.113.10', 'FR')
    assert.throws(() => store.bindEftAccount(idOf(store, two.token), '1112223'))
    assert.deepEqual((await get('/v1/accounts/me/admin/eft-cases')).body.counts, { active: 0, working: 0, closed: 0 })
    assert.equal((await get('/v1/accounts/me/admin/eft-cases', two.token)).status, 404)
  })
})

interface Answer { status: number; body: Record<string, unknown> }
const device = (n: number) => `device-${String(n).padStart(2, '0')}-abcdefghijklmnopqrstu`
const X = '7654321'
const Y = '1234999'

/**
 * «Спор за игровой аккаунт» (owner, 27.11.2026): an app device of one Raid OS account reports a game account another one
 * holds. The apps on their devices (POST /v1/entitlement, then the report of the logs), Premium and payments by hand.
 */
async function withDisputes(run: (ctx: {
  store: AccountStore
  db: DatabaseSync
  register: (email: string) => Promise<string>
  entitle: (token: string, deviceId: string) => Promise<Answer>
  report: (token: string, eftId: string) => Promise<Answer>
  get: (path: string, token?: string) => Promise<Answer>
  post: (path: string, body: unknown, token?: string) => Promise<Answer>
  pay: (token: string, days: number) => void
  advance: (ms: number) => void
  ownerToken: string
}) => Promise<void>) {
  let now = Date.UTC(2026, 10, 27, 10)
  const db = openDatabase(':memory:')
  const store = new AccountStore({ db, ownerEmails: ['owner@example.com'], storeReviewEmails: ['review@example.com'], now: () => now, streamerTrial: false })
  const payments = new PaymentStore(db, undefined, { now: () => now })
  store.attachSubscriptions(payments)
  const { salt, hash } = await newPasswordHash('owner-password-1')
  const owner = store.createVerifiedAccount('owner@example.com', salt, hash)
  const progress = new ProgressStore(':memory:')
  const server = createApi(progress, undefined, store, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Answer> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} }
  }
  try {
    await run({
      store,
      db,
      register: async (email) => (await store.register(email, 'password-12345')).token,
      entitle: (token, deviceId) => call('POST', '/v1/entitlement', token, { deviceId, deviceName: 'Windows · PC' }),
      report: (token, eftId) => call('POST', '/v1/accounts/me/eft-account', token, { accountId: eftId }),
      get: (path, token = owner.token) => call('GET', path, token),
      post: (path, body, token = owner.token) => call('POST', path, token, body),
      pay: (token, days) => {
        db.prepare('INSERT INTO subscriptions (account_id, paid_until) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET paid_until = excluded.paid_until').run(store.authenticate(token)!, now + days * 86_400_000)
      },
      advance: (ms) => { now += ms },
      ownerToken: owner.token,
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    progress.close()
  }
}
const disputes = (answer: Answer) => answer.body.disputes as { rows: EftDispute[]; counts: Record<string, number> }

test('a game account another account holds, reported from an app: one case with both accounts, whether each paid and when', async () => {
  await withDisputes(async ({ register, entitle, report, get, pay, advance }) => {
    const holder = await register('holder@example.com')
    await entitle(holder, device(1))
    assert.equal((await report(holder, X)).status, 200)
    const payer = await register('payer@example.com')
    pay(payer, 30)
    await entitle(payer, device(2))
    assert.equal((await report(payer, X)).status, 409)

    const list = await get('/v1/accounts/me/admin/eft-cases?view=active')
    assert.equal(list.status, 200)
    assert.deepEqual(list.body.counts, { active: 0, working: 0, closed: 0 }, 'no case of the other kind')
    assert.deepEqual(disputes(list).counts, { active: 1, working: 0, closed: 0 })
    const [row] = disputes(list).rows
    assert.equal(row!.kind, 'dispute')
    assert.equal(row!.eft, '••••321')
    assert.equal(row!.holder.email, 'holder@example.com')
    assert.equal(row!.holder.paid, false)
    assert.equal(row!.holder.bound?.disputed, true)
    assert.equal(row!.disputer.email, 'payer@example.com')
    assert.equal(row!.disputer.paid, true)
    assert.equal(row!.disputer.paidUntil, new Date(Date.UTC(2026, 10, 27, 10) + 30 * 86_400_000).toISOString())
    assert.equal(row!.disputer.bound, undefined)
    assert.equal(row!.createdAt, row!.seenAt)

    // The owner's badge counts it.
    const events = await get('/v1/accounts/me/admin/requests/events')
    assert.equal(events.body.eftCases, 1)
    assert.equal(events.body.open, 1)

    // Every later report of the pair is noted on the same case.
    advance(60 * 60 * 1000)
    assert.equal((await report(payer, X)).status, 409)
    const again = disputes(await get('/v1/accounts/me/admin/eft-cases?view=active'))
    assert.equal(again.rows.length, 1)
    assert.equal(again.rows[0]!.id, row!.id)
    assert.ok(again.rows[0]!.seenAt > again.rows[0]!.createdAt)

    // Another account claiming it is its own case; a free one shows as not paid.
    const free = await register('free@example.com')
    await entitle(free, device(3))
    await report(free, X)
    const both = disputes(await get('/v1/accounts/me/admin/eft-cases?view=active'))
    assert.equal(both.rows.length, 2)
    assert.equal(both.rows[0]!.disputer.email, 'free@example.com')
    assert.equal(both.rows[0]!.disputer.paid, false)
  })
})

test('two players on one PC: a report that fits right after takes the case back; a later one does not', async () => {
  await withDisputes(async ({ register, entitle, report, get, advance }) => {
    const a = await register('a.player@example.com')
    await entitle(a, device(1))
    await report(a, X)
    const b = await register('b.player@example.com')
    await entitle(b, device(2))
    await report(b, Y)
    // b's PC: the logs show X first (a played there last), then b's own Y.
    assert.equal((await report(b, X)).status, 409)
    assert.equal(disputes(await get('/v1/accounts/me/admin/eft-cases')).counts.active, 1)
    assert.equal((await report(b, Y)).status, 200)
    assert.equal(disputes(await get('/v1/accounts/me/admin/eft-cases')).counts.active, 0)
    // X again, and Y only after a while: the case stays for the owner.
    assert.equal((await report(b, X)).status, 409)
    advance(DISPUTE_SETTLE_MS + 1000)
    assert.equal((await report(b, Y)).status, 200)
    assert.equal(disputes(await get('/v1/accounts/me/admin/eft-cases')).counts.active, 1)
  })
})

test('the owner decides: «Оставить привязку» stands without repeats, «Отдать спорящему» moves the binding, «Снять обе» unbinds both', async () => {
  await withDisputes(async ({ store, db, register, entitle, report, get, post, pay }) => {
    const holder = await register('holder@example.com')
    assert.equal((await entitle(holder, device(1))).body.plan, 'trial')
    await report(holder, X)
    const payer = await register('payer@example.com')
    pay(payer, 30)
    await entitle(payer, device(2))
    await report(payer, X)
    const id = disputes(await get('/v1/accounts/me/admin/eft-cases')).rows[0]!.id

    const kept = await post(`/v1/accounts/me/admin/eft-disputes/${id}/decision`, { decision: 'keep' })
    assert.equal(kept.status, 200)
    assert.deepEqual([(kept.body.dispute as EftDispute).status, (kept.body.dispute as EftDispute).decision], ['closed', 'keep'])
    // The next start of the payer's app reports X again: no new case while the same account holds it.
    await report(payer, X)
    assert.deepEqual(disputes(await get('/v1/accounts/me/admin/eft-cases?view=closed')).counts, { active: 0, working: 0, closed: 1 })
    // «Вернуть»: open again.
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/status`, { status: 'active' })).status, 200)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/status`, { status: 'working' })).status, 200)

    const given = await post(`/v1/accounts/me/admin/eft-disputes/${id}/decision`, { decision: 'transfer' })
    assert.equal(given.status, 200)
    assert.equal((given.body.dispute as EftDispute).decision, 'transfer')
    const holderId = store.authenticate(holder)!
    const payerId = store.authenticate(payer)!
    assert.equal(store.view(payerId).eftAccount?.masked, '••••321')
    assert.equal(store.view(holderId).eftAccount, undefined)
    // The free period of X goes with it: the holder had it.
    assert.equal((db.prepare('SELECT account_id FROM eft_trial_claims WHERE eft_digest = ?').get(eftDigest(X)) as { account_id: string }).account_id, payerId)
    // The payer's PC opens as the bound one; the holder's PC with X is now the refused one, and his report is a new case.
    assert.equal((await entitle(payer, device(2))).status, 200)
    assert.equal((await entitle(holder, device(1))).status, 403)
    assert.equal((await report(holder, X)).status, 409)
    const counter = disputes(await get('/v1/accounts/me/admin/eft-cases')).rows[0]!
    assert.equal(counter.disputer.email, 'holder@example.com')
    assert.equal(counter.holder.email, 'payer@example.com')
    assert.equal(counter.holder.paid, true)

    // The owner's journal: who got the game account.
    const journal = db.prepare("SELECT target, details FROM owner_audit_log WHERE action = 'eft.dispute' ORDER BY id").all() as Array<{ target: string; details: string }>
    assert.deepEqual(journal.map((entry) => [entry.target, (JSON.parse(entry.details) as { decision: string }).decision]), [['payer@example.com', 'keep'], ['payer@example.com', 'transfer']])
    assert.equal((JSON.parse(journal[1]!.details) as { holder: string }).holder, 'holder@example.com')

    // «Снять обе»: neither keeps a binding or a report; the next report binds the game account again.
    const cleared = await post(`/v1/accounts/me/admin/eft-disputes/${counter.id}/decision`, { decision: 'unbind' })
    assert.equal((cleared.body.dispute as EftDispute).decision, 'unbind')
    assert.equal(store.view(payerId).eftAccount, undefined)
    assert.equal(store.view(holderId).eftAccount, undefined)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM eft_reports WHERE account_id IN (?, ?)').get(payerId, holderId) as { n: number }).n, 0)
    assert.equal((await report(holder, X)).status, 200)
    assert.equal(store.view(holderId).eftAccount?.masked, '••••321')
  })
})

test('a disputing account that binds the game account once it is free closes its case by itself', async () => {
  await withDisputes(async ({ store, register, entitle, report, get }) => {
    const holder = await register('holder@example.com')
    await entitle(holder, device(1))
    await report(holder, X)
    const other = await register('other@example.com')
    await entitle(other, device(2))
    await report(other, X)
    store.unbindEftAccount(store.authenticate(holder)!)
    assert.equal((await report(other, X)).status, 200)
    const closed = disputes(await get('/v1/accounts/me/admin/eft-cases?view=closed'))
    assert.equal(closed.counts.active, 0)
    assert.equal(closed.rows[0]!.decision, 'bound')
    assert.equal(closed.rows[0]!.disputer.bound?.disputed, true)
  })
})

test('disputes: only the owner, checked input, a decided case stays decided; no case for the owner or the Apple reviewer, at most three open', async () => {
  await withDisputes(async ({ store, register, entitle, report, get, post, advance, ownerToken }) => {
    const holder = await register('holder@example.com')
    await entitle(holder, device(1))
    await report(holder, X)
    const other = await register('other@example.com')
    await entitle(other, device(2))
    await report(other, X)
    const id = disputes(await get('/v1/accounts/me/admin/eft-cases')).rows[0]!.id

    assert.equal((await get('/v1/accounts/me/admin/eft-cases', other)).status, 404)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/decision`, { decision: 'transfer' }, other)).status, 404)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/decision`, { decision: 'maybe' })).status, 400)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/status`, { status: 'closed' })).status, 400)
    assert.equal((await post('/v1/accounts/me/admin/eft-disputes/999/decision', { decision: 'keep' })).status, 404)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/decision`, { decision: 'unbind' })).status, 200)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/decision`, { decision: 'keep' })).status, 409)
    assert.equal((await post(`/v1/accounts/me/admin/eft-disputes/${id}/status`, { status: 'active' })).status, 409, 'only a case left as it is opens again')

    // The owner's and the Apple reviewer's accounts are never refused, so they make no case.
    assert.equal((await report(holder, X)).status, 200)
    await entitle(ownerToken, device(4))
    assert.equal((await report(ownerToken, X)).status, 200)
    const { salt, hash } = await newPasswordHash('review-password-1')
    const review = store.createVerifiedAccount('review@example.com', salt, hash).token
    await entitle(review, device(3))
    assert.equal((await report(review, X)).status, 200)
    assert.equal(disputes(await get('/v1/accounts/me/admin/eft-cases')).counts.active, 0)

    // At most three open cases for one disputing account.
    const ids = ['1000001', '1000002', '1000003', '1000004']
    for (const [n, eftId] of ids.entries()) {
      const bound = await register(`holder${n}@example.com`)
      await entitle(bound, device(10 + n))
      await report(bound, eftId)
    }
    const claimer = await register('claimer@example.com')
    await entitle(claimer, device(20))
    for (const eftId of ids) {
      await report(claimer, eftId)
      advance(DISPUTE_SETTLE_MS + 1000)
    }
    assert.equal(disputes(await get('/v1/accounts/me/admin/eft-cases')).counts.active, 3)
  })
})

test('the owner unbinding a game account and binding it to another account makes no case; the history still shows it', async () => {
  await withApi(async ({ store, get }) => {
    const one = await store.register('one@example.com', 'password-12345', undefined, '203.0.113.9', 'FR')
    store.bindEftAccount(idOf(store, one.token), '5554443')
    store.unbindEftAccount(idOf(store, one.token))
    const two = await store.register('two@example.com', 'password-12345', undefined, '203.0.113.10', 'FR')
    let told = 0
    store.onEftRebind = () => { told += 1 }
    store.bindEftAccount(idOf(store, two.token), '5554443')
    assert.equal(told, 0)
    assert.deepEqual((await get('/v1/accounts/me/admin/eft-cases')).body.counts, { active: 0, working: 0, closed: 0 })
    // the first account deleted later: the next binding elsewhere is a case, and both earlier accounts are listed
    store.deleteAccount(idOf(store, one.token))
    store.unbindEftAccount(idOf(store, two.token))
    const three = await store.register('three@example.com', 'password-12345', undefined, '203.0.113.11', 'FR')
    store.bindEftAccount(idOf(store, three.token), '5554443')
    const [row] = (await get('/v1/accounts/me/admin/eft-cases')).body.rows as Array<{ current: { email: string }; previous: Array<{ email: string; goneReason: string; deleted: boolean }> }>
    assert.equal(row!.current.email, 'three@example.com')
    assert.deepEqual(row!.previous.map((entry) => [entry.email, entry.goneReason, entry.deleted]), [['on•••@example.com', 'deleted', true], ['two@example.com', 'unbound', false]])
  })
})
