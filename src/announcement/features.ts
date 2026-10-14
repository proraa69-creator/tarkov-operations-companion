/**
 * The owner's switches for every app (owner, 14.10.2026: «добавь в админ приложении, включить или выключить функции
 * миникарты (всплывающее окно карты поверх игры, и функция отслеживания)… После обновления приложения у всех по
 * стандарту функция миникарты выключена»). They come with the owner's notice (GET /v1/announcement `features`,
 * server/src/routes/announcement.ts; src/announcement/announcement.ts asks), so no request of their own.
 *
 * Not known yet (a first start before the first answer, a server from before the switch) counts as off. The last known
 * value is kept in this installation, so a start without network uses it. The desktop main process gets every value
 * (`experimental:set-remote-minimap`, electron/experimental/settings.ts): it takes the minimap window, its key, the
 * screenshots folder's watch and the position away while off.
 */
import { useSyncExternalStore } from 'react'

export interface RemoteFeatures {
  /** The minimap over the game and the position tracking. */
  minimap: boolean
  /** When the owner last switched the minimap off; '' while never (the default off of the update). */
  minimapChangedAt: string
  /**
   * The minimap window over the game (owner, 14.10.2026: «отключить именно мини карту по кнопке… местоположение
   * появляется только в приложении»), while `minimap` is on. On unless the owner turned it off (a server from before it).
   */
  minimapOverlay: boolean
  /** Learnt from the server (now or at an earlier start). */
  known: boolean
}

const STORE_KEY = 'raidos.remoteFeatures.v1'
/** The switch-off the one-time notice was shown for («функция мини-карты временно выключена»). */
const NOTICE_KEY = 'raidos.minimapOffNotice.seen'
const UNKNOWN: RemoteFeatures = { minimap: false, minimapChangedAt: '', minimapOverlay: true, known: false }

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function readStored(): RemoteFeatures {
  try {
    const saved = JSON.parse(storage()?.getItem(STORE_KEY) ?? 'null') as unknown
    const parsed = parseFeatures({ features: saved })
    return parsed ? { ...parsed, known: true } : UNKNOWN
  } catch {
    return UNKNOWN
  }
}

let current: RemoteFeatures = readStored()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The answer's `features`, shape-checked; null when the server sent none (a server from before: nothing changes). */
export function parseFeatures(value: unknown): Omit<RemoteFeatures, 'known'> | null {
  if (!value || typeof value !== 'object') return null
  const raw = (value as { features?: unknown }).features as { minimap?: unknown; minimapChangedAt?: unknown; minimapOverlay?: unknown } | null | undefined
  if (!raw || typeof raw !== 'object' || typeof raw.minimap !== 'boolean') return null
  return {
    minimap: raw.minimap,
    minimapChangedAt: typeof raw.minimapChangedAt === 'string' ? raw.minimapChangedAt.slice(0, 40) : '',
    minimapOverlay: raw.minimapOverlay !== false,
  }
}

/** The values the main process has (null: not sent from this page yet). */
let sent: string | null = null
function tellMain(enabled: boolean, overlay: boolean) {
  const set = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.experimental?.setRemoteMinimap
  const key = `${enabled}:${overlay}`
  if (!set || sent === key) return
  sent = key
  try {
    void Promise.resolve(set(enabled, overlay)).catch(() => { sent = null })
  } catch {
    sent = null
  }
}

/** The main process starts with the minimap off: give it the last known value as the app opens. */
export function sendRemoteFeaturesToMain() {
  tellMain(current.minimap, current.minimapOverlay)
}

/** A server answer (or the owner's own switch): kept, shown to the pages, passed to the main process. */
export function setRemoteFeatures(value: Omit<RemoteFeatures, 'known' | 'minimapOverlay'> & { minimapOverlay?: boolean }) {
  const next = { ...value, minimapOverlay: value.minimapOverlay !== false }
  tellMain(next.minimap, next.minimapOverlay)
  if (current.known && next.minimap === current.minimap && next.minimapChangedAt === current.minimapChangedAt && next.minimapOverlay === current.minimapOverlay) return
  current = { minimap: next.minimap, minimapChangedAt: next.minimapChangedAt, minimapOverlay: next.minimapOverlay, known: true }
  try { storage()?.setItem(STORE_KEY, JSON.stringify({ minimap: current.minimap, minimapChangedAt: current.minimapChangedAt, minimapOverlay: current.minimapOverlay })) } catch { /* kept for this run */ }
  for (const listener of listeners) listener()
}

export const remoteFeatures = () => current

export function useRemoteFeatures() {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** The minimap window over the game is allowed by the owner now: both switches on. */
export const minimapOverlayAllowed = (features: RemoteFeatures) => features.minimap && features.minimapOverlay

/**
 * The one-time notice is due: the minimap is off, and this installation has not seen this switch-off yet. Shown again
 * only when the owner turns it on and later off again (a new `minimapChangedAt`).
 */
export function minimapNoticeDue(features: RemoteFeatures = current) {
  if (!features.known || features.minimap) return false
  try { return storage()?.getItem(NOTICE_KEY) !== features.minimapChangedAt } catch { return true }
}

export function markMinimapNoticeSeen(features: RemoteFeatures = current) {
  try { storage()?.setItem(NOTICE_KEY, features.minimapChangedAt) } catch { /* shown again next time */ }
}

/** For the tests: back to a fresh installation's state (what is stored is read again). */
export function reloadRemoteFeaturesForTests() {
  current = readStored()
  sent = null
  for (const listener of listeners) listener()
}
