import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { audienceMatches } from '../services/noticeStore.js'
import { SURVEY_LATER_MAX } from '../../../src/shared/notices.js'

/**
 * «Объявления по регионам» and «Опросы» (owner, 15.10.2026: «я нажимаю в админ приложении создать объявление, выбираю
 * категорию по снг европе итд … выбираю оплативших или нет, могу прикладывать туда фото»; «создавать опросы … указывается
 * почта того кто прошел опрос»).
 */
const password = 'correct horse battery'
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1b7a5d10000000049454e44ae426082', 'hex')

let clock = Date.parse('2026-10-15T10:00:00.000Z')

async function setup() {
  clock = Date.parse('2026-10-15T10:00:00.000Z')
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [], now: () => clock })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => clock })
  const payments = new PaymentStore(db, undefined)
  // A fake translator (never the network): the English of a popup without the owner's own is this.
  const translateAnnouncement = (russian: string) => Promise.resolve(`[EN] ${russian.replace(/[Ѐ-ӿ]+/g, 'x')}`)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, guard: { quickCheckEveryMs: 0 }, translateAnnouncement }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: response.status, json: json as T, text, headers: response.headers }
  }
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  /** A player of `country` (null: an account from before the question). */
  const player = async (email: string, country: string | null) => {
    const token = (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country: country ?? 'RU' })).json.token
    if (country === null) db.prepare('UPDATE accounts SET country = NULL WHERE email = ?').run(email)
    return token
  }
  const idOf = (email: string) => accounts.accountByEmail(email)!.id
  const pay = async (email: string) => {
    const granted = await call('POST', `/accounts/me/admin/users/${idOf(email)}/grant`, owner, { days: 30, reason: 'оплата вручную' })
    assert.equal(granted.status, 200, JSON.stringify(granted.json))
  }
  return { db, accounts, call, owner, player, idOf, pay, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

type Inbox = { notices: Array<{ id: number; title: string; text: string; titleEn?: string; textEn?: string; images: number; button?: { text: string; url: string } }>; surveys: Array<{ id: number; laterLeft: number; questions: Array<{ id: string; options?: Array<{ id: string }> }> }> }
type Notice = { id: number; targeted: number; seen: number; closed: number; withdrawnAt?: string; responses?: number; images: number; audience: { regions: string[]; payment: string } }
const announcement = (overrides: Record<string, unknown> = {}) => ({ title: 'Скидка', text: 'Только сегодня', audience: { regions: [], payment: 'all' }, ...overrides })
const tick = () => { clock += 1000 }

test('audience: «Россия»/«СНГ»/«Мир» OR-ed, AND the payment; «Все» for any country incl. none; nothing for later accounts', () => {
  const sentAt = 1_000
  const facts = (country: string | null, paidUntil = 0, extra: Partial<{ kind: string; countrySetAt: number; createdAt: number }> = {}) => ({ id: 'x', kind: 'user', country, countrySetAt: null, createdAt: 0, paidUntil, ...extra })
  const now = 2_000
  // «Россия» — RU; «СНГ» — the CIS without Russia; «Мир» — a known country outside the CIS.
  assert.equal(audienceMatches({ regions: ['ru'], payment: 'all' }, sentAt, facts('RU'), now), true)
  assert.equal(audienceMatches({ regions: ['ru'], payment: 'all' }, sentAt, facts('KZ'), now), false)
  assert.equal(audienceMatches({ regions: ['cis'], payment: 'all' }, sentAt, facts('KZ'), now), true)
  assert.equal(audienceMatches({ regions: ['cis'], payment: 'all' }, sentAt, facts('RU'), now), false, '«СНГ» is the CIS without Russia')
  assert.equal(audienceMatches({ regions: ['world'], payment: 'all' }, sentAt, facts('DE'), now), true)
  assert.equal(audienceMatches({ regions: ['world'], payment: 'all' }, sentAt, facts('XX'), now), true, 'a country typed by hand is «Мир»')
  assert.equal(audienceMatches({ regions: ['world'], payment: 'all' }, sentAt, facts('KZ'), now), false)
  assert.equal(audienceMatches({ regions: ['ru', 'cis'], payment: 'all' }, sentAt, facts('BY'), now), true, 'OR of the regions')
  // «Все» (no region): everybody, an account without a country included; a specific region never matches a country-less one.
  assert.equal(audienceMatches({ regions: [], payment: 'all' }, sentAt, facts(null), now), true)
  assert.equal(audienceMatches({ regions: ['world'], payment: 'all' }, sentAt, facts(null), now), false)
  assert.equal(audienceMatches({ regions: [], payment: 'paid' }, sentAt, facts('DE', 3_000), now), true)
  assert.equal(audienceMatches({ regions: [], payment: 'paid' }, sentAt, facts('DE', 1_500), now), false, 'paid days over')
  assert.equal(audienceMatches({ regions: [], payment: 'unpaid' }, sentAt, facts('DE', 1_500), now), true)
  assert.equal(audienceMatches({ regions: [], payment: 'unpaid' }, sentAt, facts('DE', 0, { kind: 'streamer' }), now), false, 'streamers: only «Все»')
  assert.equal(audienceMatches({ regions: [], payment: 'all' }, sentAt, facts('DE', 0, { createdAt: 1_500 }), now), false, 'registered after the sending')
})

test('notices are owner-only: 401 without a session, 404 for a player, on every owner route', async () => {
  const t = await setup()
  try {
    const player = await t.player('p@example.com', 'RU')
    const routes: Array<[string, string, unknown?]> = [
      ['POST', '/accounts/me/admin/notices', announcement()],
      ['GET', '/accounts/me/admin/notices'],
      ['POST', '/accounts/me/admin/notices/1/withdraw', {}],
      ['GET', '/accounts/me/admin/notices/1/images/0'],
      ['POST', '/accounts/me/admin/notices/images', { data: PNG.toString('base64') }],
      ['POST', '/accounts/me/admin/surveys', {}],
      ['GET', '/accounts/me/admin/surveys/1/results'],
      ['GET', '/accounts/me/admin/surveys/1/responses.csv'],
    ]
    for (const [method, path, body] of routes) {
      assert.equal((await t.call(method, path, undefined, body)).status, 401, `${method} ${path}`)
      assert.equal((await t.call(method, path, player, body)).status, 404, `${method} ${path}`)
    }
    assert.equal((await t.call('GET', '/me/notices')).status, 401)
  } finally {
    await t.close()
  }
})

test('announcements: «Россия»/«Мир»/«Все» × payment, once per account on every device, counts, withdraw', async () => {
  const t = await setup()
  try {
    const moscow = await t.player('moscow@example.com', 'RU')
    const berlin = await t.player('berlin@example.com', 'DE')
    const tokyo = await t.player('tokyo@example.com', 'JP')
    const old = await t.player('old@example.com', null)
    await t.pay('berlin@example.com')
    tick()

    // «Мир», only the paying ones: Berlin.
    const paidWorld = await t.call<{ notice: Notice }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ title: 'Для оплативших', audience: { regions: ['world'], payment: 'paid' } }))
    assert.equal(paidWorld.status, 201, JSON.stringify(paidWorld.json))
    assert.equal(paidWorld.json.notice.targeted, 1)
    // «Россия», everybody: Moscow and the owner (both RU); the owner's own English is kept, not auto-translated.
    const russia = await t.call<{ notice: Notice }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ title: 'Россиянам', titleEn: 'For Russia', text: 'Текст', textEn: 'Text', audience: { regions: ['ru'], payment: 'all' } }))
    assert.equal(russia.json.notice.targeted, 2)
    // «Все», without a subscription: Moscow, Tokyo, old and the owner (all without paid days); Berlin pays, so no.
    const unpaid = await t.call<{ notice: Notice }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ title: 'Попробуйте подписку', audience: { regions: ['ru', 'cis', 'world'], payment: 'unpaid' } }))
    assert.deepEqual(unpaid.json.notice.audience, { regions: [], payment: 'unpaid' }, 'all three regions are everybody')
    assert.equal(unpaid.json.notice.targeted, 4)

    const titles = async (token: string) => (await t.call<Inbox>('GET', '/me/notices', token)).json.notices.map((notice) => notice.title)
    assert.deepEqual(await titles(berlin), ['Для оплативших'])
    assert.deepEqual(await titles(moscow), ['Россиянам', 'Попробуйте подписку'])
    assert.deepEqual(await titles(tokyo), ['Попробуйте подписку'])
    assert.deepEqual(await titles(old), ['Попробуйте подписку'], 'a country-less account matches only «Все»')
    assert.deepEqual(await titles(t.owner), ['Россиянам', 'Попробуйте подписку'], 'the owner gets only what targets the owner too')
    const moscowInbox = (await t.call<Inbox>('GET', '/me/notices', moscow)).json.notices[0]!
    assert.deepEqual([moscowInbox.titleEn, moscowInbox.textEn], ['For Russia', 'Text'], 'the owner\'s own English is delivered, the app picks the language')

    // Seen and closed: per account, once; another device of the account sees nothing more.
    assert.equal((await t.call('POST', `/me/notices/${unpaid.json.notice.id}/seen`, moscow)).status, 204)
    assert.equal((await t.call('POST', `/me/notices/${unpaid.json.notice.id}/close`, moscow)).status, 204)
    const moscowPhone = (await t.call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'moscow@example.com', password })).json.token
    assert.deepEqual(await titles(moscowPhone), ['Россиянам'], 'the closed one is gone, the other stays')
    assert.deepEqual(await titles(tokyo), ['Попробуйте подписку'], 'other accounts still have it')
    assert.equal((await t.call('POST', `/me/notices/${paidWorld.json.notice.id}/close`, moscow)).status, 404, 'not this account\'s')
    assert.equal((await t.call('POST', `/me/notices/${unpaid.json.notice.id}/seen`, tokyo)).status, 204)

    type List = { notices: Notice[] }
    const listed = (await t.call<List>('GET', '/accounts/me/admin/notices', t.owner)).json.notices
    assert.deepEqual(listed.map((notice) => [notice.id, notice.targeted, notice.seen, notice.closed]), [
      [unpaid.json.notice.id, 4, 2, 1],
      [russia.json.notice.id, 2, 0, 0],
      [paidWorld.json.notice.id, 1, 0, 0],
    ])

    // «Отозвать»: those who have not closed it do not see it any more.
    const withdrawn = await t.call<{ notice: Notice }>('POST', `/accounts/me/admin/notices/${unpaid.json.notice.id}/withdraw`, t.owner, {})
    assert.ok(withdrawn.json.notice.withdrawnAt)
    assert.deepEqual(await titles(tokyo), [])
    assert.deepEqual(await titles(old), [])

    // An account registered after the sending never gets it.
    tick()
    const late = await t.player('late@example.com', 'DE')
    await t.pay('late@example.com')
    assert.deepEqual(await titles(late), [])

    // The audit log names every sending and withdrawal.
    const audit = t.db.prepare("SELECT action FROM owner_audit_log WHERE action LIKE 'notice.%' ORDER BY id").all() as Array<{ action: string }>
    assert.deepEqual(audit.map((row) => row.action), ['notice.send', 'notice.send', 'notice.send', 'notice.withdraw'])
  } finally {
    await t.close()
  }
})

test('announcements: without the owner\'s own English the server translates for English readers', async () => {
  const t = await setup()
  try {
    const sent = await t.call<{ notice: Notice }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ title: 'Привет', text: 'Новости', button: { text: 'Канал', url: 'https://t.me/raidos' } }))
    assert.equal(sent.status, 201, JSON.stringify(sent.json))
    const inbox = (await t.call<Inbox>('GET', '/me/notices', t.owner)).json.notices[0]!
    // The fake translator turns Russian letters into «x»; a non-empty, non-Russian English is kept.
    assert.deepEqual([inbox.titleEn, inbox.textEn], ['[EN] x', '[EN] x'])
    assert.equal((inbox.button as { textEn?: string }).textEn, '[EN] x')
  } finally {
    await t.close()
  }
})

test('announcements: the form is checked (texts, https button, regions, payment)', async () => {
  const t = await setup()
  try {
    const refused = async (body: unknown) => (await t.call<{ error: string }>('POST', '/accounts/me/admin/notices', t.owner, body))
    assert.match((await refused(announcement({ title: '' }))).json.error, /Заголовок/)
    assert.match((await refused(announcement({ text: 'x'.repeat(2001) }))).json.error, /Текст/)
    assert.match((await refused(announcement({ button: { text: 'Telegram', url: 'javascript:alert(1)' } }))).json.error, /https/)
    assert.match((await refused(announcement({ button: { text: 'Telegram', url: 'http://t.me/raidos' } }))).json.error, /https/)
    assert.match((await refused(announcement({ audience: { regions: ['mars'], payment: 'all' } }))).json.error, /регионы/)
    assert.match((await refused(announcement({ audience: { regions: [], payment: 'rich' } }))).json.error, /оплату/)
    const ok = await t.call<{ notice: { button?: { text: string; url: string } } }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ title: '  Новый\nканал ', button: { text: 'Telegram', url: 'https://t.me/raidos' } }))
    assert.equal(ok.status, 201)
    assert.deepEqual(ok.json.notice.button, { text: 'Telegram', url: 'https://t.me/raidos' })
    const inbox = (await t.call<Inbox>('GET', '/me/notices', t.owner)).json.notices
    assert.equal(inbox[0]!.title, 'Новый канал', 'one line, trimmed')
  } finally {
    await t.close()
  }
})

test('photos: JPG / PNG / WEBP up to 5 MB, at most 4, shown only to the targeted accounts', async () => {
  const t = await setup()
  try {
    const moscow = await t.player('moscow@example.com', 'RU')
    const berlin = await t.player('berlin@example.com', 'DE')
    const upload = async (data: Buffer | string) => t.call<{ image: { id: string; mime: string }; error: string }>('POST', '/accounts/me/admin/notices/images', t.owner, { data: typeof data === 'string' ? data : data.toString('base64') })
    assert.equal((await upload(Buffer.from('GIF89a not allowed'))).status, 400)
    assert.equal((await upload('***')).status, 400)
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
    assert.equal((await upload(big)).status, 413)
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const sent = await upload(`data:image/png;base64,${PNG.toString('base64')}`)
      assert.equal(sent.status, 201, JSON.stringify(sent.json))
      assert.equal(sent.json.image.mime, 'image/png')
      ids.push(sent.json.image.id)
    }
    assert.match((await t.call<{ error: string }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ images: ids }))).json.error, /4 фото/)
    assert.equal((await t.call('POST', '/accounts/me/admin/notices', t.owner, announcement({ images: ['f'.repeat(24)] }))).status, 400, 'an unknown photo')
    const sent = await t.call<{ notice: Notice }>('POST', '/accounts/me/admin/notices', t.owner, announcement({ images: ids.slice(0, 2), audience: { regions: ['ru'], payment: 'all' } }))
    assert.equal(sent.json.notice.images, 2)
    assert.equal((await t.call('POST', '/accounts/me/admin/notices', t.owner, announcement({ images: ids.slice(0, 1) }))).status, 400, 'a photo goes with one announcement')

    const inbox = (await t.call<Inbox>('GET', '/me/notices', moscow)).json.notices
    assert.equal(inbox[0]!.images, 2)
    const photo = await t.call<{ mime: string; data: string }>('GET', `/me/notices/${sent.json.notice.id}/images/1`, moscow)
    assert.deepEqual([photo.json.mime, Buffer.from(photo.json.data, 'base64').equals(PNG)], ['image/png', true])
    assert.equal((await t.call('GET', `/me/notices/${sent.json.notice.id}/images/2`, moscow)).status, 404)
    assert.equal((await t.call('GET', `/me/notices/${sent.json.notice.id}/images/0`, berlin)).status, 404, 'not for Russia')
    assert.equal((await t.call('GET', `/accounts/me/admin/notices/${sent.json.notice.id}/images/0`, t.owner)).status, 200)
  } finally {
    await t.close()
  }
})

const survey = (overrides: Record<string, unknown> = {}) => ({
  title: 'Как вам Raid OS?',
  intro: 'Три вопроса',
  questions: [
    { text: 'Где играете?', type: 'single', options: [{ text: 'PvP' }, { text: 'PvE' }], required: true },
    { text: 'Что нравится?', type: 'multiple', options: [{ text: 'Карты' }, { text: 'Квесты' }, { text: 'Цены' }], max: 2, required: false },
    { text: 'Что добавить?', type: 'text', required: false },
  ],
  audience: { regions: [], payment: 'all' },
  ...overrides,
})

test('surveys: the builder is checked; «Позже» brings it back at most 3 times; one answer per account', async () => {
  const t = await setup()
  try {
    const moscow = await t.player('moscow@example.com', 'RU')
    const berlin = await t.player('berlin@example.com', 'DE')
    const refused = async (body: unknown) => (await t.call<{ error: string }>('POST', '/accounts/me/admin/surveys', t.owner, body)).json.error
    assert.match(await refused(survey({ questions: [] })), /Вопросов/)
    assert.match(await refused(survey({ questions: [{ text: 'Один?', type: 'single', options: [{ text: 'Да' }], required: true }] })), /Вопрос 1: у вариантов/)
    assert.match(await refused(survey({ questions: [{ text: 'Текст', type: 'text', options: [{ text: 'a' }, { text: 'b' }] }] })), /Вопрос 1/)
    assert.match(await refused(survey({ questions: [{ text: 'Много', type: 'multiple', options: [{ text: 'a' }, { text: 'b' }], max: 3 }] })), /не больше/)
    assert.match(await refused(survey({ questions: Array.from({ length: 11 }, () => ({ text: 'Q', type: 'single', options: Array.from({ length: 11 }, (_, index) => ({ text: String(index) })) })) })), /Вопрос 1/)
    const created = await t.call<{ notice: Notice & { questions: Array<{ id: string; options?: Array<{ id: string }> }> } }>('POST', '/accounts/me/admin/surveys', t.owner, survey())
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const id = created.json.notice.id
    assert.deepEqual(created.json.notice.questions.map((question) => [question.id, question.options?.map((option) => option.id)]), [['q1', ['o1', 'o2']], ['q2', ['o1', 'o2', 'o3']], ['q3', undefined]])

    const surveys = async (token: string) => (await t.call<Inbox>('GET', '/me/notices', token)).json.surveys
    assert.equal((await surveys(berlin))[0]!.laterLeft, SURVEY_LATER_MAX - 1)
    for (let round = 1; round <= SURVEY_LATER_MAX; round += 1) {
      assert.equal((await surveys(berlin)).length, 1, `shown ${round}`)
      assert.equal((await t.call('POST', `/me/surveys/${id}/later`, berlin)).status, 204)
    }
    assert.deepEqual(await surveys(berlin), [], `after ${SURVEY_LATER_MAX} times «Позже» it stops`)

    const answer = (answers: unknown, token = moscow) => t.call<{ error: string; answeredAt: string }>('POST', `/me/surveys/${id}/responses`, token, { answers })
    assert.match((await answer({})).json.error, /Вопрос 1: ответ обязателен/)
    assert.match((await answer({ q1: ['o1', 'o2'] })).json.error, /один вариант/)
    assert.match((await answer({ q1: ['o9'] })).json.error, /такого варианта нет/)
    assert.match((await answer({ q1: ['o1'], q2: ['o1', 'o2', 'o3'] })).json.error, /не больше 2/)
    assert.match((await answer({ q1: ['o1'], q3: 'x'.repeat(1001) })).json.error, /1000/)
    assert.match((await answer({ q1: ['o1'], q9: 'x' })).json.error, /неизвестный вопрос/)
    assert.equal((await answer({ q1: 'o1', q2: ['o1', 'o2'], q3: '  Миникарту для PvE  ' })).status, 201)
    assert.equal((await answer({ q1: ['o2'] })).status, 409, 'one answer per account')
    const phone = (await t.call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'moscow@example.com', password })).json.token
    assert.deepEqual(await surveys(phone), [], 'an answered survey never shows again, on any device')
    assert.equal((await answer({ q1: ['o2'] }, berlin)).status, 201, 'put off is not answered: it can still be answered')
  } finally {
    await t.close()
  }
})

test('survey results: counts and shares per option, the free answers, e-mails for the owner only, CSV; a withdrawn survey is closed', async () => {
  const t = await setup()
  try {
    const moscow = await t.player('moscow@example.com', 'RU')
    const berlin = await t.player('berlin@example.com', 'DE')
    const tokyo = await t.player('tokyo@example.com', 'JP')
    const id = (await t.call<{ notice: Notice }>('POST', '/accounts/me/admin/surveys', t.owner, survey())).json.notice.id
    await t.call('POST', `/me/surveys/${id}/responses`, moscow, { answers: { q1: ['o1'], q2: ['o1', 'o2'], q3: 'Миникарту' } })
    tick()
    await t.call('POST', `/me/surveys/${id}/responses`, berlin, { answers: { q1: ['o2'], q2: ['o2'] } })
    tick()
    await t.call('POST', `/me/surveys/${id}/responses`, tokyo, { answers: { q1: ['o1'], q3: '=HYPERLINK("x")' } })

    type Results = { survey: Notice; questions: Array<{ answered: number; options?: Array<{ text: string; count: number; percent: number }>; answers?: Array<{ text: string; email: string }> }>; responses: Array<{ email: string; country?: string; region: string }> }
    assert.equal((await t.call('GET', `/accounts/me/admin/surveys/${id}/results`, moscow)).status, 404, 'players never see the e-mails')
    const results = (await t.call<Results>('GET', `/accounts/me/admin/surveys/${id}/results`, t.owner)).json
    assert.equal(results.survey.responses, 3)
    assert.deepEqual(results.questions[0]!.options!.map((option) => [option.text, option.count, option.percent]), [['PvP', 2, 66.7], ['PvE', 1, 33.3]])
    assert.equal(results.questions[1]!.answered, 2)
    assert.deepEqual(results.questions[1]!.options!.map((option) => [option.count, option.percent]), [[1, 50], [2, 100], [0, 0]])
    assert.deepEqual(results.questions[2]!.answers!.map((answer) => [answer.text, answer.email]), [['=HYPERLINK("x")', 'tokyo@example.com'], ['Миникарту', 'moscow@example.com']])
    assert.deepEqual(results.responses.map((response) => [response.email, response.country, response.region]), [['tokyo@example.com', 'JP', 'cis'], ['berlin@example.com', 'DE', 'world'], ['moscow@example.com', 'RU', 'ru']])

    const csv = await t.call('GET', `/accounts/me/admin/surveys/${id}/responses.csv`, t.owner)
    assert.equal(csv.status, 200)
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/)
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n')
    assert.equal(lines[0], 'Дата (МСК);E-mail;Страна;Регион;1. Где играете?;2. Что нравится?;3. Что добавить?')
    assert.equal(lines.length, 4)
    assert.match(lines[1]!, /tokyo@example\.com;Япония;СНГ;PvP;;"'=HYPERLINK\(""x""\)"$/, 'a formula is neutralised')
    assert.match(lines[3]!, /moscow@example\.com;Россия;Россия;PvP;Карты, Квесты;Миникарту$/)

    const withdrawn = await t.call<{ notice: Notice }>('POST', `/accounts/me/admin/notices/${id}/withdraw`, t.owner, {})
    assert.ok(withdrawn.json.notice.withdrawnAt)
    const late = await t.player('late@example.com', 'RU')
    assert.equal((await t.call('POST', `/me/surveys/${id}/responses`, late, { answers: { q1: ['o1'] } })).status, 404)
    const audit = t.db.prepare("SELECT action FROM owner_audit_log WHERE action LIKE 'survey.%' OR action = 'notice.withdraw' ORDER BY id").all() as Array<{ action: string }>
    assert.deepEqual(audit.map((row) => row.action), ['survey.publish', 'survey.export', 'notice.withdraw'])
  } finally {
    await t.close()
  }
})

test('a new notice reaches the targeted apps at once through the social events, not the others', async () => {
  const t = await setup()
  try {
    const moscow = await t.player('moscow@example.com', 'RU')
    const berlin = await t.player('berlin@example.com', 'DE')
    const version = async (token: string) => (await t.call<{ version: number }>('GET', '/me/social-events', token)).json.version
    const before = { moscow: await version(moscow), berlin: await version(berlin) }
    await t.call('POST', '/accounts/me/admin/notices', t.owner, announcement({ audience: { regions: ['ru'], payment: 'all' } }))
    assert.notEqual(await version(moscow), before.moscow)
    assert.equal(await version(berlin), before.berlin)
  } finally {
    await t.close()
  }
})
