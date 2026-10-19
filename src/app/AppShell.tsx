import { uiText } from '../i18n/renderText'
import { ServerQuickButton } from '../components/ServerQuickButton'
import '../styles/scrollFit.css'
import { SidebarOperator } from '../components/SidebarOperator'
import { RequestsNavButton } from '../components/RequestsNavButton'
import { AdminNavLink } from '../admin/AdminNavLink'
import { featureEnabled, type ArchivedFeature } from './archivedFeatures'
import { BrandEmblem, BrandName } from '../components/BrandMark'
import { UpdateButton } from '../components/UpdateButton'
import { SupportButtons } from '../components/SupportButtons'
import { TopbarRestock } from '../restock/RestockWidgets'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronRight, CircleDollarSign, ClipboardList, Crosshair, FlaskConical, Home, PackageCheck, PackageX, Palette,
  Landmark, Map, PackageSearch, RefreshCw, Repeat, Search, Settings, Shield, Skull, Target, TrendingUp, UserRound, Users, Warehouse, Wrench, X,
} from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useTarkovData, useTarkovDataStatus } from '../data/DataProvider'
import { AccountController } from '../account/AccountController'
import { useAccountNickname } from '../account/useAccountNickname'
import { useQuestExperienceLevel } from '../profile/questExperience'
import { AnnouncementBanner } from '../announcement/AnnouncementBanner'
import { applyScanToModes, LOG_FOLDER_STORAGE_KEY } from '../import/logApply'
import { followDesktopLogStatus, noteLogScan, updateLogStatus } from '../import/logStatus'
import { firstApplication } from '../import/logResults'
import { bindGameModeTarget, bindHideoutSync, bindLevelSync, bindManualSync, bindObjectiveSync, bindQuestMirrorSource, bindStorySync, noteDesktopLogsMissing, objectiveEvent, pushGameMode, pushLogProgress, pushQuestMirror, syncManualMarks, syncObjectives, syncStory, useServerAccount, useServerSync } from '../sync/serverSync'
import { manualMarksOf } from '../quests/questInputs'
import { storyProgressRecords, storyRecordsOf } from '../sync/storyRecords'
import { traderQuestIdsForResets, type ModeLogScanResult } from '../import/eftLogTimeline'
import type { RaidMode } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { THEMES, cycleTheme, currentTheme } from '../theme/theme'
import { GearDecor } from '../theme/gear/GearDecor'
import { AlcantaraNap } from '../theme/alcantara/napBrush'
import { MaskBadge } from '../theme/gear/HelmetBadge'
import { TelnyashkaTable } from '../theme/telnyashka/TelnyashkaTable'
import { isAndroidApp, useMobileLayout } from '../platform'
import { MobileTabBar } from '../mobile/MobileNav'
import { PhoneBackButton } from '../mobile/backNavigation'
import { useScrollMemory } from '../mobile/backHistory'
import { LiveFeedRunner } from '../mobile/livePosition'
import { PhoneItemToast } from '../mobile/PhoneItemToast'
import { AndroidUpdateBanner } from '../mobile/AndroidUpdatePanel'
import { rememberEftAccount } from '../account/eftAccountLink'
import { bindNicknameFromLogs } from '../account/logNickname'
import { useSocialBadge, useSocialEvents } from '../squad/useSocialEvents'
import { usePresenceHeartbeat } from '../sync/presence'
import { useShareLevels } from '../squad/useShareLevels'
import { setMapMirrorServer } from '../data/mapMirror'
import { SubscriptionExpiryNotice } from '../account/SubscriptionExpiryNotice'
import { SupportNotice } from '../support/SupportChat'
import { ModeResetToast } from '../components/ModeResetToast'
import { PrestigeIcon } from '../components/PrestigeIcon'
import { prestigeLabel } from '../profile/prestige'


const navigation = [
  { to: '/', ru: 'Обзор', en: 'Overview', icon: Home },
  // «Квесты», as on the phone (owner, 13.10.2026: «Задания» → «Квесты» on the PC too).
  { to: '/quests', ru: 'Квесты', en: 'Quests', icon: Target },
  { to: '/maps', ru: 'Карты', en: 'Maps', icon: Map },
  { to: '/gallery', ru: 'Боссы', en: 'Bosses', icon: Skull },
]

/** «Рейд» group: preparation for the next raid (briefing, items to keep, squad and raid planner). */
const raidNavigationAll: Array<{ to: string; ru: string; en: string; icon: typeof Users; feature?: ArchivedFeature }> = [
  { to: '/briefing', ru: 'Брифинг рейда', en: 'Raid briefing', icon: ClipboardList, feature: 'raidBriefing' },
  { to: '/keep-items', ru: 'Что не продавать', en: 'Items to keep', icon: PackageX, feature: 'keepItems' },
  { to: '/kappa-items', ru: 'Предметы для Каппы', en: 'Kappa items', icon: PackageCheck, feature: 'kappaMenu' },
  { to: '/squad', ru: 'Отряд', en: 'Squad', icon: Users },
]
const raidNavigation = raidNavigationAll.filter((item) => !item.feature || featureEnabled(item.feature))
/** Counting objectives, notes and the history (archived): only then do the logs' quest status events go to the server too. */
const manualObjectives = featureEnabled('manualObjectives')
/** The game's mode the app switched to last in this session (the logs' own mode is logStatus.ts DETECTED_MODE_KEY). */
const FOLLOWED_MODE_KEY = 'eft-app-followed-mode'

/** Sidebar group «Экономика»: market, traders and the profit calculators. */
const economyNavigationAll: Array<{ to: string; ru: string; en: string; icon: typeof Users; end?: boolean; feature?: ArchivedFeature }> = [
  { to: '/flea', ru: 'Барахолка', en: 'Flea Market', icon: CircleDollarSign },
  { to: '/traders', ru: 'Торговцы', en: 'Traders', icon: Landmark },
  { to: '/hideout', ru: 'Убежище', en: 'Hideout', icon: Warehouse },
  { to: '/economy', ru: 'Рейтинг ценности', en: 'Value ranking', icon: TrendingUp, end: true, feature: 'economyTools' },
  { to: '/economy/barters', ru: 'Бартеры', en: 'Barters', icon: Repeat, feature: 'economyTools' },
  { to: '/economy/crafts', ru: 'Крафты', en: 'Crafts', icon: FlaskConical, feature: 'economyTools' },
]
/** New pages waiting for the owner's approval show in a development run (src/app/archivedFeatures.ts). */
const previewed = (feature: ArchivedFeature) => featureEnabled(feature) || (import.meta.env.DEV && feature === 'weaponBuilds')
const economyNavigation = economyNavigationAll.filter((item) => !item.feature || previewed(item.feature))

/** Sidebar group «Арсенал» (ballistics and other weapon references). */
const arsenalNavigation = [
  { to: '/ballistics', ru: 'Баллистика', en: 'Ballistics', icon: Crosshair },
  ...(previewed('weaponBuilds') ? [{ to: '/arsenal/builds', ru: 'Сборка оружия', en: 'Weapon builds', icon: Wrench }] : []),
]

export function AppShell({ children }: { children: ReactNode }) {
  const state = useAppState()
  const { locale, setLocale } = useLocale()
  const { raidMode, setRaidMode, activeProfile } = state
  const nickname = useAccountNickname()
  // Friend requests and squad invitations arrive at once; the «Отряд» button counts them (squad/useSocialEvents.ts).
  useSocialEvents(raidMode)
  // «Онлайн сейчас»: this app tells the server it is open while signed in, about once a minute (sync/presence.ts).
  usePresenceHeartbeat()
  // Our server's copy of the maps (data/mapMirror.ts) lives on the account's server.
  const mirrorServer = useServerAccount().status?.serverUrl
  useEffect(() => { setMapMirrorServer(mirrorServer) }, [mirrorServer])
  const socialBadge = useSocialBadge(raidMode)
  const { initialLoading, refresh, data, source: dataSource } = useTarkovData()
  // Quests turned in since the level was read raise it (src/profile/questExperience.ts).
  useQuestExperienceLevel()
  // The phone has no EFT logs: its task progress is the merged records the desktop app uploaded to the server.
  // The open map goes with a screenshot position whose map the logs do not name (the phone draws the dot there too).
  const shownMap = useMemo(() => {
    const map = data.maps.find((entry) => entry.id === state.selectedMapId)
    return map ? { id: map.id, bounds: map.bounds } : null
  }, [data.maps, state.selectedMapId])
  useServerSync(raidMode, state.applyLogStateForMode, shownMap)
  useShareLevels(activeProfile.modes) // «Информация о друге»: this PC's level in every mode for friends (desktop only)
  const mobile = useMobileLayout()
  useScrollMemory(mobile)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })

  // Objective progress sync reads and updates the active profile (src/sync/serverSync.ts): the ticks reach the other devices.
  useEffect(() => {
    bindObjectiveSync({
      read: (mode) => stateRef.current.activeProfile.modes[mode],
      apply: (mode, remote) => stateRef.current.applyRemoteObjectives(mode, remote),
    })
    return () => bindObjectiveSync(null)
  }, [])
  // «Убежище»: the active profile's found items are the ones kept on the account (sync/serverSync.ts syncHideout).
  useEffect(() => {
    bindHideoutSync(() => stateRef.current.activeProfile.id)
    // The phone takes the level its PC shared (quest availability depends on it).
    bindLevelSync((mode, level, observedAt) => stateRef.current.applyScreenLevel(mode, level, observedAt))
    return () => { bindHideoutSync(null); bindLevelSync(null) }
  }, [])
  // The PC's quest decisions go to the server as they are, a moment after they change (src/sync/questMirror.ts): the
  // phone shows the same quests (owner, 18.10.2026). The stored records, never the copy an app shows over them.
  const storedModes = state.profiles.find((profile) => profile.id === activeProfile.id)?.modes
  useEffect(() => {
    bindQuestMirrorSource((mode) => stateRef.current.profiles.find((profile) => profile.id === stateRef.current.activeProfile.id)?.modes[mode])
    return () => bindQuestMirrorSource(null)
  }, [])
  // The PC's mode — switched here or by the game's logs — goes to the phone, which switches too (owner, 20.10.2026).
  useEffect(() => {
    bindGameModeTarget((mode) => stateRef.current.setRaidMode(mode))
    return () => bindGameModeTarget(null)
  }, [])
  useEffect(() => {
    if (window.tarkovDesktop) void pushGameMode(raidMode).catch(() => {})
  }, [raidMode])
  const mirrorPvp = storedModes?.pvp
  const mirrorPve = storedModes?.pve
  const mirrorSeason = storedModes?.seasonal
  useEffect(() => {
    if (!window.tarkovDesktop) return
    const timer = window.setTimeout(() => {
      if (mirrorPvp) void pushQuestMirror('pvp', mirrorPvp).catch(() => {})
      if (mirrorPve) void pushQuestMirror('pve', mirrorPve).catch(() => {})
      if (mirrorSeason) void pushQuestMirror('seasonal', mirrorSeason).catch(() => {})
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [mirrorPvp, mirrorPve, mirrorSeason])
  // A local objective change (or undo) reaches the server a few seconds later instead of on the next 30 s poll.
  const unsyncedEvents = activeProfile.modes[raidMode].progressEvents.filter((event) => !event.synced && (manualObjectives || objectiveEvent(event))).length
  useEffect(() => {
    if (!unsyncedEvents) return
    const timer = window.setTimeout(() => void syncObjectives(raidMode).catch(() => {}), 3000)
    return () => window.clearTimeout(timer)
  }, [raidMode, unsyncedEvents])
  // Profile resets in the logs count only for the catalog's trader quests (P3): the main process gets this mode's ids
  // whenever its catalog loads (electron/logWatcher.ts keeps them for the next start).
  const catalogMode = dataSource === 'demo' ? undefined : data.metadata?.mode
  useEffect(() => {
    if (!catalogMode || !data.quests.length) return
    const ids = traderQuestIdsForResets(data.quests)
    if (ids.length) void window.tarkovDesktop?.setLogQuestIds?.(catalogMode, ids).catch(() => false)
  }, [catalogMode, data.quests])
  // Story chapters through the server (P9): read and applied with the catalog of their mode (chapters and stage ids).
  const storyCatalog = useRef<{ mode?: RaidMode; quests: typeof data.quests }>({ quests: [] })
  useEffect(() => { storyCatalog.current = { mode: catalogMode, quests: data.quests } }, [catalogMode, data.quests])
  useEffect(() => {
    bindStorySync({
      read: (mode) => {
        const catalog = storyCatalog.current
        if (catalog.mode !== mode) return null
        const progress = stateRef.current.activeProfile.modes[mode]
        return { characterId: progress.logCharacterId, records: storyRecordsOf(progress, catalog.quests) }
      },
      apply: (mode, records, characterId) => {
        const catalog = storyCatalog.current
        if (catalog.mode === mode) stateRef.current.applyRemoteStoryForMode(mode, storyProgressRecords(records, catalog.quests), characterId)
      },
    })
    return () => bindStorySync(null)
  }, [])
  // A chapter read on this PC reaches the server a few seconds later (not on the next 30 s poll).
  const storyKey = useMemo(() => catalogMode === raidMode ? JSON.stringify(storyRecordsOf(activeProfile.modes[raidMode], data.quests)) : '', [catalogMode, raidMode, activeProfile.modes, data.quests])
  useEffect(() => {
    if (!storyKey) return
    const timer = window.setTimeout(() => void syncStory(raidMode).catch(() => {}), 3000)
    return () => window.clearTimeout(timer)
  }, [raidMode, storyKey])
  // «Ручная отметка» through the server (src/quests/questEngine.ts weighs each against the logs): another PC and the phone
  // get the marks; «Престиж +» / «Вайп» remove the mode's older ones there too.
  useEffect(() => {
    bindManualSync({
      read: (mode) => manualMarksOf(stateRef.current.activeProfile.modes[mode]),
      apply: (mode, marks) => stateRef.current.applyRemoteManualMarks(mode, marks),
    })
    return () => bindManualSync(null)
  }, [])
  const manualKey = useMemo(() => JSON.stringify(manualMarksOf(activeProfile.modes[raidMode])), [activeProfile.modes, raidMode])
  useEffect(() => {
    if (manualKey === '[]') return
    const timer = window.setTimeout(() => void syncManualMarks(raidMode).catch(() => {}), 1500)
    return () => window.clearTimeout(timer)
  }, [raidMode, manualKey])
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
    const desktop = window.tarkovDesktop
    if (!desktop) return
    let active = true
    // The status line and the game's mode follow the main process from the first reader on (the locked app included).
    followDesktopLogStatus()
    // The app's mode follows the game's when the game's changes — not at every scan: the player may look at another mode.
    let followedMode = sessionStorage.getItem(FOLLOWED_MODE_KEY)
    const registrationOf = (mode: RaidMode) => stateRef.current.activeProfile.modes[mode].registration
    // The main process found and reads the logs itself, from the app's start (electron/logWatcher.ts): first the identity
    // of the newest launches (mode, game accounts, profiles), then every launch. Each scan is applied once (P20).
    const applyLogResult = (result: ModeLogScanResult & { folder?: string }) => {
      if (!active) return
      noteLogScan(result)
      if (!firstApplication(result, stateRef.current.activeProfile.id)) return
      // Each mode gets only its own log events (split by session mode, gateway and profile id).
      if (result.latestMode) {
        if (followedMode !== result.latestMode) stateRef.current.setRaidMode(result.latestMode)
        followedMode = result.latestMode
        try { sessionStorage.setItem(FOLLOWED_MODE_KEY, result.latestMode) } catch { /* storage unavailable */ }
      }
      // «Пригласи друга»: the game account of this PC goes to the signed-in server account (EftAccountBinding.tsx).
      rememberEftAccount(result)
      // Each mode's game account from the logs, bound under the nickname the player typed (account/logNickname.ts).
      bindNicknameFromLogs(result, () => stateRef.current)
      // The identity has no quests: the full read of every launch follows.
      if (result.identityOnly) return
      applyScanToModes(result, registrationOf, (mode, events, characterId, resetAt, characterSince) => stateRef.current.applyLogScanForMode(mode, events, { characterId, resetAt, characterSince }))
      // Signed in to the server: store this scan there and apply the merged server records (all earlier scans).
      void pushLogProgress(result, registrationOf, (mode, events, characterId, resetAt) => {
        if (active) stateRef.current.applyLogStateForMode(mode, events, characterId, resetAt)
      }).catch(() => {})
    }
    const unsubscribe = desktop.onLogsUpdated(applyLogResult)
    // Only for the status this app shows: the main process answers with what it found, and sends its latest scan again
    // through `logs:updated` (applied above, once). Nothing is searched or read again for a page that opens.
    const savedFolder = localStorage.getItem(LOG_FOLDER_STORAGE_KEY)
    void desktop.autoFindAndScanLogs(savedFolder ?? undefined).then((result) => {
      if (!active) return
      if (!result) {
        updateLogStatus({ notFound: true })
        // No Logs folder on this PC: its quest progress comes from the server (another PC's logs, P10).
        noteDesktopLogsMissing()
        return
      }
      updateLogStatus({ folder: result.folder, notFound: false })
      localStorage.setItem(LOG_FOLDER_STORAGE_KEY, result.folder)
    }).catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
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
          {/* «Админ панель» above «Обзор» (owner, 16.10.2026), the owner's app only (src/admin/AdminNavLink.tsx). */}
          <AdminNavLink locale={locale} />
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
        <RequestsNavButton locale={locale} />
        <SidebarOperator />
      </aside>}
      {/* Theme decorations sized for the desktop sidebar/wide layout; the phone keeps only the textures. */}
      {!mobile && <><GearDecor /><MaskBadge /><TelnyashkaTable /></>}
      <AlcantaraNap />

      {/* The owner's notice («ведутся технические работы»), until he turns it off (src/announcement). */}
      <AnnouncementBanner />
      {mobile ? (
        <header className="topbar mobile-topbar">
          <NavLink to="/" className="brand mobile-brand" aria-label="Raid OS"><BrandEmblem /></NavLink>
          <div className="mode-switch" aria-label={uiText("Игровой режим")}><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>{uiText(locale === 'en' ? 'Season' : 'Сезон')}</button></div>
          <button className="profile-chip mobile-profile" onClick={() => navigate('/profile')} title={uiText("Профиль")} aria-label={uiText("Профиль")}>{activeProfile.modes[raidMode].prestige > 0 ? <span className="op-prestige-chip" title={prestigeLabel(activeProfile.modes[raidMode].prestige, locale)}><PrestigeIcon level={activeProfile.modes[raidMode].prestige} size={18} label={prestigeLabel(activeProfile.modes[raidMode].prestige, locale)} mode={raidMode} /></span> : <UserRound size={16} />}<span>{uiText(nickname ?? activeProfile.displayName)}</span></button>
          <ThemeButton />
          <SubscriptionExpiryNotice compact />
        </header>
      ) : (
      <header className="topbar">
        <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16} /><span>{uiText(locale === 'en' ? 'Search tasks, items, and maps' : 'Поиск по заданиям, предметам и картам')}</span><kbd>Ctrl K</kbd></button>
        <div className="mode-switch" aria-label={uiText("Игровой режим")}><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>{uiText(locale === 'en' ? 'Season' : 'Сезон')}</button></div>
        <RefreshDataButton onRefresh={refresh} />
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
      {mobile && <ShellTabBar squadBadge={socialBadge} onSearch={() => setSearchOpen(true)} onRefresh={refresh} />}
      {/* «Назад» on every page reached by a tap, where the player chose in Settings (mobile/backNavigation.tsx). */}
      {mobile && <PhoneBackButton />}
      {/* The PC's position and looked-up item reach the phone on every screen; the item shows as a card for 10 s. */}
      {mobile && <LiveFeedRunner mode={raidMode} />}
      {mobile && <PhoneItemToast />}
      {mobile && isAndroidApp() && <AndroidUpdateBanner />}
      <AccountController />
      {/* «Новое сообщение от поддержки» while the chat is closed (owner, 14.10.2026), on the PC and the phone. */}
      <SupportNotice />
      {/* «Ник изменился — прогресс режима PvE сброшен» / after «Престиж +» (src/state/modeReset.ts), PC and phone. */}
      <ModeResetToast />
    </div>
  )
}

/**
 * The top-bar refresh button. It alone follows the catalog's fetching (useTarkovDataStatus): the whole shell used to
 * re-render when a refresh started and again when it ended.
 */
function RefreshDataButton({ onRefresh }: { onRefresh: () => void }) {
  const { isFetching } = useTarkovDataStatus()
  return <button className="icon-button" onClick={onRefresh} title={uiText('Обновить данные')} aria-label={uiText("Обновить данные")}><RefreshCw size={16} className={isFetching ? 'spin' : ''} /></button>
}

/** The phone's tab bar with the refresh spinner, for the same reason. */
function ShellTabBar(props: Omit<Parameters<typeof MobileTabBar>[0], 'refreshing'>) {
  const { isFetching } = useTarkovDataStatus()
  return <MobileTabBar {...props} refreshing={isFetching} />
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
