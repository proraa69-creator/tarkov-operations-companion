/**
 * Quest requirements curated by the owner in the quest constructor (services/questRequirementStore.ts).
 *
 *   GET  /v1/quest-requirements                                  -> { overrides } (public: every player's app merges
 *                                                                   them into the quests; without the author)
 *   GET  /v1/accounts/me/admin/quest-requirements                -> { overrides } (owner: with the author)
 *   PUT  /v1/accounts/me/admin/quest-requirements  { id?, questId, op: 'add' | 'hide', itemId, kind, count?,
 *        foundInRaid?, comment?, commentEn?, objectiveId?, pointId?, mapId? } -> { override, overrides }
 *   POST /v1/accounts/me/admin/quest-requirements/order  { questId, ids } -> { overrides } (reordered by hand)
 *   POST /v1/accounts/me/admin/quest-requirements/:id/remove     -> { overrides }
 *
 * Owner routes as the quest points and texts (routes/questPoints.ts): 401 without a session, 404 for everybody but the
 * owner, 120 writes a minute, removal is a POST (the desktop app's gateway forwards GET / POST / PUT only), writes go to
 * the audit log as `map.quest-requirement`, and every saved write tells the running apps at once (routes/mapUpdates.ts).
 * The item must be a game item id (24 hex characters) and, once the server has a catalog loaded, an item of it.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { QUEST_REQUIREMENT_KINDS, QuestRequirementStore, type QuestRequirementKind, type QuestRequirementOverride } from '../services/questRequirementStore.js'
import { optionalText } from './ownerText.js'

const ident = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,200}$/)
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
export const ITEM_ID = /^[a-f0-9]{24}$/
export const QUEST_REQUIREMENT_COMMENT_MAX = 300
const overrideSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  questId: ident,
  op: z.enum(['add', 'hide']).default('add'),
  itemId: z.string().trim().toLowerCase().regex(ITEM_ID),
  kind: z.enum(QUEST_REQUIREMENT_KINDS as [QuestRequirementKind, ...QuestRequirementKind[]]),
  count: z.number().int().min(1).max(999).default(1),
  foundInRaid: z.boolean().optional(),
  comment: optionalText(QUEST_REQUIREMENT_COMMENT_MAX),
  commentEn: optionalText(QUEST_REQUIREMENT_COMMENT_MAX),
  objectiveId: ident.optional(),
  pointId: ident.optional(),
  mapId: slug.optional(),
})
const orderSchema = z.object({ questId: ident, ids: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(100) })
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)

export type QuestRequirementAudit = (actor: string, action: 'map.quest-requirement', target: string, details: Record<string, unknown>) => void
/** Whether the catalog has the item: undefined while the server has no catalog loaded (then the id format is enough). */
export type KnownItem = (itemId: string) => boolean | undefined

/** What every player gets: no author e-mail. */
function publicView(entry: QuestRequirementOverride): Omit<QuestRequirementOverride, 'updatedBy'> {
  const view: Partial<QuestRequirementOverride> = { ...entry }
  delete view.updatedBy
  return view as Omit<QuestRequirementOverride, 'updatedBy'>
}

/** `changed`: told after every saved write, so every running app re-reads the requirements at once. */
export function createQuestRequirementsRouter(accounts: AccountStore, store: QuestRequirementStore, options: { audit?: QuestRequirementAudit; changed?: () => void; knownItem?: KnownItem } = {}) {
  const { audit, changed, knownItem } = options
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(120, 60 * 1000)

  router.get('/v1/quest-requirements', (_req, res) => {
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

  router.get('/v1/accounts/me/admin/quest-requirements', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ overrides: store.list() })
  })

  router.put('/v1/accounts/me/admin/quest-requirements', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = overrideSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: `Некорректное требование квеста (количество 1–999, комментарий до ${QUEST_REQUIREMENT_COMMENT_MAX} символов)` }); return }
    const { id, ...input } = body.data
    let known: boolean | undefined
    try { known = knownItem?.(input.itemId) } catch { known = undefined }
    if (known === false) { res.status(400).json({ error: 'Предмета нет в каталоге' }); return }
    // «Найден в рейде» only means something for a hand-over or a find.
    if (input.kind !== 'handover' && input.kind !== 'find') delete input.foundInRaid
    const saved = store.save(input, actor, id)
    if (saved === 'missing') { res.status(404).json({ error: 'Требование не найдено' }); return }
    if (saved === 'full') { res.status(409).json({ error: 'Слишком много требований. Удалите лишние.' }); return }
    changed?.()
    try {
      audit?.(actor, 'map.quest-requirement', saved.id, {
        op: saved.op, quest: saved.questId, item: saved.itemId, kind: saved.kind, count: saved.count,
        ...(saved.foundInRaid !== undefined ? { fir: saved.foundInRaid } : {}), ...(saved.pointId ? { point: saved.pointId } : {}),
      })
    } catch { /* saved anyway */ }
    res.json({ override: saved, overrides: store.list() })
  })

  router.post('/v1/accounts/me/admin/quest-requirements/order', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = orderSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректный порядок требований' }); return }
    if (!store.reorder(body.data.questId, body.data.ids, actor)) { res.status(404).json({ error: 'Требование не найдено' }); return }
    changed?.()
    try { audit?.(actor, 'map.quest-requirement', body.data.questId, { op: 'order', quest: body.data.questId, count: body.data.ids.length }) } catch { /* saved anyway */ }
    res.json({ overrides: store.list() })
  })

  router.post('/v1/accounts/me/admin/quest-requirements/:id/remove', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const removed = id.success ? store.remove(id.data) : undefined
    if (!removed) { res.status(404).json({ error: 'Требование не найдено' }); return }
    changed?.()
    try { audit?.(actor, 'map.quest-requirement', removed.id, { op: 'remove', was: removed.op, quest: removed.questId, item: removed.itemId, kind: removed.kind }) } catch { /* removed anyway */ }
    res.json({ overrides: store.list() })
  })

  return router
}

/**
 * The catalog check of an item id: every mode's loaded catalog is asked; undefined while none is loaded. The id sets
 * are kept per catalog object, so a new catalog build is seen at once.
 */
export function catalogItemCheck(peek: (mode: 'pvp' | 'pve' | 'seasonal') => { items?: Array<{ id: string }> } | undefined): KnownItem {
  const sets = new WeakMap<object, Set<string>>()
  return (itemId) => {
    let loaded = false
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
      const catalog = peek(mode)
      if (!catalog?.items?.length) continue
      loaded = true
      let ids = sets.get(catalog)
      if (!ids) { ids = new Set(catalog.items.map((item) => item.id)); sets.set(catalog, ids) }
      if (ids.has(itemId)) return true
    }
    return loaded ? false : undefined
  }
}
