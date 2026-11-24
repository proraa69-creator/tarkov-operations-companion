import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import PLAYER_NEWS from '../../../src/data/playerNews.json'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { AdminStore } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const VERSION = PLAYER_NEWS[0]!.version
const KEPT = PLAYER_NEWS[0]!.items[0]!

async function setup(translate: (text: string) => Promise<string> = async (text) => `EN ${text.length}`) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, translateAnnouncement: translate }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  const audit = () => new AdminStore(accounts, payments).auditLog(50, 0).entries.filter((row) => row.action === 'news.edit')
  return { call, login, audit, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const ADMIN = '/accounts/me/admin/player-news'
type View = { entries: Array<{ version: string; items: Array<{ kind: string; ru: string; en: string }> }>; edited: string[] }

test('the owner edits a release: every app reads it at once, a line left as it was keeps its English, a new one is translated', async () => {
  const { call, login, audit, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    assert.deepEqual((await call('GET', '/player-news')).json, { edits: {} })
    const before = await call<View>('GET', ADMIN, owner)
    assert.equal(before.json.entries.length, PLAYER_NEWS.length)
    assert.deepEqual(before.json.edited, [])
    const saved = await call<View>('PUT', ADMIN, owner, { version: VERSION, items: [{ kind: KEPT.kind, ru: KEPT.ru }, { kind: 'changed', ru: '  Новый \u0007пункт ' }] })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json.edited, [VERSION])
    assert.deepEqual(saved.json.entries[0]!.items, [{ kind: KEPT.kind, ru: KEPT.ru, en: KEPT.en }, { kind: 'changed', ru: 'Новый пункт', en: 'EN 11' }])
    const open = await call<{ edits: Record<string, unknown[]> }>('GET', '/player-news')
    assert.equal(open.json.edits[VERSION]!.length, 2)
    assert.equal(audit().length, 1)
    // Back to the app's own text.
    const reset = await call<View>('POST', `${ADMIN}/reset`, owner, { version: VERSION })
    assert.deepEqual(reset.json.edited, [])
    assert.deepEqual(reset.json.entries[0]!.items, PLAYER_NEWS[0]!.items)
    assert.deepEqual((await call('GET', '/player-news')).json, { edits: {} })
  } finally { await close() }
})

test('a release may be left with no lines; a translation that fails or stays Russian leaves no English', async () => {
  const { call, login, close } = await setup(async (text) => { if (text.includes('сбой')) throw new Error('down'); return text })
  try {
    const owner = await login('owner@example.com')
    const saved = await call<View>('PUT', ADMIN, owner, { version: VERSION, items: [{ kind: 'added', ru: 'Текст со сбоем' }, { kind: 'added', ru: 'Осталось по-русски' }] })
    assert.deepEqual(saved.json.entries[0]!.items.map((item) => item.en), ['', ''])
    const empty = await call<View>('PUT', ADMIN, owner, { version: VERSION, items: [] })
    assert.deepEqual(empty.json.entries[0]!.items, [])
  } finally { await close() }
})

test('only the owner, only known releases, no empty lines or unknown blocks', async () => {
  const { call, login, close } = await setup()
  try {
    const player = await login('player@example.com')
    const owner = await login('owner@example.com')
    const body = { version: VERSION, items: [{ kind: 'added', ru: 'Текст' }] }
    assert.equal((await call('GET', ADMIN)).status, 401)
    assert.equal((await call('GET', ADMIN, player)).status, 404)
    assert.equal((await call('PUT', ADMIN, player, body)).status, 404)
    assert.equal((await call('POST', `${ADMIN}/reset`, player, { version: VERSION })).status, 404)
    assert.equal((await call('PUT', ADMIN, owner, { ...body, version: '9.9.9' })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { version: VERSION, items: [{ kind: 'added', ru: '   ' }] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { version: VERSION, items: [{ kind: 'removed', ru: 'Текст' }] })).status, 400)
    assert.equal((await call('PUT', ADMIN, owner, { version: VERSION, items: [{ kind: 'added', ru: 'я'.repeat(401) }] })).status, 400)
    assert.deepEqual((await call('GET', '/player-news')).json, { edits: {} })
  } finally { await close() }
})
