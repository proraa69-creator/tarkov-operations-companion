import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, newPasswordHash } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { ProgressStore } from '../services/progressStore.js'
import { maskEmail } from '../services/eftLedger.js'

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
