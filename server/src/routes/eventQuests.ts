/**
 * «Ивент-квесты» the owner keeps in the owner app (services/eventQuestStore.ts, src/data/eventQuestDefinitions.ts).
 *
 *   GET  /v1/event-quests                                  -> { quests } (public: every player's app lays them over the
 *                                                             catalog; without the author)
 *   GET  /v1/accounts/me/admin/event-quests                -> { quests } (owner: with the author)
 *   PUT  /v1/accounts/me/admin/event-quests  <definition>  -> { quest, quests } (create or replace one quest)
 *   POST /v1/accounts/me/admin/event-quests/:id/remove     -> { quests } (a built-in quest: «Вернуть исходный»; the
 *                                                             owner's own: «Удалить»)
 *
 * Owner routes as the quest texts (routes/questTexts.ts): 401 without a session, 404 for everybody but the owner, removal
 * is a POST (the desktop app's gateway forwards GET / POST / PUT only), writes go to the audit log as `map.event-quest`,
 * every saved write tells the running apps at once (routes/mapUpdates.ts) and asks the quest base for a new build
 * (`changed`), so the served catalog follows within a few minutes.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { builtInEventQuest, EVENT_OBJECTIVE_TYPES, EVENT_QUEST_ID, EVENT_QUEST_LIMITS, EVENT_QUEST_MODES, SHOOT_TARGETS } from '../../../src/data/eventQuestDefinitions'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import type { EventQuestInput, EventQuestStore, StoredEventQuest } from '../services/eventQuestStore.js'

const L = EVENT_QUEST_LIMITS
// Line breaks stay (a description has paragraphs); other control characters never reach a player's screen.
const printable = (value: string) => [...value.replace(/\r\n?/g, '\n')].filter((char) => {
  const code = char.charCodeAt(0)
  return code === 10 || (code >= 32 && code !== 127)
}).join('').trim()
const line = (max: number) => z.string().transform(printable).pipe(z.string().max(max))
/** Russian is required (the app's main language); English may be empty and then shows the Russian text. */
const pair = (max: number, required = true) => z.object({ ru: required ? line(max).pipe(z.string().min(1)) : line(max), en: line(max) })
const itemId = z.string().regex(/^[a-f0-9]{24}$/)
const questRef = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/)
const mapName = z.string().regex(/^[a-z0-9-]{2,40}$/)
const count = (max: number) => z.number().int().min(1).max(max)
const reward = z.tuple([itemId, count(L.rewardCount)])
const unique = <T>(list: T[]) => new Set(list.map((entry) => JSON.stringify(entry))).size === list.length

const objectiveSchema = z.object({
  type: z.enum(EVENT_OBJECTIVE_TYPES as unknown as [string, ...string[]]),
  text: pair(L.objectiveText),
  count: count(L.count).optional(),
  optional: z.boolean().optional(),
  maps: z.array(mapName).max(L.objectiveMaps).refine(unique).optional(),
  items: z.array(itemId).max(L.objectiveItems).optional(),
  foundInRaid: z.boolean().optional(),
  targets: z.array(z.enum(SHOOT_TARGETS)).max(L.shootTargets).refine(unique).optional(),
}).strict()

const definitionSchema = z.object({
  id: z.string().refine((id) => EVENT_QUEST_ID.test(id) || Boolean(builtInEventQuest(id)), 'unknown id'),
  trader: z.string().regex(/^[a-f0-9]{24}$/),
  name: pair(L.name),
  after: z.array(questRef).max(L.previous).refine(unique).optional(),
  experience: z.number().int().min(0).max(L.experience),
  objectives: z.array(objectiveSchema).min(1).max(L.objectives),
  rewards: z.array(reward).max(L.rewards).optional(),
  startRewards: z.array(reward).max(L.rewards).optional(),
  skills: z.array(pair(L.skill)).max(L.skills).optional(),
  note: pair(L.note, false),
  modes: z.array(z.enum(EVENT_QUEST_MODES as unknown as [string, ...string[]])).min(1).max(3).refine(unique),
  series: z.object({ name: pair(L.seriesName), route: pair(L.route, false) }).strict(),
  endsAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()).nullable().optional(),
  hidden: z.boolean().optional(),
  // what the server itself keeps is ignored when the app sends a stored definition back
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  updatedBy: z.unknown().optional(),
}).strict().refine((definition) => !definition.after?.includes(definition.id), 'a quest cannot follow itself')

export type EventQuestAudit = (actor: string, action: 'map.event-quest', target: string, details: Record<string, unknown>) => void

/** What every player gets: no author e-mail. */
function publicView(entry: StoredEventQuest) {
  const view: Partial<StoredEventQuest> = { ...entry }
  delete view.updatedBy
  return view
}

/** `changed`: told after every saved write (the live push to the apps and a new build of the quest base). */
export function createEventQuestsRouter(accounts: AccountStore, store: EventQuestStore, audit?: EventQuestAudit, changed?: () => void) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  router.get('/v1/event-quests', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ quests: store.list().map(publicView) })
  })

  /** The owner's e-mail, or an answer was already sent. */
  const owner = (req: Request, res: Response, write: boolean) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    const retry = write ? writeLimiter.hit(id) : undefined
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
    return accounts.emailOf(id) ?? id
  }

  router.get('/v1/accounts/me/admin/event-quests', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ quests: store.list() })
  })

  router.put('/v1/accounts/me/admin/event-quests', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = definitionSchema.safeParse(req.body)
    if (!body.success) {
      const issue = body.error.issues[0]
      res.status(400).json({ error: `Некорректный ивент-квест${issue?.path.length ? ` (${issue.path.join('.')})` : ''}: проверьте поля и длину текстов` })
      return
    }
    const data = body.data
    const saved = store.save({
      id: data.id,
      trader: data.trader,
      name: data.name,
      after: data.after ?? [],
      experience: data.experience,
      objectives: data.objectives as EventQuestInput['objectives'],
      rewards: data.rewards ?? [],
      startRewards: data.startRewards ?? [],
      skills: data.skills ?? [],
      note: data.note,
      modes: data.modes as EventQuestInput['modes'],
      series: data.series,
      ...(data.endsAt ? { endsAt: data.endsAt } : {}),
      ...(data.hidden ? { hidden: true } : {}),
    }, actor)
    if (saved === 'full') { res.status(409).json({ error: 'Слишком много ивент-квестов. Удалите лишние.' }); return }
    changed?.()
    try { audit?.(actor, 'map.event-quest', saved.id, { op: 'save', name: saved.name.ru, builtIn: Boolean(builtInEventQuest(saved.id)), hidden: saved.hidden === true, endsAt: saved.endsAt ?? null }) } catch { /* saved anyway */ }
    res.json({ quest: saved, quests: store.list() })
  })

  router.post('/v1/accounts/me/admin/event-quests/:id/remove', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const id = questRef.safeParse(req.params.id)
    const removed = id.success ? store.remove(id.data) : undefined
    if (!removed) { res.status(404).json({ error: 'Ивент-квест не найден' }); return }
    changed?.()
    try { audit?.(actor, 'map.event-quest', removed.id, { op: builtInEventQuest(removed.id) ? 'reset' : 'remove', name: removed.name.ru }) } catch { /* removed anyway */ }
    res.json({ quests: store.list() })
  })

  return router
}
