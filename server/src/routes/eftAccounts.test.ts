import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, eftDigest, newPasswordHash, type SubscriptionSource } from '../services/accountStore.js'
import { DataGateway } from '../services/dataGateway.js'
import { EntitlementService } from '../services/entitlement.js'
import { openDatabase } from '../services/database.js'
import { ProgressStore } from '../services/progressStore.js'

// Owner, 13.10.2026: one Escape from Tarkov account — one Raid OS account, both ways, decided by the server's
// bindings whatever the PC keeps («не войдешь в один аккаунт Таркова двумя аккаунтами RAID OS»).
const device = (n: number) => `device-${String(n).padStart(2, '0')}-abcdefghijklmnopqrstu`
const PASSWORD = 'correct horse battery staple'
const X = '7654321'
const Y = '1234999'

interface Answer { status: number; body: Record<string, unknown> }

async function withApi(run: (ctx: {
  accounts: AccountStore
  register: (email: string) => Promise<string>
  /** The desktop app: sign-in / refresh of the entitlement on a device. */
  entitle: (token: string, deviceId: string) => Promise<Answer>
  /** The desktop app after a log scan: the game account of this PC. */
  report: (token: string, eftId: string) => Promise<Answer>
  /** A paid-data request from a device. */
  data: (token: string, deviceId: string) => Promise<Answer>
  advance: (ms: number) => void
}) => Promise<void>) {
  let clock = Date.parse('2026-10-13T12:00:00Z')
  const accounts = new AccountStore({ now: () => clock, ownerEmails: ['owner@example.com'], streamerTrial: false })
  const source: SubscriptionSource = { paidUntil: () => undefined, referralStats: () => ({ activeSubscriptions: 0, revenue: 0, earnings: 0 }), referralSeries: () => [] }
  accounts.attachSubscriptions(source)
  const entitlements = new EntitlementService(accounts)
  const fetcher = (async () => new Response('{"data":{"items":[]}}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const store = new ProgressStore(':memory:')
  const server = createApi(store, undefined, accounts, { entitlements, data: new DataGateway({ fetch: fetcher }) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, token: string, body?: unknown, deviceId?: string): Promise<Answer> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(deviceId ? { 'x-raid-device': deviceId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} }
  }
  try {
    await run({
      accounts,
      register: async (email) => (await accounts.register(email, PASSWORD)).token,
      entitle: (token, deviceId) => call('POST', '/v1/entitlement', token, { deviceId, deviceName: 'Windows · PC' }),
      report: (token, eftId) => call('POST', '/v1/accounts/me/eft-account', token, { accountId: eftId }),
      data: (token, deviceId) => call('POST', '/v1/data/graphql', token, { query: '{ items { id } }' }, deviceId),
      advance: (ms) => { clock += ms },
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
}

test('a game account bound to one Raid OS account locks a second one out on every PC whose logs show it', async () => {
  await withApi(async ({ accounts, register, entitle, report, data }) => {
    const a = await register('player@gmail.com')
    assert.equal((await entitle(a, device(1))).body.plan, 'trial')
    const bound = await report(a, X)
    assert.equal(bound.status, 200)
    assert.deepEqual(bound.body.eftAccount, { masked: '••••321', boundAt: '2026-10-13T12:00:00.000Z' })
    assert.equal((await data(a, device(1))).status, 200)

    // A second Raid OS account on a PC with fresh app data (a new device id): the free day starts, the logs show X.
    const b = await register('second@mail.ru')
    assert.equal((await entitle(b, device(2))).body.plan, 'trial')
    const refused = await report(b, X)
    assert.equal(refused.status, 409)
    assert.deepEqual(refused.body, { error: 'Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.', code: 'eft-in-use', kind: 'in-use', seen: '••••321' })
    // Locked on that PC at once: no entitlement, no paid data.
    const locked = await entitle(b, device(2))
    assert.equal(locked.status, 403)
    assert.equal(locked.body.code, 'eft_conflict')
    assert.equal(locked.body.conflict, 'in-use')
    assert.equal(locked.body.seen, '••••321')
    const gate = await data(b, device(2))
    assert.equal(gate.status, 403)
    assert.equal(gate.body.code, 'eft_conflict')
    assert.equal(accounts.view(accounts.authenticate(b)!).eftAccount, undefined, 'nothing bound to the second account')
    // The first account keeps working.
    assert.equal((await entitle(a, device(1))).status, 200)
    assert.equal((await data(a, device(1))).status, 200)

    // The second account under its own game account on another PC: bound, works there.
    assert.equal((await entitle(b, device(3))).status, 200)
    const login = (await accounts.login('second@mail.ru', PASSWORD)).token
    assert.equal((await entitle(login, device(4))).status, 200)
    assert.equal((await report(login, Y)).status, 200)
    assert.equal((await entitle(login, device(4))).status, 200)
  })
})

test('a Raid OS account bound to one game account cannot be used with another (a shared subscription)', async () => {
  await withApi(async ({ accounts, register, entitle, report, data }) => {
    const a = await register('player@gmail.com')
    await entitle(a, device(1))
    assert.equal((await report(a, X)).status, 200)
    // A friend signs in to the same Raid OS account on his PC, whose logs show his own game account Y.
    const friend = (await accounts.login('player@gmail.com', PASSWORD)).token
    assert.equal((await entitle(friend, device(2))).status, 200)
    const refused = await report(friend, Y)
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'eft-other-account')
    assert.equal(refused.body.error, 'К этому аккаунту Raid OS привязан другой аккаунт Escape from Tarkov.')
    assert.equal(refused.body.seen, '••••999')
    assert.equal(refused.body.bound, '••••321')
    const locked = await entitle(friend, device(2))
    assert.equal(locked.status, 403)
    assert.deepEqual([locked.body.code, locked.body.conflict, locked.body.seen, locked.body.bound], ['eft_conflict', 'other-account', '••••999', '••••321'])
    assert.equal((await data(friend, device(2))).status, 403)
    // The account's own PC keeps working, and its binding stays.
    assert.equal((await entitle(a, device(1))).status, 200)
    assert.equal((await data(a, device(1))).status, 200)
    assert.equal(accounts.view(accounts.authenticate(a)!).eftAccount?.masked, '••••321')
    // The bound game account in that PC's logs («Проверить снова»): open there too.
    assert.equal((await report(friend, X)).status, 200)
    assert.equal((await entitle(friend, device(2))).status, 200)
    assert.equal((await data(friend, device(2))).status, 200)
  })
})

test('the free day: once per game account, also after the first Raid OS account was deleted', async () => {
  await withApi(async ({ accounts, register, entitle, report }) => {
    const a = await register('player@gmail.com')
    await entitle(a, device(1))
    assert.equal((await report(a, X)).status, 200)
    accounts.deleteAccount(accounts.authenticate(a)!)

    // A new account, a new mailbox, fresh app data: the game account is free again, its free day is not.
    const c = await register('again@yandex.ru')
    assert.equal((await entitle(c, device(2))).body.plan, 'trial')
    const bound = await report(c, X)
    assert.equal(bound.status, 200, 'the game account binds to the new account')
    assert.deepEqual((bound.body.account as { subscription: unknown }).subscription, { status: 'inactive' })
    const refused = await entitle(c, device(2))
    assert.equal(refused.status, 402, 'no second free day for the same game account')
    assert.equal(refused.body.error, 'Нужна подписка')

    // Another game account keeps its own free day.
    const d = await register('newplayer@mail.ru')
    await entitle(d, device(3))
    assert.equal((await report(d, Y)).status, 200)
    assert.equal((await entitle(d, device(3))).body.plan, 'trial')
  })
})

test('the owner: never locked, and his own game account locks nobody out (testing the players\' app on his PC)', async () => {
  await withApi(async ({ accounts, register, entitle, report }) => {
    const { salt, hash } = await newPasswordHash(PASSWORD)
    const owner = accounts.createVerifiedAccount('owner@example.com', salt, hash).token
    assert.equal((await entitle(owner, device(1))).status, 200)
    assert.equal((await report(owner, X)).status, 200)
    assert.equal((await report(owner, Y)).status, 200, 'another game account on the owner\'s account: no refusal')
    assert.equal((await entitle(owner, device(1))).status, 200)
    // A test account on the owner's PC: allowed, nothing bound to it.
    const tester = await register('tester@example.com')
    assert.equal((await entitle(tester, device(1))).status, 200)
    const seen = await report(tester, X)
    assert.equal(seen.status, 200)
    assert.equal(seen.body.eftAccount, undefined)
    assert.equal((await entitle(tester, device(1))).status, 200)
  })
})

test('the owner unbinds a game account (a player changed accounts): the locked PC opens and binds it', async () => {
  await withApi(async ({ accounts, register, entitle, report }) => {
    const a = await register('player@gmail.com')
    await entitle(a, device(1))
    await report(a, X)
    const b = await register('second@mail.ru')
    await entitle(b, device(2))
    assert.equal((await report(b, X)).status, 409)
    assert.equal((await entitle(b, device(2))).status, 403)
    const idA = accounts.authenticate(a)!
    assert.equal(accounts.unbindEftAccount(idA), true)
    assert.equal(accounts.view(idA).eftAccount, undefined)
    assert.equal(accounts.unbindEftAccount(idA), false, 'nothing left to unbind')
    // The second account's PC: open again at the next check, and its report binds the game account.
    const opened = await entitle(b, device(2))
    assert.equal(opened.status, 200)
    assert.equal((await report(b, X)).status, 200)
    assert.equal(accounts.view(accounts.authenticate(b)!).eftAccount?.masked, '••••321')
    // The first account's PC with the same logs is now the one refused.
    assert.equal((await report(a, X)).status, 409)
    assert.equal((await entitle(a, device(1))).status, 403)
  })
})

test('a report from a session without an app device (the website) binds or refuses, but locks no device', async () => {
  await withApi(async ({ accounts, register, entitle, report }) => {
    const a = await register('player@gmail.com')
    await entitle(a, device(1))
    await report(a, X)
    const b = await register('second@mail.ru')
    assert.equal((await report(b, X)).status, 409, 'the rule holds')
    // That session never registered a device: nothing is locked for b's app.
    const app = (await accounts.login('second@mail.ru', PASSWORD)).token
    assert.equal((await entitle(app, device(5))).status, 200)
  })
})

test('the whole AccountId decides, not the last three digits shown on screen (owner, 13.10.2026)', async () => {
  await withApi(async ({ register, entitle, report }) => {
    const a = await register('player@gmail.com')
    await entitle(a, device(1))
    assert.equal((await report(a, '7654321')).status, 200)
    // Another game account that also ends with 321: a different account for the server.
    const b = await register('other@mail.ru')
    await entitle(b, device(2))
    const other = await report(b, '1111321')
    assert.equal(other.status, 200)
    assert.equal((other.body.eftAccount as { masked: string }).masked, '••••321', 'the same digits on screen')
    assert.equal((await entitle(b, device(2))).status, 200)
    assert.notEqual(eftDigest('7654321'), eftDigest('1111321'))
    // And a number that only differs elsewhere is not the first one either.
    const c = await register('third@mail.ru')
    await entitle(c, device(3))
    assert.equal((await report(c, '7654322')).status, 200)
  })
})

test('a second account without a free day sees «already in use», not «Нужна подписка» (owner, 13.10.2026)', async () => {
  await withApi(async ({ register, entitle, report }) => {
    const a = await register('player@gmail.com')
    await entitle(a, device(1))
    await report(a, X)
    // A similar mailbox registers (no block on similar e-mails) and signs in on the same PC: no free day there.
    const b = await register('p.layer+2@gmail.com')
    const paywall = await entitle(b, device(1))
    assert.equal(paywall.status, 402)
    // The locked app reports the game account of the PC: from then on the reason is the game account.
    const refused = await report(b, X)
    assert.equal(refused.status, 409)
    const locked = await entitle(b, device(1))
    assert.equal(locked.status, 403)
    assert.equal(locked.body.code, 'eft_conflict')
    assert.equal(locked.body.error, 'Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.')
  })
})

test('game accounts bound before this change keep their free day counted (filled in on start)', () => {
  const db = openDatabase(':memory:')
  let clock = Date.parse('2026-10-13T12:00:00Z')
  const first = new AccountStore({ db, now: () => clock, streamerTrial: false })
  // A binding from before eft_trial_claims existed: an account that had its free day, bound to X.
  const id = 'a'.repeat(24)
  db.prepare("INSERT INTO accounts (id, email, salt, password_hash, kind, created_at, nicknames, trial_ends_at) VALUES (?, 'old@example.com', x'00', x'00', 'user', ?, '{}', ?)").run(id, clock, clock + 86_400_000)
  db.prepare('INSERT INTO eft_accounts (account_id, eft_digest, eft_hint, bound_at) VALUES (?, ?, ?, ?)').run(id, eftDigest(X), '321', clock)
  db.prepare('DELETE FROM eft_trial_claims').run()
  void first
  clock += 1000
  new AccountStore({ db, now: () => clock, streamerTrial: false })
  assert.equal((db.prepare('SELECT account_id FROM eft_trial_claims WHERE eft_digest = ?').get(eftDigest(X)) as { account_id?: string } | undefined)?.account_id, id)
})
