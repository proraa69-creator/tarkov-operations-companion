/**
 * «Отряд» (squad) API, mounted at `/v1/squads`. Every route needs `Authorization: Bearer <session token>`; the account
 * is taken only from the session. A squad is visible only to its members: any other account gets 404 for its id.
 * Members see each other only by the Tarkov nickname of the requested mode — never by e-mail or account id.
 *
 *   GET  /mine/:mode                    -> { squad | null, access }
 *   POST /                              { name? } -> { squad }                 (subscription / trial / streamer)
 *   POST /join                          { code } -> { squad }                  (subscription / trial / streamer)
 *   GET  /:id/overview/:mode            -> members' active quests + shared quests, maps, items (subscription)
 *   POST /:id/invites                   -> { code, expiresAt }                  (commander, subscription)
 *   POST /:id/leave | /:id/disband      -> 204                                  (always allowed)
 *   POST /:id/kick                      { memberId } -> 204                     (commander)
 *
 * The squad is a paid feature (docs/product-roadmap-and-business-model.md: without an active subscription paid
 * functionality is unavailable): creating, joining, inviting and the overview need an active subscription, the referral
 * trial or a streamer account. Viewing the member list, leaving, kicking and disbanding always work.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { RaidMode } from '../models/api.js'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { ProgressStore } from '../services/progressStore.js'
import { SquadError, SquadStore, SQUAD_MEMBER_ID, type SquadRow } from '../services/squadStore.js'
import { computeSquadOverview, sharedQuestsOf, SQUAD_MAX_MEMBERS } from '../../../src/squad/squadOverview'
import type { CatalogPeek } from './me.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const nameSchema = z.string().trim().max(32).regex(/^[\p{L}\p{N} _.'-]*$/u)
const createSchema = z.object({ name: nameSchema.optional() }).strict()
const joinSchema = z.object({ code: z.string().max(32) }).strict()
const kickSchema = z.object({ memberId: z.string().regex(SQUAD_MEMBER_ID) }).strict()

export const SUBSCRIPTION_REQUIRED = 'Отряд доступен с активной подпиской, в пробный период или стримерам'
const TOO_MANY = 'Слишком много запросов. Попробуйте позже.'

export interface SquadRouterOptions {
  catalog?: CatalogPeek
  now?: () => number
  /** Per window: all squad requests per IP and per account, and join attempts per IP and per account. */
  limits?: Partial<{ ip: number; account: number; joinIp: number; joinAccount: number; windowMs: number }>
}

export const SQUAD_RATE_LIMITS = { ip: 900, account: 300, joinIp: 20, joinAccount: 10, windowMs: 10 * 60 * 1000 }

export function createSquadsRouter(accounts: AccountStore, progress: ProgressStore, squads: SquadStore, options: SquadRouterOptions = {}) {
  const router = express.Router()
  const limits = { ...SQUAD_RATE_LIMITS, ...options.limits }
  const limiter = (max: number) => new FixedWindowRateLimiter(max, limits.windowMs, options.now)
  const ipLimiter = limiter(limits.ip)
  const accountLimiter = limiter(limits.account)
  const joinIpLimiter = limiter(limits.joinIp)
  const joinAccountLimiter = limiter(limits.joinAccount)
  const tooMany = (res: Response, retry: number) => { res.status(429).set('Retry-After', String(retry)).json({ error: TOO_MANY }) }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    // Per IP first (req.ip is the visitor behind the site proxy: app.ts trusts loopback proxies only).
    const ipRetry = ipLimiter.hit(`ip:${req.ip ?? 'unknown'}`)
    if (ipRetry) { tooMany(res, ipRetry); return }
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    const retry = accountLimiter.hit(`account:${accountId}`)
    if (retry) { tooMany(res, retry); return }
    res.locals.accountId = accountId
    next()
  })

  const account = (res: Response) => String(res.locals.accountId)
  const hasAccess = (accountId: string) => {
    const view = accounts.view(accountId)
    return view.subscription.status !== 'inactive' || view.owner === true
  }
  const requireAccess = (accountId: string) => { if (!hasAccess(accountId)) throw new SquadError(402, SUBSCRIPTION_REQUIRED) }
  const parseMode = (req: Request) => {
    const parsed = modeSchema.safeParse(req.params.mode)
    if (!parsed.success) throw new SquadError(400, 'Некорректный режим')
    return parsed.data
  }

  /** What a member may see about the squad: nicknames of this mode only. */
  const squadView = (squad: SquadRow, viewer: string, mode: RaidMode) => ({
    id: squad.id,
    name: squad.name,
    maxMembers: SQUAD_MAX_MEMBERS,
    isOwner: squad.ownerId === viewer,
    createdAt: new Date(squad.createdAt).toISOString(),
    members: squad.members.map((member) => ({
      memberId: member.memberId,
      nickname: accounts.view(member.accountId).nicknames[mode] ?? null,
      isYou: member.accountId === viewer,
      isOwner: member.isOwner,
      joinedAt: new Date(member.joinedAt).toISOString(),
    })),
  })

  const handle = (work: (req: Request, res: Response) => void): express.RequestHandler => (req, res, next) => {
    try { work(req, res) } catch (error) {
      if (error instanceof SquadError) { res.status(error.status).json({ error: error.message, ...(error.status === 402 ? { code: 'subscription_required' } : {}) }); return }
      next(error)
    }
  }

  router.get('/mine/:mode', handle((req, res) => {
    const mode = parseMode(req)
    const accountId = account(res)
    const squad = squads.squadOf(accountId)
    res.json({ squad: squad ? squadView(squad, accountId, mode) : null, access: hasAccess(accountId) })
  }))

  router.post('/', handle((req, res) => {
    const accountId = account(res)
    const body = createSchema.safeParse(req.body ?? {})
    if (!body.success) throw new SquadError(400, 'Название отряда: до 32 букв, цифр и пробелов')
    requireAccess(accountId)
    const squad = squads.create(accountId, body.data.name || 'Отряд')
    res.status(201).json({ squad: squadView(squad, accountId, 'pvp') })
  }))

  router.post('/join', handle((req, res) => {
    const accountId = account(res)
    // Counted before anything else, so guessing codes is slow whatever the answer.
    const ipRetry = joinIpLimiter.hit(`join-ip:${req.ip ?? 'unknown'}`)
    if (ipRetry) { tooMany(res, ipRetry); return }
    const retry = joinAccountLimiter.hit(`join:${accountId}`)
    if (retry) { tooMany(res, retry); return }
    const body = joinSchema.safeParse(req.body)
    if (!body.success) throw new SquadError(400, 'Введите код приглашения')
    requireAccess(accountId)
    const squad = squads.join(accountId, body.data.code)
    res.json({ squad: squadView(squad, accountId, 'pvp') })
  }))

  router.get('/:id/overview/:mode', handle((req, res) => {
    const accountId = account(res)
    const squad = squads.memberSquad(accountId, String(req.params.id))
    const mode = parseMode(req)
    requireAccess(accountId)
    const view = squadView(squad, accountId, mode)
    const members = squad.members.map((member, index) => {
      const { records, scope } = progress.userRecords(`user:${member.accountId}`, mode)
      return { ...view.members[index], activeQuestIds: records.filter((record) => record.status === 'active').map((record) => record.taskId), lastSyncAt: scope?.syncedAt ?? null }
    })
    const input = members.map((member) => ({ memberId: member.memberId, activeQuestIds: member.activeQuestIds }))
    let catalog
    try { catalog = options.catalog?.(mode) } catch { catalog = undefined }
    // Without a loaded catalog only the shared quests are known; the app groups by map with its own catalog.
    const computed = catalog ? computeSquadOverview(input, catalog.quests) : { sharedQuests: sharedQuestsOf(input), maps: null, anyMap: null, items: null }
    res.json({ squad: { ...view, members }, mode, ...computed, generatedAt: new Date().toISOString() })
  }))

  router.post('/:id/invites', handle((req, res) => {
    const accountId = account(res)
    const squad = squads.memberSquad(accountId, String(req.params.id))
    requireAccess(accountId)
    const invite = squads.createInvite(accountId, squad.id)
    res.status(201).json({ code: invite.code, expiresAt: new Date(invite.expiresAt).toISOString() })
  }))

  router.post('/:id/leave', handle((req, res) => {
    squads.leave(account(res), String(req.params.id))
    res.status(204).end()
  }))

  router.post('/:id/disband', handle((req, res) => {
    squads.disband(account(res), String(req.params.id))
    res.status(204).end()
  }))

  router.post('/:id/kick', handle((req, res) => {
    const accountId = account(res)
    squads.memberSquad(accountId, String(req.params.id))
    const body = kickSchema.safeParse(req.body)
    if (!body.success) throw new SquadError(400, 'Некорректный участник')
    squads.kick(accountId, String(req.params.id), body.data.memberId)
    res.status(204).end()
  }))

  return router
}
