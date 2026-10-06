import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { AccountStore, createAccountsHandlers, type AccountView } from '../services/accountStore.js'
import { createEmailHandlers, EmailAuthService, EMAIL_CODE_TTL_MS, EMAIL_RESEND_COOLDOWN_MS, MAX_WRONG_CODES_PER_DAY, REGISTRATION_TTL_MS } from '../services/emailAuth.js'
import { createEmailSender, DEFAULT_EMAIL_FROM, emailConfigFromEnv, FakeEmailSender, validFrom, type FetchLike } from '../services/email/index.js'
import { renderEmail } from '../services/email/templates.js'
import { openDatabase } from '../services/database.js'
import { createApi } from '../app.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'
const auth = (token: string) => `Bearer ${token}`
type Challenge = { challengeId: string; expiresAt: string; resendSeconds: number }
const challenge = (body: unknown) => (body as Challenge).challengeId

function setup(options: { email?: boolean; owners?: string[]; dailyLimit?: number; addressDailyLimit?: number; ipDailyLimit?: number; db?: ReturnType<typeof openDatabase>; authMax?: number } = {}) {
  let clock = Date.parse('2026-10-01T10:00:00.000Z')
  const now = () => clock
  const accounts = new AccountStore({ now, db: options.db, ownerEmails: options.owners ?? [] })
  const sender = new FakeEmailSender()
  const logs: string[] = []
  const emails = new EmailAuthService(accounts, {
    sender: options.email === false ? undefined : sender, now, log: (line) => logs.push(line),
    limits: { dailyLimit: options.dailyLimit ?? 500, addressDailyLimit: options.addressDailyLimit ?? 10, ipDailyLimit: options.ipDailyLimit ?? 1000 },
  })
  const api = createAccountsHandlers(accounts, { now, registrations: emails, authRateLimit: { max: options.authMax ?? 1000, windowMs: 15 * 60 * 1000 } })
  const email = createEmailHandlers(accounts, emails, { now, limits: { start: 1000, verify: 1000, account: 1000 } })
  /** Registration with the e-mail code: returns the session. */
  const signUp = async (address: string, referralCode?: string) => {
    const started = await api.register({ ip: 'reg', body: { email: address, password, ...(referralCode ? { referralCode } : {}) } })
    assert.equal(started.status, 202, JSON.stringify(started.body))
    await emails.settled()
    const confirmed = await email.registerConfirm({ ip: 'reg', body: { challengeId: challenge(started.body), code: sender.lastCode(address) } })
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body))
    clock += EMAIL_RESEND_COOLDOWN_MS
    return confirmed.body as { token: string; referralApplied: boolean; account: AccountView }
  }
  return { accounts, sender, emails, api, email, logs, signUp, advance: (ms: number) => { clock += ms }, now }
}

test('without an e-mail provider registration works as before and the e-mail routes refuse', async () => {
  const { api, email, accounts } = setup({ email: false })
  const registered = await api.register({ ip: '1', body: { email: 'a@example.com', password } })
  assert.equal(registered.status, 201)
  const view = (registered.body as { account: AccountView }).account
  assert.equal(view.emailVerifiedAt, undefined)
  assert.equal((await api.register({ ip: '1', body: { email: 'a@example.com', password } })).status, 409)
  assert.equal((await email.loginStart({ ip: '1', body: { email: 'a@example.com' } })).status, 503)
  assert.equal((await email.resetStart({ ip: '1', body: { email: 'a@example.com' } })).status, 503)
  const token = (registered.body as { token: string }).token
  assert.equal((await email.verifyStart({ ip: '1', authorization: auth(token) })).status, 503)
  assert.equal(accounts.hasAccount('a@example.com'), true)
})

test('registration with e-mail codes: no account and no session until the code is confirmed', async () => {
  const { api, email, sender, emails, accounts, advance } = setup()
  const started = await api.register({ ip: '1', body: { email: 'New@Example.com', password } })
  assert.equal(started.status, 202)
  const body = started.body as Challenge & { pending: boolean; message: string; token?: string }
  assert.equal(body.pending, true)
  assert.equal(body.token, undefined)
  assert.match(body.message, /Мы отправили код на e-mail/)
  assert.equal(accounts.hasAccount('new@example.com'), false)
  await emails.settled()
  assert.equal(sender.sent.length, 1)
  assert.equal(sender.sent[0].to, 'new@example.com')
  const code = sender.lastCode()!
  assert.match(code, /^\d{6}$/)
  assert.ok(!JSON.stringify(started.body).includes(code))
  assert.ok(sender.sent[0].html.includes(code))
  // Wrong code first: counted, nothing created.
  const wrong = await email.registerConfirm({ ip: '1', body: { challengeId: body.challengeId, code: code === '000000' ? '111111' : '000000' } })
  assert.equal(wrong.status, 400)
  assert.equal(accounts.hasAccount('new@example.com'), false)
  advance(EMAIL_CODE_TTL_MS - 1000)
  const confirmed = await email.registerConfirm({ ip: '1', body: { challengeId: body.challengeId, code } })
  assert.equal(confirmed.status, 201)
  const result = confirmed.body as { token: string; account: AccountView }
  assert.equal(result.account.email, 'new@example.com')
  assert.ok(result.account.emailVerifiedAt)
  assert.ok(accounts.authenticate(result.token))
  // The password from the registration form works; the code is used up.
  assert.equal((await api.login({ ip: '1', body: { email: 'new@example.com', password } })).status, 200)
  assert.equal((await email.registerConfirm({ ip: '1', body: { challengeId: body.challengeId, code } })).status, 400)
})

test('registration codes expire after 10 minutes; «resend» gives a new code for 30 minutes, then the registration is gone', async () => {
  const { api, email, sender, emails, accounts, advance } = setup()
  const started = await api.register({ ip: '1', body: { email: 'slow@example.com', password } })
  await emails.settled()
  const first = sender.lastCode()!
  advance(EMAIL_CODE_TTL_MS + 1)
  assert.equal((await email.registerConfirm({ ip: '1', body: { challengeId: challenge(started.body), code: first } })).status, 400)
  const resent = await email.registerResend({ ip: '1', body: { challengeId: challenge(started.body) } })
  assert.equal(resent.status, 200)
  assert.equal(challenge(resent.body), challenge(started.body))
  await emails.settled()
  const second = sender.lastCode()!
  assert.equal(sender.sent.length, 2)
  // Resend has its cooldown too.
  assert.equal((await email.registerResend({ ip: '1', body: { challengeId: challenge(started.body) } })).status, 429)
  if (first !== second) assert.equal((await email.registerConfirm({ ip: '1', body: { challengeId: challenge(started.body), code: first } })).status, 400)
  advance(REGISTRATION_TTL_MS)
  assert.equal((await email.registerResend({ ip: '1', body: { challengeId: challenge(started.body) } })).status, 400)
  assert.equal((await email.registerConfirm({ ip: '1', body: { challengeId: challenge(started.body), code: second } })).status, 400)
  assert.equal(accounts.hasAccount('slow@example.com'), false)
})

test('anti-enumeration: an existing e-mail gets the same answer, no account, no code — only a rate-limited notice', async () => {
  const { api, email, sender, emails, signUp, advance, accounts } = setup()
  await signUp('taken@example.com')
  const before = sender.sent.length
  const fresh = await api.register({ ip: '1', body: { email: 'fresh@example.com', password } })
  const taken = await api.register({ ip: '1', body: { email: 'taken@example.com', password: 'another password' } })
  assert.equal(taken.status, fresh.status)
  assert.deepEqual(Object.keys(taken.body as object).sort(), Object.keys(fresh.body as object).sort())
  assert.equal((taken.body as { message: string }).message, (fresh.body as { message: string }).message)
  assert.equal((taken.body as Challenge).resendSeconds, (fresh.body as Challenge).resendSeconds)
  await emails.settled()
  const toTaken = sender.to('taken@example.com').slice(-1)[0]
  assert.equal(sender.sent.length, before + 2)
  assert.match(toTaken.subject, /попытка регистрации/)
  assert.equal(/\b\d{6}\b/.test(toTaken.text), false, 'the notice carries no code')
  // The decoy challenge fails exactly like a wrong code, for every code.
  for (const code of ['000000', '123456']) {
    const answer = await email.registerConfirm({ ip: '1', body: { challengeId: challenge(taken.body), code } })
    assert.equal(answer.status, 400)
  }
  // Resend on the decoy answers the same and sends nothing; the old password still works.
  advance(EMAIL_RESEND_COOLDOWN_MS)
  const resent = await email.registerResend({ ip: '1', body: { challengeId: challenge(taken.body) } })
  assert.equal(resent.status, 200)
  // A second attempt within 24 hours: same answer, no second notice.
  advance(EMAIL_RESEND_COOLDOWN_MS)
  assert.equal((await api.register({ ip: '1', body: { email: 'taken@example.com', password } })).status, 202)
  await emails.settled()
  assert.equal(sender.to('taken@example.com').filter((entry) => /попытка регистрации/.test(entry.subject)).length, 1)
  assert.equal((await api.login({ ip: '1', body: { email: 'taken@example.com', password } })).status, 200)
  assert.equal(accounts.hasAccount('fresh@example.com'), false)
  // The cooldown counts both kinds of addresses the same way.
  assert.equal((await api.register({ ip: '1', body: { email: 'taken@example.com', password } })).status, 429)
  assert.equal((await api.register({ ip: '1', body: { email: 'fresh@example.com', password } })).status, 202)
  assert.equal((await api.register({ ip: '1', body: { email: 'fresh@example.com', password } })).status, 429)
})

test('owner e-mails: same answer as anybody; registering a listed address works only through its code', async () => {
  const { api, email, sender, emails } = setup({ owners: ['boss@example.com'] })
  const started = await api.register({ ip: '1', body: { email: 'boss@example.com', password } })
  assert.equal(started.status, 202)
  await emails.settled()
  const confirmed = await email.registerConfirm({ ip: '1', body: { challengeId: challenge(started.body), code: sender.lastCode('boss@example.com') } })
  assert.equal(confirmed.status, 201)
  assert.equal((confirmed.body as { account: AccountView }).account.owner, true)
})

test('owner rights: grandfathered accounts from before the migration keep them; later accounts need a confirmed e-mail', async () => {
  const db = openDatabase(':memory:')
  // A database from before e-mail codes: the account exists, the new columns do not.
  const old = new AccountStore({ db, ownerEmails: [] })
  await old.register('owner@example.com', password)
  await old.register('later-owner@example.com', password)
  db.exec('ALTER TABLE accounts DROP COLUMN email_verified_at')
  db.exec('ALTER TABLE accounts DROP COLUMN email_grandfathered')
  const migrated = new AccountStore({ db, ownerEmails: [] })
  await migrated.register('new-owner@example.com', password)
  // A restart must not grandfather anybody new.
  const t = setup({ db, owners: ['owner@example.com', 'new-owner@example.com'] })
  const login = async (address: string) => ((await t.api.login({ ip: '1', body: { email: address, password } })).body as { token: string }).token
  const grandfathered = (await t.api.me({ authorization: auth(await login('owner@example.com')) })).body as AccountView
  assert.equal(grandfathered.owner, true)
  assert.equal(grandfathered.emailVerifiedAt, undefined)
  const newToken = await login('new-owner@example.com')
  assert.equal(((await t.api.me({ authorization: auth(newToken) })).body as AccountView).owner, undefined)
  assert.equal((await t.api.ownerStreamers({ authorization: auth(newToken) })).status, 404)
  // Confirming the e-mail with a code grants the rights.
  const started = await t.email.verifyStart({ ip: '1', authorization: auth(newToken) })
  assert.equal(started.status, 200)
  const confirmed = await t.email.verifyConfirm({ ip: '1', authorization: auth(newToken), body: { challengeId: challenge(started.body), code: t.sender.lastCode('new-owner@example.com') } })
  assert.equal(confirmed.status, 200)
  assert.equal((confirmed.body as AccountView).owner, true)
  assert.ok((confirmed.body as AccountView).emailVerifiedAt)
  assert.equal((await t.api.ownerStreamers({ authorization: auth(newToken) })).status, 200)
})

test('confirming the e-mail of an existing account: own code only, 5 attempts, 409 when already confirmed', async () => {
  const t = setup()
  const other = await t.signUp('other@example.com')
  // An unconfirmed account, as registered while e-mail codes were off.
  await t.accounts.register('plain@example.com', password)
  const tokenValue = ((await t.api.login({ ip: '1', body: { email: 'plain@example.com', password } })).body as { token: string }).token
  const started = await t.email.verifyStart({ ip: '1', authorization: auth(tokenValue) })
  assert.equal(started.status, 200)
  const code = t.sender.lastCode('plain@example.com')!
  for (let i = 0; i < 4; i++) assert.equal((await t.email.verifyConfirm({ ip: '1', authorization: auth(tokenValue), body: { challengeId: challenge(started.body), code: code === '999999' ? '999998' : '999999' } })).status, 400)
  const fifth = await t.email.verifyConfirm({ ip: '1', authorization: auth(tokenValue), body: { challengeId: challenge(started.body), code: code === '999999' ? '999998' : '999999' } })
  assert.match((fifth.body as { error: string }).error, /Слишком много неверных попыток/)
  // Even the right code is useless now.
  assert.equal((await t.email.verifyConfirm({ ip: '1', authorization: auth(tokenValue), body: { challengeId: challenge(started.body), code } })).status, 400)
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  const again = await t.email.verifyStart({ ip: '1', authorization: auth(tokenValue) })
  const fresh = t.sender.lastCode('plain@example.com')!
  assert.equal((await t.email.verifyConfirm({ ip: '1', authorization: auth(tokenValue), body: { challengeId: challenge(again.body), code: fresh } })).status, 200)
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  assert.equal((await t.email.verifyStart({ ip: '1', authorization: auth(tokenValue) })).status, 409)
  // An account confirmed at registration has nothing to confirm.
  assert.equal((await t.email.verifyStart({ ip: '1', authorization: auth(other.token) })).status, 409)
  // A code of one account never confirms another.
  await t.accounts.register('third@example.com', password)
  const third = ((await t.api.login({ ip: '1', body: { email: 'third@example.com', password } })).body as { token: string }).token
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  const thirdStart = await t.email.verifyStart({ ip: '1', authorization: auth(third) })
  assert.equal(thirdStart.status, 200)
  await t.accounts.register('fourth@example.com', password)
  const fourth = ((await t.api.login({ ip: '1', body: { email: 'fourth@example.com', password } })).body as { token: string }).token
  assert.equal((await t.email.verifyConfirm({ ip: '1', authorization: auth(fourth), body: { challengeId: challenge(thirdStart.body), code: t.sender.lastCode('third@example.com') } })).status, 400)
})

test('sign-in by e-mail code: the same answer for unknown addresses, owners allowed, blocked accounts get nothing', async () => {
  const { email, sender, emails, signUp, accounts, advance } = setup({ owners: ['boss@example.com'] })
  await signUp('player@example.com')
  await signUp('boss@example.com')
  const sent = sender.sent.length
  const known = await email.loginStart({ ip: '1', body: { email: 'player@example.com' } })
  const unknown = await email.loginStart({ ip: '1', body: { email: 'ghost@example.com' } })
  assert.equal(known.status, 200)
  assert.equal(unknown.status, 200)
  assert.deepEqual(Object.keys(known.body as object).sort(), Object.keys(unknown.body as object).sort())
  await emails.settled()
  assert.equal(sender.sent.length, sent + 1)
  // A wrong code is a failed sign-in: 401 (the security guard counts it like a wrong password), same message.
  assert.equal((await email.login({ ip: '1', body: { challengeId: challenge(unknown.body), code: '123456' } })).status, 401)
  const signedIn = await email.login({ ip: '1', body: { challengeId: challenge(known.body), code: sender.lastCode('player@example.com') } })
  assert.equal(signedIn.status, 200)
  assert.equal((signedIn.body as { account: AccountView }).account.email, 'player@example.com')
  // Owners may sign in by e-mail code (e-mail is their primary factor).
  const boss = await email.loginStart({ ip: '1', body: { email: 'boss@example.com' } })
  await emails.settled()
  const bossIn = await email.login({ ip: '1', body: { challengeId: challenge(boss.body), code: sender.lastCode('boss@example.com') } })
  assert.equal(bossIn.status, 200)
  assert.equal((bossIn.body as { account: AccountView }).account.owner, true)
  // Blocked: no e-mail, and a code requested before the block stops working.
  advance(EMAIL_RESEND_COOLDOWN_MS)
  const pending = await email.loginStart({ ip: '1', body: { email: 'player@example.com' } })
  await emails.settled()
  const code = sender.lastCode('player@example.com')
  accounts.database.prepare("UPDATE accounts SET blocked_at = 1 WHERE email = 'player@example.com'").run()
  assert.equal((await email.login({ ip: '1', body: { challengeId: challenge(pending.body), code } })).status, 403)
  advance(EMAIL_RESEND_COOLDOWN_MS)
  const count = sender.sent.length
  assert.equal((await email.loginStart({ ip: '1', body: { email: 'player@example.com' } })).status, 200)
  await emails.settled()
  assert.equal(sender.sent.length, count)
})

test('password reset by e-mail code revokes every session; owners may reset by e-mail', async () => {
  const { api, email, sender, emails, signUp, accounts } = setup({ owners: ['boss@example.com'] })
  const { token } = await signUp('boss@example.com')
  const started = await email.resetStart({ ip: '1', body: { email: 'BOSS@example.com' } })
  await emails.settled()
  const code = sender.lastCode('boss@example.com')!
  assert.equal((await email.reset({ ip: '1', body: { challengeId: challenge(started.body), code, password: 'short' } })).status, 400)
  const reset = await email.reset({ ip: '1', body: { challengeId: challenge(started.body), code, password: 'brand new password' } })
  assert.equal(reset.status, 200)
  assert.equal(accounts.authenticate(token), undefined, 'old sessions are revoked')
  assert.ok(accounts.authenticate((reset.body as { token: string }).token))
  assert.equal((await api.login({ ip: '1', body: { email: 'boss@example.com', password } })).status, 401)
  assert.equal((await api.login({ ip: '1', body: { email: 'boss@example.com', password: 'brand new password' } })).status, 200)
  // A reset code does not sign in, and a sign-in code does not reset.
  assert.equal((await email.login({ ip: '1', body: { challengeId: challenge(started.body), code } })).status, 401)
})

test('limits: cooldown, per-address daily cap, global daily budget and per-IP caps', async () => {
  const t = setup({ addressDailyLimit: 3, dailyLimit: 5, ipDailyLimit: 1000 })
  await t.signUp('a@example.com')
  const first = await t.email.loginStart({ ip: '1', body: { email: 'a@example.com' } })
  assert.equal(first.status, 200)
  const cooldown = await t.email.loginStart({ ip: '1', body: { email: 'a@example.com' } })
  assert.equal(cooldown.status, 429)
  assert.ok(Number((cooldown.body as { retryAfter: number }).retryAfter) > 0)
  assert.ok(cooldown.headers?.['Retry-After'])
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  assert.equal((await t.email.resetStart({ ip: '1', body: { email: 'a@example.com' } })).status, 200)
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  // The registration code came from another IP: the cap counts per address AND requesting IP.
  assert.equal((await t.email.loginStart({ ip: '1', body: { email: 'a@example.com' } })).status, 200)
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  const capped = await t.email.loginStart({ ip: '1', body: { email: 'a@example.com' } })
  assert.equal(capped.status, 429)
  assert.match((capped.body as { error: string }).error, /лимит кодов на сутки/)
  // Unknown addresses are capped the same way.
  for (let i = 0; i < 3; i++) { assert.equal((await t.email.loginStart({ ip: '1', body: { email: 'ghost@example.com' } })).status, 200); t.advance(EMAIL_RESEND_COOLDOWN_MS) }
  assert.equal((await t.email.loginStart({ ip: '1', body: { email: 'ghost@example.com' } })).status, 429)
  // Global budget: 5 e-mails per 24 h (the registration code + three codes = 4 so far).
  await t.emails.settled()
  assert.equal(t.emails.sentToday(), 4)
  assert.equal((await t.api.register({ ip: '1', body: { email: 'b@example.com', password } })).status, 202)
  const over = await t.api.register({ ip: '1', body: { email: 'd@example.com', password } })
  assert.equal(over.status, 503)
  assert.equal((await t.email.loginStart({ ip: '1', body: { email: 'e@example.com' } })).status, 503)
  // Next day everything works again.
  t.advance(24 * 60 * 60 * 1000)
  assert.equal((await t.api.register({ ip: '1', body: { email: 'd@example.com', password } })).status, 202)

  // Per IP: 15-minute window in the handlers and a daily cap in the service.
  const ipTest = setup({ ipDailyLimit: 3 })
  for (let i = 0; i < 3; i++) assert.equal((await ipTest.email.loginStart({ ip: '9', body: { email: `x${i}@example.com` } })).status, 200)
  assert.equal((await ipTest.email.loginStart({ ip: '9', body: { email: 'x9@example.com' } })).status, 429)
  assert.equal((await ipTest.email.loginStart({ ip: '8', body: { email: 'x9@example.com' } })).status, 200)
  const windowed = createEmailHandlers(ipTest.accounts, ipTest.emails, { now: ipTest.now, limits: { start: 1 } })
  assert.equal((await windowed.loginStart({ ip: '7', body: { email: 'y@example.com' } })).status, 200)
  assert.equal((await windowed.loginStart({ ip: '7', body: { email: 'z@example.com' } })).status, 429)
})

test('nothing logs addresses, codes or keys; a failing provider is logged by name and status only', async () => {
  const { email, sender, emails, signUp, logs } = setup()
  const { token } = await signUp('quiet@example.com')
  sender.fail = true
  assert.equal((await email.loginStart({ ip: '1', body: { email: 'quiet@example.com' } })).status, 200)
  await emails.settled()
  assert.equal(logs.length, 1)
  assert.match(logs[0], /^E-mail send failed \(fake\)$/)
  void token
  const failing = createEmailSender({ provider: 'resend', apiKey: 're_secret_key_123', from: DEFAULT_EMAIL_FROM, dailyLimit: 1, addressDailyLimit: 1 }, async () => ({ ok: false, status: 403, json: async () => ({ statusCode: 403, name: 'validation_error', message: 'The quiet@example.com domain is not verified' }) }))
  await assert.rejects(failing.send(renderEmail('test', 'quiet@example.com')), (error: Error & { code?: string }) => {
    assert.equal(error.code, '403')
    assert.ok(!error.message.includes('quiet@example.com'))
    assert.ok(!error.message.includes('re_secret'))
    assert.match(error.message, /validation_error/)
    return true
  })
})

test('Resend request shape (not verified live): POST /emails with Bearer key and {from,to,subject,html,text}', async () => {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = []
  const fetch: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'abc-123' }) } }
  const config = emailConfigFromEnv({ TARKOV_EMAIL_PROVIDER: 'resend', TARKOV_EMAIL_API_KEY: 're_test_123' })!
  assert.equal(config.from, 'Raid OS <noreply@raidos.app>')
  assert.equal(config.dailyLimit, 500)
  const sender = createEmailSender(config, fetch)
  const result = await sender.send(renderEmail('login', 'user@example.com', { code: '123456' }))
  assert.equal(result.id, 'abc-123')
  assert.equal(calls[0].url, 'https://api.resend.com/emails')
  assert.equal(calls[0].init?.method, 'POST')
  assert.equal(calls[0].init?.headers?.authorization, 'Bearer re_test_123')
  assert.equal(calls[0].init?.headers?.['content-type'], 'application/json')
  const body = JSON.parse(calls[0].init!.body!) as Record<string, unknown>
  assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'subject', 'text', 'to'])
  assert.deepEqual(body.to, ['user@example.com'])
  assert.equal(body.from, 'Raid OS <noreply@raidos.app>')
  // Config: off without provider or key; From validated; limits parsed.
  assert.equal(emailConfigFromEnv({}), undefined)
  assert.equal(emailConfigFromEnv({ TARKOV_EMAIL_PROVIDER: 'resend' }), undefined)
  assert.equal(emailConfigFromEnv({ TARKOV_EMAIL_PROVIDER: 'mailgun', TARKOV_EMAIL_API_KEY: 'x' }), undefined)
  assert.equal(emailConfigFromEnv({ TARKOV_EMAIL_PROVIDER: 'resend', TARKOV_EMAIL_API_KEY: 'k', TARKOV_EMAIL_FROM: 'Evil\r\nBcc: x@y.z', TARKOV_EMAIL_DAILY_LIMIT: '50' })?.from, DEFAULT_EMAIL_FROM)
  assert.equal(emailConfigFromEnv({ TARKOV_EMAIL_PROVIDER: 'resend', TARKOV_EMAIL_API_KEY: 'k', TARKOV_EMAIL_DAILY_LIMIT: '50' })?.dailyLimit, 50)
  assert.equal(validFrom('Raid OS <hello@raidos.app>'), 'Raid OS <hello@raidos.app>')
  assert.equal(validFrom('hello@raidos.app'), 'hello@raidos.app')
  assert.equal(validFrom('no at sign'), undefined)
})

test('e-mail templates: branded, Russian with an English line, the code, and no images or tracking', () => {
  const message = renderEmail('register', 'user@example.com', { code: '042917' })
  assert.match(message.subject, /Raid OS/)
  assert.ok(message.html.includes('042917'))
  assert.ok(message.text.includes('Код: 042917'))
  assert.match(message.text, /expires in 10 minutes/)
  assert.ok(!/<img|src=|url\(|https?:\/\//i.test(message.html), 'no remote resources or tracking pixels')
  const notice = renderEmail('notice', 'user@example.com', { code: '111111' })
  assert.ok(!notice.text.includes('111111'), 'the notice never carries a code')
})

test('HTTP: /auth-config reports emailEnabled, registration answers 202, routes are mounted', async () => {
  const accounts = new AccountStore({ ownerEmails: [] })
  const sender = new FakeEmailSender()
  const emails = new EmailAuthService(accounts, { sender })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { emails }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/accounts`
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const config = await (await fetch(`${base}/auth-config`)).json() as { emailEnabled: boolean; smsEnabled: boolean; email: { codeTtlSeconds: number } }
    assert.equal(config.emailEnabled, true)
    assert.equal(config.smsEnabled, false)
    assert.equal(config.email.codeTtlSeconds, 600)
    const started = await post('/register', { email: 'web@example.com', password })
    assert.equal(started.status, 202)
    assert.equal(started.headers.get('cache-control'), 'no-store')
    const { challengeId } = await started.json() as Challenge
    await emails.settled()
    const confirmed = await post('/register/confirm', { challengeId, code: sender.lastCode('web@example.com') })
    assert.equal(confirmed.status, 201)
    assert.equal((await post('/email/login/start', { email: 'nobody@example.com' })).status, 200)
    assert.equal((await post('/email/reset/start', { email: 'not an email' })).status, 400)
  } finally {
    server.close()
  }
  const off = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ ownerEmails: [] })).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => off.on('listening', resolve))
  try {
    const offBase = `http://127.0.0.1:${(off.address() as AddressInfo).port}/v1/accounts`
    assert.equal(((await (await fetch(`${offBase}/auth-config`)).json()) as { emailEnabled: boolean }).emailEnabled, false)
    const registered = await fetch(`${offBase}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', password }) })
    assert.equal(registered.status, 201)
  } finally {
    off.close()
  }
})

test('code requests by somebody else neither cancel the owner\'s code nor use up his cap; overall cap per address', async () => {
  const t = setup({ addressDailyLimit: 2 })
  await t.signUp('victim@example.com')
  const mine = await t.email.loginStart({ ip: 'victim', body: { email: 'victim@example.com' } })
  await t.emails.settled()
  const code = t.sender.lastCode('victim@example.com')!
  // An attacker asks for sign-in codes for the same address from his IP: capped per (address, IP).
  assert.equal((await t.email.loginStart({ ip: 'evil', body: { email: 'victim@example.com' } })).status, 200)
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  assert.equal((await t.email.loginStart({ ip: 'evil', body: { email: 'victim@example.com' } })).status, 200)
  t.advance(EMAIL_RESEND_COOLDOWN_MS)
  assert.equal((await t.email.loginStart({ ip: 'evil', body: { email: 'victim@example.com' } })).status, 429)
  // The victim still gets codes from his own IP, and his first challenge was not cancelled by the newer ones.
  assert.equal((await t.email.loginStart({ ip: 'victim', body: { email: 'victim@example.com' } })).status, 200)
  assert.equal((await t.email.login({ ip: 'victim', body: { challengeId: challenge(mine.body), code } })).status, 200)
  // Overall cap per address (3 × 2 = 6: registration + 2 victim + 2 attacker = 5 so far) against bombing from many IPs.
  assert.equal((await t.email.loginStart({ ip: 'evil-2', body: { email: 'victim@example.com' } })).status, 200)
  assert.equal((await t.email.loginStart({ ip: 'evil-3', body: { email: 'victim@example.com' } })).status, 429)
})

test('registration may use only part of the daily e-mail budget; sign-in codes keep the rest', async () => {
  const t = setup({ dailyLimit: 5 })
  // ceil(5 × 60 %) = 3 registration e-mails.
  for (const address of ['r1@example.com', 'r2@example.com', 'r3@example.com']) assert.equal((await t.api.register({ ip: '1', body: { email: address, password } })).status, 202)
  await t.emails.settled()
  const refused = await t.api.register({ ip: '1', body: { email: 'r4@example.com', password } })
  assert.equal(refused.status, 503)
  const confirmed = await t.email.registerConfirm({ ip: '1', body: { challengeId: challenge((await t.api.register({ ip: '2', body: { email: 'r5@example.com', password } })).body), code: '000000' } })
  assert.equal(confirmed.status, 400, 'the refused registration made no challenge')
  // The reserved part: sign-in codes still go out.
  const r1 = await t.api.register({ ip: '9', body: { email: 'r1@example.com', password } })
  assert.equal(r1.status, 503, 'whatever the address')
  assert.equal((await t.email.loginStart({ ip: '2', body: { email: 'r1@example.com' } })).status, 200)
})

test('wrong codes are capped per address per day across all its challenges', async () => {
  const t = setup()
  await t.signUp('guess@example.com')
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000')
  let last: { status: number; body: unknown } | undefined
  for (let n = 0; n < MAX_WRONG_CODES_PER_DAY; n += 1) {
    // A new challenge every few tries: the per-challenge limit (5) never triggers, the daily one does.
    const started = await t.email.loginStart({ ip: `ip-${n}`, body: { email: 'guess@example.com' } })
    await t.emails.settled()
    last = await t.email.login({ ip: 'attacker', body: { challengeId: challenge(started.body), code: wrong(t.sender.lastCode('guess@example.com')!) } })
    assert.equal(last.status, 401)
  }
  const started = await t.email.loginStart({ ip: 'owner', body: { email: 'guess@example.com' } })
  await t.emails.settled()
  const right = await t.email.login({ ip: 'owner', body: { challengeId: challenge(started.body), code: t.sender.lastCode('guess@example.com') } })
  assert.equal(right.status, 429, 'even the right code waits once the address is under attack')
  assert.ok(Number(right.headers?.['Retry-After']) > 0)
  t.advance(24 * 60 * 60 * 1000)
  const fresh = await t.email.loginStart({ ip: 'owner', body: { email: 'guess@example.com' } })
  await t.emails.settled()
  assert.equal((await t.email.login({ ip: 'owner', body: { challengeId: challenge(fresh.body), code: t.sender.lastCode('guess@example.com') } })).status, 200)
})

test('wrong e-mail codes on /email/login and /email/reset are failed sign-ins (401) for the security guard', async () => {
  const accounts = new AccountStore({ ownerEmails: [] })
  const sender = new FakeEmailSender()
  const emails = new EmailAuthService(accounts, { sender })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { emails }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/accounts`
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const { challengeId } = await (await post('/email/login/start', { email: 'nobody@example.com' })).json() as Challenge
    const login = await post('/email/login', { challengeId, code: '123456' })
    assert.equal(login.status, 401)
    assert.match((await login.json() as { error: string }).error, /код/i)
    const reset = await post('/email/reset', { challengeId, code: '123456', password: 'brand new password' })
    assert.equal(reset.status, 401)
    assert.equal((await post('/email/reset', { challengeId, code: '123456', password: 'short' })).status, 400, 'a bad new password is not a failed sign-in')
  } finally {
    server.close()
  }
})

test('registration of a canonical alias of a working account takes the decoy path (same answer, no code)', async () => {
  const t = setup()
  await t.signUp('jane.doe@gmail.com')
  await t.emails.settled()
  const before = t.sender.sent.length
  const started = await t.api.register({ ip: 'alias', body: { email: 'Jane.Doe+farm@googlemail.com', password } })
  assert.equal(started.status, 202)
  assert.deepEqual(Object.keys(started.body as object).sort(), ['challengeId', 'expiresAt', 'message', 'pending', 'resendSeconds'])
  await t.emails.settled()
  assert.ok(t.sender.sent.length <= before + 1, 'at most the «someone tried to register» notice')
  assert.equal(t.sender.lastCode('jane.doe+farm@googlemail.com'), undefined, 'no registration code')
  assert.equal((await t.email.registerConfirm({ ip: 'alias', body: { challengeId: challenge(started.body), code: '123456' } })).status, 400)
  assert.equal(t.accounts.hasAccount('jane.doe+farm@googlemail.com'), false)
})
