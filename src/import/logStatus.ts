import { useSyncExternalStore } from 'react'
import type { ModeLogScanResult } from './eftLogTimeline'

/**
 * The latest scan of the game's logs and the Logs folder it came from — kept by AppShell, shown in Settings → «Журналы
 * игры» (owner, 13.10.2026: a Steam player's logs were «still not found» and nothing in the app said what was read).
 */
export interface LogStatus {
  folder?: string
  scan?: ModeLogScanResult
  /** The automatic search found no Logs folder. */
  notFound?: boolean
}

let status: LogStatus = {}
const listeners = new Set<() => void>()

export function updateLogStatus(next: Partial<LogStatus>) {
  status = { ...status, ...next }
  for (const listener of listeners) listener()
}

export function useLogStatus() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => status)
}
