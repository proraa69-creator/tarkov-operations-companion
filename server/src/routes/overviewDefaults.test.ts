import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
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
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, translateAnnouncement: async (text) => text }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  const audit = () => new AdminStore(accounts, payments).auditLog(50, 0).entries.filter((row) => row.action === 'overview.blocks')
  return { call, login, audit, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const ADMIN = '/accounts/me/admin/overview-defaults'

const defaults = {
  layout: { stats: ['stat-kappa', 'stat-tasks', 'stat-conditions', 'stat-goons'], rows: ['stats', 'columns', 'priority'], left: ['requirements', 'raid', 'squad'], right: ['favorites', 'tasks', 'gunsmith'] },
  phone: ['raid', 'stat-tasks', 'stat-conditions', 'stat-kappa', 'stat-goons', 'priority', 'squad', 'requirements', 'tasks', 'gunsmith', 'favorites'],
  hidden: ['gunsmith'],
  titles: { tasks: { ru: '  Мои задания\u0007 ', en: 'My tasks' }, favorites: { ru: '', en: '' } },
}

interface Answer { defaults: null | { hidden: string[]; titles: Record<string, { ru: string; en: string }>; layout?: Record<string, string[]>; phone?: string[]; updatedBy?: string; updatedAt?: string } }

test('«Блоки»: the owner saves the Overview for everybody; players read it without the author, also with the notice; nobody else writes', async () => {
  const { call, login, audit, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.deepEqual((await call('GET', '/overview-defaults')).json, { defaults: null })
    assert.equal((await call('GET', '/announcement')).json.overview, null, 'the notice carries the built-in Overview')

    assert.equal((await call('PUT', ADMIN, undefined, defaults)).status, 401)
    assert.equal((await call('PUT', ADMIN, player, defaults)).status, 404)
    assert.equal((await call('GET', ADMIN, player)).status, 404)
    assert.equal((await call('POST', `${ADMIN}/reset`, player, {})).status, 404)

    const saved = await call<Answer>('PUT', ADMIN, owner, defaults)
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json.defaults?.hidden, ['gunsmith'])
    assert.deepEqual(saved.json.defaults?.titles, { tasks: { ru: 'Мои задания', en: 'My tasks' } }, 'control characters and spaces go, empty headings are dropped')
    assert.deepEqual(saved.json.defaults?.layout?.left, ['requirements', 'raid', 'squad'])
    assert.equal(saved.json.defaults?.updatedBy, 'owner@example.com')

    const open = (await call<Answer>('GET', '/overview-defaults')).json.defaults
    assert.equal(open?.updatedBy, undefined, 'players never see the author')
    assert.deepEqual(open?.phone, defaults.phone)
    const notice = (await call<{ overview: Answer['defaults'] }>('GET', '/announcement', player)).json.overview
    assert.deepEqual(notice?.hidden, ['gunsmith'])
    assert.equal(notice?.updatedBy, undefined)
    assert.equal((await call<Answer>('GET', ADMIN, owner)).json.defaults?.updatedBy, 'owner@example.com')

    assert.equal((await call<Answer>('POST', `${ADMIN}/reset`, owner, {})).json.defaults, null)
    assert.deepEqual((await call('GET', '/overview-defaults')).json, { defaults: null })
    assert.deepEqual(audit().map((row) => row.details?.op), ['reset', 'save'], 'both writes are in the audit log (newest first)')
  } finally {
    await close()
  }
})

test('«Блоки»: unknown blocks, a zone with the wrong blocks, long headings and extra fields are refused', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const bad = [
      { ...defaults, hidden: ['nope'] },
      { ...defaults, hidden: ['gunsmith', 'gunsmith'] },
      { ...defaults, layout: { ...defaults.layout, left: ['raid', 'squad'] } },
      { ...defaults, layout: { ...defaults.layout, left: ['raid', 'squad', 'tasks'] } },
      { ...defaults, phone: ['raid'] },
      { ...defaults, titles: { nope: { ru: 'x', en: '' } } },
      { ...defaults, titles: { tasks: { ru: 'x'.repeat(41), en: '' } } },
      { ...defaults, script: '<b>' },
      { hidden: [] },
    ]
    for (const body of bad) assert.equal((await call('PUT', ADMIN, owner, body)).status, 400, JSON.stringify(body).slice(0, 80))
    // only some fields: the built-in order stays
    const plain = await call<Answer>('PUT', ADMIN, owner, { hidden: ['squad'], titles: {} })
    assert.equal(plain.status, 200)
    assert.equal(plain.json.defaults?.layout, undefined)
    assert.equal(plain.json.defaults?.phone, undefined)
    // the stored defaults sent back as they came (with the author and the date) are accepted
    const again = await call<Answer>('PUT', ADMIN, owner, plain.json.defaults)
    assert.equal(again.status, 200)
  } finally {
    await close()
  }
})
