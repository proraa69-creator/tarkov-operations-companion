import { setSiteLocale, tr, useSiteLocale, type SiteLocale } from '../i18n'
import '../i18n/languageSwitch.css'

const OPTIONS: Array<{ value: SiteLocale; label: string; name: string }> = [
  { value: 'ru', label: 'RU', name: 'Русский' },
  { value: 'en', label: 'EN', name: 'English' },
]

/**
 * RU / EN in the header, right of «Личный кабинет» (src/i18n/index.ts). A computer gets the two-button switch; a phone,
 * where the header is full, one square button with both codes (the active one lit) that switches to the other language.
 */
export function LanguageSwitch() {
  const locale = useSiteLocale()
  const other = locale === 'ru' ? 'en' : 'ru'
  return <>
    <div className="lang-switch" role="group" aria-label={tr('Язык сайта')}>
      {OPTIONS.map((option) => <button key={option.value} type="button" lang={option.value} className={locale === option.value ? 'is-active' : undefined}
        aria-pressed={locale === option.value} title={option.name} onClick={() => setSiteLocale(option.value)}>{option.label}</button>)}
    </div>
    <button type="button" className="lang-toggle" lang={other} aria-label={other === 'en' ? 'Switch to English' : 'Переключить на русский'} onClick={() => setSiteLocale(other)}>
      {OPTIONS.map((option) => <span key={option.value} className={locale === option.value ? 'is-active' : undefined} aria-hidden="true">{option.label}</span>)}
    </button>
  </>
}
