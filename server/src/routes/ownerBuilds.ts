/**
 * The weapon builds the owner set by hand and what they taught (services/ownerBuildStore.ts; owner, 02.11.2026).
 *
 *   GET  /v1/owner-builds                                   -> { builds, lessons } (public: every player's app shows the
 *                                                              owner's builds and leans its own solver his way; no author)
 *   PUT  /v1/accounts/me/admin/owner-builds  { weaponId, tier, code, added, removed } -> { build, builds, lessons }
 *   POST /v1/accounts/me/admin/owner-builds/remove  { weaponId, tier }                -> { builds, lessons }
 *
 * Owner routes as the quest requirements (routes/questRequirements.ts): 401 without a session, 404 for everybody but the
 * owner, 120 writes a minute, removal is a POST (the desktop app's gateway forwards GET / POST / PUT only), writes go to
 * the audit log as `arsenal.owner-build`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { OWNER_BUILD_TIERS, OwnerBuildStore, type OwnerBuild, type OwnerBuildTier } from '../services/ownerBuildStore.js'

const ITEM_ID = /^[a-f0-9]{24}$/
const tier = z.enum(OWNER_BUILD_TIERS as [OwnerBuildTier, ...OwnerBuildTier[]])
/** A build code (src/arsenal/buildStorage.ts encodeBuild): «RB1.<weapon>.<preset>.<slots>», base64url and brackets. */
const code = z.string().trim().max(4000).regex(/^RB1\.[A-Za-z0-9_-]{16}\.(?:[A-Za-z0-9_-]{16})?\.[A-Za-z0-9_()-]*$/)
const parts = z.array(z.string().trim().toLowerCase().regex(ITEM_ID)).max(200).default([])
const saveSchema = z.object({ weaponId: z.string().trim().toLowerCase().regex(ITEM_ID), tier, code, added: parts, removed: parts })
const removeSchema = z.object({ weaponId: z.string().trim().toLowerCase().regex(ITEM_ID), tier })

export type OwnerBuildAudit = (actor: string, action: 'arsenal.owner-build', target: string, details: Record<string, unknown>) => void

/** What every player gets: no author e-mail. */
const publicView = ({ weaponId, tier: buildTier, code: buildCode, updatedAt }: OwnerBuild) => ({ weaponId, tier: buildTier, code: buildCode, updatedAt })

export function createOwnerBuildsRouter(accounts: AccountStore, store: OwnerBuildStore, options: { audit?: OwnerBuildAudit } = {}) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(120, 60 * 1000)
  const answer = () => ({ builds: store.list().map(publicView), lessons: store.lessons() })

  router.get('/v1/owner-builds', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(answer())
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

  router.put('/v1/accounts/me/admin/owner-builds', (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const body = saveSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректная сборка' }); return }
    const saved = store.save(body.data, actor)
    if (saved === 'full') { res.status(409).json({ error: 'Слишком много сборок' }); return }
    try { options.audit?.(actor, 'arsenal.owner-build', `${saved.weaponId}:${saved.tier}`, { added: body.data.added.length, removed: body.data.removed.length }) } catch { /* saved anyway */ }
    res.json({ build: publicView(saved), ...answer() })
  })

  router.post('/v1/accounts/me/admin/owner-builds/remove', (req, res) => {
    const actor = owner(req, res)
    if (!actor) return
    const body = removeSchema.safeParse(req.body)
    if (!body.success || !store.remove(body.data.weaponId, body.data.tier)) { res.status(404).json({ error: 'Сборка не найдена' }); return }
    try { options.audit?.(actor, 'arsenal.owner-build', `${body.data.weaponId}:${body.data.tier}`, { op: 'remove' }) } catch { /* removed anyway */ }
    res.json(answer())
  })

  return router
}
