import type { ModeLogScanResult } from './import/eftLogTimeline'
import type { RaidState } from './import/raidState'
import type { PlayerProfileSnapshot, RaidMode } from './domain/types'
import type { PlayerProfileCandidate } from './profile/playerProfileGateway'
import type { ExperimentalQuery, ExperimentalSettings, ExperimentalStatus, ItemOverlayPayload, MinimapPayload } from './overlay/types'
import type { PlayerPosition } from './overlay/screenshotPosition'

type DesktopLogScanResult = ModeLogScanResult

export interface ServerAccountStatus {
  signedIn: boolean
  email?: string
  kind?: 'user' | 'streamer'
  /** The API server answered /health. */
  online: boolean
  serverUrl: string
  /** false when the OS offers no secure storage: the session lasts until the app closes. */
  persistent: boolean
}

interface TarkovDesktopApi {
  isDesktop: true
  openWikiMap: (id: string) => Promise<boolean>
  /** Whitelisted API server request. Resolves null for `/v1/me/*` while no server account is signed in. */
  serviceRequest: (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<unknown | null>
  /** Server account. The session token stays in the main process; only the e-mail and status reach the renderer. */
  account?: {
    status: () => Promise<ServerAccountStatus>
    login: (email: string, password: string) => Promise<ServerAccountStatus>
    logout: () => Promise<ServerAccountStatus>
    openWebsite: (page: 'register' | 'cabinet') => Promise<boolean>
  }
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
  /** Whole-screen OCR for the Collector checklist (stash / inventory). */
  scanScreenText?: () => Promise<{ text: string; gameWindow: boolean }>
  recognizeQuestPng: (image: string) => Promise<{ text: string; sourceName: string; gameWindow?: boolean; storedFrames?: number }>
  experimental?: {
    getSettings: () => Promise<ExperimentalSettings>
    updateSettings: (patch: Partial<ExperimentalSettings>) => Promise<ExperimentalSettings>
    getStatus: () => Promise<ExperimentalStatus>
    toggleMinimap: () => Promise<boolean>
    pickScreenshotsFolder: () => Promise<ExperimentalSettings>
    testItemLookup: () => Promise<unknown>
    answer: (id: number, payload: unknown) => Promise<void>
    onQuery: (callback: (query: ExperimentalQuery) => void) => () => void
    onPosition: (callback: (position: PlayerPosition) => void) => () => void
    onCollectorScan: (callback: () => void) => () => void
  }
  /** Overlay windows only: let the mouse through (false) or catch it over controls (true). */
  overlaySetInteractive?: (value: boolean) => void
  /** Overlay windows only: fit the window to its content. */
  overlayResize?: (width: number, height: number) => void
  /** Overlay windows only: start (true) or finish (false) dragging the window with the mouse. */
  overlayDrag?: (active: boolean) => void
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
