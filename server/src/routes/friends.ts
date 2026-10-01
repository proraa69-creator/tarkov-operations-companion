/**
 * Friends API, mounted at `/v1/friends`. Every route needs `Authorization: Bearer <session token>`; the account is
 * taken only from the session. Friends are addressed by a random public id: e-mails and account ids never leave the
 * server. A friend sees only the per-mode nickname, active quests, quest progress and the items needed — and nothing
 * at all while the other side hides their progress from them («Скрывать мой прогресс»).
 *
 *   GET  /                                   -> { code, friends, incoming, outgoing, blocked, access }
 *   POST /requests                           { code } | { mode, nickname } -> { status: 'sent' | 'friends' }  (paid)
 *   POST /requests/:id/accept|decline|cancel -> 204
 *   POST /code                               -> { code } (a new friend code; the old one stops working)
 *   POST /:friendId/remove|block|unblock     -> 204
 *   PUT  /:friendId/privacy                  { hideProgress } -> 204
 *   POST /progress/:mode                     { friendIds[] } -> { people } (planner / friend's progress; paid)
 *   GET  /needs/:mode                        -> { itemIds | null, questIds } (in-raid «MATE» badge; paid)
 *
 * Paid (docs/product-roadmap-and-business-model.md): sending requests and seeing friends' progress need an active
 * subscription, the trial or a streamer account. Answering requests, removing, blocking and privacy always work.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { RaidMode } from '../models/api.js'
import { bearer, FixedWindowRateLimiter, NICKNAME, type AccountStore } from '../services/accountStore.js'
import { hasPaidAccess } from '../services/access.js'
import { FriendError, FriendStore, formatFriendCode, FRIEND_ID } from '../services/friendStore.js'
import type { ProgressStore } from '../services/progressStore.js'
import { HIDDEN_PROGRESS, sharedProgress } from '../services/sharedProgress.js'
import type { SquadStore } from '../services/squadStore.js'
import { itemIdsNeededBy } from '../../../src/squad/squadOverview'
import type { CatalogPeek } from './me.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const requestSchema = z.union([
  z.object({ code: z.string().max(32) }).strict(),
  z.object({ mode: modeSchema, nickname: z.string().trim().regex(NICKNAME) }).strict(),
])
const privacySchema = z.object({ hideProgress: z.boolean() }).strict()
const progressSchema = z.object({ friendIds: z.array(z.string().regex(FRIEND_ID)).max(10) }).strict()

export const FRIENDS_SUBSCRIPTION_REQUIRED = 'Друзья и общий прогресс доступны с активной подпиской, в пробный период или стримерам'
const TOO_MANY = 'Слишком много запросов. Попробуйте позже.'

export const FRIEND_RATE_LIMITS = { ip: 900, account: 300, windowMs: 10 * 60 * 1000, requestsAccount: 20, requestsIp: 40, requestsWindowMs: 60 * 60 * 1000 }

export interface FriendsRouterOptions {
  catalog?: CatalogPeek
  now?: () => number
  limits?: Partial<typeof FRIEND_RATE_LIMITS>
}

export function createFriendsRouter(accounts: AccountStore, progress: ProgressStore, friends: FriendStore, squads: SquadStore, options: FriendsRouterOptions = {}) {
  const router = express.Router()
  const limits = { ...FRIEND_RATE_LIMITS, ...options.limits }
  const ipLimiter = new FixedWindowRateLimiter(limits.ip, limits.windowMs, options.now)
  const accountLimiter = new FixedWindowRateLimiter(limits.account, limits.windowMs, options.now)
  const requestAccountLimiter = new FixedWindowRateLimiter(limits.requestsAccount, limits.requestsWindowMs, options.now)
  const requestIpLimiter = new FixedWindowRateLimiter(limits.requestsIp, limits.requestsWindowMs, options.now)
  const tooMany = (res: Response, retry: number) => { res.status(429).set('Retry-After', String(retry)).json({ error: TOO_MANY }) }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
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
  const requireAccess = (accountId: string) => { if (!hasPaidAccess(accounts, accountId)) throw new FriendError(402, FRIENDS_SUBSCRIPTION_REQUIRED) }
  const parseMode = (req: Request): RaidMode => {
    const parsed = modeSchema.safeParse(req.params.mode)
    if (!parsed.success) throw new FriendError(400, 'Некорректный режим')
    return parsed.data
  }
  const nicknames = (accountId: string) => accounts.view(accountId).nicknames
  const handle = (work: (req: Request, res: Response) => void): express.RequestHandler => (req, res, next) => {
    try { work(req, res) } catch (error) {
      if (error instanceof FriendError) { res.status(error.status).json({ error: error.message, ...(error.status === 402 ? { code: 'subscription_required' } : {}) }); return }
      next(error)
    }
  }

  router.get('/', handle((_req, res) => {
    const accountId = account(res)
    const profile = friends.profile(accountId)
    res.json({
      code: formatFriendCode(profile.code),
      access: hasPaidAccess(accounts, accountId),
      friends: friends.friends(accountId).map((friend) => ({
        friendId: friend.publicId,
        nicknames: nicknames(friend.accountId),
        since: new Date(friend.since).toISOString(),
        hideMyProgress: friend.hideMyProgress,
        sharesProgress: !friend.hidesFromMe,
      })),
      incoming: friends.incoming(accountId).map((request) => ({ requestId: request.id, friendId: friends.publicId(request.fromId), nicknames: nicknames(request.fromId), createdAt: new Date(request.createdAt).toISOString() })),
      // Only what the sender typed: whether the target exists is not revealed.
      outgoing: friends.outgoing(accountId).map((request) => ({ requestId: request.id, label: request.label, createdAt: new Date(request.createdAt).toISOString() })),
      blocked: friends.blocked(accountId).map((blockedId) => ({ friendId: friends.publicId(blockedId), nicknames: nicknames(blockedId) })),
    })
  }))

  router.post('/requests', handle((req, res) => {
    const accountId = account(res)
    const ipRetry = requestIpLimiter.hit(`ip:${req.ip ?? 'unknown'}`)
    if (ipRetry) { tooMany(res, ipRetry); return }
    const retry = requestAccountLimiter.hit(`account:${accountId}`)
    if (retry) { tooMany(res, retry); return }
    const body = requestSchema.safeParse(req.body)
    if (!body.success) throw new FriendError(400, 'Введите код друга или ник в игре')
    requireAccess(accountId)
    res.json({ status: friends.request(accountId, body.data) })
  }))

  router.post('/requests/:id/:action', handle((req, res) => {
    const accountId = account(res)
    const id = String(req.params.id)
    if (!FRIEND_ID.test(id)) throw new FriendError(404, 'Запрос не найден')
    const action = String(req.params.action)
    if (action === 'accept') friends.accept(accountId, id)
    else if (action === 'decline') friends.decline(accountId, id)
    else if (action === 'cancel') friends.cancel(accountId, id)
    else throw new FriendError(404, 'Неизвестное действие')
    res.status(204).end()
  }))

  router.post('/code', handle((_req, res) => {
    res.status(201).json({ code: formatFriendCode(friends.regenerateCode(account(res))) })
  }))

  router.post('/progress/:mode', handle((req, res) => {
    const accountId = account(res)
    const mode = parseMode(req)
    const body = progressSchema.safeParse(req.body)
    if (!body.success) throw new FriendError(400, 'Некорректный список друзей')
    requireAccess(accountId)
    const people = [...new Set(body.data.friendIds)].map((friendId) => {
      const friendAccount = friends.friendAccount(accountId, friendId)
      const hidden = friends.hidesProgress(friendAccount, accountId)
      return { id: friendId, nickname: nicknames(friendAccount)[mode] ?? null, hidden, ...(hidden ? HIDDEN_PROGRESS : sharedProgress(progress, friendAccount, mode)) }
    })
    const self = { id: 'me', nickname: nicknames(accountId)[mode] ?? null, hidden: false, isYou: true, ...sharedProgress(progress, accountId, mode) }
    res.json({ mode, people: [self, ...people] })
  }))

  router.get('/needs/:mode', handle((req, res) => {
    const accountId = account(res)
    const mode = parseMode(req)
    requireAccess(accountId)
    // Friends and squad mates, minus anybody who hides their progress from me. Only the union is returned: the
    // overlay shows a bare «MATE» badge, never who or for which quest.
    const others = new Set(friends.friends(accountId).filter((friend) => !friend.hidesFromMe).map((friend) => friend.accountId))
    for (const member of squads.squadOf(accountId)?.members ?? []) {
      if (member.accountId !== accountId && !friends.hidesProgress(member.accountId, accountId)) others.add(member.accountId)
    }
    const members = [...others].map((other, index) => {
      const shared = sharedProgress(progress, other, mode)
      return { memberId: String(index), activeQuestIds: shared.activeQuestIds, objectives: shared.objectives }
    })
    let catalog
    try { catalog = options.catalog?.(mode) } catch { catalog = undefined }
    const questIds = [...new Set(members.flatMap((member) => member.activeQuestIds))].sort()
    res.json({ mode, itemIds: catalog ? itemIdsNeededBy(members, catalog.quests) : null, questIds })
  }))

  router.post('/:friendId/:action', handle((req, res) => {
    const accountId = account(res)
    const friendId = String(req.params.friendId)
    if (!FRIEND_ID.test(friendId)) throw new FriendError(404, 'Друг не найден')
    const action = String(req.params.action)
    if (action === 'remove') friends.remove(accountId, friendId)
    else if (action === 'block') friends.block(accountId, friendId)
    else if (action === 'unblock') friends.unblock(accountId, friendId)
    else throw new FriendError(404, 'Неизвестное действие')
    res.status(204).end()
  }))

  router.put('/:friendId/privacy', handle((req, res) => {
    const body = privacySchema.safeParse(req.body)
    if (!body.success) throw new FriendError(400, 'Некорректные данные запроса')
    friends.setHideProgress(account(res), String(req.params.friendId), body.data.hideProgress)
    res.status(204).end()
  }))

  return router
}
