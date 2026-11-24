import { useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

/**
 * Item id → pieces per profile and mode (PvP, PvE and Season apart), on this device and in the account on the server
 * (sync/serverSync.ts syncItemCounts, GET / PUT /v1/me/items/:mode/:kind): a local change is marked dirty until the
 * server has it; the server's copy replaces the device's otherwise. One store per kind:
 *  - quests/questFound.ts — pieces put aside for the quests;
 *  - stashScan/stashSeen.ts — what the last screen scan saw in the stash («Не нужны»).
 */
export interface ItemCountStore {
  kind: 'quests' | 'stash'
  event: string
  read: (profileId: string, mode: RaidMode) => ReadonlyMap<string, number>
  write: (profileId: string, mode: RaidMode, counts: ReadonlyMap<string, number>, options?: { fromServer?: boolean }) => void
  isDirty: (profileId: string, mode: RaidMode) => boolean
  clearDirty: (profileId: string, mode: RaidMode) => void
  useCounts: (profileId: string, mode: RaidMode) => ReadonlyMap<string, number>
}

const NONE: ReadonlyMap<string, number> = new Map()

export function createItemCountStore(kind: ItemCountStore['kind'], prefix: string, event: string): ItemCountStore {
  const snapshots = new Map<string, { raw: string | null; counts: ReadonlyMap<string, number> }>()
  const key = (profileId: string, mode: RaidMode) => `${prefix}${profileId}:${mode}`
  const dirtyKey = (profileId: string, mode: RaidMode) => `${prefix}dirty:${profileId}:${mode}`

  const read = (profileId: string, mode: RaidMode): ReadonlyMap<string, number> => {
    const storageKey = key(profileId, mode)
    let raw: string | null = null
    try { raw = localStorage.getItem(storageKey) } catch { /* storage unavailable */ }
    const cached = snapshots.get(storageKey)
    if (cached && cached.raw === raw) return cached.counts
    let counts = NONE
    try {
      const value: unknown = raw ? JSON.parse(raw) : null
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        counts = new Map(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0))
      }
    } catch { /* a damaged value reads as nothing */ }
    snapshots.set(storageKey, { raw, counts })
    return counts
  }

  const write: ItemCountStore['write'] = (profileId, mode, counts, options = {}) => {
    try {
      if (counts.size) localStorage.setItem(key(profileId, mode), JSON.stringify(Object.fromEntries(counts)))
      else localStorage.removeItem(key(profileId, mode))
      if (!options.fromServer) localStorage.setItem(dirtyKey(profileId, mode), '1')
    } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(event))
  }

  const subscribe = (listener: () => void) => {
    window.addEventListener(event, listener)
    window.addEventListener('storage', listener)
    return () => { window.removeEventListener(event, listener); window.removeEventListener('storage', listener) }
  }

  return {
    kind, event, read, write,
    isDirty: (profileId, mode) => { try { return localStorage.getItem(dirtyKey(profileId, mode)) === '1' } catch { return false } },
    clearDirty: (profileId, mode) => { try { localStorage.removeItem(dirtyKey(profileId, mode)) } catch { /* storage unavailable */ } },
    useCounts: (profileId, mode) => useSyncExternalStore(subscribe, () => read(profileId, mode), () => NONE),
  }
}
