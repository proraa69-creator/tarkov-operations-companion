/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyPlayerSnapshot, applyScreenLevel, beforeModeReset, createLocalProfile, laterTime, migrateProfile, normalizeTaskKeys, raisePlayerLevel, registerModeProfile, wipeModeProgress } from '../domain/progress'
import { defaultHiddenMarkerLayers } from '../domain/mapLayers'
import type { LocalProfile, MarkerLayerId, ModeProgress, ObjectiveProgress, PlayerProfileSnapshot, ProgressEvent, Quest, RaidMode, TaskProgressRecord } from '../domain/types'
import {
  appendEvents,
  applyObjectiveChange,
  logCompletionConflicts,
  manualObjectiveValue,
  mergeRemoteObjectives,
  resolveObjectiveConflict,
  taskStatusEvents,
  undoProgressEvent,
  type ObjectiveDef,
} from '../progression/objectiveProgress'
import { applyStoryScan, type StoryScanMatch } from '../import/storyScan'
import { applyLogQuestState, dropRecordsBefore, logEpochChange, logStateFingerprint, type LogIdentityInput } from '../import/logApply'
import { announceLogEpochChange } from './logEpoch'
import { afterModeReset, type ModeResetReason } from './modeReset'
import type { StoryProgressRecord } from '../sync/storyRecords'
import type { ParsedTaskEvent } from '../import/logParser'
import { applyScreenScanProgress, type ScreenScanMatch } from '../import/screenScanSync'
import { clearAllQuestChecks } from '../progression/questChecks'

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
  updatePlayerSnapshot: (mode: RaidMode, snapshot: PlayerProfileSnapshot) => void
  /** The level the game's mode selection screen showed (src/import/modeSelectScreen.ts). */
  applyScreenLevel: (mode: RaidMode, level: number, observedAt: string, raiseOnly?: boolean) => void
  /** Quest experience since the level's anchor (src/profile/questExperience.ts); never lowers the level. */
  raisePlayerLevel: (mode: RaidMode, level: number) => void
  setSelectedMapId: (id: string) => void
  toggleTrackedQuest: (id: string) => void
  applyTaskRecordsForMode: (mode: RaidMode, records: TaskProgressRecord[], characterId?: string) => void
  /** Story chapters read from the in-game story pane, applied to the mode the game is running. */
  applyStoryScanForMode: (mode: RaidMode, matches: StoryScanMatch[]) => void
  /** Current trader quests read from the in-game Tasks table; `session`: the table watch that may end OCR quests (questSession.ts). */
  applyQuestScanForMode: (mode: RaidMode, matches: ScreenScanMatch[], quests: import('../domain/types').Quest[], previousSeenIds: string[], session?: import('../import/questSession').QuestScanSession) => void
  applyLogStateForMode: (mode: RaidMode, events: ParsedTaskEvent[], characterId?: string, resetAt?: string) => void
  /**
   * «Престиж +» or a nickname change (src/state/modeReset.ts): every progress record of one mode of the active profile
   * goes (src/domain/progress.ts wipeModeProgress), with the per-mode stores outside the profile, and the server is told
   * (queued while offline). `at` (now by default) becomes the mode's epoch. Other modes, settings, the account and the
   * nickname stay.
   */
  resetModeProgress: (mode: RaidMode, at?: string, reason?: ModeResetReason) => void
  /**
   * A mode's quests from its logs (applyLogStateForMode: the server's records of its character, from another PC or for the
   * phone). Another character, or a newer trusted reset, first drops the mode's records older than the change, once
   * (src/import/logApply.ts logEpochChange); `characterSince`: since when the logs show the character.
   */
  applyLogScanForMode: (mode: RaidMode, events: ParsedTaskEvent[], identity: LogIdentityInput) => void
  /** Story chapters another PC read, from the server (src/sync/storyRecords.ts): a newer reading of a chapter wins. */
  applyRemoteStoryForMode: (mode: RaidMode, records: StoryProgressRecord[], characterId: string) => void
  /** Manual objective value from the quest view (checkbox / counter) for the current mode. */
  setObjectiveValue: (def: Pick<ObjectiveDef, 'id' | 'taskId' | 'type' | 'target'>, current: number) => void
  /** «Отменить» in «История изменений» (current mode). */
  undoProgressEvent: (eventId: string) => void
  /** Answer to «Журнал подтверждает выполнение»: accept the log value or keep the manual one. */
  resolveObjectiveConflict: (objectiveId: string, accept: boolean) => void
  /** Objective state and history merged from the server copy of this mode. */
  applyRemoteObjectives: (mode: RaidMode, remote: { objectives: ObjectiveProgress[]; events: ProgressEvent[] }) => void
  /** Rewrites legacy slug keys to task ids once the catalog is known (all modes of the active profile). */
  normalizeTaskKeys: (quests: Quest[]) => void
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
    updatePlayerSnapshot: (selectedMode, snapshot) => updateActive((profile) => applyPlayerSnapshot(profile, selectedMode, snapshot)),
    applyScreenLevel: (selectedMode, level, observedAt, raiseOnly) => updateActive((profile) => applyScreenLevel(profile, selectedMode, level, observedAt, raiseOnly)),
    raisePlayerLevel: (selectedMode, level) => updateActive((profile) => raisePlayerLevel(profile, selectedMode, level)),
    setSelectedMapId: (selectedMapId) => setUi((current) => ({ ...current, selectedMapId })),
    toggleTrackedQuest: (id) => updateMode((progress) => ({ ...progress, trackedTaskIds: toggle(progress.trackedTaskIds, id) })),
    applyTaskRecordsForMode: (selectedMode, records, characterId) => updateActive((profile) => ({
      ...profile,
      updatedAt: new Date().toISOString(),
      modes: {
        ...profile.modes,
        [selectedMode]: {
          ...withTaskEvents(profile.modes[selectedMode], mergeTaskRecords(profile.modes[selectedMode], records.filter((record) => !beforeModeReset(profile.modes[selectedMode], record.updatedAt))), selectedMode),
          logCharacterId: characterId ?? profile.modes[selectedMode].logCharacterId,
          lastLogSyncAt: new Date().toISOString(),
        },
      },
    })),
    // Screen readings that change nothing leave the state as it is (audit P5f): no new state, so no profile write to
    // localStorage and no re-render of the app, although the scanner reads the Tasks table every few seconds.
    applyStoryScanForMode: (selectedMode, matches) => setProfileState((state) => {
      const profile = state.profiles.find((entry) => entry.id === state.activeProfileId)
      if (!profile) return state
      const current = profile.modes[selectedMode]
      const next = applyStoryScan(current, matches)
      if (next === current) return state
      const changed = { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
      return { ...state, profiles: state.profiles.map((entry) => entry.id === profile.id ? changed : entry) }
    }),
    applyQuestScanForMode: (selectedMode, matches, quests, previousSeenIds, session) => setProfileState((state) => {
      const profile = state.profiles.find((entry) => entry.id === state.activeProfileId)
      if (!profile) return state
      const current = profile.modes[selectedMode]
      const next = applyScreenScanProgress(current, matches, quests, { previousSeenIds, requireConfirmation: true, session })
      if (next === current) return state
      const changed = { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
      return { ...state, profiles: state.profiles.map((entry) => entry.id === profile.id ? changed : entry) }
    }),
    applyLogStateForMode: (selectedMode, events, characterId, resetAt) => updateActive((profile) => applyLogState(profile, selectedMode, events, { characterId, resetAt })),
    applyLogScanForMode: (selectedMode, events, identity) => updateActive((profile) => applyLogState(profile, selectedMode, events, identity)),
    resetModeProgress: (selectedMode, at = new Date().toISOString(), reason = 'prestige') => {
      const profileId = activeProfile.id
      setProfileState((state) => ({
        ...state,
        profiles: state.profiles.map((profile) => profile.id === profileId ? wipeModeProgress(profile, selectedMode, at) : profile),
      }))
      // The same point as a trusted reset of the logs (src/state/logEpoch.ts), then the stores outside the profile, the
      // server and the notice.
      announceLogEpochChange({ kind: 'reset', at, profileId, mode: selectedMode })
      afterModeReset({ profileId, mode: selectedMode, at, reason })
    },
    applyRemoteStoryForMode: (selectedMode, records, characterId) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      // Another character's chapters (this mode's character is another one now): not these.
      if (current.logCharacterId && current.logCharacterId !== characterId) return profile
      let taskProgress = current.taskProgress
      for (const record of records) {
        // Readings from before a new character or a reset never come back.
        if (current.logEpochAt && record.updatedAt < current.logEpochAt) continue
        const local = taskProgress[record.taskId]
        if (local && (local.updatedAt >= record.updatedAt || (local.status === 'completed' && record.status !== 'completed'))) continue
        const stage = record.currentStageIndex ?? local?.currentStageIndex
        taskProgress = {
          ...taskProgress,
          [record.taskId]: {
            taskId: record.taskId, status: record.status, source: 'screen-scan', updatedAt: record.updatedAt,
            ...(stage != null ? { currentStageIndex: stage } : {}),
            // The objectives this PC read belong to the stage it read: kept only while the stage is the same.
            ...(local?.storyObjectives && local.currentStageIndex === stage ? { storyObjectives: local.storyObjectives } : {}),
          },
        }
      }
      if (taskProgress === current.taskProgress) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, { ...current, taskProgress }, selectedMode) } }
    }),
    setObjectiveValue: (def, current) => updateActive((profile) => {
      const selectedMode = profile.selectedMode
      const result = applyObjectiveChange(profile.modes[selectedMode], selectedMode, manualObjectiveValue(def, current))
      if (result.progress === profile.modes[selectedMode]) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: result.progress } }
    }),
    undoProgressEvent: (eventId) => updateActive((profile) => {
      const selectedMode = profile.selectedMode
      const next = undoProgressEvent(profile.modes[selectedMode], eventId)
      if (next === profile.modes[selectedMode]) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: next } }
    }),
    resolveObjectiveConflict: (objectiveId, accept) => updateActive((profile) => {
      const selectedMode = profile.selectedMode
      const next = resolveObjectiveConflict(profile.modes[selectedMode], selectedMode, objectiveId, accept)
      if (next === profile.modes[selectedMode]) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: next } }
    }),
    applyRemoteObjectives: (selectedMode, remote) => updateActive((profile) => {
      // Nothing from before the mode's reset comes back from the server (an app that has not heard of it yet sent it).
      const current = profile.modes[selectedMode]
      const fresh = current.modeResetAt
        ? { objectives: remote.objectives.filter((entry) => !beforeModeReset(current, entry.observedAt)), events: remote.events.filter((entry) => !beforeModeReset(current, entry.observedAt)) }
        : remote
      const next = mergeRemoteObjectives(current, fresh)
      if (next === profile.modes[selectedMode]) return profile
      return { ...profile, modes: { ...profile.modes, [selectedMode]: next } }
    }),
    normalizeTaskKeys: (quests) => updateActive((profile) => {
      let changed = false
      const modes = { ...profile.modes }
      for (const key of Object.keys(modes) as RaidMode[]) {
        const next = normalizeTaskKeys(modes[key], quests)
        if (next !== modes[key]) { modes[key] = next; changed = true }
      }
      return changed ? { ...profile, modes } : profile
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
      clearAllQuestChecks()
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

/**
 * A mode's quest events from its logs or the server. R4 / step 25: another character or a newer trusted reset — once, at
 * the change — drops the older records of every source first (log, Tasks table, story chapters, objectives); preferences
 * stay. No profile line is no change.
 */
function applyLogState(profile: LocalProfile, selectedMode: RaidMode, events: ParsedTaskEvent[], identity: LogIdentityInput): LocalProfile {
  const { characterId, resetAt } = identity
  const current = profile.modes[selectedMode]
  const now = new Date().toISOString()
  const change = logEpochChange(current, identity, now)
  const base = change ? dropRecordsBefore(current, change.at) : current
  // The first character a mode learns: what an older version kept from the logs is read again from them.
  const firstCharacter = Boolean(characterId) && !current.logCharacterId
  // Events from before the character's last reset never come back (a PC whose own logs never showed the reset), nor
  // from before the mode's reset in the app («Престиж +», a nickname change: src/state/modeReset.ts).
  const logResetAt = change ? resetAt : current.logResetAt
  const floor = laterTime(logResetAt, current.modeResetAt)
  const fresh = floor ? events.filter((event) => event.timestamp >= floor) : events
  const next = applyLogQuestState(base, fresh, { keepPreviousLogRecords: !firstCharacter })
  if (!change && logStateFingerprint(next) === logStateFingerprint(current) && (!characterId || current.logCharacterId === characterId)) return profile
  if (change) announceLogEpochChange({ ...change, profileId: profile.id, mode: selectedMode })
  return {
    ...profile,
    updatedAt: now,
    modes: {
      ...profile.modes,
      [selectedMode]: {
        ...withTaskEvents(current, next, selectedMode),
        logCharacterId: characterId ?? current.logCharacterId,
        logResetAt,
        logEpochAt: change ? change.at : current.logEpochAt,
        lastLogSyncAt: now,
      },
    },
  }
}

/**
 * Records quest status changes of one mode as progress events and, for quests the log now reports completed,
 * turns the user's manual «not done» objectives into conflicts to ask about (never overwritten silently).
 */
function withTaskEvents(before: ModeProgress, after: ModeProgress, mode: RaidMode): ModeProgress {
  if (before.taskProgress === after.taskProgress) return after
  const now = new Date().toISOString()
  const events = taskStatusEvents(before.taskProgress, after.taskProgress, mode, now)
  if (!events.length) return after
  const loggedCompletions = events.filter((event) => event.newValue === 'completed' && event.source === 'log').map((event) => event.taskId)
  return logCompletionConflicts(appendEvents(after, events), mode, loggedCompletions, now)
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

/** The app state when there is one (a dialog that also opens outside the app's providers, e.g. in tests). */
export function useOptionalAppState() {
  return useContext(AppStateContext)
}
