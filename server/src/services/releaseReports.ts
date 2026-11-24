/**
 * A report closes with the release that implements it (owner, 07.11.2026: «Если я взял в работу, и это реализовано в
 * обновлении, вышло обновление, и автоматически тогда заявка, которая в процессе, должна закрываться… и человеку приходит
 * уведомление. Ну, то есть, чтобы не я заходил сюда»).
 *
 * Whoever writes the release lists the reports on the version's row of src/data/updateHistory.json: `"reports":[85]`. Once
 * that version is live, a listed report still «В процессе» (`taken`) gets what the owner's «Готово» does, through the same
 * function (`workReport`, routes/bugReports.ts): closed, its author's window, the audit line, the owner's table moves.
 * Anything else (not taken yet, already closed, no such number) is left alone and nobody is told.
 *
 * «Live» is the `version` of /download/version.json, the signed manifest the players' apps update from and the publisher
 * judges a release by. The server has no other sign of it: TARKOV_APP_VERSION is not set on the VPS, and the history file
 * changes with the code, before the release is out. The publisher restarts this server BEFORE it switches that manifest and
 * can still roll back after it (docs/coordination/ops-reference/auto-release.mjs), so a look at the start alone would see the
 * old version: it looks at the start and every RELEASE_CHECK_MS while something listed waits, believes a version only when
 * it was there at two looks in a row, and stops once nothing waits. A row older than the live version counts too: the
 * publisher takes releases in batches, and a batch's earlier versions are never the live one themselves.
 *
 * Each version and report get one chance (report_release_closes), in the same transaction as the change, so a restart never
 * tells the author twice. And a report the owner reopened and took again after its release stays with him, however
 * many releases later the server starts; listing it again on a newer row gives it a new chance.
 */
import type { DatabaseSync } from 'node:sqlite'
import { workReport, type ReportWorkEffects } from '../routes/bugReports.js'
import type { BugReportStore } from './bugReportStore.js'
import { transaction } from './database.js'
import { compareVersions } from './mobileDownloads.js'

/** Longer than the publisher's checks after the switch (under two minutes), so a version seen twice is one that stayed. */
export const RELEASE_CHECK_MS = 5 * 60 * 1000
/** 0.6.0.272 as the history writes it, 0.6.0-272 as the manifest does. */
const VERSION = /^\d+(?:[.-]\d+)*$/

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS report_release_closes (
    version TEXT NOT NULL,
    report_id INTEGER NOT NULL,
    closed INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (version, report_id));
`

/** What only the API itself holds (app.ts): the same table and the same listeners as the owner's button. */
export interface ReleaseReportsWiring {
  db: DatabaseSync
  store: BugReportStore
  effects: ReportWorkEffects
  now?: () => number
}

export interface ReleaseReportsOptions extends ReleaseReportsWiring {
  /** src/data/updateHistory.json; anything may stand here, whatever cannot be read is skipped. */
  history: unknown
  liveVersion: () => Promise<string | undefined>
  log?: (line: string) => void
}

interface Listed { version: string; report: number }

const message = (error: unknown) => (error instanceof Error ? error.message : 'unknown error').slice(0, 160)

/** Every version and report the history lists. A row that makes no sense is skipped: the Production Gate refuses it first (src/data/updateHistory.test.ts). */
export function listedReports(history: unknown, log: (line: string) => void = () => {}): Listed[] {
  if (!Array.isArray(history)) return []
  const listed: Listed[] = []
  for (const row of history as unknown[]) {
    const { version, reports } = (row ?? {}) as { version?: unknown; reports?: unknown }
    if (reports === undefined) continue
    if (typeof version !== 'string' || !VERSION.test(version) || !Array.isArray(reports)) { log('Release reports: a history row cannot be read, skipped'); continue }
    for (const report of new Set(reports as unknown[])) {
      if (typeof report === 'number' && Number.isSafeInteger(report) && report > 0) listed.push({ version, report })
      else log(`Release ${version}: a listed report is not a number, skipped`)
    }
  }
  return listed
}

export class ReleaseReports {
  private readonly listed: Listed[]
  private readonly log: (line: string) => void
  private lastLive: string | undefined

  constructor(private readonly options: ReleaseReportsOptions) {
    this.log = options.log ?? (() => {})
    options.db.exec(SCHEMA)
    this.listed = listedReports(options.history, this.log)
  }

  private waiting() {
    const had = this.options.db.prepare('SELECT 1 FROM report_release_closes WHERE version = ? AND report_id = ?')
    return this.listed.filter(({ version, report }) => !had.get(version, report))
  }

  private async live() {
    try {
      const version = await this.options.liveVersion()
      return typeof version === 'string' && VERSION.test(version) ? version : undefined
    } catch (error) {
      this.log(`Release reports: the live version cannot be read: ${message(error)}`)
      return undefined
    }
  }

  /** One version and report: its one chance, all in one transaction. */
  private close({ version, report }: Listed) {
    const { db, store, effects, now } = this.options
    try {
      const inWork = transaction(db, () => {
        const taken = store.get(report)?.work.status === 'taken'
        db.prepare('INSERT OR IGNORE INTO report_release_closes (version, report_id, closed, at) VALUES (?, ?, ?, ?)').run(version, report, taken ? 1 : 0, (now ?? Date.now)())
        if (taken) workReport(store, effects, `Выпуск ${version}`, report, 'implemented')
        return taken
      })
      this.log(inWork ? `Release ${version} is live: report №${report} closed` : `Release ${version} is live: report №${report} is not in work, left alone`)
    } catch (error) {
      this.log(`Release ${version}: report №${report} failed, tried again at the next look: ${message(error)}`)
    }
  }

  /** One look. Returns how many listed reports still wait for their version: nothing to look for at 0. */
  async check() {
    const waiting = this.waiting()
    if (!waiting.length) return 0
    const live = await this.live()
    const previous = this.lastLive
    this.lastLive = live
    if (!live || !previous) return waiting.length
    const sure = compareVersions(live, previous) < 0 ? live : previous
    for (const item of waiting) if (compareVersions(sure, item.version) >= 0) this.close(item)
    return this.waiting().length
  }
}

/** The version /download/version.json of this site says; undefined when it says none. */
export async function fetchLiveVersion(site: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${site.replace(/\/+$/, '')}/download/version.json`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`version.json HTTP ${response.status}`)
  const version = ((await response.json()) as { version?: unknown } | null)?.version
  return typeof version === 'string' ? version : undefined
}

/** At the server's start: one look now, then every `everyMs` while something waits. Nothing here can stop the server from starting. Returns how to stop it. */
export function startReleaseReports(options: ReleaseReportsOptions & { everyMs?: number }) {
  const failed = (error: unknown) => options.log?.(`Release reports failed: ${message(error)}`)
  let timer: NodeJS.Timeout | undefined
  const stop = () => { clearInterval(timer) }
  try {
    const job = new ReleaseReports(options)
    const look = () => { job.check().then((left) => { if (!left) stop() }).catch(failed) }
    look()
    timer = setInterval(look, options.everyMs ?? RELEASE_CHECK_MS)
    timer.unref()
  } catch (error) { failed(error) }
  return stop
}
