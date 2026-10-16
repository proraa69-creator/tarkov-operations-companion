import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
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

interface Override { id: string; questId: string; field: string; target: string; lang: string; text: string; updatedBy?: string }

const description = { questId: '5936d90786f7742b1420ba5b', field: 'description', lang: 'ru', text: 'Прапор просит найти пропавший груз.\nПроверьте склад у заправки.' }

test('quest texts: the owner saves, replaces and resets a text; everybody reads it without the author; players cannot write', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.deepEqual((await call('GET', '/quest-texts')).json, { overrides: [] })

    const path = '/accounts/me/admin/quest-texts'
    assert.equal((await call('PUT', path, undefined, description)).status, 401)
    assert.equal((await call('PUT', path, player, description)).status, 404)
    assert.equal((await call('GET', path, player)).status, 404)
    assert.equal((await call('PUT', path, owner, { ...description, text: '   ' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...description, text: 'а'.repeat(2001) })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...description, lang: 'de' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...description, field: 'reward' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...description, field: 'objective' })).status, 400, 'an objective needs its id')
    assert.equal((await call('PUT', path, owner, { ...description, field: 'stage-title', target: 'two' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...description, questId: '../etc' })).status, 400)

    const first = await call<{ override: Override }>('PUT', path, owner, description)
    assert.equal(first.status, 200)
    assert.match(first.json.override.id, /^[a-f0-9]{24}$/)
    assert.deepEqual([first.json.override.field, first.json.override.target, first.json.override.updatedBy], ['description', '', 'owner@example.com'])
    assert.equal(first.json.override.text, description.text, 'line breaks stay')
    // The same field and language again: replaced in place; English is a text of its own.
    const again = await call<{ override: Override; overrides: Override[] }>('PUT', path, owner, { ...description, text: 'Новое описание\u0007' })
    assert.equal(again.json.override.id, first.json.override.id)
    assert.equal(again.json.override.text, 'Новое описание', 'control characters are dropped')
    await call('PUT', path, owner, { ...description, lang: 'en', text: 'Find the missing cargo.' })
    await call('PUT', path, owner, { questId: description.questId, field: 'objective', target: '5936da9e86f7742d65037edf', lang: 'ru', text: 'Найти груз на таможне' })
    await call('PUT', path, owner, { questId: 'story-tour', field: 'stage-description', target: '2', lang: 'ru', text: 'Пройдите к маяку' })

    const all = (await call<{ overrides: Override[] }>('GET', '/quest-texts')).json.overrides
    assert.equal(all.length, 4)
    assert.ok(all.every((entry) => entry.updatedBy === undefined), 'players do not see the author')
    assert.equal((await call<{ overrides: Override[] }>('GET', path, owner)).json.overrides[0].updatedBy, 'owner@example.com')

    // «Вернуть исходный текст».
    assert.equal((await call('POST', `${path}/nothing/remove`, owner)).status, 404)
    assert.equal((await call('POST', `${path}/${first.json.override.id}/remove`, player)).status, 404)
    const reset = await call<{ overrides: Override[] }>('POST', `${path}/${first.json.override.id}/remove`, owner)
    assert.equal(reset.status, 200)
    assert.equal(reset.json.overrides.length, 3)
    assert.equal((await call('POST', `${path}/${first.json.override.id}/remove`, owner)).status, 404)
  } finally {
    await close()
  }
})

test('quest texts: every saved write wakes the apps waiting for map updates', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const { version } = (await call<{ version: number }>('GET', '/map-updates')).json
    const waiting = call<{ version: number }>('GET', `/map-updates?since=${version}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await call('PUT', '/accounts/me/admin/quest-texts', owner, description)
    assert.ok((await waiting).json.version > version)
  } finally {
    await close()
  }
})
