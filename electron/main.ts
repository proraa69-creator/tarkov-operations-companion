import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RaidMode } from '../src/domain/types.js'
import { discoverEftLogs, normalizeSelectedLogsFolder } from './logDiscovery.js'
import { scanLogFolderBySession } from './logScanner.js'
import { fetchPlayerProfile } from './playerProfileService.js'

const appDir = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let logWatcher: FSWatcher | null = null
let watchedFolder = ''
let watchDebounce: NodeJS.Timeout | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#0d1110',
    title: 'Tarkov Operations Companion Beta',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(appDir, '../../electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://127.0.0.1')) event.preventDefault()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(appDir, '../../dist/index.html'))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  logWatcher?.close()
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc() {
  ipcMain.handle('logs:auto-find-and-scan', async () => {
    const discovered = await discoverEftLogs(app.getPath('appData'))
    if (!discovered.logsFolder) return null
    const parsed = await scanLogFolderBySession(discovered.logsFolder)
    return { ...parsed, folder: discovered.logsFolder }
  })

  ipcMain.handle('logs:select-and-scan', async () => {
    const discovered = await discoverEftLogs(app.getPath('appData'))
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Выберите папку Logs',
      buttonLabel: 'Выбрать папку Logs',
      defaultPath: discovered.gameFolder ?? discovered.gamesRoot,
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const folder = await normalizeSelectedLogsFolder(result.filePaths[0])
    const parsed = await scanLogFolderBySession(folder)
    return { ...parsed, folder }
  })

  ipcMain.handle('logs:start-watching', async (_event, folder: unknown) => {
    if (typeof folder !== 'string' || !folder) return false
    const info = await stat(folder).catch(() => null)
    if (!info?.isDirectory()) return false
    startLogWatcher(folder)
    return true
  })

  ipcMain.handle('profile:save-backup', async (_event, json: unknown) => {
    if (typeof json !== 'string' || json.length > 5_000_000) throw new Error('Некорректная резервная копия')
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Сохранить резервную копию профиля',
      defaultPath: 'tarkov-operations-profile.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, json, 'utf8')
    return true
  })

  ipcMain.handle('profile:open-backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Открыть резервную копию профиля',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const content = await readFile(result.filePaths[0], 'utf8')
    if (content.length > 5_000_000) throw new Error('Файл слишком большой')
    return content
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('profile:resolve', async (_event, rawMode: unknown, rawNickname: unknown) => {
    const mode = validateMode(rawMode)
    const nickname = typeof rawNickname === 'string' ? rawNickname.trim() : ''
    if (!nickname || !/^[a-zA-Z0-9_-]{3,15}$/i.test(nickname)) throw new Error('Введите корректный ник Escape from Tarkov')
    const discovered = await discoverEftLogs(app.getPath('appData'))
    if (!discovered.logsFolder) throw new Error('Папка Logs не найдена. Сначала запустите Escape from Tarkov хотя бы один раз.')
    const scan = await scanLogFolderBySession(discovered.logsFolder)
    const accountId = scan.latestAccountIdByMode[mode] ?? [...scan.sessions].reverse().find((session) => session.accountId)?.accountId
    if (!accountId) throw new Error('В журналах не найден Tarkov ID. Запустите игру, войдите в выбранный режим и повторите.')
    const snapshot = await fetchPlayerProfile(mode, accountId)
    if (snapshot.nickname.toLowerCase() !== nickname.toLowerCase()) {
      throw new Error(`В журналах найден профиль ${snapshot.nickname}, а введён ${nickname}. Проверьте режим и ник.`)
    }
    return { accountId, nickname: snapshot.nickname, level: snapshot.level, faction: snapshot.faction, mode, snapshot }
  })

  ipcMain.handle('profile:refresh', async (_event, rawMode: unknown, rawAccountId: unknown) => {
    const mode = validateMode(rawMode)
    const accountId = Number(rawAccountId)
    return fetchPlayerProfile(mode, accountId)
  })
}

function startLogWatcher(folder: string) {
  logWatcher?.close()
  watchedFolder = folder
  logWatcher = watch(folder, { recursive: true }, () => {
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(async () => {
      const result = await scanLogFolderBySession(watchedFolder)
      mainWindow?.webContents.send('logs:updated', result)
    }, 1500)
  })
}

function validateMode(value: unknown): RaidMode {
  if (value === 'pvp' || value === 'pve' || value === 'seasonal') return value
  throw new Error('Неизвестный режим Escape from Tarkov')
}
