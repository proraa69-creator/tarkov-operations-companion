import { isDesktopShell, isNative } from '../platform'

/** «Связаться»: the owner's Telegram (opens in the system browser: electron/main.ts setWindowOpenHandler → shell.openExternal). */
export const SUPPORT_TELEGRAM_URL = 'https://t.me/raidosapp'
export const SUPPORT_TELEGRAM_HANDLE = '@raidosapp'

/** Same limits as the server (server/src/services/bugReportStore.ts). */
export const BUG_REPORT_LIMITS = { topic: 120, description: 5000, files: 5, fileBytes: 5 * 1024 * 1024 }
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** «Windows 10/11 x64 · desktop app»: what the report says about the system (from the user agent only). */
export function describePlatform(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  const android = /Android ([\d.]+)/.exec(ua)
  const os = /Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows' : android ? `Android ${android[1]}` : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS'
  const arch = /Win64|WOW64|x86_64|x64/.test(ua) ? ' x64' : /arm64|aarch64/i.test(ua) ? ' arm64' : ''
  const shell = isDesktopShell() ? 'desktop app' : isNative() ? 'phone app' : 'browser'
  return `${os}${arch} · ${shell}`
}
