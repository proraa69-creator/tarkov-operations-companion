import { normalizePriceHistory, type PricePoint } from '../../../src/data/tarkovJsonAdapters.js'
import type { MirrorStorage } from './mirrorStorage.js'
import type { MirrorMode } from './tarkovDataMirror.js'

const DAY = 24 * 60 * 60 * 1000
const ITEM_ID = /^[a-z0-9]{16,48}$/

interface QueueEntry { mode: MirrorMode; itemId: string; requestedAt: string }
interface HistorySnapshot { mode: MirrorMode; itemId: string; updatedAt: string; points: PricePoint[] }

export interface PriceHistoryStatus {
  state: 'idle' | 'running' | 'done' | 'degraded' | 'error'
  queued: number
  refreshed: number
  failed: number
  startedAt: string | null
  finishedAt: string | null
  error?: string
}

export interface PriceHistoryMirrorOptions {
  storage: MirrorStorage
  fetch?: typeof fetch
  now?: () => Date
  intervalMs?: number
  initialDelayMs?: number
  concurrency?: number
  log?: (message: string) => void
}

export class PriceHistoryMirror {
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private running: Promise<void> | null = null
  private queueWrite = Promise.resolve()
  private initial: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private current: PriceHistoryStatus = { state: 'idle', queued: 0, refreshed: 0, failed: 0, startedAt: null, finishedAt: null }

  constructor(private readonly options: PriceHistoryMirrorOptions) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  status(): PriceHistoryStatus { return { ...this.current } }

  start() {
    if (this.initial || this.timer) return
    const kick = () => { void this.run().catch(() => undefined) }
    this.initial = setTimeout(kick, this.options.initialDelayMs ?? 5 * 60_000)
    this.initial.unref?.()
    this.timer = setInterval(kick, this.options.intervalMs ?? DAY)
    this.timer.unref?.()
  }

  stop() {
    if (this.initial) clearTimeout(this.initial)
    if (this.timer) clearInterval(this.timer)
    this.initial = this.timer = null
  }

  async request(mode: MirrorMode, itemId: string, days = 30) {
    if (!ITEM_ID.test(itemId)) throw new Error('invalid-item')
    const safeDays = Math.min(3650, Math.max(1, Math.round(days)))
    const body = await this.options.storage.read(this.slot(mode, itemId), 'history.json')
    if (!body) {
      await this.enqueue(mode, itemId)
      return { mode, itemId, updatedAt: null, pending: true, unavailable: false, points: [] as PricePoint[] }
    }
    const snapshot = JSON.parse(body.toString('utf8')) as HistorySnapshot
    const cutoff = this.now().getTime() - safeDays * DAY
    return { mode, itemId, updatedAt: snapshot.updatedAt, pending: false, unavailable: false, points: snapshot.points.filter((point) => point.timestamp >= cutoff) }
  }

  enqueue(mode: MirrorMode, itemId: string) {
    const operation = this.queueWrite.then(async () => {
      const queue = await this.readQueue()
      if (!queue.some((entry) => entry.mode === mode && entry.itemId === itemId)) queue.push({ mode, itemId, requestedAt: this.now().toISOString() })
      await this.writeQueue(queue)
      this.current.queued = queue.length
    })
    this.queueWrite = operation.catch(() => undefined)
    return operation
  }

  run() {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private async pass() {
    await this.queueWrite
    const queue = await this.readQueue()
    this.current = { state: 'running', queued: queue.length, refreshed: 0, failed: 0, startedAt: this.now().toISOString(), finishedAt: null }
    const pending = [...queue]
    const failed: QueueEntry[] = []
    const workers = Array.from({ length: Math.max(1, Math.min(4, this.options.concurrency ?? 2)) }, async () => {
      for (;;) {
        const entry = pending.shift()
        if (!entry) return
        try { await this.refresh(entry); this.current.refreshed += 1 }
        catch (error) {
          failed.push(entry); this.current.failed += 1
          const message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, 'upstream').slice(0, 120)
          this.current.error = message
          this.options.log?.(`price history ${entry.mode}: ${message}`)
        }
      }
    })
    await Promise.all(workers)
    await this.writeQueue(failed)
    this.current.queued = failed.length
    this.current.state = failed.length === 0 ? 'done' : this.current.refreshed > 0 ? 'degraded' : 'error'
    this.current.finishedAt = this.now().toISOString()
  }

  private async refresh(entry: QueueEntry) {
    const response = await this.fetcher(`https://json.tarkov.dev/${entry.mode}/prices/${entry.itemId}`, { headers: { accept: 'application/json', 'accept-encoding': 'gzip, br', 'user-agent': 'RaidOS-price-history/1 (+https://raidos.app)' }, redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const points = normalizePriceHistory(await response.json())
    if (!points.length) throw new Error('empty history')
    const snapshot: HistorySnapshot = { mode: entry.mode, itemId: entry.itemId, updatedAt: this.now().toISOString(), points }
    const transaction = await this.options.storage.begin(this.slot(entry.mode, entry.itemId))
    try {
      await transaction.write('history.json', `${JSON.stringify(snapshot)}\n`)
      await transaction.publish({ mode: entry.mode, itemId: entry.itemId, points: points.length }, async () => {
        const saved = await this.options.storage.read(this.slot(entry.mode, entry.itemId), 'history.json')
        const parsed = saved ? JSON.parse(saved.toString('utf8')) as HistorySnapshot : null
        if (!parsed || parsed.mode !== entry.mode || parsed.itemId !== entry.itemId || !parsed.points.length) throw new Error('history smoke check failed')
      })
    } catch (error) { await transaction.abort(); throw error }
  }

  private slot(mode: MirrorMode, itemId: string) { return `price-history-${mode}-${itemId}` }

  private async readQueue(): Promise<QueueEntry[]> {
    const body = await this.options.storage.read('price-history-queue', 'queue.json')
    if (!body) return []
    try {
      const rows = JSON.parse(body.toString('utf8')) as unknown
      return Array.isArray(rows) ? rows.filter((row): row is QueueEntry => {
        const entry = row as Partial<QueueEntry>
        return ['regular', 'pve', 'pvp-season'].includes(String(entry.mode)) && ITEM_ID.test(String(entry.itemId)) && typeof entry.requestedAt === 'string'
      }) : []
    } catch { return [] }
  }

  private async writeQueue(queue: QueueEntry[]) {
    const transaction = await this.options.storage.begin('price-history-queue')
    try { await transaction.write('queue.json', `${JSON.stringify(queue)}\n`); await transaction.publish({ entries: queue.length }) }
    catch (error) { await transaction.abort(); throw error }
  }
}
