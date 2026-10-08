/**
 * «Квесты на карте» → «Сделал в этом рейде»: the player's own check on a current quest during a raid. It is only a
 * note: it never completes the quest and never touches progress data (that comes from the game, see
 * docs/product-roadmap-and-business-model.md, «Quest logic requirements»).
 *
 * Kept on this device per profile and mode (PvP, PvE and Season apart) as `{ questId: checkedAt (ms) }`, outside the
 * profile, so a click does not rebuild the progress state. The desktop shell clears the checks when the next raid
 * starts (components/QuestChecksRaidReset.tsx); without the EFT logs there is no raid signal and they stay until the
 * player clears them.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import type { RaidState } from '../import/raidState'

const KEY_PREFIX = 'tarkov-quest-checks-v1:'
const EVENT = 'tarkov-quest-checks-changed'
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/** Quest id → when the player checked it (ms). */
export type QuestChecks = ReadonlyMap<string, number>

const NO_CHECKS: QuestChecks = new Map()
const snapshots = new Map<string, { raw: string | null; checks: QuestChecks }>()

export function questChecksKey(profileId: string, mode: RaidMode) {
  return `${KEY_PREFIX}${profileId}:${mode}`
}

export function readQuestChecks(profileId: string, mode: RaidMode): QuestChecks {
  const key = questChecksKey(profileId, mode)
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage unavailable */ }
  // useSyncExternalStore needs a stable snapshot: parse only when the stored text changed.
  const cached = snapshots.get(key)
  if (cached && cached.raw === raw) return cached.checks
  const checks = parseChecks(raw)
  snapshots.set(key, { raw, checks })
  return checks
}

function parseChecks(raw: string | null): QuestChecks {
  if (!raw) return NO_CHECKS
  try {
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return NO_CHECKS
    const checks = new Map<string, number>()
    for (const [questId, at] of Object.entries(stored)) if (typeof at === 'number' && Number.isFinite(at)) checks.set(questId, at)
    return checks
  } catch {
    // A damaged value reads as no checks; the next click writes a clean one.
    return NO_CHECKS
  }
}

function writeChecks(profileId: string, mode: RaidMode, checks: QuestChecks) {
  const key = questChecksKey(profileId, mode)
  try {
    if (checks.size) localStorage.setItem(key, JSON.stringify(Object.fromEntries(checks)))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}

function notify() {
  window.dispatchEvent(new Event(EVENT))
}

export function setQuestCheck(profileId: string, mode: RaidMode, questId: string, checked: boolean, now = Date.now()) {
  const next = new Map(readQuestChecks(profileId, mode))
  if (checked) next.set(questId, now)
  else next.delete(questId)
  writeChecks(profileId, mode, next)
  notify()
}

export function toggleQuestCheck(profileId: string, mode: RaidMode, questId: string, now = Date.now()) {
  setQuestCheck(profileId, mode, questId, !readQuestChecks(profileId, mode).has(questId), now)
}

/** «Снять все галочки»: every check of one mode of the profile. */
export function clearQuestChecks(profileId: string, mode: RaidMode) {
  writeChecks(profileId, mode, NO_CHECKS)
  notify()
}

/**
 * The next raid has started: checks made before `startedAt` go, in every mode of the profile (the app may show
 * another mode than the one the game plays). Checks made during this raid stay. Returns how many were cleared.
 */
export function clearQuestChecksBefore(profileId: string, startedAt: number) {
  let cleared = 0
  for (const mode of MODES) {
    const checks = readQuestChecks(profileId, mode)
    const kept = new Map([...checks].filter(([, at]) => at >= startedAt))
    if (kept.size === checks.size) continue
    cleared += checks.size - kept.size
    writeChecks(profileId, mode, kept)
  }
  if (cleared) notify()
  return cleared
}

/** «Удалить все данные»: the checks of every profile and mode. */
export function clearAllQuestChecks() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  notify()
}

function subscribe(listener: () => void) {
  // Another window of the app (or a browser tab) changed them; `key` is null when the whole storage was cleared.
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useQuestChecks(profileId: string, mode: RaidMode): QuestChecks {
  const read = useCallback(() => readQuestChecks(profileId, mode), [profileId, mode])
  return useSyncExternalStore(subscribe, read, () => NO_CHECKS)
}

/** Checked quests go to the end of their list, so the ones still to do stay on top; the order is otherwise kept. */
export function orderByChecks<T extends { quest: { id: string } }>(entries: T[], checks: QuestChecks): T[] {
  if (!entries.some(({ quest }) => checks.has(quest.id))) return entries
  return [...entries.filter(({ quest }) => !checks.has(quest.id)), ...entries.filter(({ quest }) => checks.has(quest.id))]
}

/** A raid counts only after this long: a search cancelled within it goes back to the menu without a raid. */
export const RAID_CONFIRM_MS = 45_000
/** Still searching for a match after that: look again this often. */
export const RAID_RECHECK_MS = 15_000
/** Logs that never name the location: a raid still on after this long has started anyway. */
export const RAID_FALLBACK_MS = 5 * 60_000

interface RaidStateSource {
  getRaidState: () => Promise<RaidState>
  onRaidStateChanged: (callback: (state: RaidState) => void) => () => void
}

/**
 * Calls `onRaid(startedAt)` once for every raid that has really started; returns the unsubscribe function.
 * The raid state comes from the EFT logs (desktop shell, `window.tarkovDesktop`). It turns «in raid» when the location
 * starts loading — before matching, which the player can still cancel back to the menu — and `since` moves on with
 * every loading step. So a raid counts once it has lasted RAID_CONFIRM_MS and matching is over (the log names the
 * location when the network game is created), or after RAID_FALLBACK_MS without that. `startedAt` is the `since` first
 * seen for this raid, i.e. when loading began (opened mid-raid: when the current stage began).
 */
export function watchRaidStarts(source: RaidStateSource, onRaid: (startedAt: number) => void) {
  let stopped = false
  let inRaid = false
  // A pending confirmation belongs to one stretch «in raid»; leaving it (or a new one) makes it stale.
  let stretch = 0
  let startedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (delay: number) => {
    const current = stretch
    timer = setTimeout(() => void confirm(current), delay)
  }
  const confirm = async (current: number) => {
    timer = undefined
    const state = await source.getRaidState().catch(() => null)
    if (stopped || current !== stretch) return
    if (!state) { schedule(RAID_RECHECK_MS); return }
    // Back in the menu: the event saying so is on its way.
    if (!state.inRaid) return
    if (state.location || Date.now() - startedAt >= RAID_FALLBACK_MS) onRaid(startedAt)
    else schedule(RAID_RECHECK_MS)
  }
  const follow = (state: RaidState) => {
    if (stopped || state.inRaid === inRaid) return
    inRaid = state.inRaid
    stretch += 1
    clearTimeout(timer)
    timer = undefined
    if (!state.inRaid) return
    startedAt = state.since ?? Date.now()
    // Opened mid-raid: the time already spent in it counts.
    const spent = Math.min(Math.max(Date.now() - startedAt, 0), RAID_CONFIRM_MS)
    schedule(RAID_CONFIRM_MS - spent)
  }

  // The state asked for at the start is older than any event that comes before the answer.
  let heard = false
  const unsubscribe = source.onRaidStateChanged((state) => {
    heard = true
    follow(state)
  })
  source.getRaidState().then((state) => { if (!heard) follow(state) }, () => {})
  return () => {
    stopped = true
    clearTimeout(timer)
    unsubscribe()
  }
}
