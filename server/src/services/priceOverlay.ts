import { readFile } from 'node:fs/promises'
import type { MirrorMode } from './tarkovDataMirror.js'

/**
 * A second source of flea prices for the price mirror, on the owner's word of 06.11.2026: Tarkov Market's public API, by key, as
 * often as it allows, for the server to hand on to every app (docs/trading.md). Its documented limits (tarkov-market.com/dev/api):
 * the full list is cached 5 minutes and allows 5 requests a minute, in every mode; so one request per mode per 5 minutes, 3 in all.
 * Players' apps never ask it: however many they are, it sees this server alone.
 *
 * With no key, or when it fails, the mirror carries on with tarkov.dev and no player notices. The key comes from the server's
 * environment or a file, never from Git; it travels only in a header and never reaches a log, the status route or a player.
 * Neither the source's name nor its address reaches a player either (owner, 06.11.2026).
 */
const BASE = 'https://api.tarkov-market.app/api/v1'
const LIST: Record<MirrorMode, string> = { regular: '/items/all', pve: '/pve/items/all', 'pvp-season': '/season/items/all' }
const MINUTE = 60_000
/** Asking the full list more often gains nothing: the API caches it for this long. */
const LIST_INTERVAL_MS = 5 * MINUTE
/** Prices older than this are not laid over anything: the source has been failing for a while. */
const MAX_AGE_MS = 30 * MINUTE
/** A key it refuses: no point in knocking every 5 minutes. */
const REFUSED_PAUSE_MS = 60 * MINUTE
const ITEM_ID = /^[a-z0-9]{16,48}$/

export interface OverlayPrice {
  price: number
  avg24hPrice?: number
  /** When its scanner last saw this price (ms). */
  renewed: number
}

export type OverlayPrices = ReadonlyMap<string, OverlayPrice>

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

/**
 * The rows that can be trusted, by the game's item id (`bsgId`, the id tarkov.dev has too). By its documentation: `haveMarketData`
 * false means «do not trust price», an empty `updated` was never seen, `isFunctional` false is not obtainable.
 */
export function parseOverlay(payload: unknown, nowMs: number): Map<string, OverlayPrice> {
  const prices = new Map<string, OverlayPrice>()
  if (!Array.isArray(payload)) return prices
  for (const value of payload) {
    const row = record(value)
    const id = typeof row.bsgId === 'string' ? row.bsgId : ''
    const price = positive(row.price)
    const renewed = typeof row.updated === 'string' ? Date.parse(row.updated) : Number.NaN
    if (!ITEM_ID.test(id) || !price || !Number.isFinite(renewed) || renewed > nowMs + 5 * MINUTE) continue
    if (row.haveMarketData !== true || row.bannedOnFlea === true || row.isFunctional === false) continue
    const avg24hPrice = positive(row.avg24hPrice)
    prices.set(id, { price, renewed, ...(avg24hPrice ? { avg24hPrice } : {}) })
  }
  return prices
}

/** The key from the server's environment: a value, or a file read each time, so a new key needs no restart. Nothing set: no key. */
export function overlayKeyFrom(env: NodeJS.ProcessEnv = process.env): () => Promise<string | null> {
  return async () => {
    const direct = env.RAIDOS_MARKET_API_KEY?.trim()
    if (direct) return direct
    const file = env.RAIDOS_MARKET_API_KEY_FILE?.trim()
    if (!file) return null
    try { return (await readFile(file, 'utf8')).trim() || null } catch { return null }
  }
}

interface ModeState { prices?: Map<string, OverlayPrice>; fetchedAt?: number; nextAt: number }

export interface PriceOverlayOptions {
  readKey: () => Promise<string | null>
  fetch?: typeof fetch
  now?: () => Date
  intervalMs?: number
  maxAgeMs?: number
  log?: (message: string) => void
}

export class PriceOverlay {
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private readonly modes: Partial<Record<MirrorMode, ModeState>> = {}
  private refusedUntil = 0

  constructor(private readonly options: PriceOverlayOptions) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  /** This mode's prices, asked for at most once per interval; null with none fresh enough. Never throws: the mirror does not depend on it. */
  async prices(mode: MirrorMode): Promise<OverlayPrices | null> {
    const at = this.now().getTime()
    const state = this.modes[mode] ??= { nextAt: 0 }
    if (at >= state.nextAt && at >= this.refusedUntil) await this.fetchList(mode, state, at)
    if (!state.prices || state.fetchedAt === undefined || at - state.fetchedAt > (this.options.maxAgeMs ?? MAX_AGE_MS)) return null
    return state.prices
  }

  private async fetchList(mode: MirrorMode, state: ModeState, at: number) {
    const key = await this.options.readKey().catch(() => null)
    if (!key) return
    const interval = this.options.intervalMs ?? LIST_INTERVAL_MS
    state.nextAt = at + interval
    try {
      const response = await this.fetcher(`${BASE}${LIST[mode]}`, { headers: { accept: 'application/json', 'accept-encoding': 'gzip, br', 'x-api-key': key, 'user-agent': 'RaidOS-price-mirror/2 (+https://raidos.app)' }, redirect: 'error', signal: AbortSignal.timeout(60_000) })
      if (response.status === 401 || response.status === 403) {
        this.refusedUntil = at + REFUSED_PAUSE_MS
        this.options.log?.(`price overlay ${mode}: key refused (HTTP ${response.status}), next try in an hour`)
        return
      }
      if (response.status === 429) {
        const wait = Number(response.headers.get('retry-after'))
        state.nextAt = at + Math.max(interval, Number.isFinite(wait) ? wait * 1000 : 0)
        this.options.log?.(`price overlay ${mode}: over the limit (HTTP 429)`)
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const prices = parseOverlay(await response.json(), this.now().getTime())
      if (!prices.size) throw new Error('no usable prices')
      state.prices = prices
      state.fetchedAt = at
    } catch (error) {
      // Only a status or a short reason: the address and the key stay out of the log.
      const reason = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, 'upstream').replaceAll(key, '***').slice(0, 120)
      this.options.log?.(`price overlay ${mode}: ${reason}`)
    }
  }
}
