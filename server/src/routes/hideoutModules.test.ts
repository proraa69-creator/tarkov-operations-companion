import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { AdminStore } from '../services/adminStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { BITCOIN_FARM, GYM } from '../../../src/hideout/hideoutModules'
import type { AppDataset } from '../../../src/domain/types'

const password = 'correct horse battery'
const SEASON_MODULE = 'aaaaaaaaaaaaaaaaaaaaaaaa'

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  // the server's Season catalog has a module the game did not have before
  const catalog = (mode: string) => (mode === 'seasonal' ? { hideout: [{ id: SEASON_MODULE }] } as unknown as AppDataset : undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, catalog, translateAnnouncement: async (text) => text }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  const audit = () => new AdminStore(accounts, payments).auditLog(50, 0).entries.filter((row) => row.action === 'hideout.modules')
  return { call, login, audit, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const ADMIN = '/accounts/me/admin/hideout-modules'

interface Lists { open: string[]; hidden: string[] }
interface Answer { modules: null | { modes: Partial<Record<'pvp' | 'pve' | 'seasonal', Lists>>; updatedBy?: string; updatedAt?: string } }

test('«Модули убежища»: nothing set at first; the owner opens the gym and the bitcoin farm in Season, the players get it with the notice', async () => {
  const { call, login, audit, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    assert.equal((await call('GET', '/announcement')).json.hideoutModules, null, 'every mode as in the game until the owner says')
    assert.deepEqual((await call<Answer>('GET', ADMIN, owner)).json, { modules: null })

    const season = { mode: 'seasonal', open: [GYM, BITCOIN_FARM], hidden: [] }
    assert.equal((await call('PUT', ADMIN, undefined, season)).status, 401)
    assert.equal((await call('PUT', ADMIN, player, season)).status, 404)
    assert.equal((await call('GET', ADMIN, player)).status, 404)

    const saved = await call<Answer>('PUT', ADMIN, owner, season)
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json.modules?.modes, { seasonal: { open: [GYM, BITCOIN_FARM], hidden: [] } })
    assert.equal(saved.json.modules?.updatedBy, 'owner@example.com')

    const notice = (await call<{ hideoutModules: Answer['modules'] }>('GET', '/announcement', player)).json.hideoutModules
    assert.deepEqual(notice?.modes, { seasonal: { open: [GYM, BITCOIN_FARM], hidden: [] } })
    assert.equal(notice?.updatedBy, undefined, 'players never see the author')
    assert.equal(typeof notice?.updatedAt, 'string')

    // another mode is saved beside it; the Season stays
    const pve = await call<Answer>('PUT', ADMIN, owner, { mode: 'pve', open: [], hidden: [GYM] })
    assert.deepEqual(pve.json.modules?.modes, { seasonal: { open: [GYM, BITCOIN_FARM], hidden: [] }, pve: { open: [], hidden: [GYM] } })

    // empty lists: that mode as in the game; no mode left: none at all
    assert.deepEqual((await call<Answer>('PUT', ADMIN, owner, { mode: 'pve', open: [], hidden: [] })).json.modules?.modes, { seasonal: { open: [GYM, BITCOIN_FARM], hidden: [] } })
    assert.deepEqual((await call<Answer>('PUT', ADMIN, owner, { mode: 'seasonal', open: [], hidden: [] })).json, { modules: null })
    assert.equal((await call('GET', '/announcement')).json.hideoutModules, null)

    assert.deepEqual(audit().map((row) => [row.target, row.details?.open, row.details?.hidden]), [
      ['seasonal', [], []],
      ['pve', [], []],
      ['pve', [], [GYM]],
      ['seasonal', [GYM, BITCOIN_FARM], []],
    ], 'every write in the audit log (newest first)')
  } finally {
    await close()
  }
})

test('«Модули убежища»: unknown modes and modules, repeats, a module in both lists and extra fields are refused; a module of the server\'s catalog is accepted', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const bad = [
      { mode: 'arena', open: [GYM], hidden: [] },
      { mode: 'seasonal', open: ['gym'], hidden: [] },
      { mode: 'seasonal', open: ['ffffffffffffffffffffffff'], hidden: [] },
      { mode: 'seasonal', open: [GYM, GYM], hidden: [] },
      { mode: 'seasonal', open: [GYM], hidden: [GYM] },
      { mode: 'seasonal', open: [GYM] },
      { mode: 'seasonal', open: [GYM], hidden: [], script: '<b>' },
      { open: [GYM], hidden: [] },
    ]
    for (const body of bad) assert.equal((await call('PUT', ADMIN, owner, body)).status, 400, JSON.stringify(body))
    assert.deepEqual((await call<Answer>('GET', ADMIN, owner)).json, { modules: null }, 'nothing saved by the refused writes')

    const fromCatalog = await call<Answer>('PUT', ADMIN, owner, { mode: 'seasonal', open: [SEASON_MODULE], hidden: [] })
    assert.equal(fromCatalog.status, 200)
    assert.deepEqual(fromCatalog.json.modules?.modes.seasonal, { open: [SEASON_MODULE], hidden: [] })
  } finally {
    await close()
  }
})
