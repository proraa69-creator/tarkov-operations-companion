/**
 * Paid game data (docs/subscription-protection.md). Every route here needs:
 *   1. a signed-in session (401 «Требуется вход в аккаунт»),
 *   2. access: owner / streamer / paid period / referral trial (402 «Нужна подписка»),
 *   3. an active device of the account in `X-Raid-Device` (403, code device_inactive / device_revoked); the owner's
 *      own account is exempt (website, scripts),
 * plus per-IP (counted first, before anything else) and per-account rate limits.
 *
 *   POST /v1/data/graphql            {query, variables?} -> tarkov.dev GraphQL answer (services/dataGateway.ts)
 *   GET  /v1/data/json/:mode/:name                       -> json.tarkov.dev dataset (catalog parts, translations)
 *
 * `requireDataAccess` also guards /v1/catalog/* and /v1/players/* (app.ts).
 */
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { GatewayError, type DataGateway } from '../services/dataGateway.js'
import { SUBSCRIPTION_REQUIRED, type EntitlementService } from '../services/entitlement.js'

export const DATA_RATE_LIMITS = { perIp: 240, perAccount: 120 }
export const DEVICE_HEADER = 'x-raid-device'

export function requireDataAccess(accounts: AccountStore, entitlements: EntitlementService, limits: Partial<typeof DATA_RATE_LIMITS> = {}): express.RequestHandler {
  const { perIp, perAccount } = { ...DATA_RATE_LIMITS, ...limits }
  const ipLimiter = new FixedWindowRateLimiter(perIp, 60 * 1000)
  const accountLimiter = new FixedWindowRateLimiter(perAccount, 60 * 1000)
  const tooMany = (res: Response, retry: number) => res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' })
  return (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store')
    const ipRetry = ipLimiter.hit(`data:${req.ip ?? 'unknown'}`)
    if (ipRetry) { tooMany(res, ipRetry); return }
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт', code: 'auth_required' }); return }
    const access = entitlements.access(accountId)
    if (!access) { res.status(402).json({ error: SUBSCRIPTION_REQUIRED, code: 'subscription_required' }); return }
    if (access.plan !== 'owner') {
      const device = req.get(DEVICE_HEADER)
      if (!entitlements.isActiveDevice(accountId, device)) {
        const reason = entitlements.revokedReason(accountId, device)
        res.status(403).json(reason
          ? { error: reason === 'limit' ? 'Это устройство отключено: в аккаунт вошли на другом устройстве (не больше трёх).' : 'Это устройство отключено владельцем аккаунта или сервиса.', code: 'device_revoked' }
          : { error: 'Устройство не активировано. Войдите в аккаунт в приложении заново.', code: 'device_inactive' })
        return
      }
    }
    const accountRetry = accountLimiter.hit(accountId)
    if (accountRetry) { tooMany(res, accountRetry); return }
    res.locals.accountId = accountId
    next()
  }
}

export function createDataRouter(gateway: DataGateway, guard: express.RequestHandler) {
  const router = express.Router()
  router.use(guard)
  const send = (res: Response, body: string) => res.type('application/json').send(body)
  const fail = (res: Response, error: unknown) => {
    if (error instanceof GatewayError) { res.status(error.status).json({ error: error.message }); return true }
    return false
  }
  router.post('/graphql', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body as { query?: unknown; variables?: unknown } : {}
      send(res, await gateway.graphql(body.query, body.variables))
    } catch (error) { if (!fail(res, error)) next(error) }
  })
  router.get('/json/:mode/:name', async (req, res, next) => {
    try {
      send(res, await gateway.json(`${String(req.params.mode)}/${String(req.params.name)}`))
    } catch (error) { if (!fail(res, error)) next(error) }
  })
  return router
}
