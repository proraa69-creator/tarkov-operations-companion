import { tr } from '../i18n'
import { useEffect, useState } from 'react'
import { API_URL } from '../config'

/** The phone builds the server holds (server/src/routes/mobileDownloads.ts): null while unknown or none published. */
export interface MobileRelease { version: string; android?: { versionName: string; size: number }; iphone?: { size: number } }

export const ANDROID_DOWNLOAD_URL = `${API_URL}/v1/downloads/android`
export const IPHONE_DOWNLOAD_URL = `${API_URL}/v1/downloads/iphone`
/** The PDF guide that is also inside the iPhone archive (docs/mobile/iphone-guide.html). */
export const IPHONE_GUIDE_URL = '/guides/raid-os-iphone-install.pdf'

let cached: Promise<MobileRelease | null> | null = null

/** Read once per page load; a failed read counts as «nothing published». */
export function loadMobileRelease() {
  cached ??= fetch(`${API_URL}/v1/downloads/mobile.json`, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() as Promise<MobileRelease> : null))
    .catch(() => null)
  return cached
}

export function useMobileRelease() {
  const [release, setRelease] = useState<MobileRelease | null>(null)
  useEffect(() => {
    let active = true
    void loadMobileRelease().then((value) => { if (active) setRelease(value) })
    return () => { active = false }
  }, [])
  return release
}

/** «38 МБ» */
export function megabytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} ${tr('МБ')}`
}
