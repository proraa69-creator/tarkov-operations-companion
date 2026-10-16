/**
 * «Объявления по регионам» and «Опросы» (services/noticeStore.ts, src/shared/notices.ts; owner, 15.10.2026). Kept apart
 * from the public GET /v1/announcement (the banner for everybody): these are per account.
 *
 * Owner only (TARKOV_OWNER_EMAILS with a confirmed e-mail): 401 without a session, 404 for everybody else.
 *   POST /v1/accounts/me/admin/notices/images { data: base64 }  -> 201 { image: { id, mime, size } } one photo (JPG / PNG
 *        / WEBP by magic bytes, ≤ 5 MB) for an announcement being written; 413 / 400 / 507 (storage full). Mounted
 *        before the global 1 MB JSON parser (createNoticeUploadRouter).
 *   POST /v1/accounts/me/admin/notices { title, text, titleEn?, textEn?, button?: { text, textEn?, url }, audience:
 *        { regions: ['cis'|'europe'|'other'|'none'] (none listed: all), payment: 'all'|'paid'|'unpaid', payRegion?: 'CIS'|
 *        'WORLD'|'ALL_PAID_REGIONS' (Boosty audiences without Russia, instead of regions) }, images: [id] }
 *        -> 201 { notice } (audit: notice.send); the targeted apps hear it at once through GET /v1/me/social-events
 *   POST /v1/accounts/me/admin/surveys { title, titleEn?, intro?, introEn?, questions: [{ text, textEn?, type:
 *        'single'|'multiple'|'text', options?: [{ text, textEn? }], max?, required }], audience } -> 201 { notice }
 *        (audit: survey.publish)
 *   GET  /v1/accounts/me/admin/notices?kind=announcement|survey -> { notices: [{ …, targeted, seen, closed, responses? }] }
 *   POST /v1/accounts/me/admin/notices/:id/withdraw             -> { notice } «Отозвать» (audit: notice.withdraw)
 *   GET  /v1/accounts/me/admin/notices/:id/images/:idx           -> { mime, data: base64 }
 *   GET  /v1/accounts/me/admin/surveys/:id/results               -> { survey, questions, responses } (respondents' e-mails:
 *        the owner only)
 *   GET  /v1/accounts/me/admin/surveys/:id/responses.csv         -> text/csv (UTF-8 BOM, «;»; audit: survey.export)
 *
 * The player (Bearer session; 401 without one):
 *   GET  /v1/me/notices                         -> { notices, surveys } of this account (src/shared/notices.ts)
 *   POST /v1/me/notices/:id/seen                -> 204 (the app showed it) | 404 not this account's
 *   POST /v1/me/notices/:id/close               -> 204 «Понятно»: never again on any device | 404
 *   GET  /v1/me/notices/:id/images/:idx         -> { mime, data: base64 } | 404
 *   POST /v1/me/surveys/:id/later               -> 204 «Позже»: again at the next start, SURVEY_LATER_MAX times | 404
 *   POST /v1/me/surveys/:id/responses { answers } -> 201 { answeredAt } | 400 (what is wrong) | 404 | 409 (answered)
 * A close or an answer moves the account's social events: its other devices drop the popup at once.
 */
import express from 'express'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { bearer, FixedWindowRateLimiter, type AccountStore } from '../services/accountStore.js'
import { csvCell } from '../services/adminStore.js'
import { NoticeError, type NoticeStore } from '../services/noticeStore.js'
import type { SocialSignals } from '../services/socialSignals.js'
import { cleanNoticeLine, cleanNoticeText, NOTICE_LIMITS, NOTICE_PAY_REGIONS, NOTICE_PAYMENTS, NOTICE_REGIONS, REGION_NAMES, safeNoticeUrl, SURVEY_LIMITS, type NoticePayRegion, type NoticeRegion, type SurveyQuestion } from '../../../src/shared/notices.js'
import { countryName } from '../../../src/shared/countries.js'
import { hasRussian, myMemoryTranslator, stillRussian, type AnnouncementTranslator } from '../services/announcementLanguage.js'
import type { AnnouncementInput, SurveyInput } from '../services/noticeStore.js'

export type NoticeAudit = (actor: string, action: 'notice.send' | 'notice.withdraw' | 'survey.publish' | 'survey.export', target: string, details: Record<string, unknown>) => void

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const DATA_URL_PREFIX = /^data:image\/(?:png|jpeg|webp);base64,/
/** Base64 of 5 MB is ~6.7 MB. */
export const NOTICE_IMAGE_BODY_LIMIT = '8mb'

const line = (max: number) => z.string().max(max * 4).transform(cleanNoticeLine).pipe(z.string().max(max))
const block = (max: number) => z.string().max(max * 4).transform(cleanNoticeText).pipe(z.string().max(max))
const optionalLine = (max: number) => line(max).optional().transform((value) => value || undefined)
const optionalBlock = (max: number) => block(max).optional().transform((value) => value || undefined)
const audienceSchema = z.object({
  regions: z.array(z.enum(NOTICE_REGIONS as [NoticeRegion, ...NoticeRegion[]])).max(NOTICE_REGIONS.length).transform((regions) => {
    const unique = [...new Set(regions)]
    // All four regions are everybody.
    return unique.length === NOTICE_REGIONS.length ? [] : unique
  }),
  payment: z.enum(NOTICE_PAYMENTS as ['all', 'paid', 'unpaid']),
  // «СНГ» / «Мир» / «Все, кроме России» (Boosty): instead of the regions, never together with them.
  payRegion: z.enum(NOTICE_PAY_REGIONS as [NoticePayRegion, ...NoticePayRegion[]]).optional(),
}).refine((audience) => !audience.payRegion || audience.regions.length === 0, { message: 'payRegion', path: ['payRegion'] })
const announcementSchema = z.object({
  title: line(NOTICE_LIMITS.title).pipe(z.string().min(1)),
  text: block(NOTICE_LIMITS.text).pipe(z.string().min(1)),
  titleEn: optionalLine(NOTICE_LIMITS.title),
  textEn: optionalBlock(NOTICE_LIMITS.text),
  button: z.object({
    text: line(NOTICE_LIMITS.buttonText).pipe(z.string().min(1)),
    textEn: optionalLine(NOTICE_LIMITS.buttonText),
    url: z.string().max(NOTICE_LIMITS.buttonUrl * 2).transform((value, context) => {
      const url = safeNoticeUrl(value)
      if (!url) context.addIssue({ code: z.ZodIssueCode.custom, message: 'url' })
      return url ?? ''
    }),
  }).optional(),
  audience: audienceSchema,
  images: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(NOTICE_LIMITS.images).default([]),
})
const questionSchema = z.object({
  text: line(SURVEY_LIMITS.question).pipe(z.string().min(1)),
  textEn: optionalLine(SURVEY_LIMITS.question),
  type: z.enum(['single', 'multiple', 'text']),
  options: z.array(z.object({ text: line(SURVEY_LIMITS.option).pipe(z.string().min(1)), textEn: optionalLine(SURVEY_LIMITS.option) })).max(SURVEY_LIMITS.options.max).optional(),
  max: z.number().int().min(1).max(SURVEY_LIMITS.options.max).optional(),
  required: z.boolean().default(false),
}).superRefine((question, context) => {
  const count = question.options?.length ?? 0
  if (question.type === 'text' && count) context.addIssue({ code: z.ZodIssueCode.custom, message: 'options' })
  if (question.type !== 'text' && count < SURVEY_LIMITS.options.min) context.addIssue({ code: z.ZodIssueCode.custom, message: 'options' })
  if (question.max !== undefined && (question.type !== 'multiple' || question.max > count)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'max' })
})
const surveySchema = z.object({
  title: line(SURVEY_LIMITS.title).pipe(z.string().min(1)),
  titleEn: optionalLine(SURVEY_LIMITS.title),
  intro: optionalBlock(SURVEY_LIMITS.intro),
  introEn: optionalBlock(SURVEY_LIMITS.intro),
  questions: z.array(questionSchema).min(1).max(SURVEY_LIMITS.questions),
  audience: audienceSchema,
})
const idSchema = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const idxSchema = z.coerce.number().int().min(0).max(NOTICE_LIMITS.images - 1)
const kindSchema = z.object({ kind: z.enum(['announcement', 'survey']).default('announcement') })
// Bounded by the body limit; a photo over 5 MB is decoded and refused with 413 by the store.
const uploadSchema = z.object({ data: z.string() })
const answersSchema = z.object({ answers: z.record(z.unknown()) })

/** The first problem of a form, in words (the owner app shows it under the form). */
function formError(error: z.ZodError, kind: 'announcement' | 'survey') {
  const issue = error.issues[0]
  const path = issue?.path ?? []
  const at = (index: number) => path[index]
  if (at(0) === 'audience') return at(1) === 'payRegion' ? 'Регион оплаты Boosty выбирается вместо регионов, не вместе с ними' : 'Выберите регионы и оплату'
  if (at(0) === 'images') return `Не больше ${NOTICE_LIMITS.images} фото`
  if (at(0) === 'button') return at(1) === 'url' ? 'Ссылка кнопки: полный адрес https://…' : `Текст кнопки: 1–${NOTICE_LIMITS.buttonText} символов`
  if (at(0) === 'questions') {
    if (typeof at(1) !== 'number') return `Вопросов: от 1 до ${SURVEY_LIMITS.questions}`
    const number = Number(at(1)) + 1
    if (at(2) === 'options' || issue?.message === 'options') return `Вопрос ${number}: у вариантов ответа ${SURVEY_LIMITS.options.min}–${SURVEY_LIMITS.options.max} пунктов до ${SURVEY_LIMITS.option} символов (у «Свой ответ» вариантов нет)`
    if (issue?.message === 'max') return `Вопрос ${number}: «не больше» — только у «Несколько вариантов» и не больше числа вариантов`
    return `Вопрос ${number}: текст 1–${SURVEY_LIMITS.question} символов`
  }
  if (kind === 'survey') return at(0) === 'intro' || at(0) === 'introEn' ? `Вступление: до ${SURVEY_LIMITS.intro} символов` : `Название опроса: 1–${SURVEY_LIMITS.title} символов`
  if (at(0) === 'text' || at(0) === 'textEn') return `Текст: 1–${NOTICE_LIMITS.text} символов`
  return `Заголовок: 1–${NOTICE_LIMITS.title} символов`
}

/** The owner's e-mail, or an answer was already sent. */
function ownerGuard(accounts: AccountStore, limiter: FixedWindowRateLimiter, req: Request, res: Response) {
  res.set('Cache-Control', 'no-store')
  const id = accounts.authenticate(bearer(req.get('authorization')))
  if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
  if (!accounts.isOwner(id)) { res.status(404).json({ error: 'Не найдено' }); return undefined }
  const retry = limiter.hit(id)
  if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return undefined }
  return accounts.emailOf(id) ?? id
}

const sendError = (res: Response, error: unknown) => {
  if (!(error instanceof NoticeError)) throw error
  res.status(error.status).json({ error: error.message })
}

/**
 * The English of one field for the players whose app speaks English (owner, 16.10.2026: «должен быть автоматический
 * перевод на англ язык, то что я отправляю в объявлении, для тех у кого выбран английский язык»). The owner writes
 * Russian; the English is made once here (MyMemory, services/announcementLanguage.ts), the same as the banner. A field
 * already in English stays as it is; a failed translation leaves no English and the reader sees the Russian.
 */
async function autoEnglish(russian: string | undefined, manual: string | undefined, translate: AnnouncementTranslator): Promise<string | undefined> {
  if (manual && manual.trim()) return manual.trim()
  const text = (russian ?? '').trim()
  if (!text) return undefined
  if (!hasRussian(text)) return text
  try {
    const english = cleanNoticeLine(await translate(text)).trim()
    if (!english || stillRussian(english) || english.length > NOTICE_LIMITS.text) return undefined
    return english
  } catch {
    return undefined
  }
}

/** Fill the English of an announcement (title, text, button) before it is stored. */
async function announcementWithEnglish(data: AnnouncementInput, translate: AnnouncementTranslator): Promise<AnnouncementInput> {
  const [titleEn, textEn, buttonTextEn] = [
    await autoEnglish(data.title, data.titleEn, translate),
    await autoEnglish(data.text, data.textEn, translate),
    data.button ? await autoEnglish(data.button.text, data.button.textEn, translate) : undefined,
  ]
  return { ...data, titleEn, textEn, button: data.button ? { ...data.button, textEn: buttonTextEn } : undefined }
}

/** Fill the English of a survey (title, intro, every question and option) before it is stored; sequential, to spare the free translator. */
async function surveyWithEnglish(data: SurveyInput, translate: AnnouncementTranslator): Promise<SurveyInput> {
  const titleEn = await autoEnglish(data.title, data.titleEn, translate)
  const introEn = await autoEnglish(data.intro, data.introEn, translate)
  const questions: SurveyInput['questions'] = []
  for (const question of data.questions) {
    const textEn = await autoEnglish(question.text, question.textEn, translate)
    const options: Array<{ text: string; textEn?: string }> = []
    for (const option of question.options ?? []) options.push({ ...option, textEn: await autoEnglish(option.text, option.textEn, translate) })
    questions.push({ ...question, textEn, ...(question.options ? { options } : {}) })
  }
  return { ...data, titleEn, introEn, questions }
}

/** The photo upload, with its own body limit: mount it before the global JSON parser (app.ts). */
export function createNoticeUploadRouter(accounts: AccountStore, store: NoticeStore) {
  const router = express.Router()
  const limiter = new FixedWindowRateLimiter(40, 10 * 60 * 1000)
  router.post('/v1/accounts/me/admin/notices/images', (req, res, next) => {
    // The session first: nobody else makes the server read a large body.
    const actor = ownerGuard(accounts, limiter, req, res)
    if (!actor) { req.resume(); return }
    res.locals.actor = actor
    next()
  }, express.json({ limit: NOTICE_IMAGE_BODY_LIMIT }), (req, res) => {
    const actor = String(res.locals.actor)
    const body = uploadSchema.safeParse(req.body)
    const data = body.success ? body.data.data.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '') : ''
    if (!body.success || !BASE64.test(data) || data.length % 4 === 1) { res.status(400).json({ error: 'Повреждённый файл фото' }); return }
    try {
      res.status(201).json({ image: store.uploadImage(actor, Buffer.from(data, 'base64')) })
    } catch (error) {
      sendError(res, error)
    }
  })
  // A body over the limit: one clear answer instead of the generic one.
  router.use('/v1/accounts/me/admin/notices/images', (error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'Фото больше 5 МБ' }); return }
    next(error)
  })
  return router
}

export function createNoticesRouter(accounts: AccountStore, store: NoticeStore, options: { social?: SocialSignals; audit?: NoticeAudit; now?: () => number; translate?: AnnouncementTranslator } = {}) {
  const router = express.Router()
  // Russian → English for the popups, the same translator as the banner (the tests pass a fake).
  const translate = options.translate ?? myMemoryTranslator()
  const ownerRead = new FixedWindowRateLimiter(240, 60 * 1000, options.now)
  const ownerWrite = new FixedWindowRateLimiter(30, 60 * 1000, options.now)
  const playerRead = new FixedWindowRateLimiter(300, 10 * 60 * 1000, options.now)
  const playerWrite = new FixedWindowRateLimiter(120, 10 * 60 * 1000, options.now)
  const signal = (work: () => void) => { try { work() } catch { /* the apps catch up at their next check */ } }
  const audit: NoticeAudit = (...args) => signal(() => options.audit?.(...args))

  const player = (limiter: FixedWindowRateLimiter, req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    const id = accounts.authenticate(bearer(req.get('authorization')))
    if (!id) { res.status(401).json({ error: 'Требуется вход в аккаунт' }); return undefined }
    const retry = limiter.hit(id)
    if (retry) { res.set('Retry-After', String(retry)).status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' }); return undefined }
    return id
  }
  const noticeId = (req: Request, res: Response) => {
    const id = idSchema.safeParse(req.params.id)
    if (!id.success) { res.status(404).json({ error: 'Не найдено' }); return undefined }
    return id.data
  }
  const image = (res: Response, found: { mime: string; data: Buffer } | undefined) => {
    if (!found) { res.status(404).json({ error: 'Фото не найдено' }); return }
    res.json({ mime: found.mime, data: found.data.toString('base64') })
  }

  // ---- the owner ----

  router.post('/v1/accounts/me/admin/notices', async (req, res) => {
    const actor = ownerGuard(accounts, ownerWrite, req, res)
    if (!actor) return
    const body = announcementSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: formError(body.error, 'announcement') }); return }
    try {
      const input = await announcementWithEnglish(body.data as AnnouncementInput, translate)
      const notice = store.createAnnouncement(actor, input)
      res.status(201).json({ notice })
      signal(() => options.social?.changed(store.targets(notice.id)))
      audit(actor, 'notice.send', `№${notice.id}`, { regions: notice.audience.payRegion ?? (notice.audience.regions.join(',') || 'all'), payment: notice.audience.payment, targeted: notice.targeted, images: notice.images })
    } catch (error) {
      sendError(res, error)
    }
  })

  router.post('/v1/accounts/me/admin/surveys', async (req, res) => {
    const actor = ownerGuard(accounts, ownerWrite, req, res)
    if (!actor) return
    const body = surveySchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: formError(body.error, 'survey') }); return }
    const input = await surveyWithEnglish(body.data as SurveyInput, translate)
    const notice = store.createSurvey(actor, input)
    res.status(201).json({ notice })
    signal(() => options.social?.changed(store.targets(notice.id)))
    audit(actor, 'survey.publish', `№${notice.id}`, { regions: notice.audience.payRegion ?? (notice.audience.regions.join(',') || 'all'), payment: notice.audience.payment, targeted: notice.targeted, questions: notice.questions?.length ?? 0 })
  })

  router.get('/v1/accounts/me/admin/notices', (req, res) => {
    if (!ownerGuard(accounts, ownerRead, req, res)) return
    const query = kindSchema.safeParse(req.query)
    if (!query.success) { res.status(400).json({ error: 'Некорректный запрос' }); return }
    res.json({ notices: store.list(query.data.kind) })
  })

  router.post('/v1/accounts/me/admin/notices/:id/withdraw', (req, res) => {
    const actor = ownerGuard(accounts, ownerWrite, req, res)
    if (!actor) return
    const id = noticeId(req, res)
    if (!id) return
    const kind = store.get(id)?.kind
    const notice = kind ? store.withdraw(actor, id, kind) : undefined
    if (!notice) { res.status(404).json({ error: 'Не найдено' }); return }
    res.json({ notice })
    signal(() => options.social?.changed(store.targets(id)))
    audit(actor, 'notice.withdraw', `№${id}`, { kind: notice.kind, seen: notice.seen, closed: notice.closed })
  })

  router.get('/v1/accounts/me/admin/notices/:id/images/:idx', (req, res) => {
    if (!ownerGuard(accounts, ownerRead, req, res)) return
    const id = noticeId(req, res)
    const idx = idxSchema.safeParse(req.params.idx)
    if (!id) return
    image(res, idx.success ? store.image(id, idx.data) : undefined)
  })

  router.get('/v1/accounts/me/admin/surveys/:id/results', (req, res) => {
    if (!ownerGuard(accounts, ownerRead, req, res)) return
    const id = noticeId(req, res)
    if (!id) return
    const results = store.results(id)
    if (!results) { res.status(404).json({ error: 'Опрос не найден' }); return }
    res.json(results)
  })

  router.get('/v1/accounts/me/admin/surveys/:id/responses.csv', (req, res) => {
    const actor = ownerGuard(accounts, ownerWrite, req, res)
    if (!actor) return
    const id = noticeId(req, res)
    if (!id) return
    const results = store.results(id, 50_000)
    if (!results) { res.status(404).json({ error: 'Опрос не найден' }); return }
    const csv = surveyCsv(results.survey.questions ?? [], results.responses)
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="raidos-survey-${id}-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
    audit(actor, 'survey.export', `№${id}`, { rows: results.responses.length })
  })

  // ---- the player ----

  router.get('/v1/me/notices', (req, res) => {
    const accountId = player(playerRead, req, res)
    if (!accountId) return
    res.json(store.inbox(accountId))
  })

  router.post('/v1/me/notices/:id/seen', (req, res) => {
    const accountId = player(playerWrite, req, res)
    if (!accountId) return
    const id = noticeId(req, res)
    if (!id) return
    if (!store.markSeen(id, accountId)) { res.status(404).json({ error: 'Не найдено' }); return }
    res.status(204).end()
  })

  router.post('/v1/me/notices/:id/close', (req, res) => {
    const accountId = player(playerWrite, req, res)
    if (!accountId) return
    const id = noticeId(req, res)
    if (!id) return
    if (!store.close(id, accountId)) { res.status(404).json({ error: 'Не найдено' }); return }
    res.status(204).end()
    signal(() => options.social?.changed([accountId]))
  })

  router.get('/v1/me/notices/:id/images/:idx', (req, res) => {
    const accountId = player(playerRead, req, res)
    if (!accountId) return
    const id = noticeId(req, res)
    if (!id) return
    const idx = idxSchema.safeParse(req.params.idx)
    image(res, idx.success && store.isFor(id, accountId) ? store.image(id, idx.data) : undefined)
  })

  router.post('/v1/me/surveys/:id/later', (req, res) => {
    const accountId = player(playerWrite, req, res)
    if (!accountId) return
    const id = noticeId(req, res)
    if (!id) return
    if (!store.later(id, accountId)) { res.status(404).json({ error: 'Опрос не найден или уже закрыт' }); return }
    res.status(204).end()
  })

  router.post('/v1/me/surveys/:id/responses', (req, res) => {
    const accountId = player(playerWrite, req, res)
    if (!accountId) return
    const id = noticeId(req, res)
    if (!id) return
    const body = answersSchema.safeParse(req.body)
    if (!body.success) { res.status(400).json({ error: 'Некорректные ответы' }); return }
    try {
      res.status(201).json(store.respond(id, accountId, body.data.answers))
      signal(() => options.social?.changed([accountId]))
    } catch (error) {
      sendError(res, error)
    }
  })

  return router
}

const MSK_MS = 3 * 60 * 60 * 1000
const mskText = (value: string) => new Date(Date.parse(value) + MSK_MS).toISOString().slice(0, 16).replace('T', ' ')

/** The responses for Excel: date (Moscow), e-mail, country, region, then one column per question. */
export function surveyCsv(questions: SurveyQuestion[], responses: Array<{ email: string | null; country?: string; countryOther?: string; region: NoticeRegion | 'none'; createdAt: string; answers: Record<string, string[] | string> }>) {
  const regionLabel = (region: NoticeRegion | 'none') => (region === 'none' ? 'Не указана' : REGION_NAMES[region])
  const header = ['Дата (МСК)', 'E-mail', 'Страна', 'Регион', ...questions.map((question, index) => `${index + 1}. ${question.text}`)]
  const answerText = (question: SurveyQuestion, answer: string[] | string | undefined) => {
    if (answer === undefined) return ''
    if (typeof answer === 'string') return answer
    return answer.map((id) => question.options?.find((option) => option.id === id)?.text ?? id).join(', ')
  }
  const rows = responses.map((response) => [
    mskText(response.createdAt),
    response.email ?? 'аккаунт удалён',
    response.countryOther ? `${response.countryOther} (вручную)` : response.country ? countryName(response.country, 'ru') : '',
    regionLabel(response.region),
    ...questions.map((question) => answerText(question, response.answers[question.id])),
  ])
  return `\uFEFF${[header, ...rows].map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
}
