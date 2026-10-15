/**
 * The owner's switch for every app (owner, 14.10.2026: «добавь в админ приложении, включить или выключить функции
 * миникарты (всплывающее окно карты поверх игры, и функция отслеживания)… После обновления приложения у всех по
 * стандарту функция миникарты выключена»): `minimap`, now the position from the game's screenshots on «Карты» and the
 * phone. It comes with the owner's notice (GET /v1/announcement `features`, server/src/routes/announcement.ts;
 * src/announcement/announcement.ts asks), so no request of its own.
 *
 * Not known yet (a first start before the first answer, a server from before the switch) counts as off. The last known
 * value is kept in this installation, so a start without network uses it. The desktop main process gets every value
 * (`experimental:set-remote-minimap`, electron/experimental/settings.ts): it takes the screenshots folder's watch and
 * the position away while off.
 *
 * The server's second switch, `minimapOverlay` (the minimap window over the game), is read by the apps from before
 * 15.10.2026 only: this app draws nothing over the game (owner, 15.10.2026), so it ignores it.
 */
import { useSyncExternalStore } from 'react'

export interface RemoteFeatures {
  /** The position tracking (the game's screenshots → «Карты» and the phone). */
  minimap: boolean
  /** When the owner last switched it off; '' while never (the default off of the update). */
  minimapChangedAt: string
  /** Learnt from the server (now or at an earlier start). */
  known: boolean
}

const STORE_KEY = 'raidos.remoteFeatures.v1'
const UNKNOWN: RemoteFeatures = { minimap: false, minimapChangedAt: '', known: false }

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
  const raw = (value as { features?: unknown }).features as { minimap?: unknown; minimapChangedAt?: unknown } | null | undefined
  if (!raw || typeof raw !== 'object' || typeof raw.minimap !== 'boolean') return null
  return {
    minimap: raw.minimap,
    minimapChangedAt: typeof raw.minimapChangedAt === 'string' ? raw.minimapChangedAt.slice(0, 40) : '',
  }
}

/** The values the main process has (null: not sent from this page yet). */
let sent: boolean | null = null
function tellMain(enabled: boolean) {
  const set = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.experimental?.setRemoteMinimap
  if (!set || sent === enabled) return
  sent = enabled
  try {
    void Promise.resolve(set(enabled)).catch(() => { sent = null })
  } catch {
    sent = null
  }
}

/** The main process starts with the tracking off: give it the last known value as the app opens. */
export function sendRemoteFeaturesToMain() {
  tellMain(current.minimap)
}

/** A server answer (or the owner's own switch): kept, shown to the pages, passed to the main process. */
export function setRemoteFeatures(value: Omit<RemoteFeatures, 'known'>) {
  tellMain(value.minimap)
  if (current.known && value.minimap === current.minimap && value.minimapChangedAt === current.minimapChangedAt) return
  current = { minimap: value.minimap, minimapChangedAt: value.minimapChangedAt, known: true }
  try { storage()?.setItem(STORE_KEY, JSON.stringify({ minimap: current.minimap, minimapChangedAt: current.minimapChangedAt })) } catch { /* kept for this run */ }
  for (const listener of listeners) listener()
}

export const remoteFeatures = () => current

export function useRemoteFeatures() {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** For the tests: back to a fresh installation's state (what is stored is read again). */
export function reloadRemoteFeaturesForTests() {
  current = readStored()
  sent = null
  for (const listener of listeners) listener()
}
