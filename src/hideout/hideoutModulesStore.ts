import { useMemo, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import { modeModules, sanitizeHideoutModules, type HideoutModules, type ModeModuleSets } from './hideoutModules'

/**
 * The owner's «Модули убежища» in this app (src/hideout/hideoutModules.ts). They come with the owner's notice (GET /v1/announcement
 * `hideoutModules`, src/announcement/announcement.ts asks every 3–6 minutes, when the window gets the focus back and at start), so
 * there is no request or timer of its own, as the Overview's defaults (src/overview/overviewDefaultsStore.ts). The last answer is
 * kept in this installation, so a start without network shows the same hideout. `hideoutModules: null` from the server: every mode
 * as in the game; no field (a server from before): nothing changes.
 */
const STORE_KEY = 'raidos.hideoutModules.v1'

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function readStored(): HideoutModules | null {
  try {
    return sanitizeHideoutModules(JSON.parse(storage()?.getItem(STORE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

let current: HideoutModules | null = readStored()
let fingerprint = JSON.stringify(current)
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The answer's `hideoutModules`: undefined when the server sent none (keep what is known), null for none, or the setting. */
export function parseHideoutModulesAnswer(value: unknown): HideoutModules | null | undefined {
  if (!value || typeof value !== 'object' || !('hideoutModules' in value)) return undefined
  const raw = (value as { hideoutModules?: unknown }).hideoutModules
  if (raw === null) return null
  return sanitizeHideoutModules(raw) ?? (raw && typeof raw === 'object' && !Array.isArray(raw) ? null : undefined)
}

/** A new setting from the server (or the owner's own save): kept and shown at once. */
export function setHideoutModules(next: HideoutModules | null) {
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

/** The setting now, for code outside React (a scan's targets). */
export const hideoutModules = () => current

export function useHideoutModules() {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** The modules open from the start and turned off in a mode, kept between renders while the setting stays. */
export function useModeModules(mode: RaidMode): ModeModuleSets {
  const setting = useHideoutModules()
  return useMemo(() => modeModules(setting, mode), [setting, mode])
}

/** For the tests: back to a fresh installation's state (what is stored is read again). */
export function reloadHideoutModulesForTests() {
  current = readStored()
  fingerprint = JSON.stringify(current)
  for (const listener of listeners) listener()
}
