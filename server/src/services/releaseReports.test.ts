import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'
import { PaymentStore } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'
import { fetchLiveVersion, listedReports, ReleaseReports, startReleaseReports, type ReleaseReportsWiring } from './releaseReports.js'

/**
 * «Если я взял в работу, и это реализовано в обновлении, вышло обновление… заявка, которая в процессе, должна закрываться»
 * (owner, 07.11.2026). The job runs on the real API's wiring: the same buttons, the same window, the same audit.
 */
const password = 'correct horse battery'
const row = (version: string, reports: unknown) => ({ version, date: '2026-11-08', changes: ['Исправление'], reports })

interface Notice { title: string; titleEn?: string; text: string }
interface Report { work: { status: string }; status: string }

async function setup(extra: { releaseReports?: (wiring: ReleaseReportsWiring) => void } = {}) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  let wiring: ReleaseReportsWiring | undefined
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, {
    payments: new PaymentStore(db, undefined),
    guard: { quickCheckEveryMs: 0 },
    bugReportLimits: { perAccount: 100, perIp: 100 },
    releaseReports: extra.releaseReports ?? ((given) => { wiring = given }),
  }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${origin}/v1${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json().catch(() => undefined) as T }
  }
  const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  const player = (await call<{ token: string }>('POST', '/accounts/register', undefined, { email: 'player@example.com', password, country: 'RU' })).json.token
  const send = async (body: Record<string, unknown> = {}) => (await call<{ id: number }>('POST', '/bug-reports', player, { topic: 'Карта', description: 'Не открывается', ...body })).json.id
  const work = async (id: number, action: string, plan?: string) => assert.equal((await call('POST', `/accounts/me/admin/bug-reports/${id}/work`, owner, { action, plan })).status, 200)
  const report = async (id: number) => (await call<{ report: Report }>('GET', `/accounts/me/admin/bug-reports/${id}`, owner)).json.report
  const status = async (id: number) => (await report(id)).work.status
  const notices = async (token = player) => (await call<{ notices: Notice[] }>('GET', '/me/notices', token)).json.notices
  const told = async () => (await notices()).map((notice) => notice.title)
  const state = { live: '0.6.0-272' as string | undefined }
  const lines: string[] = []
  /** A start of the server: a new job on the same database, as index.ts makes at each start. */
  const start = (history: unknown, overrides: Partial<ReleaseReportsWiring> = {}) => {
    const asked = { count: 0 }
    const job = new ReleaseReports({ ...wiring!, ...overrides, history, log: (line) => lines.push(line), liveVersion: async () => { asked.count += 1; return state.live } })
    return { job, asked }
  }
  return { db, origin, call, owner, player, send, work, report, status, notices, told, state, lines, start, wiring: () => wiring!, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('a report in work closes with its release, and its author is told once', async () => {
  const t = await setup()
  try {
    const bug = await t.send()
    const idea = await t.send({ kind: 'idea', topic: 'Тёмная тема', description: 'Хочу темнее' })
    await t.work(bug, 'take')
    await t.work(idea, 'take')
    const events = async () => (await t.call<{ version: number }>('GET', '/accounts/me/admin/requests/events?since=0', t.owner)).json.version
    const before = await events()

    const { job, asked } = t.start([row('0.6.0.272', [bug, idea])])
    assert.equal(await job.check(), 2, 'one look: the publisher could still roll back')
    assert.equal(await t.status(bug), 'taken')
    assert.equal(await job.check(), 0, 'the second look in a row closes them')

    // Exactly what «Готово» makes of it: the list, the old status, the author's window, the audit, the owner's table.
    for (const id of [bug, idea]) assert.deepEqual([(await t.report(id)).work.status, (await t.report(id)).status], ['implemented', 'closed'])
    const windows = await t.notices()
    assert.deepEqual(windows.map((notice) => notice.title), [`Отчёт №${bug} принят в работу`, `Предложение №${idea} принято в работу`, `Ваш отчёт №${bug} выполнен`, `Ваше предложение №${idea} добавлено`])
    assert.deepEqual([windows[2]!.titleEn, windows[2]!.text], [`Your report №${bug} has been resolved`, 'Спасибо!'])
    assert.deepEqual(await t.notices(t.owner), [])
    const audit = t.db.prepare("SELECT actor, target, details FROM owner_audit_log WHERE action = 'bug.work' AND actor LIKE 'Выпуск%' ORDER BY id").all() as Array<{ actor: string; target: string; details: string }>
    assert.deepEqual(audit.map((line) => [line.actor, line.target, JSON.parse(line.details)]), [bug, idea].map((id) => ['Выпуск 0.6.0.272', String(id), { action: 'implemented', status: 'implemented' }]))
    assert.ok(await events() > before, 'the owner\'s table moves')
    const closed = (await t.call<{ rows: Array<{ id: number }> }>('GET', '/accounts/me/admin/bug-reports/table?view=closed', t.owner)).json.rows.map((line) => line.id)
    assert.deepEqual(closed.sort(), [bug, idea].sort())

    // Nothing more to look for, and nothing more is said.
    assert.equal(await job.check(), 0)
    assert.equal(asked.count, 2)
    assert.equal((await t.told()).length, 4)
    // Numbers only in the log.
    assert.ok(t.lines.some((line) => line.includes(`report №${bug} closed`)))
    assert.ok(!t.lines.join('\n').includes('@'))
  } finally { await t.close() }
})

test('a failed window never undoes the change, and a report without an account still closes', async () => {
  const t = await setup()
  try {
    const failing = await t.send()
    const gone = await t.send()
    await t.work(failing, 'take')
    await t.work(gone, 'take')
    t.db.prepare('UPDATE bug_reports SET account_id = NULL, email = NULL WHERE id = ?').run(gone)
    const { job } = t.start([row('0.6.0.272', [failing, gone])], { effects: { ...t.wiring().effects, done: () => { throw new Error('no window') } } })
    await job.check()
    assert.equal(await job.check(), 0)
    assert.deepEqual([await t.status(failing), await t.status(gone)], ['implemented', 'implemented'])
    assert.equal((await t.told()).filter((title) => title.includes('выполнен')).length, 0)
  } finally { await t.close() }
})

test('a new start changes nothing: no second window, and a report taken again stays with the owner', async () => {
  const t = await setup()
  try {
    const id = await t.send()
    await t.work(id, 'take')
    const history = [row('0.6.0.272', [id])]
    const first = t.start(history).job
    await first.check()
    await first.check()
    const toldOnce = await t.told()
    assert.equal(toldOnce.length, 2)

    for (let restart = 0; restart < 3; restart++) {
      const { job, asked } = t.start(history)
      assert.equal(await job.check(), 0)
      assert.equal(await job.check(), 0)
      assert.equal(asked.count, 0, 'nothing waits: the site is not even asked')
    }
    assert.deepEqual(await t.told(), toldOnce)

    // The fix did not hold: the owner reopens it and takes it again. The old row closes it no more, whatever restarts.
    await t.work(id, 'reopen')
    await t.work(id, 'take')
    const again = t.start(history).job
    await again.check()
    await again.check()
    assert.equal(await t.status(id), 'taken')
    assert.equal((await t.told()).length, 3)

    // The next release that really has the fix lists it again: its own chance.
    t.state.live = '0.6.0-275'
    const later = t.start([row('0.6.0.275', [id]), ...history]).job
    await later.check()
    assert.equal(await later.check(), 0)
    assert.equal(await t.status(id), 'implemented')
    assert.equal((await t.told()).at(-1), `Ваш отчёт №${id} выполнен`)
    assert.equal((await t.told()).length, 4)
  } finally { await t.close() }
})

test('a report not in work is left alone: nothing changes, nobody is told', async () => {
  const t = await setup()
  try {
    const untouched = await t.send()
    const rejected = await t.send()
    const already = await t.send()
    const done = await t.send()
    const queued = await t.send()
    await t.work(rejected, 'reject')
    await t.work(already, 'already')
    await t.work(done, 'take')
    await t.work(done, 'implemented')
    await t.work(queued, 'approve', 'План')
    const missing = 999_999
    const told = await t.told()
    const statuses = async () => Promise.all([untouched, rejected, already, done, queued].map((id) => t.status(id)))
    const before = await statuses()
    assert.deepEqual(before, ['review', 'rejected', 'already', 'implemented', 'queued'])

    const history = [row('0.6.0.272', [untouched, rejected, already, done, queued, missing])]
    const { job } = t.start(history)
    await job.check()
    assert.equal(await job.check(), 0, 'each had its one chance')
    assert.deepEqual(await statuses(), before)
    assert.deepEqual(await t.told(), told)
    assert.equal((await t.call('GET', `/accounts/me/admin/bug-reports/${missing}`, t.owner)).status, 404, 'and no report appears')

    // Taken after its release went out: the owner presses «Готово» himself.
    await t.work(untouched, 'take')
    const next = t.start(history).job
    await next.check()
    await next.check()
    assert.equal(await t.status(untouched), 'taken')
  } finally { await t.close() }
})

test('nothing happens before the version is live, and a look that fails starts over', async () => {
  const t = await setup()
  try {
    const id = await t.send()
    await t.work(id, 'take')
    const taken = await t.told()
    const { job } = t.start([row('0.6.0.272', [id])])

    // The publisher restarts the API first, the manifest still says the old version. A row newer than the live version waits.
    t.state.live = '0.6.0-271'
    for (let look = 0; look < 3; look++) assert.equal(await job.check(), 1)

    t.state.live = '0.6.0-272'
    assert.equal(await job.check(), 1, 'seen once')
    t.state.live = undefined
    assert.equal(await job.check(), 1, 'the site did not answer')
    t.state.live = '0.6.0-272'
    assert.equal(await job.check(), 1, 'seen once again')
    t.state.live = '0.6.0-271'
    assert.equal(await job.check(), 1, 'the publisher rolled back')
    t.state.live = '0.6.0-272'
    assert.equal(await job.check(), 1, 'once more')
    assert.equal(await t.status(id), 'taken')
    assert.deepEqual(await t.told(), taken)

    assert.equal(await job.check(), 0, 'twice in a row')
    assert.equal(await t.status(id), 'implemented')
  } finally { await t.close() }
})

test('a batch: the earlier versions of what went out count, a newer row keeps waiting', async () => {
  const t = await setup()
  try {
    const [earlier, current, newer] = [await t.send(), await t.send(), await t.send()]
    for (const id of [earlier, current, newer]) await t.work(id, 'take')
    t.state.live = '0.6.0-273'
    const { job } = t.start([row('0.6.0.274', [newer]), row('0.6.0.273', [current]), row('0.6.0.272', [earlier])])
    await job.check()
    assert.equal(await job.check(), 1)
    assert.deepEqual([await t.status(earlier), await t.status(current), await t.status(newer)], ['implemented', 'implemented', 'taken'])

    t.state.live = '0.6.0-274'
    await job.check()
    assert.equal(await job.check(), 0)
    assert.equal(await t.status(newer), 'implemented')
  } finally { await t.close() }
})

test('a broken or missing list stops nothing', async () => {
  const t = await setup()
  try {
    const id = await t.send()
    await t.work(id, 'take')
    const broken: unknown[] = [
      undefined, null, 'x', 42, {},
      [null, 1, 'x', {}, [], { version: '0.6.0.272' }],
      [row('0.6.0.272', undefined), { version: 1, reports: [id] }, row('abc', [id]), row('0.6.0.272', String(id)), row('0.6.0.272', { id }), row('0.6.0.272', [-1, 0, 1.5, String(id), null, {}])],
    ]
    for (const history of broken) {
      const { job, asked } = t.start(history)
      assert.equal(await job.check(), 0, JSON.stringify(history) ?? 'undefined')
      assert.equal(asked.count, 0)
    }
    assert.equal(await t.status(id), 'taken')
    assert.ok(!t.lines.join('\n').includes(String(id) + ' closed'))

    // A good row beside broken ones still counts, and a number listed twice is one report.
    assert.deepEqual(listedReports([null, row('abc', [1]), row('0.6.0.272', [id, id, 'x'])]), [{ version: '0.6.0.272', report: id }])

    // The site answers nonsense, or fails: the job waits and does not throw.
    const unsure = [async () => { throw new Error('offline') }, () => { throw new Error('at once') }, async () => '', async () => 'abc', async () => null as unknown as undefined]
    for (const liveVersion of unsure) {
      const job = new ReleaseReports({ ...t.wiring(), history: [row('0.6.0.272', [id])], liveVersion })
      assert.equal(await job.check(), 1)
      assert.equal(await job.check(), 1)
    }
    assert.equal(await t.status(id), 'taken')

    // The start itself: a database that fails, a list that makes no sense, a look that fails. Nothing reaches the server.
    const closed = openDatabase(':memory:')
    closed.close()
    let log = ''
    const never = async () => { throw new Error('never asked') }
    startReleaseReports({ ...t.wiring(), db: closed, history: [row('0.6.0.272', [id])], liveVersion: never, log: (line) => { log = line } })()
    assert.match(log, /Release reports failed/)
    startReleaseReports({ ...t.wiring(), history: 'x', liveVersion: never })()
    const failing = startReleaseReports({ ...t.wiring(), history: [row('0.6.0.272', [id])], liveVersion: never, everyMs: 5 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    failing()
    assert.equal(await t.status(id), 'taken')
  } finally { await t.close() }

  const started = await setup({ releaseReports: () => { throw new Error('the job cannot start') } })
  try {
    assert.equal((await fetch(`${started.origin}/health`)).status, 200, 'the server starts all the same')
    const id = await started.send()
    await started.work(id, 'take')
    await started.work(id, 'implemented')
    assert.equal(await started.status(id), 'implemented', 'and the owner\'s button works')
  } finally { await started.close() }
})

test('at the start: a look now, one on the timer, and no more asking once nothing waits', async () => {
  const t = await setup()
  try {
    const id = await t.send()
    await t.work(id, 'take')
    let asked = 0
    const stop = startReleaseReports({ ...t.wiring(), history: [row('0.6.0.272', [id])], liveVersion: async () => { asked += 1; return '0.6.0-272' }, everyMs: 5 })
    const until = Date.now() + 5000
    while (await t.status(id) !== 'implemented' && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(await t.status(id), 'implemented')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const settled = asked
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(asked, settled, 'the timer stopped by itself')
    stop()
  } finally { await t.close() }
})

test('the live version is what /download/version.json says', async () => {
  const urls: string[] = []
  const answer = (status: number, body: string): typeof fetch => async (url) => { urls.push(String(url)); return new Response(body, { status }) }
  assert.equal(await fetchLiveVersion('https://raidos.app/', answer(200, JSON.stringify({ version: '0.6.0-271', build: 1, commit: 'x', edition: 'client', size: 1, sha256: 'x', signature: 'x' }))), '0.6.0-271')
  assert.deepEqual(urls, ['https://raidos.app/download/version.json'])
  assert.equal(await fetchLiveVersion('https://raidos.app', answer(200, '{}')), undefined)
  assert.equal(await fetchLiveVersion('https://raidos.app', answer(200, 'null')), undefined)
  await assert.rejects(fetchLiveVersion('https://raidos.app', answer(502, 'Bad gateway')), /HTTP 502/)
  await assert.rejects(fetchLiveVersion('https://raidos.app', answer(200, '<html>')))
})
