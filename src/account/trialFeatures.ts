/**
 * Functions the owner turned on for this account only, for a while (GET /v1/me/features,
 * server/src/services/trialFeatures.ts): each one's end, ending by itself. Asked with every full sync
 * (src/sync/serverSync.ts); the last answer is kept in this installation, so a start without network keeps it until its end.
 *
 * `questTableScan`: «Синхронизация заданий по экрану» — the game's «Задания» table is read from the screen even when the
 * game's logs look complete (src/components/StoryScreenScanner.tsx).
 */
import { useSyncExternalStore } from 'react'

export interface TrialFeatures { questTableScan: string | null }

const STORE_KEY = 'raidos.trialFeatures.v1'
const NONE: TrialFeatures = { questTableScan: null }

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
const listeners = new Set<() => void>()

export function setTrialFeatures(next: TrialFeatures) {
  if (next.questTableScan === current.questTableScan) return
  current = next
  try { storage()?.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* kept for this start only */ }
  for (const listener of listeners) listener()
}

/** The end of the quest table reading, while it is still on; null otherwise. */
export function questTableScanUntil(now = Date.now()): string | null {
  const until = current.questTableScan
  return until && Date.parse(until) > now ? until : null
}

export function useQuestTableScanUntil() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => questTableScanUntil(), () => null)
}
