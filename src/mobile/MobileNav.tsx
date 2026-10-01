import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  CircleDollarSign, Home, Images, Landmark, Map, MapPinned, Menu, PackageCheck, RefreshCw, Search, Settings, Target, UserRound, Wrench, X,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'

const TABS = [
  { to: '/', ru: 'Обзор', en: 'Overview', icon: Home },
  { to: '/quests', ru: 'Задания', en: 'Tasks', icon: Target },
  { to: '/maps', ru: 'Карты', en: 'Maps', icon: Map },
  { to: '/live', ru: 'Мини Карта', en: 'Mini Map', icon: MapPinned },
]

const MORE = [
  { to: '/flea', ru: 'Барахолка', en: 'Flea Market', icon: CircleDollarSign },
  { to: '/traders', ru: 'Торговцы', en: 'Traders', icon: Landmark },
  { to: '/gallery', ru: 'Галерея', en: 'Gallery', icon: Images },
  { to: '/arsenal/builder', ru: 'Сборщик оружия', en: 'Gun Builder', icon: Wrench },
  { to: '/kappa-items', ru: 'Предметы для Каппы', en: 'Kappa items', icon: PackageCheck },
  { to: '/profile', ru: 'Профиль', en: 'Profile', icon: UserRound },
  { to: '/settings', ru: 'Настройки', en: 'Settings', icon: Settings },
]

/** Phone layout: the bottom tab bar and the «Ещё» sheet (replaces the desktop sidebar). */
export function MobileTabBar({ onSearch, onRefresh, refreshing }: { onSearch: () => void; onRefresh: () => void; refreshing: boolean }) {
  const { locale, setLocale } = useLocale()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const moreActive = MORE.some((entry) => location.pathname.startsWith(entry.to))
  const label = (entry: { ru: string; en: string }) => uiText(locale === 'en' ? entry.en : entry.ru)

  // Choosing a section, tapping the backdrop or Escape closes the sheet.
  useEffect(() => {
    if (!moreOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [moreOpen])

  return (
    <>
      {moreOpen && (
        <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="panel mobile-more-sheet" role="dialog" aria-modal="true" aria-label={uiText(locale === 'en' ? 'More' : 'Ещё')} onClick={(event) => event.stopPropagation()}>
            <div className="mobile-more-grip" aria-hidden />
            <div className="mobile-more-head">
              <span className="nav-label">{uiText(locale === 'en' ? 'SECTIONS' : 'РАЗДЕЛЫ')}</span>
              <button type="button" className="icon-button" onClick={() => setMoreOpen(false)} aria-label={uiText('Закрыть')}><X size={18} /></button>
            </div>
            <nav className="mobile-more-grid">
              {MORE.map((entry) => {
                const Icon = entry.icon
                return <NavLink key={entry.to} to={entry.to} className={({ isActive }) => `nav-link mobile-more-link${isActive ? ' active' : ''}`} onClick={() => setMoreOpen(false)}><Icon size={20} /><span>{label(entry)}</span></NavLink>
              })}
            </nav>
            <div className="mobile-more-tools">
              <button type="button" className="button" onClick={() => { setMoreOpen(false); onSearch() }}><Search size={16} />{uiText(locale === 'en' ? 'Search' : 'Поиск')}</button>
              <button type="button" className="button" onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'spin' : ''} />{uiText(locale === 'en' ? 'Refresh' : 'Обновить')}</button>
              <div className="locale-switch" aria-label={uiText('Язык интерфейса')}><button className={locale === 'ru' ? 'active' : ''} onClick={() => setLocale('ru')}>RU</button><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button></div>
            </div>
          </div>
        </div>
      )}
      <nav className="sidebar mobile-tabbar" aria-label={uiText('Основная навигация')}>
        {TABS.map((entry) => {
          const Icon = entry.icon
          return <NavLink key={entry.to} to={entry.to} end={entry.to === '/'} className={({ isActive }) => `nav-link mobile-tab${isActive ? ' active' : ''}`} onClick={() => setMoreOpen(false)}><Icon /><span>{label(entry)}</span></NavLink>
        })}
        <button type="button" className={`nav-link mobile-tab${moreActive || moreOpen ? ' active' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><Menu /><span>{uiText(locale === 'en' ? 'More' : 'Ещё')}</span></button>
      </nav>
    </>
  )
}
