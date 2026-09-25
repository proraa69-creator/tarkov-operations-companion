import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { mergeParseResults, parseEftLog, type LogParseResult } from '../src/import/logParser.js'
import { discoverEftLogs, normalizeSelectedLogsFolder } from './logDiscovery.js'

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
    const parsed = await scanLogFolder(discovered.logsFolder)
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
    const parsed = await scanLogFolder(folder)
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
}

async function scanLogFolder(folder: string): Promise<LogParseResult> {
  const files = await collectLogFiles(folder)
  const results: LogParseResult[] = []
  for (const file of files) {
    try {
      if (extname(file).toLowerCase() === '.zip') {
        const archive = unzipSync(new Uint8Array(await readFile(file)))
        for (const [name, bytes] of Object.entries(archive)) {
          if (isSupportedLog(name)) results.push(parseEftLog(new TextDecoder().decode(bytes)))
        }
      } else {
        results.push(parseEftLog(await readFile(file, 'utf8')))
      }
    } catch {
      results.push({ events: [], detectedModes: [], ignoredRecords: 1 })
    }
  }
  return mergeParseResults(results)
}

async function collectLogFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 4) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await collectLogFiles(path, depth + 1))
    else if (entry.isFile() && isSupportedLog(entry.name)) files.push(path)
  }
  return files
}

function isSupportedLog(name: string) {
  return /(?:notifications|application|output[_-]?\d*).*\.log$/i.test(name) || /\.zip$/i.test(name)
}

function startLogWatcher(folder: string) {
  logWatcher?.close()
  watchedFolder = folder
  logWatcher = watch(folder, { recursive: true }, () => {
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(async () => {
      const result = await scanLogFolder(watchedFolder)
      mainWindow?.webContents.send('logs:updated', result)
    }, 1500)
  })
}
