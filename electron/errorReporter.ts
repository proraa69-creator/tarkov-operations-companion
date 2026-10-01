import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { DEFAULT_REPORT_REPO, ErrorReportQueue, GitHubIssueClient, type BuildRef, type ErrorEvent, type QueueData } from './errorReport.js'

/**
 * «Отчёты об ошибках (GitHub)» on the server laptop (owner build): errors of the API (unhandled exceptions, 5xx with
 * the stack), «Страж сервера» incidents (crash loop, restarts, database check, backup), watchdog give-ups and
 * self-update rollbacks become issues in the owner's repository (default proraa69-creator/tarkov-operations-companion),
 * so they can be fixed. Everything is sanitized first (electron/errorReport.ts).
 *
 * Token: a fine-grained GitHub token for that one repository with only «Issues: Read and write». It is encrypted with
 * safeStorage (DPAPI), never shown again, never sent to the renderer, the website or the API process. Settings exist
 * only in this app (not on the website). Off by default.
 */
export interface ErrorReportSettings {
  enabled: boolean
  repo: string
  hasToken: boolean
  /** Errors waiting to be sent (offline, or over the daily limit). */
  pending: number
  lastResult?: { at: string; ok: boolean; text: string }
}

interface Saved { enabled?: boolean; repo?: string }
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const TOKEN = /^github_pat_[A-Za-z0-9_]{20,255}$/
const FLUSH_AFTER_MS = 30_000
const FLUSH_EVERY_MS = 10 * 60_000

const settingsFile = () => join(app.getPath('userData'), 'error-reports.json')
const tokenFile = () => join(app.getPath('userData'), 'error-reports-token.bin')
const queueFile = () => join(app.getPath('userData'), 'error-reports-queue.json')

let build: BuildRef = { version: app.getVersion(), build: 0, commit: '' }
let queue: ErrorReportQueue | null = null
let flushTimer: NodeJS.Timeout | null = null
let interval: NodeJS.Timeout | null = null
let lastResult: ErrorReportSettings['lastResult']

function readSaved(): Saved {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as Saved } catch { return {} }
}

function theQueue() {
  queue ??= new ErrorReportQueue({
    build: () => build,
    store: {
      load: () => { try { return JSON.parse(readFileSync(queueFile(), 'utf8')) as QueueData } catch { return null } },
      save: (data) => { mkdirSync(dirname(queueFile()), { recursive: true }); writeFileSync(queueFile(), JSON.stringify(data)) },
    },
  })
  return queue
}

async function token() {
  try { return safeStorage.decryptString(await readFile(tokenFile())) } catch { return '' }
}

async function client() {
  const saved = readSaved()
  const secret = await token()
  if (saved.enabled !== true || !secret) return null
  return new GitHubIssueClient({ repo: saved.repo || DEFAULT_REPORT_REPO, token: secret })
}

export async function errorReportSettings(): Promise<ErrorReportSettings> {
  const saved = readSaved()
  return { enabled: saved.enabled === true, repo: saved.repo || DEFAULT_REPORT_REPO, hasToken: existsSync(tokenFile()), pending: theQueue().pending(), ...(lastResult ? { lastResult } : {}) }
}

export async function setErrorReportSettings(raw: unknown) {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const saved = readSaved()
  const next: Saved = { ...saved }
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled
  if (typeof input.repo === 'string') {
    const repo = input.repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
    if (!REPO.test(repo)) throw new Error('Репозиторий укажите как владелец/имя, например proraa69-creator/tarkov-operations-companion')
    next.repo = repo
  }
  if (input.clearToken === true) await rm(tokenFile(), { force: true })
  else if (typeof input.token === 'string' && input.token.trim()) {
    const value = input.token.trim()
    if (!TOKEN.test(value)) throw new Error('Нужен fine-grained токен GitHub: он начинается с github_pat_ (Settings → Developer settings → Fine-grained tokens)')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать токен на этом компьютере')
    await writeFile(tokenFile(), safeStorage.encryptString(value))
  }
  if (next.enabled && !existsSync(tokenFile())) throw new Error('Сначала вставьте токен GitHub')
  await writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  if (next.enabled) scheduleFlush(1000)
  return errorReportSettings()
}

/** «Проверить»: reads the issues and creates + closes one test issue. */
export async function testErrorReports() {
  const saved = readSaved()
  const secret = await token()
  if (!secret) throw new Error('Сначала вставьте токен GitHub')
  const repo = saved.repo || DEFAULT_REPORT_REPO
  try {
    const issue = await new GitHubIssueClient({ repo, token: secret }).testAccess()
    lastResult = { at: new Date().toISOString(), ok: true, text: `Доступ есть: создана и закрыта тестовая задача #${issue} в ${repo}` }
  } catch (error) {
    lastResult = { at: new Date().toISOString(), ok: false, text: error instanceof Error ? error.message : String(error) }
  }
  return errorReportSettings()
}

async function flush() {
  flushTimer = null
  const github = await client()
  if (!github) return
  const result = await theQueue().flush(github)
  if (result.created || result.commented || result.error || result.limited) {
    const parts = [result.created ? `новых задач: ${result.created}` : '', result.commented ? `обновлено: ${result.commented}` : '', result.limited ? 'дневной лимит 5 новых задач исчерпан' : '', result.error ? `ошибка: ${result.error}` : '']
    lastResult = { at: new Date().toISOString(), ok: !result.error, text: parts.filter(Boolean).join(' · ') }
  }
}

function scheduleFlush(delay = FLUSH_AFTER_MS) {
  if (flushTimer) return
  flushTimer = setTimeout(() => void flush().catch(() => {}), delay)
  flushTimer.unref?.()
}

/** One error from the API, the guardian, the watchdog or the self-update. Ignored while the reporter is off. */
export function reportError(event: ErrorEvent) {
  try {
    if (readSaved().enabled !== true) return
    theQueue().record(event)
    scheduleFlush()
  } catch { /* reporting never breaks the server */ }
}

/** Owner build on the server laptop: the build that is reported, and a flush every 10 minutes (offline queue). */
export function startErrorReporter(running: BuildRef) {
  build = running
  if (interval) return
  interval = setInterval(() => { if (theQueue().pending()) scheduleFlush(0) }, FLUSH_EVERY_MS)
  interval.unref?.()
  scheduleFlush(60_000)
}

/** An API event (server/src/services/ownerApp.ts reportErrorToOwnerApp). */
export function reportApiError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return
  const value = payload as Record<string, unknown>
  const text = (key: string, max: number) => (typeof value[key] === 'string' ? (value[key] as string).slice(0, max) : '')
  const kind = ['exception', 'rejection', '5xx'].includes(text('kind', 20)) ? text('kind', 20) : 'exception'
  const context = [text('method', 10), text('path', 200), typeof value.status === 'number' ? `→ ${value.status}` : ''].filter(Boolean).join(' ')
  reportError({ source: 'api', kind, name: text('name', 120) || 'Error', message: text('message', 2000), stack: text('stack', 8000), ...(context ? { context } : {}) })
}
