/**
 * Quest map points corrected by the owner (services/questPointStore.ts).
 *
 *   GET  /v1/quest-points                                     -> { overrides } (public: every player's map uses them;
 *                                                                without the author and the note)
 *   GET  /v1/accounts/me/admin/quest-points                   -> { overrides } (owner: with author and note)
 *   PUT  /v1/accounts/me/admin/quest-points  { id?, questId?, markerId?, objectiveId?, stageIndex?, mapId, x, z, floor?,
 *                                               kind: 'move' | 'add' | 'hide' | 'describe', title?, titleEn?, description?,
 *                                               descriptionEn?, icon?, itemIds?, photoIds?, note? } -> { override, overrides }
 *   POST /v1/accounts/me/admin/quest-points/:id/remove        -> { overrides } («Вернуть исходную точку»)
 *
 * Owner routes need the session of an account listed in TARKOV_OWNER_EMAILS: 401 without a session, 404 for everybody
 * else (like the boss placements, routes/mapBosses.ts). Writes go to the owner's audit log as `map.quest-point`.
 * Removal is a POST like the boss placements: the desktop app's service gateway forwards GET / POST / PUT only.
 *
 * A point's description «где и что искать» (`title` up to 80, `description` up to 500 characters, RU and optionally EN)
 * is for every player and is in the public list; `describe` gives an original point a description without moving it.
 * Older apps skip a `describe` entry and the unknown fields (src/data/questPointOverrides.ts parses known kinds only).
 *
 * The point constructor (owner, 16.10.2026): a point may also carry `icon` (an emblem of the map's marker layers,
 * src/shared/questPointConstructor.ts), `itemIds` (catalog items, at most 6) and `photoIds` (at most 4 stored photos).
 * A `describe` may carry only an emblem or the objective / stage the original point counts for (the constructor's
 * «Цель / этап»). An added point may have no `questId` (a «free» point: an extract, a transit, loot…): it then needs an emblem other than
 * a quest's; the answers leave its `questId` out, so older apps (which need one) skip it.
 *
 *   POST /v1/accounts/me/admin/quest-point-photos { data: base64 } -> 201 { photo: { id, mime, size, width, height } }
 *        (owner): one photo, PNG / JPEG / WEBP by its first bytes, ≤ 5 MB, a readable header; 413 / 400 / 507 (storage
 *        full); 60 an hour; audit `map.quest-point-photo`. Mounted before the global 1 MB JSON parser
 *        (createQuestPointPhotoUploadRouter): the session is checked before the body is read.
 *   GET  /v1/me/quest-point-photos/:id -> { mime, data: base64, width, height } (any signed-in account: 401 without a
 *        session): a photo some point shows (the owner also reads the ones not saved on a point yet); 404 otherwise.
 *        JSON like the support chat's screenshots: the apps' gateways forward JSON only.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { QuestPointStore, type QuestPointOverride } from '../services/questPointStore.js'
import { QuestPointPhotoError, type QuestPointPhotoStore } from '../services/questPointPhotoStore.js'
import { optionalLine, optionalText } from './ownerText.js'
import { isQuestIcon, QUEST_POINT_ICONS, QUEST_POINT_ITEM_ID, QUEST_POINT_ITEMS_MAX, QUEST_POINT_PHOTO_ID, QUEST_POINT_PHOTO_LIMITS } from '../../../src/shared/questPointConstructor.js'

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
const ident = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,200}$/)
/** Game metres; the largest maps are well within ±2000. */
const metres = z.number().finite().min(-5000).max(5000)
export const QUEST_POINT_TITLE_MAX = 80
export const QUEST_POINT_DESCRIPTION_MAX = 500
const overrideSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  questId: ident.optional(),
  markerId: ident.optional(),
  objectiveId: ident.optional(),
  stageIndex: z.number().int().min(0).max(200).optional(),
  mapId: slug,
  x: metres,
  z: metres,
  floor: z.string().trim().min(1).max(40).optional(),
  kind: z.enum(['move', 'add', 'hide', 'describe']),
  title: optionalLine(QUEST_POINT_TITLE_MAX),
  titleEn: optionalLine(QUEST_POINT_TITLE_MAX),
  description: optionalText(QUEST_POINT_DESCRIPTION_MAX),
  descriptionEn: optionalText(QUEST_POINT_DESCRIPTION_MAX),
  icon: z.enum(QUEST_POINT_ICONS).optional(),
  itemIds: z.array(z.string().regex(QUEST_POINT_ITEM_ID)).max(QUEST_POINT_ITEMS_MAX).optional().transform((ids) => (ids?.length ? [...new Set(ids)] : undefined)),
  photoIds: z.array(z.string().regex(QUEST_POINT_PHOTO_ID)).max(QUEST_POINT_PHOTO_LIMITS.perPoint).optional().transform((ids) => (ids?.length ? [...new Set(ids)] : undefined)),
  note: z.string().trim().max(300).optional().transform((value) => value || undefined),
})
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)

export type QuestPointAudit = (actor: string, action: 'map.quest-point' | 'map.quest-point-photo', target: string, details: Record<string, unknown>) => void

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const DATA_URL_PREFIX = /^data:image\/(?:png|jpeg|webp);base64,/
/** Base64 of 5 MB is ~6.7 MB. */
export const QUEST_POINT_PHOTO_BODY_LIMIT = '8mb'
const uploadSchema = z.object({ data: z.string().min(1).max(Math.ceil(QUEST_POINT_PHOTO_LIMITS.fileBytes / 3) * 4 + 64) })

/** The owner's e-mail (signed in, an owner account, within `limiter`), or an answer was already sent. */
function ownerOf(accounts: AccountStore, limiter: FixedWindowRateLimiter | undefined, req: Request, res: Response) {
  res.set('Cache-Control', 'no-store')
  const id = accounts.authenticate(bearer(req.get('authorization')))
  if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
  if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
  const retry = limiter?.hit(id)
  if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
  return accounts.emailOf(id) ?? id
}

/**
 * The photo upload of a point, with its own body limit: mount it before the global JSON parser (app.ts). Nobody but the
 * owner makes the server read a large body.
 */
export function createQuestPointPhotoUploadRouter(accounts: AccountStore, photos: QuestPointPhotoStore | undefined, audit?: QuestPointAudit, options: { perHour?: number; now?: () => number } = {}) {
  const router = express.Router()
  const limiter = new FixedWindowRateLimiter(options.perHour ?? 60, 60 * 60 * 1000, options.now)
  const path = '/v1/accounts/me/admin/quest-point-photos'
  router.post(path, (req, res, next) => {
    const actor = ownerOf(accounts, limiter, req, res)
    if (!actor) { req.resume(); return }
    if (!photos) { req.resume(); res.status(503).json({ error: 'Фото точек на этом сервере не хранятся' }); return }
    res.locals.actor = actor
    next()
  }, express.json({ limit: QUEST_POINT_PHOTO_BODY_LIMIT }), (req, res) => {
    const actor = String(res.locals.actor)
    const body = uploadSchema.safeParse(req.body)
    const data = body.success ? body.data.data.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '') : ''
    if (!body.success || !BASE64.test(data) || data.length % 4 === 1) { res.status(400).json({ error: 'Повреждённый файл фото' }); return }
    try {
      const photo = photos!.upload(actor, Buffer.from(data, 'base64'))
      try { audit?.(actor, 'map.quest-point-photo', photo.id, { op: 'upload', mime: photo.mime, size: photo.size, width: photo.width, height: photo.height }) } catch { /* stored anyway */ }
      res.status(201).json({ photo })
    } catch (error) {
      if (!(error instanceof QuestPointPhotoError)) throw error
      res.status(error.status).json({ error: error.message })
    }
  })
  // A body over the limit: one clear answer instead of the generic one.
  router.use(path, (error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'Фото больше 5 МБ' }); return }
    next(error)
  })
  return router
}

/** What every player gets: no author e-mail, no owner's note. */
function publicView(entry: QuestPointOverride): Omit<QuestPointOverride, 'updatedBy' | 'note'> {
  const view: Partial<QuestPointOverride> = { ...entry }
  delete view.updatedBy
  delete view.note
  return view as Omit<QuestPointOverride, 'updatedBy' | 'note'>
}

/** `changed`: told after every saved write, so every running app re-reads the corrections at once (routes/mapUpdates.ts). */
export function createQuestPointsRouter(accounts: AccountStore, store: QuestPointStore, audit?: QuestPointAudit, changed?: () => void, photos?: QuestPointPhotoStore) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(120, 60 * 1000)
  // A point's photos load one by one as it is shown.
  const photoLimiter = new FixedWindowRateLimiter(300, 60 * 1000)

  router.get('/v1/quest-points', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ overrides: store.list().map(publicView) })
  })

  /** The owner's e-mail, or an answer was already sent. */
  const owner = (req: Request, res: Response, write: boolean) => ownerOf(accounts, write ? writeLimiter : undefined, req, res)

  router.get('/v1/me/quest-point-photos/:id', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    const retry = photoLimiter.hit(accountId)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return }
    const id = String(req.params.id)
    // Players see the photos of saved points; the owner also the ones just uploaded for a point being edited.
    const shown = QUEST_POINT_PHOTO_ID.test(id) && (store.photoIds().has(id) || accounts.isOwner(accountId))
    const photo = shown ? photos?.photo(id) : undefined
    if (!photo) { res.status(404).json({ error: 'Фото не найдено' }); return }
    res.json({ mime: photo.mime, data: photo.data.toString('base64'), width: photo.width, height: photo.height })
  })

  router.get('/v1/accounts/me/admin/quest-points', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ overrides: store.list() })
  })

  router.put('/v1/accounts/me/admin/quest-points', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = overrideSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: `Некорректные данные точки (заголовок до ${QUEST_POINT_TITLE_MAX}, описание до ${QUEST_POINT_DESCRIPTION_MAX} символов)` }); return }
    const { id, ...input } = body.data
    // A «describe» says something: a text, items, photos, an emblem or the objective / stage the point counts for.
    if (input.kind === 'describe' && !input.title && !input.description && !input.titleEn && !input.descriptionEn && !input.itemIds && !input.photoIds
      && !input.icon && !input.objectiveId && input.stageIndex == null) { res.status(400).json({ error: 'Пустое описание точки' }); return }
    // A free point (no quest): only an added one, with an emblem that is not a quest's.
    if (!input.questId && (input.kind !== 'add' || !input.icon || isQuestIcon(input.icon))) { res.status(400).json({ error: 'Выберите квест или другой значок точки' }); return }
    if (input.photoIds?.some((photoId) => !photos?.has(photoId))) { res.status(400).json({ error: 'Фото не найдено: загрузите его снова' }); return }
    const saved = store.save(input, actor, id)
    if (saved === 'invalid') { res.status(400).json({ error: 'Не указана исходная точка' }); return }
    if (saved === 'missing') { res.status(404).json({ error: 'Правка не найдена' }); return }
    if (saved === 'full') { res.status(409).json({ error: 'Слишком много правок точек. Удалите лишние.' }); return }
    changed?.()
    try {
      audit?.(actor, 'map.quest-point', saved.id, {
        op: saved.kind, ...(saved.questId ? { quest: saved.questId } : {}), mapId: saved.mapId, x: Math.round(saved.x), z: Math.round(saved.z),
        ...(saved.icon ? { icon: saved.icon } : {}), ...(saved.itemIds ? { items: saved.itemIds.length } : {}), ...(saved.photoIds ? { photos: saved.photoIds.length } : {}),
        ...(saved.markerId ? { marker: saved.markerId } : {}), ...(saved.note ? { note: saved.note } : {}),
        ...(saved.description || saved.title ? { described: (saved.title ?? '').length + (saved.description ?? '').length } : {}),
        ...(saved.descriptionEn || saved.titleEn ? { describedEn: (saved.titleEn ?? '').length + (saved.descriptionEn ?? '').length } : {}),
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
    try { audit?.(actor, 'map.quest-point', removed.id, { op: 'reset', was: removed.kind, ...(removed.questId ? { quest: removed.questId } : {}), mapId: removed.mapId, ...(removed.markerId ? { marker: removed.markerId } : {}) }) } catch { /* removed anyway */ }
    res.json({ overrides: store.list() })
  })

  return router
}
