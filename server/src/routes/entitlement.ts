/**
 * Signed entitlements and devices (services/entitlement.ts, docs/subscription-protection.md). Mounted at /v1.
 *
 *   GET  /v1/entitlement/public-key                     -> { algorithm: 'Ed25519', publicKey, deviceLimit }
 *   POST /v1/entitlement            { deviceId, deviceName? } (session) -> 200 { token, plan, expiresAt, until?, revokedDevices }
 *                                                          402 { error: 'Нужна подписка', code, subscription } (device still registered)
 *   GET  /v1/accounts/me/devices                        -> { devices, limit } (the signed-in user's own devices)
 *   GET  /v1/accounts/me/admin/users/:id/devices        -> { devices, limit }           (owner only, 404 for others)
 *   POST /v1/accounts/me/admin/users/:id/devices/:deviceId/revoke -> { devices, limit } (owner only, audited)
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { AccountError, bearer, FixedWindowRateLimiter, tokenDigest, type AccountStore } from '../services/accountStore.js'
import type { AdminStore } from '../services/adminStore.js'
import { SUBSCRIPTION_REQUIRED, type EntitlementService } from '../services/entitlement.js'
import { DEVICE_ID } from '../../../src/shared/entitlementToken'

const issueSchema = z.object({ deviceId: z.string().regex(DEVICE_ID), deviceName: z.string().max(200).optional() })
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)

export function createEntitlementRouter(accounts: AccountStore, entitlements: EntitlementService, admin?: AdminStore) {
  const router = express.Router()
  const issueLimiter = new FixedWindowRateLimiter(240, 60 * 60 * 1000)
  const ownerLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  router.get('/entitlement/public-key', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300')
    res.json({ algorithm: 'Ed25519', publicKey: entitlements.publicKey, deviceLimit: entitlements.deviceLimit })
  })

  const session = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const token = bearer(req.get('authorization'))
    const accountId = accounts.authenticate(token)
    if (!accountId || !token) { res.status(401).json({ error: 'Требуется вход в аккаунт', code: 'auth_required' }); return undefined }
    return { accountId, token }
  }

  router.post('/entitlement', (req, res) => {
    const signedIn = session(req, res)
    if (!signedIn) return
    const retry = issueLimiter.hit(signedIn.accountId)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
    const parsed = issueSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Некорректный идентификатор устройства' }); return }
    let revoked
    try {
      revoked = entitlements.registerDevice(signedIn.accountId, parsed.data.deviceId, parsed.data.deviceName ?? '', tokenDigest(signedIn.token)).revoked
    } catch (error) {
      if (error instanceof AccountError) {
        const after = (error as { retryAfter?: unknown }).retryAfter
        if (typeof after === 'number') res.set('Retry-After', String(after))
        res.status(error.status).json({ error: error.message }); return
      }
      throw error
    }
    const revokedDevices = revoked.map((device) => ({ name: device.name, lastSeenAt: device.lastSeenAt }))
    const issued = entitlements.issue(signedIn.accountId, parsed.data.deviceId)
    if (!issued) {
      res.status(402).json({ error: SUBSCRIPTION_REQUIRED, code: 'subscription_required', subscription: accounts.view(signedIn.accountId).subscription, revokedDevices })
      return
    }
    const { claims, token } = issued
    res.json({ token, plan: claims.plan, expiresAt: new Date(claims.exp).toISOString(), ...(claims.until ? { until: new Date(claims.until).toISOString() } : {}), revokedDevices, deviceLimit: entitlements.deviceLimit })
  })

  router.get('/accounts/me/devices', (req, res) => {
    const signedIn = session(req, res)
    if (!signedIn) return
    res.json({ devices: entitlements.devices(signedIn.accountId), limit: entitlements.deviceLimit })
  })

  /** Owner only; everybody else gets 404 (as the rest of the admin panel, routes/ownerAdmin.ts). */
  const owner = (run: (req: Request, res: Response, actor: string) => void) => (req: Request, res: Response) => {
    const signedIn = session(req, res)
    if (!signedIn) return
    if (!accounts.isOwner(signedIn.accountId)) { res.status(404).json({ error: 'Не найдено' }); return }
    const retry = ownerLimiter.hit(signedIn.accountId)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return }
    const target = idSchema.safeParse(req.params.id)
    if (!target.success) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
    run(req, res, accounts.emailOf(signedIn.accountId) ?? 'owner')
  }
  const list = (res: Response, id: string) => res.json({ devices: entitlements.devices(id), limit: entitlements.deviceLimit })

  router.get('/accounts/me/admin/users/:id/devices', owner((req, res) => list(res, String(req.params.id))))
  router.post('/accounts/me/admin/users/:id/devices/:deviceId/revoke', owner((req, res, actor) => {
    const id = String(req.params.id)
    const deviceId = String(req.params.deviceId)
    if (!DEVICE_ID.test(deviceId)) { res.status(400).json({ error: 'Некорректный идентификатор устройства' }); return }
    const device = entitlements.device(id, deviceId)
    if (!device) { res.status(404).json({ error: 'Устройство не найдено' }); return }
    if (entitlements.revoke(id, deviceId, 'owner')) {
      try { admin?.audit(actor, 'device.revoke', accounts.emailOf(id) ?? id, { device: device.name }) } catch { /* the revoke itself succeeded */ }
    }
    list(res, id)
  }))

  return router
}
