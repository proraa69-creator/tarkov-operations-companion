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
