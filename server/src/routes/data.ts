/**
 * Paid game data (docs/subscription-protection.md). Every route here needs:
 *   1. a signed-in session (401 «Требуется вход в аккаунт»),
 *   2. access: owner / streamer / paid period / referral trial (402 «Нужна подписка»),
 *   3. an active device of the account in `X-Raid-Device`, bound to this very session (403, code device_inactive /
 *      device_revoked); the owner's own account is exempt (website, scripts). Website sessions register no device, so
 *      for everybody but the owner they get 403 device_inactive here, as before,
 *   4. a device whose game account fits «one game account — one Raid OS account» (403, code eft_conflict;
 *      AccountStore.eftBlock, owner 13.10.2026) — a paying account whose game account another account holds is let in,
 *      without its free days, while the owner decides (owner 27.11.2026),
 * plus per-IP (counted first, before anything else) and per-account rate limits.
 *
 *   POST /v1/data/graphql            {query, variables?} -> tarkov.dev GraphQL answer (services/dataGateway.ts)
 *   GET  /v1/data/json/:mode/:name                       -> json.tarkov.dev dataset (catalog parts, translations)
 *   GET  /v1/data/prices/:mode                           -> the minute prices, the players' accepted ones over them
 *   POST /v1/data/prices/:mode/sightings {sightings}     -> flea prices a player's app read on the screen
 *                                                           (services/playerPrices.ts, docs/flea-prices-from-players.md)
 *
 * `requireDataAccess` also guards /v1/catalog/*, /v1/players/*, /v1/live and our own content with the account's synced data
 * (src/shared/paidContent.ts, app.ts).
 */
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { bearer, eftConflictBody, FixedWindowRateLimiter, tokenDigest, type AccountStore } from '../services/accountStore.js'
import { GatewayError, type DataGateway } from '../services/dataGateway.js'
import { SUBSCRIPTION_REQUIRED, type EntitlementService } from '../services/entitlement.js'
import type { MirrorStorage } from '../services/mirrorStorage.js'
import type { PriceHistoryMirror } from '../services/priceHistoryMirror.js'
import { layPlayerPrices, priceReferences, type PlayerPriceReference, type PlayerPrices } from '../services/playerPrices.js'
import type { MirrorMode } from '../services/tarkovDataMirror.js'

export const DATA_RATE_LIMITS = { perIp: 240, perAccount: 120 }
/**
 * The same check over our own content and the account's synced data (src/shared/paidContent.ts, app.ts): every app syncs
 * a few lists each 30 s and a map loads its points' photos one by one, so the limits are wider than the game data's.
 */
export const CONTENT_RATE_LIMITS = { perIp: 1200, perAccount: 600 }
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
    const token = bearer(req.get('authorization'))
    const accountId = accounts.authenticate(token)
    if (!accountId || !token) { res.status(401).json({ error: 'Требуется вход в аккаунт', code: 'auth_required' }); return }
    const access = entitlements.access(accountId, req.get(DEVICE_HEADER))
    if (!access) { res.status(402).json({ error: SUBSCRIPTION_REQUIRED, code: 'subscription_required' }); return }
    if (access.plan !== 'owner') {
      const device = req.get(DEVICE_HEADER)
      // The device must be the one this session registered (POST /v1/entitlement), not just any active device id.
      if (!entitlements.isActiveDevice(accountId, device, tokenDigest(token))) {
        const reason = entitlements.revokedReason(accountId, device)
        res.status(403).json(reason
          ? { error: reason === 'limit' ? 'Это устройство отключено: в аккаунт вошли на другом устройстве (не больше трёх).' : 'Это устройство отключено владельцем аккаунта или сервиса.', code: 'device_revoked' }
          : { error: 'Устройство не активировано. Войдите в аккаунт в приложении заново.', code: 'device_inactive' })
        return
      }
      const eft = accounts.eftBlock(accountId, device)
      if (eft) { res.status(403).json(eftConflictBody(eft)); return }
    }
    const accountRetry = accountLimiter.hit(accountId)
    if (accountRetry) { tooMany(res, accountRetry); return }
    res.locals.accountId = accountId
    next()
  }
}

const PRICE_MODES: Record<string, MirrorMode> = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season', regular: 'regular', 'pvp-season': 'pvp-season' }

export function createDataRouter(gateway: DataGateway, guard: express.RequestHandler, mirror?: MirrorStorage, priceHistory?: PriceHistoryMirror, players?: PlayerPrices) {
  const router = express.Router()
  router.use(guard)
  /**
   * The mirror's prices file of a mode as read last, its references for the players' prices, and the answer with those
   * laid over it: made again when the file changed, a player's price was accepted, or one expired.
   */
  const rendered = new Map<MirrorMode, { raw: Buffer; references?: Map<string, PlayerPriceReference>; laid: string; body: string }>()
  const pricesOf = async (mode: MirrorMode) => {
    const raw = await mirror?.read(`prices-${mode}`, 'prices.json')
    if (!raw) return null
    let entry = rendered.get(mode)
    if (!entry || !entry.raw.equals(raw)) {
      entry = { raw, laid: '', body: '' }
      rendered.set(mode, entry)
    }
    return entry
  }
  const send = (res: Response, body: string) => res.type('application/json').send(body)
  const fail = (res: Response, error: unknown) => {
    if (error instanceof GatewayError) {
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
      res.status(error.status).json({ error: error.message })
      return true
    }
    return false
  }
  router.post('/graphql', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body as { query?: unknown; variables?: unknown } : {}
      send(res, await gateway.graphql(body.query, body.variables, { accountId: String(res.locals.accountId) }))
    } catch (error) { if (!fail(res, error)) next(error) }
  })
  router.get('/json/:mode/:name', async (req, res, next) => {
    try {
      send(res, await gateway.json(`${String(req.params.mode)}/${String(req.params.name)}`, { accountId: String(res.locals.accountId) }))
    } catch (error) { if (!fail(res, error)) next(error) }
  })
  router.get('/prices/:mode', async (req, res, next) => {
    try {
      const mode = PRICE_MODES[String(req.params.mode)]
      if (!mode) { res.status(404).json({ error: 'Неизвестный режим' }); return }
      const entry = await pricesOf(mode)
      if (!entry) { res.status(503).json({ error: 'Цены ещё загружаются' }); return }
      if (!players) { send(res, entry.raw.toString('utf8')); return }
      const standing = players.prices(mode)
      const laid = `${players.revision}:${standing.size}`
      if (entry.laid !== laid) {
        entry.body = layPlayerPrices(entry.raw.toString('utf8'), standing)
        entry.laid = laid
      }
      send(res, entry.body)
    } catch (error) { next(error) }
  })
  // The prices a player's app read on the flea (src/data/screenFleaPrices.ts): judged against this mode's file.
  router.post('/prices/:mode/sightings', async (req, res, next) => {
    try {
      const mode = PRICE_MODES[String(req.params.mode)]
      if (!mode) { res.status(404).json({ error: 'Неизвестный режим' }); return }
      if (!players) { res.status(503).json({ error: 'Цены игроков не принимаются' }); return }
      const entry = await pricesOf(mode)
      if (!entry) { res.status(503).json({ error: 'Цены ещё загружаются' }); return }
      entry.references ??= priceReferences(entry.raw.toString('utf8'))
      const references = entry.references
      const body = req.body && typeof req.body === 'object' ? req.body as { sightings?: unknown } : {}
      res.json(players.submit(String(res.locals.accountId), mode, body.sightings, (itemId) => references.get(itemId)))
    } catch (error) { next(error) }
  })
  // «Торговля»: the statistics built a few times a day (services/tradingStats.ts), the same bytes for everyone.
  router.get('/trading/:mode', async (req, res, next) => {
    try {
      const modes: Record<string, string> = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season' }
      const mode = modes[String(req.params.mode)]
      if (!mode) { res.status(404).json({ error: 'Неизвестный режим' }); return }
      const body = await mirror?.read(`trading-${mode}`, 'trading.json')
      if (!body) { res.status(503).json({ error: 'Статистика ещё собирается' }); return }
      send(res, body.toString('utf8'))
    } catch (error) { next(error) }
  })
  router.get('/price-history/:mode/:itemId', async (req, res, next) => {
    try {
      const modes = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season', regular: 'regular', 'pvp-season': 'pvp-season' } as const
      const mode = modes[String(req.params.mode) as keyof typeof modes]
      if (!mode || !priceHistory) { res.status(mode ? 503 : 404).json({ error: mode ? 'История цен ещё не настроена' : 'Неизвестный режим' }); return }
      const days = Number(req.query.days ?? 30)
      if (!Number.isFinite(days)) { res.status(400).json({ error: 'Некорректный период' }); return }
      res.json(await priceHistory.request(mode, String(req.params.itemId), days))
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid-item') { res.status(400).json({ error: 'Некорректный предмет' }); return }
      next(error)
    }
  })
  return router
}
