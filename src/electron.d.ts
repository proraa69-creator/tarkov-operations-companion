import type { ModeLogScanResult } from './import/eftLogTimeline'
import type { RaidState } from './import/raidState'
import type { PlayerProfileSnapshot, RaidMode } from './domain/types'
import type { PlayerProfileCandidate } from './profile/playerProfileGateway'
import type { ExperimentalQuery, ExperimentalSettings, ExperimentalStatus, ItemOverlayPayload, ScreenshotCheck } from './overlay/types'
import type { PlayerPosition } from './overlay/screenshotPosition'
import type { StoryPaneReading } from './import/storyPaneLayout'
import type { ModeSelectCard, TraderScreenReading } from './import/modeSelectScreen'
import type { LogSearchReport } from './import/logSearchReport'

type DesktopLogScanResult = ModeLogScanResult
/** A scan of the game's Logs folder and that folder. */
export type DesktopLogScan = DesktopLogScanResult & { folder: string }

/** running: started by this app; external: something else already answers on the port (e.g. start-local.ps1). */
export type LocalServiceState = 'running' | 'external' | 'stopped' | 'error'
export interface LocalServerStatus { enabled: boolean; api: LocalServiceState; site: LocalServiceState; siteUrl: string; database: string; error?: string; /** Started with --server-mode (the server laptop). */ serverMode?: boolean }

export interface TunnelStatus { state: 'off' | 'downloading' | 'starting' | 'on' | 'error'; url?: string; error?: string; autoStart: boolean; hostname?: string }

/** Server watchdog (electron/serverWatchdog.ts): status lamps, journal and alerts in the owner's app. */
export type WatchdogServiceId = 'api' | 'site' | 'public' | 'database' | 'security'
export type WatchdogLamp = 'green' | 'amber' | 'red' | 'grey'
export interface WatchdogService { id: WatchdogServiceId; lamp: WatchdogLamp; text: string; lastError?: string; checkedAt?: number; failures: number; attempts: number; nextRetryAt?: number }
export interface WatchdogEvent { at: number; service: WatchdogServiceId; level: 'info' | 'warn' | 'error'; text: string }
export interface WatchdogSnapshot { enabled: boolean; services: WatchdogService[]; events: WatchdogEvent[]; worst: WatchdogLamp; checkedAt?: number }
export interface WatchdogAlert { service: WatchdogServiceId; kind: 'down' | 'repaired' | 'recovered' | 'gave-up' | 'blocked' | 'guard'; title: string; body: string; at: number }

/** POST /v1/accounts/register while the server sends e-mail codes: no account yet, the code from the e-mail follows. */
export interface PendingServerRegistration { challengeId: string; expiresAt: string; resendSeconds: number; message: string }
export type ServerRegistrationResult = { pending: PendingServerRegistration; status?: undefined } | { pending?: undefined; status: ServerAccountStatus; referralApplied: boolean }

export interface ServerAccountStatus {
  signedIn: boolean
  email?: string
  kind?: 'user' | 'streamer'
  /** The server-verified owner account may open the mobile admin dashboard. */
  owner?: true
  /** The API server answered /health. */
  online: boolean
  serverUrl: string
  /** false when the OS offers no secure storage: the session lasts until the app closes. */
  persistent: boolean
  /** From the server account while online: nicknames per mode and the subscription. */
  nicknames?: Partial<Record<RaidMode, string>>
  /** `trialPendingDays`: the free period still waits for the account's first sign-in in an app (server, accountStore.ts). */
  subscription?: { status: 'active' | 'trial' | 'inactive' | 'lifetime'; paidUntil?: string; trialEndsAt?: string; trialPendingDays?: number }
  /** When the account was registered (server, ISO): the first-run guide is for new accounts (src/onboarding/). */
  createdAt?: string
  /** Verified phone number, masked by the server (+7 ••• •••-45-67). */
  phone?: string
  /** false while the e-mail is not confirmed («Подтвердите e-mail»); absent with an older server or app. */
  emailVerified?: boolean
  /** «Удалить аккаунт» was requested: the server deletes the account at this time unless cancelled (iPhone app, ISO). */
  deletionAt?: string
  /** Signed entitlement of this device (electron/entitlement.ts): the players' app shows the paywall without it. */
  entitlement?: EntitlementView
}

/** Why the players' app has no access right now (docs/subscription-protection.md). */
export type EntitlementReason = 'signed-out' | 'subscription' | 'device-revoked' | 'device-inactive' | 'eft-conflict' | 'expired' | 'clock' | 'key-mismatch' | 'no-key' | 'unavailable'
/** One Escape from Tarkov account — one Raid OS account (electron/entitlement.ts EftConflict). */
export interface EftConflict { conflict: 'in-use' | 'other-account'; seen?: string; bound?: string }
export interface EntitlementView {
  valid: boolean
  plan?: 'owner' | 'streamer' | 'paid' | 'trial'
  expiresAt?: string
  until?: string
  reason?: EntitlementReason
  /** Devices this sign-in switched off (three-device limit): shown once. */
  revokedDevices?: Array<{ name: string; lastSeenAt: string }>
  message?: string
  /** What the one-to-one game account rule refused (reason `eft-conflict`). */
  eft?: EftConflict
}

/** «Войти в мобильную версию»: the QR link with a two-minute one-time code (electron/accountLinks.ts). */
export interface MobileLoginLink { url: string; expiresAt: string; reachable: boolean }

/** Auto-update from the server laptop's site (electron/appUpdate.ts). */
/** phase 'verifying': the download is complete and being checked; background: «Автоустановка» downloads by itself. */
/**
 * ownerExe: the owner's copy, a release only a whole owner exe brings and no signed owner exe on the server (the fallback:
 * the admin panel, «Серверная версия»). With a signed one it is a normal update installed in the app. nextStart: downloaded
 * in the background, starts with the next launch. liveVersion: the window was switched to this version without a restart
 * (live update of the interface, electron/appUpdate.ts); the page says so once.
 */
export interface UpdateStatus { state: 'idle' | 'available' | 'downloading' | 'installing' | 'error'; version?: string; commit?: string; progress?: number; error?: string; ready?: boolean; phase?: 'verifying'; background?: boolean; notify?: boolean; blockedByRaid?: boolean; ownerExe?: boolean; nextStart?: boolean; liveVersion?: string }
/** Settings → «Автообновление» / «Автоустановка» (userData/update-settings.json). */
export interface UpdateSettings { autoCheck: boolean; autoInstall: boolean }
/** Settings → «Проверить обновление приложения». */
export interface UpdateCheckResult { outcome: 'available' | 'latest' | 'offline' | 'unsigned' | 'no-server' | 'not-portable' | 'disabled' | 'busy' | 'owner-exe'; status: UpdateStatus; current: string; checkedAt: string }

/** Owner controls for the server on this PC (electron/ownerAdmin.ts). `autopay` is missing when the main process is older than the renderer. */
export interface PaymentSettings { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; hasKey: boolean; autopay?: boolean }
/** «SMS: одноразовые коды» (electron/ownerAdmin.ts). The key is write-only. */
export type SmsProvider = '' | 'smsru' | 'smsc' | 'smsaero'
export interface SmsSettings { provider: SmsProvider; login: string; sender: string; dailyLimit: number; countries: string; hasKey: boolean; configured: boolean }
export interface SmsServerStatus { smsEnabled: boolean; provider: string | null; sentToday: number; dailyLimit: number }
/** «Почта: коды подтверждения» (electron/ownerAdmin.ts). The key is write-only. */
export type EmailProvider = '' | 'resend'
export interface EmailSettings { provider: EmailProvider; from: string; dailyLimit: number; hasKey: boolean; configured: boolean }
export interface EmailServerStatus { emailEnabled: boolean; provider: string | null; from: string | null; sentToday: number; dailyLimit: number }
/** «Отчёты об ошибках (GitHub)» (electron/errorReporter.ts). The token is write-only. */
export interface ErrorReportSettings { enabled: boolean; repo: string; hasToken: boolean; pending: number; lastResult?: { at: string; ok: boolean; text: string } }
/** «Автообновление сервера» (electron/selfUpdate.ts, electron/serverSelfUpdate.ts). The token is write-only. */
export interface ServerBuildRef { version: string; build: number; commit: string }
export interface ServerUpdateFile { name: string; size: number; done: number; state: 'pending' | 'downloading' | 'ok' | 'error' }
export interface ServerUpdateHistoryEntry { at: string; kind: 'update' | 'rollback'; from: ServerBuildRef; to: ServerBuildRef; result: 'ok' | 'rolled-back' | 'failed'; reason?: string; code?: string; log?: string }
export type ServerInstallWindow = 'manual' | 'any' | 'night'
export interface ServerUpdateView {
  enabled: boolean; repo: string; window: ServerInstallWindow; hasToken: boolean
  unsupported: string
  current: ServerBuildRef
  previous: (ServerBuildRef & { savedAt: string }) | null
  updater: { phase: 'off' | 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'; message: string; checkedAt?: string; latest?: ServerBuildRef; files: ServerUpdateFile[]; checks: Array<{ label: string; ok: boolean; detail?: string }>; error?: string; waitingForWindow?: boolean; waitingForInstall?: boolean }
  ready: ServerBuildRef | null
  restart: { kind: 'update' | 'rollback'; from: ServerBuildRef; to: ServerBuildRef; startedAt: string; deadlineAt: string; phase: string } | null
  history: ServerUpdateHistoryEntry[]
  skipped: number[]
  nextCheckAt?: string
}
export interface StreamerRow { email: string; code: string; stats: { visits: number; registrations: number; activeSubscriptions: number; revenue: { amount: number }; earnings: { amount: number } } }

/** electron/logWatcher.ts LogWatchState: `changedAt` — when a scan last changed anything (ms). */
export interface LogWatchState { folder: string; mode: 'watch' | 'poll' | 'none'; changedAt?: number }

interface TarkovDesktopApi {
  isDesktop: true
  /** 'owner': server, tunnel, payments and streamers controls; 'client' (default): the players' app. */
  edition?: 'owner' | 'client'
  /** The server laptop (owner build started with --server-mode): no catalog polling. */
  serverMode?: boolean
  /** true: game data only through the server with a subscription (src/data/tarkovApi.ts). Missing in older builds. */
  dataGateway?: boolean
  /** Encrypted cache of the paid game data (electron/gameDataCache.ts). Missing in older builds. */
  dataCache?: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string, maxAgeMs: number) => Promise<boolean>
  }
  owner?: {
    payments: () => Promise<PaymentSettings>
    setPayments: (settings: { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; autopay?: boolean; secretKey?: string; clearKey?: boolean }) => Promise<PaymentSettings>
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
    /** Missing when the main process is older than the renderer. */
    errorReports?: () => Promise<ErrorReportSettings>
    setErrorReports?: (settings: { enabled?: boolean; repo?: string; token?: string; clearToken?: boolean }) => Promise<ErrorReportSettings>
    testErrorReports?: () => Promise<ErrorReportSettings>
    serverUpdate?: () => Promise<ServerUpdateView>
    setServerUpdate?: (settings: { enabled?: boolean; repo?: string; window?: ServerInstallWindow; token?: string; clearToken?: boolean }) => Promise<ServerUpdateView>
    checkServerUpdate?: () => Promise<ServerUpdateView>
    installServerUpdate?: () => Promise<ServerUpdateView>
    rollbackServerUpdate?: () => Promise<ServerUpdateView>
  }
  update?: {
    status: () => Promise<UpdateStatus>
    install: () => Promise<UpdateStatus>
    check?: () => Promise<UpdateCheckResult>
    settings?: () => Promise<UpdateSettings>
    setSettings?: (patch: Partial<UpdateSettings>) => Promise<UpdateSettings>
    onStatus: (callback: (status: UpdateStatus) => void) => () => void
  }
  /** Whitelisted API server request. Resolves null for `/v1/me/*` while no server account is signed in. */
  serviceRequest: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<unknown | null>
  /** Server account. The session token stays in the main process; only the e-mail and status reach the renderer. */
  account?: {
    status: () => Promise<ServerAccountStatus>
    login: (email: string, password: string) => Promise<ServerAccountStatus>
    logout: () => Promise<ServerAccountStatus>
    /** Sign-in or password reset by phone after the SMS code; the session stays in the main process. */
    phoneSignIn?: (kind: 'login' | 'reset', challengeId: string, code: string, password?: string) => Promise<ServerAccountStatus>
    /** Sign-in or password reset by e-mail code; the session stays in the main process. */
    emailSignIn?: (kind: 'login' | 'reset', challengeId: string, code: string, password?: string) => Promise<ServerAccountStatus>
    /**
     * Registration in the app: 202 with e-mail codes on (then registerConfirm), else a session right away (main process).
     * `country`: ISO 3166-1 alpha-2 from the form (src/shared/countries.ts); apps before 13.10.2026 sent none.
     */
    register?: (email: string, password: string, referralCode?: string, country?: string) => Promise<ServerRegistrationResult>
    /** The code from the registration e-mail: the account appears and is signed in (the session stays in the main process). */
    registerConfirm?: (challengeId: string, code: string) => Promise<{ status: ServerAccountStatus; referralApplied: boolean }>
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
  /** `current`: the folder used last; the Logs folder where the game started last is scanned (it or one found). */
  autoFindAndScanLogs: (current?: string) => Promise<(DesktopLogScanResult & { folder: string }) | null>
  scanLogs: () => Promise<(DesktopLogScanResult & { folder: string }) | null>
  /** «Где искали журналы»: every place the app looked for the game's logs (electron/logDiscovery.ts). */
  logSearchReport?: () => Promise<LogSearchReport>
  startWatchingLogs: (folder: string) => Promise<boolean>
  /** The catalog's trader quest ids of a mode (src/import/eftLogTimeline.ts traderQuestIdsForResets): only these reveal a reset. */
  setLogQuestIds?: (mode: RaidMode, ids: string[]) => Promise<boolean>
  clearApplicationData: () => Promise<boolean>
  onLogsUpdated: (callback: (result: DesktopLogScanResult) => void) => () => void
  /** How the main process follows the Logs folder: a watch, polling only, or nothing (electron/logWatcher.ts). */
  onLogWatchState?: (callback: (state: LogWatchState) => void) => () => void
  getLogWatchState?: () => Promise<LogWatchState>
  getRaidState: () => Promise<RaidState>
  onRaidStateChanged: (callback: (state: RaidState) => void) => () => void
  saveProfileBackup: (json: string) => Promise<boolean>
  openProfileBackup: () => Promise<string | null>
  getVersion: () => Promise<string>
  /** A system notification (trader restock reminders); false when the OS does not support them. */
  notify?: (title: string, body: string) => Promise<boolean>
  resolvePlayerProfile: (mode: RaidMode, nickname: string) => Promise<PlayerProfileCandidate>
  refreshPlayerProfile: (mode: RaidMode, accountId: number) => Promise<PlayerProfileSnapshot>
  /** `story`: the story pane read part by part (title, status, objectives) — see src/import/storyPaneLayout.ts. */
  /** `profiles`: the game's «Выбор профиля и режима» cards two readings agree on (src/import/modeSelectScreen.ts). */
  /**
   * One look at the game for the quest scanner (electron/screenOcr.ts). `raid`: a raid is likely (electron/experimental/raidSignals.ts),
   * nothing was copied. `busy`: an item lookup or a Kappa scan runs (electron/ocrQueue.ts), nothing was copied. `freshGame`: the
   * game window came moments ago (the quick pace of a game start, src/import/storyScanTiming.ts).
   */
  captureQuestFrame: (watch?: boolean, detail?: boolean) => Promise<{ text: string; sourceName: string; gameWindow: boolean; storedFrames?: number; observedAt?: number; story?: StoryPaneReading; profiles?: ModeSelectCard[]; trader?: TraderScreenReading; raid?: boolean; busy?: boolean; freshGame?: boolean; gameSince?: number }>
  captureQuestScreenshot?: (after: number) => Promise<{ text: string; sourceName: string; gameWindow: boolean; observedAt: number; story?: StoryPaneReading } | null>
  /**
   * The locked app's identity reader (electron/screenOcr.ts captureIdentityFrame): only right after a new game window
   * (`freshGame`) is the screen copied, and only the mode selection (`profiles`) and the traders' screen (`trader`) read.
   * `gameSince`: when this game window was first seen — a new value is a new game start.
   */
  captureIdentityFrame?: () => Promise<{ text: string; sourceName: string; gameWindow: boolean; observedAt?: number; profiles?: ModeSelectCard[]; trader?: TraderScreenReading; raid?: boolean; busy?: boolean; freshGame?: boolean; gameSince?: number }>
  /** Whole-screen OCR for the Collector checklist (stash / inventory). */
  /** The Collector scan (electron/collectorScan.ts): the labels of one game frame not read yet in this scan. */
  scanScreenText?: (options?: { restart?: boolean; names?: string[] }) => Promise<{ text: string; gameWindow: boolean; waiting?: boolean; labels?: number; read?: number; pending?: number }>
  experimental?: {
    getSettings: () => Promise<ExperimentalSettings>
    updateSettings: (patch: Partial<ExperimentalSettings>) => Promise<ExperimentalSettings>
    getStatus: () => Promise<ExperimentalStatus>
    pickScreenshotsFolder: () => Promise<ExperimentalSettings>
    testItemLookup: () => Promise<unknown>
    /** Folder, key, one real press with the game in front, the file and its coordinates. */
    checkScreenshots: () => Promise<ScreenshotCheck>
    /** Opens the folder with unrecognised item tooltips (picture + what was read). */
    openLookupLog?: () => Promise<boolean>
    onCheckProgress: (callback: (check: ScreenshotCheck) => void) => () => void
    /** Restarts the app with administrator rights; false when refused. */
    relaunchAsAdmin: () => Promise<boolean>
    /** The owner's position-tracking switch for every app as the server answered (src/announcement/features.ts); resolves to whether the tracking is on now. Absent in apps before 14.10.2026. */
    setRemoteMinimap?: (enabled: boolean) => Promise<boolean>
    answer: (id: number, payload: unknown) => Promise<void>
    onQuery: (callback: (query: ExperimentalQuery) => void) => () => void
    /** A new position from the game's screenshot; null: the tracking went off (the dot goes from the maps). */
    onPosition: (callback: (position: PlayerPosition | null) => void) => () => void
    /**
     * The item key's lookup (electron/experimental/index.ts): «reading…», the card or «not recognised». Shown on «Карты»
     * under «Вид»; nothing is drawn over the game. Absent in apps before 15.10.2026.
     */
    onItem?: (callback: (payload: ItemOverlayPayload) => void) => () => void
    onCollectorScan: (callback: () => void) => () => void
  }
}

declare global {
  interface Window {
    tarkovDesktop?: TarkovDesktopApi
  }
}

export {}
