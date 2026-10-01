/**
 * «Страж сервера», part 2: the API's own health (docs/server-guard.md), read by the owner app's watchdog
 * (electron/serverGuardian.ts) through GET /health/detail and shown in the admin panel («Безопасность»):
 * - requests and 5xx answers per minute (24 hours in memory: the numbers start again with every restart);
 * - event-loop lag (perf_hooks histogram, 30-second windows) and memory;
 * - `PRAGMA quick_check` of the database once an hour, its size (with the WAL file);
 * - unhandled exceptions / rejections (logged with the stack to api.log by installProcessGuards, counted here).
 */
import { statSync } from 'node:fs'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'
import type { DatabaseSync } from 'node:sqlite'
import { databaseFile } from './serverBackups.js'
import { reportErrorToOwnerApp } from './ownerApp.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const KEEP_MINUTES = 24 * 60

export interface QuickCheck { ok: boolean; at: string; result: string; ms: number }
export interface ErrorWindow { requests: number; errors: number; rate: number }
export interface HealthSeriesRow { at: string; requests: number; errors: number }

// --- process-wide: one API process, one event loop -----------------------------------------------------------

interface LoopWindow { meanMs: number; p99Ms: number; maxMs: number; at: number }
let histogram: IntervalHistogram | null = null
const loopWindows: LoopWindow[] = []
const unhandled = { exceptions: [] as number[], rejections: [] as number[], total: 0, last: undefined as { at: number; kind: 'exception' | 'rejection'; message: string } | undefined }

function startLoopMonitor() {
  if (histogram) return
  try {
    histogram = monitorEventLoopDelay({ resolution: 20 })
    histogram.enable()
    const timer = setInterval(() => {
      if (!histogram) return
      const ms = (ns: number) => Math.round(ns / 1e6)
      loopWindows.push({ meanMs: Number.isFinite(histogram.mean) ? ms(histogram.mean) : 0, p99Ms: ms(histogram.percentile(99)), maxMs: ms(histogram.max), at: Date.now() })
      if (loopWindows.length > 10) loopWindows.shift()
      histogram.reset()
    }, 30_000)
    timer.unref()
  } catch { histogram = null }
}

/** Counts an unhandled exception / rejection (the caller logs it with the stack). */
export function noteUnhandled(kind: 'exception' | 'rejection', error: unknown, now = Date.now()) {
  const list = kind === 'exception' ? unhandled.exceptions : unhandled.rejections
  list.push(now)
  if (list.length > 200) list.shift()
  unhandled.total += 1
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  unhandled.last = { at: now, kind, message: message.slice(0, 300) }
}

/** Test hook. */
export function resetUnhandled() {
  unhandled.exceptions.length = 0
  unhandled.rejections.length = 0
  unhandled.total = 0
  unhandled.last = undefined
}

/**
 * process.on('uncaughtException' / 'unhandledRejection'): the stack goes to stderr (api.log in the owner app) and the
 * counter. The process keeps serving: the watchdog restarts it in a controlled way (backup first) when exceptions
 * repeat (electron/serverGuardian.ts), instead of every stray timer error dropping all requests.
 */
export function installProcessGuards(log: (line: string) => void = (line) => console.error(line)) {
  if ((globalThis as { __raidGuards?: boolean }).__raidGuards) return
  ;(globalThis as { __raidGuards?: boolean }).__raidGuards = true
  process.on('uncaughtException', (error) => {
    noteUnhandled('exception', error)
    reportErrorToOwnerApp('exception', error)
    log(`${new Date().toISOString()} [guard] Unhandled exception: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  })
  process.on('unhandledRejection', (reason) => {
    noteUnhandled('rejection', reason)
    reportErrorToOwnerApp('rejection', reason)
    log(`${new Date().toISOString()} [guard] Unhandled promise rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
  })
}

// --- per API instance ------------------------------------------------------------------------------------------

export class ServerHealth {
  private readonly db: DatabaseSync
  private readonly now: () => number
  /** minute index → counts */
  private readonly minutes = new Map<number, { requests: number; errors: number }>()
  private lastCheck: QuickCheck | undefined
  private readonly startedAt: number
  readonly file: string

  constructor(db: DatabaseSync, options: { now?: () => number; quickCheckEveryMs?: number; firstCheckAfterMs?: number } = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.startedAt = this.now()
    this.file = databaseFile(db)
    startLoopMonitor()
    if (options.quickCheckEveryMs !== 0) {
      const first = setTimeout(() => { this.quickCheck() }, options.firstCheckAfterMs ?? 60_000)
      first.unref()
      const every = setInterval(() => { this.quickCheck() }, options.quickCheckEveryMs ?? HOUR)
      every.unref()
    }
  }

  /** Every answer (finish): counts requests and 5xx. */
  record(status: number) {
    const minute = Math.floor(this.now() / MINUTE)
    let bucket = this.minutes.get(minute)
    if (!bucket) {
      bucket = { requests: 0, errors: 0 }
      this.minutes.set(minute, bucket)
      if (this.minutes.size > KEEP_MINUTES + 5) for (const key of this.minutes.keys()) { if (key < minute - KEEP_MINUTES) this.minutes.delete(key); else break }
    }
    bucket.requests += 1
    if (status >= 500) bucket.errors += 1
  }

  /** Requests and 5xx within the last `minutes` minutes (the current minute included). */
  errors(minutes: number): ErrorWindow {
    const current = Math.floor(this.now() / MINUTE)
    let requests = 0
    let errors = 0
    for (let minute = current - minutes + 1; minute <= current; minute += 1) {
      const bucket = this.minutes.get(minute)
      if (bucket) { requests += bucket.requests; errors += bucket.errors }
    }
    return { requests, errors, rate: requests ? Math.round((errors / requests) * 1000) / 1000 : 0 }
  }

  /** `count` rows of `stepMinutes` minutes each (oldest first) — the error graph. */
  series(stepMinutes = 60, count = 24): HealthSeriesRow[] {
    const current = Math.floor(this.now() / MINUTE)
    const end = current - (current % stepMinutes) + stepMinutes
    const rows: HealthSeriesRow[] = []
    for (let index = count - 1; index >= 0; index -= 1) {
      const from = end - (index + 1) * stepMinutes
      let requests = 0
      let errors = 0
      for (let minute = from; minute < from + stepMinutes; minute += 1) {
        const bucket = this.minutes.get(minute)
        if (bucket) { requests += bucket.requests; errors += bucket.errors }
      }
      rows.push({ at: new Date(from * MINUTE).toISOString(), requests, errors })
    }
    return rows
  }

  /** PRAGMA quick_check (fast integrity check of the database file). */
  quickCheck(): QuickCheck {
    const started = Date.now()
    let result: string
    try {
      const rows = this.db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>
      result = rows.map((row) => String(Object.values(row)[0])).slice(0, 5).join('; ') || 'нет ответа'
    } catch (error) {
      result = error instanceof Error ? error.message : String(error)
    }
    this.lastCheck = { ok: result === 'ok', at: new Date(this.now()).toISOString(), result: result.slice(0, 500), ms: Date.now() - started }
    if (!this.lastCheck.ok) console.error(`${this.lastCheck.at} [guard] Database quick_check failed: ${this.lastCheck.result}`)
    return this.lastCheck
  }

  get lastQuickCheck() { return this.lastCheck }

  databaseSize() {
    if (!this.file) return { bytes: 0, walBytes: 0 }
    const size = (path: string) => { try { return statSync(path).size } catch { return 0 } }
    return { bytes: size(this.file), walBytes: size(`${this.file}-wal`) }
  }

  /** What the watchdog and the admin panel read. `local`: this PC only (paths included). */
  detail(local = false) {
    const now = this.now()
    const memory = process.memoryUsage()
    const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)
    const recent = loopWindows.slice(-4)
    const lag = recent.length ? { meanMs: recent[recent.length - 1]!.meanMs, p99Ms: Math.max(...recent.map((item) => item.p99Ms)), maxMs: Math.max(...recent.map((item) => item.maxMs)) } : { meanMs: 0, p99Ms: 0, maxMs: 0 }
    const since = (list: number[], ms: number) => list.filter((at) => at > now - ms).length
    return {
      uptimeSec: Math.round((now - this.startedAt) / 1000),
      requests: { last5m: this.errors(5), last15m: this.errors(15), last60m: this.errors(60), last24h: this.errors(24 * 60) },
      eventLoop: lag,
      memory: { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal) },
      unhandled: {
        total: unhandled.total, exceptions5m: since(unhandled.exceptions, 5 * MINUTE), rejections5m: since(unhandled.rejections, 5 * MINUTE),
        exceptions60m: since(unhandled.exceptions, HOUR), rejections60m: since(unhandled.rejections, HOUR),
        ...(unhandled.last ? { last: { at: new Date(unhandled.last.at).toISOString(), kind: unhandled.last.kind, message: unhandled.last.message } } : {}),
      },
      database: { ...this.databaseSize(), ...(local && this.file ? { file: this.file } : {}), ...(this.lastCheck ? { quickCheck: this.lastCheck } : {}) },
    }
  }
}
