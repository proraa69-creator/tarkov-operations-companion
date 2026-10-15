import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { openDatabase } from '../services/database.js'
import { UserDataStore } from '../services/userDataStore.js'
import type { AppDataset } from '../models/api.js'

const password = 'correct horse battery'
const CHARACTER = '0123456789abcdef01234567'
const TASK_A = '5936d90786f7742b1420ba5b'
const TASK_B = '5936d90786f7742b1420ba5c'
const KAPPA_QUEST = '5936d90786f7742b1420ba5d'

const catalog = {
  quests: [
    { id: TASK_A, name: 'A', kappa: true },
    { id: KAPPA_QUEST, name: 'B', kappa: true },
    { id: 'collector', name: 'Коллекционер', kappa: true, raidRequirements: [{ itemId: 'axe', count: 1, purpose: 'handover', mapIds: [] }, { itemId: 'book', count: 1, purpose: 'handover', mapIds: [] }] },
  ],
  items: [{ id: 'axe', name: 'Топор', shortName: 'Топор' }, { id: 'book', name: 'Книга', shortName: 'Книга' }],
  maps: [], markers: [], hideout: [], traders: [],
} as unknown as AppDataset

async function withServer(run: (call: (method: string, path: string, body?: unknown, token?: string) => Promise<Response>) => Promise<void>) {
  const store = new ProgressStore(':memory:')
  const accounts = new AccountStore()
  const server = createApi(store, undefined, accounts, { catalog: (mode) => mode === 'pvp' ? catalog : undefined }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await run((method, path, body, token) => fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
    accounts.close()
  }
}

async function register(call: Parameters<Parameters<typeof withServer>[0]>[0], email: string) {
  const response = await call('POST', '/v1/accounts/register', { email, password, country: 'RU' })
  assert.equal(response.status, 201)
  return ((await response.json()) as { token: string }).token
}

test('/v1/me requires a session and validates input', async () => {
  await withServer(async (call) => {
    assert.equal((await call('GET', '/v1/me/summary')).status, 401)
    assert.equal((await call('GET', '/v1/me/progress/pvp', undefined, 'x'.repeat(43))).status, 401)
    const token = await register(call, 'a@example.com')
    assert.equal((await call('GET', '/v1/me/progress/arena', undefined, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/progress/pvp/events', { events: [{ taskId: 'nope', status: 'active', timestamp: '2026-09-25T10:00:00.000Z' }] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/progress/pvp/events', { events: [], extra: 1 }, token)).status, 400)
    assert.equal((await call('PUT', '/v1/me/collector/pvp', { itemIds: ['<script>'] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/position/pvp', { x: 'a', y: 0, z: 0, yaw: 0, at: 1 }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/position/pvp', { x: 1e9, y: 0, z: 0, yaw: 0, at: 1 }, token)).status, 400)
    assert.equal((await call('PUT', '/v1/me/settings', { settings: { blob: 'x'.repeat(20_000) } }, token)).status, 413)
    assert.equal((await call('PUT', '/v1/me/settings', ['x'], token)).status, 400)
  })
})

test('/v1/me stores progress, collector, position and settings per user and per mode', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'a@example.com')
    const other = await register(call, 'b@example.com')
    const events = { accountId: 100, characterId: CHARACTER, events: [
      { taskId: TASK_A, status: 'active', timestamp: '2026-09-25T10:00:00.000Z' },
      { taskId: TASK_A, status: 'completed', timestamp: '2026-09-25T11:00:00.000Z' },
      { taskId: TASK_B, status: 'active', timestamp: '2026-09-25T11:30:00.000Z' },
    ] }
    const first = await (await call('POST', '/v1/me/progress/pvp/events', events, token)).json() as { records: Array<{ taskId: string; status: string; source: string }>; scope: { characterId: string } }
    assert.deepEqual(first.records.map((record) => [record.taskId, record.status, record.source]), [[TASK_A, 'completed', 'eft-log'], [TASK_B, 'active', 'eft-log']])
    assert.equal(first.scope.characterId, CHARACTER)
    // Logs rotated: an empty batch for the same character still returns everything the server knows.
    const later = await (await call('POST', '/v1/me/progress/pvp/events', { events: [] }, token)).json() as { records: unknown[] }
    assert.equal(later.records.length, 2)
    const get = await (await call('GET', '/v1/me/progress/pvp', undefined, token)).json() as { records: unknown[] }
    assert.equal(get.records.length, 2)
    assert.equal(((await (await call('GET', '/v1/me/progress/pve', undefined, token)).json()) as { records: unknown[] }).records.length, 0)
    assert.equal(((await (await call('GET', '/v1/me/progress/pvp', undefined, other)).json()) as { records: unknown[] }).records.length, 0)
    // A reported profile reset drops older events of that character.
    const reset = await (await call('POST', '/v1/me/progress/pvp/events', { resetAt: '2026-09-25T11:15:00.000Z', events: [] }, token)).json() as { records: Array<{ taskId: string }> }
    assert.deepEqual(reset.records.map((record) => record.taskId), [TASK_B])
    await call('POST', '/v1/me/progress/pvp/events', { events: [{ taskId: TASK_A, status: 'completed', timestamp: '2026-09-25T12:00:00.000Z' }] }, token)

    const collector = await (await call('PUT', '/v1/me/collector/pvp', { itemIds: ['axe', 'axe'] }, token)).json() as { itemIds: string[] }
    assert.deepEqual(collector.itemIds, ['axe'])
    assert.deepEqual(((await (await call('GET', '/v1/me/collector/pve', undefined, token)).json()) as { itemIds: string[] }).itemIds, [])
    assert.deepEqual(((await (await call('GET', '/v1/me/collector/pvp', undefined, other)).json()) as { itemIds: string[] }).itemIds, [])

    assert.equal(((await (await call('GET', '/v1/me/position/pvp', undefined, token)).json()) as { position: unknown }).position, null)
    const at = Date.parse('2026-09-28T10:00:00.000Z')
    assert.equal((await call('POST', '/v1/me/position/pvp', { x: 1, y: 2, z: 3, yaw: 45, at, map: 'customs' }, token)).status, 201)
    assert.equal((await call('POST', '/v1/me/position/pvp', { x: 4, y: 5, z: 6, yaw: 90, at: at + 2000, map: 'customs' }, token)).status, 201)
    const position = await (await call('GET', '/v1/me/position/pvp', undefined, token)).json() as { position: { x: number; at: number } }
    assert.equal(position.position.x, 4, 'only the latest position is kept')
    assert.equal(((await (await call('GET', '/v1/me/position/pve', undefined, token)).json()) as { position: unknown }).position, null)

    const settings = await (await call('PUT', '/v1/me/settings', { settings: { theme: 'steel', overlay: { opacity: 0.8 } } }, token)).json() as { settings: unknown; updatedAt: string }
    assert.deepEqual(settings.settings, { theme: 'steel', overlay: { opacity: 0.8 } })
    assert.deepEqual(((await (await call('GET', '/v1/me/settings', undefined, token)).json()) as { settings: unknown }).settings, settings.settings)
    assert.deepEqual(((await (await call('GET', '/v1/me/settings', undefined, other)).json()) as { settings: unknown }).settings, {})

    const summary = await (await call('GET', '/v1/me/summary', undefined, token)).json() as { account: { email: string }; modes: Record<string, { quests: { completed: number; active: number }; kappa: { completed: number; total: number } | null; collector: { collected: number; total: number | null }; lastSyncAt: string | null; lastPosition: { map?: string } | null }> }
    assert.equal(summary.account.email, 'a@example.com')
    assert.deepEqual(summary.modes.pvp.quests, { completed: 1, active: 1, failed: 0 })
    assert.deepEqual(summary.modes.pvp.kappa, { completed: 1, total: 3 })
    assert.deepEqual(summary.modes.pvp.collector.collected, 1)
    assert.equal(summary.modes.pvp.collector.total, 2)
    assert.ok(summary.modes.pvp.lastSyncAt)
    assert.equal(summary.modes.pvp.lastPosition?.map, 'customs')
    assert.equal(summary.modes.pve.kappa, null, 'no catalog loaded for PvE yet')
    assert.equal(summary.modes.pve.lastSyncAt, null)
    assert.equal(summary.modes.seasonal.lastPosition, null)
    assert.ok(!JSON.stringify(summary).includes(password))
  })
})

const OBJ_A = '5936d90786f7742b1420ba60'
const OBJ_B = '5936d90786f7742b1420ba61'
type ObjectiveRow = { objectiveId: string; current: number; target: number; source: string; completedAt?: string }
type EventRow = { id: string; eventType: string; undoneAt?: string; refersTo?: string; oldValue: unknown; newValue: unknown; source: string }
type Snapshot = { objectives: ObjectiveRow[]; events: EventRow[]; updatedAt: string | null }

const objective = (objectiveId: string, current: number, source: string, observedAt: string, target = 5) =>
  ({ objectiveId, taskId: TASK_A, type: 'shoot', target, current, source, confidence: source === 'manual' ? 1 : 0.7, observedAt })
const event = (id: string, objectiveId: string, oldValue: number | null, newValue: number, source: string, observedAt: string) =>
  ({ id, taskId: TASK_A, objectiveId, eventType: 'objective', oldValue, newValue, source, confidence: 0.7, observedAt, reversible: source !== 'manual' })

test('/v1/me/progress keeps the latest trusted reset with the character scope', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'reset@example.com')
    type Answer = { records: Array<{ taskId: string }>; scope: { characterId: string; resetAt?: string } | null }
    const post = async (body: unknown) => await (await call('POST', '/v1/me/progress/pvp/events', body, token)).json() as Answer
    const old = [
      { taskId: TASK_A, status: 'active', timestamp: '2026-09-25T10:00:00.000Z' },
      { taskId: TASK_A, status: 'completed', timestamp: '2026-09-25T11:00:00.000Z' },
    ]
    assert.equal((await post({ accountId: 100, characterId: CHARACTER, events: old })).scope?.resetAt, undefined)
    // A prestige seen by one PC: older events go, and the scope keeps the reset for the phone and the other PCs.
    const reset = await post({ characterId: CHARACTER, resetAt: '2026-09-25T11:30:00.000Z', events: [{ taskId: TASK_B, status: 'active', timestamp: '2026-09-25T11:40:00.000Z' }] })
    assert.deepEqual(reset.records.map((record) => record.taskId), [TASK_B])
    assert.equal(reset.scope?.resetAt, '2026-09-25T11:30:00.000Z')
    // Another PC whose logs never showed the reset sends the old events again: they are not stored again.
    const stale = await post({ characterId: CHARACTER, events: old })
    assert.deepEqual(stale.records.map((record) => record.taskId), [TASK_B])
    assert.equal(stale.scope?.resetAt, '2026-09-25T11:30:00.000Z')
    // An older reset never moves it back; the phone reads it with the records.
    assert.equal((await post({ characterId: CHARACTER, resetAt: '2026-09-25T09:00:00.000Z', events: [] })).scope?.resetAt, '2026-09-25T11:30:00.000Z')
    const get = await (await call('GET', '/v1/me/progress/pvp', undefined, token)).json() as Answer
    assert.equal(get.scope?.resetAt, '2026-09-25T11:30:00.000Z')
    // A clock far ahead is held to the server's time.
    const future = await post({ characterId: CHARACTER, resetAt: '2099-01-01T00:00:00.000Z', events: [] })
    assert.ok(future.scope?.resetAt && Date.parse(future.scope.resetAt) <= Date.now() + 61_000)
    // A new character (after a wipe) starts without a reset.
    const wiped = await post({ characterId: 'fedcba9876543210fedcba98', events: [] })
    assert.equal(wiped.scope?.characterId, 'fedcba9876543210fedcba98')
    assert.equal(wiped.scope?.resetAt, undefined)
  })
})

test('POST /v1/me/progress/:mode/reset («Престиж +», «Вайп», «Сброс») wipes one mode of one account, keeps no floor', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'prestige@example.com')
    const other = await register(call, 'other-prestige@example.com')
    type Answer = { records: Array<{ taskId: string }>; scope: { characterId: string; resetAt?: string } | null }
    const before = [
      { taskId: TASK_A, status: 'active', timestamp: '2026-09-25T10:00:00.000Z' },
      { taskId: TASK_A, status: 'completed', timestamp: '2026-09-25T11:00:00.000Z' },
    ]
    // Authenticated, per mode, strict body.
    assert.equal((await call('POST', '/v1/me/progress/pve/reset', {})).status, 401)
    assert.equal((await call('POST', '/v1/me/progress/arena/reset', {}, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/progress/pve/reset', { at: 'yesterday' }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/progress/pve/reset', { mode: 'pvp' }, token)).status, 400)

    for (const raidMode of ['pvp', 'pve', 'seasonal']) {
      await call('POST', `/v1/me/progress/${raidMode}/events`, { accountId: 100, characterId: CHARACTER, events: before }, token)
      await call('POST', `/v1/me/story/${raidMode}`, { characterId: CHARACTER, records: [{ chapterId: 'tour', status: 'active', updatedAt: '2026-09-25T11:00:00.000Z' }] }, token)
      await call('PUT', `/v1/me/collector/${raidMode}`, { itemIds: ['axe'] }, token)
    }
    await call('POST', '/v1/me/progress/pve/events', { accountId: 100, characterId: CHARACTER, events: before }, other)
    await call('PUT', '/v1/me/levels', { modes: { pve: { level: 42, prestige: 1, observedAt: '2026-09-25T11:00:00.000Z' }, pvp: { level: 30, prestige: 0, observedAt: '2026-09-25T11:00:00.000Z' } } }, token)
    await call('POST', '/v1/me/objectives/pve/sync', { objectives: [objective(OBJ_A, 2, 'log', '2026-09-25T11:00:00.000Z')], events: [] }, token)

    // Pressed now: everything above is older (the Collector list too).
    const pressed = Date.now()
    const reset = await (await call('POST', '/v1/me/progress/pve/reset', {}, token)).json() as { resetAt: string; scope: Answer['scope'] }
    const AT = reset.resetAt
    assert.ok(Math.abs(Date.parse(AT) - pressed) < 5_000)
    // No floor at the press (owner, 15.10.2026): the scope carries none.
    assert.equal(reset.scope?.resetAt, undefined)

    // PvE of this account: wiped.
    const pve = await (await call('GET', '/v1/me/progress/pve', undefined, token)).json() as Answer
    assert.deepEqual(pve.records, [])
    assert.equal(pve.scope?.resetAt, undefined)
    assert.deepEqual(((await (await call('GET', '/v1/me/story/pve', undefined, token)).json()) as { records: unknown[] }).records, [])
    assert.deepEqual(((await (await call('GET', '/v1/me/collector/pve', undefined, token)).json()) as { itemIds: string[] }).itemIds, [])
    assert.deepEqual(((await (await call('GET', '/v1/me/objectives/pve', undefined, token)).json()) as Snapshot).objectives, [])
    // PvP and Season of this account, and PvE of another account: untouched.
    for (const raidMode of ['pvp', 'seasonal']) {
      const kept = await (await call('GET', `/v1/me/progress/${raidMode}`, undefined, token)).json() as Answer
      assert.deepEqual(kept.records.map((record) => record.taskId), [TASK_A], raidMode)
      assert.equal(kept.scope?.resetAt, undefined, raidMode)
      assert.equal(((await (await call('GET', `/v1/me/story/${raidMode}`, undefined, token)).json()) as { records: unknown[] }).records.length, 1, raidMode)
      assert.deepEqual(((await (await call('GET', `/v1/me/collector/${raidMode}`, undefined, token)).json()) as { itemIds: string[] }).itemIds, ['axe'], raidMode)
    }
    assert.equal(((await (await call('GET', '/v1/me/progress/pve', undefined, other)).json()) as Answer).records.length, 1)

    // The app rebuilds the mode from every log and sends it all again: the older events are stored again.
    const rebuilt = await (await call('POST', '/v1/me/progress/pve/events', { characterId: CHARACTER, events: [...before, { taskId: TASK_B, status: 'active', timestamp: new Date(pressed + 10_000).toISOString() }] }, token)).json() as Answer
    assert.deepEqual(rebuilt.records.map((record) => record.taskId).sort(), [TASK_A, TASK_B].sort())
    // The game's own reset, as the logs prove it, is still the floor.
    const proven = await (await call('POST', '/v1/me/progress/pve/events', { characterId: CHARACTER, resetAt: '2026-09-25T10:30:00.000Z', events: before }, token)).json() as Answer
    assert.equal(proven.scope?.resetAt, '2026-09-25T10:30:00.000Z')
    assert.deepEqual(proven.records.map((record) => record.taskId).sort(), [TASK_A, TASK_B].sort())
    const story = await (await call('POST', '/v1/me/story/pve', { characterId: CHARACTER, records: [{ chapterId: 'tour', status: 'active', updatedAt: '2026-09-25T11:00:00.000Z' }] }, token)).json() as { records: unknown[] }
    assert.equal(story.records.length, 1)

    // The shared level of the mode went with the reset.
    const friendLevels = await (await call('PUT', '/v1/me/levels', { modes: {} }, token)).json() as { modes: Record<string, unknown> }
    assert.equal(friendLevels.modes.pve, undefined)
    assert.ok(friendLevels.modes.pvp)
    // A clock far ahead is held to the server's time.
    const future = await (await call('POST', '/v1/me/progress/seasonal/reset', { at: '2099-01-01T00:00:00.000Z' }, token)).json() as { resetAt: string }
    assert.ok(Date.parse(future.resetAt) <= Date.now() + 61_000)
  })
})

test('0.6.0.41 kept a reset press as the mode\'s floor: it goes, a proven reset of the logs stays', () => {
  const db = new DatabaseSync(':memory:')
  const first = new ProgressStore(db)
  first.syncUser('user:1', 'pvp', { accountId: 5, characterId: CHARACTER, resetAt: '2026-10-15T08:00:00.000Z', events: [] })
  first.syncUser('user:1', 'pve', { accountId: 5, characterId: CHARACTER, resetAt: '2026-10-01T08:00:00.000Z', events: [] })
  db.exec(`INSERT INTO mode_resets VALUES ('user:1', 'pvp', '2026-10-15T08:00:00.000Z'), ('user:1', 'pve', '2026-10-15T09:00:00.000Z')`)
  const store = new ProgressStore(db)
  assert.equal(store.scope('user:1', 'pvp')?.resetAt, undefined)
  assert.equal(store.scope('user:1', 'pve')?.resetAt, '2026-10-01T08:00:00.000Z')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mode_resets').get() as { n: number }).n, 0)
  // The old events come in again.
  const answer = store.syncUser('user:1', 'pvp', { characterId: CHARACTER, events: [{ taskId: TASK_A, status: 'active', timestamp: '2026-10-10T08:00:00.000Z' }] })
  assert.deepEqual(answer.records.map((record) => record.taskId), [TASK_A])
  db.close()
})

test('a progress database from before the reset column gets it', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE progress_scopes (owner TEXT NOT NULL, mode TEXT NOT NULL, account_id INTEGER NOT NULL, character_id TEXT NOT NULL,
    synced_at TEXT NOT NULL, PRIMARY KEY(owner, mode));
    INSERT INTO progress_scopes VALUES ('user:1', 'pvp', 5, '${CHARACTER}', '2026-09-25T12:00:00.000Z');`)
  const store = new ProgressStore(db)
  assert.deepEqual(store.scope('user:1', 'pvp'), { accountId: 5, characterId: CHARACTER, syncedAt: '2026-09-25T12:00:00.000Z' })
  store.syncUser('user:1', 'pvp', { resetAt: '2026-09-25T11:00:00.000Z', events: [] })
  assert.equal(store.scope('user:1', 'pvp')?.resetAt, '2026-09-25T11:00:00.000Z')
  db.close()
})

test('/v1/me/story keeps each character\'s chapters, the newest reading of each, and starts over at a reset', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'story@example.com')
    const other = await register(call, 'story-other@example.com')
    type Answer = { characterId: string | null; records: Array<{ chapterId: string; status: string; stageId?: string; updatedAt: string }> }
    const post = async (body: unknown, as = token) => await (await call('POST', '/v1/me/story/pvp', body, as)).json() as Answer
    // No character known yet (nothing synced for the mode): nothing is kept.
    assert.deepEqual(await post({ records: [{ chapterId: 'story-tour', status: 'active', stageId: 'story-tour-2', updatedAt: '2026-10-01T10:00:00.000Z' }] }), { characterId: null, records: [] })
    assert.equal((await call('POST', '/v1/me/story/pvp', { records: [{ chapterId: '<b>', status: 'active', updatedAt: '2026-10-01T10:00:00.000Z' }] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/story/pvp', { records: [{ chapterId: 'story-tour', status: 'failed', updatedAt: '2026-10-01T10:00:00.000Z' }] }, token)).status, 400)

    await call('POST', '/v1/me/progress/pvp/events', { characterId: CHARACTER, events: [] }, token)
    const first = await post({ records: [{ chapterId: 'story-tour', status: 'active', stageId: 'story-tour-2', updatedAt: '2026-10-01T10:00:00.000Z' }] })
    assert.deepEqual(first, { characterId: CHARACTER, records: [{ chapterId: 'story-tour', status: 'active', stageId: 'story-tour-2', updatedAt: '2026-10-01T10:00:00.000Z' }] })
    // An older reading from another PC does not win; a newer one does.
    await post({ characterId: CHARACTER, records: [{ chapterId: 'story-tour', status: 'active', stageId: 'story-tour-1', updatedAt: '2026-10-01T09:00:00.000Z' }] })
    const newer = await post({ characterId: CHARACTER, records: [{ chapterId: 'story-tour', status: 'completed', updatedAt: '2026-10-02T10:00:00.000Z' }, { chapterId: 'story-batya', status: 'active', stageId: 'story-batya-0', updatedAt: '2026-10-02T10:00:00.000Z' }] })
    assert.deepEqual(newer.records.map((record) => [record.chapterId, record.status, record.stageId ?? null]), [['story-batya', 'active', 'story-batya-0'], ['story-tour', 'completed', null]])
    // The phone reads them for the character synced last; another account sees none; another character has none.
    const read = await (await call('GET', '/v1/me/story/pvp', undefined, token)).json() as Answer
    assert.equal(read.records.length, 2)
    assert.equal(((await (await call('GET', '/v1/me/story/pvp', undefined, other)).json()) as Answer).records.length, 0)
    assert.equal(((await (await call('GET', '/v1/me/story/pve', undefined, token)).json()) as Answer).records.length, 0)
    assert.equal(((await (await call('GET', '/v1/me/story/pvp?characterId=fedcba9876543210fedcba98', undefined, token)).json()) as Answer).records.length, 0)
    assert.equal((await call('GET', '/v1/me/story/pvp?characterId=nope', undefined, token)).status, 400)
    // A trusted reset (a prestige): the chapters read before it go, readings from before it are refused.
    await call('POST', '/v1/me/progress/pvp/events', { characterId: CHARACTER, resetAt: '2026-10-02T12:00:00.000Z', events: [] }, token)
    const reset = await post({ characterId: CHARACTER, records: [{ chapterId: 'story-tour', status: 'active', stageId: 'story-tour-5', updatedAt: '2026-10-02T11:00:00.000Z' }] })
    assert.deepEqual(reset.records, [])
  })
})

test('/v1/me/progress/:mode/manual («Ручная отметка»): newest per quest, against the logs by the engine, gone with a reset', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'manual@example.com')
    type Marks = { marks: Array<{ taskId: string; status: string; at: string }> }
    const post = async (marks: unknown[], mode = 'pvp') => await (await call('POST', `/v1/me/progress/${mode}/manual`, { marks }, token)).json() as Marks
    assert.equal((await call('POST', '/v1/me/progress/pvp/manual', { marks: [{ taskId: TASK_A, status: 'failed', at: '2026-10-01T10:00:00.000Z' }] }, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/progress/pvp/manual', { marks: [{ taskId: '<b>', status: 'active', at: '2026-10-01T10:00:00.000Z' }] }, token)).status, 400)
    // The logs: TASK_A taken at 09:00, TASK_B taken at 12:00.
    await call('POST', '/v1/me/progress/pvp/events', { accountId: 1, characterId: CHARACTER, events: [
      { taskId: TASK_A, status: 'active', timestamp: '2026-10-01T09:00:00.000Z' }, { taskId: TASK_B, status: 'active', timestamp: '2026-10-01T12:00:00.000Z' },
    ] }, token)
    // Marked done at 10:00 on one device: A beats its older log event, B's newer log event beats the mark.
    const first = await post([{ taskId: TASK_A, status: 'completed', at: '2026-10-01T10:00:00.000Z' }, { taskId: TASK_B, status: 'completed', at: '2026-10-01T10:00:00.000Z' }])
    assert.equal(first.marks.length, 2)
    // An older mark from another device does not replace the newer one; «Снять отметку» later does.
    await post([{ taskId: TASK_A, status: 'active', at: '2026-10-01T09:30:00.000Z' }])
    const kept = await (await call('GET', '/v1/me/progress/pvp/manual', undefined, token)).json() as Marks
    assert.deepEqual(kept.marks.find((mark) => mark.taskId === TASK_A), { taskId: TASK_A, status: 'completed', at: '2026-10-01T10:00:00.000Z' })
    const summary = await (await call('GET', '/v1/me/summary', undefined, token)).json() as { modes: { pvp: { quests: Record<string, number>; kappa: { completed: number } } } }
    assert.deepEqual(summary.modes.pvp.quests, { completed: 1, active: 1, failed: 0 })
    assert.equal(summary.modes.pvp.kappa.completed, 1)
    await post([{ taskId: TASK_A, status: 'cleared', at: '2026-10-01T11:00:00.000Z' }])
    const cleared = await (await call('GET', '/v1/me/summary', undefined, token)).json() as typeof summary
    assert.deepEqual(cleared.modes.pvp.quests, { completed: 0, active: 2, failed: 0 })
    // Other modes are not touched; «Престиж +» / «Вайп» / «Сброс» remove the mode's marks.
    assert.equal((await (await call('GET', '/v1/me/progress/pve/manual', undefined, token)).json() as Marks).marks.length, 0)
    await call('POST', '/v1/me/progress/pvp/reset', { at: '2026-10-01T13:00:00.000Z' }, token)
    assert.equal((await (await call('GET', '/v1/me/progress/pvp/manual', undefined, token)).json() as Marks).marks.length, 0)
    assert.equal((await post([{ taskId: TASK_A, status: 'completed', at: '2026-10-01T13:30:00.000Z' }])).marks.length, 1)
  })
})

test('/v1/me/objectives validates input and limits sizes', async () => {
  await withServer(async (call) => {
    assert.equal((await call('GET', '/v1/me/objectives/pvp')).status, 401)
    const token = await register(call, 'a@example.com')
    assert.equal((await call('GET', '/v1/me/objectives/arena', undefined, token)).status, 400)
    const sync = (body: unknown) => call('POST', '/v1/me/objectives/pvp/sync', body, token)
    assert.equal((await sync({ objectives: [], events: [], extra: 1 })).status, 400)
    assert.equal((await sync({ objectives: [{ ...objective(OBJ_A, 1, 'manual', '2026-09-25T10:00:00.000Z'), source: 'admin' }], events: [] })).status, 400)
    assert.equal((await sync({ objectives: [{ ...objective(OBJ_A, 1, 'manual', '2026-09-25T10:00:00.000Z'), objectiveId: '<script>' }], events: [] })).status, 400)
    assert.equal((await sync({ objectives: [objective(OBJ_A, -1, 'manual', '2026-09-25T10:00:00.000Z')], events: [] })).status, 400)
    assert.equal((await sync({ objectives: [], events: [{ ...event('ev-1abcdef', OBJ_A, 0, 1, 'ocr', '2026-09-25T10:00:00.000Z'), id: '../../x' }] })).status, 400)
    const tooMany = Array.from({ length: 2001 }, (_, index) => objective(`obj-${index}`, 0, 'manual', '2026-09-25T10:00:00.000Z'))
    assert.equal((await sync({ objectives: tooMany, events: [] })).status, 400)
    // The per-account cap (5000 objectives per mode) answers 413.
    for (let batch = 0; batch < 2; batch += 1) {
      const rows = Array.from({ length: 2000 }, (_, index) => objective(`obj-${batch}-${index}`, 0, 'manual', '2026-09-25T10:00:00.000Z'))
      assert.equal((await sync({ objectives: rows, events: [] })).status, 200)
    }
    const overflow = Array.from({ length: 1001 }, (_, index) => objective(`obj-2-${index}`, 0, 'manual', '2026-09-25T10:00:00.000Z'))
    assert.equal((await sync({ objectives: overflow, events: [] })).status, 413)
    const stored = await (await call('GET', '/v1/me/objectives/pvp', undefined, token)).json() as Snapshot
    assert.equal(stored.objectives.length, 4000, 'a rejected batch is not stored partly')
  })
})

test('/v1/me/objectives merges per user and mode with the conflict rules', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'a@example.com')
    const other = await register(call, 'b@example.com')
    const sync = (body: unknown, who = token) => call('POST', '/v1/me/objectives/pvp/sync', body, who).then((response) => response.json() as Promise<Snapshot>)
    const row = (snapshot: Snapshot, id: string) => snapshot.objectives.find((entry) => entry.objectiveId === id)

    const first = await sync({
      objectives: [objective(OBJ_A, 3, 'ocr', '2026-09-25T10:00:00.000Z'), objective(OBJ_B, 1, 'manual', '2026-09-25T10:00:00.000Z', 1)],
      events: [event('ev-ocr-0001', OBJ_A, null, 3, 'ocr', '2026-09-25T10:00:00.000Z')],
    })
    assert.deepEqual(first.objectives.map((entry) => [entry.objectiveId, entry.current, entry.source]), [[OBJ_A, 3, 'ocr'], [OBJ_B, 1, 'manual']])
    assert.ok(row(first, OBJ_B)?.completedAt, 'done objectives carry completedAt')
    assert.equal(first.events.length, 1)

    // Newer automatic beats older automatic; older automatic is ignored.
    await sync({ objectives: [objective(OBJ_A, 4, 'ocr', '2026-09-25T11:00:00.000Z')], events: [] })
    const stale = await sync({ objectives: [objective(OBJ_A, 1, 'log', '2026-09-25T09:00:00.000Z')], events: [] })
    assert.equal(row(stale, OBJ_A)?.current, 4)
    // Manual beats automatic even when older; automatic (even a log completion) never overwrites manual on the server.
    await sync({ objectives: [objective(OBJ_A, 2, 'manual', '2026-09-25T08:00:00.000Z')], events: [] })
    const kept = await sync({ objectives: [objective(OBJ_A, 5, 'log', '2026-09-25T12:00:00.000Z')], events: [] })
    assert.equal(row(kept, OBJ_A)?.current, 2)
    assert.equal(row(kept, OBJ_A)?.source, 'manual')

    // A client clock far in the future is clamped.
    const future = await sync({ objectives: [objective(OBJ_B, 0, 'manual', '2099-01-01T00:00:00.000Z', 1)], events: [] })
    assert.ok(!JSON.stringify(future).includes('2099'))

    // Per mode and per account.
    assert.equal((await (await call('GET', '/v1/me/objectives/pve', undefined, token)).json() as Snapshot).objectives.length, 0)
    assert.equal((await (await call('GET', '/v1/me/objectives/pvp', undefined, other)).json() as Snapshot).objectives.length, 0)
    // Another account using the same event id stores its own copy.
    const theirs = await sync({ objectives: [], events: [event('ev-ocr-0001', OBJ_A, null, 9, 'ocr', '2026-09-25T10:00:00.000Z')] }, other)
    assert.equal(theirs.events[0].newValue, 9)
    const mine = await (await call('GET', '/v1/me/objectives/pvp', undefined, token)).json() as Snapshot
    assert.equal(mine.events.find((entry) => entry.id === 'ev-ocr-0001')?.newValue, 3)
  })
})

test('/v1/me/objectives undo restores the old value and answers 404 for another account (IDOR)', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'a@example.com')
    const other = await register(call, 'b@example.com')
    await call('POST', '/v1/me/objectives/pvp/sync', {
      objectives: [objective(OBJ_A, 4, 'ocr', '2026-09-25T10:00:00.000Z')],
      events: [event('ev-ocr-0002', OBJ_A, 1, 4, 'ocr', '2026-09-25T10:00:00.000Z'), { ...event('ev-man-0001', OBJ_B, 0, 1, 'manual', '2026-09-25T09:00:00.000Z'), reversible: false }],
    }, token)
    assert.equal((await call('POST', '/v1/me/objectives/pvp/events/ev-ocr-0002/undo', undefined, other)).status, 404)
    assert.equal((await call('POST', '/v1/me/objectives/pve/events/ev-ocr-0002/undo', undefined, token)).status, 404, 'events are per mode')
    assert.equal((await call('POST', '/v1/me/objectives/pvp/events/nope!/undo', undefined, token)).status, 400)
    assert.equal((await call('POST', '/v1/me/objectives/pvp/events/ev-man-0001/undo', undefined, token)).status, 409, 'manual changes are not undone')
    const undone = await call('POST', '/v1/me/objectives/pvp/events/ev-ocr-0002/undo', undefined, token)
    assert.equal(undone.status, 200)
    const snapshot = await undone.json() as Snapshot
    assert.deepEqual(snapshot.objectives.map((entry) => [entry.current, entry.source]), [[1, 'manual']])
    assert.ok(snapshot.events.find((entry) => entry.id === 'ev-ocr-0002')?.undoneAt)
    assert.equal(snapshot.events.find((entry) => entry.eventType === 'undo')?.refersTo, 'ev-ocr-0002')
    assert.equal((await call('POST', '/v1/me/objectives/pvp/events/ev-ocr-0002/undo', undefined, token)).status, 409, 'undone once')
    const untouched = await (await call('GET', '/v1/me/objectives/pvp', undefined, other)).json() as Snapshot
    assert.equal(untouched.events.length, 0)
  })
})

const level = (value: number, prestige: number | null, observedAt: string) => ({ level: value, prestige, observedAt })
type LevelsAnswer = { modes: Record<string, { level: number; prestige: number | null; observedAt: string; receivedAt: string }> }

test('PUT /v1/me/levels needs a session and refuses what no game shows', async () => {
  await withServer(async (call) => {
    const ok = { modes: { pvp: level(42, 2, '2026-10-13T18:00:00.000Z') } }
    assert.equal((await call('PUT', '/v1/me/levels', ok)).status, 401)
    assert.equal((await call('PUT', '/v1/me/levels', ok, 'x'.repeat(43))).status, 401)
    const token = await register(call, 'a@example.com')
    const refused: unknown[] = [
      { modes: { pvp: level(0, 0, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: level(80, 0, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: level(12.5, 0, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: level(12, 11, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: level(12, -1, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: level(12, 1.5, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: { level: 12, observedAt: '2026-10-13T18:00:00.000Z' } } },
      { modes: { pvp: level(12, 0, 'yesterday') } },
      { modes: { pvp: { ...level(12, 0, '2026-10-13T18:00:00.000Z'), accountId: 7690289 } } },
      { modes: { arena: level(12, 0, '2026-10-13T18:00:00.000Z') } },
      { modes: { pvp: level(12, 0, '2026-10-13T18:00:00.000Z') }, email: 'a@example.com' },
      { pvp: level(12, 0, '2026-10-13T18:00:00.000Z') },
      [ok],
    ]
    for (const body of refused) assert.equal((await call('PUT', '/v1/me/levels', body, token)).status, 400, JSON.stringify(body))
    assert.deepEqual((await (await call('PUT', '/v1/me/levels', { modes: {} }, token)).json()), { modes: {} }, 'nothing refused was stored')
    // The game's bounds themselves: level 1 and 79, prestige 0 and 10, an unknown prestige.
    const edges = await (await call('PUT', '/v1/me/levels', { modes: { pvp: level(1, 0, '2026-10-13T18:00:00.000Z'), pve: level(79, 10, '2026-10-13T18:00:00.000Z'), seasonal: level(5, null, '2026-10-13T18:00:00.000Z') } }, token)).json() as LevelsAnswer
    assert.deepEqual(Object.fromEntries(Object.entries(edges.modes).map(([mode, entry]) => [mode, [entry.level, entry.prestige]])), { pvp: [1, 0], pve: [79, 10], seasonal: [5, null] })
  })
})

test('PUT /v1/me/levels keeps each mode per account: a mode sent replaces it, the others stay', async () => {
  await withServer(async (call) => {
    const token = await register(call, 'a@example.com')
    const other = await register(call, 'b@example.com')
    const put = async (modes: unknown, who = token) => {
      const response = await call('PUT', '/v1/me/levels', { modes }, who)
      assert.equal(response.status, 200)
      return (await response.json()) as LevelsAnswer
    }
    const first = await put({ pvp: level(59, null, '2026-10-13T18:00:00.000Z'), pve: level(17, 1, '2026-10-12T09:00:00Z') })
    assert.deepEqual([first.modes.pvp?.level, first.modes.pvp?.prestige, first.modes.pvp?.observedAt], [59, null, '2026-10-13T18:00:00.000Z'])
    assert.equal(first.modes.pve?.observedAt, '2026-10-12T09:00:00.000Z')
    assert.ok(Date.parse(first.modes.pve!.receivedAt) > 0)
    assert.equal(first.modes.seasonal, undefined)
    // A misread «59» corrected by Tarkov.dev's older but right 39: the app's word replaces the mode, older or not.
    const second = await put({ pvp: level(39, 2, '2026-10-11T10:00:00.000Z') })
    assert.deepEqual([second.modes.pvp?.level, second.modes.pvp?.prestige, second.modes.pvp?.observedAt], [39, 2, '2026-10-11T10:00:00.000Z'])
    assert.equal(second.modes.pve?.level, 17, 'a mode not sent stays')
    // A PC clock running ahead: never «updated» in the future.
    const before = Date.now()
    const future = await put({ seasonal: level(8, null, '2099-01-01T00:00:00.000Z') })
    const seasonal = Date.parse(future.modes.seasonal!.observedAt)
    assert.ok(seasonal >= before - 1000 && seasonal <= Date.now(), future.modes.seasonal!.observedAt)
    // Another account has its own.
    assert.deepEqual(await put({}, other), { modes: {} })
  })
})

test('shared levels live in the per-user documents and go with «Удалить аккаунт»', async () => {
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db })
  const userData = new UserDataStore(db)
  try {
    const gone = accounts.authenticate((await accounts.register('gone@example.com', password)).token)!
    const stays = accounts.authenticate((await accounts.register('stays@example.com', password)).token)!
    userData.setLevels(gone, { pvp: { level: 30, prestige: null, observedAt: '2026-10-13T18:00:00.000Z' } })
    userData.setLevels(stays, { pve: { level: 12, prestige: 0, observedAt: '2026-10-13T18:00:00.000Z' } })
    assert.deepEqual(Object.keys(userData.getLevels(gone)), ['pvp'])
    assert.equal(userData.getLevels(gone).pvp?.prestige, null)
    // The same database opened again (a restart) still has them.
    assert.equal(new UserDataStore(db).getLevels(stays).pve?.level, 12)
    accounts.deleteAccount(gone)
    assert.deepEqual(userData.getLevels(gone), {})
    assert.equal(userData.getLevels(stays).pve?.level, 12)
  } finally {
    accounts.close()
  }
})
