import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'
import { myMemoryTranslator, noticeLanguage, RUSSIAN_NOTICE_COUNTRIES, translationChunks, TRANSLATION_CHUNK_BYTES, type AnnouncementTranslator } from '../services/announcementLanguage.js'
import { CIS_COUNTRIES, EUROPE_COUNTRIES } from '../../../src/shared/countries'

const password = 'correct horse battery'
const WORKS = 'Ведутся технические работы. Приложение заработает через 15 минут.'
const UPDATE = 'Вышло обновление: перезапустите приложение.'
/** What the fake translator knows; anything else fails, like MyMemory out of quota. */
const ENGLISH: Record<string, string> = {
  [WORKS]: 'Maintenance is under way. The app will be back in 15 minutes.',
  [UPDATE]: 'An update is out: restart the app.',
}

/** The translator the server gets in these tests: never the network. `answer` replaces its next answers. */
function fakeTranslator() {
  const calls: string[] = []
  let next: AnnouncementTranslator = async (russian) => {
    const english = ENGLISH[russian]
    if (!english) throw new Error('MyMemory: the free daily quota is used up')
    return english
  }
  const translate: AnnouncementTranslator = (russian) => { calls.push(russian); return next(russian) }
  return { calls, translate, answer: (replace: AnnouncementTranslator) => { next = replace } }
}

/** `database`: the fresh database before the server opens it (to keep it, or to put an older table in). */
async function setup(options: { translator?: ReturnType<typeof fakeTranslator>; database?: (db: DatabaseSync) => void } = {}) {
  const db = openDatabase(':memory:')
  options.database?.(db)
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), translateAnnouncement: (options.translator ?? fakeTranslator()).translate }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: (response.status === 204 ? null : await response.json()) as T, headers: response.headers }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  await call('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })
  return { call, login, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

/** A player with the country named at registration; the session comes with the registration. */
const register = async (call: Awaited<ReturnType<typeof setup>>['call'], email: string, country: string) =>
  (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password, country })).json.token

interface Answer { version: number; announcement: { text: string; lang?: string; updatedAt: string } | null }
interface Owned { text: string; textEn: string | null; textEnSource: string | null; active: boolean }
interface Saved { announcement: Owned; translation: string }

const PATH = '/accounts/me/admin/announcement'

test('the owner\'s notice: only the owner writes it, everybody reads it, a waiting app gets it at once', async () => {
  const { call, login, close } = await setup()
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    const first = await call<Answer>('GET', '/announcement')
    assert.equal(first.status, 200)
    assert.equal(first.json.announcement, null)

    const path = '/accounts/me/admin/announcement'
    const notice = { text: 'Ведутся технические работы. Приложение заработает через 15 минут.', active: true }
    assert.equal((await call('PUT', path, undefined, notice)).status, 401)
    assert.equal((await call('PUT', path, player, notice)).status, 404)
    assert.equal((await call('PUT', path, owner, { text: '', active: true })).status, 400)
    assert.equal((await call('PUT', path, owner, { text: 'x'.repeat(501), active: true })).status, 400)

    // An app waits for a change; the owner saves the notice: the answer comes at once, with the text.
    const waiting = call<Answer>('GET', `/announcement?since=${first.json.version}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await call('PUT', path, owner, notice)).status, 200)
    const woke = await waiting
    assert.equal(woke.json.announcement?.text, notice.text)
    assert.notEqual(woke.json.version, first.json.version)

    // The owner sees the hidden text too (to edit it); players see nothing once it is off.
    assert.equal((await call('PUT', path, owner, { text: notice.text, active: false })).status, 200)
    assert.equal((await call<Answer>('GET', '/announcement')).json.announcement, null)
    const own = await call<{ announcement: { text: string; active: boolean } }>('GET', path, owner)
    assert.deepEqual([own.json.announcement.text, own.json.announcement.active], [notice.text, false])
    assert.equal((await call('GET', path, player)).status, 404)
  } finally {
    await close()
  }
})

test('the Russian-speaking countries: the CIS with Ukraine and Georgia, apart from the admin panel\'s «СНГ»', () => {
  assert.deepEqual([...RUSSIAN_NOTICE_COUNTRIES].sort(), ['AM', 'AZ', 'BY', 'GE', 'KG', 'KZ', 'MD', 'RU', 'TJ', 'TM', 'UA', 'UZ'])
  for (const country of RUSSIAN_NOTICE_COUNTRIES) assert.equal(noticeLanguage(country), 'ru', country)
  for (const country of [undefined, '']) assert.equal(noticeLanguage(country), 'ru', 'unknown')
  for (const country of ['DE', 'US', 'PL', 'LT', 'TR', 'CN']) assert.equal(noticeLanguage(country), 'en', country)
  // The admin grouping stays as it is: Ukraine is Europe, Georgia «Другие страны».
  assert.equal(CIS_COUNTRIES.includes('UA'), false)
  assert.equal(CIS_COUNTRIES.includes('GE'), false)
  assert.equal(EUROPE_COUNTRIES.includes('UA'), true)
})

test('every reader gets the notice in their language: the account\'s country, else Cloudflare\'s, else Russian', async (t) => {
  t.mock.method(console, 'warn', () => {})
  let db!: DatabaseSync
  const translator = fakeTranslator()
  const { call, login, close } = await setup({ translator, database: (opened) => { db = opened } })
  try {
    const owner = await login('owner@example.com')
    const moscow = await register(call, 'moscow@example.com', 'RU')
    const kyiv = await register(call, 'kyiv@example.com', 'UA')
    const tbilisi = await register(call, 'tbilisi@example.com', 'GE')
    const berlin = await register(call, 'berlin@example.com', 'de')
    // An account from before the question at registration (13.10.2026): no country.
    const older = await register(call, 'older@example.com', 'RU')
    db.prepare('UPDATE accounts SET country = NULL WHERE email = ?').run('older@example.com')
    const gone = await register(call, 'gone@example.com', 'RU')
    assert.equal((await call('POST', '/accounts/logout', gone)).status, 204)

    const saved = await call<Saved>('PUT', PATH, owner, { text: WORKS, active: true })
    assert.equal(saved.status, 200)
    assert.deepEqual(translator.calls, [WORKS])
    const english = ENGLISH[WORKS]!
    const read = async (token?: string, country?: string, headers: Record<string, string> = {}) => {
      const answer = await call<Answer>('GET', '/announcement', token, undefined, { ...headers, ...(country ? { 'cf-ipcountry': country } : {}) })
      assert.equal(answer.status, 200)
      assert.equal(answer.headers.get('cache-control'), 'no-store')
      assert.match(answer.headers.get('vary') ?? '', /Authorization/i)
      return [answer.json.announcement?.text, answer.json.announcement?.lang]
    }
    const russian = [WORKS, 'ru']
    const foreign = [english, 'en']

    // By the account's country, whatever Cloudflare says.
    assert.deepEqual(await read(moscow), russian)
    assert.deepEqual(await read(moscow, 'US'), russian)
    assert.deepEqual(await read(kyiv, 'DE'), russian)
    assert.deepEqual(await read(tbilisi), russian)
    assert.deepEqual(await read(berlin), foreign)
    assert.deepEqual(await read(berlin, 'RU'), foreign)
    // No session: by Cloudflare's country of the visitor; unknown (none, XX, Tor) reads Russian.
    assert.deepEqual(await read(undefined, 'KZ'), russian)
    assert.deepEqual(await read(undefined, 'UA'), russian)
    assert.deepEqual(await read(undefined, 'us'), foreign)
    assert.deepEqual(await read(undefined, 'FR'), foreign)
    assert.deepEqual(await read(), russian)
    assert.deepEqual(await read(undefined, 'XX'), russian)
    assert.deepEqual(await read(undefined, 'T1'), russian)
    // An account without a country: Cloudflare's, else Russian.
    assert.deepEqual(await read(older, 'FR'), foreign)
    assert.deepEqual(await read(older), russian)
    // An invalid, signed-out or malformed session is no session: the same answer, never 401.
    assert.deepEqual(await read('z'.repeat(43), 'US'), foreign)
    assert.deepEqual(await read('z'.repeat(43)), russian)
    assert.deepEqual(await read(gone, 'US'), foreign)
    assert.deepEqual(await read(gone, 'BY'), russian)
    assert.deepEqual(await read(undefined, 'US', { authorization: 'Basic b3duZXI6cGFzcw==' }), foreign)
    assert.deepEqual(await read(undefined, 'RU', { authorization: 'Bearer !' }), russian)

    // Waiting apps: each gets the new notice in its own language from the same save.
    const version = (await call<Answer>('GET', '/announcement')).json.version
    const waiting = [moscow, berlin].map((token) => call<Answer>('GET', `/announcement?since=${version}`, token))
    const anonymous = call<Answer>('GET', `/announcement?since=${version}`, undefined, undefined, { 'cf-ipcountry': 'GB' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await call('PUT', PATH, owner, { text: UPDATE, active: true })).status, 200)
    const [inMoscow, inBerlin] = await Promise.all(waiting)
    assert.deepEqual([inMoscow!.json.announcement?.text, inMoscow!.json.announcement?.lang], [UPDATE, 'ru'])
    assert.deepEqual([inBerlin!.json.announcement?.text, inBerlin!.json.announcement?.lang], [ENGLISH[UPDATE], 'en'])
    assert.equal((await anonymous).json.announcement?.text, ENGLISH[UPDATE])
    assert.notEqual(inBerlin!.json.version, version)

    // No English (the translation failed): foreign readers get the Russian.
    translator.answer(async () => { throw new Error('MyMemory: HTTP 503') })
    assert.equal((await call<Saved>('PUT', PATH, owner, { text: 'Сервер перезагружается.', active: true })).json.translation, 'failed')
    assert.deepEqual(await read(berlin), ['Сервер перезагружается.', 'ru'])
    assert.deepEqual(await read(undefined, 'US'), ['Сервер перезагружается.', 'ru'])
  } finally {
    await close()
  }
})

test('the English is made when the owner saves: translated, kept while the Russian stays, or the owner\'s own', async (t) => {
  const warnings = t.mock.method(console, 'warn', () => {})
  let db!: DatabaseSync
  const translator = fakeTranslator()
  const { call, login, close } = await setup({ translator, database: (opened) => { db = opened } })
  try {
    const owner = await login('owner@example.com')
    const own = async () => (await call<{ announcement: Owned }>('GET', PATH, owner)).json.announcement
    const put = async (body: Record<string, unknown>) => {
      const answer = await call<Saved>('PUT', PATH, owner, body)
      assert.equal(answer.status, 200, JSON.stringify(answer.json))
      const { text, textEn, textEnSource, active } = answer.json.announcement
      return { translation: answer.json.translation, text, textEn, textEnSource, active }
    }
    const audited = () => (db.prepare("SELECT details FROM owner_audit_log WHERE action = 'announcement.set' ORDER BY id").all() as Array<{ details: string }>)
      .map((row) => JSON.parse(row.details) as Record<string, unknown>)

    // Translated at the save; the owner sees both texts.
    assert.deepEqual(await put({ text: WORKS, active: true }), { translation: 'auto', text: WORKS, textEn: ENGLISH[WORKS], textEnSource: 'auto', active: true })
    const stored = await own()
    assert.deepEqual([stored.text, stored.textEn, stored.textEnSource, stored.active], [WORKS, ENGLISH[WORKS], 'auto', true])
    // The same Russian (hidden, shown again, with the line ends of Windows): the English is kept, nothing is asked.
    assert.equal((await put({ text: WORKS, active: false })).translation, 'kept')
    assert.deepEqual(await put({ text: ` ${WORKS}\r\n`, active: true }), { translation: 'kept', text: WORKS, textEn: ENGLISH[WORKS], textEnSource: 'auto', active: true })
    assert.deepEqual(translator.calls, [WORKS])

    // Changed: translated again.
    assert.equal((await put({ text: UPDATE, active: true })).textEn, ENGLISH[UPDATE])
    assert.deepEqual(translator.calls, [WORKS, UPDATE])

    // The owner's own English («Изменить»): stored as given (cleaned like the Russian), wins over the translation.
    const mine = { text: UPDATE, active: true, textEn: '  Update out!\r\nRestart the app.\u0007 ' }
    assert.deepEqual(await put(mine), { translation: 'manual', text: UPDATE, textEn: 'Update out!\nRestart the app.', textEnSource: 'manual', active: true })
    assert.equal((await put({ text: UPDATE, active: true })).textEnSource, 'manual', 'kept while the Russian stays')
    assert.deepEqual(translator.calls, [WORKS, UPDATE])
    // A new Russian is translated anew: the old English no longer fits it.
    assert.deepEqual(await put({ text: WORKS, active: true }), { translation: 'auto', text: WORKS, textEn: ENGLISH[WORKS], textEnSource: 'auto', active: true })
    // An English with a new Russian in one save; an empty one counts as none.
    assert.deepEqual(await put({ text: 'Новая карта.', active: true, textEn: 'A new map.' }), { translation: 'manual', text: 'Новая карта.', textEn: 'A new map.', textEnSource: 'manual', active: true })
    assert.equal((await put({ text: 'Новая карта.', active: true, textEn: '   ' })).textEn, 'A new map.')
    assert.equal((await put({ text: 'Новая карта.', active: true, textEn: null })).textEn, 'A new map.')
    for (const textEn of ['y'.repeat(501), 7]) {
      const refused = await call('PUT', PATH, owner, { text: WORKS, active: true, textEn })
      assert.deepEqual([refused.status, refused.json], [400, { error: 'Английский текст: до 500 символов' }])
    }
    assert.equal((await own()).text, 'Новая карта.', 'a refused save changes nothing')

    // The translation fails: saved anyway, without English, and the answer says so; the next save tries again.
    const calls = translator.calls.length
    assert.deepEqual(await put({ text: 'Сервер перезагружается.', active: true }), { translation: 'failed', text: 'Сервер перезагружается.', textEn: null, textEnSource: null, active: true })
    assert.equal(translator.calls.length, calls + 1)
    assert.deepEqual([(await own()).textEn, (await own()).textEnSource], [null, null])
    translator.answer(async () => 'The server is restarting.')
    assert.deepEqual(await put({ text: 'Сервер перезагружается.', active: true }), { translation: 'auto', text: 'Сервер перезагружается.', textEn: 'The server is restarting.', textEnSource: 'auto', active: true })
    // Answers that are no English count as failures: empty, longer than the apps show, still Russian.
    for (const [index, answer] of ['  ', 'a'.repeat(501), 'Сервер перезагружается.'].entries()) {
      translator.answer(async () => answer)
      assert.equal((await put({ text: `Сервер перезагружается ${index + 2}-й раз.`, active: true })).translation, 'failed', answer)
    }
    // Nothing Russian in it: the same text for everybody, nothing asked.
    const before = translator.calls.length
    assert.deepEqual(await put({ text: 'Raid OS 0.6.1 — 18:00 🤝', active: true }), { translation: 'auto', text: 'Raid OS 0.6.1 — 18:00 🤝', textEn: 'Raid OS 0.6.1 — 18:00 🤝', textEnSource: 'auto', active: true })
    assert.equal(translator.calls.length, before)
    // Hidden without a text: nothing to translate.
    assert.deepEqual(await put({ text: '', active: false }), { translation: 'none', text: '', textEn: null, textEnSource: null, active: false })

    // The audit log says where the English came from, never a text.
    const details = audited()
    assert.deepEqual(details.slice(0, 5).map((entry) => entry.english), ['auto', 'auto', 'auto', 'auto', 'manual'])
    assert.equal(details.some((entry) => entry.english === 'missing'), true)
    assert.equal(details.every((entry) => Object.keys(entry).sort().join() === 'active,english,length'), true)
    const log = JSON.stringify(details) + JSON.stringify(warnings.mock.calls.map((call) => call.arguments))
    for (const text of [WORKS, UPDATE, 'Сервер', 'Update out', 'A new map']) assert.equal(log.includes(text), false, text)
    assert.equal(warnings.mock.calls.length > 0, true)
  } finally {
    await close()
  }
})

const RU = 'Уважаемые друзья! Мы запустились недавно, если возникают какие то проблемы, мы их оперативно вычисляем и устраняем. Благодарим за понимание и доверие 🤝'
const EN = 'Dear friends! We launched recently; if any issues arise, we identify and resolve them promptly. Thank you for your understanding and trust 🤝'

test('a notice written the old way, a Russian and an English paragraph, is split: no machine translation', async () => {
  // The live notice of 13.10.2026, stored by the server from before the English (no English columns yet).
  const translator = fakeTranslator()
  const { call, login, close } = await setup({ translator, database: (db) => {
    db.exec('CREATE TABLE announcement (id INTEGER PRIMARY KEY CHECK (id = 1), text TEXT NOT NULL, active INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)')
    db.prepare('INSERT INTO announcement (id, text, active, updated_by, updated_at) VALUES (1, ?, 1, ?, ?)').run(`${RU}\n\n${EN}`, 'owner@example.com', '2026-10-13T21:29:13.856Z')
  } })
  try {
    const owner = await login('owner@example.com')
    const berlin = await register(call, 'berlin@example.com', 'DE')
    const read = async (token?: string, country?: string) => (await call<Answer>('GET', '/announcement', token, undefined, country ? { 'cf-ipcountry': country } : {})).json.announcement
    assert.deepEqual(await read(), { text: RU, lang: 'ru', updatedAt: '2026-10-13T21:29:13.856Z' })
    assert.deepEqual(await read(berlin), { text: EN, lang: 'en', updatedAt: '2026-10-13T21:29:13.856Z' })
    assert.equal((await read(undefined, 'BY'))?.text, RU)
    const stored = (await call<{ announcement: Owned }>('GET', PATH, owner)).json.announcement
    assert.deepEqual([stored.text, stored.textEn, stored.textEnSource, stored.active], [RU, EN, 'manual', true])

    // Saved again unchanged from the owner app (which now shows the Russian): the owner's English stays.
    assert.deepEqual((await call<Saved>('PUT', PATH, owner, { text: RU, active: true })).json.translation, 'kept')
    assert.equal((await read(berlin))?.text, EN)
    // An older owner app still writes both: split at the save, a paragraph in neither alphabet goes to both.
    const both = await call<Saved>('PUT', PATH, owner, { text: `${EN}\n\n18:00 — 19:00\n\n${RU}`, active: true })
    assert.deepEqual([both.json.translation, both.json.announcement.text, both.json.announcement.textEn, both.json.announcement.textEnSource], ['manual', `18:00 — 19:00\n\n${RU}`, `${EN}\n\n18:00 — 19:00`, 'manual'])
    assert.equal((await read(berlin))?.text, `${EN}\n\n18:00 — 19:00`)
    assert.equal((await read())?.text, `18:00 — 19:00\n\n${RU}`)
    // With the owner's own English as well: the Russian paragraphs, and the English given.
    const given = await call<Saved>('PUT', PATH, owner, { text: `${RU}\n\n${EN}`, active: true, textEn: 'Thank you!' })
    assert.deepEqual([given.json.announcement.text, given.json.announcement.textEn], [RU, 'Thank you!'])
    assert.deepEqual(translator.calls, [])
  } finally {
    await close()
  }
})

/** A fake MyMemory: every query recorded; `answer` decides the reply. */
function fakeMyMemory(answer: (query: string, init?: RequestInit) => Response | Promise<Response>) {
  const urls: URL[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    urls.push(url)
    return answer(url.searchParams.get('q') ?? '', init)
  }) as typeof fetch
  return { urls, fetcher }
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const translated = (translatedText: string, extra: Record<string, unknown> = {}) => reply({ responseData: { translatedText, match: 0.85 }, quotaFinished: false, mtLangSupported: null, responseDetails: '', responseStatus: 200, responderId: null, exception_code: null, matches: [], ...extra })
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
/** «Translates» word by word, keeping every space, line break and punctuation mark where it was. */
const wordForWord = (text: string) => text.replace(/[Ѐ-ӿ]+/g, 'word')

test('MyMemory: queries of at most 450 bytes cut at lines and sentences, line breaks kept, no key and no e-mail', async () => {
  const notice = [
    'Ведутся технические работы на сервере: приложение может не открывать карты, цены и задания.',
    'Мы переносим базу на новый быстрый диск, это займёт около получаса, иногда чуть дольше.',
    '',
    'Прогресс заданий не потеряется: всё сохранено на сервере и вернётся само, ничего делать не нужно.',
    'Если что-то пошло не так, напишите в поддержку из профиля, мы обязательно ответим.',
    'Спасибо за терпение и понимание! Хорошего рейда и удачи на Таркове.',
  ].join('\n')
  // As long as a notice gets (500 characters at most), and over one query.
  assert.ok(notice.length <= 500 && bytes(notice) > TRANSLATION_CHUNK_BYTES)
  const service = fakeMyMemory((query) => translated(wordForWord(query)))
  assert.equal(await myMemoryTranslator({ fetch: service.fetcher })(notice), wordForWord(notice))
  assert.ok(service.urls.length >= 2)
  for (const url of service.urls) {
    assert.equal(`${url.origin}${url.pathname}`, 'https://api.mymemory.translated.net/get')
    assert.deepEqual([...url.searchParams.keys()].sort(), ['langpair', 'q'])
    assert.equal(url.searchParams.get('langpair'), 'ru|en')
    assert.ok(bytes(url.searchParams.get('q')!) <= TRANSLATION_CHUNK_BYTES)
  }
  // Every query ends at a line break (the text has no longer lines), none starts or ends with a space.
  const queries = service.urls.map((url) => url.searchParams.get('q')!)
  assert.equal(queries.join('\n').replace(/\n+/g, '\n'), notice.replace(/\n+/g, '\n'))
  for (const query of queries) assert.equal(query, query.trim())

  // A short notice: one query; HTML entities in the answer are decoded.
  const short = fakeMyMemory(() => translated('It&#39;s &quot;Raid OS&quot; &amp; you &#x1F91D;'))
  assert.equal(await myMemoryTranslator({ fetch: short.fetcher })(WORKS), 'It\'s "Raid OS" & you 🤝')
  assert.equal(short.urls.length, 1)
})

test('chunks: a long line at its sentence ends, a long sentence at spaces, a giant word between letters; nothing lost', () => {
  const sentence = 'Сервер обновляется прямо сейчас и скоро вернётся.'
  const texts = [
    WORKS,
    Array.from({ length: 12 }, () => sentence).join(' '),
    Array.from({ length: 60 }, (_, index) => `слово${index}`).join(' '),
    'я'.repeat(400),
    '🤝'.repeat(150),
    `${'Строка.\n'.repeat(40)}\n\nКонец.`,
    `Первый абзац.\n \n\nВторой.  Третий!   Четвёртый? ${'ж'.repeat(300)} пятый…`,
  ]
  for (const text of texts) {
    const chunks = translationChunks(text)
    assert.equal(chunks.map((chunk) => chunk.text + chunk.after).join(''), text.trim(), text.slice(0, 30))
    for (const chunk of chunks) {
      assert.ok(chunk.text.length > 0 && bytes(chunk.text) <= TRANSLATION_CHUNK_BYTES, chunk.text.slice(0, 30))
      assert.equal(chunk.text.includes('�'), false)
    }
  }
  assert.equal(translationChunks(WORKS).length, 1)
  // Cut at sentence ends while sentences fit.
  const sentences = translationChunks(texts[1]!)
  assert.ok(sentences.length > 1)
  for (const chunk of sentences.slice(0, -1)) assert.match(chunk.text, /\.$/)
  // A pair of surrogates is never torn apart.
  for (const chunk of translationChunks(texts[4]!)) assert.match(chunk.text, /^(?:🤝)+$/u)
})

test('MyMemory: an HTTP error, the quota warning, another status, an empty answer or no answer in 8 s is a failure', async () => {
  const fails = async (answer: Parameters<typeof fakeMyMemory>[0], options: { timeoutMs?: number } = {}) => {
    const service = fakeMyMemory(answer)
    await assert.rejects(myMemoryTranslator({ fetch: service.fetcher, ...options })(WORKS))
  }
  await fails(() => reply({ error: 'down' }, 503))
  await fails(() => new Response('<html>Bad gateway</html>', { status: 502 }))
  await fails(() => translated('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN  10 HOURS 05 MINUTES 47 SECONDS', { responseStatus: 429, quotaFinished: true }))
  await fails(() => translated('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.'))
  await fails(() => translated('Maintenance', { quotaFinished: true }))
  await fails(() => translated('QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS', { responseStatus: 403 }))
  await fails(() => translated('Maintenance', { responseStatus: '403' }))
  await fails(() => translated('   '))
  await fails(() => reply({ responseStatus: 200 }))
  await fails(() => new Response('not json', { status: 200 }))
  await fails(() => { throw new TypeError('fetch failed') })
  // No answer: given up after the timeout (8 s by default). AbortSignal.timeout does not hold the process (a server
  // does), so the test holds it meanwhile.
  let signal: AbortSignal | undefined
  const alive = setInterval(() => {}, 10)
  try {
    await fails((_query, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason)))
    }, { timeoutMs: 30 })
  } finally {
    clearInterval(alive)
  }
  assert.equal(signal?.aborted, true)
  // One chunk failing fails the whole translation: no half-English notice.
  let count = 0
  const long = Array.from({ length: 14 }, () => 'Сервер обновляется прямо сейчас и скоро вернётся.').join('\n')
  await assert.rejects(myMemoryTranslator({ fetch: fakeMyMemory((query) => (count++ === 1 ? reply({}, 500) : translated(wordForWord(query)))).fetcher })(long))
  assert.ok(count > 1)
})

interface Features { minimap: boolean; minimapChangedAt: string | null; updatedBy?: string | null }
const FEATURES = '/accounts/me/admin/features'

test('the minimap switch: off by default, only the owner turns it, every app reads it without an account, logged', async () => {
  let db!: DatabaseSync
  const { call, login, close } = await setup({ database: (opened) => { db = opened } })
  try {
    const owner = await login('owner@example.com')
    const player = await login('player@example.com')
    const read = async (token?: string) => {
      const answer = await call<Answer & { features: Features }>('GET', '/announcement', token)
      assert.equal(answer.status, 200)
      assert.equal(answer.headers.get('cache-control'), 'no-store')
      return answer.json.features
    }
    // After the update: off for everybody, never switched off yet.
    assert.deepEqual(await read(), { minimap: false, minimapChangedAt: null })
    assert.deepEqual(await read(player), { minimap: false, minimapChangedAt: null })

    assert.equal((await call('PUT', FEATURES, undefined, { minimap: true })).status, 401)
    assert.equal((await call('PUT', FEATURES, player, { minimap: true })).status, 404)
    assert.equal((await call('GET', FEATURES, player)).status, 404)
    assert.equal((await call('PUT', FEATURES, owner, { minimap: 'yes' })).status, 400)
    assert.deepEqual(await read(), { minimap: false, minimapChangedAt: null }, 'refused writes change nothing')

    // On: an app waiting with `since` gets it at once.
    const first = await call<Answer>('GET', '/announcement')
    const waiting = call<Answer & { features: Features }>('GET', `/announcement?since=${first.json.version}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const on = await call<{ features: Features }>('PUT', FEATURES, owner, { minimap: true })
    assert.equal(on.status, 200)
    assert.deepEqual([on.json.features.minimap, on.json.features.minimapChangedAt, on.json.features.updatedBy], [true, null, 'owner@example.com'])
    assert.equal((await waiting).json.features.minimap, true)
    assert.deepEqual(await read(player), { minimap: true, minimapChangedAt: null })

    // Off again: the time of the switch-off is new (the apps show their notice once more); off twice keeps it.
    const off = await call<{ features: Features }>('PUT', FEATURES, owner, { minimap: false })
    const offAt = off.json.features.minimapChangedAt
    assert.equal(off.json.features.minimap, false)
    assert.ok(offAt && !Number.isNaN(Date.parse(offAt)))
    assert.deepEqual(await read(), { minimap: false, minimapChangedAt: offAt })
    await call('PUT', FEATURES, owner, { minimap: false })
    assert.equal((await read()).minimapChangedAt, offAt)
    // The public answer carries no author.
    assert.equal('updatedBy' in (await read()), false)
    assert.equal((await call<{ features: Features }>('GET', FEATURES, owner)).json.features.updatedBy, 'owner@example.com')

    const logged = (db.prepare("SELECT actor, target, details FROM owner_audit_log WHERE action = 'features.minimap' ORDER BY id").all() as Array<{ actor: string; target: string; details: string }>)
      .map((row) => [row.actor, row.target, JSON.parse(row.details) as Record<string, unknown>])
    assert.deepEqual(logged, [['owner@example.com', 'minimap', { enabled: true }], ['owner@example.com', 'minimap', { enabled: false }], ['owner@example.com', 'minimap', { enabled: false }]])
  } finally {
    await close()
  }
})
