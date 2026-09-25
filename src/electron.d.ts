import type { LogParseResult } from './import/logParser'

interface TarkovDesktopApi {
  isDesktop: true
  autoFindAndScanLogs: () => Promise<(LogParseResult & { folder: string }) | null>
  scanLogs: () => Promise<(LogParseResult & { folder: string }) | null>
  startWatchingLogs: (folder: string) => Promise<boolean>
  onLogsUpdated: (callback: (result: LogParseResult) => void) => () => void
  saveProfileBackup: (json: string) => Promise<boolean>
  openProfileBackup: () => Promise<string | null>
  getVersion: () => Promise<string>
}

declare global {
  interface Window {
    tarkovDesktop?: TarkovDesktopApi
  }
}

export {}
