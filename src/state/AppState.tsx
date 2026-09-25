/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RaidMode } from '../domain/types'

interface PersistedState {
  raidMode: RaidMode
  selectedMapId: string
  trackedQuestIds: string[]
  completedQuestIds: string[]
  favoriteItemIds: string[]
  hiddenMarkerTypes: string[]
}

interface AppStateValue extends PersistedState {
  setRaidMode: (mode: RaidMode) => void
  setSelectedMapId: (id: string) => void
  toggleTrackedQuest: (id: string) => void
  toggleCompletedQuest: (id: string) => void
  toggleFavoriteItem: (id: string) => void
  toggleMarkerType: (type: string) => void
  reset: () => void
}

const STORAGE_KEY = 'tarkov-operations-state-v1'
const defaults: PersistedState = {
  raidMode: 'pvp',
  selectedMapId: 'customs',
  trackedQuestIds: ['operation-aquarius', 'golden-swag', 'bp-depot'],
  completedQuestIds: ['debut'],
  favoriteItemIds: ['graphics-card', 'ledx', 'salewa'],
  hiddenMarkerTypes: ['spawn'],
}

const AppStateContext = createContext<AppStateValue | null>(null)

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return defaults
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState)
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), [state])

  const value = useMemo<AppStateValue>(() => ({
    ...state,
    setRaidMode: (raidMode) => setState((current) => ({ ...current, raidMode })),
    setSelectedMapId: (selectedMapId) => setState((current) => ({ ...current, selectedMapId })),
    toggleTrackedQuest: (id) => setState((current) => ({ ...current, trackedQuestIds: toggle(current.trackedQuestIds, id) })),
    toggleCompletedQuest: (id) => setState((current) => ({ ...current, completedQuestIds: toggle(current.completedQuestIds, id) })),
    toggleFavoriteItem: (id) => setState((current) => ({ ...current, favoriteItemIds: toggle(current.favoriteItemIds, id) })),
    toggleMarkerType: (type) => setState((current) => ({ ...current, hiddenMarkerTypes: toggle(current.hiddenMarkerTypes, type) })),
    reset: () => setState(defaults),
  }), [state])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used within AppStateProvider')
  return value
}
