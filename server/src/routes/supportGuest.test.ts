import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import type { SupportChatLimits } from './supportChat.js'

/** The site's chat for guests (owner, 17.11.2026: «Можно войти как гость… если он не авторизован, то пишется как гость»). */
const password = 'correct horse battery'

async function setup(limits?: Partial<SupportChatLimits>) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, supportChatLimits: limits, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, options: { token?: string; guest?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.guest ? { 'x-support-guest': options.guest } : {}),
    }
    const response = await fetch(`${base}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T }
  }
  const owner = (await call<{ token: string }>('POST', '/accounts/login', { body: { email: 'owner@example.com', password } })).json.token
  return { call, owner, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

interface Message { id: number; author: 'user' | 'owner'; text: string; read: boolean }

test('support guest: writes without an account, the owner sees «Гость N» and answers, the guest reads it', async () => {
  const t = await setup()
  try {
    const created = await t.call<{ token: string; name: string }>('POST', '/support/guest')
    assert.equal(created.status, 201)
    assert.match(created.json.token, /^[A-Za-z0-9_-]{32}$/)
    assert.equal(created.json.name, 'Гость 1')
    const guest = created.json.token
    assert.deepEqual((await t.call<{ messages: Message[] }>('GET', '/support/guest/messages', { guest })).json.messages, [])
    const sent = await t.call<{ message: Message }>('POST', '/support/guest/messages', { guest, body: { text: '  Как оплатить?  ' } })
    assert.equal(sent.status, 201)
    assert.equal(sent.json.message.text, 'Как оплатить?')

    const threads = await t.call<{ threads: Array<{ accountId: string; nickname?: string; email: string; unread: number; guest?: true }> }>('GET', '/accounts/me/admin/support/threads', { token: t.owner })
    assert.equal(threads.json.threads.length, 1)
    const thread = threads.json.threads[0]!
    assert.equal(thread.nickname, 'Гость 1')
    assert.equal(thread.email, '')
    assert.equal(thread.guest, true)
    assert.equal(thread.unread, 1)
    assert.match(thread.accountId, /^[a-f0-9]{24}$/)

    const opened = await t.call<{ account: { nickname?: string }; messages: Message[] }>('GET', `/accounts/me/admin/support/threads/${thread.accountId}`, { token: t.owner })
    assert.equal(opened.status, 200)
    assert.equal(opened.json.account.nickname, 'Гость 1')
    const answer = await t.call('POST', `/accounts/me/admin/support/threads/${thread.accountId}/messages`, { token: t.owner, body: { text: 'Картой в личном кабинете' } })
    assert.equal(answer.status, 201)

    const read = await t.call<{ messages: Message[]; unread: number }>('GET', '/support/guest/messages', { guest })
    assert.deepEqual(read.json.messages.map((message) => [message.author, message.text]), [['user', 'Как оплатить?'], ['owner', 'Картой в личном кабинете']])
    assert.equal(read.json.unread, 1)
    assert.equal((await t.call('POST', '/support/guest/read', { guest })).status, 204)
    assert.equal((await t.call<{ unread: number }>('GET', '/support/guest/messages', { guest })).json.unread, 0)
  } finally { await t.close() }
})

test('support guest: an unknown token reads nothing, text only, a guest reads neither a player chat nor another guest', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('GET', '/support/guest/messages', { guest: 'x'.repeat(32) })).status, 401)
    assert.equal((await t.call('GET', '/support/guest/messages')).status, 401)
    const a = (await t.call<{ token: string }>('POST', '/support/guest')).json.token
    const b = (await t.call<{ token: string }>('POST', '/support/guest')).json.token
    await t.call('POST', '/support/guest/messages', { guest: a, body: { text: 'от гостя А' } })
    assert.deepEqual((await t.call<{ messages: Message[] }>('GET', '/support/guest/messages', { guest: b })).json.messages, [])
    assert.equal((await t.call('POST', '/support/guest/messages', { guest: a, body: { text: '   ' } })).status, 400)
    assert.equal((await t.call('POST', '/support/guest/messages', { guest: a, body: {} })).status, 400)
    // the guest token is not a session
    assert.equal((await t.call('GET', '/me/support/messages', { token: a })).status, 401)
  } finally { await t.close() }
})

test('support guest: a few new guests an hour per address, the messages limited as a player is', async () => {
  const t = await setup({ guestsPerHour: 2, perAccount: 2, perIp: 50 })
  try {
    const first = (await t.call<{ token: string }>('POST', '/support/guest')).json.token
    assert.equal((await t.call('POST', '/support/guest')).status, 201)
    assert.equal((await t.call('POST', '/support/guest')).status, 429)
    assert.equal((await t.call('POST', '/support/guest/messages', { guest: first, body: { text: '1' } })).status, 201)
    assert.equal((await t.call('POST', '/support/guest/messages', { guest: first, body: { text: '2' } })).status, 201)
    assert.equal((await t.call('POST', '/support/guest/messages', { guest: first, body: { text: '3' } })).status, 429)
  } finally { await t.close() }
})
