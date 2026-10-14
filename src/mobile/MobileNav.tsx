import { useCallback, useEffect, useState } from 'react'
import { featureEnabled } from '../app/archivedFeatures'
import { NavLink, useLocation } from 'react-router-dom'
import {
  CircleDollarSign, ClipboardList, Crosshair, FlaskConical, Home, Landmark, Map, Menu, MessagesSquare, PackageCheck, PackageX, RefreshCw, Repeat, Search, Settings, Skull, Target, UserRound, Users, Wrench, X,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppVersion } from '../app/appVersion'
import { nativePlatform } from '../platform'
import { useLocale } from '../i18n/LocaleProvider'
import { SupportChatDialog } from '../support/SupportChat'
import { SUPPORT_CHAT_OPEN_EVENT, useSupportUnread } from '../support/supportChatClient'

/**
 * Owner, 13.10.2026: «в нижнем меню убери раздел миникарта … вместо миникарты сделай оружейника туда» (the position
 * from the game's screenshots already shows on «Карты»), and «Задания» is called «Квесты».
 */
const TABS = [
  { to: '/', ru: 'Обзор', en: 'Overview', icon: Home },
  { to: '/quests', ru: 'Квесты', en: 'Quests', icon: Target },
  { to: '/maps', ru: 'Карты', en: 'Maps', icon: Map },
  { to: '/gunsmith', ru: 'Оружейник', en: 'Gunsmith', icon: Wrench },
]

const MORE = [
  { to: '/flea', ru: 'Барахолка', en: 'Flea Market', icon: CircleDollarSign },
  { to: '/traders', ru: 'Торговцы', en: 'Traders', icon: Landmark },
  ...(featureEnabled('economyTools') ? [{ to: '/economy/barters', ru: 'Бартеры', en: 'Barters', icon: Repeat }] : []),
  ...(featureEnabled('economyTools') ? [{ to: '/economy/crafts', ru: 'Крафты', en: 'Crafts', icon: FlaskConical }] : []),
  { to: '/ballistics', ru: 'Баллистика', en: 'Ballistics', icon: Crosshair },
  { to: '/gallery', ru: 'Боссы', en: 'Bosses', icon: Skull },
  ...(featureEnabled('gunBuilder') ? [{ to: '/arsenal/builder', ru: 'Сборщик оружия', en: 'Gun Builder', icon: Wrench }] : []),
  { to: '/kappa-items', ru: 'Предметы для Каппы', en: 'Kappa items', icon: PackageCheck },
  ...(featureEnabled('raidBriefing') ? [{ to: '/briefing', ru: 'Брифинг рейда', en: 'Raid briefing', icon: ClipboardList }] : []),
  ...(featureEnabled('keepItems') ? [{ to: '/keep-items', ru: 'Что не продавать', en: 'Items to keep', icon: PackageX }] : []),
  { to: '/squad', ru: 'Отряд', en: 'Squad', icon: Users },
  { to: '/profile', ru: 'Профиль', en: 'Profile', icon: UserRound },
  { to: '/settings', ru: 'Настройки', en: 'Settings', icon: Settings },
]

/**
 * Phone layout: the bottom tab bar and the «Ещё» sheet (replaces the desktop sidebar). «Чат с поддержкой» is in the sheet
 * (support/SupportChat.tsx, a sheet of its own above the tab bar; any tab closes it); «Ещё» counts the friend and squad
 * requests and the support answers not read yet. «Открыть» on the toast «Новое сообщение от поддержки» opens the same
 * chat sheet.
 */
export function MobileTabBar({ onSearch, onRefresh, refreshing, squadBadge = 0 }: { onSearch: () => void; onRefresh: () => void; refreshing: boolean; squadBadge?: number }) {
  const badge = (count: number, label = 'Новых заявок') => count > 0 ? <span className="nav-badge" aria-label={uiText(`${label}: ${count}`)}>{count > 99 ? '99+' : count}</span> : null
  const { locale, setLocale } = useLocale()
  const version = useAppVersion()
  const [moreOpen, setMoreOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const closeChat = useCallback(() => setChatOpen(false), [])
  const chatUnread = useSupportUnread()
  const location = useLocation()
  const moreActive = MORE.some((entry) => location.pathname.startsWith(entry.to))
  const label = (entry: { ru: string; en: string }) => uiText(locale === 'en' ? entry.en : entry.ru)

  // The toast «Новое сообщение от поддержки» (support/SupportChat.tsx SupportNotice): its «Открыть» opens the chat here.
  useEffect(() => {
    const show = () => { setMoreOpen(false); setChatOpen(true) }
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, show)
    return () => window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, show)
  }, [])

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
                return <NavLink key={entry.to} to={entry.to} className={({ isActive }) => `nav-link mobile-more-link${isActive ? ' active' : ''}`} onClick={() => setMoreOpen(false)}><Icon size={20} /><span>{label(entry)}</span>{entry.to === '/squad' && badge(squadBadge)}</NavLink>
              })}
              <button type="button" className="nav-link mobile-more-link" onClick={() => { setMoreOpen(false); setChatOpen(true) }}><MessagesSquare size={20} /><span>{uiText(locale === 'en' ? 'Support chat' : 'Чат с поддержкой')}</span>{badge(chatUnread, 'Новых сообщений')}</button>
            </nav>
            <div className="mobile-more-tools">
              <button type="button" className="button" onClick={() => { setMoreOpen(false); onSearch() }}><Search size={16} />{uiText(locale === 'en' ? 'Search' : 'Поиск')}</button>
              <button type="button" className="button" onClick={onRefresh}><RefreshCw size={16} className={refreshing ? 'spin' : ''} />{uiText(locale === 'en' ? 'Refresh' : 'Обновить')}</button>
              <div className="locale-switch" aria-label={uiText('Язык интерфейса')}><button className={locale === 'ru' ? 'active' : ''} onClick={() => setLocale('ru')}>RU</button><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button></div>
            </div>
            {/* Owner, 13.10.2026: «на телефоне тоже пиши, какая версия приложения». */}
            <p className="mobile-more-version">{uiText(locale === 'en' ? 'Version' : 'Версия')} {version}{nativePlatform() === 'ios' ? ' · iPhone' : nativePlatform() === 'android' ? ' · Android' : ''}</p>
          </div>
        </div>
      )}
      <nav className="sidebar mobile-tabbar" aria-label={uiText('Основная навигация')}>
        {TABS.map((entry) => {
          const Icon = entry.icon
          return <NavLink key={entry.to} to={entry.to} end={entry.to === '/'} className={({ isActive }) => `nav-link mobile-tab${isActive ? ' active' : ''}`} onClick={() => { setMoreOpen(false); setChatOpen(false) }}><Icon /><span>{label(entry)}</span></NavLink>
        })}
        <button type="button" className={`nav-link mobile-tab${moreActive || moreOpen || chatOpen ? ' active' : ''}`} aria-expanded={moreOpen} onClick={() => { setChatOpen(false); setMoreOpen((open) => !open) }}><Menu /><span>{uiText(locale === 'en' ? 'More' : 'Ещё')}</span>{badge(squadBadge + chatUnread, chatUnread ? 'Новых уведомлений' : 'Новых заявок')}</button>
      </nav>
      {chatOpen && <SupportChatDialog onClose={closeChat} />}
    </>
  )
}
