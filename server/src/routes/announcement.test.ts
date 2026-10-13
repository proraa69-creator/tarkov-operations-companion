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
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password })
  return { call, login, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

interface Answer { version: number; announcement: { text: string; updatedAt: string } | null }

test('the owner\'s notice: only the owner writes it, everybody reads it, a waiting app gets it at once', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    const first = await call<Answer>('GET', '/announcement')
    assert.equal(first.status, 200)
    assert.equal(first.json.announcement, null)

    const path = '/accounts/me/admin/announcement'
    const notice = { text: 'Ведутся технические работы. Приложение заработает через 15 минут.', active: true }
    assert.equal((await call('PUT', path, undefined, notice)).status, 401)
    assert.equal((await call('PUT', path, player, notice)).status, 404)
    assert.equal((await call('PUT', path, owner, { text: '', active: true })).status, 400)
    assert.equal((await call('PUT', path, owner, { text: 'x'.repeat(501), active: true })).status, 400)

    // An app waits for a change; the owner saves the notice: the answer comes at once, with the text.
    const waiting = call<Answer>('GET', `/announcement?since=${first.json.version}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await call('PUT', path, owner, notice)).status, 200)
    const woke = await waiting
    assert.equal(woke.json.announcement?.text, notice.text)
    assert.notEqual(woke.json.version, first.json.version)

    // The owner sees the hidden text too (to edit it); players see nothing once it is off.
    assert.equal((await call('PUT', path, owner, { text: notice.text, active: false })).status, 200)
    assert.equal((await call<Answer>('GET', '/announcement')).json.announcement, null)
    const own = await call<{ announcement: { text: string; active: boolean } }>('GET', path, owner)
    assert.deepEqual([own.json.announcement.text, own.json.announcement.active], [notice.text, false])
    assert.equal((await call('GET', path, player)).status, 404)
  } finally {
    await close()
  }
})
