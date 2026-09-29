const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tarkovDesktop', {
  isDesktop: true,
  openWikiMap: (id) => ipcRenderer.invoke('maps:open-wiki', id),
  serviceRequest: (method, path, body) => ipcRenderer.invoke('service:request', method, path, body),
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    login: (email, password) => ipcRenderer.invoke('account:login', String(email), String(password)),
    logout: () => ipcRenderer.invoke('account:logout'),
    openWebsite: (page) => ipcRenderer.invoke('account:open-website', page === 'register' ? 'register' : 'cabinet'),
  },
  autoFindAndScanLogs: () => ipcRenderer.invoke('logs:auto-find-and-scan'),
  scanLogs: () => ipcRenderer.invoke('logs:select-and-scan'),
  startWatchingLogs: (folder) => ipcRenderer.invoke('logs:start-watching', folder),
  clearApplicationData: () => ipcRenderer.invoke('app:clear-data'),
  onLogsUpdated: (callback) => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('logs:updated', listener)
    return () => ipcRenderer.removeListener('logs:updated', listener)
  },
  getRaidState: () => ipcRenderer.invoke('game:get-raid-state'),
  onRaidStateChanged: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('game:raid-state', listener)
    return () => ipcRenderer.removeListener('game:raid-state', listener)
  },
  saveProfileBackup: (json) => ipcRenderer.invoke('profile:save-backup', json),
  openProfileBackup: () => ipcRenderer.invoke('profile:open-backup'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  resolvePlayerProfile: (mode, nickname) => ipcRenderer.invoke('profile:resolve', mode, nickname),
  refreshPlayerProfile: (mode, accountId) => ipcRenderer.invoke('profile:refresh', mode, accountId),
  captureQuestFrame: (watch, detail) => ipcRenderer.invoke('quests:capture-frame', Boolean(watch), Boolean(detail)),
  recognizeQuestPng: (image) => ipcRenderer.invoke('quests:recognize-png', image),
  scanScreenText: () => ipcRenderer.invoke('collector:scan-screen'),
  experimental: {
    getSettings: () => ipcRenderer.invoke('experimental:get-settings'),
    updateSettings: (patch) => ipcRenderer.invoke('experimental:update-settings', patch),
    getStatus: () => ipcRenderer.invoke('experimental:status'),
    toggleMinimap: () => ipcRenderer.invoke('experimental:toggle-minimap'),
    pickScreenshotsFolder: () => ipcRenderer.invoke('experimental:pick-screenshots'),
    testItemLookup: () => ipcRenderer.invoke('experimental:test-item'),
    answer: (id, payload) => ipcRenderer.invoke('experimental:answer', id, payload),
    onQuery: (callback) => subscribe('experimental:query', callback),
    onPosition: (callback) => subscribe('experimental:position', callback),
    onCollectorScan: (callback) => subscribe('experimental:collector-scan', () => callback()),
  },
  overlaySetInteractive: (value) => ipcRenderer.send('overlay:interactive', Boolean(value)),
  overlayResize: (width, height) => ipcRenderer.send('overlay:resize', Number(width), Number(height)),
  overlayDrag: (active) => ipcRenderer.send('overlay:drag', Boolean(active)),
  overlayZones: (zones) => ipcRenderer.send('overlay:zones', zones),
  onOverlay: (channel, callback) => {
    if (!['overlay:item', 'overlay:minimap', 'overlay:position'].includes(channel)) return () => {}
    const unsubscribe = subscribe(channel, callback)
    ipcRenderer.send('overlay:subscribe', channel)
    return unsubscribe
  },
})

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
