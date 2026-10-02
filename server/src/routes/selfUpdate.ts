/**
 * «Обновление» tab of the owner's admin panel (website/src/components/admin/AdminUpdate.tsx): the state of
 * «Автообновление сервера» on the server laptop and three buttons. The laptop downloads and verifies releases itself
 * (electron/selfUpdate.ts, from a private GitHub repository); nothing is uploaded through the website. Owner session as
 * in routes/ownerAdmin.ts (401 without a session, 404 for everybody else), Bearer token only (no cookies → no CSRF),
 * `Cache-Control: no-store`, per-owner rate limits; every action goes to the audit log.
 *
 *   GET  /v1/accounts/me/admin/update                       -> { available: true, status } | { available: false, reason }
 *   POST /v1/accounts/me/admin/update/check                 -> { available: true, status }   «Проверить сейчас»
 *   POST /v1/accounts/me/admin/update/install { confirm: true }  -> { available: true, status } «Установить сейчас»
 *   POST /v1/accounts/me/admin/update/rollback { confirm: true } -> { available: true, status } «Откатить на предыдущую»
 *
 * «Установить сейчас» installs only the build the laptop itself downloaded and verified (the default install mode is
 * manual: the laptop waits for this button); the request carries no file, build number or URL.
 *
 * The answers come from the owner app's main process over services/ownerApp.ts; run without it (npm run server:dev)
 * `available` is false.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ownerApp, OwnerAppError, type OwnerAppLink } from '../services/ownerApp.js'

export interface SelfUpdateRouterOptions {
  link?: OwnerAppLink
  audit?: (actor: string, action: 'server.update-check' | 'server.update-install' | 'server.rollback', details?: Record<string, unknown>) => void
}

const BASE = '/v1/accounts/me/admin/update'
const confirmSchema = z.object({ confirm: z.literal(true) })

export function createSelfUpdateRouter(accounts: AccountStore, options: SelfUpdateRouterOptions = {}) {
  const router = express.Router()
  const link = () => options.link ?? ownerApp()
  const readLimiter = new FixedWindowRateLimiter(120, 60 * 1000)
  const checkLimiter = new FixedWindowRateLimiter(6, 60 * 1000)
  const installLimiter = new FixedWindowRateLimiter(3, 10 * 60 * 1000)
  const rollbackLimiter = new FixedWindowRateLimiter(3, 10 * 60 * 1000)

  const owner = (limiter: FixedWindowRateLimiter, run: (req: Request, res: Response, actor: string) => Promise<void>) => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    const email = accounts.isOwner(id) ? accounts.emailOf(id) : undefined
    if (!email) { res.status(404).json({ error: 'Не найдено' }); return }
    const retry = limiter.hit(`update:${id}`)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите немного.' }); return }
    const current = link()
    if (!current.available) {
      res.json({ available: false, reason: 'Сервер запущен не из приложения владельца: автообновление работает только на ноутбуке-сервере (Raid OS Server с --server-mode).' })
      return
    }
    try {
      await run(req, res, email)
    } catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Подтвердите действие: { "confirm": true }' }); return }
      res.status(error instanceof OwnerAppError ? 409 : 502).json({ error: error instanceof Error ? error.message : 'Приложение владельца не ответило' })
    }
  }

  router.get(BASE, owner(readLimiter, async (_req, res) => {
    res.json({ available: true, status: await link().request('self-update:status') })
  }))
  router.post(`${BASE}/check`, owner(checkLimiter, async (_req, res, actor) => {
    const status = await link().request('self-update:check', undefined, 20_000)
    options.audit?.(actor, 'server.update-check')
    res.json({ available: true, status })
  }))
  router.post(`${BASE}/install`, owner(installLimiter, async (req, res, actor) => {
    confirmSchema.parse(req.body ?? {})
    const status = await link().request('self-update:install', { confirm: true }, 60_000)
    options.audit?.(actor, 'server.update-install')
    res.json({ available: true, status })
  }))
  router.post(`${BASE}/rollback`, owner(rollbackLimiter, async (req, res, actor) => {
    confirmSchema.parse(req.body ?? {})
    const status = await link().request('self-update:rollback', { confirm: true }, 60_000)
    options.audit?.(actor, 'server.rollback')
    res.json({ available: true, status })
  }))
  return router
}
