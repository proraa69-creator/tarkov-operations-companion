import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { sniffImage } from '../services/bugReportStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

const password = 'correct horse battery'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 2)])
const shot = (data: Buffer) => ({ data: data.toString('base64') })

async function setup(limits?: { perAccount?: number; perIp?: number }) {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, bugReportLimits: limits, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const bytes = Buffer.from(await response.arrayBuffer())
    let json: unknown
    try { json = JSON.parse(bytes.toString('utf8')) } catch { json = undefined }
    return { status: response.status, json: json as T, bytes, headers: response.headers }
  }
  const login = async (email: string) => (await call<{ token: string }>('POST', '/accounts/login', undefined, { email, password })).json.token
  const register = async (email: string) => (await call<{ token: string }>('POST', '/accounts/register', undefined, { email, password })).json.token
  return { db, accounts, call, login, register, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const report = { topic: 'Карта не открывается', description: 'Нажимаю «Карты» → Таможня, экран чёрный.', appVersion: '0.5.4 · client', platform: 'Windows · desktop' }

test('magic bytes decide the image type, not the declared one', () => {
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(JPEG), 'image/jpeg')
  assert.equal(sniffImage(WEBP), 'image/webp')
  assert.equal(sniffImage(Buffer.from('GIF89a……')), undefined)
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined)
})

test('bug reports: signed-in players send reports with screenshots; bad uploads are refused', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('POST', '/bug-reports', undefined, report)).status, 401)
    assert.equal((await t.call('POST', '/bug-reports', 'x'.repeat(43), report)).status, 401)
    const player = await t.register('player@example.com')

    const created = await t.call<{ id: number; createdAt: string }>('POST', '/bug-reports', player, { ...report, screenshots: [shot(PNG), { data: `data:image/jpeg;base64,${JPEG.toString('base64')}` }, shot(WEBP)] })
    assert.equal(created.status, 201, JSON.stringify(created.json))
    assert.equal(typeof created.json.id, 'number')

    // Missing topic / description, a topic over 120 characters, a description over 5000.
    assert.equal((await t.call('POST', '/bug-reports', player, { ...report, topic: '  ' })).status, 400)
    assert.equal((await t.call('POST', '/bug-reports', player, { ...report, description: '' })).status, 400)
    assert.equal((await t.call('POST', '/bug-reports', player, { ...report, topic: 'т'.repeat(121) })).status, 400)
    assert.equal((await t.call('POST', '/bug-reports', player, { ...report, description: 'т'.repeat(5001) })).status, 400)
    // Not an image (an SVG / HTML with a PNG name), broken base64, too many, too big.
    const svg = await t.call<{ error: string }>('POST', '/bug-reports', player, { ...report, screenshots: [shot(Buffer.from('<svg onload="alert(1)"/>'))] })
    assert.equal(svg.status, 400)
    assert.match(svg.json.error, /PNG, JPEG или WEBP/)
    assert.equal((await t.call('POST', '/bug-reports', player, { ...report, screenshots: [{ data: '!!!not base64!!!' }] })).status, 400)
    const many = await t.call<{ error: string }>('POST', '/bug-reports', player, { ...report, screenshots: Array.from({ length: 6 }, () => shot(PNG)) })
    assert.equal(many.status, 400)
    assert.match(many.json.error, /Не больше 5/)
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
    assert.equal((await t.call('POST', '/bug-reports', player, { ...report, screenshots: [shot(big)] })).status, 400)
    // Bigger than the global 1 MB JSON limit but within the bug report limit: accepted.
    const large = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)])
    const accepted = await t.call('POST', '/bug-reports', player, { ...report, screenshots: [shot(large), shot(large)] })
    assert.equal(accepted.status, 201, JSON.stringify(accepted.json))
    // Nothing of the refused ones was stored.
    assert.equal(Number((t.db.prepare('SELECT COUNT(*) AS n FROM bug_reports').get() as { n: number }).n), 2)
  } finally {
    await t.close()
  }
})

test('bug reports: the owner lists, opens, downloads screenshots and closes them; others get 404', async () => {
  const t = await setup()
  try {
    const player = await t.register('player@example.com')
    const other = await t.register('other@example.com')
    const owner = await t.login('owner@example.com')
    const first = await t.call<{ id: number }>('POST', '/bug-reports', player, { ...report, screenshots: [shot(PNG), shot(JPEG)] })
    await t.call('POST', '/bug-reports', other, { ...report, topic: 'Второй отчёт' })
    const id = first.json.id

    const paths = ['/accounts/me/admin/bug-reports', `/accounts/me/admin/bug-reports/${id}`, `/accounts/me/admin/bug-reports/${id}/files/0`]
    for (const path of paths) {
      assert.equal((await t.call('GET', path)).status, 401, path)
      assert.equal((await t.call('GET', path, player)).status, 404, path)
    }
    assert.equal((await t.call('POST', `/accounts/me/admin/bug-reports/${id}/status`, player, { status: 'closed' })).status, 404)

    type List = { reports: Array<{ id: number; email: string; topic: string; files: number; status: string; appVersion: string }>; total: number; counts: { open: number; closed: number } }
    const list = await t.call<List>('GET', '/accounts/me/admin/bug-reports?status=open', owner)
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.counts, { open: 2, closed: 0 })
    assert.equal(list.json.total, 2)
    const mine = list.json.reports.find((entry) => entry.id === id)!
    assert.deepEqual([mine.email, mine.topic, mine.files, mine.appVersion], ['player@example.com', report.topic, 2, report.appVersion])
    assert.equal(JSON.stringify(list.json).includes(PNG.toString('base64')), false, 'no image data in the list')

    const view = await t.call<{ report: { description: string; platform: string; files: Array<{ idx: number; mime: string; size: number }> } }>('GET', `/accounts/me/admin/bug-reports/${id}`, owner)
    assert.equal(view.json.report.description, report.description)
    assert.equal(view.json.report.platform, report.platform)
    assert.deepEqual(view.json.report.files, [{ idx: 0, mime: 'image/png', size: PNG.length }, { idx: 1, mime: 'image/jpeg', size: JPEG.length }])

    const file = await t.call('GET', `/accounts/me/admin/bug-reports/${id}/files/1`, owner)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('content-type'), 'image/jpeg')
    assert.equal(file.headers.get('cache-control'), 'no-store')
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff')
    assert.match(file.headers.get('content-disposition') ?? '', /^inline/)
    assert.deepEqual(file.bytes, JPEG)
    assert.equal((await t.call('GET', `/accounts/me/admin/bug-reports/${id}/files/4`, owner)).status, 404)
    assert.equal((await t.call('GET', '/accounts/me/admin/bug-reports/999', owner)).status, 404)

    assert.equal((await t.call('POST', `/accounts/me/admin/bug-reports/${id}/status`, owner, { status: 'done' })).status, 400)
    const closed = await t.call<{ report: { status: string; closedAt?: string } }>('POST', `/accounts/me/admin/bug-reports/${id}/status`, owner, { status: 'closed' })
    assert.equal(closed.json.report.status, 'closed')
    assert.ok(closed.json.report.closedAt)
    const after = await t.call<List>('GET', '/accounts/me/admin/bug-reports?status=closed', owner)
    assert.deepEqual(after.json.counts, { open: 1, closed: 1 })
    assert.deepEqual(after.json.reports.map((entry) => entry.id), [id])
    const reopened = await t.call<{ report: { status: string; closedAt?: string } }>('POST', `/accounts/me/admin/bug-reports/${id}/status`, owner, { status: 'open' })
    assert.equal(reopened.json.report.status, 'open')
    assert.equal(reopened.json.report.closedAt, undefined)

    const audit = await t.call<{ entries: Array<{ action: string; target: string; details: { status: string } }> }>('GET', '/accounts/me/admin/audit', owner)
    assert.deepEqual(audit.json.entries.filter((entry) => entry.action === 'bug.status').map((entry) => [entry.target, entry.details.status]), [[String(id), 'open'], [String(id), 'closed']])
  } finally {
    await t.close()
  }
})

test('bug reports: rate limit per account, and a deleted account leaves no e-mail on its reports', async () => {
  const t = await setup({ perAccount: 2 })
  try {
    const player = await t.register('player@example.com')
    assert.equal((await t.call('POST', '/bug-reports', player, report)).status, 201)
    assert.equal((await t.call('POST', '/bug-reports', player, report)).status, 201)
    const limited = await t.call('POST', '/bug-reports', player, report)
    assert.equal(limited.status, 429)
    assert.ok(limited.headers.get('retry-after'))

    const deleted = await t.call('POST', '/accounts/me/delete', player, { password })
    assert.ok(deleted.status < 300, JSON.stringify(deleted.json))
    const rows = t.db.prepare('SELECT account_id, email FROM bug_reports').all() as Array<{ account_id: unknown; email: unknown }>
    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.account_id === null && row.email === null))
  } finally {
    await t.close()
  }
})
