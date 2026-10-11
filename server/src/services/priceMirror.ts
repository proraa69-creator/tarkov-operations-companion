import type { MirrorStorage } from './mirrorStorage.js'
import { MIRROR_MODES, type MirrorMode } from './tarkovDataMirror.js'

const MINUTE = 60_000
const RETRY = [MINUTE, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE]

export interface MirroredPrice {
  lastLowPrice?: number
  avg24hPrice?: number
  low24hPrice?: number
  noFlea?: boolean
}
export interface PriceSnapshot {
  mode: MirrorMode
  updatedAt: string
  source: 'graphql' | 'json'
  fleaMarket: { enabled: boolean; sellOfferFeeRate?: number; sellRequirementFeeRate?: number }
  items: Record<string, MirroredPrice>
}
export interface PriceModeStatus { updatedAt?: string; source?: PriceSnapshot['source']; items?: number; bytes: number; error?: string }
export interface PriceMirrorStatus {
  state: 'idle' | 'running' | 'done' | 'degraded' | 'error'
  modes: Partial<Record<MirrorMode, PriceModeStatus>>
  failures: number
  nextAt: string | null
  bytes: number
}

export interface PriceMirrorOptions {
  storage: MirrorStorage
  fetch?: typeof fetch
  now?: () => Date
  intervalMs?: number
  minimumItems?: number
  log?: (message: string) => void
}

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function normalizePrices(payload: unknown, mode: MirrorMode, source: PriceSnapshot['source'], updatedAt: string): PriceSnapshot {
  const envelope = record(payload)
  const data = record(envelope.data ?? envelope)
  const rawItems = data.items
  const rows = Array.isArray(rawItems) ? rawItems.map(record) : Object.values(record(rawItems)).map(record)
  const items: Record<string, MirroredPrice> = {}
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : ''
    if (!/^[a-z0-9]{16,48}$/.test(id)) continue
    const types = Array.isArray(row.types) ? row.types.map(String) : []
    const price: MirroredPrice = {
      ...(number(row.lastLowPrice) ? { lastLowPrice: number(row.lastLowPrice) } : {}),
      ...(number(row.avg24hPrice) ? { avg24hPrice: number(row.avg24hPrice) } : {}),
      ...(number(row.low24hPrice) ? { low24hPrice: number(row.low24hPrice) } : {}),
      ...(types.includes('noFlea') ? { noFlea: true } : {}),
    }
    items[id] = price
  }
  const flea = record(data.fleaMarket)
  return {
    mode,
    updatedAt,
    source,
    fleaMarket: {
      enabled: flea.enabled !== false,
      ...(number(flea.sellOfferFeeRate) !== undefined ? { sellOfferFeeRate: number(flea.sellOfferFeeRate) } : {}),
      ...(number(flea.sellRequirementFeeRate) !== undefined ? { sellRequirementFeeRate: number(flea.sellRequirementFeeRate) } : {}),
    },
    items,
  }
}

function priceQuery(mode: 'regular' | 'pve') {
  return `query RaidOsPriceMirror { fleaMarket(gameMode: ${mode}) { enabled sellOfferFeeRate sellRequirementFeeRate } items(gameMode: ${mode}) { id avg24hPrice low24hPrice lastLowPrice types } }`
}

export class PriceMirror {
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private readonly interval: number
  private readonly minimum: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private failures = 0
  private stopped = false
  private current: PriceMirrorStatus = { state: 'idle', modes: {}, failures: 0, nextAt: null, bytes: 0 }

  constructor(private readonly options: PriceMirrorOptions) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
    this.interval = Math.max(10_000, options.intervalMs ?? (Number(process.env.RAIDOS_PRICE_SYNC_MS) || MINUTE))
    this.minimum = options.minimumItems ?? 1000
  }

  status(): PriceMirrorStatus { return { ...this.current, modes: structuredClone(this.current.modes) } }

  start(delayMs = 20_000) { this.stopped = false; this.schedule(delayMs) }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null }

  run() {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private schedule(delay: number) {
    if (this.stopped || this.timer) return
    this.current.nextAt = new Date(this.now().getTime() + delay).toISOString()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run().finally(() => this.schedule(this.failures ? RETRY[Math.min(this.failures, RETRY.length) - 1]! : this.interval))
    }, delay)
    this.timer.unref?.()
  }

  private async pass() {
    this.current = { state: 'running', modes: {}, failures: this.failures, nextAt: null, bytes: 0 }
    let failed = 0
    for (const mode of MIRROR_MODES) {
      try {
        const result = await this.sync(mode)
        this.current.modes[mode] = { updatedAt: result.snapshot.updatedAt, source: result.snapshot.source, items: Object.keys(result.snapshot.items).length, bytes: result.bytes }
        this.current.bytes += result.bytes
      } catch (error) {
        failed += 1
        const message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, 'upstream').slice(0, 120)
        this.current.modes[mode] = { bytes: 0, error: message }
        this.options.log?.(`price mirror ${mode}: ${message}`)
      }
    }
    this.failures = failed ? this.failures + 1 : 0
    this.current.failures = this.failures
    this.current.state = failed === 0 ? 'done' : failed < MIRROR_MODES.length ? 'degraded' : 'error'
  }

  private async sync(mode: MirrorMode) {
    let response: Response
    let source: PriceSnapshot['source'] = 'json'
    if (mode !== 'pvp-season') {
      response = await this.fetcher('https://api.tarkov.dev/graphql', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'gzip', 'user-agent': 'RaidOS-price-mirror/1 (+https://raidos.app)' },
        body: JSON.stringify({ query: priceQuery(mode) }), signal: AbortSignal.timeout(45_000), redirect: 'error',
      })
      if (response.ok) source = 'graphql'
      else response = await this.fetcher(`https://json.tarkov.dev/${mode}/items`, { headers: { accept: 'application/json', 'accept-encoding': 'gzip', 'user-agent': 'RaidOS-price-mirror/1 (+https://raidos.app)' }, signal: AbortSignal.timeout(45_000), redirect: 'error' })
    } else {
      response = await this.fetcher(`https://json.tarkov.dev/${mode}/items`, { headers: { accept: 'application/json', 'accept-encoding': 'gzip', 'user-agent': 'RaidOS-price-mirror/1 (+https://raidos.app)' }, signal: AbortSignal.timeout(45_000), redirect: 'error' })
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    const text = await response.text()
    let payload: unknown
    try { payload = JSON.parse(text) } catch { throw new Error('invalid JSON') }
    const snapshot = normalizePrices(payload, mode, source, this.now().toISOString())
    const count = Object.keys(snapshot.items).length
    if (count < this.minimum) throw new Error(`incomplete prices (${count})`)
    const transaction = await this.options.storage.begin(`prices-${mode}`)
    try {
      await transaction.write('prices.json', `${JSON.stringify(snapshot)}\n`)
      await transaction.publish({ mode, source, items: count })
    } catch (error) { await transaction.abort(); throw error }
    return { snapshot, bytes: Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(text) }
  }
}
