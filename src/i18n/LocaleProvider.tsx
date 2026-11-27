import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setRenderLanguage } from './renderText'
import { baseLocale, isAppLanguage, languageOption, type AppLanguage, type BaseLocale } from './languages'
import { startDomTranslation } from './domTranslator'
import { countryLanguage } from './countryLanguage'

/**
 * The text the screens are written in: 'ru', or 'en' for every other language (German, Japanese and Chinese are drawn
 * over the English, src/i18n/languages.ts). Code that picks a text or a data set compares this.
 */
export type AppLocale = BaseLocale
const KEY = 'tarkov-operations-locale-v1'
/**
 * '1' once the app's language is settled: the player picked it (the language picker), or it came from his account's
 * country at the first sign-in on this computer (owner, 25.11.2026: «Язык при входе должен быть от страны аккаунта»), or
 * an older version had already saved one. '0': a new install whose language nothing has decided yet.
 */
const SETTLED_KEY = 'tarkov-operations-locale-chosen-v1'
interface LocaleValue {
  /** The base text: 'ru' or 'en'. */
  locale: AppLocale
  /** The language the player chose. */
  language: AppLanguage
  revision: number
  /** The player's own choice: kept for good, the account's country never changes it. */
  setLocale: (language: AppLanguage) => void
  /** The account's country (GET /v1/accounts/me): its language at the first sign-in of a new install, once. */
  applyAccountCountry: (country: unknown) => void
}
const LocaleContext = createContext<LocaleValue>({ locale: 'ru', language: 'ru', revision: 0, setLocale: () => {}, applyAccountCountry: () => {} })

/** The language saved on this device, Russian when none (also for the screen of a start that failed, src/main.tsx). */
export function savedLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(KEY)
    return isAppLanguage(saved) ? saved : 'ru'
  } catch { return 'ru' }
}

/**
 * The app's language is settled (SETTLED_KEY). The first start with the mark sets it from what is saved: a language an
 * older version saved stays as it is — the player may have picked it, and a Russian-speaking player abroad must not find
 * his app in English after an update; only a new install, with nothing saved, takes its account's country.
 */
export function languageSettled(): boolean {
  try {
    const mark = localStorage.getItem(SETTLED_KEY)
    if (mark === '1' || mark === '0') return mark === '1'
    const settled = isAppLanguage(localStorage.getItem(KEY))
    localStorage.setItem(SETTLED_KEY, settled ? '1' : '0')
    return settled
  } catch { return true }
}

function markSettled() {
  try { localStorage.setItem(SETTLED_KEY, '1') } catch { /* settled for this run */ }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() => {
    // The mark from what an older version saved, before this start saves anything (languageSettled).
    languageSettled()
    return savedLanguage()
  })
  const [revision, setRevision] = useState(0)
  setRenderLanguage(language)
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener('companion-translations-ready', refresh)
    return () => window.removeEventListener('companion-translations-ready', refresh)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(KEY, language) } catch { /* the choice lasts for this run */ }
    document.documentElement.lang = languageOption(language).tag.split('-')[0] === 'zh' ? 'zh-CN' : language
    return startDomTranslation(language)
  }, [language])
  const setLocale = useCallback((next: AppLanguage) => { markSettled(); setLanguage(next) }, [])
  const applyAccountCountry = useCallback((country: unknown) => {
    const next = countryLanguage(country)
    if (!next || languageSettled()) return
    markSettled()
    setLanguage(next)
  }, [])
  const value = useMemo(() => ({ locale: baseLocale(language), language, revision, setLocale, applyAccountCountry }), [language, revision, setLocale, applyAccountCountry])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() { return useContext(LocaleContext) }
