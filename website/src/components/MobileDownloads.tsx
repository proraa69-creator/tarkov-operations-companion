import type React from 'react'
import { tr } from '../i18n'
import { AndroidIcon, AppleIcon } from './Platforms'
import { ANDROID_DOWNLOAD_URL, IPHONE_DOWNLOAD_URL, mobileBuildReady, useMobileRelease } from './mobileRelease'

/**
 * The phone apps on the download page: the Android APK as one file (it updates itself from the site afterwards), the
 * iPhone archive with the app, the PDF guide and shortcuts to iTunes and Sideloadly. «Скоро» only when the server says it holds
 * no build (server/src/services/mobileDownloads.ts, mobileRelease.ts mobileBuildReady).
 */

/** One store-style badge: the platform's mark, a small line over the platform's name. */
function StoreBadge({ href, icon, small, label, ready }: { href: string; icon: React.ReactNode; small: string; label: string; ready: boolean }) {
  return (
    <a className={`store-badge${ready ? '' : ' is-soon'}`} href={ready ? href : undefined} aria-disabled={!ready} rel="noopener" download={ready || undefined}>
      <span className="store-badge-icon" aria-hidden="true">{icon}</span>
      <span className="store-badge-text"><small>{ready ? small : tr('Скоро')}</small><strong>{label}</strong></span>
    </a>
  )
}

/**
 * The two phone badges under the Windows button (owner, 19.10.2026: «красивые кнопки iOS и Android»), the only phone
 * buttons on the page (owner, 20.10.2026: «убери нижний раздел… скачать для Android, скачать для iPhone. Все»).
 */
export function MobileBadges() {
  const release = useMobileRelease()
  return (
    <div className="store-badges" aria-label={tr('Приложение для телефона')}>
      <StoreBadge href={ANDROID_DOWNLOAD_URL} icon={<AndroidIcon />} small={tr('Скачать для')} label="Android" ready={mobileBuildReady(release, 'android')} />
      <StoreBadge href={IPHONE_DOWNLOAD_URL} icon={<AppleIcon />} small={tr('Скачать для')} label="iPhone" ready={mobileBuildReady(release, 'iphone')} />
    </div>
  )
}
