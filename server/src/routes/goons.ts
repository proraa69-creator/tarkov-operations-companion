import express from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ipRateKey } from '../services/securityGuard.js'
import { GOON_MAP_IDS, GOON_MODES, GOON_RETENTION_MS, MemoryGoonStore, summarizeGoons, type GoonStore } from '../services/goonStore.js'

/** One accepted report per client address per minute. */
export const GOON_RATE_LIMIT_MS = 60_000
/** The same address repeating the same map is ignored for two minutes. */
export const GOON_DEDUPE_MS = 2 * 60_000

const modeSchema = z.enum(GOON_MODES)
const sightingSchema = z.object({ mapId: z.enum(GOON_MAP_IDS) })

export interface GoonsRouterOptions { now?: () => number }

/**
 * Public Goons sightings API, mounted at /v1/goons.
 *   GET  /v1/goons/:mode            → { latest, last5h }
 *   POST /v1/goons/:mode/sightings  { mapId } → { accepted, reason?, snapshot }
 * Client addresses are only kept as salted hashes for rate limiting and dedupe.
 * Behind a reverse proxy the app must set `trust proxy`, otherwise every client shares the proxy address.
 */
export function createGoonsRouter(store: GoonStore = new MemoryGoonStore(), options: GoonsRouterOptions = {}) {
  const now = options.now ?? Date.now
  const salt = randomBytes(16).toString('hex')
  // Per IPv4 address (/32) or IPv6 /64 prefix: one subscriber gets a whole /64 and could otherwise rotate addresses.
  const reporterOf = (req: express.Request) => createHash('sha256').update(`${salt}:${ipRateKey(req.ip ?? req.socket.remoteAddress)}`).digest('hex').slice(0, 32)
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
    const reporter = reporterOf(req)
    const repeated = store.lastByReporterOnMap(reporter, mode.data, body.data.mapId)
    if (repeated && time - Date.parse(repeated.reportedAt) < GOON_DEDUPE_MS) {
      res.json({ accepted: false, reason: 'duplicate', snapshot: summarizeGoons(store, mode.data, time) }); return
    }
    const previous = store.lastByReporter(reporter)
    if (previous && time - Date.parse(previous.reportedAt) < GOON_RATE_LIMIT_MS) {
      const retryAfter = Math.ceil((GOON_RATE_LIMIT_MS - (time - Date.parse(previous.reportedAt))) / 1000)
      res.status(429).set('retry-after', String(retryAfter)).json({ error: 'Слишком частые отметки. Повторите через минуту.' }); return
    }
    store.add({ mapId: body.data.mapId, mode: mode.data, reportedAt: new Date(time).toISOString(), reporter })
    res.status(201).json({ accepted: true, snapshot: summarizeGoons(store, mode.data, time) })
  })

  return router
}
