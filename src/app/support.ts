import { isDesktopShell, isNative } from '../platform'

/** «Написать в Telegram» in «Чат с поддержкой»: the owner's Telegram (opens in the system browser: electron/main.ts setWindowOpenHandler → shell.openExternal). */
export const SUPPORT_TELEGRAM_URL = 'https://t.me/raidosapp'
/** «Поддержать проект» (owner, 13.10.2026): the donation page (components/DonateCard.tsx, the website's DonateCard). */
export const DONATE_URL = 'https://donatepay.ru/don/1537561'
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

/** The image files of a paste (Ctrl+V) or a drop: what the bug report and the support chat take from the clipboard. */
export function imageFilesOf(data: DataTransfer | null | undefined): File[] {
  return Array.from(data?.items ?? []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))
}
