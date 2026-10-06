/**
 * Quest map points corrected by the owner (services/questPointStore.ts).
 *
 *   GET  /v1/quest-points                                     -> { overrides } (public: every player's map uses them;
 *                                                                without the author and the note)
 *   GET  /v1/accounts/me/admin/quest-points                   -> { overrides } (owner: with author and note)
 *   PUT  /v1/accounts/me/admin/quest-points  { id?, questId, markerId?, objectiveId?, stageIndex?, mapId, x, z, floor?,
 *                                               kind: 'move' | 'add' | 'hide', note? } -> { override, overrides }
 *   POST /v1/accounts/me/admin/quest-points/:id/remove        -> { overrides } («Вернуть исходную точку»)
 *
 * Owner routes need the session of an account listed in TARKOV_OWNER_EMAILS: 401 without a session, 404 for everybody
 * else (like the boss placements, routes/mapBosses.ts). Writes go to the owner's audit log as `map.quest-point`.
 * Removal is a POST like the boss placements: the desktop app's service gateway forwards GET / POST / PUT only.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { QuestPointStore, type QuestPointOverride } from '../services/questPointStore.js'

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
const ident = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,200}$/)
/** Game metres; the largest maps are well within ±2000. */
const metres = z.number().finite().min(-5000).max(5000)
const overrideSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  questId: ident,
  markerId: ident.optional(),
  objectiveId: ident.optional(),
  stageIndex: z.number().int().min(0).max(200).optional(),
  mapId: slug,
  x: metres,
  z: metres,
  floor: z.string().trim().min(1).max(40).optional(),
  kind: z.enum(['move', 'add', 'hide']),
  note: z.string().trim().max(300).optional().transform((value) => value || undefined),
})
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)

export type QuestPointAudit = (actor: string, action: 'map.quest-point', target: string, details: Record<string, unknown>) => void

/** What every player gets: no author e-mail, no owner's note. */
function publicView(entry: QuestPointOverride): Omit<QuestPointOverride, 'updatedBy' | 'note'> {
  const view: Partial<QuestPointOverride> = { ...entry }
  delete view.updatedBy
  delete view.note
  return view as Omit<QuestPointOverride, 'updatedBy' | 'note'>
}

/** `changed`: told after every saved write, so every running app re-reads the corrections at once (routes/mapUpdates.ts). */
export function createQuestPointsRouter(accounts: AccountStore, store: QuestPointStore, audit?: QuestPointAudit, changed?: () => void) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(120, 60 * 1000)

  router.get('/v1/quest-points', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ overrides: store.list().map(publicView) })
  })

  /** The owner's e-mail, or an answer was already sent. */
  const owner = (req: Request, res: Response, write: boolean) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = write ? writeLimiter.hit(id) : undefined
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  router.get('/v1/accounts/me/admin/quest-points', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ overrides: store.list() })
  })

  router.put('/v1/accounts/me/admin/quest-points', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = overrideSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректные данные точки' }); return }
    const { id, ...input } = body.data
    const saved = store.save(input, actor, id)
    if (saved === 'invalid') { res.status(400).json({ error: 'Не указана исходная точка' }); return }
    if (saved === 'missing') { res.status(404).json({ error: 'Правка не найдена' }); return }
    if (saved === 'full') { res.status(409).json({ error: 'Слишком много правок точек. Удалите лишние.' }); return }
    changed?.()
    try {
      audit?.(actor, 'map.quest-point', saved.id, {
        op: saved.kind, quest: saved.questId, mapId: saved.mapId, x: Math.round(saved.x), z: Math.round(saved.z),
        ...(saved.markerId ? { marker: saved.markerId } : {}), ...(saved.note ? { note: saved.note } : {}),
      })
    } catch { /* saved anyway */ }
    res.json({ override: saved, overrides: store.list() })
  })

  router.post('/v1/accounts/me/admin/quest-points/:id/remove', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const removed = id.success ? store.remove(id.data) : undefined
    if (!removed) { res.status(404).json({ error: 'Правка не найдена' }); return }
    changed?.()
    try { audit?.(actor, 'map.quest-point', removed.id, { op: 'reset', was: removed.kind, quest: removed.questId, mapId: removed.mapId, ...(removed.markerId ? { marker: removed.markerId } : {}) }) } catch { /* removed anyway */ }
    res.json({ overrides: store.list() })
  })

  return router
}
