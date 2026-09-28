import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { ProgressStore } from '../services/progressStore.js'
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
  const response = await call('POST', '/v1/accounts/register', { email, password })
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
