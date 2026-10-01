// First: wraps ipcMain.handle / ipcMain.on before any handler is registered (IPC only from the app's own pages).
import { APP_INDEX_FILE, devRendererUrl, isTrustedAppPage } from './ipcGuard.js'
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RaidMode } from '../src/domain/types.js'
import { discoverEftLogs, normalizeSelectedLogsFolder } from './logDiscovery.js'
import { readRaidState, scanLogFolderBySession, type RaidState } from './logScanner.js'
import { fetchPlayerProfile, resolveAccountIdsByNickname, clearPlayerSnapshotCache, humanizeNetworkError } from './playerProfileService.js'
import { captureQuestFrame, clearScanFrames, recognizeQuestPng, scanScreenText } from './screenOcr.js'
import { startExperimental, stopExperimental } from './experimental/index.js'
import { isElevatedRelaunch, relaunchAsAdmin, waitForPreviousCopy } from './experimental/elevation.js'
import { readSettings as readExperimentalSettings } from './experimental/settings.js'
import { emailServerStatus, emailSettings, inviteStreamer, listStreamers, ownerEmails, paymentSettings, sendTestEmail, sendTestSms, setEmailSettings, setOwnerEmails, setPaymentSettings, setSmsSettings, smsServerStatus, smsSettings } from './ownerAdmin.js'
import { enableFromCommandLine, isServerMode, LOCAL_SITE_URL, restartApi, localServerEnabled, localServerStatus, runningBuild, setLocalServerEnabled, startIfEnabled, stopLocalServer } from './localServer.js'
import { accountEmailSignIn, accountLogin, accountLogout, accountPhoneSignIn, accountStatus, forgetLocalPreference, serviceRequest, setServerUrl } from './serviceGateway.js'
import { buildEdition, isOwnerBuild } from './buildEdition.js'
import { mobileLoginLink, websiteBase } from './accountLinks.js'
import { enableTunnelFromCommandLine, publicSiteUrl, setNamedTunnel, setTunnel, startTunnelIfWanted, stopTunnel, tunnelStatus } from './publicTunnel.js'
import { checkServicesNow, notifyServerOwner, restartServiceNow, serverJournal, serverMonitorStatus, startServerMonitor, stopServerMonitor } from './serverMonitor.js'
import { errorReportSettings, reportApiError, reportError, setErrorReportSettings, startErrorReporter, testErrorReports } from './errorReporter.js'
import { checkSelfUpdateNow, rollbackToPrevious, selfUpdateStatus, setSelfUpdateSettings, startServerSelfUpdate, stopServerSelfUpdate } from './selfUpdate.js'
import { handleApiRequest, onApiEvent } from './apiChannel.js'
import { finishTrial, isTrialBuild, startTrial, TRIAL_APP_NAME, TRIAL_DATA_FOLDER, trialLaunchesAtStart } from './trial.js'
import { checkForUpdate, checkForUpdateNow, installUpdate, setUpdateSettings, startUpdateChecks, updateSettings, updateStatus } from './appUpdate.js'
import { wikiMapUrl, isWikiMapHost } from '../src/data/wikiMaps.js'
import { isEmbeddableWebviewUrl, isExternalAllowed } from './trustedPages.js'

const appDir = dirname(fileURLToPath(import.meta.url))

// The app is «Raid OS» now (earlier «Tarkov Operator», before that «Tarkov Operations Companion Beta»). Electron would
// name the data folder after the product, so it is pinned: settings, profiles, local storage, session and the server
// database stay in %APPDATA%\Tarkov Operator (or the even older folder when it exists), nobody loses progress.
const LEGACY_USER_DATA = join(app.getPath('appData'), 'Tarkov Operations Companion Beta')
const USER_DATA = join(app.getPath('appData'), 'Tarkov Operator')
// The test build for friends is a separate app with its own data folder (electron/trial.ts).
if (trialLaunchesAtStart()) { app.setName(TRIAL_APP_NAME); app.setPath('userData', join(app.getPath('appData'), TRIAL_DATA_FOLDER)) }
else app.setPath('userData', existsSync(LEGACY_USER_DATA) ? LEGACY_USER_DATA : USER_DATA)
let mainWindow: BrowserWindow | null = null
const LOG_POLL_MS = 5000
let watchedFolder = ''
let scanInterval: NodeJS.Timeout | null = null
let scanning = false
let lastPublished = ''
let raidState: RaidState = { inRaid: false }


// UI hover ticks must play before the first click in the window.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#0d1110',
    title: trialLaunchesAtStart() ? 'Raid OS — тестовая версия' : 'Raid OS',
    // The window and taskbar icon (the exe file itself gets build/icon.ico from electron-builder).
    icon: join(appDir, '../../dist/app-icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(appDir, '../../electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      // Minimized or hidden, the window must cost the game nothing: Chromium then stops drawing it (animations,
      // requestAnimationFrame, the 3D mask) and slows its timers to once a second. IPC still arrives at once, so the
      // overlays' questions (experimental:query) and log sync keep working. With `false` a minimized window kept
      // rendering at 60 fps and stayed "visible" to the page. While it is only unfocused, see src/app/appActivity.ts.
      backgroundThrottling: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalAllowed(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Only the app's own page (dist/index.html, or exactly the dev server's origin): not http://127.0.0.1.evil.com.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppPage(url)) event.preventDefault()
  })
  // <webview> guests (src/components/WikiMapEmbed.tsx) never get the app's preload or Node, and only the embedded hosts.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    delete (webPreferences as { preloadURL?: string }).preloadURL
    webPreferences.sandbox = true
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!isEmbeddableWebviewUrl(params.src)) event.preventDefault()
  })

  // Overlay windows stay alive while hidden; closing the main window ends the app.
  mainWindow.on('closed', () => {
    mainWindow = null
    stopExperimental()
    app.quit()
  })

  loadRenderer(mainWindow, '')
}

function loadRenderer(window: BrowserWindow, hash: string) {
  const devUrl = devRendererUrl()
  if (devUrl) void window.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void window.loadFile(APP_INDEX_FILE, hash ? { hash } : undefined)
}

app.whenReady().then(async () => {
  // Server, tunnel and owner controls exist only in the owner build (electron/buildEdition.ts): a player's copy
  // ignores --enable-local-server / --server-mode / --enable-tunnel.
  const ownerBuild = isOwnerBuild()
  if (ownerBuild) {
    await enableFromCommandLine(process.argv)
    await enableTunnelFromCommandLine(process.argv)
  }
  const serverMode = ownerBuild && isServerMode()
  // «Always run as administrator» (Mini Map page): the game runs elevated, and Windows hides its keys
  // from apps that are not. When the prompt is refused the app simply goes on without the rights.
  if (!serverMode && process.platform === 'win32' && readExperimentalSettings().runAsAdmin && !isElevatedRelaunch() && relaunchAsAdmin()) return
  await waitForPreviousCopy()
  registerIpc()
  createWindow()
  // A test build for friends counts its launches and removes itself after the last one (electron/trial.ts).
  if (!serverMode && !(await startTrial(() => mainWindow))) return
  // The server laptop: no game features, the window waits minimized (closing it stops the server).
  if (serverMode) mainWindow?.minimize()
  // A friend's (or the owner's gaming) copy updates itself from the server laptop's site.
  else if (!isTrialBuild()) startUpdateChecks((status) => mainWindow?.webContents.send('update:status', status), { inRaid: () => raidState.inRaid })
  if (!serverMode) startExperimental({
    preload: join(appDir, '../../electron/preload.cjs'),
    load: loadRenderer,
    mainWindow: () => mainWindow,
    raidState: () => raidState,
    logsRoot: async () => watchedFolder || (await discoverEftLogs(app.getPath('appData')).catch(() => null))?.logsFolder || '',
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  // What the API process may ask this app (electron/apiChannel.ts): the «Обновление» tab and error reports.
  if (ownerBuild) {
    handleApiRequest('self-update:status', () => selfUpdateStatus())
    handleApiRequest('self-update:check', () => checkSelfUpdateNow())
    handleApiRequest('self-update:rollback', (payload) => rollbackToPrevious(payload))
    onApiEvent('error-report', reportApiError)
  }
  // «Сервер и сайт на этом компьютере» (Profile → server account): the owner's API and website from this app.
  if (ownerBuild) void startIfEnabled().then(async (openSite) => {
    if (openSite) void shell.openExternal(`${LOCAL_SITE_URL}/`)
    // A PC that keeps the server running (e.g. a laptop) reopens the public link for friends on start.
    if (await localServerEnabled()) await startTunnelIfWanted()
  }).catch(() => {}).finally(() => {
    // Status lamps and self-repair of the server, site and public link (idle while the mode is off).
    startServerMonitor(() => mainWindow)
    // «Отчёты об ошибках (GitHub)» (off until the owner sets a token) and, on the server laptop, «Автообновление сервера».
    void runningBuild().then((build) => startErrorReporter({ version: build.version, build: build.build, commit: build.commit }))
    if (serverMode) startServerSelfUpdate({ journal: serverJournal, notify: notifyServerOwner, report: reportError })
  })
})

app.on('will-quit', () => { stopServerSelfUpdate(); stopServerMonitor(); stopTunnel(); stopLocalServer(); finishTrial() })

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('https://tarkov.dev/') || isWikiMapHost(url)) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
})

app.on('window-all-closed', () => {
  stopWatchingLogs()
  if (process.platform !== 'darwin') app.quit()
})

const OWNER_CHANNELS = [
  'local-server:status', 'local-server:set-enabled', 'tunnel:status', 'tunnel:set', 'tunnel:set-named',
  'server-watchdog:status', 'server-watchdog:restart', 'server-watchdog:check',
  'owner:payments', 'owner:set-payments', 'owner:streamers', 'owner:invite-streamer', 'owner:emails', 'owner:set-emails',
  'owner:sms', 'owner:set-sms', 'owner:sms-status', 'owner:sms-test',
  'owner:email', 'owner:set-email', 'owner:email-status', 'owner:email-test',
  'owner:error-reports', 'owner:set-error-reports', 'owner:error-reports-test',
  'owner:server-update', 'owner:set-server-update', 'owner:server-update-check', 'owner:server-update-rollback',
]

function registerIpc() {
  ipcMain.handle('app:clear-data', async () => {
    stopWatchingLogs()
    if (!mainWindow) return false
    await clearScanFrames().catch(() => 0)
    await mainWindow.webContents.session.clearStorageData({ storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] })
    return true
  })
  ipcMain.handle('maps:open-wiki', async (_event, id: string) => {
    const url = wikiMapUrl(id)
    if (!url) return false
    const wikiWindow = new BrowserWindow({ width: 1450, height: 950, title: 'Оригинальная карта Wiki', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'wiki-maps' } })
    wikiWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    wikiWindow.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith('https://')) void shell.openExternal(target)
      return { action: 'deny' }
    })
    wikiWindow.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== 'https://escapefromtarkov.fandom.com') {
        event.preventDefault()
        if (target.startsWith('https://')) void shell.openExternal(target)
      }
    })
    await wikiWindow.loadURL(url)
    return true
  })
  ipcMain.handle('service:request', async (_event, method: string, path: string, body: unknown) => serviceRequest(method, path, body))
  // Server account: the session token never leaves the main process; the renderer only sees e-mail and status.
  ipcMain.handle('account:status', () => accountStatus())
  // Which app this is: 'owner' (server controls) or 'client' (players). Read once by the preload, synchronously.
  ipcMain.on('app:edition', (event) => { event.returnValue = buildEdition() })
  // The server laptop (owner build + --server-mode): the renderer skips catalog polling (src/data/catalogRefresh.ts).
  ipcMain.on('app:server-mode', (event) => { event.returnValue = isOwnerBuild() && isServerMode() })
  // «Войти в мобильную версию»: a two-minute one-time code in a website link, never the session token.
  ipcMain.handle('account:mobile-login', () => mobileLoginLink())
  // The public website address (streamer links, QR codes): the server's site, or this PC's public link.
  ipcMain.handle('account:website-url', () => websiteBase({ forPhone: true }))
  ipcMain.handle('account:login', (_event, email: unknown, password: unknown) => accountLogin(email, password))
  ipcMain.handle('account:logout', () => accountLogout())
  // Sign-in / password reset by phone after the SMS code: the new session stays in the main process.
  ipcMain.handle('account:phone-sign-in', (_event, kind: unknown, challengeId: unknown, code: unknown, password: unknown) => accountPhoneSignIn(kind, challengeId, code, password))
  // The same after an e-mail code (sign-in or «Забыли пароль?» by e-mail).
  ipcMain.handle('account:email-sign-in', (_event, kind: unknown, challengeId: unknown, code: unknown, password: unknown) => accountEmailSignIn(kind, challengeId, code, password))
  ipcMain.handle('account:open-website', async (_event, page: unknown) => {
    // 'admin': the owner's «Админ-панель» on the site (the server itself refuses it to anybody but the owner).
    const path = page === 'register' ? '/register' : page === 'admin' && isOwnerBuild() ? '/admin' : '/cabinet'
    const target = `${await websiteBase()}${path}`
    if (!isExternalAllowed(target)) return false
    await shell.openExternal(target)
    return true
  })
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
  // Trader restock reminders (src/restock/RestockNotifier.tsx): a plain system notification, text only.
  ipcMain.handle('app:notify', (_event, title: unknown, body: unknown) => {
    if (!Notification.isSupported()) return false
    const text = (value: unknown, max: number) => String(value ?? '').slice(0, max)
    const notification = new Notification({ title: text(title, 120), body: text(body, 300) })
    notification.on('click', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
    notification.show()
    return true
  })
  ipcMain.handle('local-server:status', () => localServerStatus())
  ipcMain.handle('local-server:set-enabled', async (_event, enabled: unknown) => {
    if (enabled !== true) stopTunnel()
    const status = await setLocalServerEnabled(enabled === true)
    // The owner's default server follows the mode (this PC while it is on, raidos.app otherwise).
    forgetLocalPreference()
    return status
  })
  ipcMain.handle('tunnel:status', () => tunnelStatus())
  // Status lamps, journal and «Перезапустить сейчас» (electron/serverMonitor.ts).
  ipcMain.handle('server-watchdog:status', () => serverMonitorStatus())
  ipcMain.handle('server-watchdog:restart', (_event, service: unknown) => restartServiceNow(service))
  ipcMain.handle('server-watchdog:check', () => checkServicesNow())
  ipcMain.handle('tunnel:set', (_event, enabled: unknown) => setTunnel(enabled === true))
  ipcMain.handle('tunnel:set-named', async (_event, hostname: unknown, token: unknown) => {
    const status = await setNamedTunnel(hostname, token)
    await restartApi() // the API builds ЮKassa return links from the public address
    return status
  })
  ipcMain.handle('account:set-server-url', async (_event, url: unknown) => {
    const result = await setServerUrl(url)
    void checkForUpdate()
    return result
  })
  // Owner: ЮKassa settings and streamer invitations for the server on this PC (electron/ownerAdmin.ts).
  ipcMain.handle('owner:payments', () => paymentSettings())
  ipcMain.handle('owner:set-payments', async (_event, settings: unknown) => {
    const result = await setPaymentSettings(settings)
    await restartApi()
    return result
  })
  // «SMS: одноразовые коды»: provider and key only from this app (never the website); the API restarts to pick them up.
  ipcMain.handle('owner:sms', () => smsSettings())
  ipcMain.handle('owner:set-sms', async (_event, settings: unknown) => {
    const result = await setSmsSettings(settings)
    await restartApi()
    return result
  })
  ipcMain.handle('owner:sms-status', () => smsServerStatus())
  ipcMain.handle('owner:sms-test', (_event, phone: unknown) => sendTestSms(phone))
  // «Почта: коды подтверждения»: the same rule — provider and key only from this app, never from the website.
  ipcMain.handle('owner:email', () => emailSettings())
  ipcMain.handle('owner:set-email', async (_event, settings: unknown) => {
    const result = await setEmailSettings(settings)
    await restartApi()
    return result
  })
  ipcMain.handle('owner:email-status', () => emailServerStatus())
  ipcMain.handle('owner:email-test', (_event, to: unknown) => sendTestEmail(to))
  // «Отчёты об ошибках (GitHub)»: repository, write-only token (safeStorage), on/off, test (electron/errorReporter.ts).
  ipcMain.handle('owner:error-reports', () => errorReportSettings())
  ipcMain.handle('owner:set-error-reports', (_event, settings: unknown) => setErrorReportSettings(settings))
  ipcMain.handle('owner:error-reports-test', () => testErrorReports())
  // «Автообновление сервера» on the server laptop (electron/selfUpdate.ts).
  ipcMain.handle('owner:server-update', () => selfUpdateStatus())
  ipcMain.handle('owner:set-server-update', async (_event, settings: unknown) => { await setSelfUpdateSettings(settings); return selfUpdateStatus() })
  ipcMain.handle('owner:server-update-check', () => checkSelfUpdateNow())
  ipcMain.handle('owner:server-update-rollback', () => rollbackToPrevious({ confirm: true }))
  ipcMain.handle('owner:streamers', () => listStreamers())
  ipcMain.handle('owner:emails', () => ownerEmails())
  ipcMain.handle('owner:set-emails', async (_event, emails: unknown) => {
    const result = await setOwnerEmails(emails)
    await restartApi() // the API reads TARKOV_OWNER_EMAILS on start
    return result
  })
  ipcMain.handle('owner:invite-streamer', async (_event, code: unknown) => inviteStreamer(code, (await publicSiteUrl()) || LOCAL_SITE_URL))
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:install', () => installUpdate())
  // Settings → «Проверить обновление приложения», «Автообновление», «Автоустановка»
  ipcMain.handle('update:check', () => checkForUpdateNow())
  ipcMain.handle('update:settings', () => updateSettings())
  ipcMain.handle('update:set-settings', (_event, patch: unknown) => setUpdateSettings(patch))
  // A player's copy (client build) has no server, tunnel or owner controls at all, not even hidden ones.
  if (!isOwnerBuild()) for (const channel of OWNER_CHANNELS) ipcMain.removeHandler(channel)

  ipcMain.handle('profile:resolve', async (_event, rawMode: unknown, rawNickname: unknown) => {
    const mode = validateMode(rawMode)
    const nickname = typeof rawNickname === 'string' ? rawNickname.trim().replace(/[\u200B-\u200D\uFEFF]/g, '') : ''
    if (!nickname || !/^[a-zA-Z0-9_-]{3,15}$/i.test(nickname)) throw new Error('Введите корректный ник Escape from Tarkov (3–15 латиница/цифры/_/-)')

    const modeLabel = mode === 'pvp' ? 'PvP' : mode === 'pve' ? 'PvE' : 'сезонного режима'
    try {
      // The server resolves through its shared cache; if it is not running or fails, resolve locally.
      const remote = await serviceRequest('POST', '/v1/players/resolve', { mode, nickname }).catch(() => null)
      if (remote) return remote

      const discovered = await discoverEftLogs(app.getPath('appData'))
      const scan = discovered.logsFolder ? await scanLogFolderBySession(discovered.logsFolder) : null
      const logAccountId = scan?.latestAccountIdByMode[mode]

      // Prefer local logs first — skips the ~70MB nickname index.
      if (logAccountId) {
        try {
          clearPlayerSnapshotCache(mode, [logAccountId])
          const snapshot = await fetchPlayerProfile(mode, logAccountId)
          if (snapshot.nickname.toLowerCase() === nickname.toLowerCase()) {
            return { accountId: logAccountId, nickname: snapshot.nickname, level: snapshot.level, faction: snapshot.faction, mode, snapshot }
          }
        } catch {
          // Fall through to Tarkov.dev index.
        }
      }

      let candidates: number[] = await resolveAccountIdsByNickname(mode, nickname).catch(() => [] as number[])
      if (!candidates.length) {
        candidates = await resolveAccountIdsByNickname(mode, nickname, { refresh: true })
      }

      const orderedIds = [
        ...(logAccountId && candidates.includes(logAccountId) ? [logAccountId] : []),
        ...candidates.filter((id) => id !== logAccountId),
      ]

      if (!orderedIds.length) {
        throw new Error(
          `Профиль «${nickname}» не найден в индексе ${modeLabel}. Проверьте режим (PvP/PvE/Сезон), откройте профиль на Tarkov.dev и повторите через пару минут.`,
        )
      }

      clearPlayerSnapshotCache(mode, orderedIds.slice(0, 5))
      let lastError: Error | null = null
      for (const accountId of orderedIds.slice(0, 5)) {
        try {
          const snapshot = await fetchPlayerProfile(mode, accountId)
          if (snapshot.nickname.toLowerCase() !== nickname.toLowerCase()) {
            lastError = new Error(`Найден профиль ${snapshot.nickname}, а введён ${nickname}. Проверьте режим и ник.`)
            continue
          }
          return { accountId, nickname: snapshot.nickname, level: snapshot.level, faction: snapshot.faction, mode, snapshot }
        } catch (error) {
          lastError = humanizeNetworkError(error)
        }
      }

      throw lastError ?? new Error(`Профиль не найден в ${modeLabel}. Откройте его на Tarkov.dev и повторите синхронизацию.`)
    } catch (error) {
      throw humanizeNetworkError(error)
    }
  })

  ipcMain.handle('profile:refresh', async (_event, rawMode: unknown, rawAccountId: unknown) => {
    const mode = validateMode(rawMode)
    const accountId = Number(rawAccountId)
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Некорректный идентификатор профиля')
    return await serviceRequest('GET', `/v1/players/${mode}/${accountId}`).catch(() => null) ?? fetchPlayerProfile(mode, accountId)
  })
  ipcMain.handle('game:get-raid-state', () => raidState)
  ipcMain.handle('collector:scan-screen', () => scanScreenText())
  ipcMain.handle('quests:capture-frame', (_event, watch?: unknown, detail?: unknown) => captureQuestFrame(Boolean(watch), Boolean(detail)))
  ipcMain.handle('quests:recognize-png', async (_event, raw: unknown) => {
    if (typeof raw !== 'string' || raw.length > 18_000_000) throw new Error('Скриншот слишком большой')
    const payload = raw.replace(/^data:image\/\w+;base64,/, '')
    return recognizeQuestPng(Buffer.from(payload, 'base64'))
  })
}

function stopWatchingLogs() {
  if (scanInterval) clearInterval(scanInterval)
  scanInterval = null
  watchedFolder = ''
  scanning = false
  lastPublished = ''
}

function startLogWatcher(folder: string) {
  if (watchedFolder === folder && scanInterval) { void pollLogs(true); return }
  if (scanInterval) clearInterval(scanInterval)
  watchedFolder = folder
  lastPublished = ''
  scanInterval = setInterval(() => void pollLogs(), LOG_POLL_MS)
  void pollLogs(true)
}

/** Quest logs are re-read every few seconds, but never while the player is in a raid. */
async function pollLogs(force = false) {
  if (scanning || !watchedFolder) return
  scanning = true
  try {
    const next = await readRaidState(watchedFolder).catch((): RaidState => ({ inRaid: false }))
    const changed = next.inRaid !== raidState.inRaid
    raidState = next
    if (changed || force) mainWindow?.webContents.send('game:raid-state', next)
    if (!next.inRaid) await publishLogs(force)
  } finally {
    scanning = false
  }
}

async function publishLogs(force: boolean) {
  try {
    const result = await scanLogFolderBySession(watchedFolder)
    const signature = JSON.stringify([result.events.length, result.events.at(-1)?.timestamp, result.sessionCount, result.latestMode])
    if (!force && signature === lastPublished) return
    lastPublished = signature
    if (process.env.TARKOV_API_URL && process.env.TARKOV_API_TOKEN) {
      const groups = new Map<string, typeof result.events>()
      for (const event of result.events) {
        if (!event.mode || !event.accountId || !event.profileId) continue
        const key = `${event.mode}:${event.accountId}:${event.profileId}`
        const events = groups.get(key) ?? []
        events.push(event)
        groups.set(key, events)
      }
      for (const events of groups.values()) {
        const first = events[0]
        await serviceRequest('POST', '/v1/sync/events', {
          mode: first.mode, accountId: first.accountId, characterId: first.profileId,
          events: events.map(({ taskId, status, timestamp }) => ({ taskId, status, timestamp })),
        }).catch(() => { /* The local projection stays available; the idempotent batch is resent on the next change. */ })
      }
    }
    mainWindow?.webContents.send('logs:updated', result)
  } catch { /* Retried on the next poll when a log is temporarily unavailable. */ }
}

function validateMode(value: unknown): RaidMode {
  if (value === 'pvp' || value === 'pve' || value === 'seasonal') return value
  throw new Error('Неизвестный режим Escape from Tarkov')
}
