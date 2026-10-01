import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { createOwnerAppLink, OWNER_APP_CHANNEL, type OwnerAppLink } from '../services/ownerApp.js'

const password = 'correct horse battery'

/** A fake parentPort with the owner app's side answering like electron/apiChannel.ts. */
function fakeOwnerApp(answer: (type: string, payload: unknown) => { ok: true; data: unknown } | { ok: false; error: string } | null) {
  const listeners: Array<(event: { data: unknown }) => void> = []
  const sent: Array<Record<string, unknown>> = []
  const port = {
    postMessage(message: unknown) {
      const value = message as Record<string, unknown>
      sent.push(value)
      if (typeof value.id !== 'number') return
      const reply = answer(String(value.type), value.payload)
      if (!reply) return // never answers
      setTimeout(() => { for (const listener of listeners) listener({ data: { channel: OWNER_APP_CHANNEL, replyTo: value.id, ...reply } }) }, 1)
    },
    on(_event: 'message', listener: (event: { data: unknown }) => void) { listeners.push(listener) },
  }
  return { link: createOwnerAppLink(port), sent }
}

async function setup(link?: OwnerAppLink) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, ...(link ? { ownerApp: link } : {}) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) as Record<string, unknown> } catch { /* an HTML 404 */ }
    return { status: response.status, json, headers: response.headers }
  }
  const login = async (email: string) => ((await call('POST', '/accounts/login', undefined, { email, password })).json as { token: string }).token
  const register = async (email: string) => ((await call('POST', '/accounts/register', undefined, { email, password })).json as { token: string }).token
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { db, call, login, register, close }
}

const STATUS = { phase: 'idle', message: 'установлена последняя версия', current: { version: '0.5.5', build: 2000, commit: 'abc' }, history: [] }

test('update status: owner only (401 / 404), no-store, from the owner app', async () => {
  const app = fakeOwnerApp((type) => (type === 'self-update:status' ? { ok: true, data: STATUS } : null))
  const api = await setup(app.link)
  try {
    assert.equal((await api.call('GET', '/accounts/me/admin/update')).status, 401)
    const stranger = await api.register('player@example.com')
    assert.equal((await api.call('GET', '/accounts/me/admin/update', stranger)).status, 404)
    const owner = await api.login('owner@example.com')
    const answer = await api.call('GET', '/accounts/me/admin/update', owner)
    assert.equal(answer.status, 200)
    assert.equal(answer.headers.get('cache-control'), 'no-store')
    assert.deepEqual(answer.json, { available: true, status: STATUS })
    assert.ok(app.sent.some((message) => message.type === 'self-update:status' && message.channel === OWNER_APP_CHANNEL))
  } finally { await api.close() }
})

test('«Проверить сейчас» and «Откатить» go to the owner app; rollback needs { confirm: true }; both are audited', async () => {
  const app = fakeOwnerApp((type) => {
    if (type === 'self-update:check') return { ok: true, data: { ...STATUS, phase: 'checking' } }
    if (type === 'self-update:rollback') return { ok: false, error: 'Нет сохранённой предыдущей версии' }
    return { ok: true, data: STATUS }
  })
  const api = await setup(app.link)
  try {
    const owner = await api.login('owner@example.com')
    const checked = await api.call('POST', '/accounts/me/admin/update/check', owner, {})
    assert.equal(checked.status, 200)
    assert.equal((checked.json.status as { phase: string }).phase, 'checking')
    assert.equal((await api.call('POST', '/accounts/me/admin/update/rollback', owner, {})).status, 400)
    assert.ok(!app.sent.some((message) => message.type === 'self-update:rollback'))
    const rollback = await api.call('POST', '/accounts/me/admin/update/rollback', owner, { confirm: true })
    assert.equal(rollback.status, 409)
    assert.equal(rollback.json.error, 'Нет сохранённой предыдущей версии')
    assert.deepEqual(app.sent.find((message) => message.type === 'self-update:rollback')?.payload, { confirm: true })
    const audit = (await api.call('GET', '/accounts/me/admin/audit', owner)).json as { entries: Array<{ action: string }> }
    assert.ok(audit.entries.some((entry) => entry.action === 'server.update-check'))
    // A failed rollback is not logged as done.
    assert.ok(!audit.entries.some((entry) => entry.action === 'server.rollback'))
  } finally { await api.close() }
})

test('checks are rate-limited per owner', async () => {
  const app = fakeOwnerApp(() => ({ ok: true, data: STATUS }))
  const api = await setup(app.link)
  try {
    const owner = await api.login('owner@example.com')
    for (let index = 0; index < 6; index += 1) assert.equal((await api.call('POST', '/accounts/me/admin/update/check', owner, {})).status, 200)
    const limited = await api.call('POST', '/accounts/me/admin/update/check', owner, {})
    assert.equal(limited.status, 429)
    assert.ok(limited.headers.get('retry-after'))
  } finally { await api.close() }
})

test('without the owner app (server run on its own) the tab says it is not available; no upload routes exist', async () => {
  const api = await setup(createOwnerAppLink(undefined))
  try {
    const owner = await api.login('owner@example.com')
    const answer = await api.call('GET', '/accounts/me/admin/update', owner)
    assert.equal(answer.status, 200)
    assert.equal(answer.json.available, false)
    assert.match(String(answer.json.reason), /ноутбуке-сервере/)
    // Releases come only from the laptop's own download (electron/selfUpdate.ts): nothing can be uploaded here.
    for (const path of ['/accounts/me/admin/update/upload', '/accounts/me/admin/update/parts/RaidOS.part0', '/accounts/me/admin/update/apply']) {
      assert.equal((await api.call('POST', path, owner, {})).status, 404)
    }
  } finally { await api.close() }
})

test('an owner app that never answers times out with an error, not a hang', async () => {
  const listeners: Array<(event: { data: unknown }) => void> = []
  const link = createOwnerAppLink({ postMessage() {}, on(_event, listener) { listeners.push(listener) } })
  await assert.rejects(link.request('self-update:status', undefined, 50), /не ответило/)
  void listeners
})

test('errors are reported to the owner app with the stack but without query strings', async () => {
  const app = fakeOwnerApp(() => null)
  const { reportErrorToOwnerApp } = await import('../services/ownerApp.js')
  reportErrorToOwnerApp('5xx', new TypeError('boom'), { method: 'GET', path: '/v1/x?token=secret', status: 500 }, app.link)
  const event = app.sent.at(-1)!
  assert.equal(event.type, 'error-report')
  const payload = event.payload as Record<string, unknown>
  assert.equal(payload.name, 'TypeError')
  assert.equal(payload.path, '/v1/x')
  assert.match(String(payload.stack), /TypeError: boom/)
  // The process-wide link has no parent in tests: nothing is sent and nothing throws.
  reportErrorToOwnerApp('exception', new Error('x'))
})
