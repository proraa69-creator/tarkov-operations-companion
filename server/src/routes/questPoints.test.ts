import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { QuestPointStore } from '../services/questPointStore.js'

const password = 'correct horse battery'

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  return { call, login, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

interface Override { id: string; questId: string; markerId?: string; kind: string; x: number; z: number; floor?: string; note?: string; updatedBy?: string; stageIndex?: number }

const moved = { questId: '5936d90786f7742b1420ba5b', markerId: 'quest-zone-5936d90786f7742b1420ba5b-place_debut', mapId: 'customs', x: 120.5, z: -40, kind: 'move', note: 'по баг-репорту' }

test('quest points: the owner moves, hides, adds and resets; everybody reads; players cannot write', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.deepEqual((await call('GET', '/quest-points')).json, { overrides: [] })

    const path = '/accounts/me/admin/quest-points'
    assert.equal((await call('PUT', path, undefined, moved)).status, 401)
    assert.equal((await call('PUT', path, player, moved)).status, 404)
    assert.equal((await call('GET', path, player)).status, 404)
    assert.equal((await call('PUT', path, owner, { ...moved, x: 'far' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...moved, mapId: '../etc' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...moved, kind: 'teleport' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...moved, markerId: undefined })).status, 400)

    const first = await call<{ override: Override }>('PUT', path, owner, moved)
    assert.equal(first.status, 200)
    assert.match(first.json.override.id, /^[a-f0-9]{24}$/)
    assert.equal(first.json.override.note, 'по баг-репорту')
    // The same point again: one correction per point, updated in place.
    const again = await call<{ override: Override; overrides: Override[] }>('PUT', path, owner, { ...moved, x: 130, floor: 'Второй этаж' })
    assert.equal(again.json.override.id, first.json.override.id)
    assert.equal(again.json.overrides.length, 1)
    assert.deepEqual([again.json.override.x, again.json.override.floor], [130, 'Второй этаж'])

    // Players see the point, but not who changed it nor the owner's note.
    const listed = await call<{ overrides: Override[] }>('GET', '/quest-points')
    assert.equal(listed.json.overrides.length, 1)
    assert.equal(listed.json.overrides[0].x, 130)
    assert.equal(listed.json.overrides[0].updatedBy, undefined)
    assert.equal(listed.json.overrides[0].note, undefined)
    const full = await call<{ overrides: Override[] }>('GET', path, owner)
    assert.equal(full.json.overrides[0].updatedBy, 'owner@example.com')

    // Hide replaces the move of the same point.
    const hidden = await call<{ override: Override; overrides: Override[] }>('PUT', path, owner, { ...moved, kind: 'hide' })
    assert.equal(hidden.json.override.id, first.json.override.id)
    assert.equal(hidden.json.override.kind, 'hide')

    // An extra point of a story stage; moving it later goes by its id.
    const added = await call<{ override: Override }>('PUT', path, owner, { questId: 'story-tour', mapId: 'streets-of-tarkov', stageIndex: 2, x: 1, z: 2, kind: 'add' })
    assert.equal(added.json.override.kind, 'add')
    assert.equal(added.json.override.markerId, undefined)
    assert.equal(added.json.override.stageIndex, 2)
    const dragged = await call<{ override: Override; overrides: Override[] }>('PUT', path, owner, { id: added.json.override.id, questId: 'story-tour', mapId: 'streets-of-tarkov', stageIndex: 2, x: 5, z: 6, kind: 'add' })
    assert.equal(dragged.json.override.id, added.json.override.id)
    assert.equal(dragged.json.overrides.length, 2)
    assert.equal((await call('PUT', path, owner, { id: 'a'.repeat(24), questId: 'q', mapId: 'customs', x: 0, z: 0, kind: 'add' })).status, 404)

    assert.equal((await call('POST', `${path}/${first.json.override.id}/remove`, player)).status, 404)
    const reset = await call<{ overrides: Override[] }>('POST', `${path}/${first.json.override.id}/remove`, owner)
    assert.equal(reset.status, 200)
    assert.deepEqual(reset.json.overrides.map((entry) => entry.id), [added.json.override.id])
    assert.equal((await call('POST', `${path}/${first.json.override.id}/remove`, owner)).status, 404)
    assert.equal((await call('POST', `${path}/${added.json.override.id}/remove`, owner)).status, 200)

    const audit = await call<{ entries: Array<{ action: string }> }>('GET', '/accounts/me/admin/audit', owner)
    assert.equal(audit.json.entries.filter((entry) => entry.action === 'map.quest-point').length, 7)
  } finally {
    await close()
  }
})

test('quest point store: an update by id that targets another point takes over its correction', () => {
  const store = new QuestPointStore(openDatabase(':memory:'))
  const a = store.save({ questId: 'q', markerId: 'm-a', mapId: 'customs', x: 0, z: 0, kind: 'move' }, 'owner')
  const b = store.save({ questId: 'q', markerId: 'm-b', mapId: 'customs', x: 0, z: 0, kind: 'move' }, 'owner')
  assert.ok(typeof a === 'object' && typeof b === 'object')
  const retarget = store.save({ questId: 'q', markerId: 'm-b', mapId: 'customs', x: 3, z: 3, kind: 'hide' }, 'owner', a.id)
  assert.ok(typeof retarget === 'object')
  assert.deepEqual(store.list().map((entry) => [entry.id, entry.markerId, entry.kind]), [[a.id, 'm-b', 'hide']])
})

test('quest points: a point description «где искать» is public, the owner\'s note is not; an original point can get one without moving', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const path = '/accounts/me/admin/quest-points'
    const described = { ...moved, kind: 'describe', title: 'Склад\nу заправки', description: '  За красной дверью,\r\nна второй полке\u0007  ', descriptionEn: 'Behind the red door' }
    assert.equal((await call('PUT', path, owner, { ...described, description: 'а'.repeat(501) })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...described, title: 'а'.repeat(81) })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...moved, kind: 'describe' })).status, 400, 'a description without text')
    assert.equal((await call('PUT', path, owner, { ...described, markerId: undefined })).status, 400, 'describe needs the original point')
    const saved = await call<{ override: Override & { title?: string; description?: string; descriptionEn?: string } }>('PUT', path, owner, described)
    assert.equal(saved.status, 200)
    assert.deepEqual([saved.json.override.kind, saved.json.override.title, saved.json.override.description, saved.json.override.descriptionEn],
      ['describe', 'Склад у заправки', 'За красной дверью,\nна второй полке', 'Behind the red door'])
    const listed = (await call<{ overrides: Array<Record<string, unknown>> }>('GET', '/quest-points')).json.overrides
    assert.equal(listed[0].description, 'За красной дверью,\nна второй полке', 'every player reads the description')
    assert.equal(listed[0].note, undefined, 'the owner\'s note stays with the owner')
    assert.equal(listed[0].updatedBy, undefined)
    // A later move keeps the same correction and carries the description the app sends along.
    const movedToo = await call<{ override: Override & { description?: string } }>('PUT', path, owner, { ...moved, x: 1, description: 'За красной дверью' })
    assert.equal(movedToo.json.override.id, saved.json.override.id)
    assert.deepEqual([movedToo.json.override.kind, movedToo.json.override.description], ['move', 'За красной дверью'])
  } finally {
    await close()
  }
})

test('quest point store: a table from before the descriptions gets the new columns and keeps its rows', () => {
  const db = openDatabase(':memory:')
  db.exec(`CREATE TABLE quest_point_overrides (id TEXT PRIMARY KEY, quest_id TEXT NOT NULL, marker_id TEXT, objective_id TEXT, stage_index INTEGER,
    map_id TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL, floor TEXT, kind TEXT NOT NULL, note TEXT, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.prepare(`INSERT INTO quest_point_overrides VALUES ('${'c'.repeat(24)}', 'q', 'm', NULL, NULL, 'customs', 1, 2, NULL, 'move', 'old', 'owner', '2026-10-01T00:00:00.000Z')`).run()
  const store = new QuestPointStore(db)
  assert.deepEqual(store.list().map((entry) => [entry.markerId, entry.kind, entry.description]), [['m', 'move', undefined]])
  const saved = store.save({ questId: 'q', markerId: 'm', mapId: 'customs', x: 1, z: 2, kind: 'describe', description: 'Под лестницей' }, 'owner')
  assert.ok(typeof saved === 'object')
  assert.equal(store.get(saved.id)?.description, 'Под лестницей')
})
