import type { LogParseResult } from './import/logParser'
import type { PlayerProfileSnapshot, RaidMode } from './domain/types'
import type { PlayerProfileCandidate } from './profile/playerProfileGateway'

interface DesktopLogScanResult extends LogParseResult {
  eventsByMode: Record<RaidMode, LogParseResult['events']>
  unresolvedEvents: LogParseResult['events']
  latestMode?: RaidMode
  latestAccountIdByMode: Partial<Record<RaidMode, number>>
}

interface TarkovDesktopApi {
  isDesktop: true
  autoFindAndScanLogs: () => Promise<(DesktopLogScanResult & { folder: string }) | null>
  scanLogs: () => Promise<(DesktopLogScanResult & { folder: string }) | null>
  startWatchingLogs: (folder: string) => Promise<boolean>
  onLogsUpdated: (callback: (result: DesktopLogScanResult) => void) => () => void
  saveProfileBackup: (json: string) => Promise<boolean>
  openProfileBackup: () => Promise<string | null>
  getVersion: () => Promise<string>
  resolvePlayerProfile: (mode: RaidMode, nickname: string) => Promise<PlayerProfileCandidate>
  refreshPlayerProfile: (mode: RaidMode, accountId: number) => Promise<PlayerProfileSnapshot>
}

declare global {
  interface Window {
    tarkovDesktop?: TarkovDesktopApi
  }
}

export {}
