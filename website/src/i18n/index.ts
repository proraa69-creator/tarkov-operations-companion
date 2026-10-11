import { useSyncExternalStore } from 'react'
import { AUTH_PHRASES } from './phrasesAuth'
import { CABINET_PHRASES } from './phrasesCabinet'
import { LAYOUT_PHRASES } from './phrasesLayout'
import { LEGAL_PHRASES } from './phrasesLegal'
import { PUBLIC_PHRASES } from './phrasesPublic'

/**
 * Russian / English on the website (owner, 11.10.2026: «переключение с русского на английский … справа от личного
 * кабинета»; everything translated except the Russian payment flow, which stays in Russian).
 *
 * Russian is the source text: `tr('Личный кабинет')` returns it as is in Russian and the English from the phrase lists
 * (src/i18n/phrases*.ts) in English; a phrase without English stays Russian. `{name}` placeholders take values:
 * `tr('Выполнено {done} из {total}', { done, total })`. The choice is kept in localStorage (Russian by default).
 * Changing it re-renders the whole site (App keys its routes on it).
 */
export type SiteLocale = 'ru' | 'en'

const STORAGE_KEY = 'raidos-site-locale'
const dictionary = new Map<string, string>()
const listeners = new Set<() => void>()

export function addPhrases(...lists: Array<ReadonlyArray<readonly [string, string]>>) {
  for (const list of lists) for (const [ru, en] of list) dictionary.set(ru, en)
}
addPhrases(LAYOUT_PHRASES, PUBLIC_PHRASES, AUTH_PHRASES, CABINET_PHRASES, LEGAL_PHRASES)

function initialLocale(): SiteLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch { /* storage blocked: Russian */ }
  return 'ru'
}

let current: SiteLocale = initialLocale()
if (typeof document !== 'undefined') document.documentElement.lang = current

export const siteLocale = () => current

export function setSiteLocale(next: SiteLocale) {
  if (next === current) return
  current = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* the choice lasts for this visit only */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const listener of listeners) listener()
}

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
