import { uiText } from '../i18n/renderText'
import { ServerQuickButton } from '../components/ServerQuickButton'
import '../styles/scrollFit.css'
import { SidebarOperator } from '../components/SidebarOperator'
import { BrandMonogram, BrandName } from '../components/BrandMark'
import { UpdateButton } from '../components/UpdateButton'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronRight, CircleDollarSign, ClipboardList, Home, Images, MapPinned, PackageX, Palette,
  Landmark, Map, PackageSearch, RefreshCw, Search, Settings, Shield, Target, UserRound, X,
} from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { ModeRegistrationDialog } from '../components/ModeRegistrationDialog'
import { AccountController } from '../account/AccountController'
import { usePlayerProfileSync } from '../profile/usePlayerProfileSync'
import { applyScanToModes } from '../import/logApply'
import { pushLogProgress, useServerSync } from '../sync/serverSync'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import { useLocale } from '../i18n/LocaleProvider'
import { THEMES, cycleTheme, currentTheme } from '../theme/theme'
import { GearDecor } from '../theme/gear/GearDecor'
import { AlcantaraNap } from '../theme/alcantara/napBrush'
import { MaskBadge } from '../theme/gear/HelmetBadge'
import { TelnyashkaTable } from '../theme/telnyashka/TelnyashkaTable'
import { useMobileLayout } from '../platform'
import { MobileTabBar } from '../mobile/MobileNav'
import { canResolvePlayerProfiles } from '../profile/playerProfileGateway'

const OPEN_REGISTRATION_EVENT = 'tarkov-open-registration'

const LOG_FOLDER_STORAGE_KEY = 'tarkov-operations-log-folder-v1'

const navigation = [
  { to: '/', ru: 'Обзор', en: 'Overview', icon: Home },
  { to: '/quests', ru: 'Текущие задания', en: 'Current Tasks', icon: Target },
  { to: '/maps', ru: 'Карты', en: 'Maps', icon: Map },
  { to: '/flea', ru: 'Барахолка', en: 'Flea Market', icon: CircleDollarSign },
  { to: '/traders', ru: 'Торговцы', en: 'Traders', icon: Landmark },
  { to: '/experimental', ru: 'Мини Карта', en: 'Mini Map', icon: MapPinned },
  { to: '/gallery', ru: 'Галерея', en: 'Gallery', icon: Images },
]

/** «Рейд» group: preparation for the next raid. */
const raidNavigation = [
  { to: '/briefing', ru: 'Брифинг рейда', en: 'Raid briefing', icon: ClipboardList },
  { to: '/keep-items', ru: 'Что не продавать', en: 'Items to keep', icon: PackageX },
]

export function AppShell({ children }: { children: ReactNode }) {
  const state = useAppState()
  const { locale, setLocale } = useLocale()
  const { raidMode, setRaidMode, activeProfile } = state
  const { isFetching, initialLoading, refresh, data } = useTarkovData()
  const { syncError, isSyncing } = usePlayerProfileSync()
  // The phone has no EFT logs: its task progress is the merged records the desktop app uploaded to the server.
  useServerSync(raidMode, state.applyLogStateForMode)
  const mobile = useMobileLayout()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [registrationKey, setRegistrationKey] = useState(0)
  const registrationIdentity = `${activeProfile.id}:${raidMode}`
  const navigate = useNavigate()
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setRegistrationOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const open = () => {
      setRegistrationKey(Date.now())
      setRegistrationOpen(true)
    }
    window.addEventListener(OPEN_REGISTRATION_EVENT, open)
    return () => window.removeEventListener(OPEN_REGISTRATION_EVENT, open)
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

  return (
    <div className={`app-shell${mobile ? ' is-mobile' : ''}`}>
      {!mobile && <aside className="sidebar">
        <NavLink to="/" className="brand">
          <div className="brand-mark"><BrandMonogram /></div>
          <BrandName locale={locale} />
        </NavLink>
        <div className="nav-label">{uiText(locale === 'en' ? 'OPERATIONS' : 'ОПЕРАЦИИ')}</div>
        <nav className="nav-list" aria-label={uiText("Основная навигация")}>
          {uiText(navigation.map(({ to, ru, en, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{uiText(locale === 'en' ? en : ru)}</span></NavLink>))}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>{uiText(locale === 'en' ? 'RAID' : 'РЕЙД')}</div>
        <nav className="nav-list" aria-label={uiText(locale === 'en' ? 'Raid' : 'Рейд')}>
          {raidNavigation.map(({ to, ru, en, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{locale === 'en' ? en : ru}</span></NavLink>)}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>{uiText(locale === 'en' ? 'SYSTEM' : 'СИСТЕМА')}</div>
        <nav className="nav-list"><NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings /><span>{uiText(locale === 'en' ? 'Settings' : 'Настройки')}</span></NavLink></nav>
        <SidebarOperator />
      </aside>}
      {/* Theme decorations sized for the desktop sidebar/wide layout; the phone keeps only the textures. */}
      {!mobile && <><GearDecor /><MaskBadge /><TelnyashkaTable /></>}
      <AlcantaraNap />

      {mobile ? (
        <header className="topbar mobile-topbar">
          <NavLink to="/" className="brand mobile-brand" aria-label="Raid OS"><div className="brand-mark"><BrandMonogram /></div></NavLink>
          <div className="mode-switch" aria-label={uiText("Игровой режим")}><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>{uiText(locale === 'en' ? 'Season' : 'Сезон')}</button></div>
          <button className="profile-chip mobile-profile" onClick={() => navigate('/profile')} title={uiText("Профиль")} aria-label={uiText("Профиль")}><UserRound size={16} /><span>{uiText(activeProfile.modes[raidMode].registration.nickname ?? activeProfile.displayName)}</span></button>
          <ThemeButton />
        </header>
      ) : (
      <header className="topbar">
        <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16} /><span>{uiText(locale === 'en' ? 'Search tasks, items, and maps' : 'Поиск по заданиям, предметам и картам')}</span><kbd>Ctrl K</kbd></button>
        <div className="mode-switch" aria-label={uiText("Игровой режим")}><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>{uiText(locale === 'en' ? 'Season' : 'Сезон')}</button></div>
        <button className="icon-button" onClick={refresh} title={uiText(syncError || 'Обновить данные')} aria-label={uiText("Обновить данные")}><RefreshCw size={16} className={isFetching || isSyncing ? 'spin' : ''} /></button>
        <button className="profile-chip" onClick={() => navigate('/profile')} title={uiText("Профиль")}><UserRound size={15} /><span>{uiText(activeProfile.modes[raidMode].registration.nickname ?? activeProfile.displayName)}</span></button>
        <div className="locale-switch" aria-label={uiText("Язык интерфейса")}><button className={locale === 'ru' ? 'active' : ''} onClick={() => setLocale('ru')}>RU</button><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button></div>
        <UpdateButton />
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
      {mobile && <MobileTabBar onSearch={() => setSearchOpen(true)} onRefresh={refresh} refreshing={isFetching || isSyncing} />}
      <AccountController />
      {uiText(canResolvePlayerProfiles() && registrationOpen && (
        <ModeRegistrationDialog key={`${registrationIdentity}:${registrationKey}`} onClose={() => setRegistrationOpen(false)} />
      ))}
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
