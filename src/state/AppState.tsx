/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyPlayerSnapshot, clearModeRegistration, createLocalProfile, migrateProfile, registerModeProfile } from '../domain/progress'
import { defaultHiddenMarkerLayers } from '../domain/mapLayers'
import type { LocalProfile, MarkerLayerId, PlayerProfileSnapshot, RaidMode, TaskProgressRecord } from '../domain/types'
import { applyStoryScan, type StoryScanMatch } from '../import/storyScan'
import { applyLogQuestState, logStateFingerprint } from '../import/logApply'
import type { ParsedTaskEvent } from '../import/logParser'
import { applyScreenScanProgress, type ScreenScanMatch } from '../import/screenScanSync'

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
  raidItemIds: string[]
  activeProfile: LocalProfile
  profiles: LocalProfile[]
  setRaidMode: (mode: RaidMode) => void
  registerModeProfile: (mode: RaidMode, registration: { accountId: number; enteredNickname: string; nickname: string; verifiedAt: string }) => void
  clearModeProfile: (mode: RaidMode) => void
  updatePlayerSnapshot: (mode: RaidMode, snapshot: PlayerProfileSnapshot) => void
  setSelectedMapId: (id: string) => void
  toggleTrackedQuest: (id: string) => void
  toggleCompletedQuest: (id: string) => void
  /** Story chapters are not in the logs: stage index = current, 'completed' = done, null = not playing. */
  setStoryProgress: (id: string, value: number | 'completed' | null) => void
  setTaskRecord: (record: TaskProgressRecord) => void
  applyTaskRecords: (records: TaskProgressRecord[]) => void
  applyTaskRecordsForMode: (mode: RaidMode, records: TaskProgressRecord[], characterId?: string) => void
  /** Story chapters read from the in-game story pane, applied to the mode the game is running. */
  applyStoryScanForMode: (mode: RaidMode, matches: StoryScanMatch[]) => void
  /** Current trader quests read from the in-game Tasks table. */
  applyQuestScanForMode: (mode: RaidMode, matches: ScreenScanMatch[], quests: import('../domain/types').Quest[], previousSeenIds: string[]) => void
  applyLogStateForMode: (mode: RaidMode, events: ParsedTaskEvent[], characterId?: string, resetAt?: string) => void
  setHideoutLevel: (stationId: string, level: number) => void
  /** «Что не продавать»: how many of an item the player has, in the selected mode. */
  setItemCount: (itemId: string, count: number) => void
  toggleFavoriteItem: (id: string) => void
  toggleRaidItem: (id: string) => void
  toggleMarkerType: (type: string) => void
  toggleMarkerLayer: (layerId: MarkerLayerId) => void
  createProfile: (name: string) => string
  selectProfile: (id: string) => void
  renameProfile: (name: string) => void
  deleteProfile: (id: string) => void
  replaceActiveProfile: (profile: LocalProfile) => void
  reset: () => void
  wipeAllData: () => Promise<void>
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
  for (const taskId of legacy?.completedQuestIds ?? []) {
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
    raidItemIds: modeProgress.raidItemIds,
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
    setStoryProgress: (id, value) => updateMode((progress) => {
      const next = { ...progress.taskProgress }
      if (value === null) delete next[id]
      else next[id] = value === 'completed'
        ? { taskId: id, status: 'completed', source: 'manual', updatedAt: new Date().toISOString() }
        : { taskId: id, status: 'active', source: 'manual', updatedAt: new Date().toISOString(), currentStageIndex: value }
      return { ...progress, taskProgress: next }
    }),
    setTaskRecord: (record) => updateMode((progress) => mergeTaskRecords(progress, [record])),
    applyTaskRecords: (records) => updateMode((progress) => mergeTaskRecords(progress, records)),
    applyTaskRecordsForMode: (selectedMode, records, characterId) => updateActive((profile) => ({
      ...profile,
      updatedAt: new Date().toISOString(),
      modes: {
        ...profile.modes,
        [selectedMode]: {
          ...mergeTaskRecords(profile.modes[selectedMode], records),
          logCharacterId: characterId ?? profile.modes[selectedMode].logCharacterId,
          lastLogSyncAt: new Date().toISOString(),
        },
      },
    })),
    applyStoryScanForMode: (selectedMode, matches) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      const next = applyStoryScan(current, matches)
      if (next === current) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: next } }
    }),
    applyQuestScanForMode: (selectedMode, matches, quests, previousSeenIds) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      const next = applyScreenScanProgress(current, matches, quests, { previousSeenIds, requireConfirmation: true })
      if (next === current || logStateFingerprint(next) === logStateFingerprint(current)) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: next } }
    }),
    applyLogStateForMode: (selectedMode, events, characterId, resetAt) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      const sameCharacter = Boolean(characterId) && current.logCharacterId === characterId
      const next = applyLogQuestState(current, events, { keepPreviousLogRecords: sameCharacter && !resetAt })
      if (logStateFingerprint(next) === logStateFingerprint(current) && (!characterId || current.logCharacterId === characterId)) return profile
      const now = new Date().toISOString()
      return {
        ...profile,
        updatedAt: now,
        modes: { ...profile.modes, [selectedMode]: { ...next, logCharacterId: characterId ?? current.logCharacterId, lastLogSyncAt: now } },
      }
    }),
    setHideoutLevel: (stationId, level) => updateMode((progress) => ({
      ...progress,
      hideoutLevels: { ...progress.hideoutLevels, [stationId]: Math.max(0, Math.round(level)) },
    })),
    setItemCount: (itemId, count) => updateMode((progress) => {
      const itemCounts = { ...(progress.itemCounts ?? {}) }
      const value = Math.max(0, Math.min(9999, Math.round(count) || 0))
      if (value) itemCounts[itemId] = value
      else delete itemCounts[itemId]
      return { ...progress, itemCounts }
    }),
    toggleFavoriteItem: (id) => updateActive((profile) => {
      const nextFavorites = toggle(profile.modes[profile.selectedMode].favoriteItemIds, id)
      return {
        ...profile,
        updatedAt: new Date().toISOString(),
        modes: {
          pvp: { ...profile.modes.pvp, favoriteItemIds: nextFavorites },
          pve: { ...profile.modes.pve, favoriteItemIds: nextFavorites },
          seasonal: { ...profile.modes.seasonal, favoriteItemIds: nextFavorites },
        },
      }
    }),
    toggleRaidItem: (id) => updateMode((progress) => ({ ...progress, raidItemIds: toggle(progress.raidItemIds, id) })),
    toggleMarkerType: (type) => setUi((current) => ({ ...current, hiddenMarkerTypes: toggle(current.hiddenMarkerTypes, type) })),
    toggleMarkerLayer: (layerId) => setUi((current) => ({ ...current, hiddenMarkerLayers: toggle(current.hiddenMarkerLayers, layerId) as MarkerLayerId[] })),
    createProfile: (name) => {
      const profile = createLocalProfile(name)
      setProfileState((current) => ({ activeProfileId: profile.id, profiles: [...current.profiles, profile] }))
      return profile.id
    },
    selectProfile: (activeProfileId) => setProfileState((current) => current.profiles.some((profile) => profile.id === activeProfileId) ? { ...current, activeProfileId } : current),
    renameProfile: (displayName) => updateActive((profile) => ({ ...profile, displayName: displayName.trim() || profile.displayName, updatedAt: new Date().toISOString() })),
    deleteProfile: (id) => setProfileState((current) => {
      const profiles = current.profiles.filter((profile) => profile.id !== id)
      if (!profiles.length) {
        const replacement = createLocalProfile('Оператор')
        return { activeProfileId: replacement.id, profiles: [replacement] }
      }
      const activeProfileId = current.activeProfileId === id ? profiles[0].id : current.activeProfileId
      return { activeProfileId, profiles }
    }),
    replaceActiveProfile: (replacement) => setProfileState((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === current.activeProfileId ? replacement : profile) })),
    reset: () => {
      const profile = createLocalProfile('Оператор', activeProfile.id)
      setProfileState((current) => ({ ...current, profiles: current.profiles.map((entry) => entry.id === activeProfile.id ? profile : entry) }))
      setUi(uiDefaults)
    },
    wipeAllData: async () => {
      const keys = [
        UI_STORAGE_KEY,
        PROFILE_STORAGE_KEY,
        LEGACY_STORAGE_KEY,
        'tarkov-operations-log-folder-v1',
        'tarkov-operations-menu-watch-v1',
      ]
      for (const key of keys) localStorage.removeItem(key)
      sessionStorage.clear()
      const profile = createLocalProfile('Оператор')
      setProfileState({ activeProfileId: profile.id, profiles: [profile] })
      setUi(uiDefaults)
      await window.tarkovDesktop?.clearApplicationData().catch(() => false)
    },
  // Functions intentionally close over the current active profile.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ui, activeProfile, mode, modeProgress, profileState.profiles])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}

function mergeTaskRecords(progress: LocalProfile['modes'][RaidMode], records: TaskProgressRecord[]) {
  const taskProgress = { ...progress.taskProgress }
  for (const record of records) {
    const current = taskProgress[record.taskId]
    if (current && current.updatedAt > record.updatedAt && current.source !== 'inferred') continue
    taskProgress[record.taskId] = record
  }
  return { ...progress, taskProgress }
}

export function useAppState() {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used within AppStateProvider')
  return value
}
