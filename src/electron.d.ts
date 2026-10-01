import type { ModeLogScanResult } from './import/eftLogTimeline'
import type { RaidState } from './import/raidState'
import type { PlayerProfileSnapshot, RaidMode } from './domain/types'
import type { PlayerProfileCandidate } from './profile/playerProfileGateway'
import type { ExperimentalQuery, ExperimentalSettings, ExperimentalStatus, ItemOverlayPayload, MinimapPayload, ScreenshotCheck } from './overlay/types'
import type { PlayerPosition } from './overlay/screenshotPosition'

type DesktopLogScanResult = ModeLogScanResult

/** running: started by this app; external: something else already answers on the port (e.g. start-local.ps1). */
export type LocalServiceState = 'running' | 'external' | 'stopped' | 'error'
export interface LocalServerStatus { enabled: boolean; api: LocalServiceState; site: LocalServiceState; siteUrl: string; database: string; error?: string; /** Started with --server-mode (the server laptop). */ serverMode?: boolean }

export interface TunnelStatus { state: 'off' | 'downloading' | 'starting' | 'on' | 'error'; url?: string; error?: string; autoStart: boolean; hostname?: string }

/** Server watchdog (electron/serverWatchdog.ts): status lamps, journal and alerts in the owner's app. */
export type WatchdogServiceId = 'api' | 'site' | 'public' | 'database'
export type WatchdogLamp = 'green' | 'amber' | 'red' | 'grey'
export interface WatchdogService { id: WatchdogServiceId; lamp: WatchdogLamp; text: string; lastError?: string; checkedAt?: number; failures: number; attempts: number; nextRetryAt?: number }
export interface WatchdogEvent { at: number; service: WatchdogServiceId; level: 'info' | 'warn' | 'error'; text: string }
export interface WatchdogSnapshot { enabled: boolean; services: WatchdogService[]; events: WatchdogEvent[]; worst: WatchdogLamp; checkedAt?: number }
export interface WatchdogAlert { service: WatchdogServiceId; kind: 'down' | 'repaired' | 'recovered' | 'gave-up' | 'blocked'; title: string; body: string; at: number }

export interface ServerAccountStatus {
  signedIn: boolean
  email?: string
  kind?: 'user' | 'streamer'
  /** The API server answered /health. */
  online: boolean
  serverUrl: string
  /** false when the OS offers no secure storage: the session lasts until the app closes. */
  persistent: boolean
  /** From the server account while online: nicknames per mode and the subscription. */
  nicknames?: Partial<Record<RaidMode, string>>
  subscription?: { status: 'active' | 'trial' | 'inactive' | 'lifetime'; paidUntil?: string; trialEndsAt?: string }
  /** Verified phone number, masked by the server (+7 ••• •••-45-67). */
  phone?: string
  /** false while the e-mail is not confirmed («Подтвердите e-mail»); absent with an older server or app. */
  emailVerified?: boolean
}

/** «Войти в мобильную версию»: the QR link with a two-minute one-time code (electron/accountLinks.ts). */
export interface MobileLoginLink { url: string; expiresAt: string; reachable: boolean }

/** Auto-update from the server laptop's site (electron/appUpdate.ts). */
/** phase 'verifying': the download is complete and being checked; background: «Автоустановка» downloads by itself. */
export interface UpdateStatus { state: 'idle' | 'available' | 'downloading' | 'installing' | 'error'; version?: string; commit?: string; progress?: number; error?: string; ready?: boolean; phase?: 'verifying'; background?: boolean }
/** Settings → «Автообновление» / «Автоустановка» (userData/update-settings.json). */
export interface UpdateSettings { autoCheck: boolean; autoInstall: boolean }
/** Settings → «Проверить обновление приложения». */
export interface UpdateCheckResult { outcome: 'available' | 'latest' | 'offline' | 'unsigned' | 'no-server' | 'not-portable' | 'disabled' | 'busy'; status: UpdateStatus; current: string; checkedAt: string }

/** Owner controls for the server on this PC (electron/ownerAdmin.ts). */
export interface LavaSettings { offerId: string; currency: 'USD' | 'EUR'; rubRate: number; paymentMethod: '' | 'UNLIMINT' | 'PAYPAL' | 'STRIPE'; hasApiKey: boolean; hasWebhookKey: boolean }
/** `autopay`/`lava` are missing when the main process is older than the renderer. */
export interface PaymentSettings { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; hasKey: boolean; autopay?: boolean; lava?: LavaSettings }
/** «SMS: одноразовые коды» (electron/ownerAdmin.ts). The key is write-only. */
export type SmsProvider = '' | 'smsru' | 'smsc' | 'smsaero'
export interface SmsSettings { provider: SmsProvider; login: string; sender: string; dailyLimit: number; countries: string; hasKey: boolean; configured: boolean }
export interface SmsServerStatus { smsEnabled: boolean; provider: string | null; sentToday: number; dailyLimit: number }
/** «Почта: коды подтверждения» (electron/ownerAdmin.ts). The key is write-only. */
export type EmailProvider = '' | 'resend'
export interface EmailSettings { provider: EmailProvider; from: string; dailyLimit: number; hasKey: boolean; configured: boolean }
export interface EmailServerStatus { emailEnabled: boolean; provider: string | null; from: string | null; sentToday: number; dailyLimit: number }
export interface StreamerRow { email: string; code: string; stats: { visits: number; registrations: number; activeSubscriptions: number; revenue: { amount: number }; earnings: { amount: number } } }

interface TarkovDesktopApi {
  isDesktop: true
  /** 'owner': server, tunnel, payments and streamers controls; 'client' (default): the players' app. */
  edition?: 'owner' | 'client'
  /** The server laptop (owner build started with --server-mode): no catalog polling. */
  serverMode?: boolean
  owner?: {
    payments: () => Promise<PaymentSettings>
    setPayments: (settings:
      | { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; autopay?: boolean; secretKey?: string; clearKey?: boolean }
      | { section: 'lava'; offerId: string; currency: 'USD' | 'EUR'; rubRate: number; paymentMethod: LavaSettings['paymentMethod']; apiKey?: string; webhookKey?: string; clearKeys?: boolean }) => Promise<PaymentSettings>
    streamers: () => Promise<{ streamers: StreamerRow[]; invites: Array<{ code: string; expiresAt: string }> }>
    /** Missing when the main process is older than the renderer. */
    sms?: () => Promise<SmsSettings>
    setSms?: (settings: { provider: SmsProvider; login: string; sender: string; dailyLimit: number; countries: string; apiKey?: string; clearKey?: boolean }) => Promise<SmsSettings>
    smsStatus?: () => Promise<SmsServerStatus>
    sendTestSms?: (phone: string) => Promise<{ ok: boolean; provider: string; sentToday: number; dailyLimit: number }>
    email?: () => Promise<EmailSettings>
    setEmail?: (settings: { provider: EmailProvider; from: string; dailyLimit: number; apiKey?: string; clearKey?: boolean }) => Promise<EmailSettings>
    emailStatus?: () => Promise<EmailServerStatus>
    sendTestEmail?: (to: string) => Promise<{ ok: boolean; provider: string; sentToday: number; dailyLimit: number }>
    inviteStreamer: (code: string) => Promise<{ link: string; code: string; expiresAt: string }>
    /** «E-mail владельца»: accounts that see the owner section of the website (TARKOV_OWNER_EMAILS). */
    ownerEmails: () => Promise<string[]>
    setOwnerEmails: (emails: string) => Promise<string[]>
  }
  update?: {
    status: () => Promise<UpdateStatus>
    install: () => Promise<UpdateStatus>
    check?: () => Promise<UpdateCheckResult>
    settings?: () => Promise<UpdateSettings>
    setSettings?: (patch: Partial<UpdateSettings>) => Promise<UpdateSettings>
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
    /** Sign-in or password reset by phone after the SMS code; the session stays in the main process. */
    phoneSignIn?: (kind: 'login' | 'reset', challengeId: string, code: string, password?: string) => Promise<ServerAccountStatus>
    /** Sign-in or password reset by e-mail code; the session stays in the main process. */
    emailSignIn?: (kind: 'login' | 'reset', challengeId: string, code: string, password?: string) => Promise<ServerAccountStatus>
    openWebsite: (page: 'register' | 'cabinet' | 'admin') => Promise<boolean>
    /** «Сервер и сайт на этом компьютере»: the API and the website run from the app on this PC. */
    localServerStatus?: () => Promise<LocalServerStatus>
    setLocalServerEnabled?: (enabled: boolean) => Promise<LocalServerStatus>
    /** «Открыть сайт друзьям»: a public https link to this PC's site (Cloudflare quick tunnel). */
    tunnelStatus?: () => Promise<TunnelStatus>
    setTunnel?: (enabled: boolean) => Promise<TunnelStatus>
    /** Permanent address from the owner's Cloudflare account (hostname + tunnel token); empty values remove it. */
    setNamedTunnel?: (hostname: string, token: string) => Promise<TunnelStatus>
    /** Status lamps + journal of the server watchdog; «Перезапустить сейчас»; live updates and alerts. */
    watchdogStatus?: () => Promise<WatchdogSnapshot>
    watchdogCheck?: () => Promise<WatchdogSnapshot>
    restartService?: (service: 'api' | 'site' | 'public') => Promise<WatchdogSnapshot>
    onWatchdog?: (onStatus: (snapshot: WatchdogSnapshot) => void, onAlert: (alert: WatchdogAlert) => void) => () => void
    /** A one-time code for the phone app, as a website link for a QR code. */
    mobileLogin?: () => Promise<MobileLoginLink>
    /** The public address of the account website (for links a streamer shares). */
    websiteUrl?: () => Promise<string>
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
