/**
 * «Вышла новая версия» in the iPhone app (owner, 28.10.2026: «в приложении на iPhone добавь уведомление, что вышло новое
 * обновление… вы можете на сайте скачать новую версию»). The iPhone app from the site (the archive installed with
 * Sideloadly) cannot update itself: at start, and back from the background after half a day, it reads
 * https://raidos.app/v1/downloads/mobile.json and, when the site has a newer iPhone build than this one, shows a card
 * with a link to the site's download page. The App Store build never shows it: its updates come from the App Store.
 */
import { App } from '@capacitor/app'
import { useSyncExternalStore } from 'react'
import { version as packageVersion } from '../../package.json'
import { APP_STORE_BUILD, isIosApp } from '../platform'

export const MOBILE_RELEASE_URL = 'https://raidos.app/v1/downloads/mobile.json'
export const IPHONE_DOWNLOAD_PAGE = 'https://raidos.app/download'
const DISMISSED_KEY = 'raidos-iphone-update-dismissed-v1'
const RECHECK_AFTER_MS = 12 * 60 * 60 * 1000

/** «0.6.0-97» or «0.6.0.97» → [0, 6, 0, 97]. */
export const versionParts = (version: string) => version.split(/[.-]/).map((part) => Number.parseInt(part, 10)).map((part) => (Number.isFinite(part) ? part : 0))

/** Above 0: `a` is newer. */
export function compareVersions(a: string, b: string) {
  const left = versionParts(a), right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/** The site's newer iPhone build, from mobile.json; null when there is none or it is not newer than `current`. */
export function newerIphoneRelease(body: unknown, current: string): string | null {
  const release = body && typeof body === 'object' ? body as { version?: unknown; iphone?: unknown } : {}
  if (typeof release.version !== 'string' || !release.iphone) return null
  return compareVersions(release.version, current) > 0 ? release.version : null
}

interface IphoneUpdateState { available: string | null; dismissed: string | null }

let state: IphoneUpdateState = { available: null, dismissed: readDismissed() }
const listeners = new Set<() => void>()
let started = false
let checkedAt = 0

function readDismissed() {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(DISMISSED_KEY) } catch { return null }
}

function set(next: Partial<IphoneUpdateState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export async function checkIphoneUpdate(fetcher: typeof fetch = fetch, current = packageVersion) {
  checkedAt = Date.now()
  try {
    const response = await fetcher(MOBILE_RELEASE_URL, { cache: 'no-store' })
    if (!response.ok) return
    set({ available: newerIphoneRelease(await response.json(), current) })
  } catch { /* offline: the next start checks again */ }
}

/** The iPhone app from the site only. */
export const iphoneUpdatesShown = () => isIosApp() && !APP_STORE_BUILD

export function startIphoneUpdates() {
  if (started || !iphoneUpdatesShown()) return
  started = true
  void checkIphoneUpdate()
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && Date.now() - checkedAt > RECHECK_AFTER_MS) void checkIphoneUpdate()
  }).catch(() => {})
}

/** «Позже»: hidden for this version until a newer one. */
export function dismissIphoneUpdate() {
  if (!state.available) return
  try { localStorage.setItem(DISMISSED_KEY, state.available) } catch { /* only for this start */ }
  set({ dismissed: state.available })
}

export function useIphoneUpdate() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => state, () => state)
}

/** For tests. */
export function resetIphoneUpdate() {
  state = { available: null, dismissed: null }
  started = false
}
