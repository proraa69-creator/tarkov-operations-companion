import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setRenderLanguage } from './renderText'
import { baseLocale, isAppLanguage, languageOption, type AppLanguage, type BaseLocale } from './languages'
import { startDomTranslation } from './domTranslator'

/**
 * The text the screens are written in: 'ru', or 'en' for every other language (German, Japanese and Chinese are drawn
 * over the English, src/i18n/languages.ts). Code that picks a text or a data set compares this.
 */
export type AppLocale = BaseLocale
const KEY = 'tarkov-operations-locale-v1'
interface LocaleValue {
  /** The base text: 'ru' or 'en'. */
  locale: AppLocale
  /** The language the player chose. */
  language: AppLanguage
  revision: number
  setLocale: (language: AppLanguage) => void
}
const LocaleContext = createContext<LocaleValue>({ locale: 'ru', language: 'ru', revision: 0, setLocale: () => {} })

function savedLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(KEY)
    return isAppLanguage(saved) ? saved : 'ru'
  } catch { return 'ru' }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(savedLanguage)
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
  const value = useMemo(() => ({ locale: baseLocale(language), language, revision, setLocale: setLanguage }), [language, revision])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() { return useContext(LocaleContext) }
