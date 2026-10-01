/**
 * «Страж сервера» in the owner app (docs/server-guard.md): reads the API's GET /health/detail
 * (server/src/routes/serverGuard.ts) on every watchdog round and decides — pure, without Electron imports
 * (serverGuardian.test.ts):
 * - restart the API on a high 5xx rate, repeated unhandled exceptions, an event-loop stall or memory growth — with a
 *   backup first, at most once per 15 minutes and 3 times per 6 hours (then the owner is told; no restart loop);
 * - a crash loop (the API process keeps exiting) is reported to the owner;
 * - a daily SQLite backup (and a retry every hour when it fails); a failure is reported;
 * - a failed `PRAGMA quick_check` turns the database lamp red and tells the owner how to restore a backup — the app
 *   never restores anything by itself;
 * - the «Безопасность» lamp (green / amber / red) and one summary notification per attack, not per request;
 * - one summary line per day in the watchdog journal.
 * Notifications are rate-limited per kind.
 */
import type { ProbeResult, ServiceId } from './serverWatchdog.js'

export interface GuardDetail {
  uptimeSec?: number
  requests?: { last5m?: Window; last15m?: Window; last60m?: Window; last24h?: Window }
  eventLoop?: { meanMs?: number; p99Ms?: number; maxMs?: number }
  memory?: { rssMb?: number; heapUsedMb?: number }
  unhandled?: { total?: number; exceptions5m?: number; rejections5m?: number; exceptions60m?: number; rejections60m?: number }
  database?: { bytes?: number; walBytes?: number; file?: string; quickCheck?: { ok: boolean; at: string; result: string } }
  backups?: { enabled?: boolean; dir?: string; lastAt?: string; lastFile?: string; count?: number; lastError?: string }
  security?: { activeBans?: number; bans1h?: number; bans24h?: number; events1h?: number; events24h?: number; credentialStuffing1h?: number; lastBanAt?: string; byReason24h?: Record<string, number> }
}
interface Window { requests: number; errors: number; rate: number }

export interface GuardianAlert { service: ServiceId; kind: 'attack' | 'errors' | 'backup' | 'database' | 'crash-loop' | 'restarts-paused'; title: string; body: string; at: number }

export interface GuardVerdict {
  /** No answer from /health/detail (an older server, or the API is down). */
  detail: GuardDetail | null
  /** Restart the API (the backup was already attempted). */
  restart?: string
  security: ProbeResult
  /** Overrides the database lamp (quick_check failed). */
  database?: ProbeResult
}

export const GUARD_THRESHOLDS = {
  /** 5xx within 5 minutes that restart the API: at least this many AND at least this share of all answers. */
  restartErrors: 20,
  restartErrorRate: 0.5,
  /** 5xx within 15 minutes that tell the owner (no restart). */
  spikeErrors: 10,
  spikeErrorRate: 0.2,
  /** Unhandled exceptions within 5 minutes that restart the API. */
  restartExceptions: 3,
  /** Event-loop p99 (ms) in this many rounds in a row = stalled. */
  stallLagMs: 1000,
  stallRounds: 3,
  /** Memory (RSS, MB) that restarts the API; growth to `growthFactor` × the first sample above `growthMinMb` too. */
  memoryLimitMb: 1536,
  growthFactor: 3,
  growthMinMb: 768,
  restartCooldownMs: 15 * 60_000,
  restartsPerWindow: 3,
  restartWindowMs: 6 * 60 * 60_000,
  /** API (re)starts within this window = crash loop. */
  crashLoopRestarts: 4,
  crashLoopWindowMs: 30 * 60_000,
  backupEveryMs: 24 * 60 * 60_000,
  backupRetryMs: 60 * 60_000,
  /** Red «Безопасность» lamp: bans within the last hour. */
  attackBans1h: 3,
}

const COOLDOWN_MS: Record<GuardianAlert['kind'], number> = {
  attack: 30 * 60_000, errors: 30 * 60_000, backup: 6 * 60 * 60_000, database: 6 * 60 * 60_000, 'crash-loop': 60 * 60_000, 'restarts-paused': 6 * 60 * 60_000,
}

export const REASON_LABEL: Record<string, string> = {
  scanner: 'сканирование уязвимостей', traversal: 'обход путей (../)', injection: 'попытки SQL/скрипт-инъекций', 'not-found': 'перебор адресов (404)',
  'auth-fail': 'много отказов в доступе (401/403)', 'rate-limited': 'превышение лимитов (429)', 'login-fail': 'неудачные входы',
  'credential-stuffing': 'подбор паролей по многим e-mail', 'webhook-signature': 'поддельные уведомления об оплате', oversized: 'слишком большие запросы',
}

export interface GuardianOptions {
  fetchDetail: () => Promise<GuardDetail | null>
  backup: (kind: 'daily' | 'before-restart') => Promise<{ ok: true; name: string } | { ok: false; error: string }>
  alert: (alert: GuardianAlert) => void
  /** A line in the watchdog journal. */
  note: (service: ServiceId, level: 'info' | 'warn' | 'error', text: string) => void
  now?: () => number
  /** Local calendar day of a time (the daily summary); tests pass UTC. */
  day?: (at: number) => string
  /** Where the backups are, for the restore instructions (the detail's own dir is preferred). */
  backupsDir?: string
  thresholds?: Partial<typeof GUARD_THRESHOLDS>
}

const fmtTime = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ещё не было')
const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`

export class ServerGuardian {
  private readonly opts: GuardianOptions
  private readonly limits: typeof GUARD_THRESHOLDS
  private readonly now: () => number
  private pending: Promise<GuardVerdict> | null = null
  private cached: { at: number; verdict: GuardVerdict } | null = null
  private lastNotice = new Map<GuardianAlert['kind'], number>()
  private healthRestarts: number[] = []
  private apiStarts: number[] = []
  private stallRounds = 0
  private baselineRss: number | undefined
  private lastUptime = Infinity
  private lastBanAt: string | undefined
  private baselineReady = false
  private lastBackupAttempt = -Infinity
  private summaryDay: string | undefined
  private restartsPausedUntil = 0
  private lastQuickCheckAt: string | undefined

  constructor(options: GuardianOptions) {
    this.opts = options
    this.limits = { ...GUARD_THRESHOLDS, ...options.thresholds }
    this.now = options.now ?? Date.now
  }

  /** One verdict per watchdog round: the API, database and security probes share it (5 s). */
  inspect(): Promise<GuardVerdict> {
    if (this.cached && this.now() - this.cached.at < 5000) return Promise.resolve(this.cached.verdict)
    this.pending ??= this.run().then((verdict) => { this.cached = { at: this.now(), verdict }; return verdict }).finally(() => { this.pending = null })
    return this.pending
  }

  /** The API process was (re)started by the watchdog: counts towards the crash-loop alarm. */
  noteApiRestart() {
    const now = this.now()
    this.cached = null
    this.apiStarts = this.apiStarts.filter((at) => at > now - this.limits.crashLoopWindowMs)
    this.apiStarts.push(now)
    if (this.apiStarts.length >= this.limits.crashLoopRestarts) {
      this.notify({ service: 'api', kind: 'crash-loop', title: 'Сервер падает снова и снова', body: `За 30 минут сервер (API) перезапускался ${this.apiStarts.length} раз. Откройте журнал api.log (Профиль → «Сервер и сайт на этом компьютере» → папка журналов) — там причина с подробностями. Если ошибка повторяется, перезапустите приложение.` })
    }
  }

  private async run(): Promise<GuardVerdict> {
    const detail = await this.opts.fetchDetail().catch(() => null)
    if (!detail) return { detail: null, security: { kind: 'unknown', text: 'нет данных (сервер не отвечает)' } }
    const now = this.now()
    if (typeof detail.uptimeSec === 'number') {
      // A new API process: start the per-process baselines again.
      if (detail.uptimeSec < this.lastUptime) { this.baselineRss = undefined; this.stallRounds = 0 }
      this.lastUptime = detail.uptimeSec
    }
    const verdict: GuardVerdict = { detail, security: this.securityLamp(detail) }
    this.watchAttacks(detail)
    const database = this.checkDatabase(detail)
    if (database) verdict.database = database
    this.watchErrors(detail)
    await this.dailyBackup(detail, now)
    this.dailySummary(detail, now)
    const reason = this.restartReason(detail)
    if (reason) verdict.restart = await this.planRestart(reason, now)
    return verdict
  }

  // --- the API's own health -----------------------------------------------------------------------------------

  /** Why the API should be restarted now (before the rate limit), or undefined. */
  restartReason(detail: GuardDetail): string | undefined {
    const limits = this.limits
    const recent = detail.requests?.last5m
    if (recent && recent.errors >= limits.restartErrors && recent.rate >= limits.restartErrorRate) {
      return `Много ошибок сервера: ${recent.errors} ответов 5xx из ${recent.requests} за 5 минут (${percent(recent.rate)}).`
    }
    const exceptions = detail.unhandled?.exceptions5m ?? 0
    if (exceptions >= limits.restartExceptions) return `Необработанные ошибки в сервере: ${exceptions} за 5 минут (подробности в api.log).`
    const lag = detail.eventLoop?.p99Ms ?? 0
    this.stallRounds = lag >= limits.stallLagMs ? this.stallRounds + 1 : 0
    if (this.stallRounds >= limits.stallRounds) return `Сервер «подвисает»: задержка обработки ${lag} мс несколько проверок подряд.`
    const rss = detail.memory?.rssMb
    if (typeof rss === 'number') {
      this.baselineRss ??= rss
      if (rss >= limits.memoryLimitMb) return `Сервер занимает слишком много памяти: ${rss} МБ.`
      if (rss >= limits.growthMinMb && rss >= this.baselineRss * limits.growthFactor) return `Память сервера постоянно растёт: ${this.baselineRss} → ${rss} МБ.`
    }
    return undefined
  }

  /** Rate limit and backup before a restart-for-error. Returns the reason when the restart goes ahead. */
  private async planRestart(reason: string, now: number) {
    const limits = this.limits
    this.healthRestarts = this.healthRestarts.filter((at) => at > now - limits.restartWindowMs)
    const last = this.healthRestarts[this.healthRestarts.length - 1] ?? -Infinity
    if (now - last < limits.restartCooldownMs) return undefined
    if (this.healthRestarts.length >= limits.restartsPerWindow || now < this.restartsPausedUntil) {
      if (now >= this.restartsPausedUntil) {
        this.restartsPausedUntil = now + limits.restartWindowMs
        this.opts.note('api', 'error', `Страж: автоматические перезапуски приостановлены (${this.healthRestarts.length} за 6 часов). ${reason}`)
        this.notify({ service: 'api', kind: 'restarts-paused', title: 'Сервер: нужна ваша помощь', body: `${reason} Сервер уже перезапускался ${this.healthRestarts.length} раза за 6 часов — автоматические перезапуски приостановлены, чтобы не зациклиться. Откройте журнал api.log и перезапустите приложение.` })
      }
      return undefined
    }
    this.healthRestarts.push(now)
    const backup = await this.backup('before-restart')
    this.opts.note('api', 'warn', `Страж: перезапуск сервера из-за ошибок. ${reason} ${backup.ok ? `Копия базы перед перезапуском: ${backup.name}.` : `Копию базы перед перезапуском сделать не удалось: ${backup.error}`}`)
    return reason
  }

  private watchErrors(detail: GuardDetail) {
    const window = detail.requests?.last15m
    if (!window || window.errors < this.limits.spikeErrors || window.rate < this.limits.spikeErrorRate) return
    const text = `Всплеск ошибок сервера: ${window.errors} ответов 5xx из ${window.requests} за 15 минут (${percent(window.rate)}).`
    if (this.notify({ service: 'api', kind: 'errors', title: 'Сервер: много ошибок', body: `${text} Подробности в журнале api.log. Если ошибки не прекратятся, сервер будет перезапущен автоматически.` })) this.opts.note('api', 'warn', `Страж: ${text}`)
  }

  // --- database ---------------------------------------------------------------------------------------------------

  private checkDatabase(detail: GuardDetail): ProbeResult | undefined {
    const check = detail.database?.quickCheck
    if (!check || check.ok) return undefined
    const dir = detail.backups?.dir ?? this.opts.backupsDir ?? 'папке server\\backups рядом с базой'
    const error = `Проверка целостности базы (quick_check) не прошла: ${check.result}`
    if (check.at !== this.lastQuickCheckAt) {
      this.lastQuickCheckAt = check.at
      this.opts.note('database', 'error', `Страж: ${error}`)
    }
    this.notify({
      service: 'database', kind: 'database', title: 'База данных: возможно повреждение',
      body: `${error}. Автоматически ничего не восстанавливается. Что сделать: 1) выключите «Сервер и сайт на этом компьютере» в Профиле; 2) сохраните текущий companion.sqlite (и файлы -wal, -shm) в отдельную папку; 3) скопируйте последнюю резервную копию из ${dir} на место companion.sqlite и удалите -wal/-shm; 4) включите сервер снова. Подробно: docs/server-guard.md («Как восстановить копию»). Последняя копия: ${fmtTime(detail.backups?.lastAt)}.`,
    })
    return { kind: 'report', lamp: 'red', text: 'проверка целостности не прошла', error: `${error}. Восстановите резервную копию (docs/server-guard.md).` }
  }

  // --- backups ----------------------------------------------------------------------------------------------------

  private async dailyBackup(detail: GuardDetail, now: number) {
    if (!detail.backups?.enabled) return
    const last = detail.backups.lastAt ? Date.parse(detail.backups.lastAt) : -Infinity
    if (now - last < this.limits.backupEveryMs || now - this.lastBackupAttempt < this.limits.backupRetryMs) return
    this.lastBackupAttempt = now
    const result = await this.backup('daily')
    if (result.ok) {
      this.opts.note('database', 'info', `Страж: ежедневная резервная копия базы — ${result.name}`)
    } else {
      this.opts.note('database', 'error', `Страж: резервная копия не создана — ${result.error}`)
      this.notify({ service: 'database', kind: 'backup', title: 'Резервная копия не создана', body: `Причина: ${result.error}. Приложение попробует снова через час. Проверьте свободное место на диске.` })
    }
  }

  /** The backup through the API; `error` without the API's «Резервная копия не создана:» prefix. */
  private async backup(kind: 'daily' | 'before-restart') {
    let result: Awaited<ReturnType<GuardianOptions['backup']>>
    try { result = await this.opts.backup(kind) } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) } }
    return result.ok ? result : { ok: false as const, error: result.error.replace(/^Резервная копия не создана:\s*/, '') }
  }

  // --- security ---------------------------------------------------------------------------------------------------

  securityLamp(detail: GuardDetail): ProbeResult {
    const security = detail.security
    if (!security) return { kind: 'unknown', text: 'нет данных' }
    const bans1h = security.bans1h ?? 0
    const active = security.activeBans ?? 0
    if (bans1h >= this.limits.attackBans1h || (security.credentialStuffing1h ?? 0) > 0) {
      return { kind: 'report', lamp: 'red', text: `атака: заблокировано адресов за час — ${bans1h}`, error: `Отбивается атака: ${this.reasons(security.byReason24h)}. Сервер блокирует адреса сам; подробности на сайте: Админ-панель → «Безопасность».` }
    }
    if (active > 0 || bans1h > 0 || (security.events1h ?? 0) > 0) {
      return { kind: 'report', lamp: 'amber', text: active > 0 ? `работает, заблокировано адресов — ${active}` : 'работает, были подозрительные запросы' }
    }
    return { kind: 'report', lamp: 'green', text: (security.events24h ?? 0) > 0 ? `спокойно (за сутки подозрительных запросов — ${security.events24h})` : 'спокойно' }
  }

  private watchAttacks(detail: GuardDetail) {
    const security = detail.security
    if (!security) return
    const latest = security.lastBanAt
    if (!this.baselineReady) { this.baselineReady = true; this.lastBanAt = latest; return }
    if (!latest || latest === this.lastBanAt) return
    this.lastBanAt = latest
    const bans = security.bans1h ?? 1
    this.opts.note('security', 'warn', `Страж: заблокирован подозрительный адрес (за час — ${bans}). ${this.reasons(security.byReason24h)}`)
    this.notify({ service: 'security', kind: 'attack', title: 'Сервер отбил подозрительные запросы', body: `Заблокировано адресов за последний час: ${bans}. Причины: ${this.reasons(security.byReason24h)}. Блокировки снимаются сами (15 мин → 1 ч → 24 ч); снять вручную — Админ-панель → «Безопасность».` })
  }

  private reasons(byReason: Record<string, number> | undefined) {
    const top = Object.entries(byReason ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason]) => REASON_LABEL[reason] ?? reason)
    return top.length ? top.join(', ') : 'подозрительные запросы'
  }

  // --- journal ----------------------------------------------------------------------------------------------------

  private dailySummary(detail: GuardDetail, now: number) {
    const day = (this.opts.day ?? ((at: number) => new Date(at).toLocaleDateString('sv-SE')))(now)
    if (this.summaryDay === undefined) { this.summaryDay = day; return }
    if (day === this.summaryDay) return
    this.summaryDay = day
    const requests = detail.requests?.last24h
    const security = detail.security
    const check = detail.database?.quickCheck
    const parts = [
      requests ? `запросов ${requests.requests}, ошибок 5xx ${requests.errors} (${percent(requests.rate)})` : 'запросы: нет данных',
      `заблокировано адресов ${security?.bans24h ?? 0}, подозрительных запросов ${security?.events24h ?? 0}`,
      `память ${detail.memory?.rssMb ?? '?'} МБ`,
      `база ${detail.database?.bytes ? `${Math.round(detail.database.bytes / 1024 / 102.4) / 10} МБ` : '?'}${check ? `, проверка ${check.ok ? 'ok' : 'НЕ ПРОШЛА'}` : ''}`,
      `последняя копия ${fmtTime(detail.backups?.lastAt)}`,
    ]
    this.opts.note('security', 'info', `Сводка за сутки: ${parts.join('; ')}.`)
  }

  /** Rate-limited per kind. True when the owner was told. */
  private notify(alert: Omit<GuardianAlert, 'at'>) {
    const now = this.now()
    const last = this.lastNotice.get(alert.kind) ?? -Infinity
    if (now - last < COOLDOWN_MS[alert.kind]) return false
    this.lastNotice.set(alert.kind, now)
    try { this.opts.alert({ ...alert, at: now }) } catch { /* best effort */ }
    return true
  }
}
