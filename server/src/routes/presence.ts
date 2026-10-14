/**
 * «Онлайн сейчас» (services/presence.ts): the apps' heartbeat. Mounted before /v1/me, whose router answers every other
 * path under it.
 *
 *   POST /v1/me/presence   (session + X-Raid-Device) -> 204
 *
 * Sent about once a minute by the PC app and the phone app while their user is signed in (src/sync/presence.ts). The
 * device must be an active device of the account bound to this session; its name tells the PC from the phone. Anything
 * else (no device, the browser preview, a switched-off device) is answered 204 as well and simply not counted. The
 * owner reads the count at GET /v1/accounts/me/admin/online (routes/ownerAdmin.ts). Nothing is written to the database.
 */
import express from 'express'
import { bearer, FixedWindowRateLimiter, tokenDigest, type AccountStore } from '../services/accountStore.js'
import type { EntitlementService } from '../services/entitlement.js'
import { presenceClientOf, type PresenceTracker } from '../services/presence.js'
import { DEVICE_HEADER } from './data.js'

export const PRESENCE_PATH = '/v1/me/presence'
/** Heartbeats per account and minute: an app sends one; a few devices and retries fit easily. */
const PER_ACCOUNT_PER_MINUTE = 12

export function createPresenceRouter(accounts: AccountStore, entitlements: EntitlementService, presence: PresenceTracker) {
  const router = express.Router()
  const limiter = new FixedWindowRateLimiter(PER_ACCOUNT_PER_MINUTE, 60 * 1000)
  router.post(PRESENCE_PATH, (req, res) => {
    res.set('Cache-Control', 'no-store')
    const token = bearer(req.get('authorization'))
    const accountId = accounts.authenticate(token)
    if (!accountId || !token) { res.status(401).json({ error: 'Требуется вход в аккаунт', code: 'auth_required' }); return }
    const retry = limiter.hit(accountId)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
    const name = entitlements.activeDeviceName(accountId, req.get(DEVICE_HEADER), tokenDigest(token))
    const client = name === undefined ? undefined : presenceClientOf(name)
    if (client) presence.note(accountId, client)
    res.status(204).end()
  })
  return router
}
