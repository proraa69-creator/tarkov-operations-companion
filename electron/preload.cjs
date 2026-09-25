const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tarkovDesktop', {
  isDesktop: true,
  autoFindAndScanLogs: () => ipcRenderer.invoke('logs:auto-find-and-scan'),
  scanLogs: () => ipcRenderer.invoke('logs:select-and-scan'),
  startWatchingLogs: (folder) => ipcRenderer.invoke('logs:start-watching', folder),
  onLogsUpdated: (callback) => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('logs:updated', listener)
    return () => ipcRenderer.removeListener('logs:updated', listener)
  },
  saveProfileBackup: (json) => ipcRenderer.invoke('profile:save-backup', json),
  openProfileBackup: () => ipcRenderer.invoke('profile:open-backup'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  resolvePlayerProfile: (mode, nickname) => ipcRenderer.invoke('profile:resolve', mode, nickname),
  refreshPlayerProfile: (mode, accountId) => ipcRenderer.invoke('profile:refresh', mode, accountId),
})
