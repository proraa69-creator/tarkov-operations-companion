import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, COUNTRY_ALREADY_SET, COUNTRY_INVALID_MESSAGE, MANUAL_COUNTRY_MESSAGE } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { cleanManualCountry, countryByName, MANUAL_COUNTRY_CODE, regionOf } from '../../../src/shared/countries.js'

/**
 * «Укажите страну» (owner, 15.10.2026: «у тех у кого не указана страна, сделай всплывающее окно о том что "укажите
 * страну"… проконтролируй что бы они смогли выбрать страну и что бы был выбор вручную написать»).
 */
const password = 'correct horse battery'

async function setup() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  /** An account from before the question at registration (13.10.2026): no country. */
  const oldAccount = async (email: string) => {
    const token = (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: 'DE' })).json.token
    db.prepare('UPDATE accounts SET country = NULL WHERE email = ?').run(email)
    return token
  }
  return { db, accounts, call, login, oldAccount, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

type View = { country?: string; countryOther?: string; needsCountry?: true }

test('manual country text: trimmed, letters / spaces / hyphens only, at most 60; a known name maps to its code', () => {
  assert.equal(cleanManualCountry('  Республика   Атлантида  '), 'Республика Атлантида')
  assert.equal(cleanManualCountry('Côte d’Ivoire'), undefined, 'an apostrophe is not a letter, space or hyphen')
  assert.equal(cleanManualCountry('Sankt—Petersburg'), 'Sankt-Petersburg', 'dashes read as a hyphen')
  for (const bad of ['', '   ', '<script>', 'Land 42', 'a'.repeat(61), '-Land', 'Land-', 42, null]) assert.equal(cleanManualCountry(bad), undefined, String(bad))
  assert.equal(cleanManualCountry('a'.repeat(60)), 'a'.repeat(60))
  assert.equal(countryByName('казахстан'), 'KZ')
  assert.equal(countryByName('Kazakhstan'), 'KZ')
  assert.equal(countryByName('США'), 'US')
  assert.equal(countryByName('kz'), 'KZ')
  assert.equal(countryByName('Казах'), undefined, 'only a whole name')
  assert.equal(countryByName('Атлантида'), undefined)
  assert.equal(regionOf(MANUAL_COUNTRY_CODE), 'other')
})

test('the gate: only an account without a country is asked; a listed code is stored once and cannot be changed through it', async () => {
  const t = await setup()
  try {
    const fresh = (await t.call<{ token: string }>('POST', '/accounts/register', undefined, { email: 'new@example.com', password, country: 'RU' })).json.token
    assert.equal((await t.call<View>('GET', '/accounts/me', fresh)).json.needsCountry, undefined, 'registered with a country: no window')
    assert.equal((await t.call('POST', '/accounts/me/initial-country', fresh, { country: 'DE' })).status, 409, 'a set country is not changed here')

    const old = await t.oldAccount('old@example.com')
    const before = await t.call<View>('GET', '/accounts/me', old)
    assert.equal(before.json.needsCountry, true)
    assert.equal(before.json.country, undefined)

    assert.equal((await t.call('POST', '/accounts/me/initial-country', undefined, { country: 'KZ' })).status, 401)
    const unknown = await t.call<{ error: string }>('POST', '/accounts/me/initial-country', old, { country: 'QQ' })
    assert.deepEqual([unknown.status, unknown.json.error], [400, COUNTRY_INVALID_MESSAGE])
    assert.equal((await t.call('POST', '/accounts/me/initial-country', old, { country: 'KZ', other: 'Казахстан' })).status, 400, 'one of the two, not both')
    assert.equal((await t.call('POST', '/accounts/me/initial-country', old, { country: MANUAL_COUNTRY_CODE })).status, 400, 'XX only through the text')

    const saved = await t.call<View>('POST', '/accounts/me/initial-country', old, { country: 'kz' })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.country, 'KZ')
    assert.equal(saved.json.needsCountry, undefined)
    const again = await t.call<{ error: string }>('POST', '/accounts/me/initial-country', old, { country: 'RU' })
    assert.deepEqual([again.status, again.json.error], [409, COUNTRY_ALREADY_SET])
    assert.equal((await t.call<View>('GET', '/accounts/me', old)).json.country, 'KZ')
    const setAt = t.db.prepare("SELECT country_set_at FROM accounts WHERE email = 'old@example.com'").get() as { country_set_at: number | null }
    assert.ok(Number(setAt.country_set_at) > 0, 'when an account without a country got one is kept')
  } finally {
    await t.close()
  }
})

test('the gate: a country typed by hand is checked, stored as XX with the text (or the code it names) and counted in «Другие»', async () => {
  const t = await setup()
  try {
    const owner = await t.login('owner@example.com')
    const atlantis = await t.oldAccount('atlantis@example.com')
    const kazakh = await t.oldAccount('kazakh@example.com')
    await t.oldAccount('still-none@example.com')
    type Users = { users: Array<{ email: string; country?: string; countryOther?: string }>; regions: Record<string, number> }
    const regions = async () => (await t.call<Users>('GET', '/accounts/me/admin/users', owner)).json.regions
    const start = await regions()
    assert.deepEqual(start, { all: 4, russia: 1, cis: 0, world: 0, europe: 0, other: 0, none: 3 })

    for (const bad of ['<b>Земля</b>', 'Land 42', 'x'.repeat(61), '   ']) {
      const refused = await t.call<{ error: string }>('POST', '/accounts/me/initial-country', atlantis, { other: bad })
      assert.deepEqual([refused.status, refused.json.error], [400, MANUAL_COUNTRY_MESSAGE], bad)
    }
    const typed = await t.call<View>('POST', '/accounts/me/initial-country', atlantis, { other: '  Республика  Атлантида ' })
    assert.equal(typed.status, 200)
    assert.deepEqual([typed.json.country, typed.json.countryOther, typed.json.needsCountry], [MANUAL_COUNTRY_CODE, 'Республика Атлантида', undefined])
    // A known name typed by hand is that country, no text kept.
    const named = await t.call<View>('POST', '/accounts/me/initial-country', kazakh, { other: 'Kazakhstan' })
    assert.deepEqual([named.json.country, named.json.countryOther], ['KZ', undefined])

    // «Пользователи»: the region tabs count them (the typed one in «Другие»), the row shows the typed text.
    assert.deepEqual(await regions(), { all: 4, russia: 1, cis: 1, world: 1, europe: 0, other: 1, none: 1 })
    const other = await t.call<Users>('GET', '/accounts/me/admin/users?region=other', owner)
    assert.deepEqual(other.json.users.map((user) => [user.email, user.country, user.countryOther]), [['atlantis@example.com', MANUAL_COUNTRY_CODE, 'Республика Атлантида']])

    // A country once named is never changed by its player (owner, 16.10.2026), the typed one included.
    assert.equal((await t.call('PUT', '/accounts/me/country', atlantis, { country: 'DE' })).status, 409)
    assert.equal((await t.call('PUT', '/accounts/me/country', atlantis, { country: MANUAL_COUNTRY_CODE })).status, 400, 'XX is not a listed country')
  } finally {
    await t.close()
  }
})

test('the gate: the owner without a country is asked too, and the owner routes work after the answer', async () => {
  const t = await setup()
  try {
    t.db.prepare("UPDATE accounts SET country = NULL WHERE email = 'owner@example.com'").run()
    const owner = await t.login('owner@example.com')
    assert.equal((await t.call<View>('GET', '/accounts/me', owner)).json.needsCountry, true)
    assert.equal((await t.call('POST', '/accounts/me/initial-country', owner, { country: 'RU' })).status, 200)
    assert.equal((await t.call('GET', '/accounts/me/admin/users', owner)).status, 200)
    assert.equal((await t.call('GET', '/accounts/me/admin/announcement', owner)).status, 200)
  } finally {
    await t.close()
  }
})
