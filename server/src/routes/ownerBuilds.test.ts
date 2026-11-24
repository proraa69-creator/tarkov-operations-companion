import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const M4 = '5447a9cd4bdc2dbd208b4567'
const GRIP = '5c7e8fab2e22165df16b889b'
const OLD_GRIP = '55d4af3a4bdc2d972f8b456f'
// A build code as src/arsenal/buildStorage.ts writes it.
const CODE = 'RB1.VEep8ry93S0gi0Vn..1AbcdEFGHijklMNOP(0AbcdEFGHijklMNOQ)'

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
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  return { call, login, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

interface Answer { builds: Array<{ weaponId: string; tier: string; code: string; updatedBy?: string }>; lessons: Record<string, { chosen: number; rejected: number }> }

const path = '/accounts/me/admin/owner-builds'

test('owner builds: the owner sets a weapon\'s tier build, every player reads it without the author; his edits are learned (owner, 02.11.2026)', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    const build = { weaponId: M4, tier: 'middle', code: CODE, added: [GRIP], removed: [OLD_GRIP] }
    assert.deepEqual((await call('GET', '/owner-builds')).json, { builds: [], lessons: {} })
    assert.equal((await call('PUT', path, undefined, build)).status, 401)
    assert.equal((await call('PUT', path, player, build)).status, 404)
    assert.equal((await call('PUT', path, owner, { ...build, tier: 'cheap' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...build, code: 'javascript:alert(1)' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...build, weaponId: '../etc' })).status, 400)
    assert.equal((await call('PUT', path, owner, { ...build, added: ['not-an-id'] })).status, 400)
    const saved = await call<Answer & { build: { tier: string } }>('PUT', path, owner, build)
    assert.equal(saved.status, 200)
    assert.equal(saved.json.build.tier, 'middle')
    // Every player's app: the build, no e-mail of who set it; the parts the owner put in and took out.
    const listed = (await call<Answer>('GET', '/owner-builds')).json
    assert.deepEqual(listed.builds.map(({ weaponId, tier, code }) => ({ weaponId, tier, code })), [{ weaponId: M4, tier: 'middle', code: CODE }])
    assert.equal(listed.builds[0]!.updatedBy, undefined)
    assert.deepEqual(listed.lessons, { [GRIP]: { chosen: 1, rejected: 0 }, [OLD_GRIP]: { chosen: 0, rejected: 1 } })
    // A second save of the same weapon and tier replaces it and adds to what was learned.
    await call('PUT', path, owner, { ...build, added: [GRIP, GRIP], removed: [] })
    const again = (await call<Answer>('GET', '/owner-builds')).json
    assert.equal(again.builds.length, 1)
    assert.deepEqual(again.lessons[GRIP], { chosen: 2, rejected: 0 })
    // Back to the app's own build: the lessons stay.
    assert.equal((await call('POST', `${path}/remove`, player, { weaponId: M4, tier: 'middle' })).status, 404)
    assert.equal((await call('POST', `${path}/remove`, owner, { weaponId: M4, tier: 'top' })).status, 404)
    const removed = await call<Answer>('POST', `${path}/remove`, owner, { weaponId: M4, tier: 'middle' })
    assert.equal(removed.status, 200)
    assert.deepEqual(removed.json.builds, [])
    assert.deepEqual(removed.json.lessons[GRIP], { chosen: 2, rejected: 0 })
  } finally {
    await close()
  }
})
