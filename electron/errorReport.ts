import { createHash } from 'node:crypto'

/**
 * «Отчёты об ошибках (GitHub)» without Electron (tested in errorReport.test.ts): the server laptop's errors become
 * GitHub issues in the owner's repository so they can be fixed (electron/errorReporter.ts wires it to the app).
 *
 * - sanitize(): IP addresses, e-mails, tokens and keys (re_…, live_…, test_…, github_pat_…, eyJ… JWTs, «Bearer …», long
 *   hex / base64 secrets), query strings and user folders (→ %USERPROFILE%) are removed before anything is stored or sent;
 * - fingerprint(): error name + the top frames of the app's own code (no line numbers), so one bug is one issue;
 * - ErrorReportQueue: kept on disk (offline: sent later), one issue per fingerprint — an open issue labelled
 *   `auto-report` with the fingerprint marker is updated with a comment at most once an hour instead of a new issue;
 *   at most 5 new issues a day;
 * - GitHubIssueClient: GitHub REST through fetch (User-Agent, API version, timeouts), Issues read/write only.
 */

export interface BuildRef { version: string; build: number; commit: string }
export type ReportSource = 'api' | 'guardian' | 'watchdog' | 'update'
export interface ErrorEvent {
  source: ReportSource
  /** exception | rejection | 5xx | crash-loop | restarts-paused | database | backup | restart | gave-up | rollback … */
  kind: string
  name: string
  message: string
  stack?: string
  /** «GET /v1/me/summary», a service id … (sanitized too). */
  context?: string
}
export interface ReportEntry {
  fingerprint: string
  source: ReportSource
  kind: string
  name: string
  message: string
  stack: string
  context?: string
  firstSeen: string
  lastSeen: string
  count: number
  /** `count` when GitHub last heard of it. */
  reportedCount: number
  issue?: number
  lastCommentAt?: string
  build: BuildRef
}
export interface QueueData { version: 1; entries: ReportEntry[]; created: { day: string; count: number } }
export interface QueueStore { load(): QueueData | null; save(data: QueueData): void }

export const REPORT_LIMITS = { newIssuesPerDay: 5, commentEveryMs: 60 * 60_000, maxEntries: 200, keepReportedMs: 30 * 24 * 60 * 60_000 }
export const REPORT_LABELS = ['auto-report', 'server']
export const DEFAULT_REPORT_REPO = 'proraa69-creator/tarkov-operations-companion'

// --- sanitizing -------------------------------------------------------------------------------------------------------

const IPV4 = /(?<![\w.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\w.])/g
/** Full 8-group form, or any form with «::» (line:column pairs in stack frames never have it). */
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){0,6}:(?::?[0-9a-f]{1,4}){0,6}(?::\d{1,3}(?:\.\d{1,3}){3})?)(?![\w:])/gi
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{6,}/gi
const JWT = /\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*){0,2}/g
const PREFIXED_KEY = /\b(?:re|live|test|sk|pk|rk|whsec|ghp|gho|ghu|ghs|ghr|github_pat|xox[abprs])_[A-Za-z0-9_-]{6,}/g
const LONG_HEX = /\b[a-f0-9]{32,}\b/gi
const LONG_SECRET = /(?<![\w/.-])[A-Za-z0-9_+/-]{40,}={0,2}(?![\w/.-])/g
const SECRET_FIELD = /\b(password|passwd|secret|api[_-]?key|token|authorization|cookie)(["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b|<)[^\s"',;}]+/gi
/** A query string after something that looks like a path or URL. */
const QUERY = /([\w/.%-])\?[^\s"'<>)\]]+/g
const WINDOWS_PROFILE = /[A-Za-z]:(?:\\{1,2}|\/)(?:Users|Documents and Settings)(?:\\{1,2}|\/)[^\\/:*?"<>|\r\n]+/gi
const UNIX_PROFILE = /(?<![\w.-])\/(?:home|Users)\/[^/\s:"')]+/g

/** Removes personal data and secrets; safe to call on anything (messages, stacks, contexts). */
export function sanitize(text: string, maxLength = 8000): string {
  return String(text ?? '')
    .replace(WINDOWS_PROFILE, '%USERPROFILE%')
    .replace(UNIX_PROFILE, '%USERPROFILE%')
    .replace(BEARER, '$1 <token>')
    .replace(SECRET_FIELD, '$1$2<hidden>')
    .replace(JWT, '<token>')
    .replace(PREFIXED_KEY, '<token>')
    .replace(EMAIL, '<e-mail>')
    .replace(QUERY, '$1?<query>')
    .replace(IPV4, '<ip>')
    .replace(IPV6, (match) => (match.includes('::') || match.split(':').length >= 8 ? '<ip>' : match))
    .replace(LONG_HEX, '<hex>')
    .replace(LONG_SECRET, '<secret>')
    .slice(0, maxLength)
}

// --- fingerprint ----------------------------------------------------------------------------------------------------

/** «at fn (file:1:2)» → «fn file» for the app's own frames (no node internals, no dependencies, no line numbers). */
export function appFrames(stack: string, limit = 3): string[] {
  const frames: string[] = []
  for (const line of String(stack ?? '').split('\n')) {
    const match = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?\s*$/.exec(line)
    if (!match) continue
    const location = match[2] ?? ''
    if (/^node:|node_modules|^internal\/|<anonymous>|^native$/.test(location)) continue
    const file = location.replace(/\\/g, '/').split('/').pop() ?? location
    frames.push(`${(match[1] ?? '<top>').replace(/^new\s+/, '')} ${file}`)
    if (frames.length >= limit) break
  }
  return frames
}

/** 12 hex characters: the same error from the same place in the code gives the same fingerprint in every build. */
export function fingerprint(event: Pick<ErrorEvent, 'source' | 'kind' | 'name' | 'message' | 'stack'>): string {
  const frames = appFrames(event.stack ?? '')
  // Without frames (watchdog / guardian incidents, errors from dependencies): source, kind and name only — the message
  // carries counts and times that change every time.
  const key = frames.length ? [event.name, ...frames].join('|') : [event.source, event.kind, event.name].join('|')
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

// --- issue text ------------------------------------------------------------------------------------------------------

const SOURCE_LABEL: Record<ReportSource, string> = { api: 'сервер (API)', guardian: 'Страж сервера', watchdog: 'наблюдатель сервисов', update: 'автообновление сервера' }
export const MARKER = (fp: string) => `<!-- raidos-auto-report fingerprint:${fp} -->`
const MARKER_PATTERN = /raidos-auto-report fingerprint:([a-f0-9]{12})/
const TITLE_PATTERN = /\(fp:([a-f0-9]{12})\)/

export function issueTitle(entry: ReportEntry) {
  const text = `${entry.name}: ${entry.message}`.replace(/\s+/g, ' ').trim()
  return `[auto-report] ${text.length > 120 ? `${text.slice(0, 117)}…` : text} (fp:${entry.fingerprint})`
}

export function issueBody(entry: ReportEntry) {
  const stack = entry.stack ? entry.stack.split('\n').slice(0, 40).join('\n') : ''
  return [
    MARKER(entry.fingerprint),
    `**Источник:** ${SOURCE_LABEL[entry.source] ?? entry.source} · ${entry.kind}`,
    `**Сборка:** ${entry.build.version} · build ${entry.build.build} · commit ${entry.build.commit || '—'}`,
    `**Отпечаток:** \`${entry.fingerprint}\``,
    `**Впервые:** ${entry.firstSeen} · **последний раз:** ${entry.lastSeen} · **повторов:** ${entry.count}`,
    entry.context ? `**Контекст:** \`${entry.context.replace(/`/g, "'")}\`` : '',
    '',
    '```text',
    `${entry.name}: ${entry.message}`.replace(/```/g, "'''"),
    stack.replace(/```/g, "'''"),
    '```',
    '',
    '_Отчёт создан автоматически приложением Raid OS на ноутбуке-сервере (docs/laptop-server.md, «Отчёты об ошибках»). IP-адреса, e-mail, токены, ключи, параметры запросов и пути пользователя удалены._',
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n')
}

export function commentBody(entry: ReportEntry) {
  return `Повторилось: всего **${entry.count}** раз (было ${entry.reportedCount}). Последний раз: ${entry.lastSeen}. Сборка ${entry.build.version} · build ${entry.build.build} · commit ${entry.build.commit || '—'}.`
}

// --- GitHub ----------------------------------------------------------------------------------------------------------

export class GitHubError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface IssueClient {
  /** Open issues labelled auto-report: fingerprint → issue number. */
  openIssues(): Promise<Map<string, number>>
  create(title: string, body: string, labels: string[]): Promise<number>
  comment(issue: number, body: string): Promise<void>
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

export class GitHubIssueClient implements IssueClient {
  private readonly fetchImpl: typeof fetch
  constructor(private readonly opts: { repo: string; token: string; fetch?: typeof fetch; timeoutMs?: number }) {
    if (!REPO.test(opts.repo)) throw new Error('Репозиторий укажите как владелец/имя, например proraa69-creator/tarkov-operations-companion')
    this.fetchImpl = opts.fetch ?? fetch
  }

  private async call(method: string, path: string, body?: unknown) {
    const response = await this.fetchImpl(`https://api.github.com/repos/${this.opts.repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.opts.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'RaidOS-error-reporter',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    })
    const data = await response.json().catch(() => null) as Record<string, unknown> | Array<Record<string, unknown>> | null
    if (!response.ok) {
      const hint = response.status === 401 ? 'токен неверный или истёк' : response.status === 403 ? 'у токена нет права Issues: Read and write на этот репозиторий (или исчерпан лимит)' : response.status === 404 ? 'репозиторий не найден или токен выдан не на него' : `HTTP ${response.status}`
      throw new GitHubError(response.status, `GitHub: ${hint}`)
    }
    return data
  }

  async openIssues() {
    const found = new Map<string, number>()
    for (let page = 1; page <= 3; page += 1) {
      const list = await this.call('GET', `/issues?state=open&labels=auto-report&per_page=100&page=${page}`) as Array<Record<string, unknown>> | null
      if (!Array.isArray(list)) break
      for (const issue of list) {
        if (issue.pull_request) continue
        const fp = MARKER_PATTERN.exec(String(issue.body ?? ''))?.[1] ?? TITLE_PATTERN.exec(String(issue.title ?? ''))?.[1]
        if (fp && typeof issue.number === 'number' && !found.has(fp)) found.set(fp, issue.number)
      }
      if (list.length < 100) break
    }
    return found
  }

  async create(title: string, body: string, labels: string[]) {
    let data: Record<string, unknown> | null
    try {
      data = await this.call('POST', '/issues', { title, body, labels }) as Record<string, unknown> | null
    } catch (error) {
      // 422: a label the token may not create — the issue is still worth more than its labels.
      if (!(error instanceof GitHubError) || error.status !== 422) throw error
      data = await this.call('POST', '/issues', { title, body }) as Record<string, unknown> | null
    }
    if (typeof data?.number !== 'number') throw new GitHubError(0, 'GitHub: неожиданный ответ при создании задачи')
    return data.number
  }

  async comment(issue: number, body: string) {
    await this.call('POST', `/issues/${issue}/comments`, { body })
  }

  /** «Проверить»: reads the issues (Issues: read) and creates + closes one test issue (Issues: write). */
  async testAccess() {
    await this.openIssues()
    const number = await this.create('[auto-report] Проверка отчётов об ошибках', 'Тестовая задача из панели «Отчёты об ошибках (GitHub)» приложения Raid OS. Закрыта автоматически.', ['auto-report'])
    await this.call('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'not_planned' })
    return number
  }
}

// --- the queue ---------------------------------------------------------------------------------------------------------

export interface FlushResult { created: number; commented: number; pending: number; limited: boolean; error?: string }

export class ErrorReportQueue {
  private data: QueueData
  private readonly limits: typeof REPORT_LIMITS
  private readonly now: () => number
  private flushing: Promise<FlushResult> | null = null

  constructor(private readonly opts: { store: QueueStore; build: () => BuildRef; now?: () => number; limits?: Partial<typeof REPORT_LIMITS> }) {
    this.now = opts.now ?? Date.now
    this.limits = { ...REPORT_LIMITS, ...opts.limits }
    const loaded = (() => { try { return opts.store.load() } catch { return null } })()
    this.data = loaded && loaded.version === 1 && Array.isArray(loaded.entries) ? loaded : { version: 1, entries: [], created: { day: '', count: 0 } }
  }

  private save() { try { this.opts.store.save(this.data) } catch { /* kept in memory; written next time */ } }
  private iso(at = this.now()) { return new Date(at).toISOString() }

  entries(): ReportEntry[] { return this.data.entries.map((entry) => ({ ...entry })) }
  pending() { return this.data.entries.filter((entry) => entry.count > entry.reportedCount).length }

  /** Stores (sanitized) or counts one occurrence. */
  record(event: ErrorEvent): ReportEntry {
    const clean = { ...event, name: sanitize(event.name, 120) || 'Error', message: sanitize(event.message, 1000), stack: sanitize(event.stack ?? '', 8000), ...(event.context ? { context: sanitize(event.context, 300) } : {}) }
    const fp = fingerprint(clean)
    const at = this.iso()
    let entry = this.data.entries.find((item) => item.fingerprint === fp)
    if (entry) {
      Object.assign(entry, { count: entry.count + 1, lastSeen: at, message: clean.message, build: this.opts.build(), ...(clean.stack ? { stack: clean.stack } : {}), ...(clean.context ? { context: clean.context } : {}) })
    } else {
      entry = { fingerprint: fp, source: clean.source, kind: clean.kind, name: clean.name, message: clean.message, stack: clean.stack, ...(clean.context ? { context: clean.context } : {}), firstSeen: at, lastSeen: at, count: 1, reportedCount: 0, build: this.opts.build() }
      this.data.entries.push(entry)
      this.prune()
    }
    this.save()
    return { ...entry }
  }

  private prune() {
    const now = this.now()
    this.data.entries = this.data.entries.filter((entry) => entry.count > entry.reportedCount || now - Date.parse(entry.lastSeen) < this.limits.keepReportedMs)
    if (this.data.entries.length > this.limits.maxEntries) {
      this.data.entries.sort((a, b) => Date.parse(a.lastSeen) - Date.parse(b.lastSeen))
      this.data.entries = this.data.entries.slice(-this.limits.maxEntries)
    }
  }

  /** Sends what is new; stops at the first network / GitHub error and keeps everything for the next time. */
  flush(client: IssueClient): Promise<FlushResult> {
    this.flushing ??= this.run(client).finally(() => { this.flushing = null })
    return this.flushing
  }

  private async run(client: IssueClient): Promise<FlushResult> {
    const result: FlushResult = { created: 0, commented: 0, pending: 0, limited: false }
    const due = this.data.entries.filter((entry) => entry.count > entry.reportedCount)
    if (!due.length) return result
    try {
      const open = await client.openIssues()
      for (const entry of due) {
        // A closed issue means «fixed»: the error coming back opens a new one.
        entry.issue = open.get(entry.fingerprint)
        const now = this.now()
        if (entry.issue === undefined) {
          const day = this.iso(now).slice(0, 10)
          if (this.data.created.day !== day) this.data.created = { day, count: 0 }
          if (this.data.created.count >= this.limits.newIssuesPerDay) { result.limited = true; continue }
          entry.issue = await client.create(issueTitle(entry), issueBody(entry), REPORT_LABELS)
          this.data.created.count += 1
          entry.reportedCount = entry.count
          entry.lastCommentAt = this.iso(now)
          open.set(entry.fingerprint, entry.issue)
          result.created += 1
        } else {
          if (entry.lastCommentAt && now - Date.parse(entry.lastCommentAt) < this.limits.commentEveryMs) continue
          await client.comment(entry.issue, commentBody(entry))
          entry.reportedCount = entry.count
          entry.lastCommentAt = this.iso(now)
          result.commented += 1
        }
        this.save()
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
    this.save()
    result.pending = this.pending()
    return result
  }
}
