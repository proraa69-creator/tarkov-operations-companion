/**
 * The owner's notice over every app (services/announcementStore.ts), in the reader's language (owner, 14.10.2026: «все
 * кто с снг уведомление будет на русском и не известные страны тоже на русском, а все иностранные у них этот текст
 * будет автоматически переводится на английский»; services/announcementLanguage.ts):
 *
 *   GET /v1/announcement                  -> { version, announcement: { text, lang, updatedAt } | null } at once (public: the locked app shows it too)
 *   GET /v1/announcement?since=<version>  -> the same as soon as the notice changes, or after ~25 s (the app asks again)
 *   GET /v1/accounts/me/admin/announcement -> { announcement: { text, textEn, textEnSource, active, updatedBy, updatedAt } | null }
 *                                            (owner: with the hidden text, to edit it)
 *   PUT /v1/accounts/me/admin/announcement { text, active, textEn? } -> { announcement, translation }
 *
 * `text` is in the reader's language (`lang`), so the apps from before show it as they are: Russian for the countries
 * of RUSSIAN_NOTICE_COUNTRIES and unknown ones, English for every other while there is an English. The reader's country:
 * their account's own when the request carries a valid session (the apps send it), else Cloudflare's country of the
 * visitor, else unknown. No session, an expired or a forged one: the same answer, never 401.
 *
 * The owner writes Russian; the save makes the English (MyMemory) unless `textEn` brings the owner's own or the Russian
 * did not change and the last English is kept. A notice written in both languages (the old way) is split instead: its
 * Russian paragraphs, and its English ones as the owner's own. `translation`: 'auto' translated now, 'manual' the
 * owner's own, 'kept', 'none' (no text), or 'failed': saved without English, foreign players read the Russian until the
 * owner writes the English in the owner app.
 *
 * The apps ask once every 3–6 minutes, at a random moment each (src/announcement/announcement.ts: no connection held
 * open, no burst); `since` (long polling, routes/mapUpdates.ts) still works for a client that wants to wait. Owner routes as the quest texts (routes/questTexts.ts): 401 without a session, 404 for everybody but
 * the owner; changes go to the audit log as `announcement.set`, with where the English came from (never the text).
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { ANNOUNCEMENT_MAX_LENGTH, type Announcement, type AnnouncementStore, type EnglishSource } from '../services/announcementStore.js'
import { hasRussian, myMemoryTranslator, noticeLanguage, splitBilingualNotice, stillRussian, type AnnouncementTranslator, type NoticeLanguage } from '../services/announcementLanguage.js'
import { countryCode } from '../services/loginCodes.js'
import { proxiedCountry } from './loginCodes.js'
import type { MapUpdates } from './mapUpdates.js'

// One paragraph or a few lines; no other control characters reach a player's screen.
const printable = (value: string) => [...value.replace(/\r\n?/g, '\n')].filter((char) => {
  const code = char.charCodeAt(0)
  return code === 10 || (code >= 32 && code !== 127)
}).join('')
const noticeText = z.string().transform((value) => printable(value).trim()).pipe(z.string().max(ANNOUNCEMENT_MAX_LENGTH))
const bodySchema = z.object({
  text: noticeText,
  // The owner's own English (owner app: «Изменить»): kept as given instead of the automatic one.
  textEn: noticeText.nullish(),
  active: z.boolean(),
}).refine((value) => !value.active || value.text.length > 0)
const querySchema = z.object({ since: z.string().regex(/^\d{1,16}$/).optional() })

/** What a save did to the English (see above). */
export type AnnouncementTranslation = 'auto' | 'manual' | 'kept' | 'failed' | 'none'

export type AnnouncementAudit = (actor: string, action: 'announcement.set', target: string, details: Record<string, unknown>) => void

/** The Russian to store and the English to keep with it. Never throws: a failed translation is 'failed', no English. */
async function withEnglish(input: { text: string; textEn?: string | null }, previous: Announcement | null, translate: AnnouncementTranslator) {
  const split = splitBilingualNotice(input.text)
  const text = split?.ru ?? input.text
  const result = (english: { text: string; source: EnglishSource } | null, translation: AnnouncementTranslation) => ({ text, english, translation })
  if (input.textEn) return result({ text: input.textEn, source: 'manual' }, 'manual')
  if (split) return result({ text: split.en, source: 'manual' }, 'manual')
  if (!text) return result(null, 'none')
  if (previous?.textEn && previous.text === text) return result({ text: previous.textEn, source: previous.textEnSource ?? 'auto' }, 'kept')
  // Not a Russian letter in it (a time, a link): the same text for everybody, nothing to ask the translator.
  if (!hasRussian(text)) return result({ text, source: 'auto' }, 'auto')
  try {
    const english = printable(await translate(text)).trim()
    if (!english) throw new Error('an empty translation')
    // The apps show 500 characters at most (src/announcement/announcement.ts): better the whole Russian than a cut English.
    if (english.length > ANNOUNCEMENT_MAX_LENGTH) throw new Error(`a translation over ${ANNOUNCEMENT_MAX_LENGTH} characters`)
    if (stillRussian(english)) throw new Error('the translation is still Russian')
    return result({ text: english, source: 'auto' }, 'auto')
  } catch (error) {
    console.warn(`Notice saved without English: ${error instanceof Error ? error.message : String(error)}`)
    return result(null, 'failed')
  }
}

/** `translate`: Russian → English for the notice (services/announcementLanguage.ts); the tests pass a fake. */
export function createAnnouncementRouter(accounts: AccountStore, store: AnnouncementStore, signals: MapUpdates, audit?: AnnouncementAudit, translate: AnnouncementTranslator = myMemoryTranslator()) {
  const router = express.Router()
  const writeLimiter = new FixedWindowRateLimiter(60, 60 * 1000)

  /** The reader's language: their account's country, else Cloudflare's country of the visitor, else unknown (Russian). */
  const languageOf = (req: Request): NoticeLanguage => {
    let country: string | undefined
    try {
      const id = accounts.authenticate(bearer(req.get('authorization')))
      if (id) country = accounts.countryOf(id)
    } catch { /* a session that cannot be read counts as none */ }
    return noticeLanguage(country ?? countryCode(proxiedCountry(req)))
  }

  router.get('/v1/announcement', (req, res) => {
    // The answer depends on the session and the country: nothing in between may keep one reader's answer for another.
    res.set('Cache-Control', 'no-store').vary('Authorization').vary('CF-IPCountry')
    const query = querySchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    const language = languageOf(req)
    signals.wait(res, req.ip ?? req.socket.remoteAddress ?? 'unknown', query.data.since === undefined ? undefined : Number(query.data.since), () => ({ announcement: store.publicView(language) }))
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

  router.get('/v1/accounts/me/admin/announcement', (req, res) => {
    if (!owner(req, res, false)) return
    res.json({ announcement: store.current() })
  })

  router.put('/v1/accounts/me/admin/announcement', async (req, res) => {
    const actor = owner(req, res, true)
    if (!actor) return
    const body = bodySchema.safeParse(req.body)
    if (!body.success) {
      const english = body.error.issues.every((issue) => issue.path[0] === 'textEn')
      res.status(400).json({ error: english ? `Английский текст: до ${ANNOUNCEMENT_MAX_LENGTH} символов` : `Текст уведомления: не пустой, до ${ANNOUNCEMENT_MAX_LENGTH} символов` })
      return
    }
    const { text, english, translation } = await withEnglish(body.data, store.current(), translate)
    const saved = store.save(text, body.data.active, actor, english)
    signals.changed()
    try { audit?.(actor, 'announcement.set', 'announcement', { active: saved.active, length: saved.text.length, english: saved.textEnSource ?? 'missing' }) } catch { /* saved anyway */ }
    res.json({ announcement: saved, translation })
  })

  return router
}
