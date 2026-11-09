/**
 * «Вышла новая версия» in the iPhone app (owner, 28.10.2026: «в приложении на iPhone добавь уведомление, что вышло новое
 * обновление… вы можете на сайте скачать новую версию»). At start, and back from the background after half a day, it reads
 * https://raidos.app/v1/downloads/mobile.json and, when there is a newer iPhone version than this one, the app shows the
 * notice on top (IphoneUpdateBanner.tsx) and «Вышла новая версия приложения» in «Обновление» (news/NewsButton.tsx) with
 * «Обновить».
 *
 * Where «Обновить» leads is the server's switch (owner, 09.11.2026: «мы просто поменяем ссылку, и будет перекидывать без
 * обновления приложения. На App Store»; server/src/services/iphoneStore.ts): `iphone.url` — the App Store page — when it is
 * on, else the site's download page. The App Store build compares itself with `iphone.storeVersion` (the App Store's
 * newest) and says nothing while the switch is off; the build from the site compares itself with that version too once the
 * switch is on, else with the site's.
 */
import { App } from '@capacitor/app'
import { useSyncExternalStore } from 'react'
import { version as packageVersion } from '../../package.json'
import { APP_STORE_BUILD, isIosApp } from '../platform'

export const MOBILE_RELEASE_URL = 'https://raidos.app/v1/downloads/mobile.json'
export const IPHONE_DOWNLOAD_PAGE = 'https://raidos.app/download'
const APP_STORE_URL = /^https:\/\/apps\.apple\.com\/[A-Za-z0-9/_\-.%?=&]{1,300}$/
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

export interface IphoneRelease { version: string; url: string }

/**
 * The newer iPhone version from mobile.json and where «Обновить» leads; null when there is none or it is not newer than
 * `current`. `appStoreBuild`: this app came from the App Store.
 */
export function newerIphoneRelease(body: unknown, current: string, appStoreBuild = false): IphoneRelease | null {
  const release = body && typeof body === 'object' ? body as { version?: unknown; iphone?: unknown } : {}
  const iphone = release.iphone && typeof release.iphone === 'object' ? release.iphone as { url?: unknown; storeVersion?: unknown } : null
  if (!iphone) return null
  const store = typeof iphone.url === 'string' && APP_STORE_URL.test(iphone.url) ? iphone.url : null
  const storeVersion = store && typeof iphone.storeVersion === 'string' ? iphone.storeVersion : null
  const version = appStoreBuild ? storeVersion : storeVersion ?? (typeof release.version === 'string' ? release.version : null)
  if (!version || compareVersions(version, current) <= 0) return null
  return { version, url: store ?? IPHONE_DOWNLOAD_PAGE }
}

interface IphoneUpdateState { available: string | null; url: string; dismissed: string | null }

let state: IphoneUpdateState = { available: null, url: IPHONE_DOWNLOAD_PAGE, dismissed: readDismissed() }
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

export async function checkIphoneUpdate(fetcher: typeof fetch = fetch, current = packageVersion, appStoreBuild = APP_STORE_BUILD) {
  checkedAt = Date.now()
  try {
    const response = await fetcher(MOBILE_RELEASE_URL, { cache: 'no-store' })
    if (!response.ok) return
    const release = newerIphoneRelease(await response.json(), current, appStoreBuild)
    set({ available: release?.version ?? null, url: release?.url ?? IPHONE_DOWNLOAD_PAGE })
  } catch { /* offline: the next start checks again */ }
}

/** Every iPhone app: the one from the site, and the App Store one once the switch names the App Store's version. */
export const iphoneUpdatesShown = () => isIosApp()

export function startIphoneUpdates() {
  if (started || !iphoneUpdatesShown()) return
  started = true
  void checkIphoneUpdate()
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && Date.now() - checkedAt > RECHECK_AFTER_MS) void checkIphoneUpdate()
  }).catch(() => {})
}

/** The cross on the notice: hidden for this version until a newer one («Обновление» keeps its line until the update). */
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
  state = { available: null, url: IPHONE_DOWNLOAD_PAGE, dismissed: null }
  started = false
}
