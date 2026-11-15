/**
 * «Местоположение тиммейтов» and «Передача зарисовок» (services/squadLive.ts), mounted at `/v1/squad-live`. Every route needs a
 * session, access (subscription, trial, streamer — the squad is a paid feature, routes/squads.ts) and membership of the squad:
 * any other account gets 404 for its id. Nothing is written anywhere; the app sends only what its player turned on.
 *
 *   GET /:squadId/:mode?since=<version>    -> { version, positions: [{ memberId, x, y, z, yaw, at, map? }],
 *                                              sketches: [{ memberId, mapId, strokes, at }] } of the other members, at once when
 *                                              the version differs from `since`, else when a mate publishes or after ~25 s
 *   POST /:squadId/:mode/position          { x, y, z, yaw, at, map? } -> 201 { version }
 *   PUT  /:squadId/:mode/sketch/:mapId     { strokes: [{ zoom, points: [[lat, lng]…], color? }] } -> { version }  (no strokes: off)
 *
 * Own limits (not the squads router's): a position every screenshot and a wait every ~25 s would use up those in minutes.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { hasPaidAccess } from '../services/access.js'
import { SquadError, type SquadStore } from '../services/squadStore.js'
import type { SquadLive } from '../services/squadLive.js'
import { livePositionSchema } from './live.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const squadIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
const mapIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)
const sinceSchema = z.string().regex(/^\d{1,16}$/)
const metres = z.number().finite().min(-100_000).max(100_000)
/** A drawing of one map (src/maps/mapSketch.ts SketchStroke); the colours are the pencil's own. */
export const MAX_SKETCH_POINTS = 20_000
const sketchSchema = z.object({
  strokes: z.array(z.object({
    zoom: z.number().finite().min(-20).max(30),
    points: z.array(z.tuple([metres, metres])).min(1).max(4_000),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }).strict()).max(500),
}).strict().refine((sketch) => sketch.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) <= MAX_SKETCH_POINTS)

export const SQUAD_LIVE_LIMITS = { ip: 1_200, read: 120, position: 60, sketch: 30 }

export function createSquadLiveRouter(accounts: AccountStore, squads: SquadStore, live: SquadLive, options: { now?: () => number; limits?: Partial<typeof SQUAD_LIVE_LIMITS> } = {}) {
  const router = express.Router()
  const limits = { ...SQUAD_LIVE_LIMITS, ...options.limits }
  const minute = (max: number) => new FixedWindowRateLimiter(max, 60_000, options.now)
  const ipLimiter = minute(limits.ip)
  const readLimiter = minute(limits.read)
  const positionLimiter = minute(limits.position)
  const sketchLimiter = minute(limits.sketch)
  const now = options.now ?? Date.now
  const tooMany = (res: Response, retry: number) => { res.status(429).set('Retry-After', String(retry)).json({ error: 'Слишком много запросов. Попробуйте позже.' }) }
  const bad = (res: Response) => { res.status(400).json({ error: 'Некорректные данные запроса' }) }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const ipRetry = ipLimiter.hit(`ip:${req.ip ?? 'unknown'}`)
    if (ipRetry) { tooMany(res, ipRetry); return }
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    if (!hasPaidAccess(accounts, accountId)) { res.status(402).json({ error: 'Отряд доступен с активной подпиской', code: 'subscription_required' }); return }
    res.locals.accountId = accountId
    next()
  })

  /** The squad and mode of the path, for a member of it; else 404 / 400. */
  const place = (req: Request, res: Response) => {
    const squadId = squadIdSchema.safeParse(req.params.squadId)
    const mode = modeSchema.safeParse(req.params.mode)
    if (!squadId.success || !mode.success) { bad(res); return null }
    const accountId = String(res.locals.accountId)
    try {
      return { accountId, squad: squads.memberSquad(accountId, squadId.data), mode: mode.data }
    } catch (error) {
      if (error instanceof SquadError) { res.status(error.status).json({ error: error.message }); return null }
      throw error
    }
  }
  const limited = (res: Response, limiter: FixedWindowRateLimiter, accountId: string) => {
    const retry = limiter.hit(accountId)
    if (retry) tooMany(res, retry)
    return retry > 0
  }

  router.get('/:squadId/:mode', (req, res) => {
    const at = place(req, res)
    if (!at) return
    const since = req.query.since === undefined ? undefined : sinceSchema.safeParse(req.query.since)
    if (since && !since.success) { bad(res); return }
    if (limited(res, readLimiter, at.accountId)) return
    const { accountId, squad, mode } = at
    // Read again when the answer goes: somebody may have left the squad meanwhile.
    const render = () => {
      const current = squads.memberSquad(accountId, squad.id)
      return live.state(squad.id, mode, accountId, current.members)
    }
    live.wait(res, squad.id, mode, since?.data === undefined ? undefined : Number(since.data), render)
  })

  router.post('/:squadId/:mode/position', (req, res) => {
    const at = place(req, res)
    if (!at) return
    const body = livePositionSchema.safeParse(req.body)
    if (!body.success) { bad(res); return }
    if (limited(res, positionLimiter, at.accountId)) return
    // Client clocks drift: a capture time far in the future is clamped to the server time.
    const version = live.setPosition(at.squad.id, at.mode, at.accountId, { ...body.data, at: Math.min(body.data.at, now() + 60_000) })
    if (version === null) { res.status(503).json({ error: 'Сервер занят. Попробуйте позже.' }); return }
    res.status(201).json({ version })
  })

  router.put('/:squadId/:mode/sketch/:mapId', (req, res) => {
    const at = place(req, res)
    if (!at) return
    const mapId = mapIdSchema.safeParse(req.params.mapId)
    const body = sketchSchema.safeParse(req.body)
    if (!mapId.success || !body.success) { bad(res); return }
    if (limited(res, sketchLimiter, at.accountId)) return
    const version = live.setSketch(at.squad.id, at.mode, at.accountId, mapId.data, body.data.strokes)
    if (version === null) { res.status(503).json({ error: 'Сервер занят. Попробуйте позже.' }); return }
    res.json({ version })
  })

  return router
}
