/**
 * The owner's sticker packs (services/stickerStore.ts; owner, 07.11.2026: «И там я буду делать паки стикеров. Которые по
 * нажатию кнопки добавить будут добавляться в приложение на ПК и телефон»).
 *
 * Everybody (the apps' sticker picker, src/support/stickerCatalog.ts):
 *   GET /v1/stickers           -> { version, updatedAt, packs: [{ id, name, stickers: [{ id, width, height }] }] }: the
 *        published packs with at least one sticker, in the owner's order; `version` moves with any change of them
 *   GET /v1/stickers/:id.png   -> the sticker's PNG, published or not (its random id is its key), cached for a year
 *        (`immutable`: an id never shows another picture); 404 for a deleted one
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else. Every answer
 * is { packs } (every pack, published or not, with `published`, `createdAt`, `updatedAt` and its stickers' `size`):
 *   GET    /v1/accounts/me/admin/stickers
 *   POST   /v1/accounts/me/admin/stickers/packs                 { name }       -> 201 { pack, packs }; 409 past 50 packs
 *   POST   /v1/accounts/me/admin/stickers/packs/order           { ids }        -> every pack once, in the new order
 *   PUT    /v1/accounts/me/admin/stickers/packs/:id             { name?, published? } -> «Переименовать», «Добавить»
 *          (`published` true: the apps show it) / «Убрать» (false)
 *   DELETE /v1/accounts/me/admin/stickers/packs/:id             -> the pack and its stickers
 *   POST   /v1/accounts/me/admin/stickers/packs/:id/stickers    { data: base64 PNG } -> 201 { sticker, packs }: a PNG by
 *          its bytes, ≤ 512 KB, ≤ 512 × 512 (400 otherwise); 409 past 120 in a pack
 *   POST   /v1/accounts/me/admin/stickers/packs/:id/order       { ids }        -> the pack's stickers once each, in order
 *   DELETE /v1/accounts/me/admin/stickers/:stickerId
 * Written to the owner's audit log (stickers.pack, stickers.publish, stickers.sticker). A deleted sticker's chat messages
 * read as a sticker that is gone (services/supportChatStore.ts).
 *
 * A sticker's base64 (≤ 512 KB → ~700 KB) fits the global 1 MB JSON parser.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ipRateKey } from '../services/securityGuard.js'
import { STICKER_BROKEN, STICKER_TOO_BIG, StickerError, type StickerStore } from '../services/stickerStore.js'
import { OWNER_STICKER_ID, STICKER_LIMITS, STICKER_PACK_ID } from '../../../src/shared/supportStickers.js'

export type StickerAudit = (actor: string, action: 'stickers.pack' | 'stickers.publish' | 'stickers.sticker', target: string, details: Record<string, unknown>) => void

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const PNG_DATA_URL = /^data:image\/png;base64,/
/** Base64 of STICKER_LIMITS.bytes, with room for a data: prefix and line breaks. */
const MAX_BASE64 = Math.ceil(STICKER_LIMITS.bytes / 3) * 4 + 64
const uploadSchema = z.object({ data: z.string().min(1) })
const packSchema = z.object({ name: z.unknown().optional(), published: z.boolean().optional() })
const orderSchema = z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(500) })
const IMAGE_PATH = /^([a-f0-9]{24})\.png$/

export interface StickerRouterOptions {
  audit?: StickerAudit
  now?: () => number
}

export function createStickersRouter(accounts: AccountStore, store: StickerStore, options: StickerRouterOptions = {}) {
  const router = express.Router()
  // The picker reads the packs each time it opens; the pictures are cached by the apps for a year.
  const catalogLimiter = new FixedWindowRateLimiter(120, 60 * 1000, options.now)
  const imageLimiter = new FixedWindowRateLimiter(1200, 60 * 1000, options.now)
  const readLimiter = new FixedWindowRateLimiter(300, 60 * 1000, options.now)
  const writeLimiter = new FixedWindowRateLimiter(120, 60 * 1000, options.now)
  const tell = (work: () => void) => { try { work() } catch { /* written anyway */ } }

  const limited = (limiter: FixedWindowRateLimiter, req: Request, res: Response) => {
    const retry = limiter.hit(ipRateKey(req.ip))
    if (!retry) return false
    res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' })
    return true
  }

  /** The owner's e-mail, or an answer was already sent (as in routes/mapBosses.ts). */
  const owner = (kind: 'read' | 'write', req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = (kind === 'read' ? readLimiter : writeLimiter).hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  /** Runs a change; a refused one (StickerError) is answered here (false). */
  const run = (res: Response, work: () => void) => {
    try {
      work()
      return true
    } catch (error) {
      if (!(error instanceof StickerError)) throw error
      res.status(error.status).json({ error: error.message })
      return false
    }
  }

  const packId = (req: Request, res: Response) => {
    const id = String(req.params.id ?? '')
    if (STICKER_PACK_ID.test(id)) return id
    res.status(404).json({ error: 'Пак не найден' })
    return undefined
  }

  router.get('/v1/stickers', (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (limited(catalogLimiter, req, res)) return
    res.json(store.catalog())
  })

  router.get('/v1/stickers/:file', (req, res) => {
    const match = IMAGE_PATH.exec(String(req.params.file))
    if (!match) { res.status(404).end(); return }
    if (limited(imageLimiter, req, res)) return
    const image = store.image(match[1]!)
    if (!image) { res.set('Cache-Control', 'no-store').status(404).end(); return }
    res.set({
      // An id never shows another picture: kept by the apps (and the browser) for a year.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    })
    res.type('image/png').send(image)
  })

  router.get('/v1/accounts/me/admin/stickers', (req, res) => {
    if (!owner('read', req, res)) return
    res.json({ packs: store.packs() })
  })

  router.post('/v1/accounts/me/admin/stickers/packs', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const body = packSchema.safeParse(req.body)
    let pack: ReturnType<StickerStore['createPack']> | undefined
    if (!run(res, () => { pack = store.createPack(body.success ? body.data.name : undefined) })) return
    res.status(201).json({ pack, packs: store.packs() })
    tell(() => options.audit?.(actor, 'stickers.pack', pack!.id, { change: 'create', name: pack!.name }))
  })

  router.post('/v1/accounts/me/admin/stickers/packs/order', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const body = orderSchema.safeParse(req.body)
    if (!run(res, () => store.orderPacks(body.success ? body.data.ids : undefined))) return
    res.json({ packs: store.packs() })
    tell(() => options.audit?.(actor, 'stickers.pack', 'order', { change: 'order' }))
  })

  router.put('/v1/accounts/me/admin/stickers/packs/:id', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const id = packId(req, res)
    if (!id) return
    const body = packSchema.safeParse(req.body)
    if (!body.success || (body.data.name === undefined && body.data.published === undefined)) { res.status(400).json({ error: 'Некорректные данные пака' }); return }
    const before = store.packs().find((pack) => pack.id === id)
    let pack: ReturnType<StickerStore['updatePack']> | undefined
    if (!run(res, () => { pack = store.updatePack(id, body.data) })) return
    res.json({ packs: store.packs() })
    if (body.data.name !== undefined && before?.name !== pack!.name) tell(() => options.audit?.(actor, 'stickers.pack', id, { change: 'rename', name: pack!.name }))
    if (body.data.published !== undefined && before?.published !== pack!.published) tell(() => options.audit?.(actor, 'stickers.publish', id, { name: pack!.name, published: pack!.published }))
  })

  router.delete('/v1/accounts/me/admin/stickers/packs/:id', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const id = packId(req, res)
    if (!id) return
    const before = store.packs().find((pack) => pack.id === id)
    if (!before || !store.deletePack(id)) { res.status(404).json({ error: 'Пак не найден' }); return }
    res.json({ packs: store.packs() })
    tell(() => options.audit?.(actor, 'stickers.pack', id, { change: 'delete', name: before.name, stickers: before.stickers.length }))
  })

  router.post('/v1/accounts/me/admin/stickers/packs/:id/stickers', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const id = packId(req, res)
    if (!id) return
    const body = uploadSchema.safeParse(req.body)
    let sticker: ReturnType<StickerStore['addSticker']> | undefined
    if (!run(res, () => { sticker = store.addSticker(id, decodePng(body.success ? body.data.data : '')) })) return
    res.status(201).json({ sticker, packs: store.packs() })
    tell(() => options.audit?.(actor, 'stickers.sticker', sticker!.id, { change: 'add', pack: id, bytes: sticker!.size }))
  })

  router.post('/v1/accounts/me/admin/stickers/packs/:id/order', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const id = packId(req, res)
    if (!id) return
    const body = orderSchema.safeParse(req.body)
    if (!run(res, () => { store.orderStickers(id, body.success ? body.data.ids : undefined) })) return
    res.json({ packs: store.packs() })
    tell(() => options.audit?.(actor, 'stickers.sticker', id, { change: 'order', pack: id }))
  })

  router.delete('/v1/accounts/me/admin/stickers/:stickerId', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const id = String(req.params.stickerId)
    if (!OWNER_STICKER_ID.test(id) || !store.deleteSticker(id)) { res.status(404).json({ error: 'Стикер не найден' }); return }
    res.json({ packs: store.packs() })
    tell(() => options.audit?.(actor, 'stickers.sticker', id, { change: 'delete' }))
  })

  return router
}

/** The bytes of a base64 PNG (a data: URL prefix allowed); 400 for anything that is not base64. */
function decodePng(raw: string) {
  if (raw.length > MAX_BASE64 + 4096) throw new StickerError(400, STICKER_TOO_BIG)
  const data = raw.replace(PNG_DATA_URL, '').replace(/\s+/g, '')
  if (data.length > MAX_BASE64) throw new StickerError(400, STICKER_TOO_BIG)
  if (!data || !BASE64.test(data) || data.length % 4 === 1) throw new StickerError(400, STICKER_BROKEN)
  return Buffer.from(data, 'base64')
}
