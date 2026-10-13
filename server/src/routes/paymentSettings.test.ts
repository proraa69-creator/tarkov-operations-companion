import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import type { OwnerAppLink } from '../services/ownerApp.js'

const YOO = '/v1/accounts/me/admin/payment-settings/yookassa'
const yooInput = { shopId: '12345', monthPrice: 850, receipts: true, streamerPercent: 10, autopay: false }
const yooSettings = { ...yooInput, hasKey: true }
const yooEnv = { YOOKASSA_SHOP_ID: '12345', YOOKASSA_SECRET_KEY: 'test_dummy-secret', TARKOV_PRICE_MONTH_RUB: '850', YOOKASSA_RECEIPTS: '1', TARKOV_STREAMER_PERCENT: '10', TARKOV_PUBLIC_URL: 'https://raidos.app' }
const password = 'correct horse battery'

async function setup(failSave = false, available = true) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const requests: Array<{ type: string; payload: unknown }> = []
  const link: OwnerAppLink = {
    available,
    post() {},
    async request<T>(type: string, payload?: unknown): Promise<T> {
      requests.push({ type, payload })
      if (type === 'payments:yookassa:get') return { ...yooSettings, secretKey: yooEnv.YOOKASSA_SECRET_KEY } as T
      if (type === 'payments:yookassa:set') {
        if (failSave) throw new Error('Storage failed')
        return { settings: { ...yooSettings, secretKey: yooEnv.YOOKASSA_SECRET_KEY }, env: yooEnv } as T
      }
      throw new Error(`Unexpected owner app request: ${type}`)
    },
  }
  const progress = new ProgressStore(':memory:')
  const server = createApi(progress, undefined, accounts, { payments, ownerApp: link }).listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.on('listening', resolve))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(root + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, json: await response.json(), headers: response.headers }
  }
  const owner = (await call('POST', '/v1/accounts/login', undefined, { email: 'owner@example.com', password })).json.token as string
  const stranger = (await call('POST', '/v1/accounts/register', undefined, { email: 'player@example.com', password })).json.token as string
  const close = async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close() }
  return { owner, stranger, payments, requests, call, close }
}

test('standalone server clearly reports unavailable owner app without creating payment settings', async () => {
  const t = await setup(false, false)
  try {
    assert.equal((await t.call('GET', YOO, t.owner)).status, 409)
    assert.equal(t.requests.length, 0)
  } finally { await t.close() }
})

test('Yookassa settings require owner access, reject secret controls and keep stored keys out of responses and audit', async () => {
  const t = await setup()
  try {
    for (const method of ['GET', 'PUT']) {
      assert.equal((await t.call(method, YOO)).status, 401)
      assert.equal((await t.call(method, YOO, t.stranger)).status, 404)
    }
    const initial = await t.call('GET', YOO, t.owner)
    assert.equal(initial.status, 200)
    assert.deepEqual(initial.json, { settings: yooSettings, configured: false })
    const input = yooInput
    for (const bad of [{ ...input, secretKey: 'never-send' }, { ...input, clearKey: true }, { ...input, monthPrice: 0 }, { ...input, shopId: 'bad' }]) assert.equal((await t.call('PUT', YOO, t.owner, bad)).status, 400)
    const saved = await t.call('PUT', YOO, t.owner, input)
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json, { settings: yooSettings, configured: true })
    assert.equal(t.payments.config?.secretKey, yooEnv.YOOKASSA_SECRET_KEY)
    assert.equal(t.payments.config?.monthPrice, 850)
    assert.deepEqual(t.requests.at(-1), { type: 'payments:yookassa:set', payload: input })
    const audit = await t.call('GET', '/v1/accounts/me/admin/audit', t.owner)
    assert.equal(audit.json.entries[0].action, 'payments.yookassa-settings')
    assert.equal(JSON.stringify([saved.json, audit.json]).includes(yooEnv.YOOKASSA_SECRET_KEY), false)
  } finally { await t.close() }
})

test('Yookassa failed saves preserve active payment configuration', async () => {
  const t = await setup(true)
  try {
    const config = { shopId: '12345', secretKey: 'test_existing-secret', monthPrice: 600, receipts: false, streamerPercent: 10, publicUrl: 'https://raidos.app' }
    t.payments.configureYookassa(config)
    const input = yooInput
    assert.equal((await t.call('PUT', YOO, t.owner, input)).status, 502)
    assert.deepEqual(t.payments.config, config)
  } finally { await t.close() }
})
