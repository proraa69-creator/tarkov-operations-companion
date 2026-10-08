import express from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ipRateKey } from '../services/securityGuard.js'
import { GOON_MAP_IDS, GOON_MODES, GOON_RETENTION_MS, MemoryGoonStore, summarizeGoons, type GoonMode, type GoonStore } from '../services/goonStore.js'

/** One accepted report per client address per minute. */
export const GOON_RATE_LIMIT_MS = 60_000
/** The same address repeating the same map is ignored for two minutes. */
export const GOON_DEDUPE_MS = 2 * 60_000

const modeSchema = z.enum(GOON_MODES)
const sightingSchema = z.object({ mapId: z.enum(GOON_MAP_IDS) })

/** Several accounts behind one address: at most this many reports per address and window. */
export const GOON_ADDRESS_LIMIT = 6
export const GOON_ADDRESS_WINDOW_MS = 10 * 60_000

/** Who reports: the signed-in account and his Tarkov nickname for the mode, or null without a valid session. */
export type GoonReporter = { account: string; nickname?: string } | null

export interface GoonsRouterOptions {
  now?: () => number
  /**
   * With it (the real server): only a signed-in account with a nickname for the mode can report, and the nickname of
   * his account (not one the request names) is shown to everybody. Without it (tests): anonymous reports.
   */
  identify?: (req: express.Request, mode: GoonMode) => GoonReporter
  /** Told after every accepted sighting, so every running app refreshes at once (routes/mapUpdates.ts). */
  onSighting?: () => void
}

/**
 * Public Goons sightings API, mounted at /v1/goons.
 *   GET  /v1/goons/:mode            → { latest, last5h, recent: [{ mapId, reportedAt, nickname? }] }
 *   POST /v1/goons/:mode/sightings  { mapId } (Bearer) → { accepted, reason?, snapshot }
 *        reason: 'duplicate' (same map within 2 minutes), 'signin' (no session), 'nickname' (no nickname for the mode)
 * Accounts and client addresses are only kept as salted hashes for rate limiting and dedupe.
 * Behind a reverse proxy the app must set `trust proxy`, otherwise every client shares the proxy address.
 */
export function createGoonsRouter(store: GoonStore = new MemoryGoonStore(), options: GoonsRouterOptions = {}) {
  const now = options.now ?? Date.now
  const salt = randomBytes(16).toString('hex')
  const hash = (value: string) => createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
  // Per IPv4 address (/32) or IPv6 /64 prefix: one subscriber gets a whole /64 and could otherwise rotate addresses.
  const addressOf = (req: express.Request) => ipRateKey(req.ip ?? req.socket.remoteAddress)
  const addressHits = new Map<string, number[]>()
  const addressLimited = (address: string, time: number) => {
    const recent = (addressHits.get(address) ?? []).filter((at) => time - at < GOON_ADDRESS_WINDOW_MS)
    if (recent.length >= GOON_ADDRESS_LIMIT) { addressHits.set(address, recent); return true }
    recent.push(time)
    addressHits.set(address, recent)
    if (addressHits.size > 10_000) for (const [key, hits] of addressHits) if (!hits.some((at) => time - at < GOON_ADDRESS_WINDOW_MS)) addressHits.delete(key)
    return false
  }
  const router = express.Router()
  router.use(express.json({ limit: '4kb' }))

  router.get('/:mode', (req, res) => {
    const mode = modeSchema.safeParse(req.params.mode)
    if (!mode.success) { res.status(400).json({ error: 'Некорректный режим' }); return }
    const time = now()
    store.prune(time - GOON_RETENTION_MS)
    res.set('cache-control', 'no-store').json(summarizeGoons(store, mode.data, time))
  })

  router.post('/:mode/sightings', (req, res) => {
    const mode = modeSchema.safeParse(req.params.mode)
    const body = sightingSchema.safeParse(req.body)
    if (!mode.success || !body.success) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
    const time = now()
    store.prune(time - GOON_RETENTION_MS)
    let reporter = hash(`ip:${addressOf(req)}`)
    let nickname: string | undefined
    if (options.identify) {
      const who = options.identify(req, mode.data)
      if (!who) { res.json({ accepted: false, reason: 'signin', snapshot: summarizeGoons(store, mode.data, time) }); return }
      if (!who.nickname) { res.json({ accepted: false, reason: 'nickname', snapshot: summarizeGoons(store, mode.data, time) }); return }
      reporter = hash(`account:${who.account}`)
      nickname = who.nickname
    }
    const repeated = store.lastByReporterOnMap(reporter, mode.data, body.data.mapId)
    if (repeated && time - Date.parse(repeated.reportedAt) < GOON_DEDUPE_MS) {
      res.json({ accepted: false, reason: 'duplicate', snapshot: summarizeGoons(store, mode.data, time) }); return
    }
    const previous = store.lastByReporter(reporter)
    if (previous && time - Date.parse(previous.reportedAt) < GOON_RATE_LIMIT_MS) {
      const retryAfter = Math.ceil((GOON_RATE_LIMIT_MS - (time - Date.parse(previous.reportedAt))) / 1000)
      res.status(429).set('retry-after', String(retryAfter)).json({ error: 'Слишком частые отметки. Повторите через минуту.' }); return
    }
    if (options.identify && addressLimited(addressOf(req), time)) {
      res.status(429).set('retry-after', String(Math.ceil(GOON_ADDRESS_WINDOW_MS / 1000))).json({ error: 'Слишком много отметок с этого адреса. Повторите позже.' }); return
    }
    store.add({ mapId: body.data.mapId, mode: mode.data, reportedAt: new Date(time).toISOString(), reporter, ...(nickname ? { nickname } : {}) })
    try { options.onSighting?.() } catch { /* the sighting is saved anyway */ }
    res.status(201).json({ accepted: true, snapshot: summarizeGoons(store, mode.data, time) })
  })

  return router
}
