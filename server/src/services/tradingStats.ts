import { conditionVaries, MIN_PRICE, pickRows, tradingRow, type PriceScan, type TradingItemInput, type TradingRow, type TradingSnapshot } from '../../../src/domain/trading.js'
import type { MirrorStorage } from './mirrorStorage.js'
import { MIRROR_MODES, type MirrorMode } from './tarkovDataMirror.js'

const HOUR = 60 * 60_000
const FILE = 'trading.json'

export interface TradingStatsStatus {
  state: 'idle' | 'running' | 'done' | 'degraded' | 'error'
  /** The mode being built, while one is. */
  mode?: MirrorMode
  modes: Partial<Record<MirrorMode, { builtAt?: string; analyzed?: number; eligible?: number; rows?: number; failed?: number; error?: string }>>
  startedAt: string | null
  finishedAt: string | null
}

export interface TradingStatsOptions {
  storage: MirrorStorage
  fetch?: typeof fetch
  now?: () => Date
  /** How often the published list is renewed (6 hours: the week's statistics barely move in between). */
  intervalMs?: number
  /** How often every candidate is looked at again, rather than the published list only. */
  fullPassMs?: number
  /** The pause between two history requests. */
  spacingMs?: number
  /** After a start the server has heavier things to do first. */
  initialDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

type Candidate = Omit<TradingItemInput, 'scans'>
interface Stored extends TradingSnapshot { fullPassAt?: string }

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

/** One item's scans from the mirror's history answer. */
export function parseScans(payload: unknown): PriceScan[] {
  const root = record(payload)
  const data = root.data ?? payload
  const rows = Array.isArray(data) ? data : Array.isArray(record(data).prices) ? record(data).prices as unknown[] : []
  return rows.flatMap((row) => {
    const entry = record(row)
    const timestamp = positive(entry.timestamp)
    const floor = positive(entry.priceMin)
    if (!timestamp || !floor) return []
    return [{ timestamp, floor, ...(typeof entry.offerCount === 'number' ? { offers: entry.offerCount } : {}) }]
  }).sort((a, b) => a.timestamp - b.timestamp)
}

/** The items worth asking the history of: on the market, all copies alike, not too cheap, with more than one seller. */
export function tradingCandidates(payload: unknown): { fee: TradingSnapshot['fee']; items: Candidate[] } {
  const data = record(record(payload).data ?? payload)
  const flea = record(data.fleaMarket)
  const items: Candidate[] = []
  for (const value of Object.values(record(data.items))) {
    const item = record(value)
    const types = Array.isArray(item.types) ? item.types.map(String) : []
    if (types.includes('noFlea') || typeof item.id !== 'string' || conditionVaries({ types, properties: item.properties, categories: Array.isArray(item.categories) ? item.categories.map(String) : [] })) continue
    if (positive(item.lastLowPrice) < MIN_PRICE || positive(item.lastOfferCount) < 2) continue
    const traders = Array.isArray(item.sellToTrader) ? item.sellToTrader.map((offer) => positive(record(offer).priceRUB)).filter(Boolean) : []
    items.push({ id: item.id, base: positive(item.basePrice), level: positive(item.minLevelForFlea), slots: Math.max(1, positive(item.width) * positive(item.height)), types, traderPrices: traders })
  }
  return { fee: { offerFeeRate: positive(flea.sellOfferFeeRate) || 0.05, requirementFeeRate: positive(flea.sellRequirementFeeRate) || 0.05 }, items }
}

/**
 * The statistics of «Торговля» (src/domain/trading.ts), built rarely and handed out ready (the server is short of CPU and
 * memory): every 6 hours for the items of the published list, once a day for all candidates, per mode. One request at a
 * time with a pause: no burst for tarkov.dev, and a parsed history of ~20 KB costs next to nothing here. Between two passes
 * nothing is held in memory and no player's request causes work: the app reads the file and holds it against the prices it
 * already has. A failed pass keeps the last published file.
 */
export class TradingStats {
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>
  private running: Promise<void> | null = null
  private initial: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private current: TradingStatsStatus = { state: 'idle', modes: {}, startedAt: null, finishedAt: null }

  constructor(private readonly options: TradingStatsOptions) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms) }))
  }

  status(): TradingStatsStatus { return structuredClone(this.current) }

  start() {
    if (this.initial || this.timer) return
    this.stopped = false
    const kick = () => { void this.run().catch(() => undefined) }
    this.initial = setTimeout(kick, this.options.initialDelayMs ?? 30 * 60_000)
    this.initial.unref?.()
    this.timer = setInterval(kick, this.options.intervalMs ?? 6 * HOUR)
    this.timer.unref?.()
  }

  stop() {
    this.stopped = true
    if (this.initial) clearTimeout(this.initial)
    if (this.timer) clearInterval(this.timer)
    this.initial = this.timer = null
  }

  run() {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private async pass() {
    this.current = { ...this.current, state: 'running', startedAt: this.now().toISOString(), finishedAt: null }
    let failed = 0
    for (const mode of MIRROR_MODES) {
      if (this.stopped) break
      this.current.mode = mode
      try { this.current.modes[mode] = await this.build(mode) }
      catch (error) {
        failed += 1
        const message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, 'upstream').slice(0, 120)
        this.current.modes[mode] = { ...this.current.modes[mode], error: message }
        this.options.log?.(`trading stats ${mode}: ${message}`)
      }
    }
    delete this.current.mode
    this.current.state = failed === 0 ? 'done' : failed < MIRROR_MODES.length ? 'degraded' : 'error'
    this.current.finishedAt = this.now().toISOString()
  }

  private async previous(mode: MirrorMode): Promise<Stored | null> {
    const body = await this.options.storage.read(`trading-${mode}`, FILE)
    if (!body) return null
    try { return JSON.parse(body.toString('utf8')) as Stored } catch { return null }
  }

  private async build(mode: MirrorMode) {
    const daily = await this.options.storage.read(`dataset-${mode}`, 'items.json')
    if (!daily) throw new Error('no dataset yet')
    const { fee, items } = tradingCandidates(JSON.parse(daily.toString('utf8')))
    const previous = await this.previous(mode)
    const at = this.now()
    const lastFull = Date.parse(previous?.fullPassAt ?? '')
    const full = !previous || !Number.isFinite(lastFull) || at.getTime() - lastFull >= (this.options.fullPassMs ?? 24 * HOUR)
    const listed = new Set(previous?.rows.map((row) => row.id))
    const wanted = full ? items : items.filter((item) => listed.has(item.id))
    const rows: TradingRow[] = []
    let failed = 0
    let inARow = 0
    for (const item of wanted) {
      if (this.stopped) throw new Error('stopped')
      try {
        const response = await this.fetcher(`https://json.tarkov.dev/${mode}/prices/${item.id}`, { headers: { accept: 'application/json', 'accept-encoding': 'gzip, br', 'user-agent': 'RaidOS-trading-stats/1 (+https://raidos.app)' }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const row = tradingRow({ ...item, scans: parseScans(await response.json()) }, fee, at.getTime())
        if (row) rows.push(row)
        inARow = 0
      } catch {
        failed += 1
        inARow += 1
        // The source is down: no point in knocking on it thousands of times.
        if (inARow >= 20) throw new Error(`history unavailable after ${failed} failures`)
      }
      await this.sleep(this.options.spacingMs ?? 300)
    }
    if (wanted.length && failed / wanted.length > 0.1) throw new Error(`too many failures (${failed} of ${wanted.length})`)
    const snapshot: Stored = {
      format: 1,
      mode,
      builtAt: at.toISOString(),
      fullPassAt: full ? at.toISOString() : previous?.fullPassAt ?? at.toISOString(),
      analyzed: full ? wanted.length : previous?.analyzed ?? wanted.length,
      eligible: full ? rows.length : previous?.eligible ?? rows.length,
      fee,
      rows: pickRows(rows),
    }
    const transaction = await this.options.storage.begin(`trading-${mode}`)
    try {
      await transaction.write(FILE, `${JSON.stringify(snapshot)}\n`)
      await transaction.publish({ mode, rows: snapshot.rows.length }, async () => {
        const saved = await this.options.storage.read(`trading-${mode}`, FILE)
        const parsed = saved ? JSON.parse(saved.toString('utf8')) as Stored : null
        if (!parsed || parsed.mode !== mode || !Array.isArray(parsed.rows)) throw new Error('trading stats smoke check failed')
      })
    } catch (error) { await transaction.abort(); throw error }
    return { builtAt: snapshot.builtAt, analyzed: snapshot.analyzed, eligible: snapshot.eligible, rows: snapshot.rows.length, failed }
  }
}
