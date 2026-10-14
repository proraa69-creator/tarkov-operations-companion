// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiBase, DEFAULT_API, main, parseArgs, ReadError, redact } from './read-requests.mjs'

/**
 * scripts/read-requests.mjs — how Claude reads the players' reports with the owner's read-only key (owner, 14.10.2026:
 * «2 вариант да»), against a real API server (server/src/app.ts on a random port).
 */
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { PaymentStore } = await import('../server/src/services/paymentStore')
const { openDatabase } = await import('../server/src/services/database')

const SCRIPT = fileURLToPath(new URL('./read-requests.mjs', import.meta.url))
const password = 'correct horse battery'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)])
let server: Server
let base = ''
let owner = ''
let key = ''
const ids: Record<string, number> = {}

async function call<T>(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, json: await response.json().catch(() => null) as T }
}

/** Runs main() and collects what it prints. */
async function run(argv: string[], env: Record<string, string | undefined>) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, env, (text: string) => out.push(text), (text: string) => err.push(text))
  return { code, out: out.join('\n'), err: err.join('\n') }
}

/** The script as Claude starts it: its own process, only the given environment. */
function cli(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, timeout: 20_000 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout, stderr })
    })
  })
}

beforeAll(async () => {
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [] })
  await first.register('owner@example.com', password)
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'] })
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments: new PaymentStore(db, undefined), bugReportLimits: { perAccount: 50, perIp: 50 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  owner = (await call<{ token: string }>('POST', '/v1/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
  const player = (await call<{ token: string }>('POST', '/v1/accounts/register', undefined, { email: 'player@example.com', password })).json.token
  const send = async (body: unknown) => (await call<{ id: number }>('POST', '/v1/bug-reports', player, body)).json.id
  ids.bug = await send({ topic: 'Карта не открывается', description: 'Таможня: чёрный экран.\nПишите на player@example.com\u001b[31m', category: 'map', appVersion: '0.6.0.35 · client', platform: 'Windows 10/11 x64 · desktop app · EFT: Steam', screenshots: [{ data: PNG.toString('base64') }, { data: JPEG.toString('base64') }] })
  ids.quest = await send({ topic: 'Квест: точка не там', description: '', category: 'quest', appVersion: '0.6.0.35 · client', platform: 'Windows 10/11 x64 · desktop app · EFT: BSG launcher', quest: { questId: 'q1', issue: 'wrong-point', mode: 'pve', mapId: 'customs', point: { x: 100, z: -40 }, pointNote: 'за гаражами' } })
  key = (await call<{ key: string }>('POST', '/v1/accounts/me/admin/requests-key', owner)).json.key
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('scripts/read-requests.mjs', () => {
  it('prints the reports and saves their images; the key and the players\' e-mails never appear', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raidos-requests-'))
    const env = { RAIDOS_API: `${base}/`, RAIDOS_REQUESTS_KEY: key }
    const first = await run(['--status', 'all', '--images', dir], env)
    expect([first.code, first.err]).toEqual([0, ''])
    expect(first.out).toMatch(/^Raid OS requests \(all\): 2 shown of 2 · open 2, closed 0 · http:\/\/127\.0\.0\.1:\d+$/m)
    expect(first.out).toContain(`№${ids.bug} · bug · map · open · `)
    expect(first.out).toContain('  Title:    Карта не открывается')
    expect(first.out).toContain('  App:      0.6.0.35 (client) · Windows 10/11 x64 · desktop app · EFT: Steam')
    expect(first.out).toContain('    Пишите на [e-mail][31m')
    expect(first.out).toContain('  Quest:    q1 · wrong-point · map customs')
    expect(first.out).toContain('            proposed point x 100, z -40')
    expect(first.out).toContain('            point note: за гаражами')
    expect(first.out).toContain('EFT: BSG launcher (not Steam) · PvE')
    expect(first.out).toMatch(/ {2}Reporter: r-[0-9a-f]{12}/)
    expect(first.out).toContain(`  Images:   2 → ${join(dir, `request-${ids.bug}-1.png`)}, ${join(dir, `request-${ids.bug}-2.jpg`)}`)
    for (const value of [key, key.slice(4), 'player@example.com', '\u001b']) expect(first.out).not.toContain(value)
    expect(await readFile(join(dir, `request-${ids.bug}-1.png`))).toEqual(PNG)
    expect(await readFile(join(dir, `request-${ids.bug}-2.jpg`))).toEqual(JPEG)

    // Again: the images already there are not fetched again; --json gives the API's answer.
    await writeFile(join(dir, `request-${ids.bug}-1.png`), 'kept')
    const again = await run(['--json', '--status=all', '--images', dir], env)
    expect(again.code).toBe(0)
    const answer = JSON.parse(again.out) as { total: number; reports: Array<{ id: number }>; savedImages: Record<string, string[]> }
    expect([answer.total, answer.reports.map((report) => report.id)]).toEqual([2, [ids.quest, ids.bug]])
    expect(answer.savedImages).toEqual({ [ids.bug!]: [join(dir, `request-${ids.bug}-1.png`), join(dir, `request-${ids.bug}-2.jpg`)] })
    expect(await readFile(join(dir, `request-${ids.bug}-1.png`), 'utf8')).toBe('kept')
    expect((await readdir(dir)).sort()).toEqual([`request-${ids.bug}-1.png`, `request-${ids.bug}-2.jpg`])
    const page = await run(['--limit', '1'], env)
    expect(page.out).toContain(`№${ids.quest} · bug · quest · open`)
    expect(page.out).toContain('More: --offset 1')
  })

  it('says what is wrong: no key, not a key, a refused or revoked key; the key is never repeated', async () => {
    const missing = await cli([], { RAIDOS_API: base })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('RAIDOS_REQUESTS_KEY is not set')
    expect(missing.stderr).toContain('«Доступ Claude к заявкам»')

    // Behind an HTTPS proxy the script restarts itself with NODE_USE_ENV_PROXY=1 and still explains.
    const proxied = await cli([], { HTTPS_PROXY: 'http://127.0.0.1:9' })
    expect([proxied.code, proxied.stderr.trim().split('\n').length]).toEqual([2, 1])
    expect(proxied.stderr).toContain('RAIDOS_REQUESTS_KEY is not set')

    const malformed = await cli([], { RAIDOS_API: base, RAIDOS_REQUESTS_KEY: 'my-secret-value' })
    expect(malformed.code).toBe(2)
    expect(malformed.stderr).toContain('not a key from the owner app')
    expect(malformed.stderr).not.toContain('my-secret-value')

    const wrong = `rok_${'W'.repeat(43)}`
    const refused = await run([], { RAIDOS_API: base, RAIDOS_REQUESTS_KEY: wrong })
    expect(refused.code).toBe(3)
    expect(refused.err).toContain('the key was refused')
    expect(`${refused.out}${refused.err}`).not.toContain(wrong.slice(4))

    const cliOk = await cli(['--limit', '1'], { RAIDOS_API: base, RAIDOS_REQUESTS_KEY: key })
    expect(cliOk.code).toBe(0)
    expect(`${cliOk.stdout}${cliOk.stderr}`).not.toContain(key.slice(4))
    expect((await call('DELETE', '/v1/accounts/me/admin/requests-key', owner)).status).toBe(204)
    const revoked = await cli([], { RAIDOS_API: base, RAIDOS_REQUESTS_KEY: key })
    expect(revoked.code).toBe(3)
    expect(revoked.stderr).toContain('the key was refused')
    expect(`${revoked.stdout}${revoked.stderr}`).not.toContain(key.slice(4))
  })

  it('checks its arguments and RAIDOS_API', () => {
    expect(parseArgs([])).toEqual({ status: 'open', limit: 50, offset: 0, images: '', json: false, help: false })
    expect(parseArgs(['--status', 'closed', '--limit=200', '--offset', '50', '--images', 'out', '--json'])).toEqual({ status: 'closed', limit: 200, offset: 50, images: 'out', json: true, help: false })
    for (const argv of [['--status', 'new'], ['--limit', '0'], ['--limit', '201'], ['--offset', '-1'], ['--images'], ['--stauts', 'open']]) {
      expect(() => parseArgs(argv)).toThrow(ReadError)
    }
    // A key pasted as an argument is not repeated in the error.
    expect(() => parseArgs([`rok_${'A'.repeat(43)}`])).toThrow(/^unexpected argument \(see --help\)$/)
    expect(apiBase({})).toBe(DEFAULT_API)
    expect(apiBase({ RAIDOS_API: 'https://raidos.app/api/' })).toBe('https://raidos.app/api')
    expect(apiBase({ RAIDOS_API: 'http://127.0.0.1:8787' })).toBe('http://127.0.0.1:8787')
    for (const raw of ['http://raidos.app/api', 'https://user:pass@raidos.app/api', 'https://raidos.app/api?x=1', 'ftp://raidos.app', 'raidos.app']) {
      expect(() => apiBase({ RAIDOS_API: raw })).toThrow(ReadError)
    }
    expect(redact(`a rok_${'Z'.repeat(43)} b`)).toBe('a rok_… b')
  })
})
