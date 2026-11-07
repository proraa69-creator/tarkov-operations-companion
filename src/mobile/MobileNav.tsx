import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { featureEnabled } from '../app/archivedFeatures'
import { NavLink, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight, TriangleAlert, CircleDollarSign, ClipboardList, Crosshair, FlaskConical, Home, Landmark, ListOrdered, Map, Menu, MessagesSquare, Monitor, PackageCheck, PackageX, RefreshCw, Repeat, Search, Settings, ShieldCheck, Skull, Target, UserRound, Users, Warehouse, Wrench, X, KeyRound } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppVersion } from '../app/appVersion'
import { isIosApp, nativePlatform } from '../platform'
import { useLocale } from '../i18n/LocaleProvider'
import { SupportChatDialog } from '../support/SupportChat'
import { NotificationsDialog } from '../notifications/NotificationsButton'
import { unreadNotifications, useNotifications } from '../notifications/notificationCenter'
import { SUPPORT_CHAT_OPEN_EVENT, useSupportUnread } from '../support/supportChatClient'
import { replaceTab, tabsOf, useSavedTabs } from './mobileTabs'
import { useHold } from './useHold'

/**
 * Owner, 13.10.2026: «в нижнем меню убери раздел миникарта … вместо миникарты сделай оружейника туда» (the position
 * from the game's screenshots already shows on «Карты»), and «Задания» is called «Квесты».
 */
interface Section {
  /** The page it opens; «Чат с поддержкой» and «Уведомления» open a window of their own instead. */
  to?: string
  action?: 'chat' | 'notifications'
  ru: string
  en: string
  /** The name on the bar, where a long one does not fit. */
  short?: { ru: string; en: string }
  icon: ComponentType<{ size?: number }>
}

const sectionId = (section: Section) => section.to ?? section.action ?? ''

/** The bar as it comes: mobileTabs.ts DEFAULT_TABS names these. */
const TABS: Section[] = [
  { to: '/', ru: 'Обзор', en: 'Overview', icon: Home },
  { to: '/quests', ru: 'Квесты', en: 'Quests', icon: Target },
  { to: '/maps', ru: 'Карты', en: 'Maps', icon: Map },
  { to: '/gunsmith', ru: 'Оружейник', en: 'Gunsmith', icon: Wrench },
]

const MORE: Section[] = [
  { to: '/flea', ru: 'Барахолка', en: 'Flea Market', short: { ru: 'Барахолка', en: 'Flea' }, icon: CircleDollarSign },
  { to: '/economy/trading', ru: 'Торговля', en: 'Trading', icon: ArrowLeftRight },
  { to: '/tier-lists', ru: 'Тир листы', en: 'Tier lists', icon: ListOrdered },
  { to: '/traders', ru: 'Торговцы', en: 'Traders', icon: Landmark },
  { to: '/hideout', ru: 'Убежище и квесты', en: 'Hideout & quests', short: { ru: 'Убежище', en: 'Hideout' }, icon: Warehouse },
  ...(featureEnabled('economyTools') ? [{ to: '/economy/barters', ru: 'Бартеры', en: 'Barters', icon: Repeat }] : []),
  ...(featureEnabled('economyTools') ? [{ to: '/economy/crafts', ru: 'Крафты', en: 'Crafts', icon: FlaskConical }] : []),
  { to: '/ballistics', ru: 'Баллистика', en: 'Ballistics', icon: Crosshair },
  ...(featureEnabled('weaponBuilds') ? [{ to: '/arsenal/builds', ru: 'Сборка оружия', en: 'Weapon builds', short: { ru: 'Сборка', en: 'Builds' }, icon: Wrench }] : []),
  { to: '/gallery', ru: 'Боссы', en: 'Bosses', icon: Skull },
  { to: '/quest-keys', ru: 'Ключи для квестов', en: 'Quest keys', short: { ru: 'Ключи', en: 'Keys' }, icon: KeyRound },
  { to: '/kappa-items', ru: 'Предметы для Каппы', en: 'Kappa items', short: { ru: 'Каппа', en: 'Kappa' }, icon: PackageCheck },
  ...(featureEnabled('raidBriefing') ? [{ to: '/briefing', ru: 'Брифинг рейда', en: 'Raid briefing', short: { ru: 'Брифинг', en: 'Briefing' }, icon: ClipboardList }] : []),
  ...(featureEnabled('keepItems') ? [{ to: '/keep-items', ru: 'Что не продавать', en: 'Items to keep', short: { ru: 'Хранить', en: 'Keep' }, icon: PackageX }] : []),
  // The PC's «Настройка экрана» presets from the phone (owner, 31.10.2026).
  { to: '/screen', ru: 'Пресеты экрана', en: 'Screen presets', short: { ru: 'Экран', en: 'Screen' }, icon: Monitor },
  { to: '/squad', ru: 'Отряд', en: 'Squad', icon: Users },
  { to: '/profile', ru: 'Профиль', en: 'Profile', icon: UserRound },
  { to: '/admin', ru: 'Админ-панель', en: 'Admin', short: { ru: 'Админка', en: 'Admin' }, icon: ShieldCheck },
  { to: '/settings', ru: 'Настройки', en: 'Settings', icon: Settings },
  { action: 'chat', ru: 'Чат с поддержкой', en: 'Support chat', short: { ru: 'Чат', en: 'Chat' }, icon: MessagesSquare },
  { action: 'notifications', ru: 'Уведомления', en: 'Notifications', short: { ru: 'Уведомл.', en: 'Alerts' }, icon: TriangleAlert },
]

const SECTIONS = [...TABS, ...MORE]

/** The hold that opens the window with the sections: long enough not to come by itself on a tap. */
const TAB_HOLD_MS = 1000

function BarTab({ section, name, active, replacing, onTap, onHold, children }: { section: Section; name: string; active: boolean; replacing: boolean; onTap: () => void; onHold: () => void; children?: ReactNode }) {
  const hold = useHold(onTap, onHold, TAB_HOLD_MS)
  const Icon = section.icon
  const classes = (on: boolean) => `nav-link mobile-tab is-swappable${on ? ' active' : ''}${replacing ? ' is-replacing' : ''}`
  const inside = <><Icon /><span>{name}</span>{children}</>
  if (section.to) return <NavLink to={section.to} end={section.to === '/'} draggable={false} className={({ isActive }) => classes(isActive)} {...hold}>{inside}</NavLink>
  return <button type="button" className={classes(active)} {...hold}>{inside}</button>
}

/**
 * Phone layout: the bottom tab bar and the «Ещё» sheet (replaces the desktop sidebar). «Чат с поддержкой» is in the sheet
 * (support/SupportChat.tsx, a sheet of its own above the tab bar; any tab closes it); «Ещё» counts the friend and squad
 * requests and the support answers not read yet. «Открыть» on the toast «Новое сообщение от поддержки» opens the same
 * chat sheet.
 */
export function MobileTabBar({ onSearch, onRefresh, refreshing, squadBadge = 0, owner = false }: { onSearch: () => void; onRefresh: () => void; refreshing: boolean; squadBadge?: number; owner?: boolean }) {
  const badge = (count: number, label = 'Новых заявок') => count > 0 ? <span className="nav-badge" aria-label={uiText(`${label}: ${count}`)}>{count > 99 ? '99+' : count}</span> : null
  const { locale, setLocale } = useLocale()
  const version = useAppVersion()
  const [moreOpen, setMoreOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const closeChat = useCallback(() => setChatOpen(false), [])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])
  const notificationsUnread = unreadNotifications(useNotifications())
  const chatUnread = useSupportUnread()
  const location = useLocation()
  const [replacing, setReplacing] = useState<number | null>(null)
  // «Админ-панель»: the owner only, never in the iPhone app (App Store build).
  const available = owner && !isIosApp() ? SECTIONS : SECTIONS.filter((entry) => entry.to !== '/admin')
  const barIds = tabsOf(useSavedTabs(), available.map(sectionId))
  const barSections = barIds.flatMap((id) => available.filter((entry) => sectionId(entry) === id))
  // What is not on the bar is in «Ещё»: a section taken off it stands first there.
  const moreEntries = available.filter((entry) => !barIds.includes(sectionId(entry)))
  const inMore = (id: string) => !barIds.includes(id)
  const moreActive = moreEntries.some((entry) => entry.to && (entry.to === '/' ? location.pathname === '/' : location.pathname.startsWith(entry.to)))
  const label = (entry: { ru: string; en: string }) => uiText(locale === 'en' ? entry.en : entry.ru)
  const barLabel = (entry: Section) => label(entry.short ?? entry)
  const countOf = (entry: Section) => entry.to === '/squad' ? badge(squadBadge) : entry.action === 'chat' ? badge(chatUnread, 'Новых сообщений') : entry.action === 'notifications' ? badge(notificationsUnread, 'Уведомления') : null
  const moreChats = inMore('chat') ? chatUnread : 0
  const moreNotifications = inMore('notifications') ? notificationsUnread : 0
  const closeSheets = () => { setMoreOpen(false); setChatOpen(false); setReplacing(null) }
  const openAction = (action: Section['action']) => {
    if (action === 'chat') setChatOpen(true)
    if (action === 'notifications') setNotificationsOpen(true)
  }
  const holdTab = (slot: number) => {
    closeSheets()
    setReplacing(slot)
    try { navigator.vibrate?.(12) } catch { /* no vibration on this device */ }
  }
  const replaced = replacing === null ? undefined : barSections[replacing]
  const replaceTitle = replaced ? uiText(locale === 'en' ? `Replace “${replaced.en}”` : `Заменить «${replaced.ru}»`) : ''

  // The toast «Новое сообщение от поддержки» (support/SupportChat.tsx SupportNotice): its «Открыть» opens the chat here.
  useEffect(() => {
    const show = () => { setMoreOpen(false); setReplacing(null); setChatOpen(true) }
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, show)
    return () => window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, show)
  }, [])

  // Choosing a section, tapping the backdrop or Escape closes the sheet.
  useEffect(() => {
    if (!moreOpen && replacing === null) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMoreOpen(false); setReplacing(null) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [moreOpen, replacing])

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
              {moreEntries.map((entry) => {
                const Icon = entry.icon
                if (!entry.to) return <button type="button" key={sectionId(entry)} className="nav-link mobile-more-link" onClick={() => { setMoreOpen(false); openAction(entry.action) }}><Icon size={20} /><span>{label(entry)}</span>{countOf(entry)}</button>
                return <NavLink key={entry.to} to={entry.to} end={entry.to === '/'} className={({ isActive }) => `nav-link mobile-more-link${isActive ? ' active' : ''}`} onClick={() => setMoreOpen(false)}><Icon size={20} /><span>{label(entry)}</span>{countOf(entry)}</NavLink>
              })}
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
      {replaced && (
        <div className="mobile-more-backdrop" onClick={() => setReplacing(null)}>
          <div className="panel mobile-more-sheet" role="dialog" aria-modal="true" aria-label={replaceTitle} onClick={(event) => event.stopPropagation()}>
            <div className="mobile-more-grip" aria-hidden />
            <div className="mobile-more-head">
              <span className="nav-label">{replaceTitle}</span>
              <button type="button" className="icon-button" onClick={() => setReplacing(null)} aria-label={uiText('Закрыть')}><X size={18} /></button>
            </div>
            <div className="mobile-more-grid">
              {moreEntries.map((entry) => {
                const Icon = entry.icon
                return <button type="button" key={sectionId(entry)} className="nav-link mobile-more-link" onClick={() => { replaceTab(barIds, replacing!, sectionId(entry)); setReplacing(null) }}><Icon size={20} /><span>{label(entry)}</span></button>
              })}
            </div>
          </div>
        </div>
      )}
      <nav className="sidebar mobile-tabbar" aria-label={uiText('Основная навигация')}>
        {barSections.map((entry, slot) => {
          const shown = entry.action === 'chat' ? chatOpen : entry.action === 'notifications' ? notificationsOpen : false
          return <BarTab key={sectionId(entry)} section={entry} name={barLabel(entry)} active={shown} replacing={replacing === slot} onHold={() => holdTab(slot)}
            onTap={() => { const reopen = !shown; closeSheets(); if (reopen) openAction(entry.action) }}>{countOf(entry)}</BarTab>
        })}
        <button type="button" className={`nav-link mobile-tab${moreActive || moreOpen || (chatOpen && inMore('chat')) ? ' active' : ''}`} aria-expanded={moreOpen} onClick={() => { setChatOpen(false); setReplacing(null); setMoreOpen((open) => !open) }}><Menu /><span>{uiText(locale === 'en' ? 'More' : 'Ещё')}</span>{badge((inMore('/squad') ? squadBadge : 0) + moreChats + moreNotifications, moreChats || moreNotifications ? 'Новых уведомлений' : 'Новых заявок')}</button>
      </nav>
      {chatOpen && <SupportChatDialog onClose={closeChat} />}
      {notificationsOpen && <NotificationsDialog onClose={closeNotifications} />}
    </>
  )
}
