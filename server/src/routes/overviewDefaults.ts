/**
 * «Админ панель» → «Блоки» (owner, 16.10.2026: «функции редактирования блоков… без надобности загружать обновление
 * сервера»): the Overview every player starts from (services/overviewDefaultsStore.ts, src/overview/overviewDefaults.ts).
 *
 *   GET  /v1/overview-defaults                              -> { defaults | null } (public, without the author)
 *   GET  /v1/accounts/me/admin/overview-defaults            -> { defaults | null } (owner: with the author)
 *   PUT  /v1/accounts/me/admin/overview-defaults <defaults> -> { defaults } (owner)
 *   POST /v1/accounts/me/admin/overview-defaults/reset      -> { defaults: null } (owner: the built-in Overview again)
 *
 * The apps do not ask here on their own: the same defaults ride on the owner's notice (GET /v1/announcement `overview`,
 * routes/announcement.ts), which every app already reads every few minutes and when its window gets the focus back;
 * `changed` wakes the apps waiting there with `since`. Owner routes as the event quests (routes/eventQuests.ts): 401
 * without a session, 404 for everybody but the owner, 60 writes a minute, the audit log as `overview.blocks`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { OVERVIEW_BLOCK_IDS, OVERVIEW_TITLE_MAX } from '../../../src/overview/overviewDefaults'
import { OVERVIEW_ZONES, type OverviewZoneId } from '../../../src/overview/overviewLayout'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { OverviewDefaultsStore } from '../services/overviewDefaultsStore.js'

const unique = (list: string[]) => new Set(list).size === list.length
const printable = (value: string) => [...value].filter((char) => {
  const code = char.charCodeAt(0)
  return code >= 32 && code !== 127
}).join('').trim()
const title = z.string().transform(printable).pipe(z.string().max(OVERVIEW_TITLE_MAX))
const blockId = z.string().refine((id) => OVERVIEW_BLOCK_IDS.has(id), 'unknown block')
/** A zone's order: exactly its own blocks, once each (overviewLayout.ts). */
const zoneOrder = (zone: OverviewZoneId) => z.array(z.string()).max(OVERVIEW_ZONES[zone].length)
  .refine((list) => unique(list) && list.length === OVERVIEW_ZONES[zone].length && list.every((id) => OVERVIEW_ZONES[zone].includes(id)), `the blocks of ${zone}`)

const bodySchema = z.object({
  layout: z.object({ stats: zoneOrder('stats'), rows: zoneOrder('rows'), left: zoneOrder('left'), right: zoneOrder('right') }).strict().nullable().optional(),
  phone: z.array(blockId).max(OVERVIEW_BLOCK_IDS.size).refine(unique).refine((list) => list.length === OVERVIEW_BLOCK_IDS.size, 'every block once').nullable().optional(),
  hidden: z.array(blockId).max(OVERVIEW_BLOCK_IDS.size).refine(unique),
  titles: z.record(z.string(), z.object({ ru: title, en: title }).strict())
    .refine((titles) => Object.keys(titles).every((id) => OVERVIEW_BLOCK_IDS.has(id)), 'unknown block'),
  // what the server itself keeps is ignored when the app sends the stored defaults back
  updatedAt: z.unknown().optional(),
  updatedBy: z.unknown().optional(),
}).strict()

export type OverviewDefaultsAudit = (actor: string, action: 'overview.blocks', target: string, details: Record<string, unknown>) => void

/** `changed`: told after every saved write (the apps waiting on GET /v1/announcement?since=… get the new answer). */
export function createOverviewDefaultsRouter(accounts: AccountStore, store: OverviewDefaultsStore, audit?: OverviewDefaultsAudit, changed?: () => void) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  router.get('/v1/overview-defaults', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ defaults: store.publicView() })
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

  router.get('/v1/accounts/me/admin/overview-defaults', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ defaults: store.current() })
  })

  router.put('/v1/accounts/me/admin/overview-defaults', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = bodySchema.safeParse(req.body)
    if (!body.success) {
      const issue = body.error.issues[0]
      res.status(400).json({ error: `Некорректные настройки блоков${issue?.path.length ? ` (${issue.path.join('.')})` : ''}: проверьте блоки и длину названий (до ${OVERVIEW_TITLE_MAX} символов)` })
      return
    }
    const { layout, phone, hidden, titles } = body.data
    const saved = store.save({ ...(layout ? { layout } : {}), ...(phone ? { phone } : {}), hidden, titles }, actor)
    changed?.()
    try {
      audit?.(actor, 'overview.blocks', 'overview', { op: 'save', hidden: saved.hidden, titles: Object.keys(saved.titles), layout: Boolean(saved.layout), phone: Boolean(saved.phone) })
    } catch { /* saved anyway */ }
    res.json({ defaults: saved })
  })

  router.post('/v1/accounts/me/admin/overview-defaults/reset', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const removed = store.reset()
    if (removed) {
      changed?.()
      try { audit?.(actor, 'overview.blocks', 'overview', { op: 'reset' }) } catch { /* reset anyway */ }
    }
    res.json({ defaults: null })
  })

  return router
}
