import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { AccountStore, createAccountsHandlers, type AccountView } from '../services/accountStore.js'
import { createPhoneHandlers, normalizePhone, PhoneAuthService, CODE_TTL_MS, RESEND_COOLDOWN_MS } from '../services/phoneAuth.js'
import { FakeSmsSender, createSmsSender, smsConfigFromEnv, type FetchLike } from '../services/sms/index.js'
import { createApi } from '../app.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const PHONE = '+79991234567'
const auth = (token: string) => `Bearer ${token}`

function setup(options: { sms?: boolean; dailyLimit?: number; phoneDailyLimit?: number; owners?: string[]; limits?: Parameters<typeof createPhoneHandlers>[2] } = {}) {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const accounts = new AccountStore({ now, ownerEmails: options.owners ?? [] })
  const sender = new FakeSmsSender()
  const logs: string[] = []
  const phones = new PhoneAuthService(accounts, { sender: options.sms === false ? undefined : sender, now, limits: { dailyLimit: options.dailyLimit ?? 100, phoneDailyLimit: options.phoneDailyLimit ?? 5 }, log: (line) => logs.push(line) })
  const api = createAccountsHandlers(accounts, { now })
  const phone = createPhoneHandlers(accounts, phones, { now, ...options.limits })
  const register = async (email: string) => (await api.register({ ip: 'reg', body: { email, password } })).body as { token: string; account: AccountView }
  /** Registers and binds a verified number. */
  const withPhone = async (email: string, number = PHONE) => {
    const { token } = await register(email)
    const started = await phone.bindStart({ ip: 'bind', authorization: auth(token), body: { phone: number, password } })
    assert.equal(started.status, 200, JSON.stringify(started.body))
    const confirmed = await phone.bindConfirm({ ip: 'bind', authorization: auth(token), body: { challengeId: (started.body as { challengeId: string }).challengeId, code: sender.lastCode(number) } })
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
    clock += RESEND_COOLDOWN_MS
    return token
  }
  return { accounts, sender, phones, api, phone, logs, register, withPhone, advance: (ms: number) => { clock += ms } }
}

const challenge = (body: unknown) => (body as { challengeId: string }).challengeId

test('phone numbers are normalised to E.164 and limited to allowed countries', () => {
  assert.equal(normalizePhone('+7 (999) 123-45-67'), PHONE)
  assert.equal(normalizePhone('8 999 123 45 67'), PHONE)
  assert.equal(normalizePhone('79991234567'), PHONE)
  assert.equal(normalizePhone('+7 999 123 45'), undefined)
  assert.equal(normalizePhone('+44 7700 900123'), undefined)
  assert.equal(normalizePhone('+44 7700 900123', ['7', '44']), '+447700900123')
  assert.equal(normalizePhone('+7 999 123 45 67; DROP'), undefined)
  assert.equal(normalizePhone(79991234567), undefined)
})

test('without an SMS provider the phone features report off and refuse', async () => {
  const { phone, register } = setup({ sms: false })
  const config = await phone.config()
  assert.equal((config.body as { smsEnabled: boolean }).smsEnabled, false)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: PHONE } })).status, 503)
  assert.equal((await phone.resetStart({ ip: '1', body: { phone: PHONE } })).status, 503)
  const { token } = await register('a@example.com')
  assert.equal((await phone.bindStart({ ip: '1', authorization: auth(token), body: { phone: PHONE, password } })).status, 503)
})

test('binding needs the current password and the SMS code; the view shows only a masked number', async () => {
  const { phone, sender, register, api } = setup()
  const { token } = await register('a@example.com')
  assert.equal((await phone.bindStart({ ip: '1', authorization: auth(token), body: { phone: PHONE, password: 'wrong password' } })).status, 403)
  assert.equal(sender.sent.length, 0)
  const started = await phone.bindStart({ ip: '1', authorization: auth(token), body: { phone: '8 999 123-45-67', password } })
  assert.equal(started.status, 200)
  assert.equal(sender.sent.length, 1)
  assert.equal(sender.sent[0].phone, PHONE)
  const code = sender.lastCode()!
  assert.match(code, /^\d{6}$/)
  assert.ok(!JSON.stringify(started.body).includes(code))
  // A code for another purpose or another account does not bind.
  assert.equal((await phone.login({ ip: '1', body: { challengeId: challenge(started.body), code } })).status, 400)
  const confirmed = await phone.bindConfirm({ ip: '1', authorization: auth(token), body: { challengeId: challenge(started.body), code } })
  assert.equal(confirmed.status, 200)
  const view = confirmed.body as AccountView
  assert.equal(view.phone?.masked, '+7 ••• •••-45-67')
  assert.ok(!JSON.stringify(view).includes('9991234567'))
  // The code is used up.
  assert.equal((await phone.bindConfirm({ ip: '1', authorization: auth(token), body: { challengeId: challenge(started.body), code } })).status, 400)
  // Removing needs the password.
  assert.equal((await phone.remove({ authorization: auth(token), body: { password: 'nope nope' } })).status, 403)
  const removed = await phone.remove({ authorization: auth(token), body: { password } })
  assert.equal((removed.body as AccountView).phone, undefined)
  assert.equal(((await api.me({ authorization: auth(token) })).body as AccountView).phone, undefined)
})

test('a verified number belongs to one account only', async () => {
  const { phone, sender, register, withPhone, advance } = setup()
  await withPhone('first@example.com')
  const { token } = await register('second@example.com')
  const started = await phone.bindStart({ ip: '2', authorization: auth(token), body: { phone: PHONE, password } })
  assert.equal(started.status, 200)
  const confirmed = await phone.bindConfirm({ ip: '2', authorization: auth(token), body: { challengeId: challenge(started.body), code: sender.lastCode() } })
  assert.equal(confirmed.status, 409)
  advance(RESEND_COOLDOWN_MS)
})

test('sign-in by phone: code → session; wrong codes are limited and the code expires', async () => {
  const { phone, sender, withPhone, advance, accounts } = setup()
  await withPhone('a@example.com')
  const before = sender.sent.length
  const started = await phone.loginStart({ ip: '1', body: { phone: '+7 999 123 45 67' } })
  assert.equal(started.status, 200)
  assert.equal(sender.sent.length, before + 1)
  const code = sender.lastCode()!
  const wrong = code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 4; i += 1) assert.equal((await phone.login({ ip: '1', body: { challengeId: challenge(started.body), code: wrong } })).status, 400)
  // The fifth wrong try kills the code: even the right one no longer works.
  assert.equal((await phone.login({ ip: '1', body: { challengeId: challenge(started.body), code: wrong } })).status, 400)
  assert.equal((await phone.login({ ip: '1', body: { challengeId: challenge(started.body), code } })).status, 400)

  advance(RESEND_COOLDOWN_MS)
  const again = await phone.loginStart({ ip: '1', body: { phone: PHONE } })
  const ok = await phone.login({ ip: '1', body: { challengeId: challenge(again.body), code: sender.lastCode() } })
  assert.equal(ok.status, 200)
  const { token } = ok.body as { token: string }
  assert.ok(accounts.authenticate(token))

  advance(RESEND_COOLDOWN_MS)
  const late = await phone.loginStart({ ip: '1', body: { phone: PHONE } })
  advance(CODE_TTL_MS + 1)
  assert.equal((await phone.login({ ip: '1', body: { challengeId: challenge(late.body), code: sender.lastCode() } })).status, 400)
})

test('unknown numbers get the same answer and no SMS (anti-enumeration)', async () => {
  const { phone, sender, withPhone } = setup()
  await withPhone('a@example.com')
  const sent = sender.sent.length
  const known = await phone.loginStart({ ip: '1', body: { phone: PHONE } })
  const unknown = await phone.loginStart({ ip: '1', body: { phone: '+79990000000' } })
  assert.equal(known.status, unknown.status)
  assert.deepEqual(Object.keys(known.body as object).sort(), Object.keys(unknown.body as object).sort())
  assert.equal(sender.sent.length, sent + 1)
  assert.equal(sender.sent.at(-1)!.phone, PHONE)
  // Checking a code for the unknown number fails exactly like a wrong code.
  const knownWrong = await phone.login({ ip: '1', body: { challengeId: challenge(known.body), code: '123456' === sender.lastCode() ? '654321' : '123456' } })
  const unknownWrong = await phone.login({ ip: '1', body: { challengeId: challenge(unknown.body), code: '123456' } })
  assert.deepEqual(knownWrong, unknownWrong)
  // Cooldown applies to unknown numbers too, so it does not reveal anything either.
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: '+79990000000' } })).status, 429)
  const reset = await phone.resetStart({ ip: '1', body: { phone: '+79990000001' } })
  assert.equal(reset.status, 200)
  assert.equal(sender.sent.length, sent + 1)
})

test('owner accounts are excluded from SMS sign-in and reset (no SMS, same answer)', async () => {
  const { phone, sender, accounts, api, advance } = setup({ owners: [] })
  // Register first, then list as owner (the server refuses registering a listed e-mail).
  const { token } = (await api.register({ ip: '0', body: { email: 'boss@example.com', password } })).body as { token: string }
  const started = await phone.bindStart({ ip: '0', authorization: auth(token), body: { phone: PHONE, password } })
  await phone.bindConfirm({ ip: '0', authorization: auth(token), body: { challengeId: challenge(started.body), code: sender.lastCode() } })
  const ownerAccounts = new AccountStore({ db: accounts.database, ownerEmails: ['boss@example.com'] })
  const ownerSender = new FakeSmsSender()
  let clock = Date.parse('2026-10-01T11:00:00.000Z')
  const ownerPhones = new PhoneAuthService(ownerAccounts, { sender: ownerSender, now: () => clock })
  const handlers = createPhoneHandlers(ownerAccounts, ownerPhones, { now: () => clock })
  const login = await handlers.loginStart({ ip: '1', body: { phone: PHONE } })
  assert.equal(login.status, 200)
  clock += RESEND_COOLDOWN_MS
  const reset = await handlers.resetStart({ ip: '1', body: { phone: PHONE } })
  assert.equal(reset.status, 200)
  assert.equal(ownerSender.sent.length, 0)
  assert.equal((await handlers.reset({ ip: '1', body: { challengeId: challenge(reset.body), code: '123456', password: 'new password 1' } })).status, 400)
  advance(0)
})

test('blocked accounts get no SMS and cannot sign in by phone', async () => {
  const { phone, sender, withPhone, accounts, advance } = setup()
  await withPhone('a@example.com')
  const started = await phone.loginStart({ ip: '1', body: { phone: PHONE } })
  const code = sender.lastCode()!
  const sent = sender.sent.length
  accounts.database.prepare("UPDATE accounts SET blocked_at = 1 WHERE email = 'a@example.com'").run()
  const answer = await phone.login({ ip: '1', body: { challengeId: challenge(started.body), code } })
  assert.equal(answer.status, 403)
  advance(RESEND_COOLDOWN_MS)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: PHONE } })).status, 200)
  assert.equal(sender.sent.length, sent)
})

test('password reset by phone sets the new password and revokes every session', async () => {
  const { phone, sender, withPhone, api, accounts } = setup()
  const oldToken = await withPhone('a@example.com')
  const started = await phone.resetStart({ ip: '1', body: { phone: PHONE } })
  assert.match(sender.sent.at(-1)!.text, /сброса пароля/)
  const code = sender.lastCode()!
  assert.equal((await phone.reset({ ip: '1', body: { challengeId: challenge(started.body), code, password: 'short' } })).status, 400)
  // A short password did not burn the code.
  const done = await phone.reset({ ip: '1', body: { challengeId: challenge(started.body), code, password: 'brand new password' } })
  assert.equal(done.status, 200)
  assert.equal(accounts.authenticate(oldToken), undefined)
  assert.ok(accounts.authenticate((done.body as { token: string }).token))
  assert.equal((await api.login({ ip: '9', body: { email: 'a@example.com', password } })).status, 401)
  assert.equal((await api.login({ ip: '9', body: { email: 'a@example.com', password: 'brand new password' } })).status, 200)
  // A sign-in code cannot be used for a reset.
  assert.equal((await phone.reset({ ip: '1', body: { challengeId: challenge(started.body), code, password: 'another password' } })).status, 400)
})

test('resend cooldown, per-number daily cap, per-IP limit and the global daily budget', async () => {
  const { phone, withPhone, advance, sender } = setup({ phoneDailyLimit: 3, dailyLimit: 4, limits: { limits: { start: 100, startDaily: 100 } } })
  await withPhone('a@example.com') // 1 SMS of the budget, 1 request of the number
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: PHONE } })).status, 200)
  const cooldown = await phone.loginStart({ ip: '1', body: { phone: PHONE } })
  assert.equal(cooldown.status, 429)
  assert.ok(Number(cooldown.headers?.['Retry-After']) > 0)
  advance(RESEND_COOLDOWN_MS)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: PHONE } })).status, 200)
  advance(RESEND_COOLDOWN_MS)
  // Third request of the number in a day → the daily cap.
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: PHONE } })).status, 429)
  assert.equal(sender.sent.length, 3)

  // The budget: 3 sent, limit 4 → one more SMS, then everything (known or not) answers 503.
  const { token } = await (async () => ({ token: await withPhone('b@example.com', '+79990001122') }))()
  void token
  assert.equal(sender.sent.length, 4)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: '+79990001122' } })).status, 503)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: '+79995550000' } })).status, 503)
  advance(24 * 60 * 60 * 1000)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: '+79990001122' } })).status, 200)

  const perIp = setup()
  for (let i = 0; i < 5; i += 1) assert.equal((await perIp.phone.loginStart({ ip: '7', body: { phone: `+7999000000${i}` } })).status, 200)
  assert.equal((await perIp.phone.loginStart({ ip: '7', body: { phone: '+79990000009' } })).status, 429)
  assert.equal((await perIp.phone.loginStart({ ip: '8', body: { phone: '+79990000009' } })).status, 200)
})

test('provider failures are logged without numbers, codes or keys', async () => {
  const { phone, sender, register, logs, withPhone, phones } = setup()
  await withPhone('a@example.com')
  sender.fail = true
  const { token } = await register('b@example.com')
  assert.equal((await phone.bindStart({ ip: '1', authorization: auth(token), body: { phone: '+79990001122', password } })).status, 502)
  assert.equal((await phone.loginStart({ ip: '1', body: { phone: PHONE } })).status, 200)
  await phones.settled()
  assert.equal(logs.length, 2)
  for (const line of logs) assert.ok(!/\d{6}|9991234567|9990001122/.test(line), line)
})

test('change password: needs the current one and ends other sessions', async () => {
  const { api, register, accounts } = setup()
  const { token } = await register('a@example.com')
  const other = (await api.login({ ip: '1', body: { email: 'a@example.com', password } })).body as { token: string }
  assert.equal((await api.changePassword({ authorization: auth(token), body: { currentPassword: 'wrong one', newPassword: 'new password 1' } })).status, 403)
  const changed = await api.changePassword({ authorization: auth(token), body: { currentPassword: password, newPassword: 'new password 1' } })
  assert.equal(changed.status, 200)
  assert.equal(accounts.authenticate(token), undefined)
  assert.equal(accounts.authenticate(other.token), undefined)
  assert.ok(accounts.authenticate((changed.body as { token: string }).token))
})

test('SMS providers build the documented requests and read the answers', async () => {
  const calls: Array<{ url: string; body?: string; headers?: Record<string, string> }> = []
  const reply = (data: unknown, status = 200): FetchLike => async (url, init) => { calls.push({ url, body: init?.body, headers: init?.headers }); return { ok: status < 400, status, json: async () => data } }
  assert.equal(smsConfigFromEnv({}), undefined)
  assert.equal(smsConfigFromEnv({ TARKOV_SMS_PROVIDER: 'smsc', TARKOV_SMS_API_KEY: 'x' }), undefined, 'SMSC needs a login')
  const ru = smsConfigFromEnv({ TARKOV_SMS_PROVIDER: 'smsru', TARKOV_SMS_API_KEY: 'KEY-1', TARKOV_SMS_SENDER: 'RaidOS', TARKOV_SMS_DAILY_LIMIT: '50', TARKOV_SMS_COUNTRIES: '+7, 375' })!
  assert.deepEqual([ru.provider, ru.dailyLimit, ru.countries], ['smsru', 50, ['7', '375']])

  await createSmsSender(ru, reply({ status: 'OK', status_code: 100, sms: { 79991234567: { status: 'OK', status_code: 100, sms_id: 'a-1' } } })).send(PHONE, 'hi 123456')
  assert.equal(calls[0].url, 'https://sms.ru/sms/send')
  const ruBody = new URLSearchParams(calls[0].body)
  assert.deepEqual([ruBody.get('api_id'), ruBody.get('to'), ruBody.get('from'), ruBody.get('json')], ['KEY-1', '79991234567', 'RaidOS', '1'])
  await assert.rejects(createSmsSender(ru, reply({ status: 'ERROR', status_code: 200 })).send(PHONE, 'x'), (error: Error & { code?: string }) => error.code === '200' && !error.message.includes('KEY-1'))
  await assert.rejects(createSmsSender(ru, reply({ status: 'OK', sms: { 79991234567: { status: 'ERROR', status_code: 207 } } })).send(PHONE, 'x'))

  const smsc = smsConfigFromEnv({ TARKOV_SMS_PROVIDER: 'smsc', TARKOV_SMS_API_KEY: 'pw', TARKOV_SMS_LOGIN: 'me' })!
  await createSmsSender(smsc, reply({ id: 7, cnt: 1 })).send(PHONE, 'hi')
  const smscBody = new URLSearchParams(calls.at(-1)!.body)
  assert.equal(calls.at(-1)!.url, 'https://smsc.ru/sys/send.php')
  assert.deepEqual([smscBody.get('login'), smscBody.get('psw'), smscBody.get('phones'), smscBody.get('fmt'), smscBody.get('charset')], ['me', 'pw', '79991234567', '3', 'utf-8'])
  await assert.rejects(createSmsSender(smsc, reply({ error: 'authorise error', error_code: 2 })).send(PHONE, 'x'))

  const aero = smsConfigFromEnv({ TARKOV_SMS_PROVIDER: 'smsaero', TARKOV_SMS_API_KEY: 'k', TARKOV_SMS_LOGIN: 'me@example.com' })!
  await createSmsSender(aero, reply({ success: true, data: { id: 5 } })).send(PHONE, 'hi')
  assert.equal(calls.at(-1)!.url, 'https://gate.smsaero.ru/v2/sms/send')
  assert.equal(calls.at(-1)!.headers?.authorization, `Basic ${Buffer.from('me@example.com:k').toString('base64')}`)
  assert.equal(new URLSearchParams(calls.at(-1)!.body).get('sign'), 'SMS Aero')
  await assert.rejects(createSmsSender(aero, reply({ success: false, message: 'Validation error' }, 400)).send(PHONE, 'x'))
})

test('HTTP: auth-config, per-visitor limits behind the local proxy, admin test SMS', async () => {
  const accounts = new AccountStore({ ownerEmails: [] })
  const sender = new FakeSmsSender()
  const phones = new PhoneAuthService(accounts, { sender })
  const previous = process.env.TARKOV_ADMIN_TOKEN
  process.env.TARKOV_ADMIN_TOKEN = 'a'.repeat(40)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { phones }).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve) => server.on('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const config = await (await fetch(`${base}/accounts/auth-config`)).json() as { smsEnabled: boolean; countries: string[] }
    assert.deepEqual([config.smsEnabled, config.countries], [true, ['7']])
    // The site proxy sends each visitor's address: one visitor's limit does not block the next one.
    const start = (ip: string, n: number) => fetch(`${base}/accounts/phone/login/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ phone: `+7999111000${n}` }) })
    for (let i = 0; i < 5; i += 1) assert.equal((await start('203.0.113.1', i)).status, 200)
    assert.equal((await start('203.0.113.1', 5)).status, 429)
    assert.equal((await start('203.0.113.2', 6)).status, 200)
    // Admin test SMS (owner's laptop app only).
    assert.equal((await fetch(`${base}/admin/sms/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })).status, 404)
    const test = await fetch(`${base}/admin/sms/test`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${'a'.repeat(40)}` }, body: JSON.stringify({ phone: PHONE }) })
    assert.equal(test.status, 200)
    assert.equal(sender.sent.at(-1)!.phone, PHONE)
    const status = await (await fetch(`${base}/admin/sms`, { headers: { authorization: `Bearer ${'a'.repeat(40)}` } })).json() as { smsEnabled: boolean; sentToday: number }
    assert.deepEqual([status.smsEnabled, status.sentToday], [true, 1])
  } finally {
    server.close()
    if (previous === undefined) delete process.env.TARKOV_ADMIN_TOKEN
    else process.env.TARKOV_ADMIN_TOKEN = previous
  }
})
