import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { SCOURGE_QUEST_IDS } from '../../../src/data/curatedQuests'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { AdminStore } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  let rebuilds = 0
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, eventQuestsChanged: () => { rebuilds += 1 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  const audit = () => new AdminStore(accounts, payments).auditLog(50, 0).entries.filter((row) => row.action === 'map.event-quest')
  return { call, login, audit, rebuilds: () => rebuilds, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

interface Stored { id: string; name: { ru: string; en: string }; updatedBy?: string; createdAt?: string; endsAt?: string; hidden?: boolean; objectives: unknown[] }

const THERAPIST = '54cb57776803fa99248b456e'
const ROUBLES = '5449016a4bdc2d6f028b456f'
const ADMIN = '/accounts/me/admin/event-quests'

/** «???» of «Вторжение Scourge» renamed: the built-in quest's id with the owner's fields. */
const renamed = {
  id: SCOURGE_QUEST_IDS.coordination,
  trader: THERAPIST,
  name: { ru: 'Нарушить координацию', en: 'Disrupt the Coordination' },
  after: [SCOURGE_QUEST_IDS.simpleTask],
  experience: 28_000,
  objectives: [{ type: 'shoot', count: 6, maps: ['the-lab'], targets: ['Any'], text: { ru: 'Устранить любую цель на локации Лаборатория', en: 'Eliminate any target in The Lab' } }],
  startRewards: [['5c94bbff86f7747ee735c08f', 3]],
  rewards: [['5c1d0d6d86f7744bb2683e1f', 1]],
  skills: [{ ru: 'Хирургия +1 уровень', en: 'Surgery +1 level' }],
  note: { ru: 'Устраните шесть целей в Лаборатории.', en: '' },
  modes: ['pvp', 'pve', 'seasonal'],
  series: { name: { ru: 'Вторжение Scourge', en: 'Scourge Invasion' }, route: { ru: 'ивент до 20 октября', en: 'event until 20 October' } },
  endsAt: '2026-10-20T10:00:00+03:00',
}

const added = {
  ...renamed,
  id: 'raidos-event-4k2m9x7q',
  name: { ru: 'Зелёный коридор', en: '' },
  after: [SCOURGE_QUEST_IDS.coordination],
  objectives: [{ type: 'giveItem', count: 2, items: ['5c1d0d6d86f7744bb2683e1f'], foundInRaid: true, text: { ru: 'Передать ключ-карту', en: 'Hand over the keycard' } }],
  rewards: [[ROUBLES, 250_000]],
  modes: ['pve'],
}

test('event quests: the owner renames a built-in quest and adds one; everybody reads them without the author; players cannot write', async () => {
  const { call, login, audit, rebuilds, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.deepEqual((await call('GET', '/event-quests')).json, { quests: [] })

    assert.equal((await call('PUT', ADMIN, undefined, renamed)).status, 401)
    assert.equal((await call('PUT', ADMIN, player, renamed)).status, 404)
    assert.equal((await call('GET', ADMIN, player)).status, 404)
    // validation: ids, texts, counts, types, modes, dates
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, id: 'some-quest' })).status, 400, 'a new id is raidos-event-…, else a built-in id')
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, name: { ru: '   ', en: 'x' } })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, name: { ru: 'а'.repeat(121), en: '' } })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, trader: 'therapist' })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, objectives: [] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, objectives: [{ ...renamed.objectives[0], type: 'teleport' }] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, objectives: Array.from({ length: 13 }, () => renamed.objectives[0]) })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, objectives: [{ ...renamed.objectives[0], targets: ['Everyone'] }] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, rewards: [['not-an-item', 1]] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, rewards: [[ROUBLES, 0]] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, modes: [] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, modes: ['arena'] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, endsAt: '20.10.2026' })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, after: [renamed.id] })).status, 400, 'a quest cannot follow itself')
    assert.equal((await call('PUT', ADMIN, owner, { ...renamed, script: 'x' })).status, 400, 'unknown fields are refused')
    assert.equal(rebuilds(), 0)

    const first = await call<{ quest: Stored; quests: Stored[] }>('PUT', ADMIN, owner, renamed)
    assert.equal(first.status, 200)
    assert.deepEqual(first.json.quest.name, renamed.name)
    assert.equal(first.json.quest.endsAt, '2026-10-20T07:00:00.000Z', 'the end is kept as UTC ISO')
    assert.equal(first.json.quest.updatedBy, 'owner@example.com')
    assert.equal(rebuilds(), 1, 'a saved change asks the quest base for a new build')
    // Saved again (the app sends the stored definition back with its bookkeeping): replaced in place, made-at kept.
    const again = await call<{ quest: Stored; quests: Stored[] }>('PUT', ADMIN, owner, { ...first.json.quest, name: { ru: 'Координация\u0007', en: 'Coordination' }, endsAt: null, hidden: true })
    assert.equal(again.status, 200)
    assert.equal(again.json.quests.length, 1)
    assert.equal(again.json.quest.name.ru, 'Координация', 'control characters are dropped')
    assert.equal(again.json.quest.createdAt, first.json.quest.createdAt)
    assert.equal(again.json.quest.endsAt, undefined, 'no end')
    assert.equal(again.json.quest.hidden, true)

    assert.equal((await call('PUT', ADMIN, owner, added)).status, 200)
    const all = (await call<{ quests: Stored[] }>('GET', '/event-quests')).json.quests
    assert.deepEqual(all.map((quest) => quest.id), [renamed.id, added.id], 'the oldest first')
    assert.ok(all.every((quest) => quest.updatedBy === undefined), 'players do not see the author')
    assert.equal((await call<{ quests: Stored[] }>('GET', ADMIN, owner)).json.quests[0].updatedBy, 'owner@example.com')

    // «Вернуть исходный» (a built-in quest) and «Удалить» (the owner's own).
    assert.equal((await call('POST', `${ADMIN}/nothing/remove`, owner)).status, 404)
    assert.equal((await call('POST', `${ADMIN}/${added.id}/remove`, player)).status, 404)
    const reset = await call<{ quests: Stored[] }>('POST', `${ADMIN}/${renamed.id}/remove`, owner)
    assert.equal(reset.status, 200)
    assert.deepEqual(reset.json.quests.map((quest) => quest.id), [added.id])
    assert.equal((await call<{ quests: Stored[] }>('POST', `${ADMIN}/${added.id}/remove`, owner)).json.quests.length, 0)
    assert.equal((await call('POST', `${ADMIN}/${added.id}/remove`, owner)).status, 404)
    assert.equal(rebuilds(), 5)

    const log = audit()
    assert.equal(log.length, 5)
    assert.deepEqual(log.map((row) => (row.details as { op: string }).op).sort(), ['remove', 'reset', 'save', 'save', 'save'])
  } finally {
    await close()
  }
})

test('event quests: every saved write wakes the apps waiting for map updates', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const { version } = (await call<{ version: number }>('GET', '/map-updates')).json
    const waiting = call<{ version: number }>('GET', `/map-updates?since=${version}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await call('PUT', ADMIN, owner, renamed)
    assert.ok((await waiting).json.version > version)
  } finally {
    await close()
  }
})
