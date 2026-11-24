import { X } from 'lucide-react'
import { SITE_LOCALES, dismissOffer, setSiteLocale, tr, useLanguageOffer, type SiteLocale } from '../i18n'

/** The question in the offered language itself: the visitor reads their own language, whatever the site shows now. */
const QUESTION: Record<SiteLocale, string> = {
  ru: 'Открыть сайт на русском?',
  en: 'View this site in English?',
  de: 'Diese Seite auf Deutsch anzeigen?',
  ja: 'このサイトを日本語で表示しますか？',
  zh: '用简体中文浏览本网站？',
}

/**
 * A first visit shown in one language whose country or browser says another the site has (owner, 24.11.2026: «включай на
 * английском, но предлагай возможный язык»): a small card offers it once; the answer, either way, is remembered.
 */
export function LanguageOffer() {
  const offer = useLanguageOffer()
  if (!offer) return null
  const option = SITE_LOCALES.find((entry) => entry.code === offer)
  if (!option) return null
  return <div className="lang-offer" role="dialog" aria-label={QUESTION[offer]} lang={option.tag} translate="no">
    <span className="lang-offer-question">{QUESTION[offer]}</span>
    <button type="button" className="button primary lang-offer-yes" onClick={() => setSiteLocale(offer)}>{option.name}</button>
    <button type="button" className="lang-offer-close" aria-label={tr('Закрыть')} onClick={dismissOffer}><X size={16} /></button>
  </div>
}
