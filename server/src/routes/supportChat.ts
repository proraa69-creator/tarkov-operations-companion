/**
 * «Чат с поддержкой» (services/supportChatStore.ts): the player writes from the app, the owner answers from the owner
 * app's «Заявки» → «Чаты». Plain text, up to 2000 characters after cleaning (src/shared/supportChat.ts), with up to four
 * screenshots.
 *
 * The player (Bearer session; 401 without one):
 *   GET  /v1/me/support/messages?after=<id> -> { messages, unread, oldestId }: the newest 200 (only the ones after
 *        message <id> when given), oldest first; `unread`: the owner's answers the player has not seen; `oldestId`: the
 *        conversation's oldest message kept here, null when there is none (an app reading only what is new drops what
 *        it still shows from before it: the owner deleted the conversation)
 *   POST /v1/me/support/messages { text, images?: [{ data: base64 }] } -> 201 { message }; 20 per 10 minutes per account
 *        and per IP (an IPv6 /64 counts as one address), 429 + Retry-After past that. Screenshots (owner, 15.10.2026:
 *        «еще связаться с поддержкой, добавь что бы можно было добавить скриншот»): up to 4, PNG / JPEG / WEBP by their
 *        first bytes, ≤ 5 MB each, 40 an hour per account and per IP; with them `text` may be empty. 507 when the
 *        screenshot storage is full (services/supportChatStore.ts). A message with screenshots carries
 *        `attachments: [{ id, width, height }]`; one with screenshots only has the text «[скриншот]».
 *   GET  /v1/me/support/attachments/:id     -> { mime, data: base64, width, height }: a screenshot of this account's own
 *        conversation; 404 for any other (the gateways forward JSON only)
 *   POST /v1/me/support/read                -> 204: the owner's answers are seen
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else.
 *   GET  /v1/accounts/me/admin/support/threads?limit&offset -> { threads: [{ accountId, email, nickname?, nicknames,
 *        lastMessage, lastAt, unread }], total, unread }: the latest message first; `unread` of a conversation: the
 *        player's messages not seen yet, at the top: conversations with any
 *   GET  /v1/accounts/me/admin/support/threads/:accountId   -> { account: { id, email, nickname?, nicknames }, messages }
 *   POST /v1/accounts/me/admin/support/threads/:accountId/messages { text, images? } -> 201 { message } (audit:
 *        support.reply); an answer also marks the player's messages seen; screenshots as for the player
 *   GET  /v1/accounts/me/admin/support/attachments/:id                  -> { mime, data: base64, width, height }: any
 *        conversation's screenshot
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
 *
 * The two message routes with screenshots take a larger body than the global 1 MB JSON parser:
 * createSupportChatUploadParser, mounted in app.ts before that parser, checks the session (and the owner) and a global
 * cap of bodies being read BEFORE it reads up to SUPPORT_UPLOAD_BODY_LIMIT; the routes here then find the body parsed.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ipRateKey } from '../services/securityGuard.js'
import type { SocialSignals } from '../services/socialSignals.js'
import { EMPTY_MESSAGE, IMAGE_STORAGE_FULL, SupportChatError, supportText, TOO_LONG_MESSAGE, TOO_MANY_IMAGES, type SupportChatStore } from '../services/supportChatStore.js'
import type { MapUpdates } from './mapUpdates.js'
import { regionOf } from '../../../src/shared/countries.js'
import { cleanSupportText, SUPPORT_ATTACHMENT_ID, SUPPORT_IMAGE_LIMITS, SUPPORT_MESSAGE_MAX } from '../../../src/shared/supportChat.js'

/** Base64 of four 5 MB screenshots is ~26.7 MB; the text and the JSON around it fit in the rest. */
export const SUPPORT_UPLOAD_BODY_LIMIT = '28mb'
/** Bodies with screenshots read at the same time (each may be ~28 MB of JSON in memory while it is parsed). */
export const MAX_CONCURRENT_SUPPORT_UPLOADS = 2
/** A message without screenshots is a few kilobytes; a bigger body while the screenshot storage is full is refused unread. */
const TEXT_ONLY_BODY_BYTES = 64 * 1024
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const DATA_URL_PREFIX = /^data:image\/(?:png|jpeg|webp);base64,/
const PLAYER_MESSAGES_PATH = '/v1/me/support/messages'
const OWNER_MESSAGES_PATH = /^\/v1\/accounts\/me\/admin\/support\/threads\/[^/]+\/messages\/?$/

const textSchema = z.object({
  text: z.string().default(''),
  // Counted below with a readable answer; past 20 the body is simply wrong.
  images: z.array(z.object({ data: z.string().max(Math.ceil(SUPPORT_IMAGE_LIMITS.fileBytes / 3) * 4 + 64) })).max(20).default([]),
})
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
export interface SupportChatLimits { perAccount: number; perIp: number; windowMs: number; imagesPerHour: number }
export const SUPPORT_CHAT_RATE_LIMITS: SupportChatLimits = { perAccount: 20, perIp: 20, windowMs: 10 * 60 * 1000, imagesPerHour: 40 }
export const SUPPORT_IMAGE_RATE_MESSAGE = 'Слишком много скриншотов. Попробуйте через час.'
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
  // Screenshots: counted per image, per account and per IP, apart from the messages.
  const imageBudget = new ImageBudget(limits.imagesPerHour, 60 * 60 * 1000, options.now)
  // A conversation's screenshots load one by one as it is shown (each once per opening of the app).
  const attachmentLimiter = new FixedWindowRateLimiter(300, 60 * 1000, options.now)
  const readLimiter = new FixedWindowRateLimiter(600, 60 * 1000, options.now)
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000, options.now)
  // «Написать пользователю»: typing searches as it goes, never a crawl of every address.
  const searchLimiter = new FixedWindowRateLimiter(60, 60 * 1000, options.now)
  const signal = (work: () => void) => { try { work() } catch { /* the other side catches up on its next read */ } }

  /** The signed-in player's account, or an answer was already sent. */
  const player = (req: Request, res: Response, limiter = userLimiter) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return undefined }
    return id
  }

  /** The owner's e-mail, or an answer was already sent (as in routes/bugReports.ts). */
  const owner = (kind: 'read' | 'write' | 'search' | 'attachment', req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = (kind === 'read' ? readLimiter : kind === 'search' ? searchLimiter : kind === 'attachment' ? attachmentLimiter : writeLimiter).hit(id)
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

  /**
   * The cleaned text of the body and its screenshots' bytes (not yet checked: SupportChatStore.add does), or a 400 was
   * sent. With screenshots the text may be empty.
   */
  const text = (req: Request, res: Response): { text: string; files: Buffer[] } | undefined => {
    const body = textSchema.safeParse(req.body)
    try {
      if (!body.success) throw new SupportChatError(400, EMPTY_MESSAGE)
      if (body.data.text.length > RAW_TEXT_MAX) throw new SupportChatError(400, TOO_LONG_MESSAGE)
      if (body.data.images.length > SUPPORT_IMAGE_LIMITS.files) throw new SupportChatError(400, TOO_MANY_IMAGES)
      const files = body.data.images.map((image) => decodeImage(image.data))
      if (!files.length) return { text: supportText(body.data.text), files }
      const written = cleanSupportText(body.data.text)
      if (written.length > SUPPORT_MESSAGE_MAX) throw new SupportChatError(400, TOO_LONG_MESSAGE)
      return { text: written, files }
    } catch (error) {
      if (!(error instanceof SupportChatError)) throw error
      res.status(error.status).json({ error: error.message })
      return undefined
    }
  }

  /** The screenshots' own limit (per account and per IP): true when an answer was already sent. Counted by `took`. */
  const tooManyImages = (key: string, req: Request, res: Response, count: number) => {
    if (!count) return false
    const retry = imageBudget.wait(`account:${key}`, count) || imageBudget.wait(`ip:${ipRateKey(req.ip)}`, count)
    if (!retry) return false
    res.set('Retry-After', String(retry)).status(429).json({ error: SUPPORT_IMAGE_RATE_MESSAGE })
    return true
  }
  const took = (key: string, req: Request, count: number) => {
    if (!count) return
    imageBudget.take(`account:${key}`, count)
    imageBudget.take(`ip:${ipRateKey(req.ip)}`, count)
  }

  /** Writes the message; a refused screenshot (400) or a full storage (507) is answered here (undefined). */
  const write = (res: Response, accountId: string, author: 'user' | 'owner', written: { text: string; files: Buffer[] }) => {
    try {
      return store.add(accountId, author, written.text, written.files)
    } catch (error) {
      if (!(error instanceof SupportChatError)) throw error
      res.status(error.status).json({ error: error.message })
      return undefined
    }
  }

  /** A screenshot as the gateways forward it (JSON only). */
  const sendAttachment = (res: Response, attachment: { mime: string; width: number; height: number; data: Buffer }) => {
    res.json({ mime: attachment.mime, data: attachment.data.toString('base64'), width: attachment.width, height: attachment.height })
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
    if (tooManyImages(accountId, req, res, written.files.length)) return
    const message = write(res, accountId, 'user', written)
    if (!message) return
    sendLimiter.hit(accountId)
    sendIpLimiter.hit(address)
    took(accountId, req, written.files.length)
    res.status(201).json({ message })
    // «Заявки» in the owner app: the badge and «Чаты» move at once.
    signal(() => options.ownerSignals?.changed())
  })

  router.get('/v1/me/support/attachments/:id', (req, res) => {
    const accountId = player(req, res, attachmentLimiter)
    if (!accountId) return
    const id = String(req.params.id)
    const attachment = SUPPORT_ATTACHMENT_ID.test(id) ? store.attachment(id) : undefined
    // Another account's screenshot is answered exactly like one that does not exist.
    if (!attachment || attachment.accountId !== accountId) { res.status(404).json({ error: 'Скриншот не найден' }); return }
    sendAttachment(res, attachment)
  })

  router.get('/v1/accounts/me/admin/support/attachments/:id', (req, res) => {
    if (!owner('attachment', req, res)) return
    const id = String(req.params.id)
    const attachment = SUPPORT_ATTACHMENT_ID.test(id) ? store.attachment(id) : undefined
    if (!attachment) { res.status(404).json({ error: 'Скриншот не найден' }); return }
    sendAttachment(res, attachment)
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
    if (tooManyImages(`owner:${actor}`, req, res, answer.files.length)) return
    // The owner writes first into an empty conversation: «Написать пользователю» (or «Открыть чат» on a report).
    const starts = store.oldestId(accountId) === null
    const message = write(res, accountId, 'owner', answer)
    if (!message) return
    took(`owner:${actor}`, req, answer.files.length)
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

/** Screenshots per key in a fixed window: `wait` says whether `count` more still fit, `take` counts them. */
class ImageBudget {
  private readonly used = new Map<string, { count: number; resetAt: number }>()
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number
  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  private entry(key: string) {
    const now = this.now()
    const entry = this.used.get(key)
    if (entry && entry.resetAt > now) return entry
    if (this.used.size > 10_000) for (const [stale, value] of this.used) if (value.resetAt <= now) this.used.delete(stale)
    const fresh = { count: 0, resetAt: now + this.windowMs }
    this.used.set(key, fresh)
    return fresh
  }

  /** 0 when `count` more fit, else the seconds until the window resets. */
  wait(key: string, count: number) {
    const entry = this.entry(key)
    return entry.count + count > this.max ? Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)) : 0
  }

  take(key: string, count: number) {
    this.entry(key).count += count
  }
}

function decodeImage(raw: string) {
  const data = raw.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '')
  if (!BASE64.test(data) || data.length % 4 === 1) throw new SupportChatError(400, 'Повреждённый файл скриншота')
  return Buffer.from(data, 'base64')
}

/**
 * The bodies of the two message routes (POST /v1/me/support/messages and the owner's …/threads/:accountId/messages),
 * read here with SUPPORT_UPLOAD_BODY_LIMIT instead of the global 1 MB, mounted in app.ts before the global parser (which
 * then leaves the parsed body alone). Nobody without a session (and nobody but the owner on the owner's route) makes the
 * server read a large body; at most MAX_CONCURRENT_SUPPORT_UPLOADS are read at a time (503 + Retry-After past that), and
 * a body past a few kilobytes is refused unread while the screenshot storage is full (507). The routes answer the rest.
 */
export function createSupportChatUploadParser(accounts: AccountStore, store: SupportChatStore, options: { maxConcurrentUploads?: number } = {}) {
  const maxUploads = options.maxConcurrentUploads ?? MAX_CONCURRENT_SUPPORT_UPLOADS
  let uploads = 0
  const parse = express.json({ limit: SUPPORT_UPLOAD_BODY_LIMIT })
  const full = () => { try { return store.imagesFull() } catch { return false } }
  return (req: Request, res: Response, next: express.NextFunction) => {
    if (req.method !== 'POST') { next(); return }
    const path = req.path
    const ownerRoute = OWNER_MESSAGES_PATH.test(path)
    if (path !== PLAYER_MESSAGES_PATH && path !== `${PLAYER_MESSAGES_PATH}/` && !ownerRoute) { next(); return }
    const refuse = (status: number, error: string, retryAfter?: string) => {
      req.resume()
      res.set('Cache-Control', 'no-store').set('Connection', 'close')
      if (retryAfter) res.set('Retry-After', retryAfter)
      res.status(status).json({ error })
    }
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { refuse(401, 'Требуется вход в аккаунт'); return }
    if (ownerRoute && !accounts.isOwner(accountId)) { refuse(404, 'Не найдено'); return }
    const large = Number(req.get('content-length') ?? 0) > TEXT_ONLY_BODY_BYTES
    if (large && full()) { refuse(507, IMAGE_STORAGE_FULL); return }
    if (uploads >= maxUploads) { refuse(503, 'Сервер сейчас принимает другие скриншоты. Повторите через несколько секунд.', '10'); return }
    uploads += 1
    let released = false
    const release = () => { if (!released) { released = true; uploads -= 1 } }
    res.once('finish', release)
    res.once('close', release)
    parse(req, res, (error?: unknown) => {
      // Read: the slot is free for the next one while this message is written.
      release()
      next(error)
    })
  }
}
