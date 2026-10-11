import { useSyncExternalStore } from 'react'
import { AUTH_PHRASES } from './phrasesAuth'
import { CABINET_PHRASES } from './phrasesCabinet'
import { LAYOUT_PHRASES } from './phrasesLayout'
import { LEGAL_PHRASES } from './phrasesLegal'
import { PUBLIC_PHRASES } from './phrasesPublic'
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
export type SiteLocale = 'ru' | 'en'

const STORAGE_KEY = 'raidos-site-locale'
const dictionary = new Map<string, string>()
const listeners = new Set<() => void>()

export function addPhrases(...lists: Array<ReadonlyArray<readonly [string, string]>>) {
  for (const list of lists) for (const [ru, en] of list) dictionary.set(ru, en)
}
addPhrases(LAYOUT_PHRASES, PUBLIC_PHRASES, AUTH_PHRASES, CABINET_PHRASES, LEGAL_PHRASES)

/** Countries whose visitors get the Russian site on the first visit (the rest: by the browser's first language). */
const RUSSIAN_COUNTRIES = new Set(['RU', 'BY', 'KZ', 'KG', 'UZ', 'TJ', 'TM', 'AM', 'AZ', 'MD'])
/** The same countries by time zone, while the server's answer is not there yet (or there is no Cloudflare in front). */
const RUSSIAN_ZONES = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Simferopol|Minsk|Chisinau)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Aqtobe|Aqtau|Atyrau|Oral|Qyzylorda|Bishkek|Tashkent|Samarkand|Dushanbe|Ashgabat|Yerevan|Baku))$/

/**
 * The language of a first visit (owner, 11.10.2026: «определял, откуда пользователь, и автоматически переключал язык»):
 * Russian for Russia and its neighbours (by the country Cloudflare reports, else by the time zone), and for anyone whose
 * browser asks for Russian first; English for everybody else.
 */
export function autoLocale(hints: { country?: string | null; timeZone?: string; languages?: readonly string[] }): SiteLocale {
  const browserRussian = /^(ru|be)\b/i.test(hints.languages?.[0] ?? '')
  if (hints.country) return RUSSIAN_COUNTRIES.has(hints.country.toUpperCase()) || browserRussian ? 'ru' : 'en'
  if (hints.timeZone && RUSSIAN_ZONES.test(hints.timeZone)) return 'ru'
  return browserRussian ? 'ru' : 'en'
}

function savedLocale(): SiteLocale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch { /* storage blocked */ }
  return null
}

/** Unit tests render the Russian source texts; a real browser guesses the visitor's language. */
const detect = import.meta.env.MODE !== 'test' && typeof window !== 'undefined'

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
  return lang === 'ru' || lang === 'en' ? lang : null
}

let current: SiteLocale = addressLocale() ?? savedLocale() ?? (detect ? autoLocale(browserHints()) : 'ru')
if (typeof document !== 'undefined') document.documentElement.lang = current

export const siteLocale = () => current

/** `remember: false`: the automatic choice of a first visit — a later visit asks again; the RU / EN switch is remembered. */
export function setSiteLocale(next: SiteLocale, options: { remember?: boolean } = {}) {
  if (options.remember !== false) {
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* the choice lasts for this visit only */ }
  }
  if (next === current) return
  current = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const listener of listeners) listener()
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
  // The visitor chose a language meanwhile, or the server does not know the country: nothing to change.
  if (!country || savedLocale()) return
  setSiteLocale(autoLocale({ ...browserHints(), country }), { remember: false })
}
if (detect && !savedLocale() && !addressLocale()) void followCountry()

const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }

export function useSiteLocale(): SiteLocale {
  return useSyncExternalStore(subscribe, siteLocale, () => 'ru')
}

/** The text in the current language. */
export function tr(ru: string, values?: Record<string, string | number>): string {
  const text = current === 'en' ? dictionary.get(ru) ?? ru : ru
  return values ? text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match) : text
}

/** Numbers and dates in the current language. */
export const localeTag = () => current === 'en' ? 'en-US' : 'ru-RU'
