/**
 * «Топ сборок»: weapon builds players publish from «Сборка оружия» (services/buildCatalogStore.ts). Signed-in accounts only.
 *
 *   GET  /v1/builds?mode=pvp[&weapon=<id>][&sort=top|new][&offset=N] -> { builds, total, pageSize }
 *   POST /v1/builds            { mode, weaponId, name, code }          -> 201 { build } | 409 (already published / limit)
 *   POST /v1/builds/:id/like                                           -> { likes, liked } (again = unlike)
 *   POST /v1/builds/:id/remove                                         -> { removed: true } (the author or the owner)
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { BUILD_MODES, BUILD_PAGE_SIZE, MAX_BUILDS_PER_ACCOUNT, type BuildCatalogStore } from '../services/buildCatalogStore.js'

const HEX_ID = /^[0-9a-f]{24}$/
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
/** The share code of src/arsenal/buildStorage.ts; a full build is well under 1 500 characters. */
const CODE = /^RB1\.([A-Za-z0-9_-]{16})\.(?:[A-Za-z0-9_-]{16})?\.[A-Za-z0-9_()-]{0,1500}$/

/** 24 hex characters → the 16 base64url characters the share code writes an id as (buildStorage.ts hexToB64). */
export function hexToB64(hex: string) {
  let bits = ''
  for (const char of hex) bits += Number.parseInt(char, 16).toString(2).padStart(4, '0')
  let out = ''
  for (let index = 0; index < bits.length; index += 6) out += B64[Number.parseInt(bits.slice(index, index + 6), 2)]
  return out
}

/** A name players see: printable, single spaces, 1–48 characters. */
const name = z.string().transform((value) => value.replace(/[\p{C}]/gu, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(48))
const publishSchema = z.object({
  mode: z.enum(BUILD_MODES),
  weaponId: z.string().regex(HEX_ID),
  name,
  code: z.string().max(1600).regex(CODE),
}).refine((value) => CODE.exec(value.code)?.[1] === hexToB64(value.weaponId), { message: 'weapon' })
const listSchema = z.object({
  mode: z.enum(BUILD_MODES),
  weapon: z.string().regex(HEX_ID).optional(),
  sort: z.enum(['top', 'new']).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
})
const idSchema = z.string().regex(/^[0-9a-f]{24}$/)

export interface BuildCatalogLimits { publishPerHour?: number; likesPerMinute?: number; readsPerMinute?: number }

export function createBuildCatalogRouter(accounts: AccountStore, store: BuildCatalogStore, limits: BuildCatalogLimits = {}) {
  const router = express.Router()
  const publishLimiter = new FixedWindowRateLimiter(limits.publishPerHour ?? 20, 60 * 60 * 1000)
  const likeLimiter = new FixedWindowRateLimiter(limits.likesPerMinute ?? 60, 60 * 1000)
  const readLimiter = new FixedWindowRateLimiter(limits.readsPerMinute ?? 120, 60 * 1000)

  /** The signed-in account, or an answer was already sent. */
  const signedIn = (req: Request, res: Response, limiter: FixedWindowRateLimiter) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите немного.' }); return undefined }
    return id
  }

  router.get('/v1/builds', (req, res) => {
    const id = signedIn(req, res, readLimiter)
    if (!id) return
    const query = listSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    const page = store.list(id, query.data.mode, { weaponId: query.data.weapon, sort: query.data.sort, offset: query.data.offset })
    res.json({ ...page, pageSize: BUILD_PAGE_SIZE })
  })

  router.post('/v1/builds', (req, res) => {
    const id = signedIn(req, res, publishLimiter)
    if (!id) return
    const body = publishSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректная сборка или название' }); return }
    const author = accounts.view(id).nickname
    const result = store.publish(id, { ...body.data, ...(author ? { author } : {}) })
    if (result === 'duplicate') { res.status(409).json({ error: 'Эта сборка уже в каталоге' }); return }
    if (result === 'full') { res.status(409).json({ error: `В каталоге уже ${MAX_BUILDS_PER_ACCOUNT} ваших сборок этого режима. Удалите старую.` }); return }
    res.status(201).json({ build: result })
  })

  router.post('/v1/builds/:id/like', (req, res) => {
    const id = signedIn(req, res, likeLimiter)
    if (!id) return
    const buildId = idSchema.safeParse(req.params.id)
    if (!buildId.success) { res.status(404).json({ error: 'Сборка не найдена' }); return }
    const result = store.toggleLike(id, buildId.data)
    if (!result) { res.status(404).json({ error: 'Сборка не найдена' }); return }
    if (result === 'own') { res.status(409).json({ error: 'Свою сборку оценить нельзя' }); return }
    res.json(result)
  })

  router.post('/v1/builds/:id/remove', (req, res) => {
    const id = signedIn(req, res, likeLimiter)
    if (!id) return
    const buildId = idSchema.safeParse(req.params.id)
    if (!buildId.success || !store.remove(id, buildId.data, accounts.isOwner(id))) { res.status(404).json({ error: 'Сборка не найдена' }); return }
    res.json({ removed: true })
  })

  return router
}
