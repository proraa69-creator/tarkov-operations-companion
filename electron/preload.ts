import { contextBridge, ipcRenderer } from 'electron'
import type { LogParseResult } from '../src/import/logParser.js'

contextBridge.exposeInMainWorld('tarkovDesktop', {
  isDesktop: true,
  openWikiMap: (id: string) => ipcRenderer.invoke('maps:open-wiki', id),
  serviceRequest: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('service:request', method, path, body),
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    login: (email: string, password: string) => ipcRenderer.invoke('account:login', String(email), String(password)),
    logout: () => ipcRenderer.invoke('account:logout'),
    openWebsite: (page: 'register' | 'cabinet') => ipcRenderer.invoke('account:open-website', page === 'register' ? 'register' : 'cabinet'),
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
