import cors from 'cors'
import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { AppDataset, RaidMode } from '../../src/domain/types'
import { fetchPlayerProfile } from '../../electron/playerProfileService'
import { currentQuestBase, getCatalogAnswer, peekCatalogSnapshot, resolvePlayer } from './services/catalogService.js'
import { catalogNotModified, type CatalogLocale } from './services/catalogCache.js'
import { createCatalogAnswers } from './services/catalogAnswers.js'
import type { QuestBaseReport } from './services/questBase.js'
import { createQuestBaseRouter } from './routes/questBase.js'
import type { ProgressStore } from './services/progressStore.js'
import { createGoonsRouter } from './routes/goons.js'
import { createAccountsRouter } from './routes/accounts.js'
import { createLoginCodesRouter, proxiedCountry } from './routes/loginCodes.js'
import { createPhoneRouter } from './routes/phone.js'
import { PhoneAuthService } from './services/phoneAuth.js'
import { createEmailRouter } from './routes/email.js'
import { EmailAuthService } from './services/emailAuth.js'
import { countryCode, LoginCodeStore } from './services/loginCodes.js'
import { AccountError, AccountStore, bearer, FixedWindowRateLimiter } from './services/accountStore.js'
import { createMeRouter, type CatalogPeek } from './routes/me.js'
import { mountSocial, type SocialLimits } from './routes/social.js'
import type { FriendsRouterOptions } from './routes/friends.js'
import { SocialSignals } from './services/socialSignals.js'
import { createPaymentsRouter } from './routes/payments.js'
import { createAdminRouter } from './routes/admin.js'
import { PaymentStore } from './services/paymentStore.js'
import { InviteProgram } from './services/invites.js'
import { createInvitesRouter } from './routes/invites.js'
import { createPayoutsRouter } from './routes/payouts.js'
import { createOwnerAdminRouter } from './routes/ownerAdmin.js'
import { createMapBossesRouter } from './routes/mapBosses.js'
import { MapBossStore } from './services/mapBossStore.js'
import { createQuestPointsRouter } from './routes/questPoints.js'
import { createQuestTextsRouter } from './routes/questTexts.js'
import { createAnnouncementRouter } from './routes/announcement.js'
import { createMapUpdatesRouter, MapUpdates } from './routes/mapUpdates.js'
import { createMapTilesRouter } from './routes/mapTiles.js'
import { createDataMirrorRouter } from './routes/dataMirror.js'
import { createItemImagesRouter } from './routes/itemImages.js'
import { createGuideImagesRouter } from './routes/guideImages.js'
import type { GuideImageMirror } from './services/guideImages.js'
import type { MapMirror } from './services/mapMirror.js'
import type { MirrorStorage } from './services/mirrorStorage.js'
import type { PriceMirror } from './services/priceMirror.js'
import type { LegacyGraphqlBuilder } from './services/legacyGraphqlBuilder.js'
import type { PriceHistoryMirror } from './services/priceHistoryMirror.js'
import type { TarkovDataMirror } from './services/tarkovDataMirror.js'
import { QuestPointStore } from './services/questPointStore.js'
import { QuestTextStore } from './services/questTextStore.js'
import { AnnouncementStore } from './services/announcementStore.js'
import type { AnnouncementTranslator } from './services/announcementLanguage.js'
import { AdminStore } from './services/adminStore.js'
import { PayoutStore } from './services/payoutStore.js'
import { MemoryGoonStore, type GoonStore } from './services/goonStore.js'
import { UserDataStore } from './services/userDataStore.js'
import { openDatabase } from './services/database.js'
import { EntitlementService } from './services/entitlement.js'
import { DataGateway } from './services/dataGateway.js'
import { createDataRouter, DATA_RATE_LIMITS, requireDataAccess } from './routes/data.js'
import { createEntitlementRouter } from './routes/entitlement.js'
import { createServerGuard, type ServerGuardOptions } from './routes/serverGuard.js'
import { createSelfUpdateRouter } from './routes/selfUpdate.js'
import { createPaymentSettingsRouter } from './routes/paymentSettings.js'
import { createServerDownloadRouter } from './routes/serverDownload.js'
import { createBugReportsRouter, type BugReportLimits } from './routes/bugReports.js'
import { BugReportStore } from './services/bugReportStore.js'
import { createSupportChatRouter, type SupportChatLimits } from './routes/supportChat.js'
import { SupportChatStore } from './services/supportChatStore.js'
import { BugReportMailer } from './services/bugReportMail.js'
import { createAgentRequestsRouter, type AgentRequestLimits } from './routes/agentRequests.js'
import { RequestsKeyStore } from './services/requestsKeyStore.js'
import type { EmailSender } from './services/email/types.js'
import { reportErrorToOwnerApp, type OwnerAppLink } from './services/ownerApp.js'

const modeSchema = z.enum(['pvp', 'pve', 'seasonal'])
const syncSchema = z.object({
  mode: modeSchema, accountId: z.number().int().positive(), characterId: z.string().regex(/^[a-f0-9]{24}$/i),
  events: z.array(z.object({ taskId: z.string().regex(/^[a-f0-9]{24}$/i), status: z.enum(['active', 'completed', 'failed']), timestamp: z.string().datetime().transform((date) => new Date(date).toISOString()) })).max(2000),
})

export interface ApiOptions {
  /** Copy of tarkov.dev's maps served at /v1/map-tiles (services/mapMirror.ts); none in tests. */
  mapMirror?: MapMirror
  /** Persistent Tarkov datasets and prices stored on the server's RaidNVMe. */
  mirrorStorage?: MirrorStorage
  dataMirror?: TarkovDataMirror
  priceMirror?: PriceMirror
  legacyGraphql?: LegacyGraphqlBuilder
  priceHistory?: PriceHistoryMirror
  itemImageDir?: string
  /** «Оружейник»: the guides' screenshots kept on the server (services/guideImages.ts). */
  guideImages?: GuideImageMirror
  /** Goon sightings storage; index.ts passes the SQLite store, tests default to memory. */
  goons?: GoonStore
  /** Per-user documents (Collector, position, settings); defaults to a private in-memory database. */
  userData?: UserDataStore
  /** Already-loaded catalog for summaries (Kappa / Collector totals). Defaults to the server catalog cache. */
  catalog?: CatalogPeek
  /** The notice's English for foreign players (services/announcementLanguage.ts): MyMemory by default; tests pass a fake. */
  translateAnnouncement?: AnnouncementTranslator
  /**
   * Tests: a catalog to serve at GET /v1/catalog/:mode instead of the server's quest base (services/catalogService.ts);
   * its answer is prepared again for every new object it returns.
   */
  catalogSnapshot?: (mode: RaidMode, locale: CatalogLocale) => Promise<AppDataset>
  /** The quest base the owner's report reads (routes/questBase.ts); default: the server's (services/catalogService.ts). */
  questBase?: { report: () => QuestBaseReport }
  /** ЮKassa subscriptions; defaults to switched-off payments on a private in-memory database. */
  payments?: PaymentStore
  /** «Пригласи друга»; defaults to a program on the shared database (index.ts passes its own to run release()). */
  invites?: InviteProgram
  /** Streamer payouts; defaults to a ledger on the payments' database. */
  payouts?: PayoutStore
  /** One-time QR / device sign-in codes (in memory, 2 minutes). */
  loginCodes?: LoginCodeStore
  /** Phone numbers and SMS codes; defaults to switched off (no SMS provider). */
  phones?: PhoneAuthService
  /** E-mail one-time codes; defaults to switched off (no e-mail provider: registration works without codes). */
  emails?: EmailAuthService
  /** Requests per minute and IP for the public endpoints without sign-in (defaults: PUBLIC_RATE_LIMITS). */
  rateLimits?: Partial<typeof PUBLIC_RATE_LIMITS>
  /** Signed entitlements and devices; defaults to a key for this process only (index.ts passes the persistent one). */
  entitlements?: EntitlementService
  /** tarkov.dev gateway with the shared cache (tests pass one with a fake upstream). */
  data?: DataGateway
  /** Per-minute limits of the paid data routes (defaults: DATA_RATE_LIMITS). */
  dataRateLimits?: Partial<typeof DATA_RATE_LIMITS>
  /** «Страж сервера» (routes/serverGuard.ts): bans, health detail, backups. */
  guard?: ServerGuardOptions
  /** «Отряд» and friends (routes/social.ts): rate limits for tests. */
  squadLimits?: SocialLimits['squadLimits']
  friendLimits?: SocialLimits['friendLimits']
  /** The friend's info (routes/friends.ts): public game profiles; default the tarkov.dev lookup, tests pass a fake. */
  playerProfile?: FriendsRouterOptions['playerProfile']
  /** The owner app's main process (services/ownerApp.ts): «Обновление» tab, error reports. Default: process.parentPort. */
  ownerApp?: OwnerAppLink
  /** «Сообщить об ошибке» (routes/bugReports.ts): per-account / per-IP limits for tests. */
  bugReportLimits?: Partial<BugReportLimits>
  /** Every report to the owner's mailbox as a PDF (services/bugReportMail.ts): the e-mail provider and the address. */
  bugReportMail?: { sender?: EmailSender; to?: string }
  /** «Чат с поддержкой» (routes/supportChat.ts): per-account / per-IP limits of the players' messages for tests. */
  supportChatLimits?: Partial<SupportChatLimits>
  /** «Доступ Claude к заявкам» (routes/agentRequests.ts): per-key / per-address limits of the read-only key for tests. */
  requestsKeyLimits?: Partial<AgentRequestLimits>
}

/**
 * Per-IP limits (per minute) of the public endpoints that need no sign-in and each cost an upstream lookup or a large
 * answer: the catalog, and the player lookups (resolve + profile share one bucket). Generous for real clients.
 */
export const PUBLIC_RATE_LIMITS = { catalog: 120, players: 30, geo: 60 }

/**
 * Origins allowed by default: the app renderer dev server, the website, and the phone app's WebView
 * (Capacitor: https://localhost on Android, capacitor://localhost on iOS). Personal routes still need a Bearer token.
 */
export const DEFAULT_WEB_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5202,http://127.0.0.1:5202,https://localhost,capacitor://localhost'

/** What a client sees for any 5xx: the details go to the server log only. */
export const INTERNAL_ERROR = 'Внутренняя ошибка сервера'

/**
 * Which app build started this server (the owner app passes TARKOV_APP_* to the API process, electron/localServer.ts):
 * lets the owner app see an old server still holding the port. Absent when the server runs on its own.
 */
function buildInfo() {
  const env = process.env
  if (!env.TARKOV_APP_VERSION && !env.TARKOV_APP_COMMIT && !env.TARKOV_APP_BUILD) return {}
  return { build: { version: env.TARKOV_APP_VERSION ?? '', build: Number(env.TARKOV_APP_BUILD) || 0, commit: env.TARKOV_APP_COMMIT ?? '', edition: env.TARKOV_APP_EDITION ?? '' } }
}

const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/

/**
 * A request made on this PC straight to the API port: loopback socket and no forwarding header. Everything through the
 * website server (electron/siteProxy.ts always sets X-Forwarded-For) or the public link counts as from outside.
 */
export function directLocalRequest(req: express.Request) {
  if (req.get('x-forwarded-for') !== undefined || req.get('forwarded') !== undefined || req.get('cf-connecting-ip') !== undefined) return false
  return LOOPBACK.test(req.socket.remoteAddress ?? '')
}

export function createApi(store: ProgressStore, token?: string, accounts = new AccountStore(), options: ApiOptions = {}) {
  const userData = options.userData ?? new UserDataStore(openDatabase(':memory:'))
  const app = express()
  app.disable('x-powered-by')
  // The API listens on 127.0.0.1 and the public link reaches it through the app's site server (electron/localServer.ts),
  // which puts the visitor's address into X-Forwarded-For. Trusting only loopback proxies keeps per-IP rate limits per
  // visitor instead of one shared bucket for everybody, while a remote client still cannot fake its address.
  app.set('trust proxy', 'loopback')
  const guard = createServerGuard(accounts, options.guard)
  app.use(guard.middleware)
  // Answers are data, never pages: no MIME sniffing and no framing, on every response (errors and 404s included).
  app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); next() })
  // Everything under /v1/accounts is personal: set before any parsing, so unknown paths and errors are never cached.
  app.use('/v1/accounts', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  // WEB_ORIGIN may list several origins separated by commas (app renderer, website).
  app.use(cors({ origin: (process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGINS).split(',').map((origin) => origin.trim()).filter(Boolean) }))
  // «Сообщить об ошибке»: before the global JSON parser, because the upload (screenshots in base64, up to 25 MB) has its
  // own larger limit; everything else keeps the 1 MB limit below. The audit log is read lazily (created further down).
  // Every report also goes to the owner's mailbox as a PDF; the owner grants days for it in «Отчёты» (AdminStore.grant).
  const bugReports = new BugReportStore(accounts.database, { now: accounts.clock })
  const bugReportMail = new BugReportMailer(bugReports, options.bugReportMail?.sender, options.bugReportMail?.to, (message) => console.warn(message))
  // «Чат с поддержкой» (routes/supportChat.ts, mounted with the players' routes below): its unread conversations count on
  // the same «Заявки» badge.
  const supportChat = new SupportChatStore(accounts.database, { now: accounts.clock })
  // The owner app's «Заявки» badge waits here and moves the moment a report arrives or is closed, or a player writes to
  // the support chat (routes/bugReports.ts).
  const reportSignals = new MapUpdates(Date.now(), undefined, () => ({ open: bugReports.openCount(), unreadChats: supportChat.unreadThreads() }))
  app.use(createBugReportsRouter(accounts, bugReports, {
    limits: options.bugReportLimits,
    signals: reportSignals,
    audit: (actor, action, target, details) => { adminStore?.audit(actor, action, target, details) },
    mail: bugReportMail,
    grant: (actor, accountId, days, reason) => {
      if (!adminStore) throw new AccountError(503, 'Выдача подписки на этом сервере недоступна')
      adminStore.grant(actor, accountId, days, reason)
    },
  }))
  app.use(express.json({ limit: '1mb' }))
  app.use(guard.router)
  // Every running app waits on /v1/map-updates and re-reads the corrections as soon as the owner saves one, and the
  // Goons card as soon as anybody reports them (routes/mapUpdates.ts).
  const mapUpdates = new MapUpdates()
  // «Кочевники»: reported by a signed-in account; his Tarkov nickname (one for all modes) is shown to everybody.
  app.use('/v1/goons', createGoonsRouter(options.goons ?? new MemoryGoonStore(), {
    identify: (req) => {
      const id = accounts.authenticate(bearer(req.get('authorization')))
      if (!id) return null
      const nickname = accounts.view(id).nickname
      return { account: id, ...(nickname ? { nickname } : {}) }
    },
    nicknameOf: (account) => {
      try { return accounts.view(account).nickname ?? null } catch { return undefined }
    },
    onSighting: () => mapUpdates.changed(),
  }))
  // Payments share the accounts' database: the owner's admin panel joins accounts with payments and payouts.
  const payments = options.payments ?? new PaymentStore(accounts.database, undefined)
  const payouts = options.payouts ?? new PayoutStore(payments.database, payments)
  const adminStore = payments.database === accounts.database ? new AdminStore(accounts, payments) : undefined
  const invites = options.invites ?? (adminStore ? new InviteProgram(accounts, payments) : undefined)
  app.use('/v1/payments', createPaymentsRouter(accounts, payments, invites))
  if (invites) app.use('/v1/accounts', createInvitesRouter(accounts, invites, adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined))
  app.use(createPaymentSettingsRouter(accounts, payments, adminStore, options.ownerApp))
  // «Обновление» (owner only): status of the laptop's self-update and «Проверить сейчас» / «Откатить» (routes/selfUpdate.ts).
  // «Серверная версия» (owner only): a one-time 15-minute link to this laptop's exe (routes/serverDownload.ts).
  app.use(createServerDownloadRouter(accounts, { audit: (actor, action, details) => { try { adminStore?.audit(actor, action, undefined, details) } catch { /* the link works anyway */ } } }))
  app.use(createSelfUpdateRouter(accounts, { link: options.ownerApp, audit: (actor, action, details) => { try { adminStore?.audit(actor, action, undefined, details) } catch { /* the action itself already ran */ } } }))
  // «Админ-панель» (owner only); first, so it can also write the owner's older actions to the audit log.
  // Signed entitlements, the device limit and the owner's device list (docs/subscription-protection.md).
  const entitlements = options.entitlements ?? new EntitlementService(accounts)
  app.use('/v1', createEntitlementRouter(accounts, entitlements, adminStore))
  if (adminStore) app.use('/v1/accounts', createOwnerAdminRouter(accounts, adminStore))
  // Bosses the owner placed on the maps by hand: read by every player, written by the owner (routes/mapBosses.ts).
  app.use(createMapUpdatesRouter(mapUpdates))
  // Our copy of tarkov.dev's maps (services/mapMirror.ts), when this server keeps one.
  app.use(createMapTilesRouter(options.mapMirror))
  app.use(createDataMirrorRouter({ storage: options.mirrorStorage, datasets: options.dataMirror, prices: options.priceMirror, maps: options.mapMirror, legacyGraphql: options.legacyGraphql, priceHistory: options.priceHistory }))
  app.use(createItemImagesRouter(options.itemImageDir))
  app.use(createGuideImagesRouter(options.guideImages))
  app.use(createMapBossesRouter(accounts, new MapBossStore(accounts.database), adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined, () => mapUpdates.changed()))
  // Quest map points the owner corrected by hand (bug reports): read by every player, written by the owner (routes/questPoints.ts).
  app.use(createQuestPointsRouter(accounts, new QuestPointStore(accounts.database), adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined, () => mapUpdates.changed()))
  // Quest texts the owner corrected in the quest constructor: read by every player, written by the owner (routes/questTexts.ts).
  app.use(createQuestTextsRouter(accounts, new QuestTextStore(accounts.database), adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined, () => mapUpdates.changed()))
  // The server's quest base (services/questBase.ts): its versions, sources and changes, for the owner only.
  app.use(createQuestBaseRouter(accounts, options.questBase ?? currentQuestBase()))
  // The owner's notice over every app («ведутся технические работы»): every app waits here and shows it at once, in
  // Russian or in English by the reader's country (owner, 14.10.2026), so each answer reads it itself.
  const announcements = new AnnouncementStore(accounts.database)
  const announcementSignals = new MapUpdates()
  app.use(createAnnouncementRouter(accounts, announcements, announcementSignals, adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined, options.translateAnnouncement))
  // «Доступ Claude к заявкам» (owner, 14.10.2026): the owner's read-only key, and the players' reports read with it
  // without anything personal (routes/agentRequests.ts). Quest names come from the catalog the server has loaded.
  app.use(createAgentRequestsRouter(accounts, new RequestsKeyStore(accounts.database, { now: accounts.clock }), bugReports, {
    limits: options.requestsKeyLimits,
    catalog: options.catalog ?? peekCatalogSnapshot,
    audit: adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined,
  }))
  const emails = options.emails ?? new EmailAuthService(accounts)
  app.use('/v1/accounts', createAccountsRouter(accounts, { registrations: emails }))
  app.use('/v1/accounts', createPayoutsRouter(accounts, payouts))
  app.use('/v1/accounts', createLoginCodesRouter(accounts, options.loginCodes ?? new LoginCodeStore()))
  const phones = options.phones ?? new PhoneAuthService(accounts)
  app.use('/v1/accounts', createPhoneRouter(accounts, phones, { extraConfig: () => emails.publicConfig() }))
  app.use('/v1/accounts', createEmailRouter(accounts, emails))
  app.use('/v1/admin', createAdminRouter(accounts, undefined, phones, emails))
  // Friend requests, squad invitations and squad mates' progress reach the other apps at once (services/socialSignals.ts).
  const socialSignals = new SocialSignals()
  // «Чат с поддержкой»: before /v1/me, whose router answers every other path under it. The owner's answer reaches the
  // player's app through the social events, a player's message the owner app through the «Заявки» wait.
  app.use(createSupportChatRouter(accounts, supportChat, {
    limits: options.supportChatLimits,
    social: socialSignals,
    ownerSignals: reportSignals,
    now: accounts.clock,
    audit: adminStore ? (actor, action, target, details) => adminStore.audit(actor, action, target, details) : undefined,
  }))
  let circle: (accountId: string) => string[] = (accountId) => [accountId]
  app.use('/v1/me', createMeRouter(accounts, store, userData, { catalog: options.catalog ?? peekCatalogSnapshot, social: { signals: socialSignals, circle: (accountId) => circle(accountId) } }))
  circle = mountSocial(app, accounts, store, { catalog: options.catalog ?? peekCatalogSnapshot, squadLimits: options.squadLimits, friendLimits: options.friendLimits, signals: socialSignals, playerProfile: options.playerProfile ?? fetchPlayerProfile, sharedLevels: (accountId) => userData.getLevels(accountId) })
  // `database`: a cheap SELECT 1 on the accounts' database, for the owner app's status lamps (electron/serverWatchdog.ts).
  // Additive: `ok` stays true for older clients; a failing database answers 503 so monitors see it.
  // Build, version and flags only for this PC's own direct checks (electron/localServer.ts apiHealth); through the site
  // proxy / public link (X-Forwarded-For) only what the status lamps and clients read: ok, service, database.
  app.get('/health', (req, res) => {
    let database = true
    try { accounts.database.prepare('SELECT 1 AS ok').get() } catch { database = false }
    const status = database ? 200 : 503
    if (!directLocalRequest(req)) { res.status(status).json({ ok: database, service: 'tarkov-operations-api', database }); return }
    res.status(status).json({ ok: database, service: 'tarkov-operations-api', version: '0.3.0', syncRequiresToken: true, accounts: true, database, ...buildInfo() })
  })
  app.post('/v1/sync/events', (req, res) => {
    const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (!token || Buffer.byteLength(token) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied))) {
      res.status(401).json({ error: 'Требуется авторизация устройства' }); return
    }
    // Development owner only. Public accounts require per-user sessions before deployment.
    res.json(store.sync('local-development', syncSchema.parse(req.body)))
  })
  // Per IP (req.ip is the visitor behind the site proxy, see `trust proxy` above); counted before validation.
  const limits = { ...PUBLIC_RATE_LIMITS, ...options.rateLimits }
  const perIp = (name: keyof typeof PUBLIC_RATE_LIMITS): express.RequestHandler => {
    const limiter = new FixedWindowRateLimiter(limits[name], 60 * 1000)
    return (req, res, next) => {
      const retry = limiter.hit(`${name}:${req.ip ?? 'unknown'}`)
      if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
      next()
    }
  }
  const players = perIp('players')
  // Game data only for signed-in accounts with access on an active device (402 «Нужна подписка» otherwise): the
  // players' app gets everything from tarkov.dev through these routes (routes/data.ts). The website needs none of them.
  const paid = requireDataAccess(accounts, entitlements, options.dataRateLimits)
  app.use('/v1/data', createDataRouter(options.data ?? new DataGateway({ mirror: options.mirrorStorage, priceHistory: options.priceHistory }), paid, options.mirrorStorage, options.priceHistory))
  // The website picks its language on the first visit by the visitor's country (owner, 11.10.2026): Cloudflare's
  // CF-IPCountry as two letters, or null (no Cloudflare in front, unknown, Tor). Nothing is stored or logged.
  app.get('/v1/geo', perIp('geo'), (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ country: countryCode(proxiedCountry(req)) ?? null })
  })
  const catalogAnswer = options.catalogSnapshot ? createCatalogAnswers({ snapshot: options.catalogSnapshot }).get : getCatalogAnswer
  app.get('/v1/catalog/:mode', perIp('catalog'), paid, async (req, res) => {
    const lang = z.enum(['ru', 'en']).default('ru').parse(req.query.lang ?? undefined)
    // Prepared once per quest base version, price generation and image set (services/catalogAnswers.ts): the bytes and
    // their ETag are kept, nothing is stringified or hashed here.
    const answer = await catalogAnswer(modeSchema.parse(req.params.mode), lang)
    // The catalog's content version: an app that sends it back (If-None-Match) while nothing changed gets an empty «304
    // Not Modified». The access check above runs first either way.
    res.set('ETag', answer.etag)
    if (catalogNotModified(req.get('if-none-match'), answer.etag)) { res.status(304).end(); return }
    res.type('application/json').send(answer.body)
  })
  app.post('/v1/players/resolve', players, paid, async (req, res) => {
    // `accountId`: the account the desktop app read from this player's own game logs (optional).
    const body = z.object({ mode: modeSchema, nickname: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,15}$/), accountId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).parse(req.body)
    res.json(await resolvePlayer(body.mode, body.nickname, body.accountId))
  })
  app.get('/v1/players/:mode/:accountId', players, paid, async (req, res) => res.json(await fetchPlayerProfile(modeSchema.parse(req.params.mode), z.coerce.number().int().positive().parse(req.params.accountId))))
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next
    const raw = error instanceof z.ZodError ? 400 : typeof error === 'object' && error && 'status' in error ? Number(error.status) : 502
    const status = raw >= 400 && raw < 600 ? raw : 502
    if (status >= 500) {
      // Internal details (messages, paths, upstream answers) stay in the server log (api.log); request bodies are never logged.
      console.error(`API ${req.method} ${req.path} -> ${status}:`, error instanceof Error ? error.stack ?? error.message : error)
      // «Отчёты об ошибках (GitHub)»: the owner app sanitizes and deduplicates it (electron/errorReporter.ts).
      reportErrorToOwnerApp('5xx', error, { method: req.method, path: req.path, status })
      res.status(status).json({ error: INTERNAL_ERROR })
      return
    }
    res.status(status).json({ error: error instanceof z.ZodError ? 'Некорректные данные запроса' : error instanceof Error ? error.message : 'Сервис временно недоступен' })
  })
  return app
}
