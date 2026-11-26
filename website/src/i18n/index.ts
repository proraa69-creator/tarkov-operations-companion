import { useSyncExternalStore } from 'react'
import { AUTH_PHRASES } from './phrasesAuth'
import { CABINET_PHRASES } from './phrasesCabinet'
import { LAYOUT_PHRASES } from './phrasesLayout'
import { LEGAL_PHRASES } from './phrasesLegal'
import { PUBLIC_PHRASES } from './phrasesPublic'
import { PROMO_SITE_PHRASES } from './phrasesPromoSite'
import { API_URL } from '../config'

/**
 * Russian / English on the website (owner, 11.10.2026: «переключение с русского на английский … справа от личного
 * кабинета»; everything translated except the Russian payment flow, which stays in Russian).
 *
 * Russian is the source text: `tr('Личный кабинет')` returns it as is in Russian and the English from the phrase lists
 * (src/i18n/phrases*.ts) in English; a phrase without English stays Russian. `{name}` placeholders take values:
 * `tr('Выполнено {done} из {total}', { done, total })`. A first visit gets the language of the visitor's country
 * (autoLocale); the RU / EN switch is kept in localStorage and wins from then on. Changing the language re-renders the
 * whole site (App keys its routes on it).
 */
export type SiteLocale = 'ru' | 'en' | 'de' | 'ja' | 'zh' | 'pl' | 'es' | 'pt' | 'fr' | 'ko' | 'tr'
/** Every language but Russian and English is the English site put into that language (owner, 24.11.2026). */
export type TargetSiteLocale = Exclude<SiteLocale, 'ru' | 'en'>
export const SITE_LOCALES: ReadonlyArray<{ code: SiteLocale; short: string; name: string; tag: string }> = [
  { code: 'ru', short: 'RU', name: 'Русский', tag: 'ru-RU' },
  { code: 'en', short: 'EN', name: 'English', tag: 'en-US' },
  { code: 'de', short: 'DE', name: 'Deutsch', tag: 'de-DE' },
  { code: 'ja', short: 'JA', name: '日本語', tag: 'ja-JP' },
  { code: 'zh', short: 'ZH', name: '简体中文', tag: 'zh-CN' },
  { code: 'pl', short: 'PL', name: 'Polski', tag: 'pl-PL' },
  { code: 'es', short: 'ES', name: 'Español', tag: 'es-ES' },
  { code: 'pt', short: 'PT', name: 'Português (Brasil)', tag: 'pt-BR' },
  { code: 'fr', short: 'FR', name: 'Français', tag: 'fr-FR' },
  { code: 'ko', short: 'KO', name: '한국어', tag: 'ko-KR' },
  { code: 'tr', short: 'TR', name: 'Türkçe', tag: 'tr-TR' },
]
const isSiteLocale = (value: unknown): value is SiteLocale => typeof value === 'string' && SITE_LOCALES.some((option) => option.code === value)
const isTarget = (value: SiteLocale): value is TargetSiteLocale => value !== 'ru' && value !== 'en'

const STORAGE_KEY = 'raidos-site-locale'
const dictionary = new Map<string, string>()
const listeners = new Set<() => void>()

export function addPhrases(...lists: Array<ReadonlyArray<readonly [string, string]>>) {
  for (const list of lists) for (const [ru, en] of list) dictionary.set(ru, en)
}
addPhrases(LAYOUT_PHRASES, PUBLIC_PHRASES, AUTH_PHRASES, CABINET_PHRASES, LEGAL_PHRASES, PROMO_SITE_PHRASES)

/** Countries whose visitors get the Russian site on the first visit (the rest: by the browser's first language). */
// Ukraine reads Russian too (owner, 25.11.2026: «украинский язык удали. Это тот же русский. Пусть будет русский»)
const RUSSIAN_COUNTRIES = new Set(['RU', 'BY', 'UA', 'KZ', 'KG', 'UZ', 'TJ', 'TM', 'AM', 'AZ', 'MD'])
/** The same countries by time zone, while the server's answer is not there yet (or there is no Cloudflare in front). */
const RUSSIAN_ZONES = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Simferopol|Minsk|Chisinau|Kiev|Kyiv|Uzhgorod|Zaporozhye)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Aqtobe|Aqtau|Atyrau|Oral|Qyzylorda|Bishkek|Tashkent|Samarkand|Dushanbe|Ashgabat|Yerevan|Baku))$/

/** Countries whose own language the site has besides Russian (the rest: the browser's language, else English). */
const SPANISH = ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ']
const COUNTRY_LANGUAGES: Readonly<Record<string, SiteLocale>> = {
  CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh', JP: 'ja', DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  PL: 'pl', BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt', FR: 'fr', MC: 'fr', LU: 'fr', KR: 'ko', TR: 'tr',
  ...Object.fromEntries(SPANISH.map((country) => [country, 'es'])),
}
const ZONE_LANGUAGES: ReadonlyArray<[RegExp, SiteLocale]> = [
  [/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Hong_Kong|Macau|Taipei)$/, 'zh'],
  [/^Asia\/Tokyo$/, 'ja'],
  [/^Europe\/(Berlin|Busingen|Vienna|Zurich|Vaduz)$/, 'de'],
  [/^Europe\/Warsaw$/, 'pl'],
  [/^(Europe\/Madrid|Atlantic\/Canary|America\/(Mexico_City|Bogota|Lima|Santiago|Caracas|Argentina\/.+|Buenos_Aires|Montevideo|Guayaquil|La_Paz|Asuncion|Guatemala|Havana))$/, 'es'],
  [/^(America\/(Sao_Paulo|Fortaleza|Recife|Bahia|Belem|Manaus|Cuiaba|Porto_Velho|Boa_Vista|Rio_Branco|Maceio|Araguaina|Campo_Grande|Santarem|Noronha)|Europe\/Lisbon)$/, 'pt'],
  [/^Europe\/(Paris|Monaco|Luxembourg)$/, 'fr'],
  [/^Asia\/Seoul$/, 'ko'],
  [/^(Europe|Asia)\/Istanbul$/, 'tr'],
]

/** The first of the browser's languages the site has (Belarusian and Ukrainian readers get Russian). */
export function browserLocale(languages: readonly string[] = []): SiteLocale | null {
  for (const language of languages) {
    const code = language.toLowerCase().split(/[-_]/)[0]
    if (code === 'ru' || code === 'be' || code === 'uk') return 'ru'
    if (isSiteLocale(code)) return code
  }
  return null
}

/**
 * The language of a first visit (owner, 11.10.2026: «определял, откуда пользователь, и автоматически переключал язык»;
 * 24.11.2026: «если он не зарегистрирован, и он заходит из Китая … включай на этом языке … должен быть язык браузера»):
 * Russian for Russia and its neighbours (by the country Cloudflare reports, else by the time zone); otherwise the
 * browser's own language when the site has it; otherwise the country's language (China, Japan, the German-speaking
 * countries); English for everybody else.
 */
export function autoLocale(hints: { country?: string | null; timeZone?: string; languages?: readonly string[] }): SiteLocale {
  const country = hints.country?.toUpperCase()
  if (country && RUSSIAN_COUNTRIES.has(country)) return 'ru'
  if (!country && hints.timeZone && RUSSIAN_ZONES.test(hints.timeZone)) return 'ru'
  const browser = browserLocale(hints.languages)
  if (browser) return browser
  if (country) return COUNTRY_LANGUAGES[country] ?? 'en'
  for (const [zone, locale] of ZONE_LANGUAGES) if (hints.timeZone && zone.test(hints.timeZone)) return locale
  return 'en'
}

/**
 * A language to offer beside the one shown (owner, 24.11.2026: «включай на английском, но предлагай возможный язык»):
 * the country's own language, else another of the browser's languages, when the site has it and it is not the one shown.
 */
export function offeredLocale(hints: { country?: string | null; languages?: readonly string[] }, shown: SiteLocale): SiteLocale | null {
  const country = hints.country?.toUpperCase()
  const fromCountry = country ? RUSSIAN_COUNTRIES.has(country) ? 'ru' : COUNTRY_LANGUAGES[country] : undefined
  if (fromCountry && fromCountry !== shown) return fromCountry
  for (const language of hints.languages ?? []) {
    const locale = browserLocale([language])
    if (locale && locale !== shown && locale !== 'en') return locale
  }
  return null
}

function savedLocale(): SiteLocale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isSiteLocale(saved)) return saved
  } catch { /* storage blocked */ }
  return null
}

/** Unit tests render the Russian source texts; a real browser guesses the visitor's language. */
/** Inside the PC owner app (its «Сводка» shows the site's admin tabs): Russian, no guessing, the app's own page language. */
const embedded = typeof window !== 'undefined' && 'tarkovDesktop' in window
const detect = import.meta.env.MODE !== 'test' && typeof window !== 'undefined' && !embedded

function browserHints() {
  let timeZone: string | undefined
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* old browser */ }
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]
  return { timeZone, languages }
}

/**
 * `?lang=ru` / `?lang=en`: the language of each page's own address for search engines (App.tsx, public/sitemap.xml), which
 * crawl from abroad and would otherwise only ever see the English site. Nothing is saved; the RU / EN switch works as usual.
 */
function addressLocale(): SiteLocale | null {
  if (typeof location === 'undefined') return null
  const lang = new URLSearchParams(location.search).get('lang')
  return isSiteLocale(lang) ? lang : null
}

/**
 * German, Japanese and Chinese: English → that language, one file per language (src/i18n/locales/<lang>.json, keyed by
 * the English of the phrase lists). The language is switched to once its file is there; until then the site stays
 * English.
 */
const TARGET_LOADERS: Record<TargetSiteLocale, () => Promise<{ default: Record<string, string> }>> = {
  de: () => import('./locales/de.json'),
  ja: () => import('./locales/ja.json'),
  zh: () => import('./locales/zh.json'),
  pl: () => import('./locales/pl.json'),
  es: () => import('./locales/es.json'),
  pt: () => import('./locales/pt.json'),
  fr: () => import('./locales/fr.json'),
  ko: () => import('./locales/ko.json'),
  tr: () => import('./locales/tr.json'),
}
const targetTables = new Map<TargetSiteLocale, ReadonlyMap<string, string>>()
const targetLoading = new Map<TargetSiteLocale, Promise<void>>()
function loadTarget(locale: TargetSiteLocale): Promise<void> {
  let loading = targetLoading.get(locale)
  if (!loading) {
    loading = TARGET_LOADERS[locale]().then((module) => {
      targetTables.set(locale, new Map(Object.entries(module.default).filter(([, text]) => typeof text === 'string' && text.trim())))
    })
    targetLoading.set(locale, loading.catch(() => { targetLoading.delete(locale) }))
  }
  return loading
}

const initial: SiteLocale = embedded ? 'ru' : addressLocale() ?? savedLocale() ?? (detect ? autoLocale(browserHints()) : 'ru')
let current: SiteLocale = isTarget(initial) ? 'en' : initial
let wanted: SiteLocale = initial
if (typeof document !== 'undefined' && !embedded) document.documentElement.lang = current

export const siteLocale = () => current
/** The text the site is written in under the current language: Russian, or English for every other language. */
export const siteBaseLocale = (): 'ru' | 'en' => current === 'ru' ? 'ru' : 'en'

function show(next: SiteLocale) {
  if (next === current) return
  current = next
  if (typeof document !== 'undefined') document.documentElement.lang = SITE_LOCALES.find((option) => option.code === next)?.tag.startsWith('zh') ? 'zh-CN' : next
  for (const listener of listeners) listener()
}

/** `remember: false`: the automatic choice of a first visit — a later visit asks again; the switch is remembered. */
export function setSiteLocale(next: SiteLocale, options: { remember?: boolean } = {}) {
  if (options.remember !== false) {
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* the choice lasts for this visit only */ }
    dismissOffer()
  }
  wanted = next
  if (!isTarget(next)) { show(next); return }
  if (targetTables.has(next)) { show(next); return }
  void loadTarget(next).then(() => { if (wanted === next && targetTables.has(next)) show(next) })
}
if (isTarget(initial)) setSiteLocale(initial, { remember: false })

/** A language offered beside the one shown (src/components/LanguageOffer.tsx), until the visitor answers it. */
const OFFER_KEY = 'raidos-site-language-offer'
let offer: SiteLocale | null = null
const offerListeners = new Set<() => void>()
function setOffer(next: SiteLocale | null) {
  if (next) {
    try { if (localStorage.getItem(OFFER_KEY) === next) next = null } catch { /* asked again next visit */ }
  }
  if (next === offer) return
  offer = next
  for (const listener of offerListeners) listener()
}
export function dismissOffer() {
  if (offer) try { localStorage.setItem(OFFER_KEY, offer) } catch { /* asked again next visit */ }
  setOffer(null)
}
export function useLanguageOffer(): SiteLocale | null {
  return useSyncExternalStore((listener) => { offerListeners.add(listener); return () => offerListeners.delete(listener) }, () => offer, () => null)
}

/** The country from our API (/v1/geo: Cloudflare's CF-IPCountry), once per browser session; then the language follows it. */
async function followCountry() {
  const KEY = 'raidos-site-country'
  let country: string | null | undefined
  try { const cached = sessionStorage.getItem(KEY); if (cached !== null) country = cached || null } catch { /* storage blocked */ }
  if (country === undefined) {
    try {
      const response = await fetch(`${API_URL}/v1/geo`, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } })
      country = response.ok ? ((await response.json()) as { country?: string | null }).country ?? null : null
    } catch { country = null }
    try { sessionStorage.setItem(KEY, country ?? '') } catch { /* asks again next time */ }
  }
  // The visitor chose a language meanwhile: nothing to change or offer.
  if (savedLocale()) return
  if (country) setSiteLocale(autoLocale({ ...browserHints(), country }), { remember: false })
  setOffer(offeredLocale({ ...browserHints(), country }, wanted))
}
if (detect && !savedLocale() && !addressLocale()) void followCountry()

const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }

export function useSiteLocale(): SiteLocale {
  return useSyncExternalStore(subscribe, siteLocale, () => 'ru')
}

/** A phrase of a language's file: as is, else without the punctuation at its end. */
function targetPhrase(table: ReadonlyMap<string, string>, english: string): string | undefined {
  const exact = table.get(english) ?? table.get(english.trim())
  if (exact !== undefined) return exact
  const ending = /^(.*?)([:.…!?]+)$/s.exec(english.trim())
  const bare = ending?.[1] ? table.get(ending[1]) : undefined
  return bare === undefined ? undefined : `${bare}${ending![2]}`
}

/** The text in the current language. */
export function tr(ru: string, values?: Record<string, string | number>): string {
  let text = ru
  if (current !== 'ru') {
    text = dictionary.get(ru) ?? ru
    const table = isTarget(current) ? targetTables.get(current) : undefined
    if (table) text = targetPhrase(table, text) ?? text
  }
  return values ? text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match) : text
}

/** Numbers and dates in the current language. */
export const localeTag = () => SITE_LOCALES.find((option) => option.code === current)?.tag ?? 'ru-RU'
