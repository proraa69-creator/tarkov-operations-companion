import { useEffect, useSyncExternalStore } from 'react'
import type { ModeLogScanResult } from './eftLogTimeline'
import { LOG_FOLDER_STORAGE_KEY } from './logApply'
import type { LogWatchState } from '../electron.d'

/**
 * The latest scan of the game's logs and the Logs folder it came from. The main process reads the logs from the app's
 * start (electron/logWatcher.ts); this status follows it from its first reader on — the locked app's screen readers too —
 * so the game's mode is known here as soon as the identity of the newest launches is read (owner, 13.10.2026: a Steam
 * player's logs were «still not found» and nothing in the app said what was read).
 */
export interface LogStatus {
  folder?: string
  /** The latest scan published: the identity of the newest launches first (`identityOnly`), then every launch. */
  scan?: ModeLogScanResult
  /** The automatic search finished and found no Logs folder (until one is found later). */
  notFound?: boolean
  /** How the main process follows the folder now (electron/logWatcher.ts): watched, polled, or not at all. */
  watch?: LogWatchState
}

/** The game's mode the logs reported last, kept for this session (src/components/StoryScreenScanner.tsx reads it too). */
export const DETECTED_MODE_KEY = 'eft-last-detected-mode'

let status: LogStatus = {}
const listeners = new Set<() => void>()

export function updateLogStatus(next: Partial<LogStatus>) {
  status = { ...status, ...next }
  for (const listener of listeners) listener()
}

/** A scan the main process published (`logs:updated`): the status and the session's game mode follow at once. */
export function noteLogScan(scan: ModeLogScanResult & { folder?: string }) {
  updateLogStatus({ scan, notFound: false, ...(scan.folder ? { folder: scan.folder } : {}) })
  if (!scan.latestMode) return
  try { sessionStorage.setItem(DETECTED_MODE_KEY, scan.latestMode) } catch { /* storage unavailable */ }
}

let following = false

/**
 * Follows the desktop's log reading from now on, once per page: every scan it publishes, and once whether a Logs folder
 * was found at all (`notFound` only when its search finished with none; a folder found later clears it).
 */
export function followDesktopLogStatus() {
  const desktop = typeof window === 'undefined' ? undefined : window.tarkovDesktop
  if (following || !desktop?.onLogsUpdated || !desktop.autoFindAndScanLogs) return
  following = true
  desktop.onLogsUpdated(noteLogScan)
  // Constant tracking: the watch state from the start, and every change of it.
  desktop.onLogWatchState?.((watch) => updateLogStatus({ watch }))
  void desktop.getLogWatchState?.().then((watch) => { if (watch) updateLogStatus({ watch }) }).catch(() => {})
  let saved: string | undefined
  try { saved = localStorage.getItem(LOG_FOLDER_STORAGE_KEY) ?? undefined } catch { saved = undefined }
  void desktop.autoFindAndScanLogs(saved).then((found) => {
    if (found) updateLogStatus({ folder: found.folder, notFound: false })
    else if (!status.scan) updateLogStatus({ notFound: true })
  }).catch(() => {})
}

export function useLogStatus() {
  useEffect(() => followDesktopLogStatus(), [])
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => status)
}

export type TarkovEdition = 'steam' | 'launcher' | 'not-found'

/**
 * Which Escape from Tarkov the logs come from (owner, 13.10.2026, on the report window: «тут добавь внизу, какая версия
 * таркова, стим или не стим»): the Steam build writes them under <library>\steamapps\common\…, the BSG launcher's game
 * anywhere else. Null while nothing is known yet.
 */
export function tarkovEdition(folder: string | null | undefined, notFound = false): TarkovEdition | null {
  if (folder) return /[\\/]steamapps[\\/]/i.test(folder) ? 'steam' : 'launcher'
  return notFound ? 'not-found' : null
}

/** The edition of the logs this computer reads now, or of the folder kept from the last run. */
export function useTarkovEdition(savedFolder: () => string | null) {
  const status = useLogStatus()
  return tarkovEdition(status.folder ?? savedFolder(), Boolean(status.notFound))
}

/**
 * The line of the constant log tracking (owner, 15.10.2026: «сделай постоянное отслеживание журналов»): «Журналы:
 * отслеживаются · последнее событие HH:MM» — the newest thing the game logged in any mode (a mode line, a profile,
 * a quest). Null while no Logs folder is followed.
 */
export function logWatchLine(status: LogStatus, locale: 'ru' | 'en', formatTime: (ms: number) => string = clockTime): string | null {
  const watched = status.watch ? status.watch.mode !== 'none' : Boolean(status.folder && !status.notFound)
  if (!watched) return status.notFound ? (locale === 'en' ? 'Logs: not found' : 'Журналы: не найдены') : null
  const times = Object.values(status.scan?.summaryByMode ?? {}).map((summary) => Date.parse(summary?.lastActivityAt ?? '')).filter(Number.isFinite)
  const last = times.length ? Math.max(...times) : status.watch?.changedAt
  const head = locale === 'en' ? 'Logs: tracked' : 'Журналы: отслеживаются'
  if (!last) return head
  return `${head} · ${locale === 'en' ? 'last event' : 'последнее событие'} ${formatTime(last)}`
}

const clockTime = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
