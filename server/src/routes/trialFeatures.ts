/**
 * «Поиск квестов по экрану» for one player, from «Админ панель» → «Функции» (owner, 01.11.2026: «функцию которая будет в
 * реальном времени включать поиск квестов по сканированию экрана для конкретного пользователя, например ввожу его почту
 * и нажимаю включить поиск по экрану на сутки»), services/trialFeatures.ts:
 *
 *   GET /v1/accounts/me/admin/trial-features                       -> { grants: [{ email, feature, until, grantedBy, grantedAt }] }
 *   PUT /v1/accounts/me/admin/trial-features { email, feature, hours } -> { grant } (hours 1–720; 0 turns it off now)
 *                                                                     404 { error } when no account has that e-mail
 *
 * The owner only (404 for everybody else, like the other admin paths). The player's apps hear it at once: the account's
 * social events move (services/socialSignals.ts) and the app asks GET /v1/me/features again.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { SocialSignals } from '../services/socialSignals.js'
import type { TrialFeatureStore } from '../services/trialFeatures.js'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  feature: z.literal('questTableScan'),
  hours: z.number().int().min(0).max(720),
})

export type TrialFeatureAudit = (actor: string, action: 'features.trial', target: string, details: Record<string, unknown>) => void

export function createTrialFeaturesRouter(accounts: AccountStore, store: TrialFeatureStore, options: { social?: SocialSignals; audit?: TrialFeatureAudit } = {}) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

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

  const view = (grant: ReturnType<TrialFeatureStore['set']>) => ({ email: grant.email, feature: grant.feature, until: grant.until, grantedBy: grant.grantedBy, grantedAt: grant.grantedAt })

  router.get('/v1/accounts/me/admin/trial-features', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ grants: store.active().map(view) })
  })

  router.put('/v1/accounts/me/admin/trial-features', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = bodySchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Укажите e-mail игрока' }); return }
    const account = accounts.accountByEmail(body.data.email)
    if (!account) { res.status(404).json({ error: 'Аккаунт с таким e-mail не найден' }); return }
    const saved = store.set(account.id, body.data.email, body.data.feature, body.data.hours, actor)
    options.social?.changed([account.id])
    try { options.audit?.(actor, 'features.trial', body.data.email, { feature: saved.feature, hours: body.data.hours, until: saved.until }) } catch { /* saved anyway */ }
    res.json({ grant: view(saved) })
  })

  return router
}
