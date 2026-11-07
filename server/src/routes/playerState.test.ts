import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { PlayerStateStore, STATE_LIMITS, type StateRow } from '../services/playerStateStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { UserDataStore } from '../services/userDataStore.js'
import { createMeRouter } from './me.js'

const password = 'correct horse battery'
const T = Date.now() - 3_600_000

type Call = (method: string, path: string, body?: unknown, token?: string) => Promise<Response>
interface Rows { rev: number; now: number; items: StateRow[]; more: boolean; kept?: number; refused?: number }

async function withServer(run: (call: Call, register: (email: string) => Promise<string>, accounts: AccountStore) => Promise<void>) {
  const store = new ProgressStore(':memory:')
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [] })
  const server = createApi(store, undefined, accounts, { payments: new PaymentStore(db, undefined), userData: new UserDataStore(db) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call: Call = (method, path, body, token) => fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const register = async (email: string) => {
    const response = await call('POST', '/v1/accounts/register', { email, password, country: 'RU' })
    assert.equal(response.status, 201)
    return ((await response.json()) as { token: string }).token
  }
  try {
    await run(call, register, accounts)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
    accounts.close()
  }
}

const row = (item: string, at: number, value: unknown = true, kind = 'promo-used', mode: StateRow['mode'] = ''): StateRow => ({ kind, mode, item, at, value })
const sync = async (call: Call, token: string, since: number, items: StateRow[]) => {
  const response = await call('POST', '/v1/me/state', { since, items }, token)
  assert.equal(response.status, 200)
  return (await response.json()) as Rows
}
const pull = async (call: Call, token: string, since: number) => {
  const response = await call('GET', `/v1/me/state?since=${since}`, undefined, token)
  assert.equal(response.status, 200)
  return (await response.json()) as Rows
}
const names = (rows: StateRow[]) => rows.map((entry) => entry.item).sort()

test('only with a session, and only what the route knows', async () => {
  await withServer(async (call, register) => {
    assert.equal((await call('GET', '/v1/me/state')).status, 401)
    assert.equal((await call('POST', '/v1/me/state', { since: 0, items: [] })).status, 401)
    const token = await register('state-auth@example.com')
    assert.equal((await call('GET', '/v1/me/state?since=x', undefined, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/state', { items: [] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/state', { since: 0, items: [row('a', T, true, 'Not A Kind')] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/state', { since: 0, items: [row('a', T, true, 'promo-used', 'arena' as never)] }, token)).status, 400)
    // A row without a value is no «taken off» by accident: taking off says null.
    assert.equal((await call('POST', '/v1/me/state', { since: 0, items: [{ kind: 'promo-used', mode: '', item: 'a', at: T }] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/state', { since: 0, items: [row('a'.repeat(301), T)] }, token)).status, 400)
    const tooMany = Array.from({ length: STATE_LIMITS.itemsPerSync + 1 }, (_, index) => row(`code-${index}`, T))
    assert.equal((await call('POST', '/v1/me/state', { since: 0, items: tooMany }, token)).status, 400)
  })
})

test('two devices changing different items both win, and each hears only what the other did', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-both@example.com')
    const pc = await sync(call, token, 0, [row('PC-CODE', T)])
    assert.deepEqual(pc.items, [], 'its own row does not come back')
    assert.equal(pc.kept, 1)
    const phone = await sync(call, token, 0, [row('PHONE-CODE', T + 1)])
    assert.deepEqual(names(phone.items), ['PC-CODE'])
    const seen = await pull(call, token, pc.rev)
    assert.deepEqual(names(seen.items), ['PHONE-CODE'])
    assert.deepEqual(names((await pull(call, token, 0)).items), ['PC-CODE', 'PHONE-CODE'])
    assert.deepEqual((await pull(call, token, seen.rev)).items, [], 'nothing new, nothing sent')
  })
})

test('taking a tick off travels, and a device that still holds the old copy does not bring it back', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-tomb@example.com')
    const first = await sync(call, token, 0, [row('CODE', T)])
    const off = await sync(call, token, first.rev, [row('CODE', T + 1000, null)])
    assert.equal(off.kept, 1)
    assert.deepEqual((await pull(call, token, first.rev)).items, [row('CODE', T + 1000, null)])
    // A device's first look after the update: what it holds counts as older than any real change (at 1), and it is told what stands.
    const stale = await sync(call, token, off.rev, [row('CODE', 1)])
    assert.equal(stale.kept, 0)
    assert.deepEqual(stale.items, [row('CODE', T + 1000, null)])
    assert.deepEqual((await pull(call, token, 0)).items, [row('CODE', T + 1000, null)])
    // A real later change puts it back.
    assert.equal((await sync(call, token, off.rev, [row('CODE', T + 2000)])).kept, 1)
    assert.deepEqual((await pull(call, token, 0)).items, [row('CODE', T + 2000)])
  })
})

test('never older over newer; a clock far ahead counts as now and is told the time that counted', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-clock@example.com')
    const first = await sync(call, token, 0, [row('item', T, 2, 'hideout-levels', 'pvp')])
    const older = await sync(call, token, first.rev, [row('item', T - 5000, 9, 'hideout-levels', 'pvp')])
    assert.equal(older.kept, 0)
    assert.deepEqual(older.items, [row('item', T, 2, 'hideout-levels', 'pvp')])
    // The same time: the account's copy stands.
    assert.equal((await sync(call, token, first.rev, [row('item', T, 5, 'hideout-levels', 'pvp')])).kept, 0)
    assert.equal(((await pull(call, token, 0)).items[0]!).value, 2)

    const future = Date.now() + 10 * 60 * 1000
    const ahead = await sync(call, token, first.rev, [row('clock', future)])
    assert.equal(ahead.kept, 1)
    assert.equal(ahead.items.length, 1)
    assert.ok(ahead.items[0]!.at < future && ahead.items[0]!.at <= ahead.now)
    // Nothing sticks «newest for good»: the next device's change right after it wins.
    assert.equal((await sync(call, token, ahead.rev, [row('clock', ahead.now + 1000, null)])).kept, 1)
  })
})

test('first looks of two devices at a number: the higher one stands, in whichever order they come', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-first@example.com')
    const level = (at: number, value: number) => row('stash', at, value, 'hideout-levels', 'pve')
    const phone = await sync(call, token, 0, [level(1, 1)])
    assert.equal(phone.kept, 1)
    const pc = await sync(call, token, 0, [level(1, 3)])
    assert.equal(pc.kept, 1)
    assert.deepEqual((await pull(call, token, phone.rev)).items, [level(1, 3)])
    // The other way round: the lower one is told what stands.
    const late = await sync(call, token, pc.rev, [level(1, 2)])
    assert.equal(late.kept, 0)
    assert.deepEqual(late.items, [level(1, 3)])
    // A real change is always newer, even to a lower number.
    assert.equal((await sync(call, token, pc.rev, [level(T, 1)])).kept, 1)
    assert.equal((await sync(call, token, pc.rev, [level(1, 9)])).kept, 0)
  })
})

test('PvP, PvE and Season stay apart', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-modes@example.com')
    await sync(call, token, 0, [row('quest', T, T, 'quest-checks', 'pvp')])
    await sync(call, token, 0, [row('quest', T + 5, null, 'quest-checks', 'pve')])
    const rows = (await pull(call, token, 0)).items
    assert.deepEqual(rows.map((entry) => [entry.mode, entry.value]), [['pvp', T], ['pve', null]])
  })
})

test('one account never sees another\'s', async () => {
  await withServer(async (call, register) => {
    const one = await register('state-one@example.com')
    const other = await register('state-other@example.com')
    await sync(call, one, 0, [row('MINE', T)])
    assert.deepEqual((await pull(call, other, 0)).items, [])
    assert.equal((await pull(call, other, 0)).rev, 0)
  })
})

test('what is over the limits stays on the device; the rest of the write is kept', async () => {
  const db = openDatabase(':memory:')
  const small = new PlayerStateStore(db, { valueBytes: 100, rows: 4, bytes: 200, pageRows: 2 })
  const big = 'x'.repeat(200)
  const first = small.sync('account', 0, [row('big', T, big), row('a', T), row('b', T)], T)
  assert.equal(first.kept, 2)
  assert.equal(first.refused, 1)
  // Past the bytes of the account: c fits, d does not.
  const second = small.sync('account', first.rev, [row('c', T, 'y'.repeat(95)), row('d', T, 'z'.repeat(95))], T)
  assert.equal(second.kept, 1)
  assert.equal(second.refused, 1)
  const full = small.changesSince('account', 0)
  assert.equal(full.items.length, 2)
  assert.equal(full.more, true, 'a page at a time')
  const rest = small.changesSince('account', full.rev)
  assert.equal(rest.more, false)
  assert.equal(rest.items.length, 1)
  // Rows: the fourth fits; at the limit a new one is refused while no tombstone can make room, then the oldest tombstone gives way.
  assert.equal(small.sync('account', 0, [row('f', T)], T).kept, 1)
  assert.equal(small.sync('account', 0, [row('g', T)], T).refused, 1)
  assert.equal(small.sync('account', 0, [row('a', T + 1, null)], T + 1).kept, 1)
  assert.equal(small.sync('account', 0, [row('g', T + 2)], T + 2).kept, 1)
  const names = small.changesSince('account', 0).items.map((entry) => entry.item).sort()
  assert.ok(!names.includes('a'), 'the tombstone gave way')
  db.close()
})

test('writes per account have their own limit', async () => {
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [] })
  const { token } = await accounts.register('state-rate@example.com', password, undefined, undefined, 'RU')
  const app = express().use(express.json({ limit: '1mb' }))
  app.use('/v1/me', createMeRouter(accounts, new ProgressStore(':memory:'), new UserDataStore(db), { stateRateLimit: { max: 2, windowMs: 60_000 } }))
  const server: Server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/me/state`
  const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ since: 0, items: [] }) })
  try {
    assert.equal((await post()).status, 200)
    assert.equal((await post()).status, 200)
    const limited = await post()
    assert.equal(limited.status, 429)
    assert.ok(limited.headers.get('retry-after'))
    // Reading is not counted here.
    assert.equal((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status, 200)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    accounts.close()
  }
})

test('the live channel: an app that asks hears the change at once and fetches nothing else; an older app is not woken', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-live@example.com')
    assert.equal((await call('GET', '/v1/me/social-events?since=1&state=x', undefined, token)).status, 400)
    const hello = (await (await call('GET', '/v1/me/social-events', undefined, token)).json()) as { version: number; state: number }
    assert.equal(hello.state, 0)
    let oldAnswered = false
    const older = call('GET', `/v1/me/social-events?since=${hello.version}`, undefined, token).then(async (response) => { oldAnswered = true; return (await response.json()) as { version: number } })
    const waiting = call('GET', `/v1/me/social-events?since=${hello.version}&state=0`, undefined, token)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const asked = Date.now()
    const written = await sync(call, token, 0, [row('CODE', T)])
    const answer = (await (await waiting).json()) as { version: number; state: number }
    assert.ok(Date.now() - asked < 1000, 'at once')
    assert.equal(answer.state, written.rev)
    assert.equal(answer.version, hello.version, 'the version the older apps wait on did not move: nothing makes them reload')
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(oldAnswered, false)

    // A counter the app has not heard yet: answered at once.
    const behind = await call('GET', `/v1/me/social-events?since=${hello.version}&state=0`, undefined, token)
    assert.equal(((await behind.json()) as { state: number }).state, written.rev)

    // A write that keeps nothing tells nobody (the circle of 05.11.2026).
    let quietAnswered = false
    const quiet = call('GET', `/v1/me/social-events?since=${hello.version}&state=${written.rev}`, undefined, token).then(async (response) => { quietAnswered = true; return (await response.json()) as { state: number } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await sync(call, token, written.rev, [row('CODE', T)])).kept, 0)
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(quietAnswered, false)
    // Anything that moves the version still wakes both, so the test ends without waiting out the 25 s.
    assert.equal((await call('PUT', '/v1/me/collector/pvp', { itemIds: ['axe'] }, token)).status, 200)
    await older
    await quiet
  })
})

test('a reset of the mode, from any app, takes the mode\'s lists off for the other devices; other modes and other lists stay', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-reset@example.com')
    await sync(call, token, 0, [
      row('quest', T, T, 'quest-checks', 'pvp'),
      row('quest', T, T, 'quest-checks', 'pve'),
      row('station', T, 2, 'hideout-levels', 'pvp'),
      row('stroke', T, { zoom: 1, points: [[0, 0]] }, 'map-sketch', 'pvp'),
      row('CODE', T),
    ])
    const before = await pull(call, token, 0)
    const hello = (await (await call('GET', '/v1/me/social-events', undefined, token)).json()) as { version: number; state: number }
    const waiting = call('GET', `/v1/me/social-events?since=${hello.version}&state=${hello.state}`, undefined, token)
    const at = new Date(T + 1000).toISOString()
    // What an older app sends: no word of these lists.
    assert.equal((await call('POST', '/v1/me/progress/pvp/reset', { at }, token)).status, 200)
    assert.ok(((await (await waiting).json()) as { version: number }).version > hello.version)
    const changed = await pull(call, token, before.rev)
    assert.deepEqual(changed.items.map((entry) => [entry.kind, entry.mode, entry.value, entry.at]).sort(), [
      ['hideout-levels', 'pvp', null, T + 1000],
      ['quest-checks', 'pvp', null, T + 1000],
    ])
    const all = await pull(call, token, 0)
    assert.equal(all.items.find((entry) => entry.kind === 'quest-checks' && entry.mode === 'pve')?.value, T)
    assert.ok(all.items.find((entry) => entry.kind === 'map-sketch')?.value)
    assert.equal(all.items.find((entry) => entry.kind === 'promo-used')?.value, true)
    // What a device set after the reset stands.
    assert.equal((await sync(call, token, changed.rev, [row('station', T + 2000, 1, 'hideout-levels', 'pvp')])).kept, 1)
  })
})

test('a deleted account takes its rows with it', async () => {
  await withServer(async (call, register, accounts) => {
    const token = await register('state-gone@example.com')
    await sync(call, token, 0, [row('CODE', T)])
    const id = accounts.authenticate(token)!
    accounts.deleteAccount(id)
    const left = accounts.database.prepare('SELECT COUNT(*) AS n FROM user_state_items WHERE account_id=?').get(id) as { n: number }
    assert.equal(Number(left.n), 0)
    assert.equal(accounts.database.prepare('SELECT 1 FROM user_state_revs WHERE account_id=?').get(id), undefined)
  })
})

test('the lists the server keeps whole: what a device changed goes on top, another\'s stays; an older app still replaces', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-base@example.com')
    const put = async (path: string, body: unknown) => {
      const response = await call('PUT', path, body, token)
      assert.equal(response.status, 200)
      return response.json() as Promise<{ itemIds?: string[]; found?: Record<string, number> }>
    }
    // The Collector: PC and phone both agreed on [a, b]; the phone added c meanwhile, the PC adds d and takes a off.
    await put('/v1/me/collector/pvp', { itemIds: ['a', 'b'] })
    await put('/v1/me/collector/pvp', { itemIds: ['a', 'b', 'c'], base: ['a', 'b'] })
    const collector = await put('/v1/me/collector/pvp', { itemIds: ['b', 'd'], base: ['a', 'b'] })
    assert.deepEqual([...collector.itemIds!].sort(), ['b', 'c', 'd'])
    // The first time (no base): adds what it has and takes nothing away.
    assert.deepEqual([...(await put('/v1/me/collector/pvp', { itemIds: ['e'], base: [] })).itemIds!].sort(), ['b', 'c', 'd', 'e'])
    // An older app sends the list alone: as it always did.
    assert.deepEqual((await put('/v1/me/collector/pvp', { itemIds: ['z'] })).itemIds, ['z'])

    for (const path of ['/v1/me/hideout/pve', '/v1/me/items/pve/quests']) {
      await put(path, { found: { a: 1, b: 2 } })
      await put(path, { found: { a: 1, b: 2, c: 3 }, base: { a: 1, b: 2 } })
      assert.deepEqual((await put(path, { found: { b: 5, d: 4 }, base: { a: 1, b: 2 } })).found, { b: 5, c: 3, d: 4 })
      assert.deepEqual((await put(path, { found: { y: 1 } })).found, { y: 1 })
    }
    assert.equal((await call('PUT', '/v1/me/collector/pvp', { itemIds: ['a'], base: ['bad id'] }, token)).status, 400)
  })
})

test('an empty list says whether it was taken away by a reset or never sent', async () => {
  await withServer(async (call, register) => {
    const token = await register('state-empty@example.com')
    const get = async (path: string) => (await (await call('GET', path, undefined, token)).json()) as { updatedAt: string | null; resetAt?: string }
    for (const path of ['/v1/me/collector/pve', '/v1/me/hideout/pve', '/v1/me/items/pve/stash']) {
      const never = await get(path)
      assert.equal(never.updatedAt, null)
      assert.equal(never.resetAt, undefined)
    }
    assert.equal((await call('POST', '/v1/me/progress/pve/reset', { at: new Date(T).toISOString() }, token)).status, 200)
    for (const path of ['/v1/me/collector/pve', '/v1/me/hideout/pve', '/v1/me/items/pve/stash']) assert.equal((await get(path)).resetAt, new Date(T).toISOString())
    assert.equal((await get('/v1/me/collector/pvp')).resetAt, undefined, 'another mode has its own')
  })
})
