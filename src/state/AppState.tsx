/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyPlayerSnapshot, clearModeRegistration, createLocalProfile, migrateProfile, registerModeProfile } from '../domain/progress'
import { defaultHiddenMarkerLayers } from '../domain/mapLayers'
import type { LocalProfile, MarkerLayerId, PlayerProfileSnapshot, RaidMode, TaskProgressRecord } from '../domain/types'

interface UiState {
  selectedMapId: string
  hiddenMarkerTypes: string[]
  hiddenMarkerLayers: MarkerLayerId[]
}

interface ProfileState {
  activeProfileId: string
  profiles: LocalProfile[]
}

interface AppStateValue extends UiState {
  raidMode: RaidMode
  trackedQuestIds: string[]
  completedQuestIds: string[]
  favoriteItemIds: string[]
  activeProfile: LocalProfile
  profiles: LocalProfile[]
  setRaidMode: (mode: RaidMode) => void
  registerModeProfile: (mode: RaidMode, registration: { accountId: number; enteredNickname: string; nickname: string; verifiedAt: string }) => void
  clearModeProfile: (mode: RaidMode) => void
  updatePlayerSnapshot: (mode: RaidMode, snapshot: PlayerProfileSnapshot) => void
  setSelectedMapId: (id: string) => void
  toggleTrackedQuest: (id: string) => void
  toggleCompletedQuest: (id: string) => void
  setTaskRecord: (record: TaskProgressRecord) => void
  applyTaskRecords: (records: TaskProgressRecord[]) => void
  applyTaskRecordsForMode: (mode: RaidMode, records: TaskProgressRecord[]) => void
  setHideoutLevel: (stationId: string, level: number) => void
  toggleFavoriteItem: (id: string) => void
  toggleMarkerType: (type: string) => void
  toggleMarkerLayer: (layerId: MarkerLayerId) => void
  createProfile: (name: string) => string
  selectProfile: (id: string) => void
  renameProfile: (name: string) => void
  replaceActiveProfile: (profile: LocalProfile) => void
  reset: () => void
}

const UI_STORAGE_KEY = 'tarkov-operations-ui-v2'
const PROFILE_STORAGE_KEY = 'tarkov-operations-profiles-v2'
const LEGACY_STORAGE_KEY = 'tarkov-operations-state-v1'
const uiDefaults: UiState = { selectedMapId: 'customs', hiddenMarkerTypes: ['spawn'], hiddenMarkerLayers: defaultHiddenMarkerLayers }
const AppStateContext = createContext<AppStateValue | null>(null)

function readJson(key: string): unknown {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function loadUiState(): UiState {
  const saved = readJson(UI_STORAGE_KEY) as Partial<UiState> | null
  const legacy = readJson(LEGACY_STORAGE_KEY) as Partial<UiState> | null
  return { ...uiDefaults, ...(legacy ?? {}), ...(saved ?? {}), hiddenMarkerLayers: saved?.hiddenMarkerLayers ?? uiDefaults.hiddenMarkerLayers }
}

function loadProfileState(): ProfileState {
  const saved = readJson(PROFILE_STORAGE_KEY) as Partial<ProfileState> | null
  const restored = (saved?.profiles ?? []).map(migrateProfile).filter(Boolean) as LocalProfile[]
  if (restored.length) {
    const activeProfileId = restored.some((profile) => profile.id === saved?.activeProfileId)
      ? saved!.activeProfileId!
      : restored[0].id
    return { activeProfileId, profiles: restored }
  }

  const profile = createLocalProfile('Оператор', 'local-operator')
  const legacy = readJson(LEGACY_STORAGE_KEY) as {
    raidMode?: RaidMode
    trackedQuestIds?: string[]
    completedQuestIds?: string[]
    favoriteItemIds?: string[]
  } | null
  const mode = legacy?.raidMode === 'pve' || legacy?.raidMode === 'seasonal' ? legacy.raidMode : 'pvp'
  profile.selectedMode = mode
  profile.modes[mode].trackedTaskIds = legacy?.trackedQuestIds ?? ['operation-aquarius', 'golden-swag', 'bp-depot']
  profile.modes[mode].favoriteItemIds = legacy?.favoriteItemIds ?? ['graphics-card', 'ledx', 'salewa']
  for (const taskId of legacy?.completedQuestIds ?? ['debut']) {
    profile.modes[mode].taskProgress[taskId] = {
      taskId, status: 'completed', source: 'migration', updatedAt: new Date().toISOString(),
    }
  }
  return { activeProfileId: profile.id, profiles: [profile] }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<UiState>(loadUiState)
  const [profileState, setProfileState] = useState<ProfileState>(loadProfileState)
  const activeProfile = profileState.profiles.find((profile) => profile.id === profileState.activeProfileId) ?? profileState.profiles[0]
  const mode = activeProfile.selectedMode
  const modeProgress = activeProfile.modes[mode]

  useEffect(() => localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(ui)), [ui])
  useEffect(() => localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileState)), [profileState])

  const updateActive = (updater: (profile: LocalProfile) => LocalProfile) => {
    setProfileState((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => profile.id === current.activeProfileId ? updater(profile) : profile),
    }))
  }

  const updateMode = (updater: (progress: LocalProfile['modes'][RaidMode]) => LocalProfile['modes'][RaidMode]) => {
    updateActive((profile) => ({
      ...profile,
      updatedAt: new Date().toISOString(),
      modes: { ...profile.modes, [profile.selectedMode]: updater(profile.modes[profile.selectedMode]) },
    }))
  }

  const value = useMemo<AppStateValue>(() => ({
    ...ui,
    raidMode: mode,
    trackedQuestIds: modeProgress.trackedTaskIds,
    completedQuestIds: Object.values(modeProgress.taskProgress).filter((record) => record.status === 'completed').map((record) => record.taskId),
    favoriteItemIds: modeProgress.favoriteItemIds,
    activeProfile,
    profiles: profileState.profiles,
    setRaidMode: (selectedMode) => updateActive((profile) => ({ ...profile, selectedMode, updatedAt: new Date().toISOString() })),
    registerModeProfile: (selectedMode, registration) => updateActive((profile) => registerModeProfile(profile, selectedMode, registration)),
    clearModeProfile: (selectedMode) => updateActive((profile) => clearModeRegistration(profile, selectedMode)),
    updatePlayerSnapshot: (selectedMode, snapshot) => updateActive((profile) => applyPlayerSnapshot(profile, selectedMode, snapshot)),
    setSelectedMapId: (selectedMapId) => setUi((current) => ({ ...current, selectedMapId })),
    toggleTrackedQuest: (id) => updateMode((progress) => ({ ...progress, trackedTaskIds: toggle(progress.trackedTaskIds, id) })),
    toggleCompletedQuest: (id) => updateMode((progress) => {
      const next = { ...progress.taskProgress }
      if (next[id]?.status === 'completed') delete next[id]
      else next[id] = { taskId: id, status: 'completed', source: 'manual', updatedAt: new Date().toISOString() }
      return { ...progress, taskProgress: next }
    }),
    setTaskRecord: (record) => updateMode((progress) => ({ ...progress, taskProgress: { ...progress.taskProgress, [record.taskId]: record } })),
    applyTaskRecords: (records) => updateMode((progress) => ({
      ...progress,
      taskProgress: records.reduce((all, record) => ({ ...all, [record.taskId]: record }), progress.taskProgress),
    })),
    applyTaskRecordsForMode: (selectedMode, records) => updateActive((profile) => ({
      ...profile,
      updatedAt: new Date().toISOString(),
      modes: {
        ...profile.modes,
        [selectedMode]: {
          ...profile.modes[selectedMode],
          taskProgress: records.reduce((all, record) => ({ ...all, [record.taskId]: record }), profile.modes[selectedMode].taskProgress),
          lastLogSyncAt: new Date().toISOString(),
        },
      },
    })),
    setHideoutLevel: (stationId, level) => updateMode((progress) => ({
      ...progress,
      hideoutLevels: { ...progress.hideoutLevels, [stationId]: Math.max(0, Math.round(level)) },
    })),
    toggleFavoriteItem: (id) => updateMode((progress) => ({ ...progress, favoriteItemIds: toggle(progress.favoriteItemIds, id) })),
    toggleMarkerType: (type) => setUi((current) => ({ ...current, hiddenMarkerTypes: toggle(current.hiddenMarkerTypes, type) })),
    toggleMarkerLayer: (layerId) => setUi((current) => ({ ...current, hiddenMarkerLayers: toggle(current.hiddenMarkerLayers, layerId) as MarkerLayerId[] })),
    createProfile: (name) => {
      const profile = createLocalProfile(name)
      setProfileState((current) => ({ activeProfileId: profile.id, profiles: [...current.profiles, profile] }))
      return profile.id
    },
    selectProfile: (activeProfileId) => setProfileState((current) => current.profiles.some((profile) => profile.id === activeProfileId) ? { ...current, activeProfileId } : current),
    renameProfile: (displayName) => updateActive((profile) => ({ ...profile, displayName: displayName.trim() || profile.displayName, updatedAt: new Date().toISOString() })),
    replaceActiveProfile: (replacement) => setProfileState((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === current.activeProfileId ? replacement : profile) })),
    reset: () => {
      const profile = createLocalProfile('Оператор', 'local-operator')
      setProfileState({ activeProfileId: profile.id, profiles: [profile] })
      setUi(uiDefaults)
    },
  // Functions intentionally close over the current active profile.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ui, activeProfile, mode, modeProgress, profileState.profiles])

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
