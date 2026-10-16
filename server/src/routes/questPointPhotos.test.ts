import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { QuestPointStore } from '../services/questPointStore.js'
import { QuestPointPhotoStore, QUEST_POINT_PHOTO_STORAGE } from '../services/questPointPhotoStore.js'

const password = 'correct horse battery'

/** A 2 × 3 PNG: the signature and an IHDR chunk are all the server reads. */
function png(width = 2, height = 3, padding = 0) {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head)
  head.writeUInt32BE(13, 8)
  head.write('IHDR', 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return Buffer.concat([head, Buffer.alloc(padding)])
}

async function setup(options: { perHour?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'raidos-point-photos-'))
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, questPointPhotoDir: directory, questPointPhotoUploadsPerHour: options.perHour }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json().catch(() => ({})) as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  return {
    call, login, directory,
    close: () => new Promise<void>((resolve) => server.close(() => { rmSync(directory, { recursive: true, force: true }); resolve() })),
  }
}

interface Photo { id: string; mime: string; size: number; width: number; height: number }
interface Override { id: string; questId?: string; kind: string; icon?: string; itemIds?: string[]; photoIds?: string[]; title?: string; description?: string }

const UPLOAD = '/accounts/me/admin/quest-point-photos'
const POINTS = '/accounts/me/admin/quest-points'
const ITEM = '5780cf7f2459777de4559322'

test('point photos: only the owner uploads; type by the first bytes, size and header are checked; files stay on disk', async () => {
  const { call, login, close, directory } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    const data = png().toString('base64')
    assert.equal((await call('POST', UPLOAD, undefined, { data })).status, 401)
    assert.equal((await call('POST', UPLOAD, player, { data })).status, 404, 'players do not even learn the route exists')
    assert.equal((await call('POST', UPLOAD, owner, { data: Buffer.from('GIF89a……').toString('base64') })).status, 400, 'not PNG / JPEG / WEBP')
    assert.equal((await call('POST', UPLOAD, owner, { data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') })).status, 400, 'a PNG without a readable header')
    assert.equal((await call('POST', UPLOAD, owner, { data: '###' })).status, 400, 'not base64')
    assert.equal((await call('POST', UPLOAD, owner, { data: png(2, 3, 5 * 1024 * 1024).toString('base64') })).status, 413, 'over 5 MB')
    const uploaded = await call<{ photo: Photo }>('POST', UPLOAD, owner, { data: `data:image/png;base64,${data}` })
    assert.equal(uploaded.status, 201)
    assert.match(uploaded.json.photo.id, /^[a-f0-9]{24}$/)
    assert.deepEqual([uploaded.json.photo.mime, uploaded.json.photo.width, uploaded.json.photo.height], ['image/png', 2, 3])
    assert.deepEqual(readdirSync(directory), [`${uploaded.json.photo.id}.png`])

    // Not on a point yet: the owner sees it, a player does not.
    const read = `/me/quest-point-photos/${uploaded.json.photo.id}`
    assert.equal((await call('GET', read)).status, 401)
    assert.equal((await call('GET', read, player)).status, 404)
    const own = await call<{ mime: string; data: string; width: number }>('GET', read, owner)
    assert.equal(own.status, 200)
    assert.deepEqual([own.json.mime, own.json.data, own.json.width], ['image/png', data, 2])
    assert.equal((await call('GET', '/me/quest-point-photos/..%2F..%2Fetc', owner)).status, 404)

    // On a saved point every signed-in player reads it.
    const point = { questId: 'q1', mapId: 'customs', x: 1, z: 2, kind: 'add', photoIds: [uploaded.json.photo.id] }
    assert.equal((await call('PUT', POINTS, owner, point)).status, 200)
    assert.equal((await call('GET', read, player)).status, 200)
    assert.equal((await call('GET', read)).status, 401, 'signed-in apps only')

    const audit = await call<{ entries: Array<{ action: string }> }>('GET', '/accounts/me/admin/audit', owner)
    assert.equal(audit.json.entries.filter((entry) => entry.action === 'map.quest-point-photo').length, 1)
  } finally {
    await close()
  }
})

test('point photos: at most 4 on a point, only stored ones, and the upload rate is limited', async () => {
  const { call, login, close } = await setup({ perHour: 5 })
  try {
    const owner = await login('owner@example.com')
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) ids.push((await call<{ photo: Photo }>('POST', UPLOAD, owner, { data: png().toString('base64') })).json.photo.id)
    const sixth = await call('POST', UPLOAD, owner, { data: png().toString('base64') })
    assert.equal(sixth.status, 429)
    const point = { questId: 'q1', mapId: 'customs', x: 1, z: 2, kind: 'add' }
    assert.equal((await call('PUT', POINTS, owner, { ...point, photoIds: ids })).status, 400, 'five photos on one point')
    assert.equal((await call('PUT', POINTS, owner, { ...point, photoIds: ['f'.repeat(24)] })).status, 400, 'a photo that was never uploaded')
    const saved = await call<{ override: Override }>('PUT', POINTS, owner, { ...point, photoIds: [ids[0], ids[0], ids[1]] })
    assert.deepEqual(saved.json.override.photoIds, [ids[0], ids[1]], 'repeats are dropped')
  } finally {
    await close()
  }
})

test('the point constructor: a free point (no quest) with an emblem, catalog items and a description; every player reads it', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    const free = { mapId: 'customs', x: 10, z: -20, kind: 'add', icon: 'transit', title: 'Переход на Развязку', description: 'У ворот', itemIds: [ITEM, ITEM] }
    assert.equal((await call('PUT', POINTS, player, free)).status, 404)
    assert.equal((await call('PUT', POINTS, owner, { ...free, icon: undefined })).status, 400, 'a free point needs an emblem')
    assert.equal((await call('PUT', POINTS, owner, { ...free, icon: 'quest.zone' })).status, 400, 'a quest emblem needs a quest')
    assert.equal((await call('PUT', POINTS, owner, { ...free, icon: 'spawn' })).status, 400, 'spawns are not offered')
    assert.equal((await call('PUT', POINTS, owner, { ...free, kind: 'describe', markerId: 'm' })).status, 400, 'only an added point may have no quest')
    assert.equal((await call('PUT', POINTS, owner, { ...free, itemIds: ['not-an-item'] })).status, 400)
    assert.equal((await call('PUT', POINTS, owner, { ...free, itemIds: Array.from({ length: 7 }, (_, index) => index.toString(16).padStart(24, '0')) })).status, 400)
    const saved = await call<{ override: Override }>('PUT', POINTS, owner, free)
    assert.equal(saved.status, 200)
    assert.equal(saved.json.override.questId, undefined, 'no quest id, so older apps skip the point')
    assert.deepEqual([saved.json.override.icon, saved.json.override.itemIds], ['transit', [ITEM]])
    // Later attached to a quest with the quest's emblem: the same point.
    const attached = await call<{ override: Override }>('PUT', POINTS, owner, { ...free, id: saved.json.override.id, icon: 'quest.item', questId: 'q1', objectiveId: 'o2' })
    assert.equal(attached.json.override.id, saved.json.override.id)
    assert.deepEqual([attached.json.override.questId, attached.json.override.icon], ['q1', 'quest.item'])
    const listed = (await call<{ overrides: Override[] }>('GET', '/quest-points')).json.overrides
    assert.deepEqual(listed.map((entry) => [entry.kind, entry.icon, entry.itemIds]), [['add', 'quest.item', [ITEM]]])
    // An original point gets only a photo-free item list: still a valid «describe».
    assert.equal((await call('PUT', POINTS, owner, { questId: 'q1', markerId: 'quest-zone-q1-a', mapId: 'customs', x: 0, z: 0, kind: 'describe', itemIds: [ITEM] })).status, 200)
  } finally {
    await close()
  }
})

test('point photo store: unreferenced photos go a day after the upload, referenced ones stay; the storage has a cap', () => {
  const directory = mkdtempSync(join(tmpdir(), 'raidos-point-photos-'))
  try {
    let now = Date.UTC(2026, 9, 16)
    const db = openDatabase(':memory:')
    const points = new QuestPointStore(db)
    const photos = new QuestPointPhotoStore(db, directory, () => points.photoIds(), { now: () => now, maxStoredBytes: 200 })
    const kept = photos.upload('owner', png())
    const dropped = photos.upload('owner', png())
    points.save({ questId: 'q', mapId: 'customs', x: 0, z: 0, kind: 'add', photoIds: [kept.id] }, 'owner')
    now += QUEST_POINT_PHOTO_STORAGE.unusedMs + 1
    assert.equal(photos.pruneUnused(), 1)
    assert.ok(photos.has(kept.id))
    assert.ok(!photos.has(dropped.id))
    assert.deepEqual(readdirSync(directory), [`${kept.id}.png`])
    photos.upload('owner', png(4, 4, 60))
    assert.throws(() => photos.upload('owner', png(4, 4, 100)), (error: Error & { status?: number }) => error.status === 507)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('point photos: a server without a photo directory answers 503 to the owner', async () => {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const token = (await (await fetch(`${base}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password }) })).json() as { token: string }).token
    const response = await fetch(`${base}${UPLOAD}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data: png().toString('base64') }) })
    assert.equal(response.status, 503)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
