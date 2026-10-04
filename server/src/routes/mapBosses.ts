/**
 * Bosses placed on the maps by the owner (services/mapBossStore.ts).
 *
 *   GET  /v1/map-bosses                                      -> { placements } (public: every player's map shows them)
 *   POST /v1/accounts/me/admin/map-bosses       { mapId, bossKey, bossName, x, z, floor? } -> { placement, placements }
 *   POST /v1/accounts/me/admin/map-bosses/:id/remove                                  -> { placements }
 *
 * Writes need the session of an account listed in TARKOV_OWNER_EMAILS: 401 without a session, 404 for everybody else
 * (like the rest of the owner's admin routes). They are written to the owner's audit log when it exists.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { MAX_MAP_BOSS_PLACEMENTS, MapBossStore } from '../services/mapBossStore.js'

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
/** Game metres; the largest maps are well within ±2000. */
const metres = z.number().finite().min(-5000).max(5000)
const placementSchema = z.object({
  mapId: slug,
  bossKey: slug,
  bossName: z.string().trim().min(1).max(60),
  x: metres,
  z: metres,
  floor: z.string().trim().min(1).max(40).optional(),
  hidden: z.boolean().optional(),
})
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)

export type MapBossAudit = (actor: string, action: 'map.boss-place' | 'map.boss-remove', target: string, details: Record<string, unknown>) => void

export function createMapBossesRouter(accounts: AccountStore, store: MapBossStore, audit?: MapBossAudit) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  router.get('/v1/map-bosses', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ placements: store.list() })
  })

  /** The owner's e-mail, or an answer was already sent. */
  const owner = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = writeLimiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  router.post('/v1/accounts/me/admin/map-bosses', (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const body = placementSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректные данные метки' }); return }
    const placement = store.add(body.data, actor)
    if (!placement) { res.status(409).json({ error: 'Слишком много меток боссов. Удалите лишние.' }); return }
    try { audit?.(actor, 'map.boss-place', placement.id, { mapId: placement.mapId, boss: placement.bossKey, x: Math.round(placement.x), z: Math.round(placement.z), ...(placement.hidden ? { hidden: true } : {}) }) } catch { /* placed anyway */ }
    res.status(201).json({ placement, placements: store.list() })
  })

  /** «Применить расстановку PvP ко всем режимам»: many placements in one request (all or nothing). */
  router.post('/v1/accounts/me/admin/map-bosses/batch', (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const body = z.object({ placements: z.array(placementSchema).min(1).max(500) }).safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректные данные меток' }); return }
    if (store.list().length + body.data.placements.length > MAX_MAP_BOSS_PLACEMENTS) { res.status(409).json({ error: 'Слишком много меток боссов. Удалите лишние.' }); return }
    const added = body.data.placements.map((placement) => store.add(placement, actor)).filter(Boolean)
    try { audit?.(actor, 'map.boss-place', `batch:${added.length}`, { batch: added.length, maps: [...new Set(body.data.placements.map((entry) => entry.mapId))] }) } catch { /* placed anyway */ }
    res.status(201).json({ placements: store.list() })
  })

  router.post('/v1/accounts/me/admin/map-bosses/:id/remove', (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const removed = id.success ? store.remove(id.data) : undefined
    if (!removed) { res.status(404).json({ error: 'Метка не найдена' }); return }
    try { audit?.(actor, 'map.boss-remove', removed.id, { mapId: removed.mapId, boss: removed.bossKey }) } catch { /* removed anyway */ }
    res.json({ placements: store.list() })
  })

  return router
}
