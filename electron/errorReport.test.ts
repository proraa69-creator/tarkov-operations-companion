// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { appFrames, ErrorReportQueue, fingerprint, GitHubIssueClient, issueBody, issueTitle, MARKER, REPORT_LABELS, sanitize, type IssueClient, type QueueData } from './errorReport'

const STACK = [
  'TypeError: Cannot read properties of undefined (reading \'id\')',
  '    at AccountStore.authenticate (C:\\Users\\Иван Петров\\AppData\\Local\\Temp\\2abc\\resources\\app.asar.unpacked\\dist-electron\\local-server\\server.cjs:1234:56)',
  '    at async handler (/home/owner/project/server/src/routes/me.ts:40:12)',
  '    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
].join('\n')

describe('sanitize (no IP / e-mail / token leaks)', () => {
  const secrets = {
    ipv4: '203.0.113.77', ipv6: '2001:db8::8a2e:370:7334', ipv6full: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', mapped: '::ffff:198.51.100.9',
    email: 'player.one+tag@example.co.uk', resend: 're_AbCdEf123456_xyz', live: 'live_9f8e7d6c5b4a3210', test: 'test_secretKEY12345',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl', bearer: 'Bearer abcdef0123456789session', pat: 'github_pat_11ABCDEFG0123456789_abcdefXYZ',
    hex: 'a3f1c9e2b7d4a3f1c9e2b7d4a3f1c9e2b7d4a3f1', longSecret: 'ZXlKaGJHY2lPaUpJVXpJMU5pSjkuZXlKemRXSWlPaUl4TWpNME5TSjk',
  }
  const text = [
    `login failed for ${secrets.email} from ${secrets.ipv4} and ${secrets.ipv6} / ${secrets.ipv6full} / ${secrets.mapped}`,
    `keys ${secrets.resend} ${secrets.live} ${secrets.test} ${secrets.pat}`,
    `authorization: ${secrets.bearer}; jwt=${secrets.jwt}; session ${secrets.hex}; blob ${secrets.longSecret}`,
    'GET https://raidos.app/v1/accounts/login-codes/redeem?code=123456&email=x%40y.z -> 500',
    'password=hunter2 api_key: "sk-local-123"',
    STACK,
  ].join('\n')
  const clean = sanitize(text)

  it('removes every secret and personal value', () => {
    for (const [kind, value] of Object.entries(secrets)) expect(clean, kind).not.toContain(value)
    expect(clean).not.toMatch(/203\.0\.113|198\.51\.100|2001:/)
    expect(clean).not.toMatch(/@example/)
    expect(clean).not.toContain('hunter2')
    expect(clean).not.toContain('sk-local-123')
    expect(clean).not.toContain('code=123456')
    expect(clean).not.toContain('Иван Петров')
    expect(clean).not.toContain('/home/owner')
  })

  it('keeps what is needed to fix the bug', () => {
    expect(clean).toContain('<e-mail>')
    expect(clean).toContain('<ip>')
    expect(clean).toContain('Bearer <token>')
    expect(clean).toContain('https://raidos.app/v1/accounts/login-codes/redeem?<query>')
    expect(clean).toContain('%USERPROFILE%\\AppData\\Local\\Temp')
    expect(clean).toContain('%USERPROFILE%/project/server/src/routes/me.ts:40:12')
    expect(clean).toContain('server.cjs:1234:56')
    expect(clean).toContain("TypeError: Cannot read properties of undefined (reading 'id')")
  })

  it('leaves line:column pairs, times and versions alone', () => {
    expect(sanitize('at x (file.js:12:34) at 12:30:45 build 0.5.4')).toBe('at x (file.js:12:34) at 12:30:45 build 0.5.4')
  })
})

describe('fingerprint', () => {
  it('uses the error name and the app frames, not line numbers, paths or the message', () => {
    expect(appFrames(STACK)).toEqual(['AccountStore.authenticate server.cjs', 'handler me.ts'])
    const one = fingerprint({ source: 'api', kind: '5xx', name: 'TypeError', message: 'a', stack: STACK })
    const moved = fingerprint({ source: 'api', kind: 'exception', name: 'TypeError', message: 'b', stack: STACK.replace(':1234:56', ':999:1').replace('Иван Петров', 'X') })
    expect(one).toMatch(/^[a-f0-9]{12}$/)
    expect(moved).toBe(one)
    expect(fingerprint({ source: 'api', kind: '5xx', name: 'RangeError', message: 'a', stack: STACK })).not.toBe(one)
  })

  it('groups incidents without a stack by source, kind and name', () => {
    const a = fingerprint({ source: 'guardian', kind: 'crash-loop', name: 'Guardian', message: '4 раза за 30 минут' })
    expect(fingerprint({ source: 'guardian', kind: 'crash-loop', name: 'Guardian', message: '5 раз за 30 минут' })).toBe(a)
    expect(fingerprint({ source: 'guardian', kind: 'backup', name: 'Guardian', message: '' })).not.toBe(a)
  })
})

/** A fake GitHub: open issues by fingerprint, created issues and comments; `offline` makes every call fail. */
function fakeGitHub() {
  const issues: Array<{ number: number; title: string; body: string; labels: string[]; open: boolean }> = []
  const comments: Array<{ issue: number; body: string }> = []
  let offline = false
  const client: IssueClient = {
    async openIssues() {
      if (offline) throw new Error('fetch failed')
      const map = new Map<string, number>()
      for (const issue of issues) {
        const fp = /fingerprint:([a-f0-9]{12})/.exec(issue.body)?.[1]
        if (issue.open && issue.labels.includes('auto-report') && fp) map.set(fp, issue.number)
      }
      return map
    },
    async create(title, body, labels) {
      if (offline) throw new Error('fetch failed')
      issues.push({ number: issues.length + 1, title, body, labels, open: true })
      return issues.length
    },
    async comment(issue, body) {
      if (offline) throw new Error('fetch failed')
      comments.push({ issue, body })
    },
  }
  return { client, issues, comments, setOffline: (value: boolean) => { offline = value } }
}

function memoryStore(initial: QueueData | null = null) {
  let saved = initial
  return { load: () => (saved ? JSON.parse(JSON.stringify(saved)) as QueueData : null), save: (data: QueueData) => { saved = JSON.parse(JSON.stringify(data)) as QueueData }, get: () => saved }
}

const build = () => ({ version: '0.5.5', build: 2000, commit: 'abc1234' })
const event = (name = 'TypeError', stack = STACK) => ({ source: 'api' as const, kind: '5xx', name, message: `boom for owner@example.com from 203.0.113.5`, stack, context: 'GET /v1/me?token=abc' })

describe('ErrorReportQueue (dedupe, rate limits, offline queue)', () => {
  it('opens one issue per fingerprint with labels and the marker, then comments at most once an hour', async () => {
    let clock = Date.parse('2026-10-01T10:00:00Z')
    const github = fakeGitHub()
    const queue = new ErrorReportQueue({ store: memoryStore(), build, now: () => clock })
    queue.record(event())
    queue.record(event())
    expect(await queue.flush(github.client)).toMatchObject({ created: 1, commented: 0, pending: 0 })
    expect(github.issues).toHaveLength(1)
    const issue = github.issues[0]!
    expect(issue.labels).toEqual(REPORT_LABELS)
    expect(issue.body).toContain(MARKER(queue.entries()[0]!.fingerprint))
    expect(issue.title).toMatch(/^\[auto-report\] TypeError: .*\(fp:[a-f0-9]{12}\)$/)
    expect(issue.body).toContain('**повторов:** 2')
    // Nothing personal in what GitHub gets.
    expect(`${issue.title}\n${issue.body}`).not.toMatch(/owner@example\.com|203\.0\.113|token=abc|Иван Петров/)

    queue.record(event())
    clock += 10 * 60_000
    expect(await queue.flush(github.client)).toMatchObject({ created: 0, commented: 0, pending: 1 })
    clock += 51 * 60_000
    expect(await queue.flush(github.client)).toMatchObject({ created: 0, commented: 1, pending: 0 })
    expect(github.comments).toEqual([{ issue: 1, body: expect.stringContaining('всего **3** раз') }])
    expect(github.issues).toHaveLength(1)
  })

  it('finds an existing open issue (e.g. made by another install) instead of opening a new one', async () => {
    const github = fakeGitHub()
    const fp = fingerprint(event())
    github.issues.push({ number: 1, title: `[auto-report] x (fp:${fp})`, body: MARKER(fp), labels: ['auto-report', 'server'], open: true })
    const queue = new ErrorReportQueue({ store: memoryStore(), build })
    queue.record(event())
    expect(await queue.flush(github.client)).toMatchObject({ created: 0, commented: 1 })
    expect(github.issues).toHaveLength(1)
  })

  it('opens a new issue when the old one was closed (the bug came back)', async () => {
    let clock = Date.parse('2026-10-01T10:00:00Z')
    const github = fakeGitHub()
    const queue = new ErrorReportQueue({ store: memoryStore(), build, now: () => clock })
    queue.record(event())
    await queue.flush(github.client)
    github.issues[0]!.open = false
    clock += 2 * 60 * 60_000
    queue.record(event())
    expect(await queue.flush(github.client)).toMatchObject({ created: 1 })
    expect(github.issues).toHaveLength(2)
  })

  it('opens at most 5 new issues a day and keeps the rest for tomorrow', async () => {
    let clock = Date.parse('2026-10-01T10:00:00Z')
    const github = fakeGitHub()
    const queue = new ErrorReportQueue({ store: memoryStore(), build, now: () => clock })
    for (let index = 0; index < 7; index += 1) queue.record(event(`Error${index}`, ''))
    expect(await queue.flush(github.client)).toMatchObject({ created: 5, pending: 2, limited: true })
    expect(await queue.flush(github.client)).toMatchObject({ created: 0, pending: 2, limited: true })
    clock += 24 * 60 * 60_000
    expect(await queue.flush(github.client)).toMatchObject({ created: 2, pending: 0, limited: false })
    expect(github.issues).toHaveLength(7)
  })

  it('keeps reports while offline (on disk) and sends them later', async () => {
    const github = fakeGitHub()
    const store = memoryStore()
    const queue = new ErrorReportQueue({ store, build })
    queue.record(event())
    github.setOffline(true)
    expect(await queue.flush(github.client)).toMatchObject({ created: 0, pending: 1, error: 'fetch failed' })
    // The app restarts: a new queue from the same file.
    const restarted = new ErrorReportQueue({ store, build })
    expect(restarted.pending()).toBe(1)
    github.setOffline(false)
    expect(await restarted.flush(github.client)).toMatchObject({ created: 1, pending: 0 })
    expect(JSON.stringify(store.get())).not.toMatch(/owner@example\.com|203\.0\.113/)
  })
})

describe('GitHubIssueClient', () => {
  it('calls the REST API with User-Agent, API version and token; reads fingerprints from open auto-report issues', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body as string | undefined })
      if (url.includes('/issues?')) return new Response(JSON.stringify([{ number: 4, title: 'x (fp:0123456789ab)', body: '' }, { number: 5, title: 'pr', body: MARKER('ba9876543210'), pull_request: {} }, { number: 6, body: MARKER('aaaaaaaaaaaa') }]), { status: 200 })
      if (url.endsWith('/issues') && init.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { labels?: string[] }
        return body.labels ? new Response('{"message":"Validation Failed"}', { status: 422 }) : new Response('{"number":9}', { status: 201 })
      }
      return new Response('{}', { status: 201 })
    }) as unknown as typeof fetch
    const client = new GitHubIssueClient({ repo: 'owner/repo', token: 'github_pat_x', fetch: fake })
    expect([...(await client.openIssues())]).toEqual([['0123456789ab', 4], ['aaaaaaaaaaaa', 6]])
    expect(calls[0]!.url).toBe('https://api.github.com/repos/owner/repo/issues?state=open&labels=auto-report&per_page=100&page=1')
    expect(calls[0]!.headers['user-agent']).toBe('RaidOS-error-reporter')
    expect(calls[0]!.headers.authorization).toBe('Bearer github_pat_x')
    expect(calls[0]!.headers['x-github-api-version']).toBe('2022-11-28')
    // 422 for the labels: created without them.
    expect(await client.create('t', 'b', ['auto-report'])).toBe(9)
    await expect(new GitHubIssueClient({ repo: 'owner/repo', token: 'bad', fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch }).openIssues()).rejects.toThrow(/токен/)
    expect(() => new GitHubIssueClient({ repo: 'https://github.com/x', token: 't' })).toThrow()
  })

  it('issue title and body stay within limits', () => {
    const long = { fingerprint: 'abcdefabcdef', source: 'api' as const, kind: '5xx', name: 'Error', message: 'x'.repeat(500), stack: Array.from({ length: 100 }, (_, i) => `    at f${i} (a.js:1:1)`).join('\n'), firstSeen: '', lastSeen: '', count: 1, reportedCount: 0, build: build() }
    expect(issueTitle(long).length).toBeLessThan(200)
    expect(issueBody(long).split('\n').filter((line) => line.includes(' at f')).length).toBe(40)
  })
})
