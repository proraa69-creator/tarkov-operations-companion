/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyPlayerSnapshot, applyScreenLevel, beforeModeReset, createLocalProfile, floorAfterReset, laterTime, migrateProfile, normalizeTaskKeys, raisePlayerLevel, registerModeProfile, clearPlayerLists, wipeModeProgress } from '../domain/progress'
import { defaultHiddenMarkerLayers } from '../domain/mapLayers'
import type { LocalProfile, MarkerLayerId, ModeProgress, ObjectiveProgress, PlayerProfileSnapshot, ProgressEvent, Quest, RaidMode, TaskProgressRecord } from '../domain/types'
import {
  appendEvents,
  applyObjectiveChange,
  logCompletionConflicts,
  manualObjectiveValue,
  mergeRemoteObjectives,
  normalizeObjectiveKeys,
  resolveObjectiveConflict,
  taskStatusEvents,
  undoProgressEvent,
  type LegacyObjectiveIds,
  type ObjectiveDef,
} from '../progression/objectiveProgress'
import { applyStoryScan, type StoryScanMatch } from '../import/storyScan'
import { dropRecordsBefore, logEpochChange, logEventsForMode, type LogIdentityInput } from '../import/logApply'
import { currentLogStatus } from '../import/logStatus'
import { inputsOf, commitQuestInputs, mergeManualMarks, mergeObservations, questFloor, sameRecords, setManualMark, withLayer } from '../quests/questInputs'
import { rowsTheChainAllows, withQuestChain } from '../quests/questChain'
import { newTableSync, tableSyncAfterVisit, type TableVisit } from '../import/tableSync'
import { wholeTableChanges, type SweepRow } from '../import/tableSweep'
import { useQuestMirrors, withQuestMirrors } from '../sync/questMirror'
import { latestTime, type ManualMark, type QuestObservation } from '../quests/questEngine'
import { announceLogEpochChange } from './logEpoch'
import { afterModeReset, type ModeResetReason } from './modeReset'
import type { StoryProgressRecord } from '../sync/storyRecords'
import type { ParsedTaskEvent } from '../import/logParser'
import { applyScreenScanProgress, type ScreenScanMatch } from '../import/screenScanSync'
import { clearAllQuestChecks } from '../progression/questChecks'
import { clearAllDeferredQuests } from '../progression/deferredQuests'
import { AUTO_FAVORITES_EVENT, clearAutoFavorites, forgetAutoFavorite, takeAutoFavoriteRemovals } from '../progression/autoFavorites'

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
  /** Story chapters read from the in-game story pane, applied to the mode the game is running. */
  applyStoryScanForMode: (mode: RaidMode, matches: StoryScanMatch[]) => void
  /** Current trader quests read from the in-game Tasks table: fills what nothing else knows. */
  applyQuestScanForMode: (mode: RaidMode, matches: ScreenScanMatch[], quests: import('../domain/types').Quest[], previousSeenIds: string[]) => void
  /** The server's records of a mode's character (all PCs' log events): the engine's `server` layer. */
  applyLogStateForMode: (mode: RaidMode, events: ParsedTaskEvent[], characterId?: string, resetAt?: string) => void
  /**
   * «Престиж +» or a nickname change (src/state/modeReset.ts): every progress record of one mode of the active profile
   * goes (src/domain/progress.ts wipeModeProgress), with the per-mode stores outside the profile, and the server is told
   * (queued while offline). `at` (now by default) becomes the mode's epoch. Other modes, settings, the account and the
   * nickname stay.
   */
  resetModeProgress: (mode: RaidMode, at?: string, reason?: ModeResetReason, options?: { prestige?: number }) => void
  /**
   * «Ручная отметка» (owner, 15.10.2026): the player's own mark of a trader quest of one mode — «В текущие» (`active`),
   * «Выполнено» (`completed`) or «Снять отметку» (null). The quest-state engine weighs it against the logs: it beats
   * older log events, loses to newer ones. Synced through the server; «Престиж +» / «Вайп» clear it.
   */
  setManualQuestMark: (mode: RaidMode, taskId: string, status: 'active' | 'completed' | null, at?: string) => void
  /**
   * «Ручное добавление» (owner, 03.11.2026): the quests the player ticked put into «Текущие» at once, as «В текущие» marks
   * (the logs the game has deleted miss them; newer log events still decide over the marks).
   */
  addManualQuests: (mode: RaidMode, taskIds: readonly string[], at?: string) => void
  /**
   * The account's copy of a mode's quests from the server (src/sync/serverSync.ts pullQuestMirror): the PC's gap-filling
   * layer (src/quests/questEngine.ts `mirror`). True when the stored layer changes (AppShell then sends the copy again).
   */
  applyQuestMirrorLayer: (mode: RaidMode, records: Record<string, TaskProgressRecord>) => boolean
  /** Marks from the server (another device of the account): the newer per quest wins. */
  applyRemoteManualMarks: (mode: RaidMode, marks: Array<{ taskId: string } & ManualMark>) => void
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
  /**
   * A mode's quests against the chain of its catalog, whenever its records change (src/quests/questChain.ts, a player's
   * ticket №37): Tasks-table records the logs rule out go, hand-ins the logs missed are made up for.
   */
  applyQuestChain: (mode: RaidMode, quests: Quest[]) => void
  /** Each mode of the active profile without a first sync of the Tasks table on this PC begins one (src/import/tableSync.ts). */
  startTableSync: () => void
  /**
   * A whole read of the Tasks table (src/import/tableSweep.ts): the mode's «Текущие» become what the table lists. What is missing
   * is added, what it does not list leaves (`absent`, src/quests/questEngine.ts). Returns the quests added and gone.
   */
  applyWholeTableRead: (mode: RaidMode, read: { startedAt: number; rows: readonly SweepRow[] }, quests: Quest[]) => { added: string[]; gone: string[] }
  /** A visit to the Tasks table ended, or read the whole list: the mode's first sync after it (src/import/tableSync.ts). */
  noteTableVisit: (mode: RaidMode, visit: TableVisit, quests: Quest[]) => void
  /** Moves the mode's objective ticks kept under an objective's text to its game id, once that mode's catalog is known. */
  normalizeObjectiveKeys: (mode: RaidMode, ids: LegacyObjectiveIds) => void
  setHideoutLevel: (stationId: string, level: number) => void
  /** «Что не продавать»: how many of an item the player has, in the selected mode. */
  setItemCount: (itemId: string, count: number) => void
  toggleFavoriteItem: (id: string) => void
  /** Puts items into «Избранное» (those not there yet, after the others): a deferred quest's keys and items. */
  addFavoriteItems: (ids: string[]) => void
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
  const storedProfile = profileState.profiles.find((profile) => profile.id === profileState.activeProfileId) ?? profileState.profiles[0]
  // An app that takes its quests from the server shows the PC's own decisions (src/sync/questMirror.ts); the stored profile
  // keeps its records, so nothing is lost when the copy goes.
  const questMirrors = useQuestMirrors()
  const activeProfile = useMemo(() => withQuestMirrors(storedProfile, questMirrors), [storedProfile, questMirrors])
  const mode = activeProfile.selectedMode
  const modeProgress = activeProfile.modes[mode]

  useEffect(() => localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(ui)), [ui])
  useEffect(() => localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileState)), [profileState])
  // «Предметы в избранное»: what «Отложенные квесты» put into «Избранное» for quests that came back, and no other quest put
  // aside keeps, leaves it (progression/autoFavorites.ts) — also when they came back before this provider was listening.
  const activeId = profileState.activeProfileId
  useEffect(() => {
    const take = () => {
      const ids = takeAutoFavoriteRemovals(activeId)
      if (ids.length) setProfileState((current) => ({ ...current, profiles: current.profiles.map((profile) => (profile.id === activeId ? withoutFavorites(profile, ids) : profile)) }))
    }
    const first = window.setTimeout(take, 0)
    window.addEventListener(AUTO_FAVORITES_EVENT, take)
    return () => { window.clearTimeout(first); window.removeEventListener(AUTO_FAVORITES_EVENT, take) }
  }, [activeId])

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
    // Screen readings that change nothing leave the state as it is (audit P5f): no new state, so no profile write to
    // localStorage and no re-render of the app, although the scanner reads the Tasks table every few seconds.
    applyStoryScanForMode: (selectedMode, matches) => setProfileState((state) => {
      const profile = state.profiles.find((entry) => entry.id === state.activeProfileId)
      if (!profile) return state
      const current = profile.modes[selectedMode]
      // The story pane's layer of the quest-state engine (src/quests/questInputs.ts).
      const layers = inputsOf(current, selectedMode)
      const view = { ...current, taskProgress: layers.story }
      const read = applyStoryScan(view, matches)
      if (read === view) return state
      const next = withLayer(current, selectedMode, 'story', read.taskProgress)
      if (next === current) return state
      const changed = { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
      return { ...state, profiles: state.profiles.map((entry) => entry.id === profile.id ? changed : entry) }
    }),
    // The Tasks table of the game's mode: its current quests where the logs cannot tell them.
    applyQuestScanForMode: (selectedMode, matches, quests, previousSeenIds) => setProfileState((state) => {
      // Every mode (owner, 31.10.2026): the scanner reads the table only in a mode whose logs miss its history, or while
      // «Синхронизация заданий по экрану» is on for the account (src/components/StoryScreenScanner.tsx). This used to keep
      // PvE only, and the PvP and Season readings were dropped here.
      const profile = state.profiles.find((entry) => entry.id === state.activeProfileId)
      if (!profile) return state
      const current = profile.modes[selectedMode]
      // The Tasks table fills gaps only (src/quests/questEngine.ts): rows of quests the logs, the server or a manual mark
      // already decided are not written to its layer.
      const layers = inputsOf(current, selectedMode)
      const decided = new Set(Object.values(current.taskProgress).filter((record) => record.source === 'eft-log' || record.source === 'manual-fix').map((record) => record.taskId))
      const view = { ...current, taskProgress: layers.table }
      const rows = rowsTheChainAllows(matches.filter((match) => !decided.has(match.questId)), current.taskProgress, quests, new Date().toISOString())
      const read = applyScreenScanProgress(view, rows, quests, { previousSeenIds, requireConfirmation: true })
      if (read === view) return state
      const next = withLayer(current, selectedMode, 'table', read.taskProgress)
      if (next === current) return state
      const changed = { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
      return { ...state, profiles: state.profiles.map((entry) => entry.id === profile.id ? changed : entry) }
    }),
    applyWholeTableRead: (selectedMode, read, quests) => {
      const outcome = tableReadOutcome(storedProfile.modes[selectedMode], read, quests, selectedMode)
      if (outcome.next) updateActive((profile) => {
        // Worked out again on what the profile holds by now.
        const { next } = tableReadOutcome(profile.modes[selectedMode], read, quests, selectedMode)
        return next ? { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(profile.modes[selectedMode], next, selectedMode) } } : profile
      })
      return { added: outcome.added, gone: outcome.gone }
    },
    applyLogStateForMode: (selectedMode, events, characterId, resetAt) => updateActive((profile) => applyLogState(profile, selectedMode, events, { characterId, resetAt }, 'server')),
    applyLogScanForMode: (selectedMode, events, identity) => updateActive((profile) => applyLogState(profile, selectedMode, events, identity, 'log')),
    setManualQuestMark: (selectedMode, taskId, status, at = new Date().toISOString()) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      const layers = inputsOf(current, selectedMode)
      if (!status && !layers.manual[taskId]) return profile
      const next = withLayer(current, selectedMode, 'manual', setManualMark(layers.manual, taskId, status ?? 'cleared', at))
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
    }),
    applyQuestMirrorLayer: (selectedMode, records) => {
      if (sameRecords(inputsOf(storedProfile.modes[selectedMode], selectedMode).mirror ?? {}, records)) return false
      updateActive((profile) => {
        const current = profile.modes[selectedMode]
        const next = withLayer(current, selectedMode, 'mirror', records)
        if (next === current) return profile
        return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
      })
      return true
    },
    addManualQuests: (selectedMode, taskIds, at = new Date().toISOString()) => updateActive((profile) => {
      if (!taskIds.length) return profile
      const current = profile.modes[selectedMode]
      const layers = inputsOf(current, selectedMode)
      let manual = layers.manual
      for (const taskId of taskIds) manual = setManualMark(manual, taskId, 'active', at)
      const next = withLayer(current, selectedMode, 'manual', manual)
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
    }),
    applyRemoteManualMarks: (selectedMode, marks) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      const layers = inputsOf(current, selectedMode)
      // Marks from before the mode's reset never come back, nor those of the character before this one: the server keeps
      // marks per account and mode, not per character (the local layer dropped them at the change, logApply.ts).
      const floor = latestTime(questFloor(current), current.logEpochAt)
      const merged = mergeManualMarks(layers.manual, floor ? marks.filter((mark) => mark.at >= floor) : marks)
      if (merged === layers.manual) return profile
      const next = withLayer(current, selectedMode, 'manual', merged)
      if (next === current) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
    }),
    resetModeProgress: (selectedMode, at = new Date().toISOString(), reason = 'prestige', options = {}) => {
      const profileId = activeProfile.id
      // «Престиж +»: the level the player chose; «Вайп» / «Сброс»: the prestige stays (a game wipe keeps it); a nickname:
      // read again.
      const prestige = reason === 'prestige' && options.prestige != null ? { level: options.prestige } : reason === 'nickname' ? undefined : { keep: true }
      // «Престиж +», «Вайп»: nothing older than the press counts; «Сброс» finds the logs' quests again (floorAfterReset). A new
      // nickname comes by itself and only says the game's profile may be another (a pending marker).
      const marker = reason === 'nickname' ? reason : undefined
      const floor = floorAfterReset(activeProfile.modes[selectedMode], at, reason, currentLogStatus().scan?.summaryByMode?.[selectedMode]?.resetAt)
      setProfileState((state) => ({
        ...state,
        profiles: state.profiles.map((profile) => {
          if (profile.id !== profileId) return profile
          const wiped = wipeModeProgress(profile, selectedMode, at, undefined, prestige, marker, { at: floor })
          return rebuildFromLogs(reason === 'nickname' ? wiped : clearPlayerLists(wiped, selectedMode), selectedMode)
        }),
      }))
      // The stores outside the profile (src/state/logEpoch.ts listeners, src/state/modeReset.ts), the server and the notice.
      announceLogEpochChange({ kind: 'reset', at, profileId, mode: selectedMode })
      afterModeReset({ profileId, mode: selectedMode, at, reason, floor })
      if (reason !== 'nickname') clearAutoFavorites(profileId)
    },
    applyRemoteStoryForMode: (selectedMode, records, characterId) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      // Another character's chapters (this mode's character is another one now): not these.
      if (current.logCharacterId && current.logCharacterId !== characterId) return profile
      // The story pane's layer of the quest-state engine: another PC's readings of a chapter.
      const story = inputsOf(current, selectedMode).story
      let taskProgress = story
      for (const record of records) {
        // Readings from before a new character or a reset never come back.
        if ((current.logEpochAt && record.updatedAt < current.logEpochAt) || beforeModeReset(current, record.updatedAt)) continue
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
      if (taskProgress === story) return profile
      const next = withLayer(current, selectedMode, 'story', taskProgress)
      if (next === current) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
    }),
    setObjectiveValue: (def, current) => updateActive((profile) => {
      const selectedMode = profile.selectedMode
      const result = applyObjectiveChange(profile.modes[selectedMode], selectedMode, manualObjectiveValue(def, current))
      if (result.progress === profile.modes[selectedMode]) return profile
      return { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: result.progress } }
    }),
    undoProgressEvent: (eventId) => updateActive((profile) => {
      const selectedMode = profile.selectedMode
      const current = profile.modes[selectedMode]
      const at = new Date().toISOString()
      let next = undoProgressEvent(current, eventId, at)
      if (next === current) return profile
      // A quest's status goes back as a «Ручная отметка»: the engine alone writes `taskProgress` (its next run undid the
      // undo that wrote it directly), and a mark newer than the game's event wins over it (docs/quests/quest-state-engine.md).
      const event = current.progressEvents.find((entry) => entry.id === eventId)
      if (event?.eventType === 'task-status' && (event.oldValue === 'active' || event.oldValue === 'completed')) {
        next = withLayer(next, selectedMode, 'manual', setManualMark(inputsOf(next, selectedMode).manual, event.taskId, event.oldValue, at))
      }
      return { ...profile, updatedAt: at, modes: { ...profile.modes, [selectedMode]: next } }
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
      const fresh = laterTime(current.modeResetAt, current.logResetAt)
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
        const next = normalizeTaskKeys(modes[key], quests, key)
        if (next !== modes[key]) { modes[key] = next; changed = true }
      }
      return changed ? { ...profile, modes } : profile
    }),
    applyQuestChain: (selectedMode, quests) => setProfileState((state) => {
      const profile = state.profiles.find((entry) => entry.id === state.activeProfileId)
      if (!profile) return state
      const current = profile.modes[selectedMode]
      const layers = inputsOf(current, selectedMode)
      const chained = withQuestChain(layers, current.taskProgress, quests, current.tableSync?.startedAt)
      if (chained === layers) return state
      const next = commitQuestInputs(current, selectedMode, chained)
      const changed = { ...profile, updatedAt: new Date().toISOString(), modes: { ...profile.modes, [selectedMode]: withTaskEvents(current, next, selectedMode) } }
      return { ...state, profiles: state.profiles.map((entry) => entry.id === profile.id ? changed : entry) }
    }),
    startTableSync: () => updateActive((profile) => {
      const now = new Date().toISOString()
      let modes = profile.modes
      for (const selectedMode of Object.keys(profile.modes) as RaidMode[]) {
        if (!profile.modes[selectedMode].tableSync) modes = { ...modes, [selectedMode]: { ...profile.modes[selectedMode], tableSync: newTableSync(now) } }
      }
      return modes === profile.modes ? profile : { ...profile, modes }
    }),
    noteTableVisit: (selectedMode, visit, quests) => updateActive((profile) => {
      const current = profile.modes[selectedMode]
      const tableSync = tableSyncAfterVisit(current, visit, quests, new Date().toISOString())
      return !tableSync || tableSync === current.tableSync ? profile : { ...profile, modes: { ...profile.modes, [selectedMode]: { ...current, tableSync } } }
    }),
    normalizeObjectiveKeys: (mode, ids) => updateActive((profile) => {
      const current = profile.modes[mode]
      const next = current ? normalizeObjectiveKeys(current, ids) : current
      return next === current ? profile : { ...profile, modes: { ...profile.modes, [mode]: next } }
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
    toggleFavoriteItem: (id) => {
      // The player's own choice from now on: «Отложенные квесты» never takes it out (progression/autoFavorites.ts).
      forgetAutoFavorite(activeProfile.id, id)
      updateActive((profile) => {
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
      })
    },
    addFavoriteItems: (ids) => updateActive((profile) => {
      const favorites = profile.modes[profile.selectedMode].favoriteItemIds
      const added = [...new Set(ids)].filter((id) => !favorites.includes(id))
      if (!added.length) return profile
      const nextFavorites = [...favorites, ...added]
      // Like the star: one list for every mode.
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
      clearAllDeferredQuests()
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

/** The profile without these favourites: one list for every mode, as the star keeps it. */
function withoutFavorites(profile: LocalProfile, ids: readonly string[]): LocalProfile {
  const favorites = profile.modes[profile.selectedMode].favoriteItemIds
  const nextFavorites = favorites.filter((id) => !ids.includes(id))
  if (nextFavorites.length === favorites.length) return profile
  return {
    ...profile,
    updatedAt: new Date().toISOString(),
    modes: {
      pvp: { ...profile.modes.pvp, favoriteItemIds: nextFavorites },
      pve: { ...profile.modes.pve, favoriteItemIds: nextFavorites },
      seasonal: { ...profile.modes.seasonal, favoriteItemIds: nextFavorites },
    },
  }
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}

/**
 * A mode's quest events from its logs (`log`) or the server (`server`: all PCs' events of the character). R4 / step 25:
 * another character or a newer trusted reset — once, at the change — drops the older readings of every source first
 * (log, server, Tasks table, story chapters, manual marks, objectives); preferences stay. No profile line is no change.
 * The quest-state engine then decides (src/quests/questEngine.ts).
 */
function applyLogState(profile: LocalProfile, selectedMode: RaidMode, events: ParsedTaskEvent[], given: LogIdentityInput, layer: 'log' | 'server'): LocalProfile {
  const current = profile.modes[selectedMode]
  // A server of 0.6.0.41 still answers this app's own reset press as the character's «reset»: not the game's.
  const identity = given.resetAt && current.appResetTimes?.includes(given.resetAt) ? { ...given, resetAt: undefined } : given
  const { characterId, resetAt } = identity
  const now = new Date().toISOString()
  const change = logEpochChange(current, identity, now)
  const base = change ? dropRecordsBefore(current, change.at, selectedMode) : current
  // The first character a mode learns: what an older version kept from the logs is read again from them.
  const firstCharacter = Boolean(characterId) && !current.logCharacterId
  // Events from before the mode's floor never come back: the game's own last reset of the character (a PC whose own logs
  // never showed it), or a press of «Престиж +» / «Вайп» (floorAfterReset).
  const logResetAt = change ? resetAt : current.logResetAt
  const floor = laterTime(logResetAt, current.modeResetAt)
  const fresh = floor ? events.filter((event) => event.timestamp >= floor) : events
  const layers = inputsOf(base, selectedMode)
  // The server answers with every record it keeps for the character: its layer is that answer (a wipe there reaches
  // here too); this PC's logs add to what earlier scans read (the game deletes old logs).
  const merged = layer === 'server' ? sameObservations(layers.server, mergeObservations({}, fresh, false)) : mergeObservations(layers.log, fresh, !firstCharacter)
  // A pending «Престиж +» / «Вайп» marker resolves once the logs prove the game's own reset after it.
  const proven = laterTime(logResetAt, change?.kind === 'character' ? change.at : undefined)
  const marker = current.resetMarker && !current.resetMarker.resolvedAt && proven && proven > current.resetMarker.at
    ? { ...current.resetMarker, resolvedAt: proven } : current.resetMarker
  const identified: ModeProgress = { ...base, logResetAt, logEpochAt: change ? change.at : current.logEpochAt, ...(marker ? { resetMarker: marker } : {}) }
  // Another character, or the game's own reset: its quests are to be found again (src/import/tableSync.ts).
  if (change) delete identified.tableSync
  const nextLayers = merged === layers[layer] && base.questInputs ? base.questInputs : { ...layers, [layer]: merged }
  const next = commitQuestInputs(identified, selectedMode, nextLayers)
  if (!change && next.taskProgress === current.taskProgress && (!characterId || current.logCharacterId === characterId)) {
    // Nothing decided differently: at most the layer is kept (no re-render of the app for a scan that changed nothing).
    if (next.questInputs === current.questInputs) return profile
    return { ...profile, modes: { ...profile.modes, [selectedMode]: { ...current, questInputs: next.questInputs } } }
  }
  if (change) announceLogEpochChange({ ...change, profileId: profile.id, mode: selectedMode })
  return {
    ...profile,
    updatedAt: now,
    modes: {
      ...profile.modes,
      [selectedMode]: {
        ...withTaskEvents(current, next, selectedMode),
        logCharacterId: characterId ?? current.logCharacterId,
        lastLogSyncAt: now,
      },
    },
  }
}

/** The server's new layer, or the kept one when it says the same (nothing re-renders for an unchanged answer). */
function sameObservations(kept: Record<string, QuestObservation>, next: Record<string, QuestObservation>) {
  const keys = Object.keys(next)
  return keys.length === Object.keys(kept).length && keys.every((key) => kept[key]?.status === next[key]!.status && kept[key]?.at === next[key]!.at) ? kept : next
}

/**
 * The mode rebuilt from every log on disk right after a reset (owner, 15.10.2026): the latest full scan the main process
 * published (src/import/logStatus.ts), applied like any scan — the game's own reset in it is the only floor. Without one
 * (the phone, no Logs folder) the server's records come back with the next pull.
 */
function rebuildFromLogs(profile: LocalProfile, mode: RaidMode): LocalProfile {
  const scan = currentLogStatus().scan
  const summary = scan && !scan.identityOnly ? scan.summaryByMode?.[mode] : undefined
  if (!scan || !summary?.lastActivityAt) return profile
  const events = logEventsForMode(scan, mode, profile.modes[mode].registration)
  return applyLogState(profile, mode, events, { characterId: scan.latestCharacterIdByMode?.[mode], resetAt: summary.resetAt, characterSince: summary.profileSince }, 'log')
}

/**
 * Records quest status changes of one mode as progress events and, for quests the log now reports completed,
 * turns the user's manual «not done» objectives into conflicts to ask about (never overwritten silently).
 */
/** The layers after a whole read of the table: `next` is null when the mode already matches it. */
function tableReadOutcome(current: ModeProgress, read: { startedAt: number; rows: readonly SweepRow[] }, quests: Quest[], mode: RaidMode) {
  const changes = wholeTableChanges(current.taskProgress, read.rows, quests, current.faction)
  if (!changes.added.length && !changes.gone.length) return { ...changes, next: null }
  const at = new Date(read.startedAt).toISOString()
  const layers = inputsOf(current, mode)
  const table = { ...layers.table }
  let manual = layers.manual
  for (const taskId of changes.added) table[taskId] = { taskId, status: 'active', source: 'screen-scan', updatedAt: at, proven: true }
  for (const taskId of changes.gone) {
    delete table[taskId]
    manual = setManualMark(manual, taskId, 'absent', at)
  }
  return { ...changes, next: commitQuestInputs(current, mode, { ...layers, table, manual }) }
}

function withTaskEvents(before: ModeProgress, after: ModeProgress, mode: RaidMode): ModeProgress {
  if (before.taskProgress === after.taskProgress) return after
  const now = new Date().toISOString()
  const events = taskStatusEvents(before.taskProgress, after.taskProgress, mode, now)
  if (!events.length) return after
  const loggedCompletions = events.filter((event) => event.newValue === 'completed' && event.source === 'log').map((event) => event.taskId)
  return logCompletionConflicts(appendEvents(after, events), mode, loggedCompletions, now)
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
