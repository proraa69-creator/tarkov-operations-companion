import { contextBridge, ipcRenderer } from 'electron'
import type { LogParseResult } from '../src/import/logParser.js'

contextBridge.exposeInMainWorld('tarkovDesktop', {
  isDesktop: true,
  scanLogs: () => ipcRenderer.invoke('logs:select-and-scan') as Promise<(LogParseResult & { folder: string }) | null>,
  startWatchingLogs: (folder: string) => ipcRenderer.invoke('logs:start-watching', folder) as Promise<boolean>,
  onLogsUpdated: (callback: (result: LogParseResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: LogParseResult) => callback(result)
    ipcRenderer.on('logs:updated', listener)
    return () => ipcRenderer.removeListener('logs:updated', listener)
  },
  saveProfileBackup: (json: string) => ipcRenderer.invoke('profile:save-backup', json) as Promise<boolean>,
  openProfileBackup: () => ipcRenderer.invoke('profile:open-backup') as Promise<string | null>,
  getVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
})
