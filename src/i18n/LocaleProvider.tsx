import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setRenderLanguage } from './renderText'

export type AppLocale = 'ru' | 'en'
const KEY = 'tarkov-operations-locale-v1'
const LocaleContext = createContext<{ locale: AppLocale; revision: number; setLocale: (locale: AppLocale) => void }>({ locale: 'ru', revision: 0, setLocale: () => {} })

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(() => localStorage.getItem(KEY) === 'en' ? 'en' : 'ru')
  const [revision, setRevision] = useState(0)
  setRenderLanguage(locale)
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener('companion-translations-ready', refresh)
    return () => window.removeEventListener('companion-translations-ready', refresh)
  }, [])
  useEffect(() => { localStorage.setItem(KEY, locale); document.documentElement.lang = locale }, [locale])
  const value = useMemo(() => ({ locale, revision, setLocale }), [locale, revision])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() { return useContext(LocaleContext) }
