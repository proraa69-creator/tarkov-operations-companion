/**
 * Per-user data API, mounted at `/v1/me`. Every route needs `Authorization: Bearer <session token>` from
 * POST /v1/accounts/login. PvP, PvE and Seasonal data are stored and returned separately.
 *
 *   GET  /progress/:mode                 -> { revision, records, coverage, scope: { accountId, characterId, syncedAt, resetAt? } | null }
 *   POST /progress/:mode/events          { accountId?, characterId?, resetAt?, events[] } -> merged records and the scope
 *   POST /progress/:mode/reset           { at?, floor? } -> { resetAt, scope } («Престиж +» / a nickname change: the whole mode
 *                                        starts again; its older quest events, story chapters, objectives, Collector
 *                                        checklist and shared level go, other modes stay)
 *   GET  /story/:mode?characterId=       -> { characterId, records: [{ chapterId, status, stageId?, updatedAt }] }
 *   POST /story/:mode                    { characterId?, records[] } -> the same, the newer readings kept
 *   GET  /collector/:mode                -> { itemIds, updatedAt }
 *   PUT  /collector/:mode                { itemIds } -> { itemIds, updatedAt }
 *   GET  /hideout/:mode                  -> { found: { itemId: pieces }, updatedAt } («Убежище»: items found for the hideout)
 *   PUT  /hideout/:mode                  { found } -> { found, updatedAt }
 *   GET  /items/:mode/:kind              -> { found, updatedAt } (kind 'quests': put aside for the quests; 'stash': the last scan)
 *   PUT  /items/:mode/:kind              { found } -> { found, updatedAt }
 *   GET  /features                       -> { features: { questTableScan: until | null } } (functions on for this account
 *                                        only, for a while: services/trialFeatures.ts)
 *   GET  /game-mode                      -> { gameMode: { mode, at, receivedAt } | null } (the game's mode on the PC)
 *   PUT  /game-mode                      { mode, at } -> { gameMode } (a later switch wins; the phone follows it)
 *   GET  /position/:mode                 -> { position | null } (the newer of the stored one and the live one, routes/live.ts)
 *   POST /position/:mode                 { x, y, z, yaw, at, map? } -> { position } (only the latest is kept; the apps
 *                                        with the in-game overlays; the newer ones publish to /v1/live, which stores nothing)
 *   GET  /settings                       -> { settings, updatedAt }
 *   PUT  /settings                       { settings } -> { settings, updatedAt } (max 16 KB)
 *   GET  /levels                         -> { modes } (the levels the account's desktop app shared: the phone shows the same)
 *   PUT  /levels                         { modes: { pvp?|pve?|seasonal?: { level, prestige | null, observedAt } } }
 *                                        -> { modes } (the desktop app's own levels; friends see them, routes/friends.ts)
 *   GET  /progress/:mode/manual          -> { marks } («Ручная отметка» of the mode)
 *   POST /progress/:mode/manual          { marks: [{ taskId, status: active|completed|cleared, at }] } -> { marks }
 *   GET  /deferred-quests/:mode          -> { quests, resetAt? } («Отложенные квесты» of the mode, on every device of the account)
 *   POST /deferred-quests/:mode          { quests: [{ taskId, status: deferred|returned, at, until?, level?, loyalty? }] } -> { quests, resetAt? };
 *                                        newest per quest, nothing older than the mode's last reset (`resetAt`)
 *   GET  /summary                        -> per-mode counts for the website cabinet
 *   GET  /objectives/:mode               -> { objectives, events, updatedAt } (objective progress and its history)
 *   POST /objectives/:mode/sync          { objectives[], events[] } -> merged { objectives, events, updatedAt }
 *   POST /objectives/:mode/events/:eventId/undo -> merged state; 404 when this account has no such event
 *
 * Request bodies are never logged. Responses are personal: `Cache-Control: no-store`.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { AppDataset, RaidMode } from '../models/api.js'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { ProgressStore } from '../services/progressStore.js'
import { mergedCounts, mergedList, type UserDataStore } from '../services/userDataStore.js'
import { PlayerStateStore, STATE_LIMITS, type StateRow } from '../services/playerStateStore.js'
import { ObjectiveLimitError, ObjectiveStore } from '../services/objectiveStore.js'
import type { SocialSignals } from '../services/socialSignals.js'
import { resolvedRecords } from '../services/sharedProgress.js'
import type { LiveRelay } from '../services/liveRelay.js'
import { trialFeatures, type TrialFeatureStore } from '../services/trialFeatures.js'
import { collectorEntries } from '../../../src/kappa/collector'
import { ENTITY_ID_PATTERN, EVENT_ID_PATTERN, OBJECTIVE_TYPE_PATTERN } from '../../../src/progression/objectiveProgress'

export const RAID_MODES = ['pvp', 'pve', 'seasonal'] as const
export const SETTINGS_MAX_BYTES = 16 * 1024
const modeSchema = z.enum(RAID_MODES)
const hexId = z.string().regex(/^[a-f0-9]{24}$/i)
const isoTime = z.string().datetime().transform((date) => new Date(date).toISOString())

const eventsSchema = z.object({
  accountId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  characterId: hexId.optional(),
  resetAt: isoTime.optional(),
  events: z.array(z.object({ taskId: hexId, status: z.enum(['active', 'completed', 'failed']), timestamp: isoTime })).max(2000),
}).strict()
const resetSchema = z.object({ at: isoTime.optional(), floor: isoTime.optional() }).strict()
/** «Ручная отметка»: the marks of one mode (a few hundred at most: one per quest). */
const manualSchema = z.object({
  marks: z.array(z.object({ taskId: z.string().regex(ENTITY_ID_PATTERN), status: z.enum(['active', 'completed', 'cleared', 'absent']), at: isoTime }).strict()).max(1000),
}).strict()
/** «Отложенные квесты»: what one device knows of a mode (one per quest), with the term a quest comes back at. */
const deferredSchema = z.object({
  quests: z.array(z.object({
    taskId: z.string().regex(ENTITY_ID_PATTERN),
    status: z.enum(['deferred', 'returned']),
    at: isoTime,
    until: isoTime.optional(),
    level: z.number().int().min(1).max(1000).optional(),
    loyalty: z.object({ traderId: z.string().min(1).max(64), trader: z.string().max(60), level: z.number().int().min(1).max(10) }).strict().optional(),
  }).strict()).max(1000),
}).strict()
/**
 * `base`: the list as this device last agreed with the server. Only what it changed since then goes on top of the account's copy, so
 * another device's change is not lost. An older app sends none and replaces the list, as it always did.
 */
const collectorSchema = z.object({
  itemIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(1000),
  base: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(1000).optional(),
}).strict()
const foundSchema = z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.number().int().min(0).max(100_000))
  .refine((found) => Object.keys(found).length <= 2000, 'Слишком много предметов')
const hideoutSchema = z.object({ found: foundSchema, base: foundSchema.optional() }).strict()
/** The player's own lists (services/playerStateStore.ts): one row per item, null when it was taken off. */
const stateSchema = z.object({
  since: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  items: z.array(z.object({
    kind: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    mode: z.enum(['', 'pvp', 'pve', 'seasonal']),
    item: z.string().min(1).max(300),
    at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    value: z.unknown().refine((value) => value !== undefined),
  }).strict()).max(STATE_LIMITS.itemsPerSync),
}).strict()
/** What a reset of the mode wipes on a device (src/state/modeReset.ts): an older app's press reaches the newer devices too. */
const STATE_KINDS_OF_A_RESET = ['quest-checks', 'quest-key-favorites', 'hideout-levels', 'item-counts', 'story-marks', 'trader-levels', 'trader-screen']
/** Story chapters per character (the screen reads them; the game does not log them): a few dozen at most. */
const storyRecordSchema = z.object({
  chapterId: z.string().regex(ENTITY_ID_PATTERN),
  status: z.enum(['active', 'completed']),
  stageId: z.string().regex(ENTITY_ID_PATTERN).optional(),
  updatedAt: isoTime,
}).strict()
const storySchema = z.object({ characterId: hexId.optional(), records: z.array(storyRecordSchema).max(200) }).strict()
/**
 * The PC's quest decisions of a mode (src/sync/questMirror.ts, same limits): every quest it holds a record of, with a
 * story chapter's stage and the objectives read on its pane.
 */
const mirrorText = z.string().max(400)
const mirrorObjectiveSchema = z.object({
  id: z.string().min(1).max(120), text: mirrorText, optional: z.boolean(), completed: z.boolean(),
  stageIndex: z.number().int().min(0).max(100_000).optional(), current: z.number().int().min(0).max(100_000).optional(),
  total: z.number().int().min(0).max(100_000).optional(), hint: mirrorText.optional(),
}).strict()
const mirrorRecordSchema = z.object({
  taskId: z.string().regex(ENTITY_ID_PATTERN),
  status: z.enum(['active', 'completed', 'failed']),
  source: z.enum(['manual', 'manual-fix', 'eft-log', 'profile-import', 'backup', 'migration', 'inferred', 'screen-scan']),
  updatedAt: isoTime,
  origin: z.literal('server').optional(),
  inferredFromTaskId: z.string().regex(ENTITY_ID_PATTERN).optional(),
  currentStageIndex: z.number().int().min(0).max(100_000).optional(),
  storyObjectives: z.array(mirrorObjectiveSchema).max(40).optional(),
}).strict()
const questMirrorProfileSchema = z.object({
  playerLevel: z.number().int().min(1).max(79).optional(),
  faction: z.enum(['usec', 'bear', 'unknown']).optional(),
  prestige: z.number().int().min(0).max(10).optional(),
  trackedTaskIds: z.array(z.string().regex(ENTITY_ID_PATTERN)).max(500).optional(),
}).strict()
const questMirrorSchema = z.object({
  at: isoTime,
  profile: questMirrorProfileSchema.optional(),
  records: z.record(z.string().regex(ENTITY_ID_PATTERN), mirrorRecordSchema)
    .refine((records) => Object.keys(records).length <= 3000, 'Слишком много квестов')
    .refine((records) => Object.entries(records).every(([taskId, record]) => record.taskId === taskId), 'Некорректные данные запроса'),
}).strict()
const gameModeSchema = z.object({ mode: z.enum(['pvp', 'pve', 'seasonal']), at: isoTime }).strict()
const coordinate = z.number().finite().min(-100_000).max(100_000)
const positionSchema = z.object({
  x: coordinate, y: coordinate, z: coordinate,
  yaw: z.number().finite().min(-3600).max(3600),
  at: z.number().int().positive(),
  map: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
}).strict()
const settingsSchema = z.object({ settings: z.record(z.string().max(64), z.unknown()) }).strict()
/** The game's level cap and a sane prestige range. A null prestige: the app does not know it. */
const MAX_SHARED_LEVEL = 79
const MAX_SHARED_PRESTIGE = 10
const sharedLevelSchema = z.object({
  level: z.number().int().min(1).max(MAX_SHARED_LEVEL),
  prestige: z.number().int().min(0).max(MAX_SHARED_PRESTIGE).nullable(),
  observedAt: isoTime,
}).strict()
const levelsSchema = z.object({
  modes: z.object({ pvp: sharedLevelSchema.optional(), pve: sharedLevelSchema.optional(), seasonal: sharedLevelSchema.optional() }).strict(),
}).strict()

/** Task / objective ids: tarkov.dev hex ids, story and wiki ids (letters of any script, digits, a few separators). */
const entityId = z.string().regex(ENTITY_ID_PATTERN)
const eventId = z.string().regex(EVENT_ID_PATTERN)
const objectiveSource = z.enum(['log', 'ocr', 'manual', 'sync'])
const count = z.number().int().min(0).max(100_000)
const confidence = z.number().finite().min(0).max(1)
const eventValue = z.union([count, z.enum(['active', 'completed', 'failed']), z.null()])
const objectiveSchema = z.object({
  objectiveId: entityId, taskId: entityId, type: z.string().regex(OBJECTIVE_TYPE_PATTERN),
  target: count.min(1), current: count, completedAt: isoTime.optional(),
  source: objectiveSource, confidence, observedAt: isoTime,
}).strict()
const eventSchema = z.object({
  id: eventId, mode: modeSchema.optional(), taskId: entityId, objectiveId: entityId.optional(),
  eventType: z.enum(['objective', 'task-status', 'undo', 'conflict-resolved']),
  oldValue: eventValue, newValue: eventValue, source: objectiveSource, confidence, observedAt: isoTime,
  reversible: z.boolean(), undoneAt: isoTime.optional(), refersTo: eventId.optional(), synced: z.boolean().optional(),
}).strict()
export const OBJECTIVES_PER_SYNC = 2000
export const EVENTS_PER_SYNC = 1000
const objectivesSyncSchema = z.object({
  objectives: z.array(objectiveSchema).max(OBJECTIVES_PER_SYNC),
  events: z.array(eventSchema).max(EVENTS_PER_SYNC),
}).strict()

export type CatalogPeek = (mode: RaidMode) => AppDataset | undefined

export interface MeRouterOptions {
  /** Returns the server-side catalog if it is already loaded; used for Kappa and Collector totals. */
  catalog?: CatalogPeek
  /** Objective progress and history; defaults to a store on the user-data database. */
  objectives?: ObjectiveStore
  /** Requests per account per window. Default 1200 per 10 minutes (a position every 2 s fits easily). */
  rateLimit?: { max: number; windowMs: number }
  now?: () => number
  /** Instant updates for friends and squad mates (services/socialSignals.ts): who sees this account's progress. */
  social?: { signals: SocialSignals; circle: (accountId: string) => string[] }
  /**
   * The live position the new PC apps publish (services/liveRelay.ts): an older phone polling GET /position sees it too,
   * and a position an older PC posts here reaches the new phones at once.
   */
  live?: LiveRelay
  /** Functions the owner turned on for one account for a while («Админ панель» → «Функции», services/trialFeatures.ts). */
  trials?: TrialFeatureStore
  /** Writes of the player's own lists per account. Default 600 per 10 minutes: a change goes out in one write, whatever it holds. */
  stateRateLimit?: { max: number; windowMs: number }
}

export interface ModeSummary {
  quests: { completed: number; active: number; failed: number }
  kappa: { completed: number; total: number } | null
  collector: { collected: number; total: number | null; updatedAt: string | null }
  lastSyncAt: string | null
  lastPosition: { at: string; receivedAt: string; map?: string } | null
}

export function createMeRouter(accounts: AccountStore, progress: ProgressStore, userData: UserDataStore, options: MeRouterOptions = {}) {
  const router = express.Router()
  const limit = options.rateLimit ?? { max: 1200, windowMs: 10 * 60 * 1000 }
  const limiter = new FixedWindowRateLimiter(limit.max, limit.windowMs, options.now)
  const ipLimiter = new FixedWindowRateLimiter(limit.max * 3, limit.windowMs, options.now)
  const owner = (accountId: string) => `user:${accountId}`
  const objectives = options.objectives ?? new ObjectiveStore(userData.database)
  const playerState = new PlayerStateStore(userData.database)
  const stateRate = options.stateRateLimit ?? { max: 600, windowMs: 10 * 60 * 1000 }
  const stateLimiter = new FixedWindowRateLimiter(stateRate.max, stateRate.windowMs, options.now)
  if (options.social) options.social.signals.stateRevOf = (accountId) => playerState.rev(accountId)

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const ipRetry = ipLimiter.hit(`ip:${req.ip ?? 'unknown'}`)
    if (ipRetry) { res.status(429).set('Retry-After', String(ipRetry)).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
    const accountId = accounts.authenticate(bearer(req.get('authorization')))
    if (!accountId) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return }
    const retry = limiter.hit(`me:${accountId}`)
    if (retry) { res.status(429).set('Retry-After', String(retry)).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
    res.locals.accountId = accountId
    next()
  })

  const bad = (res: Response, message = 'Некорректные данные запроса') => { res.status(400).json({ error: message }) }
  const account = (res: Response) => String(res.locals.accountId)
  const mode = (req: Request) => modeSchema.safeParse(req.params.mode)
  // Only for what a write really kept (owner, 05.11.2026, the server's load): an app reloads on this signal and a reload syncs
  // again, so a signal on every sync sent ~200 apps round in a circle every 1 to 3 s, 13 million requests a day against 1.5.
  const progressChanged = (accountId: string) => { if (options.social) options.social.signals.changed(options.social.circle(accountId)) }
  // An empty list after a reset is the list; an empty one never sent says nothing (a device then sends its own, never loses it).
  const resetOf = (accountId: string, raidMode: RaidMode) => { const resetAt = userData.modeResetAt(accountId, raidMode); return resetAt ? { resetAt } : {} }

  router.get('/progress/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json(progress.userRecords(owner(account(res)), parsed.data))
  })

  router.post('/progress/:mode/events', (req, res) => {
    const parsed = mode(req)
    const body = eventsSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    res.json(progress.syncUser(owner(account(res)), parsed.data, body.data))
    // A quest started or handed in: friends and squad mates (and this account's other devices) reload at once.
    progressChanged(account(res))
  })

  // «Престиж +», «Вайп», «Сброс» or a nickname change in the app (src/state/modeReset.ts): the account's copy of one mode
  // is wiped (the app sends its logs again right after). `floor`: nothing older counts any more («Престиж +», «Вайп»).
  router.post('/progress/:mode/reset', (req, res) => {
    const parsed = mode(req)
    const body = resetSchema.safeParse(req.body ?? {})
    if (!parsed.success || !body.success) { bad(res); return }
    const now = (options.now ?? Date.now)()
    const answer = progress.resetMode(owner(account(res)), parsed.data, body.data.at ?? new Date(now).toISOString(), now, body.data.floor)
    objectives.dropBefore(owner(account(res)), parsed.data, answer.resetAt)
    userData.clearModeBefore(account(res), parsed.data, answer.resetAt)
    const wiped = playerState.clearModeBefore(account(res), parsed.data, STATE_KINDS_OF_A_RESET, Date.parse(answer.resetAt))
    res.json(answer)
    progressChanged(account(res))
    if (wiped) options.social?.signals.stateChanged(account(res))
  })

  // «Ручная отметка» (owner, 15.10.2026): the player's own marks of the mode, newest per quest; every kept one comes back.
  router.get('/progress/:mode/manual', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json({ marks: progress.manualMarks(owner(account(res)), parsed.data) })
  })

  router.post('/progress/:mode/manual', (req, res) => {
    const parsed = mode(req)
    const body = manualSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    res.json(progress.syncManualMarks(owner(account(res)), parsed.data, body.data.marks, (options.now ?? Date.now)(), () => progressChanged(account(res))))
  })

  // «Отложенные квесты» (owner, 04.11.2026; a player's report: put aside on the PC, still shown on the phone).
  router.get('/deferred-quests/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json(userData.getDeferredQuests(account(res), parsed.data))
  })

  router.post('/deferred-quests/:mode', (req, res) => {
    const parsed = mode(req)
    const body = deferredSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    // Only this account's own devices: friends see nothing of it.
    res.json(userData.syncDeferredQuests(account(res), parsed.data, body.data.quests, (options.now ?? Date.now)(), () => options.social?.signals.changed([account(res)])))
  })

  router.get('/story/:mode', (req, res) => {
    const parsed = mode(req)
    const characterId = req.query.characterId === undefined ? undefined : hexId.safeParse(req.query.characterId)
    if (!parsed.success || (characterId && !characterId.success)) { bad(res); return }
    res.json(progress.storyRecords(owner(account(res)), parsed.data, characterId?.data))
  })

  router.post('/story/:mode', (req, res) => {
    const parsed = mode(req)
    const body = storySchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    res.json(progress.syncStory(owner(account(res)), parsed.data, body.data, (options.now ?? Date.now)(), () => progressChanged(account(res))))
  })

  // «Моментально»: waits up to ~25 s for anything new among this account's friends and squad (services/socialSignals.ts).
  router.get('/social-events', (req, res) => {
    const since = typeof req.query.since === 'string' && /^\d{1,16}$/.test(req.query.since) ? Number(req.query.since) : undefined
    // `state`: the counter of the player's own lists this app last heard; an older app does not send it.
    const state = typeof req.query.state === 'string' && /^\d{1,16}$/.test(req.query.state) ? Number(req.query.state) : undefined
    if ((req.query.since !== undefined && since === undefined) || (req.query.state !== undefined && state === undefined)) { bad(res); return }
    if (!options.social) { res.json({ version: 0 }); return }
    options.social.signals.wait(res, account(res), since, state)
  })

  // The player's own lists (services/playerStateStore.ts, src/sync/playerState.ts): what changed after `since`.
  router.get('/state', (req, res) => {
    const since = req.query.since === undefined ? 0 : typeof req.query.since === 'string' && /^\d{1,16}$/.test(req.query.since) ? Number(req.query.since) : -1
    if (since < 0) { bad(res); return }
    res.json({ ...playerState.changesSince(account(res), since), now: (options.now ?? Date.now)() })
  })

  // A change goes in, the account's other devices hear of it at once, and only if something was really kept.
  router.post('/state', (req, res) => {
    const retry = stateLimiter.hit(`state:${account(res)}`)
    if (retry) { res.status(429).set('Retry-After', String(retry)).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return }
    const body = stateSchema.safeParse(req.body)
    if (!body.success) { bad(res); return }
    const answer = playerState.sync(account(res), body.data.since, body.data.items as StateRow[], (options.now ?? Date.now)())
    res.json(answer)
    if (answer.kept) options.social?.signals.stateChanged(account(res))
  })

  router.get('/collector/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json({ ...userData.getCollector(account(res), parsed.data), ...resetOf(account(res), parsed.data) })
  })

  router.put('/collector/:mode', (req, res) => {
    const parsed = mode(req)
    const body = collectorSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    const kept = userData.getCollector(account(res), parsed.data)
    const itemIds = body.data.base ? mergedList(kept.itemIds, body.data.itemIds, body.data.base).slice(0, 1000) : body.data.itemIds
    res.json(userData.setCollector(account(res), parsed.data, itemIds))
    // The account's other devices (the PC while a phone ticks, and back) reload it at once (owner, 17.10.2026).
    progressChanged(account(res))
  })

  router.get('/hideout/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json({ ...userData.getHideout(account(res), parsed.data), ...resetOf(account(res), parsed.data) })
  })

  router.put('/hideout/:mode', (req, res) => {
    const parsed = mode(req)
    const body = hideoutSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    const kept = userData.getHideout(account(res), parsed.data)
    res.json(userData.setHideout(account(res), parsed.data, body.data.base ? mergedCounts(kept.found, body.data.found, body.data.base) : body.data.found))
    progressChanged(account(res))
  })

  // Pieces put aside for the quests and what the last screen scan saw in the stash (owner, 31.10.2026).
  const itemKind = (req: express.Request) => z.enum(['quests', 'stash']).safeParse(req.params.kind)
  router.get('/items/:mode/:kind', (req, res) => {
    const parsed = mode(req)
    const kind = itemKind(req)
    if (!parsed.success || !kind.success) { bad(res); return }
    res.json({ ...userData.getItemCounts(account(res), parsed.data, kind.data), ...resetOf(account(res), parsed.data) })
  })

  router.put('/items/:mode/:kind', (req, res) => {
    const parsed = mode(req)
    const kind = itemKind(req)
    const body = hideoutSchema.safeParse(req.body)
    if (!parsed.success || !kind.success || !body.success) { bad(res); return }
    const kept = userData.getItemCounts(account(res), parsed.data, kind.data)
    res.json(userData.setItemCounts(account(res), parsed.data, kind.data, body.data.base ? mergedCounts(kept.found, body.data.found, body.data.base) : body.data.found))
    progressChanged(account(res))
  })

  // The PC's quests as it shows them (src/sync/questMirror.ts): the phone shows the same, and reloads at once.
  router.get('/quest-mirror/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json({ mirror: userData.getQuestMirror(account(res), parsed.data) })
  })

  router.put('/quest-mirror/:mode', (req, res) => {
    const parsed = mode(req)
    const body = questMirrorSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    // Client clocks drift: a copy from the future counts as made now.
    const now = new Date((options.now ?? Date.now)()).toISOString()
    const at = body.data.at > now ? now : body.data.at
    const kept = userData.getQuestMirror(account(res), parsed.data)
    const mirror = userData.setQuestMirror(account(res), parsed.data, at, body.data.records, body.data.profile)
    res.json({ mirror: { at: mirror.at, receivedAt: mirror.receivedAt, count: Object.keys(mirror.records).length } })
    if (!kept || kept.at !== mirror.at) progressChanged(account(res))
  })

  // The mode the game is in on the PC (its logs): the phone switches to it (owner, 20.10.2026), and reloads at once.
  router.get('/features', (_req, res) => { res.json({ features: trialFeatures(accounts.emailOf(account(res)), (options.now ?? accounts.clock)(), options.trials, account(res)) }) })

  router.get('/game-mode', (_req, res) => { res.json({ gameMode: userData.getGameMode(account(res)) }) })

  router.put('/game-mode', (req, res) => {
    const body = gameModeSchema.safeParse(req.body)
    if (!body.success) { bad(res); return }
    // Client clocks drift: a switch from the future counts as made now.
    const now = new Date((options.now ?? Date.now)()).toISOString()
    const at = body.data.at > now ? now : body.data.at
    const kept = userData.getGameMode(account(res))
    const saved = userData.setGameMode(account(res), body.data.mode, at)
    res.json({ gameMode: saved })
    if (!kept || kept.at !== saved.at) { progressChanged(account(res)); options.live?.gameModeChanged(account(res)) }
  })

  router.get('/position/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    const stored = userData.getPosition(account(res), parsed.data)
    const live = options.live?.position(account(res), parsed.data) ?? null
    res.json({ position: live && (!stored || live.at >= stored.at) ? live : stored })
  })

  router.post('/position/:mode', (req, res) => {
    const parsed = mode(req)
    const body = positionSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    // Client clocks drift; a capture time far in the future is clamped to the server time.
    const now = (options.now ?? Date.now)()
    const at = Math.min(body.data.at, now + 60_000)
    options.live?.setPosition(account(res), parsed.data, { ...body.data, at })
    res.status(201).json({ position: userData.setPosition(account(res), parsed.data, { ...body.data, at }) })
  })

  router.get('/settings', (_req, res) => { res.json(userData.getSettings(account(res))) })

  router.put('/settings', (req, res) => {
    const body = settingsSchema.safeParse(req.body)
    if (!body.success) { bad(res); return }
    if (Buffer.byteLength(JSON.stringify(body.data.settings)) > SETTINGS_MAX_BYTES) { res.status(413).json({ error: 'Настройки слишком большие' }); return }
    res.json(userData.setSettings(account(res), body.data.settings))
  })

  // «Информация о друге» (owner, 12.10.2026: «уровни во всех режимах, значок престижа»): each mode's level as this
  // account's desktop app knows it — from the game's screens or its own Tarkov.dev lookup, plus the quest experience
  // since. Friends see it before the public profile (routes/friends.ts). A mode sent replaces that mode; the rest stay.
  // The phone reads no game screens: it takes the level its PC shared, so quest availability matches the PC's.
  router.get('/levels', (_req, res) => { res.json({ modes: userData.getLevels(account(res)) }) })

  router.put('/levels', (req, res) => {
    const body = levelsSchema.safeParse(req.body)
    if (!body.success) { bad(res); return }
    // A PC clock running ahead must not show friends a level «updated» in the future.
    const now = new Date((options.now ?? Date.now)()).toISOString()
    const modes: Parameters<UserDataStore['setLevels']>[1] = {}
    for (const raidMode of RAID_MODES) {
      const entry = body.data.modes[raidMode]
      if (entry) modes[raidMode] = { level: entry.level, prestige: entry.prestige, observedAt: entry.observedAt > now ? now : entry.observedAt }
    }
    res.json({ modes: userData.setLevels(account(res), modes) })
    progressChanged(account(res))
  })

  router.get('/objectives/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json(objectives.get(owner(account(res)), parsed.data))
  })

  router.post('/objectives/:mode/sync', (req, res) => {
    const parsed = mode(req)
    const body = objectivesSyncSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    // A client clock far in the future must not make its values «newer» than everything else for good.
    const latest = new Date((options.now ?? Date.now)() + 60_000).toISOString()
    const clamp = (time: string) => time > latest ? latest : time
    // Nothing from before the character's last reset comes back (an app that has not heard of it yet).
    const resetAt = progress.scope(owner(account(res)), parsed.data)?.resetAt
    const fresh = (time: string) => !resetAt || time >= resetAt
    // A value held back to the server's clock counts as newer at every sync: it says nothing, as in progress.syncStory.
    const ahead = body.data.objectives.some((entry) => entry.observedAt > latest)
    try {
      res.json(objectives.sync(owner(account(res)), parsed.data, {
        objectives: body.data.objectives.filter((entry) => fresh(entry.observedAt)).map((entry) => ({ ...entry, observedAt: clamp(entry.observedAt), ...(entry.completedAt ? { completedAt: clamp(entry.completedAt) } : {}) })),
        events: body.data.events.filter((entry) => fresh(entry.observedAt)).map((entry) => ({ ...entry, synced: undefined, mode: parsed.data, observedAt: clamp(entry.observedAt), ...(entry.undoneAt ? { undoneAt: clamp(entry.undoneAt) } : {}) })),
      }, ahead ? undefined : () => progressChanged(account(res))))
    } catch (error) {
      if (error instanceof ObjectiveLimitError) { res.status(413).json({ error: error.message }); return }
      throw error
    }
  })

  router.post('/objectives/:mode/events/:eventId/undo', (req, res) => {
    const parsed = mode(req)
    const id = eventId.safeParse(req.params.eventId)
    if (!parsed.success || !id.success) { bad(res); return }
    const result = objectives.undo(owner(account(res)), parsed.data, id.data)
    if (result.status === 'not-found') { res.status(404).json({ error: 'Событие не найдено' }); return }
    if (result.status === 'not-undoable') { res.status(409).json({ error: 'Это изменение нельзя отменить' }); return }
    res.json(result.snapshot)
  })

  router.get('/summary', (_req, res) => {
    const accountId = account(res)
    const view = accounts.view(accountId)
    const modes = Object.fromEntries(RAID_MODES.map((raidMode) => [raidMode, summarizeMode(raidMode)])) as Record<RaidMode, ModeSummary>
    res.json({ account: { email: view.email, kind: view.kind, ...(view.nickname ? { nickname: view.nickname } : {}), nicknames: view.nicknames }, modes, generatedAt: new Date().toISOString() })

    function summarizeMode(raidMode: RaidMode): ModeSummary {
      const { records, scope } = progress.userRecords(owner(accountId), raidMode)
      // Decided as the player's app decides (src/quests/questEngine.ts): the logs of every PC and the manual marks.
      const decided = resolvedRecords(progress, owner(accountId), raidMode, records, scope?.resetAt)
      const quests = { completed: 0, active: 0, failed: 0 }
      for (const status of decided.values()) if (status !== 'not-started') quests[status] += 1
      const catalog = safePeek(options.catalog, raidMode)
      let kappa: ModeSummary['kappa'] = null
      let collectorTotal: number | null = null
      if (catalog) {
        const completed = new Set([...decided].filter(([, status]) => status === 'completed').map(([taskId]) => taskId))
        const kappaQuests = catalog.quests.filter((quest) => quest.kappa && !quest.id.startsWith('wiki:'))
        kappa = { completed: kappaQuests.filter((quest) => completed.has(quest.id)).length, total: kappaQuests.length }
        collectorTotal = collectorEntries(catalog.quests, catalog.items).length || null
      }
      const collector = userData.getCollector(accountId, raidMode)
      const position = userData.getPosition(accountId, raidMode)
      return {
        quests,
        kappa,
        collector: { collected: collector.itemIds.length, total: collectorTotal, updatedAt: collector.updatedAt },
        lastSyncAt: scope?.syncedAt ?? null,
        lastPosition: position ? { at: new Date(position.at).toISOString(), receivedAt: position.receivedAt, ...(position.map ? { map: position.map } : {}) } : null,
      }
    }
  })

  return router
}

function safePeek(peek: CatalogPeek | undefined, mode: RaidMode) {
  try { return peek?.(mode) } catch { return undefined }
}
