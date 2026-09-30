import type { ModeLogScanResult } from './import/eftLogTimeline'
import type { RaidState } from './import/raidState'
import type { PlayerProfileSnapshot, RaidMode } from './domain/types'
import type { PlayerProfileCandidate } from './profile/playerProfileGateway'
import type { ExperimentalQuery, ExperimentalSettings, ExperimentalStatus, ItemOverlayPayload, MinimapPayload, ScreenshotCheck } from './overlay/types'
import type { PlayerPosition } from './overlay/screenshotPosition'

type DesktopLogScanResult = ModeLogScanResult

/** running: started by this app; external: something else already answers on the port (e.g. start-local.ps1). */
export type LocalServiceState = 'running' | 'external' | 'stopped' | 'error'
export interface LocalServerStatus { enabled: boolean; api: LocalServiceState; site: LocalServiceState; siteUrl: string; database: string; error?: string }

export interface TunnelStatus { state: 'off' | 'downloading' | 'starting' | 'on' | 'error'; url?: string; error?: string; autoStart: boolean; hostname?: string }

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

/** Auto-update from the server laptop's site (electron/appUpdate.ts). */
export interface UpdateStatus { state: 'idle' | 'available' | 'downloading' | 'installing' | 'error'; version?: string; commit?: string; progress?: number; error?: string }

interface TarkovDesktopApi {
  isDesktop: true
  update?: {
    status: () => Promise<UpdateStatus>
    install: () => Promise<UpdateStatus>
    onStatus: (callback: (status: UpdateStatus) => void) => () => void
  }
  openWikiMap: (id: string) => Promise<boolean>
  /** Whitelisted API server request. Resolves null for `/v1/me/*` while no server account is signed in. */
  serviceRequest: (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<unknown | null>
  /** Server account. The session token stays in the main process; only the e-mail and status reach the renderer. */
  account?: {
    status: () => Promise<ServerAccountStatus>
    login: (email: string, password: string) => Promise<ServerAccountStatus>
    logout: () => Promise<ServerAccountStatus>
    openWebsite: (page: 'register' | 'cabinet') => Promise<boolean>
    /** «Сервер и сайт на этом компьютере»: the API and the website run from the app on this PC. */
    localServerStatus?: () => Promise<LocalServerStatus>
    setLocalServerEnabled?: (enabled: boolean) => Promise<LocalServerStatus>
    /** «Открыть сайт друзьям»: a public https link to this PC's site (Cloudflare quick tunnel). */
    tunnelStatus?: () => Promise<TunnelStatus>
    setTunnel?: (enabled: boolean) => Promise<TunnelStatus>
    /** Permanent address from the owner's Cloudflare account (hostname + tunnel token); empty values remove it. */
    setNamedTunnel?: (hostname: string, token: string) => Promise<TunnelStatus>
    /** Another server address (e.g. the owner's public link); '' = this PC. */
    setServerUrl?: (url: string) => Promise<ServerAccountStatus>
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
    /** Folder, key, one real press with the game in front, the file and its coordinates. */
    checkScreenshots: () => Promise<ScreenshotCheck>
    /** Opens the folder with unrecognised item tooltips (picture + what was read). */
    openLookupLog?: () => Promise<boolean>
    onCheckProgress: (callback: (check: ScreenshotCheck) => void) => () => void
    /** Restarts the app with administrator rights; false when refused. */
    relaunchAsAdmin: () => Promise<boolean>
    /** Opens the Windows keyboard settings (the PrtSc / Snipping Tool switch). */
    openKeyboardSettings: () => Promise<boolean>
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
  /** Overlay windows only: a mouse button went down (true) or up (false) over a control; the window keeps the mouse meanwhile. */
  overlayHold?: (held: boolean) => void
  /** Overlay windows only: rectangles (window coordinates) that should catch the mouse. */
  overlayZones?: (zones: Array<{ x: number; y: number; width: number; height: number }>) => void
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
