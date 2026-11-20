/**
 * «Админ панель» → «Модули убежища» (owner, 20.11.2026: «Включение любого модуля и выключение… по команде… сразу же без
 * обновления приложения появится»): per mode, the hideout modules open from the start and the ones turned off, for every player
 * (src/hideout/hideoutModules.ts, services/hideoutModulesStore.ts).
 *
 *   GET /v1/accounts/me/admin/hideout-modules                            -> { modules | null } (owner: with the author)
 *   PUT /v1/accounts/me/admin/hideout-modules { mode, open, hidden }     -> { modules | null } (owner: that mode's lists, the
 *                                                                           other modes kept; empty lists: the mode as in the game)
 *
 * The apps do not ask here: the same setting rides on the owner's notice (GET /v1/announcement `hideoutModules`,
 * routes/announcement.ts), which every app already reads every few minutes and when its window gets the focus back; `changed`
 * wakes the apps waiting there. A module is one the game has (HIDEOUT_MODULES) or one of the server's catalog (`knownModule`), so a
 * module a new season brings can be set without a new app. Owner routes as «Блоки» (routes/overviewDefaults.ts): 401 without a
 * session, 404 for everybody but the owner, 60 writes a minute, the audit log as `hideout.modules`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { HIDEOUT_MODULE_ID, HIDEOUT_MODULE_MODES, KNOWN_HIDEOUT_MODULES, MODULES_MAX } from '../../../src/hideout/hideoutModules'
import type { RaidMode } from '../../../src/domain/types'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { HideoutModulesStore } from '../services/hideoutModulesStore.js'

export type HideoutModulesAudit = (actor: string, action: 'hideout.modules', target: string, details: Record<string, unknown>) => void

export interface HideoutModulesOptions {
  audit?: HideoutModulesAudit
  /** Told after every saved write (the apps waiting on GET /v1/announcement?since=… get the new answer). */
  changed?: () => void
  /** A module of the server's catalog besides the ones the game is known to have. */
  knownModule?: (id: string) => boolean
}

const unique = (list: string[]) => new Set(list).size === list.length

export function createHideoutModulesRouter(accounts: AccountStore, store: HideoutModulesStore, options: HideoutModulesOptions = {}) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)
  const known = (id: string) => KNOWN_HIDEOUT_MODULES.has(id) || Boolean(options.knownModule?.(id))
  const moduleId = z.string().regex(HIDEOUT_MODULE_ID).refine(known, 'unknown module')
  const list = z.array(moduleId).max(MODULES_MAX).refine(unique, 'each module once')
  const bodySchema = z.object({
    mode: z.enum(HIDEOUT_MODULE_MODES as [RaidMode, ...RaidMode[]]),
    open: list,
    hidden: list,
  }).strict().refine((body) => body.open.every((id) => !body.hidden.includes(id)), 'a module both open and turned off')

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

  router.get('/v1/accounts/me/admin/hideout-modules', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ modules: store.current() })
  })

  router.put('/v1/accounts/me/admin/hideout-modules', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = bodySchema.safeParse(req.body)
    if (!body.success) {
      const issue = body.error.issues[0]
      res.status(400).json({ error: `Некорректные модули убежища${issue?.path.length ? ` (${issue.path.join('.')})` : ''}: режим, известные модули, каждый один раз и не в обоих списках` })
      return
    }
    const { mode, open, hidden } = body.data
    const saved = store.saveMode(mode, { open, hidden }, actor)
    try { options.changed?.() } catch { /* the apps get it at their next check */ }
    try { options.audit?.(actor, 'hideout.modules', mode, { open, hidden }) } catch { /* saved anyway */ }
    res.json({ modules: saved })
  })

  return router
}
