import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { LAST_USED_STEP_MS, REQUESTS_KEY_PATTERN, RequestsKeyStore } from '../services/requestsKeyStore.js'
import { REQUESTS_KEY_REQUIRED, type AgentRequestLimits } from './agentRequests.js'
import type { AppDataset, RaidMode } from '../../../src/domain/types.js'

/** «Доступ Claude к заявкам» (owner, 14.10.2026: «2 вариант да»): the owner's read-only key for the players' reports. */
const password = 'correct horse battery'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)])
const shot = (data: Buffer) => ({ data: data.toString('base64') })
const KEY_PATH = '/accounts/me/admin/requests-key'
const report = { topic: 'Карта не открывается', description: 'Нажимаю «Карты» → Таможня, экран чёрный.', appVersion: '0.6.0.35 · client', platform: 'Windows 10/11 x64 · desktop app · EFT: Steam' }

/** The server's loaded catalog: only the quest names are read. */
const catalog = (mode: RaidMode) => (mode === 'pvp' ? { quests: [{ id: 'q1', name: 'Посылка из прошлого' }] } as unknown as AppDataset : undefined)

async function setup(limits?: Partial<AgentRequestLimits>) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, {
    payments: new PaymentStore(db, undefined), guard: { quickCheckEveryMs: 0 }, catalog,
    bugReportLimits: { perAccount: 50, perIp: 50 }, requestsKeyLimits: limits,
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const bytes = Buffer.from(await response.arrayBuffer())
    let json: unknown
    try { json = JSON.parse(bytes.toString('utf8')) } catch { json = undefined }
    return { status: response.status, json: json as T, bytes, headers: response.headers }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  const register = async (email: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password })).json.token
  const newKey = async (owner: string) => (await call<{ key: string }>('POST', KEY_PATH, owner)).json.key
  const send = async (token: string, body: unknown) => {
    const created = await call<{ id: number }>('POST', '/bug-reports', token, body)
    assert.equal(created.status, 201, JSON.stringify(created.json))
    return created.json.id
  }
  return { db, accounts, call, login, register, newKey, send, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

type KeyState = { active: boolean; createdAt?: string; lastUsedAt?: string }
type AgentPage = { status: string; total: number; counts: { open: number; closed: number }; limit: number; offset: number; reports: Array<Record<string, unknown>> }
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

test('the key: only the owner sees, creates, replaces and revokes it; it is shown once and never kept or logged', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const owner = await t.login('owner@example.com')
    for (const method of ['GET', 'POST', 'DELETE']) {
      assert.equal((await t.call(method, KEY_PATH)).status, 401, method)
      assert.equal((await t.call(method, KEY_PATH, player)).status, 404, method)
    }
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM requests_key').get()!.n, 0, 'a player created nothing')
    assert.deepEqual((await t.call<KeyState>('GET', KEY_PATH, owner)).json, { active: false })

    const created = await t.call<{ key: string; createdAt: string }>('POST', KEY_PATH, owner)
    assert.equal(created.status, 201)
    assert.equal(created.headers.get('cache-control'), 'no-store')
    assert.deepEqual(Object.keys(created.json).sort(), ['createdAt', 'key'])
    const key = created.json.key
    assert.match(key, REQUESTS_KEY_PATTERN)
    assert.deepEqual((await t.call<KeyState>('GET', KEY_PATH, owner)).json, { active: true, createdAt: created.json.createdAt })
    // Only the SHA-256 of the key is kept.
    const row = t.db.prepare('SELECT * FROM requests_key').get() as Record<string, unknown>
    assert.equal(row.key_hash, createHash('sha256').update(key).digest('hex'))
    assert.equal(JSON.stringify(row).includes(key.slice(4)), false)

    // The key reads; the owner sees when it was used.
    assert.equal((await t.call('GET', '/agent/requests', key)).status, 200)
    assert.match((await t.call<KeyState>('GET', KEY_PATH, owner)).json.lastUsedAt ?? '', ISO)

    // A new key replaces the old one at once.
    const replaced = await t.newKey(owner)
    assert.notEqual(replaced, key)
    assert.equal((await t.call('GET', '/agent/requests', key)).status, 401)
    assert.equal((await t.call<KeyState>('GET', KEY_PATH, owner)).json.lastUsedAt, undefined, 'the new key was not used yet')
    assert.equal((await t.call('GET', '/agent/requests', replaced)).status, 200)

    // Revoked: nothing reads any more; revoking again is fine.
    assert.equal((await t.call('DELETE', KEY_PATH, owner)).status, 204)
    assert.equal((await t.call('GET', '/agent/requests', replaced)).status, 401)
    assert.deepEqual((await t.call<KeyState>('GET', KEY_PATH, owner)).json, { active: false })
    assert.equal((await t.call('DELETE', KEY_PATH, owner)).status, 204)

    // The audit log says who and when, never the key.
    const audit = await t.call<{ entries: Array<{ actor: string; action: string; details?: Record<string, unknown> }> }>('GET', '/accounts/me/admin/audit', owner)
    const entries = audit.json.entries.filter((entry) => entry.action.startsWith('requests-key.')).reverse()
    assert.deepEqual(entries.map((entry) => [entry.actor, entry.action, entry.details?.replaced]), [
      ['owner@example.com', 'requests-key.create', false], ['owner@example.com', 'requests-key.create', true], ['owner@example.com', 'requests-key.revoke', undefined],
    ])
    const logged = JSON.stringify(t.db.prepare('SELECT * FROM owner_audit_log').all())
    for (const value of [key, replaced]) assert.equal(logged.includes(value.slice(4)), false)
  } finally {
    await t.close()
  }
})

test('the key reads the reports newest first: texts, versions, quest corrections, image counts; nothing personal', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const alice = await t.register('alice@example.com')
    const bob = await t.register('bob@example.com')
    const gone = await t.register('gone@example.com')
    const ids = Object.fromEntries(['alice', 'bob', 'gone'].map((name) => [name, t.accounts.accountByEmail(`${name}@example.com`)!.id]))
    const bug = await t.send(alice, { ...report, category: 'map', description: 'Таможня, чёрный экран. Пишите на alice@example.com или alice.work@почта.рф', screenshots: [shot(PNG), shot(JPEG)] })
    const idea = await t.send(bob, { kind: 'idea', topic: 'Таймер рейда', description: 'Добавьте таймер на мини-карту.', appVersion: '0.6.0.35 · Android', platform: 'Android 14 · phone app' })
    const quest = await t.send(alice, {
      topic: 'Квест «Посылка из прошлого»: точка стоит не там', description: '', category: 'quest', appVersion: '0.6.0.34 · owner', platform: 'Windows 10/11 x64 · desktop app · EFT: BSG launcher',
      quest: { questId: 'q1', issue: 'wrong-point', mode: 'pvp', mapId: 'customs', markerId: 'customs-quest-zone-q1-z1', objectiveId: 'o1', point: { x: 100, z: -40, floor: '2 этаж' }, pointNote: 'за гаражами, пишите bob@example.com' },
    })
    const old = await t.send(gone, { topic: 'Старый отчёт', description: 'Без версии', appVersion: '0.5.4', platform: 'Windows · desktop' })
    // The owner's own fields: days for a report, a closed report, a deleted account.
    assert.equal((await t.call('POST', `/accounts/me/admin/bug-reports/${bug}/reward`, owner, { days: 1 })).status, 200)
    assert.equal((await t.call('POST', `/accounts/me/admin/bug-reports/${old}/status`, owner, { status: 'closed' })).status, 200)
    t.accounts.deleteAccount(ids.gone!)
    const key = await t.newKey(owner)

    // No key, a wrong one, the owner's session instead of the key: one and the same answer.
    for (const token of [undefined, `rok_${'A'.repeat(43)}`, owner, 'not a key at all']) {
      for (const path of ['/agent/requests', `/agent/requests/${bug}/images/0`]) {
        const refused = await t.call('GET', path, token)
        assert.deepEqual([refused.status, refused.json], [401, { error: REQUESTS_KEY_REQUIRED }], `${path} ${token === owner ? 'owner session' : token}`)
        assert.equal(refused.headers.get('www-authenticate'), 'Bearer')
      }
    }

    const open = await t.call<AgentPage>('GET', '/agent/requests', key)
    assert.equal(open.status, 200)
    assert.equal(open.headers.get('cache-control'), 'no-store')
    assert.deepEqual([open.json.status, open.json.total, open.json.counts, open.json.limit, open.json.offset], ['open', 3, { open: 3, closed: 1 }, 50, 0])
    assert.deepEqual(open.json.reports.map((entry) => entry.id), [quest, idea, bug])
    const [questView, ideaView, bugView] = open.json.reports as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]
    assert.match(String(bugView.createdAt), ISO)
    assert.match(String(bugView.reporter), /^r-[0-9a-f]{12}$/)
    assert.deepEqual(bugView, {
      id: bug, number: bug, kind: 'bug', category: 'map', status: 'open', createdAt: bugView.createdAt,
      title: report.topic, text: 'Таможня, чёрный экран. Пишите на [e-mail] или [e-mail]',
      appVersion: '0.6.0.35', client: 'client', platform: 'Windows 10/11 x64 · desktop app', gameEdition: 'steam',
      images: 2, reporter: bugView.reporter,
    })
    assert.deepEqual(ideaView, {
      id: idea, number: idea, kind: 'idea', status: 'open', createdAt: ideaView.createdAt, title: 'Таймер рейда', text: 'Добавьте таймер на мини-карту.',
      appVersion: '0.6.0.35', client: 'phone', platform: 'Android 14 · phone app', images: 0, reporter: ideaView.reporter,
    })
    assert.deepEqual(questView.quest, {
      questId: 'q1', questName: 'Посылка из прошлого', issue: 'wrong-point', mode: 'pvp', mapId: 'customs', markerId: 'customs-quest-zone-q1-z1',
      objectiveId: 'o1', point: { x: 100, z: -40, floor: '2 этаж' }, pointNote: 'за гаражами, пишите [e-mail]',
    })
    assert.deepEqual([questView.category, questView.mode, questView.client, questView.appVersion, questView.gameEdition, questView.matches, questView.text], ['quest', 'pvp', 'owner', '0.6.0.34', 'launcher', 1, ''])
    // One player's reports share a pseudonym; another player has another.
    assert.equal(questView.reporter, bugView.reporter)
    assert.notEqual(ideaView.reporter, bugView.reporter)

    const all = await t.call<AgentPage>('GET', '/agent/requests?status=all', key)
    assert.deepEqual([all.json.total, all.json.reports.map((entry) => entry.id)], [4, [old, quest, idea, bug]])
    const closed = all.json.reports[0]!
    // An older app's version without the build, and a deleted account: no `client`, no `reporter`.
    assert.deepEqual(closed, { id: old, number: old, kind: 'bug', status: 'closed', createdAt: closed.createdAt, closedAt: closed.closedAt, title: 'Старый отчёт', text: 'Без версии', appVersion: '0.5.4', platform: 'Windows · desktop', images: 0 })
    assert.match(String(closed.closedAt), ISO)
    assert.deepEqual((await t.call<AgentPage>('GET', '/agent/requests?status=closed', key)).json.reports.map((entry) => entry.id), [old])
    assert.deepEqual((await t.call<AgentPage>('GET', '/agent/requests?status=all&limit=2&offset=1', key)).json.reports.map((entry) => entry.id), [quest, idea])
    for (const query of ['status=new', 'limit=0', 'limit=201', 'offset=-1', 'limit=x', 'status=open&status=closed']) {
      assert.equal((await t.call('GET', `/agent/requests?${query}`, key)).status, 400, query)
    }

    // Nothing personal in any answer: no e-mail, account id, granted days or mail state.
    const answers = JSON.stringify([open.json, all.json])
    for (const value of ['@example.com', 'почта.рф', ids.alice!, ids.bob!, ids.gone!, '"email"', '"accountId"', 'rewardDays', 'rewardedAt', 'mailedAt', 'mailError', 'nickname']) {
      assert.equal(answers.includes(value), false, value)
    }
  } finally {
    await t.close()
  }
})

test('the key downloads a report\'s images; 404 when there is none', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const player = await t.register('player@example.com')
    const id = await t.send(player, { ...report, screenshots: [shot(PNG), shot(JPEG)] })
    const key = await t.newKey(owner)
    const png = await t.call('GET', `/agent/requests/${id}/images/0`, key)
    assert.equal(png.status, 200)
    assert.deepEqual(png.bytes, PNG)
    assert.deepEqual(['content-type', 'cache-control', 'x-content-type-options'].map((name) => png.headers.get(name)), ['image/png', 'no-store', 'nosniff'])
    assert.match(png.headers.get('content-disposition') ?? '', new RegExp(`^inline; filename="request-${id}-1\\.png"$`))
    const jpeg = await t.call('GET', `/agent/requests/${id}/images/1`, key)
    assert.deepEqual([jpeg.status, jpeg.headers.get('content-type'), jpeg.bytes.equals(JPEG)], [200, 'image/jpeg', true])
    for (const path of [`/agent/requests/${id}/images/2`, `/agent/requests/${id}/images/9`, `/agent/requests/${id}/images/x`, '/agent/requests/999/images/0', '/agent/requests/0/images/0']) {
      assert.equal((await t.call('GET', path, key)).status, 404, path)
    }
    // A player's session is not the key.
    assert.equal((await t.call('GET', `/agent/requests/${id}/images/0`, player)).status, 401)
  } finally {
    await t.close()
  }
})

test('the key\'s limits: per key and per address (429 + Retry-After); a wrong key spends the address\'s budget', async () => {
  const perKey = await setup({ perKey: 3, perIp: 100 })
  try {
    const owner = await perKey.login('owner@example.com')
    const key = await perKey.newKey(owner)
    assert.equal((await perKey.call('GET', '/agent/requests', key)).status, 200)
    assert.equal((await perKey.call('GET', '/agent/requests?status=all', key)).status, 200)
    assert.equal((await perKey.call('GET', '/agent/requests/1/images/0', key)).status, 404, 'images count too')
    const limited = await perKey.call('GET', '/agent/requests', key)
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    // From another address as well: the budget is the key's.
    assert.equal((await perKey.call('GET', '/agent/requests', key, undefined, { 'x-forwarded-for': '203.0.113.9' })).status, 429)
    // A new key has a budget of its own.
    assert.equal((await perKey.call('GET', '/agent/requests', await perKey.newKey(owner))).status, 200)
  } finally {
    await perKey.close()
  }

  const perIp = await setup({ perKey: 100, perIp: 2 })
  try {
    const owner = await perIp.login('owner@example.com')
    const key = await perIp.newKey(owner)
    assert.equal((await perIp.call('GET', '/agent/requests', `rok_${'B'.repeat(43)}`)).status, 401)
    assert.equal((await perIp.call('GET', '/agent/requests', key)).status, 200)
    const limited = await perIp.call('GET', '/agent/requests', key)
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    // Another address has its own budget (an IPv6 /64 counts as one address).
    assert.equal((await perIp.call('GET', '/agent/requests', key, undefined, { 'x-forwarded-for': '2001:db8:aa:bb::1' })).status, 200)
    assert.equal((await perIp.call('GET', '/agent/requests', key, undefined, { 'x-forwarded-for': '2001:db8:aa:bb::2' })).status, 200)
    assert.equal((await perIp.call('GET', '/agent/requests', key, undefined, { 'x-forwarded-for': '2001:db8:aa:bb::3' })).status, 429)
  } finally {
    await perIp.close()
  }
})

test('the key store: only the hash, kept over a restart; lastUsedAt at most once a minute; pseudonyms stay', () => {
  let clock = Date.parse('2026-10-14T10:00:00Z')
  const db = openDatabase(':memory:')
  const store = new RequestsKeyStore(db, { now: () => clock })
  assert.deepEqual(store.status(), { active: false })
  assert.equal(store.verify(undefined), undefined)
  const { key, createdAt, replaced } = store.create()
  assert.equal(replaced, false)
  assert.ok(store.verify(key))
  assert.deepEqual(store.status(), { active: true, createdAt, lastUsedAt: createdAt })
  clock += 30_000
  assert.ok(store.verify(key))
  assert.equal(store.status().lastUsedAt, createdAt, 'not written again within a minute')
  clock += LAST_USED_STEP_MS
  assert.ok(store.verify(key))
  assert.equal(store.status().lastUsedAt, new Date(clock).toISOString())
  // Near misses: shorter, longer, another prefix, one character changed.
  const changed = `${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`
  for (const wrong of ['', key.slice(0, -1), `${key}x`, key.replace(/^rok_/, 'rok-'), changed, ` ${key}`]) assert.equal(store.verify(wrong), undefined)

  // A restart (a new store on the same database): the same key and the same pseudonyms.
  const account = '0123456789abcdef01234567'
  const pseudonym = store.pseudonym(account)
  assert.match(pseudonym, /^r-[0-9a-f]{12}$/)
  const restarted = new RequestsKeyStore(db, { now: () => clock })
  assert.ok(restarted.verify(key))
  assert.equal(restarted.pseudonym(account), pseudonym)
  assert.notEqual(restarted.pseudonym('0123456789abcdef01234568'), pseudonym)
  // Another server's database: other pseudonyms for the same account.
  assert.notEqual(new RequestsKeyStore(openDatabase(':memory:')).pseudonym(account), pseudonym)
  // A new key keeps the pseudonyms; revoking leaves nothing to verify.
  assert.equal(restarted.create().replaced, true)
  assert.equal(restarted.verify(key), undefined)
  assert.equal(restarted.pseudonym(account), pseudonym)
  assert.equal(restarted.revoke(), true)
  assert.equal(restarted.revoke(), false)
  assert.deepEqual(restarted.status(), { active: false })
})
