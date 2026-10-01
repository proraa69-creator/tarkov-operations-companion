/**
 * Self-healing watchdog for the owner's «Сервер и сайт на этом компьютере» (the server laptop, --server-mode).
 * Pure state machine without Electron imports (unit-tested with fake timers in serverWatchdog.test.ts); the
 * real probes, restarts and Windows notifications are wired in electron/serverMonitor.ts.
 *
 * Every check (~15 s) each service gets a probe result. A service that is down for `threshold` checks in a row
 * (or whose process exited) opens an incident: one notification, then automatic restarts with backoff
 * 5 s → 15 s → 60 s → every 5 min (never a tight loop). After `giveUpAfter` failed attempts the owner gets one
 * more notification with what to do; when it works again — one recovery notification. A port taken by another
 * program is only reported (foreign processes are never killed).
 */

export type ServiceId = 'api' | 'site' | 'public' | 'database'
export type Lamp = 'green' | 'amber' | 'red' | 'grey'

export type ProbeResult =
  /** Works. */
  | { kind: 'ok'; text?: string }
  /** Switched off on purpose (grey lamp, no alarms). */
  | { kind: 'off'; text?: string }
  /** Nothing to judge by (e.g. the database while the API does not answer). */
  | { kind: 'unknown'; text?: string }
  /** Starting up / getting the link. */
  | { kind: 'starting'; text?: string }
  /** Something looks wrong but may be the internet (amber; becomes `down` when it repeats). */
  /** `advisory`: only a warning (amber), never an incident or a restart — e.g. the self-check through the internet
   *  fails while cloudflared itself is connected to Cloudflare (restarting it would only drop the working link). */
  | { kind: 'warn'; error: string; advisory?: boolean }
  /** Does not work. `dead`: the process exited — no need to wait for more failed checks. */
  | { kind: 'down'; error: string; dead?: boolean }
  /** Cannot be repaired by the app (port taken by another program, server missing from the build). */
  | { kind: 'blocked'; error: string }

export interface ServiceHealth {
  id: ServiceId
  lamp: Lamp
  /** Short status text (Russian; the renderer translates). */
  text: string
  lastError?: string
  /** Last check, ms since epoch. */
  checkedAt?: number
  /** Failed checks in a row. */
  failures: number
  /** Automatic restarts in the current incident. */
  attempts: number
  /** When the next automatic restart is planned. */
  nextRetryAt?: number
}

export interface WatchdogEvent { at: number; service: ServiceId; level: 'info' | 'warn' | 'error'; text: string }
export interface WatchdogSnapshot { enabled: boolean; services: ServiceHealth[]; events: WatchdogEvent[]; worst: Lamp; checkedAt?: number }
/** What the owner is told (Windows notification + in-app toast; an e-mail hook later). */
export interface WatchdogAlert { service: ServiceId; kind: 'down' | 'repaired' | 'recovered' | 'gave-up' | 'blocked'; title: string; body: string; at: number }

export interface ServiceConfig {
  label: string
  probe: () => Promise<ProbeResult>
  /** Automatic repair; absent = report only. */
  restart?: () => Promise<void>
  /** Failed checks in a row before an incident (default 3). */
  threshold?: number
  /** Whether incidents of this service notify the owner (the database is covered by the API's alert). */
  notify?: boolean
  /** What to do when automatic repair failed. */
  advice?: string
}

export interface WatchdogOptions {
  services: Partial<Record<ServiceId, ServiceConfig>>
  /** Whether the local server mode is on; off = every lamp grey, no checks, no alarms. */
  enabled: () => Promise<boolean> | boolean
  alert?: (alert: WatchdogAlert) => void
  /** Every change (lamps, journal) for the renderer. */
  changed?: (snapshot: WatchdogSnapshot) => void
  log?: (line: string) => void
  intervalMs?: number
  /** Restart delays: the n-th attempt waits backoff[n] (the last one repeats). */
  backoffMs?: number[]
  /** Failed automatic restarts before the owner is told it needs a hand. */
  giveUpAfter?: number
  /** After a restart, failures are not judged for this long (the server needs a moment to listen). */
  graceMs?: number
  /** One «down» notification per service within this window, even when it flaps. */
  notifyCooldownMs?: number
  historySize?: number
  now?: () => number
}

export const SERVICE_ORDER: ServiceId[] = ['api', 'site', 'public', 'database']
export const DEFAULT_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000]

interface State extends ServiceHealth {
  incident: boolean
  restarting: boolean
  graceUntil: number
  timer: ReturnType<typeof setTimeout> | null
  notified: boolean
  gaveUp: boolean
  lastDownNotice: number
}

const LAMP_RANK: Record<Lamp, number> = { grey: 0, green: 1, amber: 2, red: 3 }
export function worstLamp(lamps: Lamp[]): Lamp {
  // Grey (switched off) only when nothing else is known.
  return lamps.reduce<Lamp>((worst, lamp) => (LAMP_RANK[lamp] > LAMP_RANK[worst] ? lamp : worst), 'grey')
}

export class ServerWatchdog {
  private readonly states = new Map<ServiceId, State>()
  private readonly events: WatchdogEvent[] = []
  private interval: ReturnType<typeof setInterval> | null = null
  private enabledNow = false
  private lastCheck: number | undefined
  private checking: Promise<void> | null = null
  private readonly opts: Required<Omit<WatchdogOptions, 'alert' | 'changed' | 'log'>> & Pick<WatchdogOptions, 'alert' | 'changed' | 'log'>

  constructor(options: WatchdogOptions) {
    this.opts = {
      intervalMs: 15_000, backoffMs: DEFAULT_BACKOFF_MS, giveUpAfter: 3, graceMs: 10_000, notifyCooldownMs: 10 * 60_000, historySize: 50,
      now: () => Date.now(), ...options,
    }
    for (const id of SERVICE_ORDER) if (options.services[id]) this.states.set(id, this.fresh(id))
  }

  private fresh(id: ServiceId): State {
    return { id, lamp: 'grey', text: 'выключено', failures: 0, attempts: 0, incident: false, restarting: false, graceUntil: 0, timer: null, notified: false, gaveUp: false, lastDownNotice: -Infinity }
  }

  start() {
    if (this.interval) return
    this.interval = setInterval(() => void this.check(), this.opts.intervalMs)
    void this.check()
  }

  stop() {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    for (const state of this.states.values()) this.clearTimer(state)
  }

  snapshot(): WatchdogSnapshot {
    const services = [...this.states.values()].map(({ id, lamp, text, lastError, checkedAt, failures, attempts, nextRetryAt }) => ({
      id, lamp, text, failures, attempts, ...(lastError ? { lastError } : {}), ...(checkedAt ? { checkedAt } : {}), ...(nextRetryAt ? { nextRetryAt } : {}),
    }))
    return { enabled: this.enabledNow, services, events: [...this.events], worst: worstLamp(services.map((service) => service.lamp)), ...(this.lastCheck ? { checkedAt: this.lastCheck } : {}) }
  }

  /** One round of checks (also run by «Проверить» and after a manual restart). Concurrent calls share one round. */
  check(): Promise<void> {
    this.checking ??= this.runCheck().finally(() => { this.checking = null })
    return this.checking
  }

  private async runCheck() {
    const enabled = await Promise.resolve(this.opts.enabled()).catch(() => false)
    if (!enabled) {
      if (this.enabledNow) this.record('api', 'info', 'Сервер и сайт на этом компьютере выключены')
      this.enabledNow = false
      for (const [id, state] of this.states) { this.clearTimer(state); this.states.set(id, this.fresh(id)) }
      this.emitChange()
      return
    }
    if (!this.enabledNow) this.record('api', 'info', 'Наблюдение за сервером включено')
    this.enabledNow = true
    await Promise.all([...this.states.keys()].map((id) => this.checkService(id)))
    this.lastCheck = this.opts.now()
    this.emitChange()
  }

  private async checkService(id: ServiceId) {
    const state = this.states.get(id)!
    const config = this.opts.services[id]!
    if (state.restarting) return
    let result: ProbeResult
    try {
      result = await config.probe()
    } catch (error) {
      result = { kind: 'down', error: error instanceof Error ? error.message : String(error) }
    }
    state.checkedAt = this.opts.now()
    this.apply(id, state, config, result)
  }

  private apply(id: ServiceId, state: State, config: ServiceConfig, result: ProbeResult) {
    const now = this.opts.now()
    switch (result.kind) {
      case 'ok':
        if (state.incident) this.recover(id, state, config)
        Object.assign(state, { lamp: 'green', text: result.text ?? 'работает', failures: 0, lastError: undefined })
        return
      case 'off':
      case 'unknown':
        if (state.incident) { this.record(id, 'info', `${config.label}: ${result.kind === 'off' ? 'выключено' : 'нет данных'}`); this.resetIncident(state) }
        Object.assign(state, { lamp: 'grey', text: result.text ?? (result.kind === 'off' ? 'выключено' : 'нет данных'), failures: 0 })
        return
      case 'starting':
        Object.assign(state, { lamp: 'amber', text: result.text ?? 'запускается…' })
        return
      case 'blocked':
        state.lastError = result.error
        Object.assign(state, { lamp: 'red', text: 'нужна помощь', failures: state.failures + 1 })
        if (!state.incident) {
          state.incident = true
          this.record(id, 'error', `${config.label}: ${result.error}`)
          this.notify(id, state, config, 'blocked', `${config.label}: не работает`, `${result.error}${config.advice ? ` ${config.advice}` : ''}`)
        }
        return
      case 'warn':
        if (result.advisory) {
          state.lastError = result.error
          Object.assign(state, { lamp: 'amber', text: 'работает, но проверка через интернет не проходит', failures: 0 })
          return
        }
      // falls through
      case 'down': {
        state.lastError = result.error
        state.failures += 1
        const threshold = result.kind === 'down' && result.dead ? 1 : config.threshold ?? 3
        if (now < state.graceUntil) { Object.assign(state, { lamp: 'amber', text: 'запускается…' }); return }
        if (state.failures < threshold) {
          Object.assign(state, { lamp: 'amber', text: result.kind === 'warn' ? 'нет ответа, проверяю ещё' : 'не отвечает, проверяю ещё' })
          return
        }
        if (!state.incident) {
          state.incident = true
          this.record(id, 'error', `${config.label}: ${result.error}`)
          this.notify(id, state, config, 'down', `${config.label}: не работает`, `${result.error}${config.restart ? ' Пробую починить автоматически.' : ''}`)
        }
        if (!config.restart) { Object.assign(state, { lamp: 'red', text: 'ошибка' }); return }
        if (state.attempts >= this.opts.giveUpAfter && !state.gaveUp) {
          state.gaveUp = true
          this.record(id, 'error', `${config.label}: не удалось починить после ${state.attempts} попыток`)
          this.notify(id, state, config, 'gave-up', `${config.label}: не удалось починить`, `Автоматический перезапуск не помог (${state.attempts} попытки). ${config.advice ?? 'Перезапустите приложение.'} Приложение будет пробовать дальше раз в 5 минут.`)
        }
        this.schedule(id, state, config)
        Object.assign(state, state.gaveUp ? { lamp: 'red', text: 'ошибка, не удалось починить' } : { lamp: 'amber', text: 'перезапуск…' })
      }
    }
  }

  private schedule(id: ServiceId, state: State, config: ServiceConfig) {
    if (state.timer || state.restarting) return
    const { backoffMs } = this.opts
    const delay = backoffMs[Math.min(state.attempts, backoffMs.length - 1)]
    state.nextRetryAt = this.opts.now() + delay
    state.timer = setTimeout(() => { state.timer = null; void this.restart(id, state, config, false) }, delay)
  }

  /** «Перезапустить сейчас» (manual) or the planned automatic attempt. */
  async restartNow(id: ServiceId) {
    const state = this.states.get(id)
    const config = this.opts.services[id]
    if (!state || !config?.restart) return this.snapshot()
    this.clearTimer(state)
    await this.restart(id, state, config, true)
    return this.snapshot()
  }

  private async restart(id: ServiceId, state: State, config: ServiceConfig, manual: boolean) {
    if (state.restarting || !config.restart) return
    // Switched off meanwhile (Profile → «Сервер и сайт на этом компьютере»): never start anything behind the owner's back.
    if (!(await Promise.resolve(this.opts.enabled()).catch(() => false))) return
    state.restarting = true
    state.nextRetryAt = undefined
    if (!manual) state.attempts += 1
    Object.assign(state, { lamp: 'amber', text: 'перезапуск…' })
    this.record(id, manual ? 'info' : 'warn', manual ? `${config.label}: перезапуск вручную` : `${config.label}: автоматический перезапуск (попытка ${state.attempts})`)
    this.emitChange()
    try {
      await config.restart()
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
      this.record(id, 'error', `${config.label}: перезапуск не удался — ${state.lastError}`)
    } finally {
      state.restarting = false
      state.graceUntil = this.opts.now() + this.opts.graceMs
      // A failed restart is judged by the next checks after the grace period, not right away.
      this.emitChange()
    }
  }

  private recover(id: ServiceId, state: State, config: ServiceConfig) {
    const repaired = state.attempts > 0
    this.record(id, 'info', repaired ? `${config.label}: снова работает после перезапуска` : `${config.label}: снова работает`)
    if (state.notified) {
      if (repaired) this.notify(id, state, config, 'repaired', id === 'api' ? 'Сервер перезапущен автоматически' : `${config.label}: перезапущено автоматически`, `${config.label} снова работает.`, true)
      else this.notify(id, state, config, 'recovered', `${config.label}: снова работает`, 'Всё в порядке.', true)
    }
    this.resetIncident(state)
    state.lastError = undefined
  }

  private resetIncident(state: State) {
    this.clearTimer(state)
    Object.assign(state, { incident: false, attempts: 0, failures: 0, gaveUp: false, notified: false, graceUntil: 0, nextRetryAt: undefined })
  }

  private clearTimer(state: State) {
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    state.nextRetryAt = undefined
  }

  /**
   * Rate limit: «down»/«blocked» once per incident and at most once per cooldown for a flapping service; «gave up»
   * once per incident; the recovery note only when the owner was told about the incident.
   */
  private notify(id: ServiceId, state: State, config: ServiceConfig, kind: WatchdogAlert['kind'], title: string, body: string, closing = false) {
    if (config.notify === false) return
    const now = this.opts.now()
    if (kind === 'down' || kind === 'blocked') {
      if (now - state.lastDownNotice < this.opts.notifyCooldownMs) return
      state.lastDownNotice = now
      state.notified = true
    } else if (!closing && !state.notified) {
      // gave-up after a suppressed «down»: still worth telling once.
      state.notified = true
    }
    try { this.opts.alert?.({ service: id, kind, title, body, at: now }) } catch { /* a failing notifier never stops the watchdog */ }
  }

  private record(service: ServiceId, level: WatchdogEvent['level'], text: string) {
    const event = { at: this.opts.now(), service, level, text }
    this.events.unshift(event)
    this.events.length = Math.min(this.events.length, this.opts.historySize)
    try { this.opts.log?.(`${new Date(event.at).toISOString()} [${level}] ${service}: ${text}`) } catch { /* logging is best effort */ }
  }

  private emitChange() {
    try { this.opts.changed?.(this.snapshot()) } catch { /* the window may be gone */ }
  }
}
