import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import type { OwnerAppLink } from '../services/ownerApp.js'

const BASE = '/v1/accounts/me/admin/payment-settings/lava'
const YOO = '/v1/accounts/me/admin/payment-settings/yookassa'
const yooSettings = { shopId: '12345', monthPrice: 850, receipts: true, streamerPercent: 10, autopay: false, hasKey: true }
const yooEnv = { YOOKASSA_SHOP_ID: '12345', YOOKASSA_SECRET_KEY: 'test_dummy-secret', TARKOV_PRICE_MONTH_RUB: '850', YOOKASSA_RECEIPTS: '1', TARKOV_STREAMER_PERCENT: '10', TARKOV_PUBLIC_URL: 'https://raidos.app' }
const password = 'correct horse battery'
const settings = { offerId: 'dde8abeb-b5ae-4a23-87b8-6bda4c7789e1', currency: 'USD', rubRate: 85, paymentMethod: '', hasApiKey: true, hasWebhookKey: true }
const env = { LAVA_API_KEY: 'lava-secret-api', LAVA_WEBHOOK_KEY: 'secret-webhook', LAVA_OFFER_ID: settings.offerId, LAVA_CURRENCY: 'USD', LAVA_RUB_RATE: '85' }

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
      if (type === 'payments:lava:set' && failSave) throw new Error('Cannot store secret-webhook')
      if (type === 'payments:yookassa:get') return { ...yooSettings, secretKey: yooEnv.YOOKASSA_SECRET_KEY } as T
      if (type === 'payments:yookassa:set') {
        if (failSave) throw new Error('Storage failed')
        return { settings: { ...yooSettings, secretKey: yooEnv.YOOKASSA_SECRET_KEY }, env: yooEnv } as T
      }
      const data = type === 'payments:lava:set' ? { settings: { ...settings, apiKey: env.LAVA_API_KEY }, env }
        : type === 'payments:lava:test' ? { ok: true, message: 'Вебхук работает', publicUrl: 'ok' }
        : { ...settings, apiKey: env.LAVA_API_KEY, webhookKey: env.LAVA_WEBHOOK_KEY }
      return data as T
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

test('Lava settings and diagnostics require an owner session and never leak stored keys', async () => {
  const t = await setup()
  try {
    for (const [method, path] of [['GET', BASE], ['PUT', BASE], ['POST', BASE + '/test']]) {
      assert.equal((await t.call(method!, path!)).status, 401)
      assert.equal((await t.call(method!, path!, t.stranger)).status, 404)
    }
    assert.equal(t.requests.length, 0)
    const result = await t.call('GET', BASE, t.owner)
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.deepEqual(result.json, { settings, configured: false })
    assert.equal(JSON.stringify(result.json).includes('secret'), false)
  } finally { await t.close() }
})

test('validated settings persist through the app, apply without restart, and leave secrets out of audit', async () => {
  const t = await setup()
  try {
    const input = { offerId: settings.offerId, currency: 'USD', rubRate: 85, paymentMethod: '' }
    const result = await t.call('PUT', BASE, t.owner, input)
    assert.equal(result.status, 200)
    assert.deepEqual(result.json, { settings, configured: true })
    assert.deepEqual(t.requests[0], { type: 'payments:lava:set', payload: input })
    assert.equal(t.payments.lava?.config.apiKey, env.LAVA_API_KEY)
    const audit = await t.call('GET', '/v1/accounts/me/admin/audit', t.owner)
    assert.equal(audit.json.entries[0].action, 'payments.lava-settings')
    assert.equal(JSON.stringify(audit.json).includes(env.LAVA_API_KEY), false)
    assert.equal(JSON.stringify(audit.json).includes(env.LAVA_WEBHOOK_KEY), false)
    // Website changes preserve stored keys; payload contains no key controls.
    assert.equal((await t.call('PUT', BASE, t.owner, input)).status, 200)
    assert.deepEqual(t.requests[1]?.payload, input)
    assert.equal(t.payments.lava?.config.webhookKey, env.LAVA_WEBHOOK_KEY)
  } finally { await t.close() }
})

test('bad input and arbitrary controls never reach the app; failed saves leave the running provider unchanged', async () => {
  const t = await setup(true)
  try {
    const good = { offerId: settings.offerId, currency: 'USD', rubRate: 85, paymentMethod: '' }
    for (const bad of [{ ...good, rubRate: 0 }, { ...good, offerId: 'not-an-offer' }, { ...good, currency: 'RUB' }, { ...good, clearKeys: true }, { ...good, apiKey: env.LAVA_API_KEY, webhookKey: env.LAVA_WEBHOOK_KEY }]) {
      assert.equal((await t.call('PUT', BASE, t.owner, bad)).status, 400)
    }
    assert.equal(t.requests.length, 0)
    const result = await t.call('PUT', BASE, t.owner, good)
    assert.equal(result.status, 502)
    assert.equal(JSON.stringify(result.json).includes('secret-webhook'), false)
    assert.equal(t.payments.lava, undefined)
  } finally { await t.close() }
})

test('diagnostics delegate to the safe app test and have a per-owner limit', async () => {
  const t = await setup()
  try {
    for (let i = 0; i < 3; i++) assert.equal((await t.call('POST', BASE + '/test', t.owner, {})).status, 200)
    assert.equal((await t.call('POST', BASE + '/test', t.owner, {})).status, 429)
    assert.ok(t.requests.every(request => request.type === 'payments:lava:test'))
    const audit = await t.call('GET', '/v1/accounts/me/admin/audit', t.owner)
    assert.equal(audit.json.entries[0].action, 'payments.lava-test')
  } finally { await t.close() }
})

test('standalone server clearly reports unavailable owner app without creating payment settings', async () => {
  const t = await setup(false, false)
  try {
    assert.equal((await t.call('GET', BASE, t.owner)).status, 409)
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
    const { hasKey, ...input } = yooSettings
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
    const { hasKey, ...input } = yooSettings
    assert.equal((await t.call('PUT', YOO, t.owner, input)).status, 502)
    assert.deepEqual(t.payments.config, config)
  } finally { await t.close() }
})
