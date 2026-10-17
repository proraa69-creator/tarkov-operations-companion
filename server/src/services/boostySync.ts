/**
 * The automatic Boosty issuance job (owner's decision; docs/payments/payment-regions-and-announcements.md «Automatic
 * issuance»). Only when the server has both BOOSTY_AUTH and BOOSTY_CLIENT_ID (or their aliases): otherwise no job is
 * created and nothing calls Boosty. Every BOOSTY_SYNC_MINUTES (default 5) it lists the blog's subscribers
 * (services/boostyClient.ts) and hands them to BoostyPayments.applySubscribers (services/boosty.ts), which grants or
 * puts into the owner's review list.
 *
 * Polite and safe: one pass at a time, pages one after another with a pause, a timeout per request; after an error the
 * next pass waits twice as long (up to an hour); a dead token waits an hour and the owner's panel says «Токен Boosty
 * истёк — обновите BOOSTY_AUTH». The owner's pause switch stops the passes (kept in the database). Nothing here throws
 * into the server: every error ends as a short, secret-free line (sanitizeBoostyError) in the panel and the log.
 */
import { BOOSTY_TOKEN_DEAD, sanitizeBoostyError, BoostyApiError, type BoostyClient, type BoostyCredentials } from './boostyClient.js'
import type { BoostyPayments, BoostySyncResult } from './boosty.js'

const MAX_BACKOFF_MS = 60 * 60 * 1000

export interface BoostySyncStatus {
  /** BOOSTY_AUTH and BOOSTY_CLIENT_ID are set on the server. */
  configured: boolean
  paused: boolean
  running: boolean
  blog?: string
  periodMinutes?: number
  lastSyncAt?: string
  lastSuccessAt?: string
  /** Sanitised: never a token or a Boosty answer. */
  lastError?: string
  tokenDead: boolean
  nextRunAt?: string
  lastResult?: BoostySyncResult
}

export class BoostySync {
  private running = false
  private failures = 0
  private timer: NodeJS.Timeout | undefined
  private nextRunAt: number | undefined
  private readonly now: () => number

  constructor(private readonly boosty: BoostyPayments, private readonly client: BoostyClient, private readonly options: { periodMs: number; now?: () => number }) {
    this.now = options.now ?? Date.now
  }

  get paused() { return this.boosty.state('paused') === '1' }

  setPaused(paused: boolean) {
    this.boosty.setState('paused', paused ? '1' : undefined)
    if (!paused && this.timer) this.schedule(1000)
  }

  status(): BoostySyncStatus {
    const lastResult = this.boosty.state('lastResult')
    let parsed: BoostySyncResult | undefined
    try { parsed = lastResult ? JSON.parse(lastResult) as BoostySyncResult : undefined } catch { parsed = undefined }
    const iso = (key: string) => { const value = Number(this.boosty.state(key)); return value > 0 ? new Date(value).toISOString() : undefined }
    const lastError = this.boosty.state('lastError')
    const lastSyncAt = iso('lastSyncAt')
    const lastSuccessAt = iso('lastSuccessAt')
    return {
      configured: true,
      paused: this.paused,
      running: this.running,
      blog: this.client.blog,
      periodMinutes: Math.round(this.options.periodMs / 60000),
      ...(lastSyncAt ? { lastSyncAt } : {}),
      ...(lastSuccessAt ? { lastSuccessAt } : {}),
      ...(lastError ? { lastError } : {}),
      tokenDead: this.boosty.state('tokenDead') === '1',
      ...(this.nextRunAt ? { nextRunAt: new Date(this.nextRunAt).toISOString() } : {}),
      ...(parsed ? { lastResult: parsed } : {}),
    }
  }

  /** One pass: list the subscribers, apply them. `force`: the owner's «Проверить сейчас» runs even while paused. */
  async runOnce(force = false): Promise<BoostySyncStatus> {
    if (this.running || (this.paused && !force)) return this.status()
    this.running = true
    this.boosty.setState('lastSyncAt', String(this.now()))
    try {
      const subscribers = await this.client.subscribers()
      const result = this.boosty.applySubscribers(subscribers)
      this.boosty.setState('lastResult', JSON.stringify(result))
      this.boosty.setState('lastSuccessAt', String(this.now()))
      this.boosty.setState('lastError', undefined)
      this.boosty.setState('tokenDead', undefined)
      this.failures = 0
    } catch (error) {
      const dead = error instanceof BoostyApiError && error.tokenDead
      const message = dead ? BOOSTY_TOKEN_DEAD : sanitizeBoostyError(error, this.client.secrets())
      this.boosty.setState('lastError', message)
      this.boosty.setState('tokenDead', dead ? '1' : undefined)
      this.failures += 1
      console.warn(`Boosty sync failed: ${message}`)
    } finally {
      this.running = false
    }
    return this.status()
  }

  /** The delay before the next pass: the period, doubled after each failure (an hour at most; an hour for a dead token). */
  private delay() {
    if (this.boosty.state('tokenDead') === '1') return MAX_BACKOFF_MS
    if (!this.failures) return this.options.periodMs
    return Math.min(MAX_BACKOFF_MS, this.options.periodMs * 2 ** Math.min(this.failures, 6))
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer)
    this.nextRunAt = this.now() + ms
    this.timer = setTimeout(() => {
      this.runOnce().catch(() => undefined).finally(() => this.schedule(this.delay()))
    }, ms)
    this.timer.unref?.()
  }

  /** The owner pasted a new Boosty session: the dead-token state is cleared and a pass runs at once. */
  replaceCredentials(credentials: BoostyCredentials) {
    this.client.replace(credentials)
    this.boosty.setState('tokenDead', undefined)
    this.boosty.setState('lastError', undefined)
    this.failures = 0
    this.schedule(1000)
  }

  /** Starts the passes (the first one shortly after the server starts). */
  start(firstDelayMs = 30_000) { this.schedule(firstDelayMs) }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.nextRunAt = undefined
  }
}

/** The panel's status when the server has no Boosty secrets: manual confirmation only. */
export const BOOSTY_SYNC_OFF: BoostySyncStatus = { configured: false, paused: false, running: false, tokenDead: false }
