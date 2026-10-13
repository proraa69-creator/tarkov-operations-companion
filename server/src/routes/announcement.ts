/**
 * The owner's notice over every app (services/announcementStore.ts):
 *
 *   GET /v1/announcement                  -> { version, announcement } at once (public: the locked app shows it too)
 *   GET /v1/announcement?since=<version>  -> the same as soon as the notice changes, or after ~25 s (the app asks again)
 *   GET /v1/accounts/me/admin/announcement -> { announcement } (owner: with the hidden text, to edit it)
 *   PUT /v1/accounts/me/admin/announcement { text, active } -> { announcement }
 *
 * The waiting is routes/mapUpdates.ts's (long polling through the desktop app's gateway); every saved change wakes every
 * waiting app at once. Owner routes as the quest texts (routes/questTexts.ts): 401 without a session, 404 for everybody but
 * the owner; changes go to the audit log as `announcement.set`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ANNOUNCEMENT_MAX_LENGTH, type AnnouncementStore } from '../services/announcementStore.js'
import type { MapUpdates } from './mapUpdates.js'

// One paragraph or a few lines; no other control characters reach a player's screen.
const printable = (value: string) => [...value.replace(/\r\n?/g, '\n')].filter((char) => {
  const code = char.charCodeAt(0)
  return code === 10 || (code >= 32 && code !== 127)
}).join('')
const bodySchema = z.object({
  text: z.string().transform((value) => printable(value).trim()).pipe(z.string().max(ANNOUNCEMENT_MAX_LENGTH)),
  active: z.boolean(),
}).refine((value) => !value.active || value.text.length > 0)
const querySchema = z.object({ since: z.string().regex(/^\d{1,16}$/).optional() })

export type AnnouncementAudit = (actor: string, action: 'announcement.set', target: string, details: Record<string, unknown>) => void

export function createAnnouncementRouter(accounts: AccountStore, store: AnnouncementStore, signals: MapUpdates, audit?: AnnouncementAudit) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  router.get('/v1/announcement', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const query = querySchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    signals.wait(res, req.ip ?? req.socket.remoteAddress ?? 'unknown', query.data.since === undefined ? undefined : Number(query.data.since))
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

  router.get('/v1/accounts/me/admin/announcement', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ announcement: store.current() })
  })

  router.put('/v1/accounts/me/admin/announcement', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = bodySchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: `Текст уведомления: не пустой, до ${ANNOUNCEMENT_MAX_LENGTH} символов` }); return }
    const saved = store.save(body.data.text, body.data.active, actor)
    signals.changed()
    try { audit?.(actor, 'announcement.set', 'announcement', { active: saved.active, length: saved.text.length }) } catch { /* saved anyway */ }
    res.json({ announcement: saved })
  })

  return router
}
