/**
 * «Моментально в телефоне» (owner, 15.10.2026): the PC app's position and recognised item reach the phone of the same
 * account at once (services/liveRelay.ts). Every route needs what the game data needs (routes/data.ts
 * requireDataAccess): a session, access (subscription, trial, streamer or owner) and this device's id; each account
 * reaches only its own values. Nothing is stored: the latest value per account and mode, in memory, for a few minutes.
 *
 *   GET  /v1/live/:mode?since=<version> -> { version, position | null, item | null } at once when the version differs
 *                                          from `since` (or `since` is left out), else when the PC publishes something
 *                                          or after ~25 s with the same version
 *   POST /v1/live/:mode/position        { x, y, z, yaw, at, map? } -> 201 { version }
 *   POST /v1/live/:mode/item            { item card, at } -> 201 { version }
 *
 * PvP, PvE and Season are separate: the PC publishes to the mode it is on, the phone listens to the mode it shows.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { FixedWindowRateLimiter } from '../services/accountStore.js'
import type { LiveRelay } from '../services/liveRelay.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const coordinate = z.number().finite().min(-100_000).max(100_000)
export const livePositionSchema = z.object({
  x: coordinate, y: coordinate, z: coordinate,
  yaw: z.number().finite().min(-3600).max(3600),
  at: z.number().int().positive(),
  map: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
}).strict()
const price = z.number().finite().min(0).max(10_000_000_000)
const text = (max: number) => z.string().max(max)
const liveItemSchema = z.object({
  itemId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: text(200).min(1),
  shortName: text(80).optional(),
  // A picture the phone draws: an http(s) address only, never a data: or javascript: one.
  iconUrl: z.string().max(600).regex(/^https?:\/\/[^\s"'<>]+$/).optional(),
  weaponPreset: z.boolean().optional(),
  fleaPrice: price.optional(),
  fleaAverage: z.boolean().optional(),
  bestTrader: z.object({ name: text(60), price }).strict().optional(),
  quests: z.array(z.object({
    questId: text(80), name: text(200), trader: text(60), count: z.number().int().min(0).max(100_000), kappa: z.boolean(), purpose: text(40),
  }).strict()).max(20),
  kappa: z.boolean(),
  collector: z.boolean(),
  mate: z.boolean().optional(),
  mateNames: z.array(text(40)).max(10).optional(),
  at: z.number().int().positive(),
}).strict()
const sinceSchema = z.string().regex(/^\d{1,16}$/)

/** Publishes per account and minute, each kind on its own: a position every 2 s and items now and then fit easily. */
export const LIVE_PUBLISH_LIMITS = { position: 60, item: 40 }

export function createLiveRouter(relay: LiveRelay, guard: express.RequestHandler, options: { now?: () => number; limits?: Partial<typeof LIVE_PUBLISH_LIMITS> } = {}) {
  const router = express.Router()
  const limits = { ...LIVE_PUBLISH_LIMITS, ...options.limits }
  const positionLimiter = new FixedWindowRateLimiter(limits.position, 60_000, options.now)
  const itemLimiter = new FixedWindowRateLimiter(limits.item, 60_000, options.now)
  const now = options.now ?? Date.now
  router.use(guard)
  const bad = (res: Response) => { res.status(400).json({ error: 'Некорректные данные запроса' }) }
  const account = (res: Response) => String(res.locals.accountId)
  const limited = (res: Response, limiter: FixedWindowRateLimiter) => {
    const retry = limiter.hit(account(res))
    if (retry) res.status(429).set('Retry-After', String(retry)).json({ error: 'Слишком много запросов. Попробуйте позже.' })
    return retry > 0
  }
  // Client clocks drift: a capture time far in the future is clamped to the server time.
  const clamp = (at: number) => Math.min(at, now() + 60_000)

  router.get('/:mode', (req: Request, res: Response) => {
    const mode = modeSchema.safeParse(req.params.mode)
    const since = req.query.since === undefined ? undefined : sinceSchema.safeParse(req.query.since)
    if (!mode.success || (since && !since.success)) { bad(res); return }
    relay.wait(res, account(res), mode.data, since?.data === undefined ? undefined : Number(since.data))
  })

  router.post('/:mode/position', (req: Request, res: Response) => {
    const mode = modeSchema.safeParse(req.params.mode)
    const body = livePositionSchema.safeParse(req.body)
    if (!mode.success || !body.success) { bad(res); return }
    if (limited(res, positionLimiter)) return
    const version = relay.setPosition(account(res), mode.data, { ...body.data, at: clamp(body.data.at) })
    if (version === null) { res.status(503).json({ error: 'Сервер занят. Попробуйте позже.' }); return }
    res.status(201).json({ version })
  })

  router.post('/:mode/item', (req: Request, res: Response) => {
    const mode = modeSchema.safeParse(req.params.mode)
    const body = liveItemSchema.safeParse(req.body)
    if (!mode.success || !body.success) { bad(res); return }
    if (limited(res, itemLimiter)) return
    const version = relay.setItem(account(res), mode.data, { ...body.data, at: clamp(body.data.at) })
    if (version === null) { res.status(503).json({ error: 'Сервер занят. Попробуйте позже.' }); return }
    res.status(201).json({ version })
  })

  return router
}
