import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Boxes, ChevronRight, CircleDollarSign, Home,
  Landmark, Map, PackageSearch, RefreshCw, ScanLine, Search, Settings, Shield, Target, UserRound, X,
} from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { timeAgo } from '../shared/format'
import { eventsToProgressRecords } from '../import/logParser'
import type { RaidMode } from '../domain/types'
import { ModeRegistrationDialog } from '../components/ModeRegistrationDialog'
import { usePlayerProfileSync } from '../profile/usePlayerProfileSync'

const LOG_FOLDER_STORAGE_KEY = 'tarkov-operations-log-folder-v1'

const navigation = [
  { to: '/', label: 'Обзор', icon: Home },
  { to: '/quests', label: 'Мои задания', icon: Target },
  { to: '/import', label: 'Синхронизация', icon: ScanLine },
  { to: '/maps', label: 'Карты', icon: Map },
  { to: '/items', label: 'Предметы', icon: PackageSearch },
  { to: '/flea', label: 'Барахолка', icon: CircleDollarSign },
  { to: '/hideout', label: 'Убежище', icon: Boxes },
  { to: '/traders', label: 'Торговцы', icon: Landmark },
]

export function AppShell({ children }: { children: ReactNode }) {
  const state = useAppState()
  const { raidMode, setRaidMode, activeProfile } = state
  const { source, updatedAt, isFetching, refresh, data } = useTarkovData()
  const { syncError, isSyncing } = usePlayerProfileSync()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

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
    const applyLogResult = (result: Parameters<NonNullable<typeof window.tarkovDesktop>['onLogsUpdated']>[0] extends (value: infer T) => void ? T : never) => {
      if (!active) return
      for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) {
        const registration = activeProfile.modes[mode].registration
        const accountId = result.latestAccountIdByMode[mode]
        if (registration.status !== 'registered' || (accountId && registration.accountId !== accountId)) continue
        const events = result.eventsByMode[mode] ?? []
        if (events.length) state.applyTaskRecordsForMode(mode, eventsToProgressRecords(events))
      }
      if (result.latestMode && result.latestMode !== raidMode) setRaidMode(result.latestMode)
    }
    const unsubscribe = window.tarkovDesktop.onLogsUpdated(applyLogResult)
    const savedFolder = localStorage.getItem(LOG_FOLDER_STORAGE_KEY)
    if (savedFolder) {
      void window.tarkovDesktop.startWatchingLogs(savedFolder).then((started) => {
        if (!started) localStorage.removeItem(LOG_FOLDER_STORAGE_KEY)
      }).catch(() => localStorage.removeItem(LOG_FOLDER_STORAGE_KEY))
    }
    return () => {
      active = false
      unsubscribe()
    }
  // Subscribe again only when the profile or selected mode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id, raidMode])

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (normalized.length < 2) return []
    const quests = data.quests.filter((entry) => entry.name.toLowerCase().includes(normalized)).slice(0, 5).map((entry) => ({ id: entry.id, title: entry.name, detail: `Задание · ${entry.trader}`, url: `/quests?selected=${entry.id}`, icon: Target }))
    const items = data.items.filter((entry) => `${entry.name} ${entry.shortName}`.toLowerCase().includes(normalized)).slice(0, 7).map((entry) => ({ id: entry.id, title: entry.name, detail: entry.category, url: `/items?selected=${entry.id}`, icon: PackageSearch }))
    const maps = data.maps.filter((entry) => entry.name.toLowerCase().includes(normalized)).map((entry) => ({ id: entry.id, title: entry.name, detail: 'Карта', url: `/maps/${entry.id}`, icon: Map }))
    return [...maps, ...quests, ...items].slice(0, 12)
  }, [data, query])

  const openResult = (url: string) => {
    navigate(url)
    setSearchOpen(false)
    setQuery('')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <div className="brand-mark">TO</div>
          <div className="brand-name">TARKOV OPS<span className="brand-sub">FIELD COMPANION</span></div>
        </NavLink>
        <div className="nav-label">ОПЕРАЦИИ</div>
        <nav className="nav-list" aria-label="Основная навигация">
          {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon /><span>{label}</span></NavLink>)}
        </nav>
        <div className="nav-label" style={{ marginTop: 12 }}>СИСТЕМА</div>
        <nav className="nav-list"><NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings /><span>Настройки</span></NavLink></nav>
        <div className="sidebar-footer">
          <div className="data-state" title={source === 'demo' ? 'API недоступен: используются встроенные данные' : 'Данные Tarkov.dev'}>
            <span className={`pulse-dot ${source === 'demo' ? 'demo' : ''}`} />
            <div><strong>{source === 'live' ? 'Tarkov.dev онлайн' : source === 'cache' ? 'Локальный кэш' : 'Демо-режим'}</strong><br /><span>{isFetching ? 'обновление…' : timeAgo(updatedAt)}</span></div>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16} /><span>Поиск по заданиям, предметам и картам</span><kbd>Ctrl K</kbd></button>
        <div className="mode-switch" aria-label="Игровой режим"><button className={raidMode === 'pvp' ? 'active' : ''} onClick={() => setRaidMode('pvp')}>PvP</button><button className={raidMode === 'pve' ? 'active' : ''} onClick={() => setRaidMode('pve')}>PvE</button><button className={raidMode === 'seasonal' ? 'active' : ''} onClick={() => setRaidMode('seasonal')}>Сезон</button></div>
        <button className="icon-button" onClick={refresh} title={syncError || 'Обновить данные'} aria-label="Обновить данные"><RefreshCw size={16} className={isFetching || isSyncing ? 'spin' : ''} /></button>
        <button className="profile-chip" onClick={() => navigate('/profile')} title="Профиль"><UserRound size={15} /><span>{activeProfile.modes[raidMode].registration.nickname ?? activeProfile.displayName}</span></button>
        <button className="icon-button" onClick={() => navigate('/settings')} title="Настройки"><Shield size={16} /></button>
      </header>

      <main className="content">{children}</main>

      {searchOpen && <div className="search-overlay" onMouseDown={(event) => event.target === event.currentTarget && setSearchOpen(false)}>
        <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Глобальный поиск">
          <div className="search-box"><Search size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: Водолей, ключ 206, Таможня…" /><button className="icon-button" onClick={() => setSearchOpen(false)}><X size={16} /></button></div>
          <div className="search-results">
            {query.length < 2 && <div className="empty-state" style={{ minHeight: 170 }}><div><Search size={26} /><p>Введите минимум два символа</p></div></div>}
            {query.length >= 2 && results.length === 0 && <div className="empty-state" style={{ minHeight: 170 }}><div><PackageSearch size={26} /><p>Ничего не найдено. Попробуйте другое название.</p></div></div>}
            {results.map(({ id, title, detail, url, icon: Icon }) => <button key={`${url}-${id}`} className="search-result" onClick={() => openResult(url)}><Icon size={18} /><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={15} style={{ marginLeft: 'auto' }} /></button>)}
          </div>
        </div>
      </div>}
      {window.tarkovDesktop && activeProfile.modes[raidMode].registration.status !== 'registered' && <ModeRegistrationDialog />}
    </div>
  )
}
