import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore, WELCOME_TRIAL_MS } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { grantNoticeTexts, trialBonusNoticeTexts } from '../services/grantNotice.js'
import { NoticeStore, PERSONAL_NOTICE_BASE } from '../services/noticeStore.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { grantTrialBonus } from '../services/trialBonus.js'

/**
 * The free days (owner, 02.11.2026): two at registration, from the first sign-in in an app; paid and granted days come
 * after them, so they never burn («если человек оплатил подписку, то к этим дням прибавляется срок подписки, они не
 * сгорают»); days the owner grants pop up in the player's apps («Вам зачислено N дней за отчет. Спасибо»); the one-time
 * two days to every account that has had its free days and never paid.
 */
const password = 'correct horse battery'
const DAY = 86_400_000
const MONTH = 30 * DAY
let clock = Date.parse('2026-11-02T10:00:00.000Z')

async function setup() {
  clock = Date.parse('2026-11-02T10:00:00.000Z')
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [], now: () => clock })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => clock })
  const payments = new PaymentStore(db, { shopId: '1', secretKey: 'test_x', monthPrice: 300, receipts: false, streamerPercent: 0, publicUrl: 'https://raidos.example.com' }, { fetch: (async () => new Response('{}')) as unknown as typeof fetch, now: () => clock })
  accounts.attachSubscriptions(payments)
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
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  const player = async (email: string, country = 'RU') => {
    const registered = await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country })
    assert.equal(registered.status, 201, JSON.stringify(registered.json))
    return registered.json.token
  }
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  const trialOf = (email: string) => ({ ...db.prepare('SELECT trial_ends_at, trial_pending_ms FROM accounts WHERE email = ?').get(email) }) as { trial_ends_at: number | null; trial_pending_ms: number | null }
  const inbox = async (token: string) => (await call<{ notices: Array<{ id: number; title: string; text: string; titleEn?: string }> }>('GET', '/me/notices', token)).json.notices
  return { db, accounts, payments, call, owner, player, idOf, trialOf, inbox, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('two free days at registration, from the first sign-in in an app', async () => {
  const t = await setup()
  try {
    await t.player('new@example.com')
    assert.equal(WELCOME_TRIAL_MS, 2 * DAY)
    assert.deepEqual(t.trialOf('new@example.com'), { trial_ends_at: null, trial_pending_ms: 2 * DAY })
    clock += 5 * DAY
    t.accounts.claimTrialDevice(t.idOf('new@example.com'), 'device-new')
    assert.deepEqual(t.trialOf('new@example.com'), { trial_ends_at: clock + 2 * DAY, trial_pending_ms: null })
  } finally {
    await t.close()
  }
})

// Owner, 03.11.2026: the one-time two days of 02.11 start at a sign-in in an app, also behind a free period still running.
test('free days waiting behind a running free period start at the first sign-in after it ends', async () => {
  const t = await setup()
  try {
    await t.player('behind@example.com')
    const id = t.idOf('behind@example.com')
    t.accounts.claimTrialDevice(id, 'device-behind')
    const firstEnd = clock + 2 * DAY
    t.db.prepare('UPDATE accounts SET trial_pending_ms = ? WHERE id = ?').run(2 * DAY, id)
    // Signed in while the first period runs: nothing moves, the two days still wait.
    clock += DAY
    t.accounts.claimTrialDevice(id, 'device-behind')
    assert.deepEqual(t.trialOf('behind@example.com'), { trial_ends_at: firstEnd, trial_pending_ms: 2 * DAY })
    // Back three days after it ended: two days from then.
    clock = firstEnd + 3 * DAY
    t.accounts.claimTrialDevice(id, 'device-behind')
    assert.deepEqual(t.trialOf('behind@example.com'), { trial_ends_at: clock + 2 * DAY, trial_pending_ms: null })
  } finally {
    await t.close()
  }
})

test('paid days come after the free days, whichever comes first', async () => {
  const t = await setup()
  try {
    // Paid during the free days: the month starts when they end.
    await t.player('during@example.com', 'KZ')
    t.accounts.claimTrialDevice(t.idOf('during@example.com'), 'device-during')
    const trialEnd = t.trialOf('during@example.com').trial_ends_at!
    clock += DAY
    assert.equal((await t.call('POST', '/accounts/me/admin/bezebee/payments', t.owner, { email: 'during@example.com', plan: '1m' })).status, 201)
    assert.equal(t.payments.paidUntil(t.idOf('during@example.com')), trialEnd + MONTH)

    // Paid before the first sign-in in an app: the free days follow the paid month.
    await t.player('before@example.com', 'KZ')
    assert.equal((await t.call('POST', '/accounts/me/admin/bezebee/payments', t.owner, { email: 'before@example.com', plan: '1m' })).status, 201)
    const paidUntil = t.payments.paidUntil(t.idOf('before@example.com'))!
    assert.equal(paidUntil, clock + MONTH)
    t.accounts.claimTrialDevice(t.idOf('before@example.com'), 'device-before')
    assert.equal(t.trialOf('before@example.com').trial_ends_at, paidUntil + 2 * DAY)
    // …and the next payment after both.
    assert.equal((await t.call('POST', '/accounts/me/admin/bezebee/payments', t.owner, { email: 'before@example.com', plan: '1m' })).status, 201)
    assert.equal(t.payments.paidUntil(t.idOf('before@example.com')), paidUntil + 2 * DAY + MONTH)
  } finally {
    await t.close()
  }
})

test('days the owner grants come after the free days and pop up once in the player\'s apps', async () => {
  const t = await setup()
  try {
    const token = await t.player('granted@example.com')
    const other = await t.player('other@example.com')
    const id = t.idOf('granted@example.com')
    t.accounts.claimTrialDevice(id, 'device-granted')
    const trialEnd = t.trialOf('granted@example.com').trial_ends_at!
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id}/grant`, t.owner, { days: 3, reason: 'бонус за помощь' })).status, 200)
    assert.equal(t.payments.paidUntil(id), trialEnd + 3 * DAY)

    const [notice] = await t.inbox(token)
    assert.ok(notice.id > PERSONAL_NOTICE_BASE)
    assert.deepEqual([notice.title, notice.text, notice.titleEn], ['Вам зачислено 3 дня', 'Спасибо!', '3 days added'])
    assert.deepEqual(await t.inbox(other), [], 'nobody else')
    assert.equal((await t.call('POST', `/me/notices/${notice.id}/close`, other)).status, 404)
    assert.equal((await t.call('POST', `/me/notices/${notice.id}/seen`, token)).status, 204)
    assert.equal((await t.call('POST', `/me/notices/${notice.id}/close`, token)).status, 204)
    assert.deepEqual(await t.inbox(token), [], '«Понятно»: never again')
  } finally {
    await t.close()
  }
})

test('the popup texts: the report or the idea named, the days counted in Russian', () => {
  assert.deepEqual(grantNoticeTexts(3, 'Отчёт об ошибке №120'), { title: 'Вам зачислено 3 дня за отчёт', text: 'Спасибо!', titleEn: '3 days added for your report', textEn: 'Thank you!' })
  assert.equal(grantNoticeTexts(7, 'Предложение №25').title, 'Вам зачислено 7 дней за предложение')
  assert.equal(grantNoticeTexts(30, 'Оплата через BZB').title, 'Вам зачислено 30 дней')
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map((days) => grantNoticeTexts(days, 'x').title), [
    'Вам зачислен 1 день', 'Вам зачислено 2 дня', 'Вам зачислено 5 дней', 'Вам зачислено 11 дней', 'Вам зачислено 12 дней',
    'Вам зачислен 21 день', 'Вам зачислено 22 дня', 'Вам зачислено 25 дней', 'Вам зачислен 101 день', 'Вам зачислено 111 дней',
  ])
  assert.equal(grantNoticeTexts(1, 'x').titleEn, '1 day added')
  assert.equal(trialBonusNoticeTexts(2).title, 'Вам зачислено 2 дня пробного периода')
})

test('the one-time two days: every account that had its free days and never paid, with the popup; the waiting ones get the new length', async () => {
  const t = await setup()
  try {
    const tokens: Record<string, string> = {}
    for (const name of ['running', 'over', 'waiting', 'paid', 'denied', 'blocked', 'granted']) tokens[name] = await t.player(`${name}@example.com`, name === 'paid' ? 'KZ' : 'RU')
    const id = (name: string) => t.idOf(`${name}@example.com`)
    for (const name of ['over', 'paid', 'denied', 'blocked', 'granted']) t.accounts.claimTrialDevice(id(name), `device-${name}`)
    clock += 3 * DAY
    t.accounts.claimTrialDevice(id('running'), 'device-running')
    t.db.prepare('UPDATE accounts SET trial_pending_ms = ? WHERE id = ?').run(DAY, id('waiting'))
    assert.equal((await t.call('POST', '/accounts/me/admin/bezebee/payments', t.owner, { email: 'paid@example.com', plan: '1m' })).status, 201)
    t.db.prepare('UPDATE accounts SET trial_denied = ? WHERE id = ?').run(clock, id('denied'))
    t.db.prepare('UPDATE accounts SET blocked_at = ? WHERE id = ?').run(clock, id('blocked'))
    assert.equal((await t.call('POST', `/accounts/me/admin/users/${id('granted')}/grant`, t.owner, { days: 10, reason: 'студент' })).status, 200)
    const grantedUntil = t.payments.paidUntil(id('granted'))!
    const before = Object.fromEntries(['running', 'over', 'paid', 'denied', 'blocked'].map((name) => [name, t.trialOf(`${name}@example.com`).trial_ends_at]))
    const notices = new NoticeStore(t.db, () => clock)

    assert.deepEqual(grantTrialBonus(t.db, notices, { now: clock, days: 2, pendingMs: WELCOME_TRIAL_MS, dryRun: true }), { bonus: 3, pending: 1, dryRun: true })
    assert.deepEqual(grantTrialBonus(t.db, notices, { now: clock, days: 2, pendingMs: WELCOME_TRIAL_MS }), { bonus: 3, pending: 1, dryRun: false })
    assert.equal(t.trialOf('running@example.com').trial_ends_at, before.running! + 2 * DAY, 'running: two more')
    assert.equal(t.trialOf('over@example.com').trial_ends_at, clock + 2 * DAY, 'over: two from now')
    assert.equal(t.trialOf('granted@example.com').trial_ends_at, grantedUntil + 2 * DAY, 'after the days granted by hand')
    assert.equal(t.trialOf('waiting@example.com').trial_pending_ms, WELCOME_TRIAL_MS, 'waiting: the new length')
    for (const name of ['paid', 'denied', 'blocked']) assert.equal(t.trialOf(`${name}@example.com`).trial_ends_at, before[name], `${name}: untouched`)
    for (const name of ['running', 'over', 'granted']) {
      const titles = (await t.inbox(tokens[name])).map((notice) => notice.title)
      assert.ok(titles.includes('Вам зачислено 2 дня пробного периода'), name)
    }
    assert.ok(!(await t.inbox(tokens.paid)).some((notice) => notice.title.includes('пробного периода')))
  } finally {
    await t.close()
  }
})
