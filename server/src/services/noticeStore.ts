import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { CIS_COUNTRIES } from '../../../src/shared/countries.js'
import { CIS_PAYMENT_COUNTRIES, paymentRegionOf } from '../../../src/shared/paymentRegions.js'
import { NOTICE_LIMITS, NOTICE_PAY_REGIONS, NOTICE_REGIONS, SURVEY_LATER_MAX, SURVEY_LIMITS, cleanNoticeText, noticeRegionOf, type NoticeAudience, type NoticePayment, type NoticePayRegion, type NoticeRegion, type PlayerNotice, type PlayerSurvey, type SurveyAnswers, type SurveyQuestion } from '../../../src/shared/notices.js'
import { sniffImage, type ImageMime } from './bugReportStore.js'
import { transaction } from './database.js'

/**
 * «Объявления по регионам» and «Опросы» (owner, 15.10.2026; src/shared/notices.ts): the owner sends a popup to the
 * players of some regions and payment states; every app of such an account shows it once, until it is closed there
 * («Понятно») — on every device of the account. A survey comes the same way and is answered once per account.
 *
 *   owner_notices        — one announcement or survey: its texts (Russian, optional English), the button, the
 *                          audience, the survey's questions, who sent it and when, and when it was withdrawn;
 *   owner_notice_images  — the photos of an announcement (PNG / JPEG / WEBP by magic bytes, ≤ 5 MB each, at most 4),
 *                          uploaded one by one before the announcement is sent; unused uploads go after a day;
 *   owner_notice_states  — per account: when the app showed it, when the player closed it, how often «Позже»;
 *   owner_survey_responses — one per survey and account (the primary key: the server keeps a second one out).
 *
 * Who gets one: the accounts that existed when it was sent, not deleted, matching its audience now — the regions (the
 * country's region, src/shared/countries.ts; «Не указана» also matches an account that had no country when it was sent
 * and named one since: the window «Укажите страну» comes first) AND the payment (`paid`: an ordinary account with paid
 * days left now; `unpaid`: an ordinary account without; `all`: everybody, streamers too). A withdrawn one is shown to
 * nobody any more. A Boosty audience (`pay_region`, src/shared/paymentRegions.ts) replaces the regions: «СНГ» — a CIS
 * country but Russia, «Мир» — a country outside the CIS (one typed by hand too), «Все, кроме России» — both; never Russia,
 * never an account without a country.
 */

type Row = Record<string, unknown>
const DAY = 24 * 60 * 60 * 1000
/** All the photos together. */
export const NOTICE_IMAGE_STORAGE_BYTES = 300 * 1024 * 1024
/** Uploads never attached to an announcement go after this long. */
const UNUSED_IMAGE_MS = DAY

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS owner_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    title_en TEXT,
    body TEXT NOT NULL,
    body_en TEXT,
    button_text TEXT,
    button_text_en TEXT,
    button_url TEXT,
    regions TEXT NOT NULL,
    payment TEXT NOT NULL,
    questions TEXT,
    images INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    withdrawn_at INTEGER,
    withdrawn_by TEXT);
  CREATE INDEX IF NOT EXISTS owner_notices_live ON owner_notices(withdrawn_at, created_at);
  CREATE TABLE IF NOT EXISTS owner_notice_images (
    id TEXT PRIMARY KEY,
    notice_id INTEGER,
    idx INTEGER,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS owner_notice_images_notice ON owner_notice_images(notice_id, idx);
  CREATE TABLE IF NOT EXISTS owner_notice_states (
    notice_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    seen_at INTEGER,
    closed_at INTEGER,
    later_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (notice_id, account_id));
  CREATE TABLE IF NOT EXISTS owner_survey_responses (
    survey_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    answers TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (survey_id, account_id));
`

export class NoticeError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export type NoticeKind = 'announcement' | 'survey'

export interface AnnouncementInput {
  title: string
  text: string
  titleEn?: string
  textEn?: string
  button?: { text: string; textEn?: string; url: string }
  audience: NoticeAudience
  /** Uploaded photo ids (uploadImage), in the order to show them. */
  images: string[]
}
export interface SurveyInput {
  title: string
  titleEn?: string
  intro?: string
  introEn?: string
  questions: Array<Omit<SurveyQuestion, 'id' | 'options'> & { options?: Array<{ text: string; textEn?: string }> }>
  audience: NoticeAudience
}

/** What the owner sees in the sent list. */
export interface OwnerNotice {
  id: number
  kind: NoticeKind
  title: string
  titleEn?: string
  text: string
  textEn?: string
  button?: { text: string; textEn?: string; url: string }
  questions?: SurveyQuestion[]
  images: number
  audience: NoticeAudience
  createdBy: string
  createdAt: string
  withdrawnAt?: string
  /** Accounts it is for now (see above); `seen`: whose app showed it; `closed`: who closed it («Понятно») or answered. */
  targeted: number
  seen: number
  closed: number
  /** Surveys: the answers received. */
  responses?: number
}

/** The account as the audience reads it. */
interface Facts { id: string; kind: string; country: string | null; countrySetAt: number | null; createdAt: number; paidUntil: number }

const iso = (ms: unknown) => new Date(Number(ms)).toISOString()
const placeholders = (codes: readonly string[]) => codes.map(() => '?').join(', ')
const optional = <K extends string>(key: K, value: unknown) => (value == null || value === '' ? {} : { [key]: String(value) } as Record<K, string>)

/** Whether an account's payment region is in a Boosty audience (never Russia, never without a country). */
function payRegionMatches(payRegion: NoticePayRegion, country: string | null) {
  const region = paymentRegionOf(country)
  if (!region || region === 'RU') return false
  return payRegion === 'ALL_PAID_REGIONS' || payRegion === region
}

export function audienceMatches(audience: NoticeAudience, sentAt: number, facts: Facts, now: number) {
  if (facts.createdAt > sentAt) return false
  const region = noticeRegionOf(facts.country)
  const regionOk = audience.payRegion ? payRegionMatches(audience.payRegion, facts.country)
    : !audience.regions.length || (region != null && audience.regions.includes(region))
  if (!regionOk) return false
  if (audience.payment === 'all') return true
  const paid = facts.paidUntil > now
  return facts.kind === 'user' && (audience.payment === 'paid' ? paid : !paid)
}

/** The same rule in SQL over `accounts a` (and the paid days as `paid_until`), for the counts and the signals. */
function audienceSql(audience: NoticeAudience, sentAt: number, now: number, paidUntil: string) {
  const parts: string[] = ['a.deleted_at IS NULL', 'a.created_at <= ?']
  const args: Array<string | number> = [sentAt]
  if (audience.payRegion) {
    // The same lists as paymentRegionOf: «СНГ» = CIS without RU, «Мир» = not CIS (RU included in the CIS list), both = not RU.
    if (audience.payRegion === 'CIS') { parts.push(`a.country IN (${placeholders(CIS_PAYMENT_COUNTRIES)})`); args.push(...CIS_PAYMENT_COUNTRIES) }
    else if (audience.payRegion === 'WORLD') { parts.push(`(a.country IS NOT NULL AND a.country NOT IN (${placeholders(CIS_COUNTRIES)}))`); args.push(...CIS_COUNTRIES) }
    else { parts.push("(a.country IS NOT NULL AND a.country <> 'RU')") }
  } else if (audience.regions.length) {
    // «Россия» = RU, «СНГ» = the CIS without RU (CIS_PAYMENT_COUNTRIES), «Мир» = a known country outside the CIS list.
    const any: string[] = []
    for (const region of audience.regions) {
      if (region === 'ru') any.push("a.country = 'RU'")
      if (region === 'cis') { any.push(`a.country IN (${placeholders(CIS_PAYMENT_COUNTRIES)})`); args.push(...CIS_PAYMENT_COUNTRIES) }
      if (region === 'world') { any.push(`(a.country IS NOT NULL AND a.country NOT IN (${placeholders(CIS_COUNTRIES)}))`); args.push(...CIS_COUNTRIES) }
    }
    parts.push(`(${any.join(' OR ')})`)
  }
  if (audience.payment !== 'all') {
    parts.push(`a.kind = 'user' AND ${paidUntil} ${audience.payment === 'paid' ? '>' : '<='} ?`)
    args.push(now)
  }
  return { sql: parts.join(' AND '), args }
}

export class NoticeStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(SCHEMA)
    // The Boosty audiences (src/shared/notices.ts NoticePayRegion), added to older databases; NULL: the regions apply.
    const columns = new Set((db.prepare('PRAGMA table_info(owner_notices)').all() as Row[]).map((row) => String(row.name)))
    if (!columns.has('pay_region')) db.exec('ALTER TABLE owner_notices ADD COLUMN pay_region TEXT')
  }

  /** The paid days of `a` (PaymentStore's subscriptions); 0 on a database without payments. */
  private paidUntilSql() {
    const payments = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'").get() !== undefined
    return payments ? 'COALESCE((SELECT s.paid_until FROM subscriptions s WHERE s.account_id = a.id), 0)' : '0'
  }

  private facts(accountId: string): Facts | undefined {
    const row = this.db.prepare(`SELECT a.id, a.kind, a.country, a.country_set_at, a.created_at, ${this.paidUntilSql()} AS paid_until FROM accounts a WHERE a.id = ? AND a.deleted_at IS NULL`).get(accountId) as Row | undefined
    if (!row) return undefined
    return { id: String(row.id), kind: String(row.kind), country: row.country == null ? null : String(row.country), countrySetAt: row.country_set_at == null ? null : Number(row.country_set_at), createdAt: Number(row.created_at), paidUntil: Number(row.paid_until ?? 0) }
  }

  /** The accounts a notice is for now (see the file comment). */
  targets(id: number): string[] {
    const notice = this.row(id)
    if (!notice) return []
    const { sql, args } = audienceSql(audienceOf(notice), Number(notice.created_at), this.now(), this.paidUntilSql())
    return (this.db.prepare(`SELECT a.id FROM accounts a WHERE ${sql}`).all(...args) as Row[]).map((row) => String(row.id))
  }

  private targetCount(notice: Row) {
    const { sql, args } = audienceSql(audienceOf(notice), Number(notice.created_at), this.now(), this.paidUntilSql())
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM accounts a WHERE ${sql}`).get(...args) as Row).n)
  }

  private row(id: number) {
    return this.db.prepare('SELECT * FROM owner_notices WHERE id = ?').get(id) as Row | undefined
  }

  // ------------------------------------------------------------------------------------------------------------
  // Photos
  // ------------------------------------------------------------------------------------------------------------

  /** One photo for an announcement still being written; its id goes into `images` of create(). */
  uploadImage(actor: string, data: Buffer): { id: string; mime: ImageMime; size: number } {
    if (!data.length) throw new NoticeError(400, 'Пустой файл')
    if (data.length > NOTICE_LIMITS.imageBytes) throw new NoticeError(413, 'Фото больше 5 МБ')
    const mime = sniffImage(data)
    if (!mime) throw new NoticeError(400, 'Фото принимаются только в JPG, PNG или WEBP')
    const now = this.now()
    this.db.prepare('DELETE FROM owner_notice_images WHERE notice_id IS NULL AND created_at < ?').run(now - UNUSED_IMAGE_MS)
    const stored = Number((this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM owner_notice_images').get() as Row).n)
    if (stored + data.length > NOTICE_IMAGE_STORAGE_BYTES) throw new NoticeError(507, 'Хранилище фото заполнено: отзовите старые объявления с фото')
    const id = randomBytes(12).toString('hex')
    this.db.prepare('INSERT INTO owner_notice_images (id, notice_id, idx, mime, size, data, created_by, created_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)').run(id, mime, data.length, data, actor, now)
    return { id, mime, size: data.length }
  }

  image(noticeId: number, idx: number): { mime: ImageMime; data: Buffer } | undefined {
    const row = this.db.prepare('SELECT mime, data FROM owner_notice_images WHERE notice_id = ? AND idx = ?').get(noticeId, idx) as Row | undefined
    return row ? { mime: String(row.mime) as ImageMime, data: Buffer.from(row.data as Uint8Array) } : undefined
  }

  // ------------------------------------------------------------------------------------------------------------
  // The owner
  // ------------------------------------------------------------------------------------------------------------

  createAnnouncement(actor: string, input: AnnouncementInput): OwnerNotice {
    if (input.images.length > NOTICE_LIMITS.images) throw new NoticeError(400, `Не больше ${NOTICE_LIMITS.images} фото`)
    if (new Set(input.images).size !== input.images.length) throw new NoticeError(400, 'Одно фото приложено дважды')
    const now = this.now()
    const id = transaction(this.db, () => {
      for (const image of input.images) {
        const row = this.db.prepare('SELECT notice_id FROM owner_notice_images WHERE id = ?').get(image) as Row | undefined
        if (!row || row.notice_id != null) throw new NoticeError(400, 'Фото не найдено: загрузите его ещё раз')
      }
      const inserted = this.db.prepare(`INSERT INTO owner_notices (kind, title, title_en, body, body_en, button_text, button_text_en, button_url, regions, payment, pay_region, images, created_by, created_at)
        VALUES ('announcement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.title, input.titleEn || null, input.text, input.textEn || null, input.button?.text ?? null, input.button?.textEn || null, input.button?.url ?? null,
        JSON.stringify(input.audience.payRegion ? [] : input.audience.regions), input.audience.payment, input.audience.payRegion ?? null, input.images.length, actor, now)
      const noticeId = Number(inserted.lastInsertRowid)
      input.images.forEach((image, idx) => this.db.prepare('UPDATE owner_notice_images SET notice_id = ?, idx = ? WHERE id = ?').run(noticeId, idx, image))
      return noticeId
    })
    return this.ownerView(this.row(id)!)
  }

  createSurvey(actor: string, input: SurveyInput): OwnerNotice {
    const questions: SurveyQuestion[] = input.questions.map((question, index) => ({
      id: `q${index + 1}`,
      text: question.text,
      ...(question.textEn ? { textEn: question.textEn } : {}),
      type: question.type,
      ...(question.type === 'text' ? {} : { options: (question.options ?? []).map((option, at) => ({ id: `o${at + 1}`, text: option.text, ...(option.textEn ? { textEn: option.textEn } : {}) })) }),
      ...(question.type === 'multiple' && question.max ? { max: question.max } : {}),
      required: question.required,
    }))
    const inserted = this.db.prepare(`INSERT INTO owner_notices (kind, title, title_en, body, body_en, regions, payment, pay_region, questions, created_by, created_at)
      VALUES ('survey', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.title, input.titleEn || null, input.intro ?? '', input.introEn || null,
      JSON.stringify(input.audience.payRegion ? [] : input.audience.regions), input.audience.payment, input.audience.payRegion ?? null, JSON.stringify(questions), actor, this.now())
    return this.ownerView(this.row(Number(inserted.lastInsertRowid))!)
  }

  /** The sent ones, newest first, with their counts. */
  list(kind: NoticeKind, limit = 50): OwnerNotice[] {
    return (this.db.prepare('SELECT * FROM owner_notices WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(kind, limit) as Row[]).map((row) => this.ownerView(row))
  }

  get(id: number, kind?: NoticeKind): OwnerNotice | undefined {
    const row = this.row(id)
    return row && (!kind || row.kind === kind) ? this.ownerView(row) : undefined
  }

  /** «Отозвать»: nobody who has not closed it sees it any more. Returns undefined for an unknown id. */
  withdraw(actor: string, id: number, kind: NoticeKind): OwnerNotice | undefined {
    const row = this.row(id)
    if (!row || row.kind !== kind) return undefined
    if (row.withdrawn_at == null) this.db.prepare('UPDATE owner_notices SET withdrawn_at = ?, withdrawn_by = ? WHERE id = ?').run(this.now(), actor, id)
    return this.ownerView(this.row(id)!)
  }

  private ownerView(row: Row): OwnerNotice {
    const id = Number(row.id)
    const counts = this.db.prepare('SELECT COUNT(seen_at) AS seen, COUNT(closed_at) AS closed FROM owner_notice_states WHERE notice_id = ?').get(id) as Row
    const kind = row.kind === 'survey' ? 'survey' : 'announcement'
    const responses = kind === 'survey' ? Number((this.db.prepare('SELECT COUNT(*) AS n FROM owner_survey_responses WHERE survey_id = ?').get(id) as Row).n) : undefined
    return {
      id,
      kind,
      title: String(row.title),
      ...optional('titleEn', row.title_en),
      text: String(row.body ?? ''),
      ...optional('textEn', row.body_en),
      ...(row.button_url ? { button: { text: String(row.button_text ?? ''), ...optional('textEn', row.button_text_en), url: String(row.button_url) } } : {}),
      ...(kind === 'survey' ? { questions: questionsOf(row) } : {}),
      images: Number(row.images ?? 0),
      audience: audienceOf(row),
      createdBy: String(row.created_by),
      createdAt: iso(row.created_at),
      ...(row.withdrawn_at == null ? {} : { withdrawnAt: iso(row.withdrawn_at) }),
      targeted: this.targetCount(row),
      seen: Number(counts.seen),
      // A survey is «closed» by its answer.
      closed: kind === 'survey' ? responses! : Number(counts.closed),
      ...(responses === undefined ? {} : { responses }),
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // The players
  // ------------------------------------------------------------------------------------------------------------

  /** Whether this notice (live or withdrawn) is for this account. */
  isFor(id: number, accountId: string) {
    const row = this.row(id)
    const facts = this.facts(accountId)
    return Boolean(row && facts && audienceMatches(audienceOf(row), Number(row.created_at), facts, this.now()))
  }

  /** What this account's apps show now: its announcements not closed, its surveys not answered nor put off too often. */
  inbox(accountId: string): { notices: PlayerNotice[]; surveys: PlayerSurvey[] } {
    const facts = this.facts(accountId)
    if (!facts) return { notices: [], surveys: [] }
    const rows = this.db.prepare(`SELECT n.*, st.closed_at AS closed_at, st.later_count AS later_count, r.created_at AS answered_at
      FROM owner_notices n
      LEFT JOIN owner_notice_states st ON st.notice_id = n.id AND st.account_id = ?
      LEFT JOIN owner_survey_responses r ON r.survey_id = n.id AND r.account_id = ?
      WHERE n.withdrawn_at IS NULL AND n.created_at >= ? ORDER BY n.created_at, n.id`).all(accountId, accountId, facts.createdAt) as Row[]
    const now = this.now()
    const notices: PlayerNotice[] = []
    const surveys: PlayerSurvey[] = []
    for (const row of rows.filter((item) => audienceMatches(audienceOf(item), Number(item.created_at), facts, now))) {
      if (row.kind === 'survey') {
        const later = Number(row.later_count ?? 0)
        if (row.answered_at != null || later >= SURVEY_LATER_MAX) continue
        surveys.push({ id: Number(row.id), kind: 'survey', title: String(row.title), ...optional('titleEn', row.title_en), ...optional('intro', row.body), ...optional('introEn', row.body_en), questions: questionsOf(row), laterLeft: SURVEY_LATER_MAX - later - 1, createdAt: iso(row.created_at) })
      } else if (row.closed_at == null) {
        notices.push({
          id: Number(row.id), kind: 'announcement', title: String(row.title), text: String(row.body), ...optional('titleEn', row.title_en), ...optional('textEn', row.body_en),
          ...(row.button_url ? { button: { text: String(row.button_text ?? ''), ...optional('textEn', row.button_text_en), url: String(row.button_url) } } : {}),
          images: Number(row.images ?? 0), createdAt: iso(row.created_at),
        })
      }
    }
    return { notices, surveys }
  }

  /** Accounts created after a notice never get it: the inbox starts from the account's creation (see `inbox`). */
  private mark(id: number, accountId: string, column: 'seen_at' | 'closed_at') {
    const now = this.now()
    this.db.prepare(`INSERT INTO owner_notice_states (notice_id, account_id, seen_at, closed_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(notice_id, account_id) DO UPDATE SET seen_at = COALESCE(seen_at, excluded.seen_at)${column === 'closed_at' ? ', closed_at = COALESCE(closed_at, excluded.closed_at)' : ''}`)
      .run(id, accountId, now, column === 'closed_at' ? now : null)
  }

  /** The app showed it. false: not for this account. */
  markSeen(id: number, accountId: string) {
    if (!this.isFor(id, accountId)) return false
    this.mark(id, accountId, 'seen_at')
    return true
  }

  /** «Понятно»: never shown again on any device of the account. false: not for this account. */
  close(id: number, accountId: string) {
    const row = this.row(id)
    if (row?.kind !== 'announcement' || !this.isFor(id, accountId)) return false
    this.mark(id, accountId, 'closed_at')
    return true
  }

  /** «Позже»: the survey comes back at the next start, SURVEY_LATER_MAX times in all. false: not this account's survey. */
  later(id: number, accountId: string) {
    const row = this.row(id)
    if (row?.kind !== 'survey' || row.withdrawn_at != null || !this.isFor(id, accountId)) return false
    this.mark(id, accountId, 'seen_at')
    this.db.prepare('UPDATE owner_notice_states SET later_count = MIN(later_count + 1, ?) WHERE notice_id = ? AND account_id = ?').run(SURVEY_LATER_MAX, id, accountId)
    return true
  }

  /** The answers of one account, checked against the questions; once (409 after). */
  respond(id: number, accountId: string, raw: unknown) {
    const row = this.row(id)
    if (row?.kind !== 'survey' || row.withdrawn_at != null || !this.isFor(id, accountId)) throw new NoticeError(404, 'Опрос не найден или уже закрыт')
    const answers = checkAnswers(questionsOf(row), raw)
    const now = this.now()
    transaction(this.db, () => {
      const inserted = this.db.prepare('INSERT INTO owner_survey_responses (survey_id, account_id, answers, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(id, accountId, JSON.stringify(answers), now)
      if (!Number(inserted.changes)) throw new NoticeError(409, 'Вы уже ответили на этот опрос')
      this.mark(id, accountId, 'seen_at')
    })
    return { answeredAt: iso(now) }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Survey results (the owner only)
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Per choice question the count and share of every option among those who answered it; per «Свой ответ» the answers;
   * and every response with the respondent's e-mail (null once the account is deleted), country and region.
   */
  results(id: number, maxResponses = 5000) {
    const row = this.row(id)
    if (row?.kind !== 'survey') return undefined
    const questions = questionsOf(row)
    const responses = (this.db.prepare(`SELECT r.account_id, r.answers, r.created_at, a.email, a.deleted_at, a.country, a.country_other
      FROM owner_survey_responses r LEFT JOIN accounts a ON a.id = r.account_id WHERE r.survey_id = ? ORDER BY r.created_at DESC LIMIT ?`).all(id, maxResponses) as Row[])
      .map((item) => {
        const live = item.email != null && item.deleted_at == null
        const country = live && item.country != null ? String(item.country) : undefined
        return {
          accountId: String(item.account_id),
          email: live ? String(item.email) : null,
          region: (country ? noticeRegionOf(country) : undefined) ?? ('none' as const),
          ...(country ? { country } : {}),
          ...(live && item.country_other != null ? { countryOther: String(item.country_other) } : {}),
          createdAt: iso(item.created_at),
          answers: parseAnswers(item.answers),
        }
      })
    const summary = questions.map((question) => {
      const given = responses.map((response) => response.answers[question.id]).filter((answer) => answer !== undefined && (Array.isArray(answer) ? answer.length > 0 : answer !== ''))
      if (question.type === 'text') {
        return { id: question.id, type: question.type, text: question.text, answered: given.length, answers: responses.flatMap((response) => typeof response.answers[question.id] === 'string' && response.answers[question.id] ? [{ text: response.answers[question.id] as string, email: response.email, createdAt: response.createdAt }] : []) }
      }
      const options = (question.options ?? []).map((option) => {
        const count = given.filter((answer) => Array.isArray(answer) && answer.includes(option.id)).length
        return { id: option.id, text: option.text, count, percent: given.length ? Math.round((count / given.length) * 1000) / 10 : 0 }
      })
      return { id: question.id, type: question.type, text: question.text, answered: given.length, options }
    })
    return { survey: this.ownerView(row), questions: summary, responses }
  }
}

function audienceOf(row: Row): NoticeAudience {
  let regions: NoticeRegion[] = []
  try {
    const parsed = JSON.parse(String(row.regions ?? '[]')) as unknown
    if (Array.isArray(parsed)) regions = parsed.filter((item): item is NoticeRegion => (NOTICE_REGIONS as readonly string[]).includes(item))
  } catch { /* none: everybody */ }
  const payment: NoticePayment = row.payment === 'paid' || row.payment === 'unpaid' ? row.payment : 'all'
  const payRegion = NOTICE_PAY_REGIONS.find((item) => item === row.pay_region)
  return payRegion ? { regions: [], payment, payRegion } : { regions, payment }
}

function questionsOf(row: Row): SurveyQuestion[] {
  try {
    const parsed = JSON.parse(String(row.questions ?? '[]')) as unknown
    return Array.isArray(parsed) ? parsed as SurveyQuestion[] : []
  } catch {
    return []
  }
}

function parseAnswers(raw: unknown): SurveyAnswers {
  try {
    const parsed = JSON.parse(String(raw)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SurveyAnswers : {}
  } catch {
    return {}
  }
}

/** The answers as stored, or 400 with what is wrong (the app checks the same before sending). */
export function checkAnswers(questions: SurveyQuestion[], raw: unknown): SurveyAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new NoticeError(400, 'Некорректные ответы')
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) if (!questions.some((question) => question.id === key)) throw new NoticeError(400, 'Ответ на неизвестный вопрос')
  const answers: SurveyAnswers = {}
  questions.forEach((question, index) => {
    const value = given[question.id]
    const number = index + 1
    if (question.type === 'text') {
      if (value !== undefined && typeof value !== 'string') throw new NoticeError(400, `Вопрос ${number}: нужен текст`)
      const text = typeof value === 'string' ? cleanNoticeText(value) : ''
      if (text.length > SURVEY_LIMITS.answer) throw new NoticeError(400, `Вопрос ${number}: ответ длиннее ${SURVEY_LIMITS.answer} символов`)
      if (!text && question.required) throw new NoticeError(400, `Вопрос ${number}: ответ обязателен`)
      if (text) answers[question.id] = text
      return
    }
    const list = value === undefined ? [] : typeof value === 'string' ? [value] : value
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) throw new NoticeError(400, `Вопрос ${number}: некорректный выбор`)
    const ids = [...new Set(list as string[])]
    const known = new Set((question.options ?? []).map((option) => option.id))
    if (ids.some((item) => !known.has(item))) throw new NoticeError(400, `Вопрос ${number}: такого варианта нет`)
    if (question.type === 'single' && ids.length > 1) throw new NoticeError(400, `Вопрос ${number}: выберите один вариант`)
    if (question.type === 'multiple' && question.max && ids.length > question.max) throw new NoticeError(400, `Вопрос ${number}: не больше ${question.max} вариантов`)
    if (!ids.length && question.required) throw new NoticeError(400, `Вопрос ${number}: ответ обязателен`)
    if (ids.length) answers[question.id] = ids
  })
  return answers
}
