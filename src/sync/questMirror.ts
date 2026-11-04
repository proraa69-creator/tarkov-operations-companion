/**
 * The PC's quests on the phone, one to one (owner, 18.10.2026: «приложение на телефоне должно дублироваться полностью с
 * пк, квесты опять не показывает верно»). The phone rebuilt the quests from the log records the PC uploaded, without the
 * PC's screen readings (the Tasks table, the traders) and whatever else the PC decided — so the two disagreed. Now the PC
 * uploads the quest-state engine's output itself (`taskProgress` of each mode, PUT /v1/me/quest-mirror/:mode) and an app
 * that takes its quests from the server (the phone; a PC without logs of the mode: serverSync pullsServerProgress) shows
 * exactly that. Only its own marks made after the PC's copy go over it, until the PC sends a new one with them.
 */
import { useSyncExternalStore } from 'react'
import type { LocalProfile, ModeProgress, RaidMode, StoryObjectiveReading, TaskProgressRecord } from '../domain/types'
import { ENTITY_ID_PATTERN } from '../progression/objectiveProgress'

/** What else the quest lists depend on, as the PC has it (owner, 18.10.2026: «полная синхронизация… вообще всё»). */
export interface MirrorProfile {
  playerLevel?: number
  faction?: ModeProgress['faction']
  prestige?: number
  trackedTaskIds?: string[]
}

export interface QuestMirror {
  /** When the PC made this copy (ISO). */
  at: string
  records: Record<string, TaskProgressRecord>
  profile?: MirrorProfile
}

/** Same limits as the server (server/src/routes/me.ts questMirrorSchema). */
export const QUEST_MIRROR_LIMITS = { records: 3000, objectives: 40, text: 400 }
/** Task ids as the rest of the sync takes them (tarkov.dev hex ids, story and wiki ids). */
export const QUEST_MIRROR_ID = ENTITY_ID_PATTERN
const STATUSES = new Set(['active', 'completed', 'failed'])
const SOURCES = new Set(['manual', 'manual-fix', 'eft-log', 'profile-import', 'backup', 'migration', 'inferred', 'screen-scan'])
const isTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const shortText = (value: unknown, max = QUEST_MIRROR_LIMITS.text) => typeof value === 'string' ? value.slice(0, max) : undefined
const smallInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : undefined

function objectiveOf(value: unknown): StoryObjectiveReading | null {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id || value.id.length > 120 || typeof value.text !== 'string') return null
  const stageIndex = smallInt(value.stageIndex)
  const current = smallInt(value.current)
  const total = smallInt(value.total)
  const hint = shortText(value.hint)
  return {
    id: value.id, text: value.text.slice(0, QUEST_MIRROR_LIMITS.text), optional: value.optional === true, completed: value.completed === true,
    ...(stageIndex !== undefined ? { stageIndex } : {}), ...(current !== undefined ? { current } : {}), ...(total !== undefined ? { total } : {}),
    ...(hint ? { hint } : {}),
  }
}

/** One record as the app keeps it, or null (nothing from the network or the storage is taken as is). */
export function mirrorRecordOf(taskId: string, value: unknown): TaskProgressRecord | null {
  if (!QUEST_MIRROR_ID.test(taskId) || !isObject(value) || !STATUSES.has(String(value.status)) || !SOURCES.has(String(value.source)) || !isTime(value.updatedAt)) return null
  const stage = smallInt(value.currentStageIndex)
  const objectives = Array.isArray(value.storyObjectives)
    ? value.storyObjectives.slice(0, QUEST_MIRROR_LIMITS.objectives).map(objectiveOf).filter((entry): entry is StoryObjectiveReading => entry !== null)
    : []
  const inferredFrom = typeof value.inferredFromTaskId === 'string' && QUEST_MIRROR_ID.test(value.inferredFromTaskId) ? value.inferredFromTaskId : undefined
  return {
    // ISO in UTC, as the server takes times (a record kept with an offset would make it refuse the whole copy)
    taskId, status: value.status as TaskProgressRecord['status'], source: value.source as TaskProgressRecord['source'], updatedAt: new Date(value.updatedAt).toISOString(),
    ...(value.origin === 'server' ? { origin: 'server' as const } : {}),
    ...(inferredFrom ? { inferredFromTaskId: inferredFrom } : {}),
    ...(stage !== undefined ? { currentStageIndex: stage } : {}),
    ...(objectives.length ? { storyObjectives: objectives } : {}),
  }
}

/** The profile part, checked (the server's limits: level 1–79, prestige 0–10, up to 500 tracked quests). */
export function mirrorProfileOf(value: unknown): MirrorProfile | undefined {
  if (!isObject(value)) return undefined
  const profile: MirrorProfile = {}
  if (typeof value.playerLevel === 'number' && Number.isInteger(value.playerLevel) && value.playerLevel >= 1 && value.playerLevel <= 79) profile.playerLevel = value.playerLevel
  if (value.faction === 'usec' || value.faction === 'bear' || value.faction === 'unknown') profile.faction = value.faction
  if (typeof value.prestige === 'number' && Number.isInteger(value.prestige) && value.prestige >= 0 && value.prestige <= 10) profile.prestige = value.prestige
  if (Array.isArray(value.trackedTaskIds)) profile.trackedTaskIds = [...new Set(value.trackedTaskIds.filter((id): id is string => typeof id === 'string' && QUEST_MIRROR_ID.test(id)))].slice(0, 500)
  return Object.keys(profile).length ? profile : undefined
}

/** The server's (or the storage's) copy, checked record by record; null when it is no copy at all. */
export function parseQuestMirror(value: unknown): QuestMirror | null {
  if (!isObject(value) || !isTime(value.at) || !isObject(value.records)) return null
  const records: Record<string, TaskProgressRecord> = {}
  for (const [taskId, entry] of Object.entries(value.records).slice(0, QUEST_MIRROR_LIMITS.records)) {
    const record = mirrorRecordOf(taskId, entry)
    if (record) records[taskId] = record
  }
  const profile = mirrorProfileOf(value.profile)
  return { at: value.at, records, ...(profile ? { profile } : {}) }
}

/** What the PC sends: its records as they are, within the limits, and the profile the lists depend on. */
export function questMirrorBody(progress: Pick<ModeProgress, 'taskProgress'> & Partial<Pick<ModeProgress, 'playerLevel' | 'faction' | 'prestige' | 'trackedTaskIds'>>, at: string): QuestMirror {
  const records: Record<string, TaskProgressRecord> = {}
  for (const [taskId, entry] of Object.entries(progress.taskProgress)) {
    const record = mirrorRecordOf(taskId, entry)
    if (record && record.taskId === taskId) records[taskId] = record
    if (Object.keys(records).length >= QUEST_MIRROR_LIMITS.records) break
  }
  const profile = mirrorProfileOf({ playerLevel: progress.playerLevel, faction: progress.faction, prestige: progress.prestige, trackedTaskIds: progress.trackedTaskIds })
  return { at: new Date(at).toISOString(), records, ...(profile ? { profile } : {}) }
}

/**
 * The quests an app that pulls them shows: the PC's copy, with this app's own marks made after it on top («Снять
 * отметку» leaves the PC's word). Without a copy: the app's own records.
 */
export function mirroredTaskProgress(progress: Pick<ModeProgress, 'taskProgress' | 'questInputs'>, mirror: QuestMirror | null | undefined): Record<string, TaskProgressRecord> {
  if (!mirror) return progress.taskProgress
  let records = mirror.records
  for (const [taskId, mark] of Object.entries(progress.questInputs?.manual ?? {})) {
    if (mark.status === 'cleared' || mark.at <= mirror.at) continue
    if (records === mirror.records) records = { ...mirror.records }
    records[taskId] = { taskId, status: mark.status, source: 'manual-fix', updatedAt: mark.at }
  }
  return records
}

// ------------------------------------------------------------------------------------------------------------
// The copies this app holds, per mode, for the account they came from (kept for the next start, offline too)
// ------------------------------------------------------------------------------------------------------------

const STORAGE_KEY = 'raidos-quest-mirror-v1'
interface Held { account: string; mirrors: Partial<Record<RaidMode, QuestMirror>> }
let held: Held | null = readHeld()
const listeners = new Set<() => void>()

function readHeld(): Held | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (!isObject(parsed) || typeof parsed.account !== 'string' || !isObject(parsed.mirrors)) return null
    const mirrors: Held['mirrors'] = {}
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
      const mirror = parseQuestMirror(parsed.mirrors[mode])
      if (mirror) mirrors[mode] = mirror
    }
    return { account: parsed.account, mirrors }
  } catch {
    return null
  }
}

function writeHeld(next: Held | null) {
  held = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage full or blocked: kept for this session */ }
  for (const listener of listeners) listener()
}

/** A copy of the mode for this account (an older one than the copy held changes nothing). */
export function holdQuestMirror(account: string, mode: RaidMode, mirror: QuestMirror | null) {
  const mirrors = held?.account === account ? held.mirrors : {}
  const kept = mirrors[mode]
  if (mirror ? kept && kept.at >= mirror.at && JSON.stringify(kept) === JSON.stringify(mirror) : !kept) return
  const next = { ...mirrors }
  if (mirror) next[mode] = mirror
  else delete next[mode]
  writeHeld({ account, mirrors: next })
}

/** Another account signed in (or this one signed out): its copies go. */
export function noteQuestMirrorAccount(account: string | null) {
  if (held && held.account !== account) writeHeld(null)
}

/** A mode the app no longer takes from the server (its logs came back): its copy goes. */
export function dropQuestMirror(mode: RaidMode) {
  if (!held?.mirrors[mode]) return
  const next = { ...held.mirrors }
  delete next[mode]
  writeHeld({ ...held, mirrors: next })
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useQuestMirrors(): Held['mirrors'] | undefined {
  return useSyncExternalStore(subscribe, () => held?.mirrors, () => held?.mirrors)
}

/** The profile as an app that pulls its quests shows it: each mode with a PC copy takes the copy's quests. */
export function withQuestMirrors(profile: LocalProfile, mirrors: Held['mirrors'] | undefined): LocalProfile {
  if (!mirrors) return profile
  let modes = profile.modes
  for (const mode of Object.keys(mirrors) as RaidMode[]) {
    const progress = modes[mode]
    if (!progress) continue
    const mirror = mirrors[mode]
    const taskProgress = mirroredTaskProgress(progress, mirror)
    const own = mirror?.profile
    if (taskProgress === progress.taskProgress && !own) continue
    if (modes === profile.modes) modes = { ...profile.modes }
    // The level, faction, prestige and tracked quests of the PC too: the lists depend on them.
    modes[mode] = {
      ...progress, taskProgress,
      ...(own?.playerLevel ? { playerLevel: own.playerLevel } : {}),
      ...(own?.faction ? { faction: own.faction } : {}),
      ...(own?.prestige !== undefined ? { prestige: own.prestige } : {}),
      ...(own?.trackedTaskIds ? { trackedTaskIds: own.trackedTaskIds } : {}),
    }
  }
  return modes === profile.modes ? profile : { ...profile, modes }
}
