/**
 * Quest texts corrected by the owner in the quest constructor (services/questTextStore.ts).
 *
 *   GET  /v1/quest-texts                                     -> { overrides } (public: every player's app uses them;
 *                                                               without the author)
 *   GET  /v1/accounts/me/admin/quest-texts                   -> { overrides } (owner: with the author)
 *   PUT  /v1/accounts/me/admin/quest-texts  { questId, field, target, lang, text } -> { override, overrides }
 *        field: 'name' (one line, ≤ 120) | 'description' | 'objective' | 'stage-title' | 'stage-description'; older apps
 *        skip a field they do not know (src/data/questTextOverrides.ts)
 *   POST /v1/accounts/me/admin/quest-texts/:id/remove        -> { overrides } («Вернуть исходный текст»)
 *
 * Owner routes as the quest points (routes/questPoints.ts): 401 without a session, 404 for everybody but the owner,
 * removal is a POST (the desktop app's gateway forwards GET / POST / PUT only), writes go to the audit log as
 * `map.quest-text`, and every saved write tells the running apps at once (routes/mapUpdates.ts).
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { QUEST_TEXT_MAX_LENGTH, QuestTextStore, type QuestTextOverride } from '../services/questTextStore.js'

const ident = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,200}$/)
// Line breaks stay (a description has paragraphs); other control characters never reach a player's screen.
const printable = (value: string) => [...value.replace(/\r\n?/g, '\n')].filter((char) => {
  const code = char.charCodeAt(0)
  return code === 10 || (code >= 32 && code !== 127)
}).join('')
const text = z.string().transform((value) => printable(value).trim()).pipe(z.string().min(1).max(QUEST_TEXT_MAX_LENGTH))
/** A quest title: one line of at most 120 characters. */
export const QUEST_NAME_MAX_LENGTH = 120
const overrideSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('name'), target: z.literal('').optional().default('') }),
  z.object({ field: z.literal('description'), target: z.literal('').optional().default('') }),
  z.object({ field: z.literal('objective'), target: ident }),
  z.object({ field: z.literal('stage-title'), target: z.string().regex(/^\d{1,3}$/) }),
  z.object({ field: z.literal('stage-description'), target: z.string().regex(/^\d{1,3}$/) }),
]).and(z.object({ questId: ident, lang: z.enum(['ru', 'en']), text }))
  .refine((input) => input.field !== 'name' || (!input.text.includes('\n') && input.text.length <= QUEST_NAME_MAX_LENGTH), { message: 'name', path: ['text'] })
const idSchema = z.string().regex(/^[a-f0-9]{24}$/)

export type QuestTextAudit = (actor: string, action: 'map.quest-text', target: string, details: Record<string, unknown>) => void

/** What every player gets: no author e-mail. */
function publicView(entry: QuestTextOverride): Omit<QuestTextOverride, 'updatedBy'> {
  const view: Partial<QuestTextOverride> = { ...entry }
  delete view.updatedBy
  return view as Omit<QuestTextOverride, 'updatedBy'>
}

/** `changed`: told after every saved write, so every running app re-reads the corrections at once. */
export function createQuestTextsRouter(accounts: AccountStore, store: QuestTextStore, audit?: QuestTextAudit, changed?: () => void) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(120, 60 * 1000)

  router.get('/v1/quest-texts', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ overrides: store.list().map(publicView) })
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

  router.get('/v1/accounts/me/admin/quest-texts', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ overrides: store.list() })
  })

  router.put('/v1/accounts/me/admin/quest-texts', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = overrideSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: `Некорректный текст квеста (не пустой, до ${QUEST_TEXT_MAX_LENGTH} символов)` }); return }
    const saved = store.save(body.data, actor)
    if (saved === 'full') { res.status(409).json({ error: 'Слишком много правок текстов. Верните лишние к исходным.' }); return }
    changed?.()
    try { audit?.(actor, 'map.quest-text', saved.id, { op: 'save', quest: saved.questId, field: saved.field, target: saved.target, lang: saved.lang, length: saved.text.length }) } catch { /* saved anyway */ }
    res.json({ override: saved, overrides: store.list() })
  })

  router.post('/v1/accounts/me/admin/quest-texts/:id/remove', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const id = idSchema.safeParse(req.params.id)
    const removed = id.success ? store.remove(id.data) : undefined
    if (!removed) { res.status(404).json({ error: 'Правка не найдена' }); return }
    changed?.()
    try { audit?.(actor, 'map.quest-text', removed.id, { op: 'reset', quest: removed.questId, field: removed.field, target: removed.target, lang: removed.lang }) } catch { /* removed anyway */ }
    res.json({ overrides: store.list() })
  })

  return router
}
