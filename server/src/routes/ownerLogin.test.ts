import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi, ownerLoginCodeFrom } from '../app.js'
import { AccountStore, newPasswordHash } from '../services/accountStore.js'
import { EmailAuthService, EMAIL_CODE_TTL_MS, EMAIL_RESEND_COOLDOWN_MS, MAX_EMAIL_CODE_ATTEMPTS, MAX_WRONG_CODES_PER_DAY, OWNER_LOGIN_TTL_MS } from '../services/emailAuth.js'
import { FakeEmailSender } from '../services/email/index.js'
import { openDatabase } from '../services/database.js'
import { codeHash, newSalt, sha256 } from '../services/oneTimeCode.js'
import { renderEmail } from '../services/email/templates.js'
import { describeAgent, plainAddress, signInFacts } from '../services/ownerSignIn.js'
import { ProgressStore } from '../services/progressStore.js'
import { isLoginPath } from '../services/securityGuard.js'

/**
 * The owner's second factor (owner, 27.11.2026: «После верного пароля на почту владельца приходит код, без кода входа нет.
 * После каждого входа владельцу приходит уведомление»), through the real API (server/src/app.ts): the right password of
 * the owner's account answers 202 and e-mails a code; POST /login/confirm with it signs the owner in. A code never signs the owner in
 * without the password. Players and the Apple reviewer's account are untouched; without an e-mail provider the owner
 * signs in with the password as before. Every sign-in of the owner e-mails the owner a notice and goes into the owner's audit log.
 */
const OWNER = 'owner@example.com'
const PLAYER = 'player@example.com'
const REVIEWER = 'reviewer@example.com'
const password = 'correct horse battery'
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
/** A visitor behind the site's proxy (trust proxy = loopback): their address, Cloudflare's country and their browser. */
const VISITOR = { 'x-forwarded-for': '203.0.113.7', 'cf-ipcountry': 'TH', 'user-agent': CHROME }
const from = (ip: string) => ({ ...VISITOR, 'x-forwarded-for': ip })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Answer { status: number; body: any; headers: Headers }
interface AuditEntry { action: string; actor: string; target?: string; details?: Record<string, string> }

async function world(options: { email?: boolean; ownerLoginCode?: boolean; dailyLimit?: number } = {}) {
  let clock = Date.parse('2026-11-27T10:00:00.000Z')
  const now = () => clock
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, now, ownerEmails: [OWNER], storeReviewEmails: [REVIEWER] })
  const { salt, hash } = await newPasswordHash(password)
  // A session of the owner from before the second factor: it stays open.
  const ownerSession = accounts.createVerifiedAccount(OWNER, salt, hash).token
  await accounts.register(PLAYER, password, undefined, undefined, 'DE')
  await accounts.register(REVIEWER, password, undefined, undefined, 'US')
  const sender = new FakeEmailSender()
  const logs: string[] = []
  const emails = new EmailAuthService(accounts, {
    sender: options.email === false ? undefined : sender, now, log: (line) => logs.push(line),
    ...(options.dailyLimit ? { limits: { dailyLimit: options.dailyLimit } } : {}),
  })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { emails, ...(options.ownerLoginCode === undefined ? {} : { ownerLoginCode: options.ownerLoginCode }) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/accounts`
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = VISITOR, token?: string): Promise<Answer> => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* not JSON */ }
    return { status: response.status, body: parsed, headers: response.headers }
  }
  const ownerId = accounts.accountByEmail(OWNER)!.id
  const sessions = (accountId = ownerId) => Number((db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?').get(accountId) as { n: number }).n)
  const audit = async () => ((await send('GET', '/me/admin/audit', undefined, VISITOR, ownerSession)).body as { entries: AuditEntry[] }).entries
  /** The password, then the code from the e-mail: the owner's new session. */
  const signIn = async (headers: Record<string, string> = VISITOR) => {
    const started = await send('POST', '/login', { email: OWNER, password }, headers)
    assert.equal(started.status, 202, JSON.stringify(started.body))
    const confirmed = await send('POST', '/login/confirm', { challengeId: started.body.challengeId, code: sender.lastCode(OWNER) }, headers)
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
    return confirmed.body as { token: string; account: { owner?: true } }
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { db, accounts, emails, sender, logs, send, sessions, audit, signIn, close, ownerSession, ownerId, now, advance: (ms: number) => { clock += ms } }
}

test('the owner\'s right password: 202 and a code by e-mail, no session; the right code signs the owner in, old sessions of the owner stay', async () => {
  const t = await world()
  try {
    const before = t.sessions()
    const started = await t.send('POST', '/login', { email: 'Owner@Example.com', password })
    assert.equal(started.status, 202, JSON.stringify(started.body))
    assert.equal(started.body.secondFactor, true)
    assert.equal(started.body.token, undefined)
    assert.equal(started.body.account, undefined)
    assert.equal(started.body.message, 'Мы отправили код на почту. Введите его, чтобы войти.')
    assert.match(started.body.challengeId, /^[A-Za-z0-9_-]{32}$/)
    assert.equal(started.body.resendSeconds, EMAIL_RESEND_COOLDOWN_MS / 1000)
    assert.equal(Date.parse(started.body.expiresAt), t.now() + EMAIL_CODE_TTL_MS, 'the code lives 10 minutes')
    assert.equal(t.sessions(), before, 'no session for the password alone')
    // The code went out before the answer, in its own letter.
    const letter = t.sender.to(OWNER).at(-1)!
    assert.equal(letter.subject, 'Код для входа в админ-панель Raid OS')
    assert.match(letter.text, /Если это не вы — смените пароль/)
    const code = t.sender.lastCode(OWNER)!
    assert.match(code, /^\d{6}$/)
    assert.ok(letter.html.includes(code))
    assert.ok(!JSON.stringify(started.body).includes(code))
    // Kept only as a hash.
    const row = t.db.prepare("SELECT * FROM email_challenges WHERE purpose = 'owner-login'").get() as Record<string, unknown>
    assert.equal(row.account_id, t.ownerId)
    assert.equal(Buffer.from(row.code_hash as Uint8Array).length, 32)
    for (const value of [row.email, row.purpose, row.payload, row.digest]) assert.ok(!String(value).includes(code))
    // The right code: a session, as a password sign-in gives.
    const confirmed = await t.send('POST', '/login/confirm', { challengeId: started.body.challengeId, code })
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
    assert.equal(confirmed.body.account.email, OWNER)
    assert.equal(confirmed.body.account.owner, true)
    assert.equal(t.accounts.authenticate(confirmed.body.token), t.ownerId)
    assert.equal(t.sessions(), before + 1)
    // Used up.
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: started.body.challengeId, code })).status, 401)
    // The open sessions of the owner stay.
    assert.equal(t.accounts.authenticate(t.ownerSession), t.ownerId)
  } finally { await t.close() }
})

test('after every sign-in of the owner: a notice by e-mail (Bangkok time, IP, country, device; no code) and the audit log of the owner', async () => {
  const t = await world()
  try {
    await t.signIn()
    const code = t.sender.lastCode(OWNER)!
    await t.emails.settled()
    const notice = t.sender.to(OWNER).at(-1)!
    assert.equal(notice.subject, 'Raid OS: вход в аккаунт владельца')
    assert.match(notice.text, /Время: 2026-11-27 17:00 \(Бангкок\)/)
    assert.match(notice.text, /IP: 203\.0\.113\.7/)
    assert.match(notice.text, /Страна: .+ \(TH\)/)
    assert.match(notice.text, /Устройство: Chrome · Windows/)
    assert.match(notice.text, /Способ входа: пароль и код из письма/)
    assert.match(notice.text, /Если это не вы — смените пароль/)
    assert.ok(!notice.text.includes(code) && !notice.html.includes(code), 'no code in the notice')
    assert.ok(!notice.text.includes(CHROME), 'the device in short, not the whole User-Agent')
    const [entry] = await t.audit()
    assert.equal(entry!.action, 'owner.sign-in')
    assert.equal(entry!.actor, OWNER)
    assert.deepEqual({ ...entry!.details, country: entry!.details?.country?.endsWith('(TH)') }, { method: 'password-code', ip: '203.0.113.7', country: true, device: 'Chrome · Windows', agent: CHROME })
  } finally { await t.close() }
})

test('a wrong code is refused; five end it; «Отправить код ещё раз» gives a new one; an old code and an old password are refused', async () => {
  const t = await world()
  try {
    const started = await t.send('POST', '/login', { email: OWNER, password })
    const challengeId = started.body.challengeId as string
    const code = t.sender.lastCode(OWNER)!
    const wrong = code === '000000' ? '111111' : '000000'
    const first = await t.send('POST', '/login/confirm', { challengeId, code: wrong })
    assert.equal(first.status, 401, 'a wrong code is a failed sign-in')
    assert.match(first.body.error, /Неверный или устаревший код/)
    for (let attempt = 2; attempt < MAX_EMAIL_CODE_ATTEMPTS; attempt++) assert.equal((await t.send('POST', '/login/confirm', { challengeId, code: wrong })).status, 401)
    const last = await t.send('POST', '/login/confirm', { challengeId, code: wrong })
    assert.match(last.body.error, /Слишком много неверных попыток/)
    assert.equal((await t.send('POST', '/login/confirm', { challengeId, code })).status, 401, 'even the right code is gone')
    // A new code for the same challenge, after the cooldown.
    const early = await t.send('POST', '/login/resend', { challengeId })
    assert.equal(early.status, 429)
    assert.ok(Number(early.body.retryAfter) > 0)
    t.advance(EMAIL_RESEND_COOLDOWN_MS)
    const resent = await t.send('POST', '/login/resend', { challengeId })
    assert.equal(resent.status, 200, JSON.stringify(resent.body))
    assert.equal(resent.body.challengeId, challengeId)
    const second = t.sender.lastCode(OWNER)!
    // An old code: refused after its 10 minutes.
    t.advance(EMAIL_CODE_TTL_MS + 1)
    assert.equal((await t.send('POST', '/login/confirm', { challengeId, code: second })).status, 401)
    const again = await t.send('POST', '/login/resend', { challengeId })
    assert.equal(again.status, 200)
    assert.equal((await t.send('POST', '/login/confirm', { challengeId, code: t.sender.lastCode(OWNER) })).status, 200)
    // The password itself goes stale for «ещё раз» after OWNER_LOGIN_TTL_MS: then the password again.
    t.advance(EMAIL_RESEND_COOLDOWN_MS)
    const fresh = await t.send('POST', '/login', { email: OWNER, password })
    assert.equal(fresh.status, 202)
    t.advance(OWNER_LOGIN_TTL_MS)
    const stale = await t.send('POST', '/login/resend', { challengeId: fresh.body.challengeId })
    assert.equal(stale.status, 400)
    assert.equal(stale.body.error, 'Срок входа истёк. Введите пароль ещё раз.')
  } finally { await t.close() }
})

test('a code never signs the owner in without the password of the owner', async () => {
  const t = await world()
  try {
    const before = t.sessions()
    // A wrong password: no code, no challenge.
    const sent = t.sender.sent.length
    assert.equal((await t.send('POST', '/login', { email: OWNER, password: 'not the password' })).status, 401)
    assert.equal(t.sender.sent.length, sent)
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM email_challenges WHERE purpose = 'owner-login'").get()!.n, 0)
    // A challenge nobody was given.
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: 'A'.repeat(32), code: '123456' })).status, 401)
    // Sign-in by an e-mail code: the owner's address gets the same answer as a player's, but no e-mail at all.
    const player = await t.send('POST', '/email/login/start', { email: PLAYER }, from('198.51.100.1'))
    const owner = await t.send('POST', '/email/login/start', { email: OWNER }, from('198.51.100.1'))
    assert.equal(owner.status, 200)
    assert.deepEqual(Object.keys(owner.body).sort(), Object.keys(player.body).sort())
    await t.emails.settled()
    assert.equal(t.sender.to(OWNER).length, 0)
    // The owner's own sign-in code from the password step opens nothing but /login/confirm.
    t.advance(EMAIL_RESEND_COOLDOWN_MS)
    const started = await t.send('POST', '/login', { email: OWNER, password })
    const code = t.sender.lastCode(OWNER)!
    assert.equal((await t.send('POST', '/email/login', { challengeId: owner.body.challengeId, code })).status, 401, 'not on the decoy')
    assert.equal((await t.send('POST', '/email/login', { challengeId: started.body.challengeId, code })).status, 401, 'not as an e-mail sign-in')
    // A reset code is no sign-in code either.
    const reset = await t.send('POST', '/email/reset/start', { email: OWNER }, from('198.51.100.2'))
    await t.emails.settled()
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: reset.body.challengeId, code: t.sender.lastCode(OWNER) })).status, 401)
    // An e-mail sign-in code made for the owner's account before the second factor existed: refused at the moment of use.
    const salt = newSalt()
    const oldId = 'B'.repeat(32)
    t.db.prepare("INSERT INTO email_challenges (digest, purpose, email, account_id, salt, code_hash, attempts, created_at, expires_at) VALUES (?, 'login', ?, ?, ?, ?, 0, ?, ?)")
      .run(sha256(oldId), OWNER, t.ownerId, salt, codeHash(salt, 'login', OWNER, '424242'), t.now(), t.now() + EMAIL_CODE_TTL_MS)
    assert.equal((await t.send('POST', '/email/login', { challengeId: oldId, code: '424242' })).status, 401)
    assert.equal(t.sessions(), before, 'nothing signed the owner in')
    // His own code still does, after the password.
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: started.body.challengeId, code })).status, 200)
  } finally { await t.close() }
})

test('players and the Apple reviewer sign in as before: no code, no notice, nothing in the owner\'s log', async () => {
  const t = await world()
  try {
    for (const email of [PLAYER, REVIEWER]) {
      const answer = await t.send('POST', '/login', { email, password })
      assert.equal(answer.status, 200, JSON.stringify(answer.body))
      assert.ok(t.accounts.authenticate(answer.body.token))
      assert.equal(answer.body.account.owner, undefined)
    }
    await t.emails.settled()
    assert.equal(t.sender.sent.length, 0)
    assert.deepEqual(await t.audit(), [])
    // A player's sign-in by an e-mail code works as it did.
    const started = await t.send('POST', '/email/login/start', { email: PLAYER })
    await t.emails.settled()
    const signedIn = await t.send('POST', '/email/login', { challengeId: started.body.challengeId, code: t.sender.lastCode(PLAYER) })
    assert.equal(signedIn.status, 200)
    await t.emails.settled()
    assert.equal(t.sender.to(PLAYER).length, 1, 'only the code, no notice')
  } finally { await t.close() }
})

test('without an e-mail provider the owner signs in with the password, as before; the sign-in is in the log of the owner', async () => {
  const t = await world({ email: false })
  try {
    const answer = await t.send('POST', '/login', { email: OWNER, password })
    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    assert.equal(answer.body.account.owner, true)
    assert.ok(t.accounts.authenticate(answer.body.token))
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: 'A'.repeat(32), code: '123456' })).status, 503)
    const [entry] = await t.audit()
    assert.equal(entry!.action, 'owner.sign-in')
    assert.equal(entry!.details?.method, 'password')
  } finally { await t.close() }
})

test('TARKOV_OWNER_LOGIN_CODE=0 signs the owner in with the password alone (the way back in); the notice still goes', async () => {
  assert.equal(ownerLoginCodeFrom({}), true)
  assert.equal(ownerLoginCodeFrom({ TARKOV_OWNER_LOGIN_CODE: '1' }), true)
  assert.equal(ownerLoginCodeFrom({ TARKOV_OWNER_LOGIN_CODE: ' 0 ' }), false)
  const t = await world({ ownerLoginCode: false })
  try {
    const answer = await t.send('POST', '/login', { email: OWNER, password })
    assert.equal(answer.status, 200, JSON.stringify(answer.body))
    await t.emails.settled()
    assert.equal(t.sender.to(OWNER).length, 1)
    assert.match(t.sender.to(OWNER)[0]!.text, /Способ входа: пароль$/m)
  } finally { await t.close() }
})

test('a code the provider refuses: 502, no session, no challenge; the password works again after the cooldown', async () => {
  const t = await world()
  try {
    const before = t.sessions()
    t.sender.fail = true
    const refused = await t.send('POST', '/login', { email: OWNER, password })
    assert.equal(refused.status, 502)
    assert.equal(refused.body.error, 'Не удалось отправить код. Попробуйте позже.')
    assert.equal(refused.body.token, undefined)
    assert.equal(t.sessions(), before)
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM email_challenges WHERE purpose = 'owner-login'").get()!.n, 0)
    assert.deepEqual(t.logs, ['E-mail send failed (fake)'])
    t.sender.fail = false
    assert.equal((await t.send('POST', '/login', { email: OWNER, password })).status, 429, 'the cooldown counts the refused one')
    t.advance(EMAIL_RESEND_COOLDOWN_MS)
    assert.equal((await t.send('POST', '/login', { email: OWNER, password })).status, 202)
  } finally { await t.close() }
})

test('nobody else\'s requests lock the owner out: wrong codes on decoys, the address cap, the spent daily budget', async () => {
  const t = await world({ dailyLimit: 40 })
  try {
    // Wrong codes typed into decoys of the owner's address (sign-in by e-mail code) up to the daily cap…
    for (let round = 0; round * MAX_EMAIL_CODE_ATTEMPTS < MAX_WRONG_CODES_PER_DAY; round++) {
      const decoy = await t.send('POST', '/email/login/start', { email: OWNER }, from(`198.51.100.${10 + round}`))
      for (let attempt = 0; attempt < MAX_EMAIL_CODE_ATTEMPTS; attempt++) await t.send('POST', '/email/login', { challengeId: decoy.body.challengeId, code: '000000' }, from(`198.51.100.${10 + round}`))
    }
    // (they stop the address's other codes for the day: even a right reset code)
    const reset = await t.send('POST', '/email/reset/start', { email: OWNER }, from('198.51.100.50'))
    await t.emails.settled()
    const stopped = await t.send('POST', '/email/reset', { challengeId: reset.body.challengeId, code: t.sender.lastCode(OWNER), password: 'brand new password 1' }, from('198.51.100.50'))
    assert.equal(stopped.status, 429)
    assert.match(stopped.body.error, /Слишком много неверных кодов для этого адреса/)
    // …and every code request the address may have today, from other addresses.
    for (let n = 0; n < 30; n++) await t.send('POST', '/email/reset/start', { email: OWNER }, from(`192.0.2.${n + 1}`))
    assert.equal((await t.send('POST', '/email/reset/start', { email: OWNER }, from('192.0.2.200'))).status, 429, 'the others are capped')
    // …and the service's daily budget spent.
    await t.emails.settled()
    while (t.emails.sentToday() < 40) await t.emails.sendTest('someone@example.com')
    assert.equal((await t.send('POST', '/email/login/start', { email: PLAYER }, from('192.0.2.201'))).status, 503)
    // The owner still gets the owner's code and signs in.
    const session = await t.signIn()
    assert.equal(session.account.owner, true)
  } finally { await t.close() }
})

test('the password again within a minute waits for the cooldown; each challenge stands alone', async () => {
  const t = await world()
  try {
    const first = await t.send('POST', '/login', { email: OWNER, password })
    const firstCode = t.sender.lastCode(OWNER)!
    const soon = await t.send('POST', '/login', { email: OWNER, password })
    assert.equal(soon.status, 429)
    assert.match(soon.body.error, /Новый код можно запросить через \d+ с\./)
    assert.ok(soon.headers.get('retry-after'))
    t.advance(EMAIL_RESEND_COOLDOWN_MS)
    const second = await t.send('POST', '/login', { email: OWNER, password })
    assert.equal(second.status, 202)
    assert.notEqual(second.body.challengeId, first.body.challengeId)
    const secondCode = t.sender.lastCode(OWNER)!
    // Each code opens its own challenge only; a new one does not cancel the first.
    if (firstCode !== secondCode) assert.equal((await t.send('POST', '/login/confirm', { challengeId: second.body.challengeId, code: firstCode })).status, 401)
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: first.body.challengeId, code: firstCode })).status, 200)
    assert.equal((await t.send('POST', '/login/confirm', { challengeId: second.body.challengeId, code: secondCode })).status, 200)
  } finally { await t.close() }
})

test('a new password by an e-mail code and a QR sign-in notify the owner and go into the log of the owner as well', async () => {
  const t = await world()
  try {
    const reset = await t.send('POST', '/email/reset/start', { email: OWNER })
    await t.emails.settled()
    const done = await t.send('POST', '/email/reset', { challengeId: reset.body.challengeId, code: t.sender.lastCode(OWNER), password: 'brand new password 1' })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    await t.emails.settled()
    assert.match(t.sender.to(OWNER).at(-1)!.text, /Способ входа: новый пароль по коду из письма/)
    // The PC app's QR code for the phone (POST /me/login-codes → /login-codes/redeem).
    const handOff = await t.send('POST', '/me/login-codes', {}, VISITOR, done.body.token)
    assert.equal(handOff.status, 201, JSON.stringify(handOff.body))
    const phone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36'
    const redeemed = await t.send('POST', '/login-codes/redeem', { code: handOff.body.code }, { ...VISITOR, 'user-agent': phone })
    assert.equal(redeemed.status, 200)
    await t.emails.settled()
    const notice = t.sender.to(OWNER).at(-1)!
    assert.match(notice.text, /Способ входа: QR-код с другого устройства/)
    assert.match(notice.text, /Устройство: приложение на Android/)
    const methods = (await t.send('GET', '/me/admin/audit', undefined, VISITOR, done.body.token)).body.entries.filter((entry: AuditEntry) => entry.action === 'owner.sign-in').map((entry: AuditEntry) => entry.details?.method)
    assert.deepEqual(methods, ['qr', 'email-reset'])
  } finally { await t.close() }
})

test('the notice names the device in short and the place; a wrong owner code counts as a failed sign-in for the guard', () => {
  assert.equal(describeAgent('RaidOS-Desktop/0.6.0-354 (Windows)'), 'Raid OS для Windows 0.6.0-354')
  assert.equal(describeAgent('RaidOS-Desktop (Windows)'), 'Raid OS для Windows')
  assert.equal(describeAgent(CHROME), 'Chrome · Windows')
  assert.equal(describeAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), 'Safari · macOS')
  assert.equal(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'), 'приложение на iPhone')
  assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 YaBrowser/24.12.0.0 Safari/537.36'), 'Яндекс Браузер · Windows')
  assert.equal(describeAgent('curl/8.5.0'), 'curl/8.5.0')
  assert.equal(describeAgent(''), 'неизвестно')
  assert.equal(describeAgent('evil\r\nBcc: someone@example.com'), 'evil Bcc: someone@example.com')
  assert.equal(plainAddress('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(plainAddress('<script>'), undefined)
  const facts = Object.fromEntries(signInFacts('password-code', { ip: '2001:db8::1', agent: CHROME }, Date.parse('2026-11-27T23:30:00.000Z')))
  assert.deepEqual(facts, { 'Время': '2026-11-28 06:30 (Бангкок)', IP: '2001:db8::1', 'Устройство': 'Chrome · Windows', 'Способ входа': 'пароль и код из письма' })
  assert.equal(isLoginPath('/v1/accounts/login/confirm'), true)
  assert.equal(isLoginPath('/v1/accounts/login/resend'), false)
})

test('the owner\'s letters: the code letter shows the code; the notice shows only its facts, escaped, never a code', () => {
  const code = renderEmail('owner-login', OWNER, { code: '042917' })
  assert.equal(code.subject, 'Код для входа в админ-панель Raid OS')
  assert.ok(code.text.includes('Код: 042917') && code.html.includes('042917'))
  assert.match(code.text, /expires in 10 minutes/)
  const notice = renderEmail('owner-signin', OWNER, { code: '111111', facts: [['Устройство', '<b>x</b> & "y"']] })
  assert.ok(!notice.text.includes('111111') && !notice.html.includes('111111'), 'the notice never carries a code')
  assert.ok(notice.html.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;') && !notice.html.includes('<b>x</b>'))
  assert.ok(notice.text.includes('Устройство: <b>x</b> & "y"'))
  for (const message of [code, notice]) assert.ok(!/<img|src=|url\(|https?:\/\//i.test(message.html), 'no remote resources or tracking pixels')
  // Facts belong to the notice only.
  assert.ok(!renderEmail('login', PLAYER, { code: '123456', facts: [['IP', '203.0.113.7']] }).text.includes('203.0.113.7'))
})
