/**
 * Functions the owner turned on for this account only, for a while (GET /v1/me/features,
 * server/src/services/trialFeatures.ts): each one's end, ending by itself. Asked with every full sync
 * (src/sync/serverSync.ts); the last answer is kept in this installation, so a start without network keeps it until its end.
 *
 * `questTableScan`: «Синхронизация заданий по экрану» — the game's «Задания» table is read from the screen even when the
 * game's logs look complete (src/components/StoryScreenScanner.tsx).
 *
 * The player can start the same reading himself for a while, in any mode: «Найти квесты по экрану» on «Квесты» (owner,
 * 01.11.2026: «человек зашел и проблема с логами, не может найти квесты, он заходит сканирует по экрану квесты, они
 * добавляются и дальше уже все работает по логам»). Kept on this PC only (PLAYER_SCAN_KEY); the logs keep deciding every
 * quest they know, the table fills the rest (src/quests/questEngine.ts). Without these the table is read only until the mode's
 * first sync ended (src/import/tableSync.ts).
 */
import { useSyncExternalStore } from 'react'

export interface TrialFeatures { questTableScan: string | null }

const STORE_KEY = 'raidos.trialFeatures.v1'
const PLAYER_SCAN_KEY = 'raidos.playerQuestScan.v1'
const NONE: TrialFeatures = { questTableScan: null }
/** «Найти квесты по экрану»: this long, then off by itself (the player can stop it sooner with «Готово»). */
export const PLAYER_SCAN_MINUTES = 30

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** The answer's `features`, shape-checked; null when it has none. */
export function parseTrialFeatures(value: unknown): TrialFeatures | null {
  const raw = value && typeof value === 'object' ? (value as { features?: unknown }).features : undefined
  if (!raw || typeof raw !== 'object') return null
  const until = (raw as { questTableScan?: unknown }).questTableScan
  return { questTableScan: typeof until === 'string' && Number.isFinite(Date.parse(until)) ? until : null }
}

function readStored(): TrialFeatures {
  try {
    return parseTrialFeatures({ features: JSON.parse(storage()?.getItem(STORE_KEY) ?? 'null') }) ?? NONE
  } catch {
    return NONE
  }
}

let current = readStored()
let playerScan: string | null = (() => {
  try {
    const saved = storage()?.getItem(PLAYER_SCAN_KEY) ?? null
    return saved && Number.isFinite(Date.parse(saved)) ? saved : null
  } catch {
    return null
  }
})()
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

/** «Найти квесты по экрану» on for PLAYER_SCAN_MINUTES from now. */
export function startPlayerQuestScan(now = Date.now()) {
  playerScan = new Date(now + PLAYER_SCAN_MINUTES * 60_000).toISOString()
  try { storage()?.setItem(PLAYER_SCAN_KEY, playerScan) } catch { /* kept for this start only */ }
  notify()
}

/** «Готово»: the logs alone again. */
export function stopPlayerQuestScan() {
  playerScan = null
  try { storage()?.removeItem(PLAYER_SCAN_KEY) } catch { /* nothing kept */ }
  notify()
}

/** The end of the player's own quest screen search, while it is on; null otherwise. */
export function playerQuestScanUntil(now = Date.now()): string | null {
  return playerScan && Date.parse(playerScan) > now ? playerScan : null
}

/** When the player's own quest screen search was started, while it is on. */
export function playerQuestScanStartedAt(now = Date.now()): number | undefined {
  const until = playerQuestScanUntil(now)
  return until ? Date.parse(until) - PLAYER_SCAN_MINUTES * 60_000 : undefined
}

/** Called on every change of either: the scanner looks at the game at once (src/components/StoryScreenScanner.tsx). */
export function onQuestTableScanChange(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setTrialFeatures(next: TrialFeatures) {
  if (next.questTableScan === current.questTableScan) return
  current = next
  try { storage()?.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* kept for this start only */ }
  notify()
}

/** The end of the quest table reading (the owner's or the player's own, the later one), while it is on; null otherwise. */
export function questTableScanUntil(now = Date.now()): string | null {
  const owner = current.questTableScan && Date.parse(current.questTableScan) > now ? current.questTableScan : null
  const own = playerQuestScanUntil(now)
  return owner && own ? (Date.parse(owner) > Date.parse(own) ? owner : own) : owner ?? own
}

export function useQuestTableScanUntil() {
  return useSyncExternalStore(onQuestTableScanChange, () => questTableScanUntil(), () => null)
}

export function usePlayerQuestScanUntil() {
  return useSyncExternalStore(onQuestTableScanChange, () => playerQuestScanUntil(), () => null)
}
