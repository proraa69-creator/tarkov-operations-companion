import { contextBridge, ipcRenderer } from 'electron'
import type { LogParseResult } from '../src/import/logParser.js'

contextBridge.exposeInMainWorld('tarkovDesktop', {
  isDesktop: true,
  /** 'owner' | 'client' (electron/buildEdition.ts), fixed at build time. */
  edition: ipcRenderer.sendSync('app:edition') === 'owner' ? 'owner' : 'client',
  /** The server laptop (--server-mode in the owner build). */
  serverMode: ipcRenderer.sendSync('app:server-mode') === true,
  /** true: game data only through the server with a subscription (players' exe, docs/subscription-protection.md). */
  dataGateway: ipcRenderer.sendSync('app:data-gateway') === true,
  /** Paid game data cache, encrypted in the main process (electron/gameDataCache.ts); strings only. */
  dataCache: {
    get: (key: string) => ipcRenderer.invoke('data-cache:get', String(key)) as Promise<string | null>,
    set: (key: string, value: string, maxAgeMs: number) => ipcRenderer.invoke('data-cache:set', String(key), String(value), Number(maxAgeMs)) as Promise<boolean>,
  },
  openWikiMap: (id: string) => ipcRenderer.invoke('maps:open-wiki', id),
  serviceRequest: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('service:request', method, path, body),
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    login: (email: string, password: string) => ipcRenderer.invoke('account:login', String(email), String(password)),
    logout: () => ipcRenderer.invoke('account:logout'),
    phoneSignIn: (kind: 'login' | 'reset', challengeId: string, code: string, password?: string) => ipcRenderer.invoke('account:phone-sign-in', kind === 'reset' ? 'reset' : 'login', String(challengeId ?? ''), String(code ?? ''), password === undefined ? undefined : String(password)),
    emailSignIn: (kind: 'login' | 'reset', challengeId: string, code: string, password?: string) => ipcRenderer.invoke('account:email-sign-in', kind === 'reset' ? 'reset' : 'login', String(challengeId ?? ''), String(code ?? ''), password === undefined ? undefined : String(password)),
    register: (email: string, password: string, referralCode?: string) => ipcRenderer.invoke('account:register', String(email ?? ''), String(password ?? ''), referralCode === undefined ? undefined : String(referralCode)),
    registerConfirm: (challengeId: string, code: string) => ipcRenderer.invoke('account:register-confirm', String(challengeId ?? ''), String(code ?? '')),
    openWebsite: (page: 'register' | 'cabinet' | 'admin') => ipcRenderer.invoke('account:open-website', page === 'register' || page === 'admin' ? page : 'cabinet'),
    localServerStatus: () => ipcRenderer.invoke('local-server:status'),
    setLocalServerEnabled: (enabled: boolean) => ipcRenderer.invoke('local-server:set-enabled', Boolean(enabled)),
    tunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
    setTunnel: (enabled: boolean) => ipcRenderer.invoke('tunnel:set', Boolean(enabled)),
    setNamedTunnel: (hostname: string, token: string) => ipcRenderer.invoke('tunnel:set-named', String(hostname ?? ''), String(token ?? '')),
    watchdogStatus: () => ipcRenderer.invoke('server-watchdog:status'),
    watchdogCheck: () => ipcRenderer.invoke('server-watchdog:check'),
    restartService: (service: 'api' | 'site' | 'public') => ipcRenderer.invoke('server-watchdog:restart', String(service)),
    onWatchdog: (onStatus: (snapshot: unknown) => void, onAlert: (alert: unknown) => void) => {
      const status = (_event: unknown, snapshot: unknown) => onStatus(snapshot)
      const alert = (_event: unknown, payload: unknown) => onAlert(payload)
      ipcRenderer.on('server-watchdog:status', status)
      ipcRenderer.on('server-watchdog:alert', alert)
      return () => { ipcRenderer.removeListener('server-watchdog:status', status); ipcRenderer.removeListener('server-watchdog:alert', alert) }
    },
    mobileLogin: () => ipcRenderer.invoke('account:mobile-login'),
    websiteUrl: () => ipcRenderer.invoke('account:website-url'),
    setServerUrl: (url: string) => ipcRenderer.invoke('account:set-server-url', String(url ?? '')),
  },
  owner: {
    payments: () => ipcRenderer.invoke('owner:payments'),
    setPayments: (settings: unknown) => ipcRenderer.invoke('owner:set-payments', settings),
    streamers: () => ipcRenderer.invoke('owner:streamers'),
    sms: () => ipcRenderer.invoke('owner:sms'),
    setSms: (settings: unknown) => ipcRenderer.invoke('owner:set-sms', settings),
    smsStatus: () => ipcRenderer.invoke('owner:sms-status'),
    sendTestSms: (phone: string) => ipcRenderer.invoke('owner:sms-test', String(phone ?? '')),
    email: () => ipcRenderer.invoke('owner:email'),
    setEmail: (settings: unknown) => ipcRenderer.invoke('owner:set-email', settings),
    emailStatus: () => ipcRenderer.invoke('owner:email-status'),
    sendTestEmail: (to: string) => ipcRenderer.invoke('owner:email-test', String(to ?? '')),
    inviteStreamer: (code: string) => ipcRenderer.invoke('owner:invite-streamer', String(code ?? '')),
    ownerEmails: () => ipcRenderer.invoke('owner:emails'),
    setOwnerEmails: (emails: string) => ipcRenderer.invoke('owner:set-emails', String(emails ?? '')),
    errorReports: () => ipcRenderer.invoke('owner:error-reports'),
    setErrorReports: (settings: unknown) => ipcRenderer.invoke('owner:set-error-reports', settings),
    testErrorReports: () => ipcRenderer.invoke('owner:error-reports-test'),
    serverUpdate: () => ipcRenderer.invoke('owner:server-update'),
    setServerUpdate: (settings: unknown) => ipcRenderer.invoke('owner:set-server-update', settings),
    checkServerUpdate: () => ipcRenderer.invoke('owner:server-update-check'),
    installServerUpdate: () => ipcRenderer.invoke('owner:server-update-install'),
    rollbackServerUpdate: () => ipcRenderer.invoke('owner:server-update-rollback'),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    settings: () => ipcRenderer.invoke('update:settings'),
    setSettings: (patch: unknown) => ipcRenderer.invoke('update:set-settings', patch),
    onStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: unknown, status: unknown) => callback(status)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    },
  },
  autoFindAndScanLogs: () => ipcRenderer.invoke('logs:auto-find-and-scan') as Promise<(LogParseResult & { folder: string }) | null>,
  scanLogs: () => ipcRenderer.invoke('logs:select-and-scan') as Promise<(LogParseResult & { folder: string }) | null>,
  startWatchingLogs: (folder: string) => ipcRenderer.invoke('logs:start-watching', folder) as Promise<boolean>,
  clearApplicationData: () => ipcRenderer.invoke('app:clear-data') as Promise<boolean>,
  onLogsUpdated: (callback: (result: LogParseResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: LogParseResult) => callback(result)
    ipcRenderer.on('logs:updated', listener)
    return () => ipcRenderer.removeListener('logs:updated', listener)
  },
  saveProfileBackup: (json: string) => ipcRenderer.invoke('profile:save-backup', json) as Promise<boolean>,
  openProfileBackup: () => ipcRenderer.invoke('profile:open-backup') as Promise<string | null>,
  getVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', String(title ?? ''), String(body ?? '')) as Promise<boolean>,
  resolvePlayerProfile: (mode: string, nickname: string) => ipcRenderer.invoke('profile:resolve', mode, nickname),
  refreshPlayerProfile: (mode: string, accountId: number) => ipcRenderer.invoke('profile:refresh', mode, accountId),
  captureQuestFrame: (watch?: boolean, detail?: boolean) => ipcRenderer.invoke('quests:capture-frame', Boolean(watch), Boolean(detail)) as Promise<{ text: string; sourceName: string; gameWindow: boolean; storedFrames?: number }>,
  recognizeQuestPng: (image: string) => ipcRenderer.invoke('quests:recognize-png', image) as Promise<{ text: string; sourceName: string; gameWindow?: boolean; storedFrames?: number }>,
  experimental: {
    getSettings: () => ipcRenderer.invoke('experimental:get-settings'),
    updateSettings: (patch: unknown) => ipcRenderer.invoke('experimental:update-settings', patch),
    getStatus: () => ipcRenderer.invoke('experimental:status'),
    toggleMinimap: () => ipcRenderer.invoke('experimental:toggle-minimap'),
    testItemLookup: () => ipcRenderer.invoke('experimental:test-item'),
    checkScreenshots: () => ipcRenderer.invoke('experimental:check-screenshots'),
    openLookupLog: () => ipcRenderer.invoke('experimental:open-lookup-log'),
    onCheckProgress: (callback: (payload: unknown) => void) => subscribe('experimental:check-progress', callback),
    relaunchAsAdmin: () => ipcRenderer.invoke('experimental:relaunch-admin'),
    openKeyboardSettings: () => ipcRenderer.invoke('experimental:open-keyboard-settings'),
    answer: (id: number, payload: unknown) => ipcRenderer.invoke('experimental:answer', id, payload),
    onQuery: (callback: (payload: unknown) => void) => subscribe('experimental:query', callback),
    onPosition: (callback: (payload: unknown) => void) => subscribe('experimental:position', callback),
  },
  onOverlay: (channel: string, callback: (payload: unknown) => void) => {
    if (!['overlay:item', 'overlay:minimap', 'overlay:position'].includes(channel)) return () => {}
    const unsubscribe = subscribe(channel, callback)
    ipcRenderer.send('overlay:subscribe', channel)
    return unsubscribe
  },
})

function subscribe(channel: string, callback: (payload: unknown) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
