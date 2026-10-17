import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { hexToB64 } from './buildCatalog.js'
import { MAX_BUILDS_PER_ACCOUNT } from '../services/buildCatalogStore.js'

const password = 'correct horse battery'
const M4 = '5447a9cd4bdc2dbd208b4567'
const AK = '5bf3e03b0db834001d2c4a9c'
const code = (weapon: string, tree = '') => `RB1.${hexToB64(weapon)}..${tree}`

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  for (const email of ['a@example.com', 'b@example.com']) await call('POST', '/accounts/register', undefined, { email, password, country: 'RU' })
  return { call, login, accounts, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

type Page = { builds: Array<{ id: string; name: string; likes: number; liked: boolean; mine: boolean; weaponId: string }>; total: number }

test('build catalog: publish, list per mode and weapon, like once, top order, remove by the author or the owner', async () => {
  const { call, login, close } = await setup()
  try {
    const a = await login('a@example.com')
    const b = await login('b@example.com')
    const owner = await login('owner@example.com')
    assert.equal((await call('GET', '/builds?mode=pvp')).status, 401)
    assert.equal((await call('POST', '/builds', undefined, { mode: 'pvp', weaponId: M4, name: 'x', code: code(M4) })).status, 401)

    const first = await call<{ build: { id: string; mine: boolean; likes: number } }>('POST', '/builds', a, { mode: 'pvp', weaponId: M4, name: '  Тихий   M4 ', code: code(M4, '0AAAAAAAAAAAAAAAA') })
    assert.equal(first.status, 201)
    assert.equal(first.json.build.mine, true)
    const second = await call<{ build: { id: string } }>('POST', '/builds', b, { mode: 'pvp', weaponId: M4, name: 'Дешёвый M4', code: code(M4) })
    assert.equal(second.status, 201)
    assert.equal((await call('POST', '/builds', b, { mode: 'pve', weaponId: AK, name: 'АК для PvE', code: code(AK) })).status, 201)
    // duplicate, bad code, code of another weapon, empty name
    assert.equal((await call('POST', '/builds', a, { mode: 'pvp', weaponId: M4, name: 'again', code: code(M4, '0AAAAAAAAAAAAAAAA') })).status, 409)
    assert.equal((await call('POST', '/builds', a, { mode: 'pvp', weaponId: M4, name: 'x', code: 'RB1.<script>' })).status, 400)
    assert.equal((await call('POST', '/builds', a, { mode: 'pvp', weaponId: M4, name: 'x', code: code(AK) })).status, 400)
    assert.equal((await call('POST', '/builds', a, { mode: 'pvp', weaponId: M4, name: '   ', code: code(M4, '1AAAAAAAAAAAAAAAA') })).status, 400)

    const pvp = (await call<Page>('GET', '/builds?mode=pvp', a)).json
    assert.equal(pvp.total, 2)
    assert.equal(pvp.builds.find((entry) => entry.id === first.json.build.id)?.name, 'Тихий M4')
    assert.equal((await call<Page>('GET', '/builds?mode=pve', a)).json.total, 1)
    assert.equal((await call<Page>(`GET`, `/builds?mode=pvp&weapon=${AK}`, a)).json.total, 0)

    // likes: one per account, again = unlike, not on one's own build; the top follows the likes
    assert.equal((await call('POST', `/builds/${first.json.build.id}/like`, a)).status, 409)
    assert.deepEqual((await call('POST', `/builds/${second.json.build.id}/like`, a)).json, { likes: 1, liked: true })
    assert.deepEqual((await call('POST', `/builds/${second.json.build.id}/like`, owner)).json, { likes: 2, liked: true })
    const top = (await call<Page>('GET', '/builds?mode=pvp&sort=top', a)).json
    assert.deepEqual(top.builds.map((entry) => [entry.id, entry.likes, entry.liked]), [[second.json.build.id, 2, true], [first.json.build.id, 0, false]])
    assert.deepEqual((await call('POST', `/builds/${second.json.build.id}/like`, a)).json, { likes: 1, liked: false })
    assert.equal((await call<Page>('GET', '/builds?mode=pvp&sort=new', a)).json.builds[0].id, second.json.build.id)

    // remove: not someone else's, yes one's own, the owner any
    assert.equal((await call('POST', `/builds/${second.json.build.id}/remove`, a)).status, 404)
    assert.equal((await call('POST', `/builds/${first.json.build.id}/remove`, a)).status, 200)
    assert.equal((await call('POST', `/builds/${second.json.build.id}/remove`, owner)).status, 200)
    assert.equal((await call<Page>('GET', '/builds?mode=pvp', a)).json.total, 0)
  } finally {
    await close()
  }
})

test('build catalog: a limit per account and mode; deleting the account removes its builds and likes', async () => {
  const { call, login, accounts, close } = await setup()
  try {
    const a = await login('a@example.com')
    const b = await login('b@example.com')
    let lastId = ''
    for (let index = 0; index < MAX_BUILDS_PER_ACCOUNT; index += 1) {
      const tree = `0${hexToB64(index.toString(16).padStart(24, '0'))}`
      const answer = await call<{ build: { id: string } }>('POST', '/builds', a, { mode: 'seasonal', weaponId: M4, name: `M4 #${index}`, code: code(M4, tree) })
      if (answer.status === 429) break // the hourly publish limit (20) comes first
      assert.equal(answer.status, 201)
      lastId = answer.json.build.id
    }
    assert.notEqual(lastId, '')
    assert.equal((await call('POST', `/builds/${lastId}/like`, b)).status, 200)
    const mine = await call<{ id: string }>('POST', '/builds', b, { mode: 'seasonal', weaponId: AK, name: 'AK', code: code(AK) })
    assert.equal(mine.status, 201)
    assert.equal((await call('POST', `/accounts/me/delete`, b, { password })).status, 200)
    const page = (await call<Page>('GET', '/builds?mode=seasonal&sort=top', a)).json
    assert.equal(page.builds.some((entry) => entry.weaponId === AK), false)
    assert.equal(page.builds.find((entry) => entry.id === lastId)?.likes, 0)
    assert.ok(accounts)
  } finally {
    await close()
  }
})
