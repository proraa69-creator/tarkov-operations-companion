import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { ProgressStore } from '../services/progressStore.js'
import {
  BAN_SCORE, bodyInjection, crossSiteBrowserLoad, injectionMarker, ipRateKey, isLoopbackIp, maskIp, RETENTION_MS, SCANNER_DISTINCT_WINDOW_MS, scannerPath, SecurityGuard, traversalUrl,
} from '../services/securityGuard.js'
import { request as httpRequest } from 'node:http'
import express from 'express'
import { createAdminRouter } from './admin.js'
import { BackupService, backupName, backupsToRemove, parseBackupName } from '../services/serverBackups.js'
import { ServerHealth, noteUnhandled, resetUnhandled } from '../services/serverHealth.js'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const password = 'correct horse battery'

/**
 * Every real API path (server/src/routes/*.ts, app.ts) with the query strings the app and the website really send.
 * None of them may ever score.
 */
const REAL_PATHS = [
  '/health',
  '/v1/catalog/pvp', '/v1/catalog/pve', '/v1/catalog/seasonal',
  '/v1/players/resolve', '/v1/players/pvp/1234567', '/v1/players/seasonal/9999999',
  '/v1/sync/events',
  '/v1/goons/pvp', '/v1/goons/pve/sightings',
  '/v1/payments/plans', '/v1/payments', '/v1/payments/autopay/cancel', '/v1/payments/2d0000000001-000f-5000-9000-1b68e7b15f3f',
  '/v1/payments/yookassa/webhook', '/v1/payments/lava/webhook',
  '/v1/accounts/register', '/v1/accounts/login', '/v1/accounts/logout', '/v1/accounts/me', '/v1/accounts/me/password',
  '/v1/accounts/me/referral', '/v1/accounts/me/nicknames', '/v1/accounts/referral-visits', '/v1/accounts/streamer-invite',
  '/v1/accounts/me/referral-stats?period=day', '/v1/accounts/me/referral-stats?period=month', '/v1/accounts/me/streamer-invite',
  '/v1/accounts/me/referral-campaigns', '/v1/accounts/me/consents',
  '/v1/accounts/register/confirm', '/v1/accounts/register/resend', '/v1/accounts/email/login/start', '/v1/accounts/email/login',
  '/v1/accounts/email/reset/start', '/v1/accounts/email/reset', '/v1/accounts/me/email/start', '/v1/accounts/me/email/confirm',
  '/v1/accounts/auth-config', '/v1/accounts/phone/login/start', '/v1/accounts/phone/login', '/v1/accounts/phone/reset/start',
  '/v1/accounts/phone/reset', '/v1/accounts/me/phone/start', '/v1/accounts/me/phone/confirm', '/v1/accounts/me/phone/remove',
  '/v1/accounts/me/login-codes', '/v1/accounts/login-codes/redeem', '/v1/accounts/qr-login', '/v1/accounts/qr-login/poll',
  '/v1/accounts/me/qr-login/inspect', '/v1/accounts/me/qr-login/approve',
  '/v1/accounts/me/payouts', '/v1/accounts/me/payout-settings', '/v1/accounts/me/admin/payouts', '/v1/accounts/me/admin/payouts/decide',
  '/v1/accounts/me/admin/payout-limits', '/v1/accounts/me/admin/streamers', '/v1/accounts/me/admin/streamer-stats?code=SHELL&period=day',
  '/v1/accounts/me/admin/streamer-invites', '/v1/accounts/me/admin/overview', '/v1/accounts/me/admin/series?period=year',
  '/v1/accounts/me/admin/payments?from=2026-09-01&to=2026-10-01&status=succeeded&provider=lava&plan=12m&q=o%27brien%40example.com&limit=100&offset=0',
  '/v1/accounts/me/admin/payments.csv?from=2026-09-01&q=player%2Btag%40mail.ru',
  '/v1/accounts/me/admin/users?q=select%40example.com&filter=streamers&limit=100&offset=200', '/v1/accounts/me/admin/users/0123456789abcdef01234567',
  '/v1/accounts/me/admin/users/0123456789abcdef01234567/grant', '/v1/accounts/me/admin/users/0123456789abcdef01234567/cancel-autopay',
  '/v1/accounts/me/admin/users/0123456789abcdef01234567/block', '/v1/accounts/me/admin/users/0123456789abcdef01234567/unblock',
  '/v1/accounts/me/admin/users/0123456789abcdef01234567/revoke-sessions', '/v1/accounts/me/admin/streamer-settings',
  '/v1/accounts/me/admin/streamers/SHELL/percent', '/v1/accounts/me/admin/streamers/WP-ADMIN/link', '/v1/accounts/me/admin/streamers/CGI_BIN/link',
  '/v1/accounts/me/admin/sales-settings', '/v1/accounts/me/admin/audit?limit=100&offset=0',
  '/v1/accounts/me/admin/security', '/v1/accounts/me/admin/security/events?limit=50&reason=scanner', '/v1/accounts/me/admin/security/bans/12/unban',
  '/v1/map-bosses', '/v1/quest-points', '/v1/map-updates', '/v1/map-updates?since=1791283908575',
  '/v1/bug-reports', '/v1/accounts/me/admin/bug-reports?status=open&limit=50&offset=0', '/v1/accounts/me/admin/bug-reports/12',
  '/v1/accounts/me/admin/bug-reports/12/files/0', '/v1/accounts/me/admin/bug-reports/12/status',
  '/v1/admin/streamers', '/v1/admin/streamer-invites', '/v1/admin/accounts', '/v1/admin/sms', '/v1/admin/email',
  '/v1/me/progress/pvp', '/v1/me/progress/pve/events', '/v1/me/collector/seasonal', '/v1/me/position/pvp', '/v1/me/settings', '/v1/me/summary',
]

/** A 1×1 PNG (base64) for the bug report upload. */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** Bodies real clients send (passwords and notes may contain anything). */
const REAL_BODIES: unknown[] = [
  { email: 'player@example.com', password: "' OR '1'='1 -- my real password" },
  { email: "o'brien@example.com", password: 'x' },
  { currentPassword: '<script>', newPassword: 'union select from' },
  { nicknames: { pvp: 'Select_Union', pve: 'drop_table', seasonal: 'Script-Kid' } },
  { mode: 'pvp', nickname: 'Union-Select' },
  { mapId: 'customs' },
  { plan: '12m', consent: { version: '2026-09-01' }, region: 'intl', language: 'en' },
  { code: 'STREAMER_1', campaign: 'youtube-2026-10' },
  { reason: 'Подарок за стрим: 1 месяц, «спасибо» за помощь — or 1 more', days: 30 },
  { comment: "Paid 1500 ₽; client's card ending 4242", status: 'paid', id: '0123456789abcdef01234567' },
  { phone: '+7 (999) 123-45-67', password: 'pa$$; DROP' },
  { challengeId: 'abc', code: '123456' },
  { itemIds: ['5c0e531286f7747fa54205c2', 'select'] },
]

test('real API paths, queries and bodies never look like an attack', () => {
  for (const url of REAL_PATHS) {
    const [path, query] = url.split('?') as [string, string | undefined]
    assert.equal(scannerPath(path), false, `scanner: ${url}`)
    assert.equal(traversalUrl(url), false, `traversal: ${url}`)
    if (query) assert.equal(injectionMarker(query), false, `injection: ${url}`)
  }
  for (const body of REAL_BODIES) assert.equal(bodyInjection(body), false, JSON.stringify(body))
})

test('scanner paths, traversal and injection markers are recognised', () => {
  for (const path of ['/.env', '/.git/config', '/api/.env', '/wp-login.php', '/wp-admin/', '/phpmyadmin/index.php', '/cgi-bin/luci', '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', '/.aws/credentials', '/config.yml', '/backup.sql', '/actuator/health', '/v1/.env', '/index.php'])
    assert.equal(scannerPath(path), true, path)
  for (const url of ['/v1/../../etc/passwd', '/v1/%2e%2e/%2e%2e/etc', '/static/..%2f..%2fwin.ini', '/v1/catalog/pvp?file=../../etc/passwd', '/a/%252e%252e/b', '/v1\\..\\..\\boot.ini'])
    assert.equal(traversalUrl(url), true, url)
  for (const text of ["q=1' or '1'='1", 'id=1 UNION SELECT password FROM users', 'q=%3Cscript%3Ealert(1)%3C/script%3E', 'x=${jndi:ldap://evil/a}', "n=1;DROP TABLE accounts", 'q=1 and sleep(5)', 'a=<img src=x onerror=alert(1)>', 'f=/etc/passwd'])
    assert.equal(injectionMarker(text), true, text)
  assert.equal(bodyInjection({ email: "a' or '1'='1" }), true)
  assert.equal(bodyInjection({ password: "a' or '1'='1" }), false)
})

test('addresses are masked and loopback is recognised', () => {
  assert.equal(maskIp('203.0.113.77'), '203.0.113.*')
  assert.equal(maskIp('::ffff:198.51.100.4'), '198.51.100.*')
  assert.equal(maskIp('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3:*')
  assert.equal(maskIp('garbage'), 'неизвестно')
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.8.9.10']) assert.equal(isLoopbackIp(ip), true, ip)
  assert.equal(isLoopbackIp('10.0.0.1'), false)
})

test('ban escalation: 15 min, then 1 h, then 24 h; resets after 7 days; loopback and the allowlist are never banned', () => {
  let clock = Date.parse('2026-10-01T10:00:00Z')
  const guard = new SecurityGuard(openDatabase(':memory:'), { now: () => clock, allowlist: ['198.51.100.10'] })
  const attack = (ip: string) => { for (let i = 0; i < 3; i += 1) guard.signal(ip, 'scanner', `/.env${i}`) }
  const ip = '203.0.113.5'
  attack(ip)
  let ban = guard.activeBan(ip)
  assert.ok(ban)
  assert.equal(ban.until - clock, 15 * MINUTE)
  clock += 16 * MINUTE
  assert.equal(guard.activeBan(ip), undefined)
  attack(ip)
  ban = guard.activeBan(ip)!
  assert.equal(ban.until - clock, 60 * MINUTE)
  clock += 61 * MINUTE
  attack(ip)
  assert.equal(guard.activeBan(ip)!.until - clock, DAY)
  clock += DAY + MINUTE
  attack(ip)
  assert.equal(guard.activeBan(ip)!.until - clock, DAY, 'stays at 24 h')
  clock += 3 * DAY
  attack(ip)
  assert.equal(guard.activeBan(ip)!.until - clock, DAY, 'bans within the last 7 days still count')
  clock += 8 * DAY
  attack(ip)
  assert.equal(guard.activeBan(ip)!.until - clock, 15 * MINUTE, 'a clean week starts again at 15 min')

  for (const safe of ['127.0.0.1', '::1', '198.51.100.10']) {
    for (let i = 0; i < 20; i += 1) guard.signal(safe, 'traversal', '/..')
    assert.equal(guard.activeBan(safe), undefined, safe)
    assert.equal(guard.score(safe), 0)
  }
  // Manual unban lifts at once; manual ban takes the chosen time.
  const manual = guard.ban('192.0.2.44', { reason: 'вручную', source: 'manual', minutes: 120, actor: 'owner@example.com' })
  assert.equal(manual.active, true)
  assert.equal(Date.parse(manual.until) - clock, 120 * MINUTE)
  assert.equal(guard.unban(manual.id, 'owner@example.com')!.active, false)
  assert.equal(guard.activeBan('192.0.2.44'), undefined)
})

test('free allowances: a few 401/404/429 cost nothing, bursts do', () => {
  let clock = Date.parse('2026-10-01T10:00:00Z')
  const guard = new SecurityGuard(openDatabase(':memory:'), { now: () => clock })
  const ip = '203.0.113.20'
  for (let i = 0; i < 20; i += 1) guard.signal(ip, 'not-found', '/v1/accounts/referral-visits')
  for (let i = 0; i < 10; i += 1) guard.signal(ip, 'auth-fail', '/v1/accounts/me')
  for (let i = 0; i < 10; i += 1) guard.signal(ip, 'rate-limited', '/v1/catalog/pvp')
  assert.equal(guard.score(ip), 0)
  assert.equal(guard.listEvents().total, 0, 'nothing stored for normal mistakes')
  // The window slides: the same again 11 minutes later is still free.
  clock += 11 * MINUTE
  for (let i = 0; i < 20; i += 1) guard.signal(ip, 'not-found', '/x')
  assert.equal(guard.score(ip), 0)
  // A 404 burst (path enumeration) bans.
  for (let i = 0; i < 40 && !guard.activeBan(ip); i += 1) guard.signal(ip, 'not-found', `/v1/x${i}`)
  assert.ok(guard.activeBan(ip))
})

test('credential stuffing: failed sign-ins over many e-mails ban; one user mistyping does not', () => {
  const clock = Date.parse('2026-10-01T10:00:00Z')
  const guard = new SecurityGuard(openDatabase(':memory:'), { now: () => clock })
  for (let i = 0; i < 8; i += 1) guard.failedLogin('203.0.113.30', '/v1/accounts/login', 'same-user')
  assert.equal(guard.score('203.0.113.30'), 0)
  for (let i = 0; i < 6; i += 1) guard.failedLogin('203.0.113.31', '/v1/accounts/login', `user-${i}`)
  assert.ok(guard.activeBan('203.0.113.31'))
  const events = guard.listEvents().events
  assert.equal(events[0]!.reason, 'credential-stuffing')
  assert.equal(events[0]!.ip, '203.0.113.*')
  assert.match(events[0]!.detail ?? '', /6 разных e-mail/)
  assert.equal(JSON.stringify(events).includes('user-'), false, 'no e-mail hashes or addresses stored')
})

test('retention: events and finished bans older than 30 days are removed', () => {
  let clock = Date.parse('2026-08-01T10:00:00Z')
  const db = openDatabase(':memory:')
  const guard = new SecurityGuard(db, { now: () => clock })
  // Two different scanner paths each (one alone scores nothing, see SCANNER_DISTINCT_PATHS).
  guard.signal('203.0.113.40', 'scanner', '/.env')
  guard.signal('203.0.113.40', 'scanner', '/.aws/credentials')
  guard.ban('203.0.113.41', { reason: 'scanner', source: 'auto' })
  clock += 10 * DAY
  guard.signal('203.0.113.42', 'scanner', '/.git/config')
  guard.signal('203.0.113.42', 'scanner', '/.git/HEAD')
  clock += RETENTION_MS - 5 * DAY
  assert.deepEqual(guard.prune(), { events: 2, bans: 1 })
  assert.equal(guard.listEvents().total, 2)
  assert.deepEqual(guard.listEvents().events.map((event) => event.path).sort(), ['/.git/HEAD', '/.git/config'])
  // Re-opening the database keeps the active ban and the salt (keys match).
  guard.ban('203.0.113.43', { reason: 'scanner', source: 'manual', minutes: 60 })
  const again = new SecurityGuard(db, { now: () => clock })
  assert.ok(again.activeBan('203.0.113.43'))
})

async function startApi() {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  /** `ip`: the visitor as the site proxy reports it (X-Forwarded-For from loopback is trusted); none = this PC directly. */
  const call = async (method: string, path: string, options: { ip?: string; token?: string; body?: unknown; raw?: string } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(options.ip ? { 'x-forwarded-for': options.ip } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.body !== undefined || options.raw ? { 'content-type': 'application/json' } : {}) },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
    const text = await response.text()
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
    return { status: response.status, json }
  }
  const login = async (email: string, ip?: string) => (await call('POST', '/v1/accounts/login', { ip, body: { email, password } })).json.token as string
  const events = () => (db.prepare('SELECT reason, path, ip_masked, count FROM security_events').all() as Array<{ reason: string; path: string; ip_masked: string; count: number }>)
  return { server, call, login, events, db }
}

test('API: a normal visitor session through the site proxy never scores', async () => {
  const { server, call, events } = await startApi()
  try {
    const ip = '198.51.100.23'
    const registered = await call('POST', '/v1/accounts/register', { ip, body: { email: 'gamer@example.com', password } })
    assert.equal(registered.status, 201)
    const token = registered.json.token as string
    for (let round = 0; round < 5; round += 1) {
      assert.equal((await call('GET', '/v1/accounts/me', { ip, token })).status, 200)
      assert.equal((await call('GET', '/v1/accounts/auth-config', { ip })).status, 200)
      assert.equal((await call('PUT', '/v1/me/settings', { ip, token, body: { settings: { notes: "<script> union select ' or '1'='1 — заметки игрока", theme: 'dark' } } })).status, 200)
      assert.equal((await call('GET', '/v1/me/summary', { ip, token })).status, 200)
      assert.equal((await call('GET', '/v1/goons/pvp', { ip })).status, 200)
      assert.equal((await call('PUT', '/v1/accounts/me/nicknames', { ip, token, body: { nicknames: { pvp: 'Select_Union' } } })).status < 500, true)
      assert.equal((await call('GET', '/v1/payments/plans', { ip })).status, 200)
      // «Сообщить об ошибке»: a description may quote code or SQL; screenshots are base64.
      assert.equal((await call('POST', '/v1/bug-reports', { ip, token, body: { topic: 'Карта <script>', description: "union select ' or '1'='1 падает при открытии", screenshots: [{ data: TINY_PNG }] } })).status, 201)
      // An expired session, an unknown streamer code, a mistyped password: everyday mistakes.
      assert.equal((await call('GET', '/v1/accounts/me', { ip, token: 'x'.repeat(43) })).status, 401)
      assert.equal((await call('POST', '/v1/accounts/referral-visits', { ip, body: { code: 'NOSUCHCODE' } })).status, 404)
    }
    assert.equal((await call('POST', '/v1/accounts/login', { ip, body: { email: 'gamer@example.com', password: "wrong' or 1=1" } })).status, 401)
    assert.equal((await call('POST', '/v1/accounts/login', { ip, body: { email: 'gamer@example.com', password } })).status, 200)
    assert.deepEqual(events(), [])
    assert.equal((await call('GET', '/v1/accounts/me', { ip, token })).status, 200)
  } finally {
    server.close()
  }
})

test('API: a scanner is banned with a cheap 403; this PC is never banned; the owner lifts the ban from the panel', async () => {
  const { server, call, login, events } = await startApi()
  try {
    const ip = '203.0.113.66'
    assert.equal((await call('GET', '/.env', { ip })).status, 404)
    assert.equal((await call('GET', '/wp-login.php', { ip })).status, 404)
    assert.equal((await call('GET', '/v1/catalog/pvp?file=../../etc/passwd', { ip })).status, 400)
    const refused = await call('GET', '/v1/accounts/auth-config', { ip })
    assert.equal(refused.status, 403)
    assert.match(String(refused.json.error), /временно ограничен/)
    const stored = events()
    assert.ok(stored.every((event) => event.ip_masked === '203.0.113.*'))
    assert.ok(stored.some((event) => event.reason === 'scanner' && event.path === '/.env'))

    // Loopback (the owner's own browser through the site server) and direct requests: never.
    for (let i = 0; i < 10; i += 1) await call('GET', '/.git/config', { ip: '127.0.0.1' })
    for (let i = 0; i < 10; i += 1) await call('GET', '/.git/config')
    assert.equal((await call('GET', '/v1/accounts/auth-config', { ip: '127.0.0.1' })).status, 200)
    assert.equal((await call('GET', '/v1/accounts/auth-config')).status, 200)

    // Admin tab: owner only.
    assert.equal((await call('GET', '/v1/accounts/me/admin/security', { ip: '198.51.100.2' })).status, 401)
    const user = (await call('POST', '/v1/accounts/register', { ip: '198.51.100.2', body: { email: 'user@example.com', password } })).json.token as string
    assert.equal((await call('GET', '/v1/accounts/me/admin/security', { ip: '198.51.100.2', token: user })).status, 404)
    const owner = await login('owner@example.com', '198.51.100.3')
    const view = await call('GET', '/v1/accounts/me/admin/security', { ip: '198.51.100.3', token: owner })
    assert.equal(view.status, 200)
    const bans = view.json.bans as Array<{ id: number; ip: string; active: boolean }>
    assert.equal(bans[0]!.ip, '203.0.113.*')
    assert.equal(bans[0]!.active, true)
    assert.equal((view.json.security as { activeBans: number }).activeBans, 1)
    assert.ok(Array.isArray(view.json.series) && (view.json.series as unknown[]).length === 24)
    assert.equal(JSON.stringify(view.json).includes('203.0.113.66'), false, 'never the full address')
    assert.equal('file' in (view.json.database as object), false, 'no paths through the site')

    // The owner's session passes even from a banned address.
    assert.equal((await call('GET', '/v1/accounts/me/admin/security', { ip, token: owner })).status, 200)
    const lifted = await call('POST', `/v1/accounts/me/admin/security/bans/${bans[0]!.id}/unban`, { ip: '198.51.100.3', token: owner })
    assert.equal(lifted.status, 200)
    assert.equal((await call('GET', '/v1/accounts/auth-config', { ip })).status, 200)

    // Manual ban and allowlist.
    assert.equal((await call('POST', '/v1/accounts/me/admin/security/bans', { ip: '198.51.100.3', token: owner, body: { ip: '192.0.2.9', hours: 2 } })).status, 200)
    assert.equal((await call('GET', '/v1/accounts/auth-config', { ip: '192.0.2.9' })).status, 403)
    assert.equal((await call('POST', '/v1/accounts/me/admin/security/bans', { ip: '198.51.100.3', token: owner, body: { ip: 'not-an-ip', hours: 2 } })).status, 400)
    const allowed = await call('POST', '/v1/accounts/me/admin/security/allowlist', { ip: '198.51.100.3', token: owner, body: { ip: '192.0.2.9', note: 'офис' } })
    assert.equal(allowed.status, 200)
    assert.equal((await call('GET', '/v1/accounts/auth-config', { ip: '192.0.2.9' })).status, 200, 'allowlisting lifts the ban')
    for (let i = 0; i < 5; i += 1) await call('GET', '/.env', { ip: '192.0.2.9' })
    assert.equal((await call('GET', '/v1/accounts/auth-config', { ip: '192.0.2.9' })).status, 200)
  } finally {
    server.close()
  }
})

test('API: webhook key failures, oversized bodies and injection in the query are scored', async () => {
  const { server, call, events } = await startApi()
  try {
    const ip = '203.0.113.80'
    assert.equal((await call('POST', '/v1/payments/lava/webhook', { ip, body: { eventType: 'payment.success' } })).status, 401)
    assert.equal((await call('POST', '/v1/accounts/login', { ip, raw: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(1_100_000) }) })).status, 413)
    assert.equal((await call('GET', "/v1/accounts/me/admin/users?q=1'%20or%20'1'%3D'1", { ip })).status, 400)
    const reasons = events().map((event) => event.reason).sort()
    assert.deepEqual(reasons, ['injection', 'oversized', 'webhook-signature'])
  } finally {
    server.close()
  }
})

test('API: /health/detail and /health/backup answer this PC only', async () => {
  const { server, call } = await startApi()
  try {
    const local = await call('GET', '/health/detail')
    assert.equal(local.status, 200)
    assert.equal(typeof (local.json.requests as { last5m: { errors: number } }).last5m.errors, 'number')
    assert.equal(typeof (local.json.memory as { rssMb: number }).rssMb, 'number')
    assert.equal(typeof (local.json.security as { activeBans: number }).activeBans, 'number')
    assert.equal((await call('GET', '/health/detail', { ip: '127.0.0.1' })).status, 404, 'through the site proxy')
    assert.equal((await call('POST', '/health/backup', { ip: '198.51.100.1', body: { kind: 'daily' } })).status, 404)
    // In-memory database: a clear error, not a crash.
    const backup = await call('POST', '/health/backup', { body: { kind: 'daily' } })
    assert.equal(backup.status, 500)
    assert.match(String(backup.json.error), /в памяти/)
  } finally {
    server.close()
  }
})

test('health: 5xx windows, the hourly series and unhandled errors', () => {
  let clock = Date.parse('2026-10-01T10:00:30Z')
  const health = new ServerHealth(openDatabase(':memory:'), { now: () => clock, quickCheckEveryMs: 0 })
  for (let i = 0; i < 90; i += 1) health.record(200)
  for (let i = 0; i < 10; i += 1) health.record(502)
  assert.deepEqual(health.errors(5), { requests: 100, errors: 10, rate: 0.1 })
  clock += 6 * MINUTE
  health.record(500)
  assert.deepEqual(health.errors(5), { requests: 1, errors: 1, rate: 1 })
  assert.equal(health.errors(15).requests, 101)
  const series = health.series(60, 24)
  assert.equal(series.length, 24)
  assert.deepEqual(series[23], { at: '2026-10-01T10:00:00.000Z', requests: 101, errors: 11 })
  assert.equal(health.quickCheck().ok, true)
  resetUnhandled()
  noteUnhandled('rejection', new Error('boom'), Date.now())
  const detail = health.detail()
  assert.equal(detail.unhandled.rejections5m, 1)
  assert.match(detail.unhandled.last?.message ?? '', /boom/)
  assert.equal(detail.database.quickCheck?.ok, true)
  resetUnhandled()
})

test('backups: VACUUM INTO next to the database, 14 days kept, other files untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raid-guard-'))
  try {
    let clock = Date.parse('2026-10-01T03:00:00Z')
    const db = openDatabase(join(dir, 'companion.sqlite'))
    db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (42)')
    const backups = new BackupService(db, { now: () => clock })
    assert.equal(backups.dir, join(dir, 'backups'))
    const first = backups.create('daily')
    assert.equal(first.name, 'companion-daily-2026-10-01T03-00-00Z.sqlite')
    const copy = openDatabase(join(dir, 'backups', first.name))
    assert.deepEqual({ ...(copy.prepare('SELECT x FROM t').get() as object) }, { x: 42 })
    copy.close()
    assert.equal(backups.create('daily').name, 'companion-daily-2026-10-01T03-00-01Z.sqlite', 'same second: next free name')
    writeFileSync(join(dir, 'backups', 'companion-2026-01-01_00-00-00.sqlite'), 'from the CLI')
    for (let day = 1; day <= 20; day += 1) { clock += DAY; backups.create(day % 7 === 0 ? 'before-restart' : 'daily') }
    const names = readdirSync(join(dir, 'backups'))
    assert.ok(names.includes('companion-2026-01-01_00-00-00.sqlite'), 'foreign files stay')
    const oldest = names.map(parseBackupName).filter((info) => info).map((info) => info!.at).sort((a, b) => a - b)[0]!
    assert.ok(clock - oldest <= 14 * DAY, 'nothing older than 14 days')
    assert.equal(backups.status().lastKind, 'daily')
    assert.equal(backups.status().count, 15)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('backup rotation keeps the newest copies even when they are old', () => {
  const now = Date.parse('2026-10-01T00:00:00Z')
  const names = [backupName('daily', now - 40 * DAY), backupName('daily', now - 30 * DAY), backupName('before-restart', now - 20 * DAY), backupName('daily', now - 16 * DAY), 'notes.txt']
  assert.deepEqual(backupsToRemove(names, now), [backupName('daily', now - 40 * DAY)])
  assert.deepEqual(backupsToRemove([backupName('daily', now - DAY), backupName('daily', now - 15 * DAY), backupName('daily', now - 2 * DAY), backupName('manual', now - 3 * DAY)], now), [backupName('daily', now - 15 * DAY)])
})

test('the ban threshold needs more than one scanner hit', () => {
  const guard = new SecurityGuard(openDatabase(':memory:'), { now: () => 0 })
  guard.signal('203.0.113.90', 'scanner', '/.env')
  assert.ok(guard.score('203.0.113.90') < BAN_SCORE)
  assert.equal(guard.activeBan('203.0.113.90'), undefined)
})

/** A raw HTTP request (fetch cannot choose Host); `headers` exactly as given. */
function rawRequest(port: number, method: string, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}) } }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

test('IPv6 rate-limit keys: one /64 is one client, IPv4 stays per address', () => {
  assert.equal(ipRateKey('2001:db8:1:2::1'), '2001:db8:1:2::/64')
  assert.equal(ipRateKey('2001:0DB8:0001:0002:ffff:eeee:dddd:cccc'), '2001:db8:1:2::/64')
  assert.notEqual(ipRateKey('2001:db8:1:3::1'), ipRateKey('2001:db8:1:2::1'))
  assert.equal(ipRateKey('::ffff:198.51.100.7'), '198.51.100.7')
  assert.equal(ipRateKey('198.51.100.7'), '198.51.100.7')
  assert.notEqual(ipRateKey('198.51.100.8'), ipRateKey('198.51.100.7'))
  assert.equal(ipRateKey('::1'), '0:0:0:0::/64')
  assert.equal(ipRateKey(undefined), 'unknown')
})

test('scanner points need two different scanner paths within a few minutes', () => {
  let clock = Date.parse('2026-10-01T10:00:00Z')
  const guard = new SecurityGuard(openDatabase(':memory:'), { now: () => clock })
  const ip = '203.0.113.91'
  // The same path again and again (a page pointing at it, a reload): nothing.
  for (let i = 0; i < 10; i += 1) guard.signal(ip, 'scanner', '/.env')
  assert.equal(guard.score(ip), 0)
  assert.equal(guard.listEvents().total, 0)
  // Two different paths too far apart: still nothing.
  clock += SCANNER_DISTINCT_WINDOW_MS + 1
  guard.signal(ip, 'scanner', '/wp-login.php')
  assert.equal(guard.score(ip), 0)
  // A second distinct path within the window: both count (the held-back one once), a third bans.
  clock += 1000
  guard.signal(ip, 'scanner', '/.git/config')
  assert.equal(guard.score(ip), 70)
  assert.deepEqual(guard.listEvents().events.map((event) => event.path).sort(), ['/.git/config', '/wp-login.php'])
  guard.signal(ip, 'scanner', '/phpmyadmin/')
  assert.ok(guard.activeBan(ip))
})

test('cross-site browser loads are recognised by Sec-Fetch-*', () => {
  const req = (headers: Record<string, string>) => ({ get: (name: string) => headers[name.toLowerCase()] }) as unknown as Parameters<typeof crossSiteBrowserLoad>[0]
  assert.equal(crossSiteBrowserLoad(req({})), false, 'scripts and scanners send no Sec-Fetch-*')
  assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-mode': 'cors' })), false, 'Node fetch')
  assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })), false, 'the site itself')
  assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })), false, 'typed into the address bar')
  assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })), true)
  assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })), true)
  assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' })), true)
  for (const dest of ['image', 'script', 'style', 'font', 'iframe', 'video', 'object']) assert.equal(crossSiteBrowserLoad(req({ 'sec-fetch-dest': dest })), true, dest)
})

test('API: another site cannot get its visitors banned with <img src=/.env> (answered, never scored)', async () => {
  const { server, events } = await startApi()
  const port = (server.address() as AddressInfo).port
  try {
    const ip = '203.0.113.120'
    const img = { 'x-forwarded-for': ip, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }
    const paths = ['/.env', '/x.php', '/wp-admin/', '/.git/config', '/cgi-bin/x', '/v1/catalog/pvp?f=../../etc/passwd', '/v1/catalog/pvp?q=%27%20or%20%271%27%3D%271', '/v1/no-such-route']
    for (let round = 0; round < 6; round += 1) {
      for (const path of paths) {
        const answer = await rawRequest(port, 'GET', path, img)
        assert.ok([400, 404].includes(answer.status), `${path}: ${answer.status}`)
      }
    }
    assert.deepEqual(events(), [], 'nothing scored')
    assert.equal((await rawRequest(port, 'GET', '/v1/accounts/auth-config', { 'x-forwarded-for': ip })).status, 200, 'not banned')
    // The same paths without Sec-Fetch-* (a real scanner): banned.
    const scanner = '203.0.113.121'
    for (const path of ['/.env', '/x.php', '/wp-admin/']) assert.equal((await rawRequest(port, 'GET', path, { 'x-forwarded-for': scanner })).status, 404)
    assert.equal((await rawRequest(port, 'GET', '/v1/accounts/auth-config', { 'x-forwarded-for': scanner })).status, 403)
  } finally {
    server.close()
  }
})

test('API: /health/backup and /health/detail refuse a browser page on this PC (Origin) and DNS rebinding (Host)', async () => {
  const { server } = await startApi()
  const port = (server.address() as AddressInfo).port
  try {
    const body = JSON.stringify({ kind: 'manual' })
    // The owner app's own call (Node fetch from the main process): Host 127.0.0.1, no Origin.
    assert.equal((await rawRequest(port, 'POST', '/health/backup', { host: `127.0.0.1:${port}` }, body)).status, 500, 'reaches the backup (in-memory database: a clear error)')
    assert.equal((await rawRequest(port, 'GET', '/health/detail', { host: `localhost:${port}` })).status, 200)
    // A web page posting from the browser on this PC.
    assert.equal((await rawRequest(port, 'POST', '/health/backup', { host: `127.0.0.1:${port}`, origin: 'https://evil.example' }, body)).status, 404)
    assert.equal((await rawRequest(port, 'POST', '/health/backup', { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' }, body)).status, 404)
    // DNS rebinding: a hostile name resolved to 127.0.0.1.
    assert.equal((await rawRequest(port, 'POST', '/health/backup', { host: `rebind.evil.example:${port}` }, body)).status, 404)
    assert.equal((await rawRequest(port, 'GET', '/health/detail', { host: `rebind.evil.example:${port}` })).status, 404)
  } finally {
    server.close()
  }
})

test('owner token API (/v1/admin): direct requests on this PC only, whatever token comes through a proxy', async () => {
  const token = 'a'.repeat(48)
  const app = express()
  app.set('trust proxy', 'loopback')
  app.use(express.json())
  app.use('/v1/admin', createAdminRouter(new AccountStore({ ownerEmails: [] }), token))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const auth = { authorization: `Bearer ${token}` }
    assert.equal((await rawRequest(port, 'GET', '/v1/admin/streamers', auth)).status, 200)
    assert.equal((await rawRequest(port, 'GET', '/v1/admin/streamers', {})).status, 404, 'no token')
    for (const forwarded of [{ 'x-forwarded-for': '127.0.0.1' } as Record<string, string>, { 'x-forwarded-for': '203.0.113.5' }, { 'cf-connecting-ip': '203.0.113.5' }, { forwarded: 'for=127.0.0.1' }]) {
      assert.equal((await rawRequest(port, 'GET', '/v1/admin/streamers', { ...auth, ...forwarded })).status, 404, JSON.stringify(forwarded))
    }
  } finally {
    server.close()
  }
})
