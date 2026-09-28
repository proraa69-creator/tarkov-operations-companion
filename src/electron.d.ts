import type { ModeLogScanResult } from './import/eftLogTimeline'
import type { RaidState } from './import/raidState'
import type { PlayerProfileSnapshot, RaidMode } from './domain/types'
import type { PlayerProfileCandidate } from './profile/playerProfileGateway'
import type { ExperimentalQuery, ExperimentalSettings, ExperimentalStatus, ItemOverlayPayload, MinimapPayload } from './overlay/types'
import type { PlayerPosition } from './overlay/screenshotPosition'

type DesktopLogScanResult = ModeLogScanResult

interface TarkovDesktopApi {
  isDesktop: true
  openWikiMap: (id: string) => Promise<boolean>
  serviceRequest: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown | null>
  autoFindAndScanLogs: () => Promise<(DesktopLogScanResult & { folder: string }) | null>
  scanLogs: () => Promise<(DesktopLogScanResult & { folder: string }) | null>
  startWatchingLogs: (folder: string) => Promise<boolean>
  clearApplicationData: () => Promise<boolean>
  onLogsUpdated: (callback: (result: DesktopLogScanResult) => void) => () => void
  getRaidState: () => Promise<RaidState>
  onRaidStateChanged: (callback: (state: RaidState) => void) => () => void
  saveProfileBackup: (json: string) => Promise<boolean>
  openProfileBackup: () => Promise<string | null>
  getVersion: () => Promise<string>
  resolvePlayerProfile: (mode: RaidMode, nickname: string) => Promise<PlayerProfileCandidate>
  refreshPlayerProfile: (mode: RaidMode, accountId: number) => Promise<PlayerProfileSnapshot>
  captureQuestFrame: (watch?: boolean, detail?: boolean) => Promise<{ text: string; sourceName: string; gameWindow: boolean; storedFrames?: number }>
  recognizeQuestPng: (image: string) => Promise<{ text: string; sourceName: string; gameWindow?: boolean; storedFrames?: number }>
  experimental?: {
    getSettings: () => Promise<ExperimentalSettings>
    updateSettings: (patch: Partial<ExperimentalSettings>) => Promise<ExperimentalSettings>
    getStatus: () => Promise<ExperimentalStatus>
    toggleMinimap: () => Promise<boolean>
    testItemLookup: () => Promise<unknown>
    answer: (id: number, payload: unknown) => Promise<void>
    onQuery: (callback: (query: ExperimentalQuery) => void) => () => void
    onPosition: (callback: (position: PlayerPosition) => void) => () => void
  }
  onOverlay?: {
    (channel: 'overlay:item', callback: (payload: ItemOverlayPayload) => void): () => void
    (channel: 'overlay:minimap', callback: (payload: MinimapPayload) => void): () => void
    (channel: 'overlay:position', callback: (payload: PlayerPosition | null) => void): () => void
  }
}

declare global {
  interface Window {
    tarkovDesktop?: TarkovDesktopApi
  }
}

export {}
