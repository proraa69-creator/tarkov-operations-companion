/**
 * Per-user data API, mounted at `/v1/me`. Every route needs `Authorization: Bearer <session token>` from
 * POST /v1/accounts/login. PvP, PvE and Seasonal data are stored and returned separately.
 *
 *   GET  /progress/:mode                 -> { revision, records, coverage, scope: { accountId, characterId, syncedAt, resetAt? } | null }
 *   POST /progress/:mode/events          { accountId?, characterId?, resetAt?, events[] } -> merged records and the scope
 *   POST /progress/:mode/reset           { at? } -> { resetAt, scope } («Престиж +» / a nickname change: the whole mode
 *                                        starts again; its older quest events, story chapters, objectives, Collector
 *                                        checklist and shared level go, other modes stay)
 *   GET  /story/:mode?characterId=       -> { characterId, records: [{ chapterId, status, stageId?, updatedAt }] }
 *   POST /story/:mode                    { characterId?, records[] } -> the same, the newer readings kept
 *   GET  /collector/:mode                -> { itemIds, updatedAt }
 *   PUT  /collector/:mode                { itemIds } -> { itemIds, updatedAt }
 *   GET  /position/:mode                 -> { position | null } (the newer of the stored one and the live one, routes/live.ts)
 *   POST /position/:mode                 { x, y, z, yaw, at, map? } -> { position } (only the latest is kept; the apps
 *                                        with the in-game overlays; the newer ones publish to /v1/live, which stores nothing)
 *   GET  /settings                       -> { settings, updatedAt }
 *   PUT  /settings                       { settings } -> { settings, updatedAt } (max 16 KB)
 *   PUT  /levels                         { modes: { pvp?|pve?|seasonal?: { level, prestige | null, observedAt } } }
 *                                        -> { modes } (the desktop app's own levels; friends see them, routes/friends.ts)
 *   GET  /progress/:mode/manual          -> { marks } («Ручная отметка» of the mode)
 *   POST /progress/:mode/manual          { marks: [{ taskId, status: active|completed|cleared, at }] } -> { marks }
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
import type { UserDataStore } from '../services/userDataStore.js'
import { ObjectiveLimitError, ObjectiveStore } from '../services/objectiveStore.js'
import type { SocialSignals } from '../services/socialSignals.js'
import { resolvedRecords } from '../services/sharedProgress.js'
import type { LiveRelay } from '../services/liveRelay.js'
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
const resetSchema = z.object({ at: isoTime.optional() }).strict()
/** «Ручная отметка»: the marks of one mode (a few hundred at most: one per quest). */
const manualSchema = z.object({
  marks: z.array(z.object({ taskId: z.string().regex(ENTITY_ID_PATTERN), status: z.enum(['active', 'completed', 'cleared']), at: isoTime }).strict()).max(1000),
}).strict()
const collectorSchema = z.object({ itemIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(1000) }).strict()
/** Story chapters per character (the screen reads them; the game does not log them): a few dozen at most. */
const storyRecordSchema = z.object({
  chapterId: z.string().regex(ENTITY_ID_PATTERN),
  status: z.enum(['active', 'completed']),
  stageId: z.string().regex(ENTITY_ID_PATTERN).optional(),
  updatedAt: isoTime,
}).strict()
const storySchema = z.object({ characterId: hexId.optional(), records: z.array(storyRecordSchema).max(200) }).strict()
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
  const progressChanged = (accountId: string) => { if (options.social) options.social.signals.changed(options.social.circle(accountId)) }

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
  // is wiped (the app sends its logs again right after). No floor is kept.
  router.post('/progress/:mode/reset', (req, res) => {
    const parsed = mode(req)
    const body = resetSchema.safeParse(req.body ?? {})
    if (!parsed.success || !body.success) { bad(res); return }
    const now = (options.now ?? Date.now)()
    const answer = progress.resetMode(owner(account(res)), parsed.data, body.data.at ?? new Date(now).toISOString(), now)
    objectives.dropBefore(owner(account(res)), parsed.data, answer.resetAt)
    userData.clearModeBefore(account(res), parsed.data, answer.resetAt)
    res.json(answer)
    progressChanged(account(res))
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
    res.json(progress.syncManualMarks(owner(account(res)), parsed.data, body.data.marks, (options.now ?? Date.now)()))
    if (body.data.marks.length) progressChanged(account(res))
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
    res.json(progress.syncStory(owner(account(res)), parsed.data, body.data, (options.now ?? Date.now)()))
    if (body.data.records.length) progressChanged(account(res))
  })

  // «Моментально»: waits up to ~25 s for anything new among this account's friends and squad (services/socialSignals.ts).
  router.get('/social-events', (req, res) => {
    const since = typeof req.query.since === 'string' && /^\d{1,16}$/.test(req.query.since) ? Number(req.query.since) : undefined
    if (req.query.since !== undefined && since === undefined) { bad(res); return }
    if (!options.social) { res.json({ version: 0 }); return }
    options.social.signals.wait(res, account(res), since)
  })

  router.get('/collector/:mode', (req, res) => {
    const parsed = mode(req)
    if (!parsed.success) { bad(res, 'Некорректный режим'); return }
    res.json(userData.getCollector(account(res), parsed.data))
  })

  router.put('/collector/:mode', (req, res) => {
    const parsed = mode(req)
    const body = collectorSchema.safeParse(req.body)
    if (!parsed.success || !body.success) { bad(res); return }
    res.json(userData.setCollector(account(res), parsed.data, body.data.itemIds))
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
    try {
      res.json(objectives.sync(owner(account(res)), parsed.data, {
        objectives: body.data.objectives.filter((entry) => fresh(entry.observedAt)).map((entry) => ({ ...entry, observedAt: clamp(entry.observedAt), ...(entry.completedAt ? { completedAt: clamp(entry.completedAt) } : {}) })),
        events: body.data.events.filter((entry) => fresh(entry.observedAt)).map((entry) => ({ ...entry, synced: undefined, mode: parsed.data, observedAt: clamp(entry.observedAt), ...(entry.undoneAt ? { undoneAt: clamp(entry.undoneAt) } : {}) })),
      }))
      progressChanged(account(res))
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
