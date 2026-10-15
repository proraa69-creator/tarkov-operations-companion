/**
 * «Чат с поддержкой» (services/supportChatStore.ts): the player writes from the app («Связаться»), the owner answers from
 * the owner app's «Заявки» → «Чаты». Plain text, up to 2000 characters after cleaning (src/shared/supportChat.ts).
 *
 * The player (Bearer session; 401 without one):
 *   GET  /v1/me/support/messages?after=<id> -> { messages, unread, oldestId }: the newest 200 (only the ones after
 *        message <id> when given), oldest first; `unread`: the owner's answers the player has not seen; `oldestId`: the
 *        conversation's oldest message kept here, null when there is none (an app reading only what is new drops what
 *        it still shows from before it: the owner deleted the conversation)
 *   POST /v1/me/support/messages { text }   -> 201 { message }; 20 per 10 minutes per account and per IP (an IPv6 /64
 *        counts as one address), 429 + Retry-After past that
 *   POST /v1/me/support/read                -> 204: the owner's answers are seen
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else.
 *   GET  /v1/accounts/me/admin/support/threads?limit&offset -> { threads: [{ accountId, email, nickname?, nicknames,
 *        lastMessage, lastAt, unread }], total, unread }: the latest message first; `unread` of a conversation: the
 *        player's messages not seen yet, at the top: conversations with any
 *   GET  /v1/accounts/me/admin/support/threads/:accountId   -> { account: { id, email, nickname?, nicknames }, messages }
 *   POST /v1/accounts/me/admin/support/threads/:accountId/messages { text } -> 201 { message } (audit: support.reply);
 *        an answer also marks the player's messages seen
 *   POST /v1/accounts/me/admin/support/threads/:accountId/read             -> 204
 *   GET  /v1/accounts/me/admin/support/search?q=<part of an e-mail>      -> { users: [{ id, email, nickname?, country?,
 *        countryOther?, region, subscription: { status, paidUntil?, trialEndsAt? }, hasThread }] } at most 20, the
 *        e-mails that start with it first («Написать пользователю»); 2–254 characters, 60 a minute
 *   The owner's first message into an empty conversation is audited as support.start (an owner-initiated thread).
 *   DELETE /v1/accounts/me/admin/support/threads/:accountId                -> 204 «Проблема решена»: the whole
 *        conversation is deleted for both sides (audit: support.resolve); the report it came from stays as it is
 *   Any existing account, even one that never wrote (owner, 14.10.2026: «где я отметил добавь открыть чат и туда можно
 *   будет писать» — the owner opens the chat from a report in «Заявки» and writes first); 404 for an id that is not a
 *   live account's.
 *
 * At once on the other side, through what the apps already wait on: an answer, the owner's read mark or a deleted
 * conversation moves the player's GET /v1/me/social-events (services/socialSignals.ts), and so does the player's own
 * read mark for their other devices; a player's message, the owner's read mark or a deleted conversation moves the owner
 * app's GET /v1/accounts/me/admin/requests/events (routes/bugReports.ts), whose answers carry `unreadChats` next to
 * `open`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ipRateKey } from '../services/securityGuard.js'
import type { SocialSignals } from '../services/socialSignals.js'
import { EMPTY_MESSAGE, SupportChatError, supportText, TOO_LONG_MESSAGE, type SupportChatStore } from '../services/supportChatStore.js'
import type { MapUpdates } from './mapUpdates.js'
import { regionOf } from '../../../src/shared/countries.js'

const textSchema = z.object({ text: z.string() })
/** The raw text before cleaning: generous, the 2000 characters are counted after it (supportText). */
const RAW_TEXT_MAX = 8000
const afterSchema = z.object({ after: z.string().regex(/^\d{1,12}$/).transform(Number).optional() })
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})
const accountIdSchema = z.string().regex(/^[a-f0-9]{24}$/)

export type SupportChatAudit = (actor: string, action: 'support.reply' | 'support.resolve' | 'support.start', target: string, details: Record<string, unknown>) => void
/** «Написать пользователю»: the search text (part of an e-mail) and the most it answers. */
const searchSchema = z.object({ q: z.string().trim().min(2).max(254) })
export const SUPPORT_SEARCH_LIMIT = 20
export interface SupportChatLimits { perAccount: number; perIp: number; windowMs: number }
export const SUPPORT_CHAT_RATE_LIMITS: SupportChatLimits = { perAccount: 20, perIp: 20, windowMs: 10 * 60 * 1000 }
export const SUPPORT_RATE_MESSAGE = 'Слишком много сообщений. Подождите несколько минут.'

export interface SupportChatRouterOptions {
  limits?: Partial<SupportChatLimits>
  /** The players' apps wait on GET /v1/me/social-events. */
  social?: SocialSignals
  /** The owner app's «Заявки» wait (a MapUpdates whose answers carry the counts, routes/bugReports.ts). */
  ownerSignals?: MapUpdates
  audit?: SupportChatAudit
  now?: () => number
}

export function createSupportChatRouter(accounts: AccountStore, store: SupportChatStore, options: SupportChatRouterOptions = {}) {
  const router = express.Router()
  const limits = { ...SUPPORT_CHAT_RATE_LIMITS, ...options.limits }
  const sendLimiter = new FixedWindowRateLimiter(limits.perAccount, limits.windowMs, options.now)
  const sendIpLimiter = new FixedWindowRateLimiter(limits.perIp, limits.windowMs, options.now)
  // Reading: on opening the chat, on every social event and once a minute while it is open.
  const userLimiter = new FixedWindowRateLimiter(600, 10 * 60 * 1000, options.now)
  const readLimiter = new FixedWindowRateLimiter(600, 60 * 1000, options.now)
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000, options.now)
  // «Написать пользователю»: typing searches as it goes, never a crawl of every address.
  const searchLimiter = new FixedWindowRateLimiter(60, 60 * 1000, options.now)
  const signal = (work: () => void) => { try { work() } catch { /* the other side catches up on its next read */ } }

  /** The signed-in player's account, or an answer was already sent. */
  const player = (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    const retry = userLimiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return undefined }
    return id
  }

  /** The owner's e-mail, or an answer was already sent (as in routes/bugReports.ts). */
  const owner = (kind: 'read' | 'write' | 'search', req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = (kind === 'read' ? readLimiter : kind === 'search' ? searchLimiter : writeLimiter).hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  /** Who wrote: the e-mail and the Escape from Tarkov nickname (one for every mode). */
  const who = (accountId: string) => {
    try {
      const view = accounts.view(accountId)
      return { email: view.email, ...(view.nickname ? { nickname: view.nickname } : {}), nicknames: view.nicknames }
    } catch {
      return { email: '', nicknames: {} }
    }
  }

  /** The account of the owner's conversation (any live one: the owner may write first), or 404. */
  const thread = (req: Request, res: Response) => {
    const id = accountIdSchema.safeParse(req.params.accountId)
    if (id.success && accounts.exists(id.data)) return id.data
    res.status(404).json({ error: 'Переписка не найдена' })
    return undefined
  }

  /** The cleaned text of the body, or a 400 was sent. */
  const text = (req: Request, res: Response) => {
    const body = textSchema.safeParse(req.body)
    try {
      if (!body.success) throw new SupportChatError(400, EMPTY_MESSAGE)
      if (body.data.text.length > RAW_TEXT_MAX) throw new SupportChatError(400, TOO_LONG_MESSAGE)
      return supportText(body.data.text)
    } catch (error) {
      if (!(error instanceof SupportChatError)) throw error
      res.status(error.status).json({ error: error.message })
      return undefined
    }
  }

  router.get('/v1/me/support/messages', (req, res) => {
    const accountId = player(req, res)
    if (!accountId) return
    const query = afterSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
    res.json({ messages: store.messages(accountId, query.data.after), unread: store.unreadForUser(accountId), oldestId: store.oldestId(accountId) })
  })

  router.post('/v1/me/support/messages', (req, res) => {
    const accountId = player(req, res)
    if (!accountId) return
    const written = text(req, res)
    if (written === undefined) return
    // Counted only for a message that is written: a refused one (empty, or over either limit) uses up neither limit.
    const address = ipRateKey(req.ip)
    const retry = sendLimiter.peek(accountId) || sendIpLimiter.peek(address)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: SUPPORT_RATE_MESSAGE }); return }
    sendLimiter.hit(accountId)
    sendIpLimiter.hit(address)
    res.status(201).json({ message: store.add(accountId, 'user', written) })
    // «Заявки» in the owner app: the badge and «Чаты» move at once.
    signal(() => options.ownerSignals?.changed())
  })

  router.post('/v1/me/support/read', (req, res) => {
    const accountId = player(req, res)
    if (!accountId) return
    const marked = store.markRead(accountId, 'user')
    res.status(204).end()
    // The badge goes on the player's other devices too.
    if (marked) signal(() => options.social?.changed([accountId]))
  })

  router.get('/v1/accounts/me/admin/support/threads', (req, res) => {
    if (!owner('read', req, res)) return
    const query = pageSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректные данные запроса' }); return }
    const page = store.threads(query.data.limit, query.data.offset)
    res.json({ ...page, threads: page.threads.map((entry) => ({ accountId: entry.accountId, ...who(entry.accountId), lastMessage: entry.lastMessage, lastAt: entry.lastAt, unread: entry.unread })) })
  })

  // «Написать пользователю» (owner, 15.10.2026: «сделай что бы прям в приложении я мог найти человека по почте и написать
  // ему»): accounts whose e-mail contains the text, at most SUPPORT_SEARCH_LIMIT, with what the owner needs to pick one.
  router.get('/v1/accounts/me/admin/support/search', (req, res) => {
    if (!owner('search', req, res)) return
    const query = searchSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Введите не меньше 2 символов почты' }); return }
    const users = accounts.searchByEmail(query.data.q, SUPPORT_SEARCH_LIMIT).flatMap((id) => {
      try {
        const view = accounts.view(id)
        return [{
          id,
          email: view.email,
          ...(view.nickname ? { nickname: view.nickname } : {}),
          ...(view.country ? { country: view.country, region: regionOf(view.country) } : { region: 'none' }),
          ...(view.countryOther ? { countryOther: view.countryOther } : {}),
          subscription: { status: view.kind === 'streamer' ? 'lifetime' : view.subscription.status, ...(view.subscription.paidUntil ? { paidUntil: view.subscription.paidUntil } : {}), ...(view.subscription.trialEndsAt ? { trialEndsAt: view.subscription.trialEndsAt } : {}) },
          hasThread: store.oldestId(id) !== null,
        }]
      } catch {
        return []
      }
    })
    res.json({ users })
  })

  router.get('/v1/accounts/me/admin/support/threads/:accountId', (req, res) => {
    if (!owner('read', req, res)) return
    const accountId = thread(req, res)
    if (!accountId) return
    res.json({ account: { id: accountId, ...who(accountId) }, messages: store.messages(accountId) })
  })

  router.post('/v1/accounts/me/admin/support/threads/:accountId/messages', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const accountId = thread(req, res)
    if (!accountId) return
    const answer = text(req, res)
    if (answer === undefined) return
    // The owner writes first into an empty conversation: «Написать пользователю» (or «Открыть чат» on a report).
    const starts = store.oldestId(accountId) === null
    const message = store.add(accountId, 'owner', answer)
    // Answering is reading: the conversation leaves the unread ones.
    const marked = store.markRead(accountId, 'owner')
    res.status(201).json({ message })
    signal(() => options.social?.changed([accountId]))
    if (marked) signal(() => options.ownerSignals?.changed())
    signal(() => options.audit?.(actor, starts ? 'support.start' : 'support.reply', who(accountId).email || accountId, { id: message.id }))
  })

  router.post('/v1/accounts/me/admin/support/threads/:accountId/read', (req, res) => {
    if (!owner('write', req, res)) return
    const accountId = thread(req, res)
    if (!accountId) return
    const marked = store.markRead(accountId, 'owner')
    res.status(204).end()
    if (!marked) return
    // The owner's other devices drop the count; the player's open chat shows their messages as read.
    signal(() => options.ownerSignals?.changed())
    signal(() => options.social?.changed([accountId]))
  })

  // «Проблема решена» (owner, 14.10.2026: «добавь кнопку у админ версии, проблема решена. и данный чат удаляется»).
  router.delete('/v1/accounts/me/admin/support/threads/:accountId', (req, res) => {
    const actor = owner('write', req, res)
    if (!actor) return
    const accountId = thread(req, res)
    if (!accountId) return
    const deleted = store.deleteThread(accountId)
    res.status(204).end()
    if (deleted) {
      // The player's chat empties and the badge goes; the owner's «Чаты» and the «Заявки» count follow on every device.
      signal(() => options.social?.changed([accountId]))
      signal(() => options.ownerSignals?.changed())
    }
    signal(() => options.audit?.(actor, 'support.resolve', who(accountId).email || accountId, { messages: deleted }))
  })

  return router
}
