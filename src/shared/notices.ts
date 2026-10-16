/**
 * «Объявления по регионам» and «Опросы» (owner, 15.10.2026: «я нажимаю в админ приложении создать объявление, выбираю
 * категорию по снг европе итд … выбираю оплативших или нет, могу прикладывать туда фото»; «создавать опросы … эту
 * статистику я могу посмотреть потом на сайте, указывается почта того кто прошел опрос»). The limits, the audience and
 * the shapes shared by the server (server/src/services/noticeStore.ts), the apps (src/notices/*) and the website's admin
 * panel (website/src/components/admin/AdminNotices.tsx, AdminSurveys.tsx), so a form never sends what the server refuses.
 */

import { cleanSupportText } from './supportChat'

/** A region tab of the admin «Пользователи» (src/shared/countries.ts), «Не указана» included. */
export type NoticeRegion = 'cis' | 'europe' | 'other' | 'none'
export const NOTICE_REGIONS: readonly NoticeRegion[] = ['cis', 'europe', 'other', 'none']
/** «Оплатившие»: an active paid subscription now; «Без оплаты»: a free period or nothing; «Все». Streamers: only «Все». */
export type NoticePayment = 'all' | 'paid' | 'unpaid'
export const NOTICE_PAYMENTS: readonly NoticePayment[] = ['all', 'paid', 'unpaid']
/**
 * The Boosty payment audiences (owner's spec, docs/payments/payment-regions-and-announcements.md; src/shared/paymentRegions.ts):
 * «СНГ» — the CIS without Russia, «Мир» — every country outside the CIS, «Все, кроме России» — both. Russia is never in
 * them (it pays through SBP); an account without a country neither. Chosen instead of the regions above, never with them.
 */
export type NoticePayRegion = 'CIS' | 'WORLD' | 'ALL_PAID_REGIONS'
export const NOTICE_PAY_REGIONS: readonly NoticePayRegion[] = ['CIS', 'WORLD', 'ALL_PAID_REGIONS']
/**
 * Who gets it: the regions (none listed = «Все») AND the payment; or, with `payRegion`, that Boosty payment audience AND
 * the payment (the regions are then empty).
 */
export interface NoticeAudience { regions: NoticeRegion[]; payment: NoticePayment; payRegion?: NoticePayRegion }

export const REGION_NAMES: Record<NoticeRegion, string> = { cis: 'СНГ', europe: 'Европа', other: 'Другие', none: 'Не указана' }
export const PAY_REGION_NAMES: Record<NoticePayRegion, string> = { CIS: 'СНГ', WORLD: 'Мир', ALL_PAID_REGIONS: 'Все, кроме России' }
export const PAYMENT_NAMES: Record<NoticePayment, string> = { all: 'Все', paid: 'Оплатившие', unpaid: 'Без оплаты' }

/** «СНГ, Европа · Оплатившие», «Все · Все», «Boosty: Мир · Все». */
export function audienceText(audience: NoticeAudience) {
  const regions = audience.payRegion ? `Boosty: ${PAY_REGION_NAMES[audience.payRegion]}`
    : audience.regions.length ? audience.regions.map((region) => REGION_NAMES[region]).join(', ') : 'Все регионы'
  return `${regions} · ${PAYMENT_NAMES[audience.payment]}`
}

export const NOTICE_LIMITS = {
  title: 120,
  text: 2000,
  buttonText: 40,
  buttonUrl: 500,
  /** Photos of one announcement. */
  images: 4,
  imageBytes: 5 * 1024 * 1024,
  /** A photo's longest side after the owner app or the site scales it down before sending (src/notices/imageResize.ts). */
  imageSide: 1920,
} as const

export const SURVEY_LIMITS = {
  title: 120,
  intro: 1000,
  questions: 20,
  question: 300,
  options: { min: 2, max: 10 },
  option: 120,
  /** «Свой ответ». */
  answer: 1000,
} as const

/** «Позже» (owner, 15.10.2026): a survey put off comes back at the next start of the app, this many times at most. */
export const SURVEY_LATER_MAX = 3

/** «Один вариант», «Несколько вариантов», «Свой ответ». */
export type SurveyQuestionType = 'single' | 'multiple' | 'text'
export interface SurveyOption { id: string; text: string; textEn?: string }
export interface SurveyQuestion {
  id: string
  text: string
  textEn?: string
  type: SurveyQuestionType
  /** The choice types: 2–10 options. */
  options?: SurveyOption[]
  /** «Несколько вариантов»: at most this many may be chosen. */
  max?: number
  required: boolean
}
/** A player's answers: option ids of a choice question, the text of «Свой ответ». */
export type SurveyAnswers = Record<string, string[] | string>

/** What a player sees of an announcement. `images`: how many photos it has (fetched one by one). */
export interface PlayerNotice {
  id: number
  kind: 'announcement'
  title: string
  text: string
  titleEn?: string
  textEn?: string
  button?: { text: string; textEn?: string; url: string }
  images: number
  createdAt: string
}
/** What a player sees of a survey. `laterLeft`: how many more times «Позже» brings it back. */
export interface PlayerSurvey {
  id: number
  kind: 'survey'
  title: string
  titleEn?: string
  intro?: string
  introEn?: string
  questions: SurveyQuestion[]
  laterLeft: number
  createdAt: string
}

/** The owner's English where the app speaks English and there is one, else the Russian (owner, 15.10.2026). */
export function localized(ru: string, en: string | undefined, locale: 'ru' | 'en') {
  return locale === 'en' && en?.trim() ? en : ru
}

/** Plain text as stored, as in the support chat: line breaks as \n, no control characters, at most one empty line. */
export function cleanNoticeText(raw: string) {
  return cleanSupportText(raw)
}

/** One line (titles, options, the button): every line break becomes a space too. */
export function cleanNoticeLine(raw: string) {
  return cleanNoticeText(raw).replace(/\s*\n\s*/g, ' ')
}

/** A button link: https only (Telegram's https://t.me/… included), no credentials in it. */
export function safeNoticeUrl(raw: string): string | undefined {
  const text = raw.trim()
  if (!text || text.length > NOTICE_LIMITS.buttonUrl) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}
