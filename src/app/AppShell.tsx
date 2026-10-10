import { uiText } from '../i18n/renderText'
import { ServerQuickButton } from '../components/ServerQuickButton'
import '../styles/scrollFit.css'
import { SidebarOperator } from '../components/SidebarOperator'
import { featureEnabled, type ArchivedFeature } from './archivedFeatures'
import { BrandEmblem, BrandName } from '../components/BrandMark'
import { UpdateButton } from '../components/UpdateButton'
import { SupportButtons } from '../components/SupportButtons'
import { TopbarRestock } from '../restock/RestockWidgets'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronRight, CircleDollarSign, ClipboardList, Crosshair, FlaskConical, Home, Images, MapPinned, PackageCheck, PackageX, Palette,
  Landmark, Map, PackageSearch, RefreshCw, Repeat, Search, Settings, Shield, Target, TrendingUp, UserRound, Users, Wrench, X,
} from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { AccountController } from '../account/AccountController'
import { useAccountNickname } from '../account/useAccountNickname'
import { usePlayerProfileSync } from '../profile/usePlayerProfileSync'
import { applyScanToModes } from '../import/logApply'
import { bindObjectiveSync, pushLogProgress, syncObjectives, useServerSync } from '../sync/serverSync'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import { useLocale } from '../i18n/LocaleProvider'
import { THEMES, cycleTheme, currentTheme } from '../theme/theme'
import { GearDecor } from '../theme/gear/GearDecor'
import { AlcantaraNap } from '../theme/alcantara/napBrush'
import { MaskBadge } from '../theme/gear/HelmetBadge'
import { TelnyashkaTable } from '../theme/telnyashka/TelnyashkaTable'
import { useMobileLayout } from '../platform'
import { MobileTabBar } from '../mobile/MobileNav'
import { rememberEftAccount } from '../account/eftAccountLink'
import { bindNicknameFromLogs } from '../account/logNickname'
import { useSocialBadge, useSocialEvents } from '../squad/useSocialEvents'
import { SubscriptionExpiryNotice } from '../account/SubscriptionExpiryNotice'


const LOG_FOLDER_STORAGE_KEY = 'tarkov-operations-log-folder-v1'

const navigation = [
  { to: '/', ru: 'Обзор', en: 'Overview', icon: Home },
  { to: '/quests', ru: 'Текущие задания', en: 'Current Tasks', icon: Target },
  { to: '/maps', ru: 'Карты', en: 'Maps', icon: Map },
  { to: '/experimental', ru: 'Мини Карта', en: 'Mini Map', icon: MapPinned },
  { to: '/gallery', ru: 'Галерея', en: 'Gallery', icon: Images },
]

/** «Рейд» group: preparation for the next raid (briefing, items to keep, squad and raid planner). */
const raidNavigationAll: Array<{ to: string; ru: string; en: string; icon: typeof Users; feature?: ArchivedFeature }> = [
  { to: '/briefing', ru: 'Брифинг рейда', en: 'Raid briefing', icon: ClipboardList, feature: 'raidBriefing' },
  { to: '/keep-items', ru: 'Что не продавать', en: 'Items to keep', icon: PackageX, feature: 'keepItems' },
  { to: '/kappa-items', ru: 'Предметы для Каппы', en: 'Kappa items', icon: PackageCheck, feature: 'kappaMenu' },
  { to: '/squad', ru: 'Отряд', en: 'Squad', icon: Users },
]
const raidNavigation = raidNavigationAll.filter((item) => !item.feature || featureEnabled(item.feature))

/** Sidebar group «Экономика»: market, traders and the profit calculators. */
const economyNavigationAll: Array<{ to: string; ru: string; en: string; icon: typeof Users; end?: boolean; feature?: ArchivedFeature }> = [
  { to: '/flea', ru: 'Барахолка', en: 'Flea Market', icon: CircleDollarSign },
  { to: '/traders', ru: 'Торговцы', en: 'Traders', icon: Landmark },
  { to: '/economy', ru: 'Рейтинг ценности', en: 'Value ranking', icon: TrendingUp, end: true, feature: 'economyTools' },
  { to: '/economy/barters', ru: 'Бартеры', en: 'Barters', icon: Repeat, feature: 'economyTools' },
  { to: '/economy/crafts', ru: 'Крафты', en: 'Crafts', icon: FlaskConical, feature: 'economyTools' },
]
const economyNavigation = economyNavigationAll.filter((item) => !item.feature || featureEnabled(item.feature))

/** Sidebar group «Арсенал» (ballistics and other weapon references). */
const arsenalNavigation = [
  { to: '/ballistics', ru: 'Баллистика', en: 'Ballistics', icon: Crosshair },
  ...(featureEnabled('gunBuilder') ? [{ to: '/arsenal/builder', ru: 'Сборщик оружия', en: 'Gun Builder', icon: Wrench }] : []),
]

export function AppShell({ children }: { children: ReactNode }) {
  const state = useAppState()
  const { locale, setLocale } = useLocale()
  const { raidMode, setRaidMode, activeProfile } = state
  const nickname = useAccountNickname()
  // Friend requests and squad invitations arrive at once; the «Отряд» button counts them (squad/useSocialEvents.ts).
  useSocialEvents(raidMode)
  const socialBadge = useSocialBadge(raidMode)
  const { isFetching, initialLoading, refresh, data, source: dataSource } = useTarkovData()
  const { syncError, isSyncing } = usePlayerProfileSync()
  // The phone has no EFT logs: its task progress is the merged records the desktop app uploaded to the server.
  useServerSync(raidMode, state.applyLogStateForMode)
  const mobile = useMobileLayout()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })

  // Objective progress sync reads and updates the active profile (src/sync/serverSync.ts).
  useEffect(() => {
    bindObjectiveSync({
      read: (mode) => stateRef.current.activeProfile.modes[mode],
      apply: (mode, remote) => stateRef.current.applyRemoteObjectives(mode, remote),
    })
    return () => bindObjectiveSync(null)
  }, [])
  // A local objective change (or undo) reaches the server a few seconds later instead of on the next 30 s poll.
  const unsyncedEvents = activeProfile.modes[raidMode].progressEvents.filter((event) => !event.synced).length
  useEffect(() => {
    if (!unsyncedEvents) return
    const timer = window.setTimeout(() => void syncObjectives(raidMode).catch(() => {}), 3000)
    return () => window.clearTimeout(timer)
  }, [raidMode, unsyncedEvents])
  // Stable identity: once the live catalog is here, legacy slug keys in saved progress become task ids.
  useEffect(() => {
    if (dataSource !== 'demo' && data.quests.length) stateRef.current.normalizeTaskKeys(data.quests)
  }, [data.quests, dataSource])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])


  useEffect(() => {
    if (!window.tarkovDesktop) return
    let active = true
    // Each mode gets only its own log events (split by session mode, gateway and profile id).
    let detectedMode = sessionStorage.getItem('eft-last-detected-mode')
    const applyLogResult = (result: ModeLogScanResult) => {
      if (!active) return
      if (result.latestMode) {
        if (detectedMode !== result.latestMode) stateRef.current.setRaidMode(result.latestMode)
        detectedMode = result.latestMode
        sessionStorage.setItem('eft-last-detected-mode', result.latestMode)
      }
      // «Пригласи друга»: the game account of this PC goes to the signed-in server account (EftAccountBinding.tsx).
      rememberEftAccount(result)
      // The nickname from the logs: their AccountId of each mode → its Tarkov.dev profile → bound, nothing to type.
      void bindNicknameFromLogs(result, () => stateRef.current).catch(() => {})
      applyScanToModes(
        result,
        (mode) => stateRef.current.activeProfile.modes[mode].registration,
        (mode, events, characterId, resetAt) => stateRef.current.applyLogStateForMode(mode, events, characterId, resetAt),
      )
      // Signed in to the server: store this scan there and apply the merged server records (all earlier scans).
      void pushLogProgress(
        result,
        (mode) => stateRef.current.activeProfile.modes[mode].registration,
        (mode, events, characterId) => { if (active) stateRef.current.applyLogStateForMode(mode, events, characterId) },
      ).catch(() => {})
    }
    const unsubscribe = window.tarkovDesktop.onLogsUpdated(applyLogResult)
    const savedFolder = localStorage.getItem(LOG_FOLDER_STORAGE_KEY)
    if (savedFolder) {
      void window.tarkovDesktop.startWatchingLogs(savedFolder).then((started) => {
        if (!started) localStorage.removeItem(LOG_FOLDER_STORAGE_KEY)
      }).catch(() => localStorage.removeItem(LOG_FOLDER_STORAGE_KEY))
    } else {
      void window.tarkovDesktop.autoFindAndScanLogs().then((result) => {
        if (!active || !result) return
        applyLogResult(result)
        localStorage.setItem(LOG_FOLDER_STORAGE_KEY, result.folder)
        void window.tarkovDesktop?.startWatchingLogs(result.folder)
      }).catch(() => {})
    }
    return () => {
      active = false
      unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id])

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (normalized.length < 2) return []
    const matches = (...values: string[]) => values.some((value) => `${value} ${uiText(value)}`.toLowerCase().includes(normalized))
    const quests = data.quests.filter((entry) => matches(entry.name)).slice(0, 5).map((entry) => ({ id: entry.id, title: entry.name, detail: `Задание · ${entry.trader}`, url: `/quests?selected=${entry.id}`, icon: Target }))
    const items = data.items.filter((entry) => matches(entry.name, entry.shortName)).slice(0, 7).map((entry) => ({ id: entry.id, title: entry.name, detail: entry.category, url: `/flea?selected=${entry.id}`, icon: PackageSearch }))
    const maps = data.maps.filter((entry) => matches(entry.name)).map((entry) => ({ id: entry.id, title: entry.name, detail: 'Карта', url: `/maps/${entry.id}`, icon: Map }))
    return [...maps, ...quests, ...items].slice(0, 12)
  }, [data, query])

  const openResult = (url: string) => {
    navigate(url)
    setSearchOpen(false)
    setQuery('')
  }

  // The sidebar scrolls in a short window; the themes' edge stripes (::after) follow its full scroll height.
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const sync = () => sidebar.style.setProperty('--sidebar-scroll-h', `${sidebar.scrollHeight}px`)
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(sidebar)
    for (const child of Array.from(sidebar.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [mobile])

  return (
    <div className={`app-shell${mobile ? ' is-mobile' : ''}`}>
      {!mobile && <aside className="sidebar" ref={sidebarRef}>
        <NavLink to="/" className="brand">
          <BrandEmblem />
          <BrandName locale={locale} />
        </NavLink>
        <div className="nav-label">{uiText(locale === 'en' ? 'OPERATIONS' : 'ОПЕРАЦИИ')}</div>
        <nav className="nav-list" aria-label={uiText("Основная навигация")}>
          {uiText(navigation.map(({ to, ru, en, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{uiText(locale === 'en' ? en : ru)}</span></NavLink>))}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>{uiText(locale === 'en' ? 'RAID' : 'РЕЙД')}</div>
        <nav className="nav-list" aria-label={uiText(locale === 'en' ? 'Raid' : 'Рейд')}>
          {raidNavigation.map(({ to, ru, en, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{locale === 'en' ? en : ru}</span>{to === '/squad' && socialBadge > 0 && <span className="nav-badge" aria-label={uiText(`Новых заявок: ${socialBadge}`)}>{socialBadge > 99 ? '99+' : socialBadge}</span>}</NavLink>)}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>{uiText(locale === 'en' ? 'ECONOMY' : 'ЭКОНОМИКА')}</div>
        <nav className="nav-list" aria-label={uiText('Экономика')}>
          {economyNavigation.map(({ to, ru, en, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{uiText(locale === 'en' ? en : ru)}</span></NavLink>)}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>{uiText(locale === 'en' ? 'ARSENAL' : 'АРСЕНАЛ')}</div>
        <nav className="nav-list" aria-label={uiText('Арсенал')}>
          {arsenalNavigation.map(({ to, ru, en, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{uiText(locale === 'en' ? en : ru)}</span></NavLink>)}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>{uiText(locale === 'en' ? 'SYSTEM' : 'СИСТЕМА')}</div>
        <nav className="nav-list"><NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings /><span>{uiText(locale === 'en' ? 'Settings' : 'Настройки')}</span></NavLink><SupportButtons variant="nav" /></nav>
        <SidebarOperator />
      </aside>}
      {/* Theme decorations sized for the desktop sidebar/wide layout; the phone keeps only the textures. */}
      {!mobile && <><GearDecor /><MaskBadge /><TelnyashkaTable /></>}
      <AlcantaraNap />

      {mobile ? (
        <header className="topbar mobile-topbar">
          <NavLink to="/" className="brand mobile-brand" aria-label="Raid OS"><BrandEmblem /></NavLink>
          <div className="mode-switch" aria-label={uiText("Игровой режим")}><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>{uiText(locale === 'en' ? 'Season' : 'Сезон')}</button></div>
          <button className="profile-chip mobile-profile" onClick={() => navigate('/profile')} title={uiText("Профиль")} aria-label={uiText("Профиль")}><UserRound size={16} /><span>{uiText(nickname ?? activeProfile.displayName)}</span></button>
          <ThemeButton />
          <SubscriptionExpiryNotice compact />
        </header>
      ) : (
      <header className="topbar">
        <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16} /><span>{uiText(locale === 'en' ? 'Search tasks, items, and maps' : 'Поиск по заданиям, предметам и картам')}</span><kbd>Ctrl K</kbd></button>
        <div className="mode-switch" aria-label={uiText("Игровой режим")}><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>{uiText(locale === 'en' ? 'Season' : 'Сезон')}</button></div>
        <button className="icon-button" onClick={refresh} title={uiText(syncError || 'Обновить данные')} aria-label={uiText("Обновить данные")}><RefreshCw size={16} className={isFetching || isSyncing ? 'spin' : ''} /></button>
        <button className="profile-chip" onClick={() => navigate('/profile')} title={uiText("Профиль")}><UserRound size={15} /><span>{uiText(nickname ?? activeProfile.displayName)}</span></button>
        <div className="locale-switch" aria-label={uiText("Язык интерфейса")}><button className={locale === 'ru' ? 'active' : ''} onClick={() => setLocale('ru')}>RU</button><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button></div>
        <TopbarRestock />
        <UpdateButton />
        <SubscriptionExpiryNotice />
        <ThemeButton />
        <ServerQuickButton />
        <button className="icon-button" onClick={() => navigate('/settings')} title={uiText("Настройки")}><Shield size={16} /></button>
      </header>
      )}

      <main className="content">{uiText(initialLoading ? <div className="empty-state" role="status"><div><RefreshCw className="spin" size={28} /><h2>{uiText("Загружаем актуальную базу")}</h2><p>{uiText("Задания, предметы, карты и модули убежища…")}</p></div></div> : children)}</main>

      {uiText(searchOpen && <div className="search-overlay" onMouseDown={(event) => event.target === event.currentTarget && setSearchOpen(false)}>
        <div className="search-dialog" role="dialog" aria-modal="true" aria-label={uiText("Глобальный поиск")}>
          <div className="search-box"><Search size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Например: Водолей, ключ 206, Таможня…")} /><button className="icon-button" onClick={() => setSearchOpen(false)}><X size={16} /></button></div>
          <div className="search-results">
            {uiText(query.length < 2 && <div className="empty-state" style={{ minHeight: 170 }}><div><Search size={26} /><p>{uiText("Введите минимум два символа")}</p></div></div>)}
            {uiText(query.length >= 2 && results.length === 0 && <div className="empty-state" style={{ minHeight: 170 }}><div><PackageSearch size={26} /><p>{uiText("Ничего не найдено. Попробуйте другое название.")}</p></div></div>)}
            {uiText(results.map(({ id, title, detail, url, icon: Icon }) => <button key={`${url}-${id}`} className="search-result" onClick={() => openResult(url)}><Icon size={18} /><span><strong>{uiText(title)}</strong><small>{uiText(detail)}</small></span><ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>))}
          </div>
        </div>
      </div>)}
      {mobile && <MobileTabBar squadBadge={socialBadge} onSearch={() => setSearchOpen(true)} onRefresh={refresh} refreshing={isFetching || isSyncing} />}
      <AccountController />
    </div>
  )
}

/** Cycles the colour schemes in order; the current one's name is in the tooltip. */
function ThemeButton() {
  const [theme, setTheme] = useState(currentTheme)
  const label = THEMES.find((entry) => entry.id === theme)?.label ?? ''
  return (
    <button className="icon-button theme-cycle" onClick={() => setTheme(cycleTheme().id)} title={`${uiText('Цветовая схема')}: ${uiText(label)}`} aria-label={uiText('Сменить цветовую схему')}>
      <Palette size={16} />
    </button>
  )
}
