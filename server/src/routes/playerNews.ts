/**
 * «Обновление»: what each release brought, the owner's own words over the app's (owner, 06.11.2026: «то, что ты пишешь, надписи,
 * многое меня не устраивает… Я буду делать это сам»; «По нажатию „Сохранить“ данный текст уходит ко всем пользователям моментально»).
 *
 *   GET  /v1/player-news                            -> { edits: { <version>: items } } (public: read each time the window opens)
 *   GET  /v1/accounts/me/admin/player-news          -> { entries, edited, edits } (owner: every release with its text now)
 *   PUT  /v1/accounts/me/admin/player-news          { version, items: [{ kind, ru }] } -> the same (owner)
 *   POST /v1/accounts/me/admin/player-news/reset    { version } -> the same (owner: the app's own text again)
 *
 * The owner writes Russian. A line he left as it was keeps its English; a new one is translated on saving (as the owner's notice,
 * services/announcementLanguage.ts), and with no translation English players read the Russian. Saved: `changed` tells the apps at
 * once (routes/mapUpdates.ts). Only the releases the server knows, each with no more than MAX_LINES lines.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import PLAYER_NEWS from '../../../src/data/playerNews.json'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { myMemoryTranslator, stillRussian, type AnnouncementTranslator } from '../services/announcementLanguage.js'
import type { PlayerNewsItem, PlayerNewsStore } from '../services/playerNewsStore.js'

const MAX_LINES = 40
const MAX_LINE = 400

interface BuiltInEntry { version: string; date: string; items: PlayerNewsItem[] }
const BUILT_IN = PLAYER_NEWS as BuiltInEntry[]

/** One line of text: no control characters reach a player's screen. */
const printable = (value: string) => [...value].filter((char) => {
  const code = char.charCodeAt(0)
  return code >= 32 && code !== 127
}).join('').trim()
const line = z.string().transform(printable).pipe(z.string().min(1).max(MAX_LINE))
const version = z.string().min(1).max(32).refine((value) => BUILT_IN.some((entry) => entry.version === value), 'unknown version')
const saveSchema = z.object({
  version,
  items: z.array(z.object({ kind: z.enum(['added', 'changed', 'improved']), ru: line }).strict()).max(MAX_LINES),
}).strict()
const resetSchema = z.object({ version }).strict()

export type PlayerNewsAudit = (actor: string, action: 'news.edit', target: string, details: Record<string, unknown>) => void

export function createPlayerNewsRouter(accounts: AccountStore, store: PlayerNewsStore, audit?: PlayerNewsAudit, translate: AnnouncementTranslator = myMemoryTranslator(), changed?: () => void) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  const view = () => {
    const edits = store.edits()
    return {
      entries: BUILT_IN.map((entry) => ({ version: entry.version, date: entry.date, items: edits[entry.version] ?? entry.items })),
      edited: Object.keys(edits),
      edits,
    }
  }

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

  /** A line left as it was keeps its English; a new one gets its own, or none and English players read the Russian. */
  const withEnglish = async (target: string, items: Array<{ kind: PlayerNewsItem['kind']; ru: string }>): Promise<PlayerNewsItem[]> => {
    const before = store.edits()[target] ?? BUILT_IN.find((entry) => entry.version === target)?.items ?? []
    const known = new Map(before.map((item) => [item.ru, item.en]))
    return Promise.all(items.map(async (item) => {
      const kept = known.get(item.ru)
      if (kept) return { ...item, en: kept }
      try {
        const english = printable(await translate(item.ru))
        return { ...item, en: english && !stillRussian(english) ? english.slice(0, MAX_LINE) : '' }
      } catch { return { ...item, en: '' } }
    }))
  }

  router.get('/v1/player-news', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ edits: store.edits() })
  })

  router.get('/v1/accounts/me/admin/player-news', (req, res) => {
    if (!owner(req, res, false)) return
    res.json(view())
  })

  router.put('/v1/accounts/me/admin/player-news', (req, res, next) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = saveSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: `Проверьте текст: не больше ${MAX_LINES} пунктов, в пункте не больше ${MAX_LINE} знаков.` }); return }
    withEnglish(body.data.version, body.data.items).then((items) => {
      store.save(body.data.version, items, actor)
      changed?.()
      try { audit?.(actor, 'news.edit', body.data.version, { op: 'save', lines: items.length }) } catch { /* saved anyway */ }
      res.json(view())
    }).catch(next)
  })

  router.post('/v1/accounts/me/admin/player-news/reset', (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = resetSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Нет такой версии' }); return }
    if (store.reset(body.data.version)) {
      changed?.()
      try { audit?.(actor, 'news.edit', body.data.version, { op: 'reset' }) } catch { /* reset anyway */ }
    }
    res.json(view())
  })

  return router
}
