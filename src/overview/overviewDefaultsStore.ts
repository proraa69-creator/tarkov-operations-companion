import { useSyncExternalStore } from 'react'
import { sanitizeOverviewDefaults, type OverviewDefaults } from './overviewDefaults'

/**
 * The owner's Overview defaults in this app (src/overview/overviewDefaults.ts «Блоки»). They come with the owner's notice
 * (GET /v1/announcement `overview`, src/announcement/announcement.ts asks every 3–6 minutes, when the window gets the
 * focus back and at start), so there is no request or timer of its own. The last answer is kept in this installation, so
 * a start without network shows the same Overview. `overview: null` from the server: the owner went back to the built-in
 * Overview; no `overview` field (a server from before): nothing changes.
 */
const STORE_KEY = 'raidos.overviewDefaults.v1'

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function readStored(): OverviewDefaults | null {
  try {
    return sanitizeOverviewDefaults(JSON.parse(storage()?.getItem(STORE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

let current: OverviewDefaults | null = readStored()
let fingerprint = JSON.stringify(current)
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The answer's `overview`: undefined when the server sent none (keep what is known), null for the built-in Overview, or
 * the defaults (shape-checked).
 */
export function parseOverviewAnswer(value: unknown): OverviewDefaults | null | undefined {
  if (!value || typeof value !== 'object' || !('overview' in value)) return undefined
  const raw = (value as { overview?: unknown }).overview
  if (raw === null) return null
  return sanitizeOverviewDefaults(raw) ?? undefined
}

/** New defaults from the server (or the owner's own save): kept and shown to the Overview at once. */
export function setOverviewDefaults(next: OverviewDefaults | null) {
  const print = JSON.stringify(next)
  if (print === fingerprint) return
  current = next
  fingerprint = print
  try {
    if (next) storage()?.setItem(STORE_KEY, print)
    else storage()?.removeItem(STORE_KEY)
  } catch { /* kept for this run */ }
  for (const listener of listeners) listener()
}

export const overviewDefaults = () => current

export function useOverviewDefaults() {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** For the tests: back to a fresh installation's state (what is stored is read again). */
export function reloadOverviewDefaultsForTests() {
  current = readStored()
  fingerprint = JSON.stringify(current)
  for (const listener of listeners) listener()
}
