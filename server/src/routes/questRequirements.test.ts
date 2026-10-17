import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { QuestRequirementStore } from '../services/questRequirementStore.js'
import { catalogItemCheck } from './questRequirements.js'
import type { AppDataset } from '../../../src/domain/types'

const password = 'correct horse battery'
const KEY = '5780cf7f2459777de4559322' // Dorm room 314 marked key
const GPU = '57347ca924597744596b4e71'
const UNKNOWN = '0123456789abcdef01234567'

async function setup(withCatalog = true) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const catalog = withCatalog ? () => ({ items: [{ id: KEY }, { id: GPU }] }) as unknown as AppDataset : () => undefined
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, catalog }).listen(0, '127.0.0.1')
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

interface Entry { id: string; questId: string; op: string; itemId: string; kind: string; count: number; foundInRaid?: boolean; comment?: string; position: number; updatedBy?: string }

const path = '/accounts/me/admin/quest-requirements'
const key = { questId: '5936d90786f7742b1420ba5b', op: 'add', itemId: KEY, kind: 'key', count: 1, comment: 'Открыть 314-ю', pointId: 'quest-zone-x-a' }

test('quest requirements: owner-only writes, validation, public list without the author', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.deepEqual((await call('GET', '/quest-requirements')).json, { overrides: [] })
    assert.equal((await call('PUT', path, undefined, key)).status, 401)
    assert.equal((await call('PUT', path, player, key)).status, 404)
    assert.equal((await call('GET', path, player)).status, 404)
    assert.equal((await call('POST', `${path}/order`, player, { questId: key.questId, ids: [] })).status, 404)
    assert.equal((await call('PUT', path, owner, { ...key, itemId: 'select * from' })).status, 400, 'an item id has the game format')
    assert.equal((await call('PUT', path, owner, { ...key, itemId: UNKNOWN })).status, 400, 'and is an item of the catalog')
    assert.equal((await call('PUT', path, owner, { ...key, kind: 'steal' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...key, count: 0 })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...key, count: 1000 })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...key, comment: 'а'.repeat(301) })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...key, questId: '../etc' })).status, 400)

    const saved = await call<{ override: Entry; overrides: Entry[] }>('PUT', path, owner, { ...key, foundInRaid: true })
    assert.equal(saved.status, 200)
    assert.match(saved.json.override.id, /^[a-f0-9]{24}$/)
    assert.equal(saved.json.override.foundInRaid, undefined, '«найден в рейде» only for a hand-over or a find')
    assert.equal(saved.json.override.updatedBy, 'owner@example.com')
    const listed = (await call<{ overrides: Entry[] }>('GET', '/quest-requirements')).json.overrides
    assert.equal(listed.length, 1)
    assert.equal(listed[0].updatedBy, undefined)
    assert.equal(listed[0].comment, 'Открыть 314-ю')
  } finally {
    await close()
  }
})

test('quest requirements: add, edit, hide an original, reorder and remove; every write wakes the apps', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const { version } = (await call<{ version: number }>('GET', '/map-updates')).json
    const waiting = call<{ version: number }>('GET', `/map-updates?since=${version}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const first = (await call<{ override: Entry }>('PUT', path, owner, key)).json.override
    assert.ok((await waiting).json.version > version, 'the live version moved')

    // The same quest, item and kind again: replaced in place (one entry each).
    const again = await call<{ override: Entry; overrides: Entry[] }>('PUT', path, owner, { ...key, count: 2, comment: undefined })
    assert.equal(again.json.override.id, first.id)
    assert.equal(again.json.overrides.length, 1)
    assert.deepEqual([again.json.override.count, again.json.override.comment], [2, undefined])
    const gpu = (await call<{ override: Entry }>('PUT', path, owner, { questId: key.questId, itemId: GPU, kind: 'handover', count: 3, foundInRaid: true })).json.override
    assert.deepEqual([gpu.op, gpu.foundInRaid, gpu.position], ['add', true, 1])
    // «Скрыть» an original requirement of the catalog.
    const hidden = (await call<{ override: Entry }>('PUT', path, owner, { questId: key.questId, op: 'hide', itemId: GPU, kind: 'find' })).json.override
    assert.equal(hidden.op, 'hide')
    // Edit by id keeps the place; reorder.
    const edited = (await call<{ override: Entry }>('PUT', path, owner, { id: gpu.id, questId: key.questId, itemId: GPU, kind: 'handover', count: 5, foundInRaid: false })).json.override
    assert.deepEqual([edited.id, edited.count, edited.foundInRaid, edited.position], [gpu.id, 5, false, 1])
    assert.equal((await call('POST', `${path}/order`, owner, { questId: key.questId, ids: [UNKNOWN] })).status, 404)
    const ordered = (await call<{ overrides: Entry[] }>('POST', `${path}/order`, owner, { questId: key.questId, ids: [hidden.id, gpu.id] })).json.overrides
    assert.deepEqual(ordered.map((entry) => entry.id), [hidden.id, gpu.id, first.id])
    assert.equal((await call('PUT', path, owner, { ...key, id: UNKNOWN })).status, 404)

    const removed = await call<{ overrides: Entry[] }>('POST', `${path}/${hidden.id}/remove`, owner)
    assert.deepEqual(removed.json.overrides.map((entry) => entry.id), [gpu.id, first.id])
    assert.equal((await call('POST', `${path}/${hidden.id}/remove`, owner)).status, 404)

    const audit = await call<{ entries: Array<{ action: string }> }>('GET', '/accounts/me/admin/audit', owner)
    assert.equal(audit.json.entries.filter((entry) => entry.action === 'map.quest-requirement').length, 7)
  } finally {
    await close()
  }
})

test('quest requirements: without a loaded catalog the id format is enough', async () => {
  const { call, login, close } = await setup(false)
  try {
    const owner = await login('owner@example.com')
    assert.equal((await call('PUT', path, owner, { ...key, itemId: UNKNOWN })).status, 200)
  } finally {
    await close()
  }
})

test('quest requirement store: limits per quest and the catalog check', () => {
  const store = new QuestRequirementStore(openDatabase(':memory:'))
  for (let index = 0; index < 100; index += 1) {
    const saved = store.save({ questId: 'q', op: 'add', itemId: index.toString(16).padStart(24, '0'), kind: 'bring', count: 1 }, 'owner')
    assert.ok(typeof saved === 'object')
  }
  assert.equal(store.save({ questId: 'q', op: 'add', itemId: 'f'.repeat(24), kind: 'bring', count: 1 }, 'owner'), 'full')
  assert.ok(typeof store.save({ questId: 'q', op: 'add', itemId: '0'.repeat(24), kind: 'bring', count: 4 }, 'owner') === 'object', 'replacing one is fine')
  const check = catalogItemCheck((mode) => (mode === 'pve' ? { items: [{ id: KEY }] } : undefined))
  assert.deepEqual([check(KEY), check(GPU)], [true, false])
  assert.equal(catalogItemCheck(() => undefined)(KEY), undefined)
})
