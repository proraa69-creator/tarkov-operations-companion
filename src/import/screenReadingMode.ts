import type { RaidMode } from '../domain/types'
import type { LogStatus } from './logStatus'

/** Where the log reader (src/app/AppShell.tsx) keeps the game's mode for this session. */
const DETECTED_MODE_KEY = 'eft-last-detected-mode'

/** The game's mode its logs reported last: the latest log scan's, else the one kept for this session; undefined: none yet. */
export function logsGameMode(status: Pick<LogStatus, 'scan'>): RaidMode | undefined {
  const scanned = status.scan?.latestMode
  if (scanned) return scanned
  let kept: string | null = null
  try { kept = sessionStorage.getItem(DETECTED_MODE_KEY) } catch { /* storage unavailable */ }
  return kept === 'pvp' || kept === 'pve' || kept === 'seasonal' ? kept : undefined
}

/**
 * The mode Tasks-table and story readings go to (audit P12, P5e): the mode the game is in, as its logs say — never the
 * mode the app shows, which the player may switch to look around (that is a view change only). While the logs have not
 * named the game's mode yet but a Logs folder may exist (the search still runs, or found one), null: the readings are
 * held, not applied to the app's mode, which after a restart is simply the one shown last. Only when no Logs folder was
 * found at all is the app's mode the best there is, as before.
 */
export function screenReadingMode(status: Pick<LogStatus, 'scan' | 'notFound'>, appMode: RaidMode): RaidMode | null {
  return logsGameMode(status) ?? (status.notFound ? appMode : null)
}
