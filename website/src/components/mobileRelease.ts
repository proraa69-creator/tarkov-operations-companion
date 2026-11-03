import { useEffect, useState } from 'react'
import { API_URL } from '../config'

/** The phone builds the server holds (server/src/routes/mobileDownloads.ts). */
export interface MobileRelease { version: string; android?: { versionName: string; size: number }; iphone?: { size: number } }

/**
 * Whether a phone build can be downloaded: only a server that answered without it says «not yet». While the answer is
 * loading, or when it could not be read (a slow or filtered phone network), the button works — the file is there
 * (owner, 31.10.2026: a player saw «скоро на Android» while the APK was published).
 */
export const mobileBuildReady = (release: MobileRelease | null | undefined, platform: 'android' | 'iphone') =>
  release === undefined || Boolean(release?.[platform])

export const ANDROID_DOWNLOAD_URL = `${API_URL}/v1/downloads/android`
export const IPHONE_DOWNLOAD_URL = `${API_URL}/v1/downloads/iphone`

let cached: Promise<MobileRelease | null | undefined> | null = null

/** Read once per page load: the release, null when the server has none (404), undefined when it could not be read. */
export function loadMobileRelease() {
  cached ??= fetch(`${API_URL}/v1/downloads/mobile.json`, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() as Promise<MobileRelease> : response.status === 404 ? null : undefined))
    .catch(() => undefined)
  return cached
}

/** undefined while loading or unreadable (see mobileBuildReady). */
export function useMobileRelease() {
  const [release, setRelease] = useState<MobileRelease | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void loadMobileRelease().then((value) => { if (active) setRelease(value) })
    return () => { active = false }
  }, [])
  return release
}

