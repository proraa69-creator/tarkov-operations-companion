// First: wraps ipcMain.handle / ipcMain.on before any handler is registered (IPC only from the app's own pages).
import { APP_INDEX_FILE, devRendererUrl, isTrustedAppPage } from './ipcGuard.js'
import { totalmem } from 'node:os'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, protocol, screen, session, shell, type IpcMainInvokeEvent, type MessageBoxOptions, type WebContents } from 'electron'
import { describeSystemBrief } from './systemBrief.js'
import { displayScale, followDisplayScale, INTERFACE_ZOOM_MODE, opensMaximized, scaledWindowSize } from './uiScale.js'
import { readSavedWindow, rememberWindow, restoredBounds } from './windowState.js'
import { existsSync, watch as watchFs } from 'node:fs'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RaidMode } from '../src/domain/types.js'
import type { ModeLogScanResult } from '../src/import/eftLogTimeline.js'
import { discoverAllEftLogs, discoverEftLogs, eftLogSearchReport, freshestLogsFolder, normalizeSelectedLogsFolder } from './logDiscovery.js'
import { clearLogCaches, loadLogCache, readRaidState, saveLogCache, scanLogFolderBySession, scanLogIdentity } from './logScanner.js'
import { createLogWatcher, emptyLogScan, type QuestIdsByMode } from './logWatcher.js'
import { foregroundGame } from './experimental/win32.js'
import { fetchPlayerProfile } from './playerProfileService.js'
import { cachedProfileLookup, type JsonFetch } from './ownProfileLookup.js'
import { captureIdentityFrame, captureQuestFrame, captureQuestScreenshot, clearScanFrames } from './screenOcr.js'
import { scanCollectorScreen } from './collectorScan.js'
import { createItemImageResponder, createMapFileResponder, ITEM_IMAGE_ORIGIN, ITEM_IMAGE_SCHEME, itemImageRedirect, MAP_FILE_ORIGIN, mapFileRedirect, tarkovDevImageUrl, tarkovDevMapUrl } from './itemImages.js'
import { createGunPartResponder } from './gunParts.js'
import { RANGE_PACK_FILE, RANGE_PACK_NAME } from '../src/range/rangePack.js'
import { setGameLogFolders, startExperimental, stopExperimental } from './experimental/index.js'
import { startScreenTuning, stopScreenTuning } from './screenTuning/index.js'
import { setMapFloorWheel, startMapFloorWheel, stopMapFloorWheel } from './mapFloorWheel.js'
import { isElevatedRelaunch, relaunchAsAdmin, waitForPreviousCopy } from './experimental/elevation.js'
import { allowSecondStartMessages, isElevated } from './experimental/win32.js'
import { bringToFront, startedByTheApp, waitForInstanceLock } from './singleInstance.js'
import { clearRaidSignals, raidLikely } from './experimental/raidSignals.js'
import { apiEnvironment, emailServerStatus, emailSettings, inviteStreamer, listStreamers, ownerEmails, paymentSettings, sendTestEmail, sendTestSms, setEmailSettings, setOwnerEmails, setPaymentSettings, setSmsSettings, smsServerStatus, smsSettings } from './ownerAdmin.js'
import { enableFromCommandLine, isServerMode, LOCAL_SITE_URL, restartApi, localServerEnabled, localServerStatus, runningBuild, setLocalServerEnabled, startIfEnabled, stopLocalServer } from './localServer.js'
import { accountEmailSignIn, accountLogin, accountQrPoll, accountQrStart, accountLogout, accountPhoneSignIn, accountRegister, accountRegisterConfirm, accountStatus, forgetLocalPreference, gameCacheAccess, refreshEntitlement, serviceRequest, setServerUrl, apiBaseUrl, isLocalAddress } from './serviceGateway.js'
import { buildEdition, isOwnerBuild, isSafeStartBuild, isTestBuild, TEST_BUILD_APP_NAME, TEST_BUILD_DATA_FOLDER } from './buildEdition.js'
import { clearGameCache, readGameCache, writeGameCache } from './gameDataCache.js'
import { ENTITLEMENT_REFRESH_MS } from './entitlement.js'
import { mobileLoginLink, websiteBase } from './accountLinks.js'
import { enableTunnelFromCommandLine, publicSiteUrl, setNamedTunnel, setTunnel, startTunnelIfWanted, stopTunnel, tunnelStatus } from './publicTunnel.js'
import { checkServicesNow, notifyServerOwner, restartServiceNow, serverJournal, serverMonitorStatus, startServerMonitor, stopServerMonitor } from './serverMonitor.js'
import { errorReportSettings, reportApiError, reportError, setErrorReportSettings, startErrorReporter, testErrorReports } from './errorReporter.js'
import { checkSelfUpdateNow, installSelfUpdateNow, rollbackToPrevious, selfUpdateStatus, setSelfUpdateSettings, startServerSelfUpdate, stopServerSelfUpdate } from './selfUpdate.js'
import { handleApiRequest, onApiEvent } from './apiChannel.js'
import { finishTrial, isTrialBuild, startTrial, TRIAL_APP_NAME, TRIAL_DATA_FOLDER, trialLaunchesAtStart } from './trial.js'
import { isTarkovRunning } from './gameProcess.js'
import { checkForUpdate, checkForUpdateNow, downloadUpdate, installerOffer, installFromPortable, installUpdate, rendererVersion, setUpdateSettings, startUpdateChecks, updateSettings, updateStatus } from './appUpdate.js'
import { installedExe, removeMigratedPortable, removePortableLeftovers, updatableExe } from './appInstall.js'
import { abandonStagedBoot, confirmStagedBoot, relaunchWhenClosed } from './deltaUpdate.js'
import { asksAtNextStart, DARK_WINDOW_MS, describeGpus, FIRST_PAINT_MS, nextStartStep, noteShownStart, readDarkWindowCheck, readGpuFallback, SANDBOX_BACK_AFTER, soonAfterShown, writeDarkWindowCheck, writeGpuFallback, type DrawingTrouble } from './gpuFallback.js'
import { appendStartLog, startLogTail } from './startLog.js'
import { shouldReloadAfterCrash, shouldReportLoadFailure, startNotes, startNotesScript } from './startDiagnostics.js'
import { loadLiveRenderer, windowNotInUse } from './liveRenderer.js'
import { isEmbeddableWebviewUrl, isExternalAllowed } from './trustedPages.js'
import { externalLinkPolicy, externalLinkPrompt } from './externalLinks.js'
import { confirmDialogOptions } from './confirmDialog.js'
import { LogFolderGrants, mayWatchLogFolder } from './logFolders.js'
import { ownerChangePrompt, type OwnerChange } from './ownerConfirm.js'
import { removeStaleStartMenuShortcut, applyInstallerIdentity } from './startMenuIdentity.js'

const appDir = dirname(fileURLToPath(import.meta.url))

// The app is «Raid OS» now (earlier «Tarkov Operator», before that «Tarkov Operations Companion Beta»). Electron would
// name the data folder after the product, so it is pinned: settings, profiles, local storage, session and the server
// database stay in %APPDATA%\Tarkov Operator (or the even older folder when it exists), nobody loses progress.
const LEGACY_USER_DATA = join(app.getPath('appData'), 'Tarkov Operations Companion Beta')
const USER_DATA = join(app.getPath('appData'), 'Tarkov Operator')
// The test build for friends is a separate app with its own data folder (electron/trial.ts).
if (trialLaunchesAtStart()) { app.setName(TRIAL_APP_NAME); app.setPath('userData', join(app.getPath('appData'), TRIAL_DATA_FOLDER)) }
// A test build (electron/buildEdition.ts isTestBuild) too: it runs beside the real app and never touches its data.
else if (isTestBuild()) { app.setName(TEST_BUILD_APP_NAME); app.setPath('userData', join(app.getPath('appData'), TEST_BUILD_DATA_FOLDER)) }
else app.setPath('userData', existsSync(LEGACY_USER_DATA) ? LEGACY_USER_DATA : USER_DATA)
// One «Raid OS» in the Start menu (report 252, electron/startMenuIdentity.ts): the installer's AppUserModelID, set before anything
// shows a notification; test and trial builds keep their own.
const installerIdentity = applyInstallerIdentity(!trialLaunchesAtStart() && !isTestBuild())
// A start that drew nothing turned the graphics card off for this copy (electron/gpuFallback.ts); it must be before the app is ready.
const gpuFallback = readGpuFallback(app.getPath('userData'))
const gpuOffByArgument = app.commandLine.hasSwitch('disable-gpu')
// A build for a player whose window stays black (electron/buildEdition.ts isSafeStartBuild) draws in software from the start.
const safeStart = isSafeStartBuild()
const softwareDrawing = gpuFallback.softwareDrawing || safeStart
if (softwareDrawing) app.disableHardwareAcceleration()
// The last step before giving up: no Chromium sandbox, which some security software does not let the page's process start in.
// For a few shown starts only (noteShownWindow below), then the sandbox is tried again.
if (gpuFallback.noSandbox) app.commandLine.appendSwitch('no-sandbox')
// The shortcut's --no-sandbox, handed to this copy with administrator rights (experimental/elevation.ts): for a few shown starts too.
const noSandboxByArgument = isElevatedRelaunch() && process.argv.includes('--no-sandbox')
const startLog = (line: string) => appendStartLog(app.getPath('userData'), line)
startLog(`start ${app.getVersion()} · Windows ${process.getSystemVersion()} ${process.arch} · ${[softwareDrawing ? 'software drawing' : '', safeStart ? 'safe start build' : '', gpuFallback.noSandbox ? 'no sandbox' : '', gpuOffByArgument ? '--disable-gpu' : '', app.commandLine.hasSwitch('no-sandbox') && !gpuFallback.noSandbox ? '--no-sandbox' : ''].filter(Boolean).join(', ') || 'normal'}`)
/** The main window has drawn its page: the graphics card works. */
let firstPicture = false
/** The main window's page has loaded. */
let pageLoaded = false
/** When the main window appeared (ms): a second start or a close soon after it may mean the player sees it black. */
let windowShownAt: number | null = null
let restartingForSoftwareDrawing = false

/**
 * The window has been there DARK_WINDOW_MS with its first picture and its page loaded, and nothing started it again: a start that
 * showed its window (security review, 27.11.2026). Without the sandbox for a while only: SANDBOX_BACK_AFTER such starts bring
 * it back (electron/gpuFallback.ts noteShownStart); software drawing stays.
 */
function noteShownWindow() {
  if (!firstPicture || !pageLoaded || restartingForSoftwareDrawing || !mainWindow || mainWindow.isDestroyed()) return
  try {
    const noted = noteShownStart(app.getPath('userData'), { noSandbox: gpuFallback.noSandbox === true, noSandboxByArgument })
    if (noted?.sandboxBack) startLog(`the sandbox is back after ${SANDBOX_BACK_AFTER} shown starts without it`)
    if (noted?.argumentSpent) startLog(`the shortcut's --no-sandbox had ${SANDBOX_BACK_AFTER} shown starts: not handed on any more`)
  } catch { /* the count is a help, never a reason for trouble */ }
}

/**
 * A start that cannot show its page says so instead of a dark window (electron/startDiagnostics.ts): the page that could not be
 * opened, the page's process gone after it drew, and the facts for the page's own failure screen (public/startup-intro.js).
 */
function watchStart(window: BrowserWindow) {
  const contents = window.webContents
  let loaded = false
  let preloadError: string | undefined
  const reloads: number[] = []
  contents.on('preload-error', (_event, _path, error) => { preloadError = error?.message ?? String(error); startLog(`preload error: ${preloadError}`) })
  contents.on('did-finish-load', () => { if (!loaded) startLog('page loaded'); loaded = true })
  contents.on('unresponsive', () => startLog('page unresponsive'))
  contents.on('dom-ready', () => {
    let gpu: Record<string, string> | undefined
    try { gpu = app.getGPUFeatureStatus() as unknown as Record<string, string> } catch { gpu = undefined }
    const notes = startNotes({ version: app.getVersion(), system: `Windows ${process.getSystemVersion()} ${process.arch}`, gpu, softwareDrawing: softwareDrawing || gpuOffByArgument, preloadError })
    void contents.executeJavaScript(startNotesScript(notes)).catch(() => undefined)
  })
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!shouldReportLoadFailure({ code, isMainFrame, loaded }) || window.isDestroyed()) return
    startLog(`page failed to load: ${description} (${code})`)
    if (!window.isVisible()) window.show()
    void dialog.showMessageBox(window, {
      type: 'error',
      title: 'Raid OS',
      message: 'Raid OS не смог открыть своё окно',
      detail: `${description} (${code})\n${url}\nВерсия ${app.getVersion()} · Windows ${process.getSystemVersion()}`,
      buttons: ['Попробовать снова', 'Закрыть'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (window.isDestroyed()) return
      if (response === 0) contents.reload()
      else app.quit()
    })
  })
  contents.on('render-process-gone', (_event, details) => {
    startLog(`page process gone: ${details.reason}, code ${details.exitCode}${firstPicture ? ' (after the first picture)' : ''}`)
    const now = Date.now()
    if (window.isDestroyed() || !shouldReloadAfterCrash(details.reason, firstPicture, reloads, now)) return
    reloads.push(now)
    contents.reload()
  })
}

/**
 * A dark start (owner, 23.11.2026: a player's «черный экран»): note it and start again once in software, the portable exe once
 * its launcher has gone (it deletes the unpacked files), the installed one once this copy has.
 */
function drawInSoftware(trouble: DrawingTrouble) {
  if (restartingForSoftwareDrawing) return
  const why = trouble.kind === 'no-picture' || trouble.kind === 'seen-black' ? trouble.kind : `${trouble.kind}: ${trouble.reason}`
  const step = nextStartStep(trouble, { softwareDrawing, noSandbox: gpuFallback.noSandbox === true, painted: firstPicture, disabledByArgument: gpuOffByArgument })
  if (!step) return
  startLog(`${why} → ${step}`)
  if (step === 'report') { void showStartFailure(why); return }
  try {
    writeGpuFallback(app.getPath('userData'), why, new Date(), step === 'no-sandbox')
  } catch {
    return // a note that cannot be written would start it again and again
  }
  restartingForSoftwareDrawing = true
  const exe = updatableExe()
  if (app.isPackaged && exe) relaunchWhenClosed(exe, installedExe() ? process.pid : process.ppid)
  else app.relaunch()
  app.quit()
  setTimeout(() => app.exit(0), 5000).unref()
}
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') startLog(`process ${details.type}${details.name ? ` (${details.name})` : ''} gone: ${details.reason}, code ${details.exitCode}`)
  if (details.type === 'GPU') drawInSoftware({ kind: 'gpu-gone', reason: details.reason })
})

/** What the player copies for support: the version, the reason and the start log's last lines (no paths, nothing personal). */
function startSupportText(why: string) {
  return [`Raid OS ${app.getVersion()} не открыл окно (${why})`, startLogTail(app.getPath('userData'), 40)].join('\n')
}

const DARK_WINDOW_QUESTION: MessageBoxOptions = {
  type: 'question',
  title: 'Raid OS',
  message: 'Окно Raid OS чёрное?',
  detail: 'Raid OS перезапустится и нарисует окно по-другому.',
  buttons: ['Да, перезапустить', 'Нет'],
  defaultId: 0,
  cancelId: 1,
  noLink: true,
}
/** Asked once a start: a window of Windows, so it shows whatever happens to the page. */
let darkWindowAsked = false
/**
 * The app started again while its window is open, soon after it appeared (`second-instance`), on a PC where it never worked:
 * is it black? A player who uses the app and brings its window forward is never asked.
 */
async function askIfDarkAfterSecondStart() {
  const window = mainWindow
  if (isOwnerBuild() || darkWindowAsked || restartingForSoftwareDrawing || !window || window.isDestroyed() || !soonAfterShown(windowShownAt, Date.now()) || everWorkedHere()) return
  darkWindowAsked = true
  startLog('started again soon after the window appeared')
  const { response } = await dialog.showMessageBox(window, DARK_WINDOW_QUESTION)
  startLog(response === 0 ? 'player: the window is black' : 'player: the window is fine')
  if (response === 0) drawInSoftware({ kind: 'seen-black' })
}

/** This PC has had a working subscription in this app (electron/entitlement.ts keeps the time it last saw one). */
const everWorkedHere = () => existsSync(join(app.getPath('userData'), 'entitlement-seen.bin'))

/** The window closed soon after it appeared on a PC where the app never worked: the next start asks (electron/gpuFallback.ts). */
function noteDarkWindowClose() {
  if (isOwnerBuild() || safeStart) return
  try {
    const data = app.getPath('userData')
    if (asksAtNextStart({ shownAt: windowShownAt, now: Date.now(), everWorked: everWorkedHere(), check: readDarkWindowCheck(data), restarting: restartingForSoftwareDrawing })) {
      writeDarkWindowCheck(data, 'ask')
      startLog('closed soon after the window appeared: the next start asks')
    }
  } catch { /* the question is a help, never a reason for trouble */ }
}

/**
 * The last window closed soon after it appeared (noteDarkWindowClose): was it black? Asked over this start's window once it
 * appears — a window of Windows with an owner comes to the front, one without may stay behind the browser.
 */
async function askIfLastWindowWasDark() {
  const window = mainWindow
  if (isOwnerBuild() || safeStart || darkWindowAsked || !window || window.isDestroyed()) return
  const data = app.getPath('userData')
  if (readDarkWindowCheck(data) !== 'ask') return
  try { writeDarkWindowCheck(data, undefined) } catch { return }
  darkWindowAsked = true
  const { response } = await dialog.showMessageBox(window, { ...DARK_WINDOW_QUESTION, message: 'Окно Raid OS было чёрным?' })
  startLog(response === 0 ? 'player: the last window was black' : 'player: the last window was fine')
  if (response === 0) drawInSoftware({ kind: 'seen-black' })
  else try { writeDarkWindowCheck(data, 'never') } catch { /* asked again next time, at worst */ }
}

/**
 * The build for a player whose window stays black (isSafeStartBuild): some seconds after the window appears, a window of
 * Windows asks whether it can be seen, every start until the player says so. «Нет» copies the text for support and takes the
 * next step (no sandbox, then the report).
 */
const SAFE_START_ASK_MS = 20_000
function askSafeStartBuild() {
  if (!safeStart || readDarkWindowCheck(app.getPath('userData')) === 'never') return
  setTimeout(() => {
    void (async () => {
      const window = mainWindow
      if (darkWindowAsked || restartingForSoftwareDrawing || !window || window.isDestroyed()) return
      darkWindowAsked = true
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Raid OS',
        message: 'Видно окно Raid OS?',
        detail: 'Тестовая сборка. Если окно чёрное, нажмите «Нет»: текст для поддержки скопируется.',
        buttons: ['Да', 'Нет, чёрное'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (window.isDestroyed()) return
      if (response === 0) {
        startLog('player: the window is seen')
        try { writeDarkWindowCheck(app.getPath('userData'), 'never') } catch { /* asked again next start */ }
        return
      }
      startLog('player: the window is black')
      const step = nextStartStep({ kind: 'seen-black' }, { softwareDrawing, noSandbox: gpuFallback.noSandbox === true, painted: firstPicture, disabledByArgument: gpuOffByArgument })
      if (step !== 'report') {
        clipboard.writeText(startSupportText('seen-black'))
        await dialog.showMessageBox(window, { type: 'info', title: 'Raid OS', message: 'Текст скопирован', detail: 'Вставьте его в чат поддержки на raidos.app (Ctrl+V). Raid OS перезапустится без песочницы.', buttons: ['OK'], noLink: true })
      }
      drawInSoftware({ kind: 'seen-black' })
    })()
  }, SAFE_START_ASK_MS).unref()
}

/** The start log's line for this computer once the app is ready: rights, monitors, graphics cards (nothing personal). */
async function logSystem() {
  try {
    const displays = screen.getAllDisplays().map((display) => `${display.size.width}×${display.size.height}@${display.scaleFactor}`)
    const info = await Promise.race([app.getGPUInfo('basic').catch(() => null), new Promise<null>((resolve) => { setTimeout(() => resolve(null), 10_000).unref() })])
    let compositing = '?'
    try { compositing = String((app.getGPUFeatureStatus() as unknown as Record<string, unknown>).gpu_compositing ?? '?') } catch { /* unknown */ }
    startLog(`ready · admin ${isElevated() === true ? 'yes' : 'no'} · displays ${displays.length}: ${displays.join(', ')} · gpu ${describeGpus(info) || '?'} · compositing ${compositing}`)
  } catch { /* the log never stops a start */ }
}

/**
 * Nothing helped (software drawing, no sandbox): a window of Windows itself — it needs no page — with the reason, the last lines
 * of the start log and «Скопировать для поддержки», once a start.
 */
let startFailureShown = false
async function showStartFailure(why: string) {
  if (startFailureShown) return
  startFailureShown = true
  const text = startSupportText(why)
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const options: MessageBoxOptions = {
    type: 'error',
    title: 'Raid OS',
    message: 'Raid OS не смог открыть окно',
    detail: `Не помогли ни отрисовка без видеокарты, ни запуск без песочницы. Нажмите «Скопировать для поддержки» и вставьте текст в чат поддержки на raidos.app.\n\n${startLogTail(app.getPath('userData'), 12)}`,
    buttons: ['Скопировать для поддержки', 'Закрыть'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (response === 0) {
    clipboard.writeText(text)
    const copied: MessageBoxOptions = { type: 'info', title: 'Raid OS', message: 'Текст скопирован', detail: 'Вставьте его в чат поддержки на raidos.app (Ctrl+V).', buttons: ['OK'], noLink: true }
    if (parent && !parent.isDestroyed()) await dialog.showMessageBox(parent, copied)
    else await dialog.showMessageBox(copied)
  }
}
// One copy at a time (electron/singleInstance.ts), checked after the data folder is set: the lock belongs to that folder.
// A copy the app started itself takes the lock in `whenReady`, once the copy it replaces has gone.
const takesLockLater = startedByTheApp(process.argv)
const anotherCopyRuns = !takesLockLater && !app.requestSingleInstanceLock()
if (anotherCopyRuns) leaveForTheRunningCopy()
/** Nothing has run yet: no window, no settings, no verdict on a staged build, none of the quit handlers. */
function leaveForTheRunningCopy() {
  abandonStagedBoot()
  app.exit(0)
}
/** The permissions the app's pages may get (setPermissionRequestHandler below); everything else is refused. */
// pointerLock: the range's scope takes the mouse while aiming (src/range/RangeScopeView.tsx), on a click only; Esc gives it back
const PAGE_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications', 'fullscreen', 'pointerLock'])
let mainWindow: BrowserWindow | null = null
/**
 * Players' Tarkov.dev profiles straight from this computer through Chromium's network, never through our server (owner,
 * 13.10.2026: Cloudflare refuses our VPS on players.tarkov.dev; «если все таки запрос будет от компьютера пользователя,
 * то блокировка маловероятна, поэтому давай все таки искать через тарков дев»). A session of its own: the page's session
 * cancels every request of the page to players.tarkov.dev in the players' build, and this one is the main process's.
 */
const profileFetch: JsonFetch = async (url) => {
  const response = await session.fromPartition('raidos-player-profiles').fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  return { status: response.status, json: () => response.json() }
}
const playerProfileFromPc = cachedProfileLookup(profileFetch)
/** Log folders the page may ask to watch (electron/logFolders.ts): found by discovery or picked in the folder dialog. */
const logFolderGrants = new LogFolderGrants()
/** The Logs folder followed last (found by this process, or picked in the dialog of an older version). */
const pickedLogsFolderFile = () => join(app.getPath('userData'), 'logs-folder.json')
async function rememberedLogsFolder() {
  const value = (JSON.parse(await readFile(pickedLogsFolderFile(), 'utf8')) as { folder?: unknown }).folder
  return typeof value === 'string' ? value : ''
}
/** What the logs gave so far, kept for the next start (electron/logScanner.ts). */
const logCacheFile = () => join(app.getPath('userData'), 'logs-cache.json')
/** The catalog's trader quest ids per mode, from the page (`logs:set-quest-ids`): resets count only for these. */
const logQuestIdsFile = () => join(app.getPath('userData'), 'logs-quest-ids.json')
const QUEST_ID = /^[a-f0-9]{24}$/i

/** A file of this process replaced at once (never half-written). */
async function writeAtomically(file: string, text: string) {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
  } catch {
    await unlink(temporary).catch(() => {})
  }
}

/**
 * The game's logs from this process alone, from the app's start (electron/logWatcher.ts): the Logs folder is found and
 * followed before sign-in, the page gets what was read through `logs:updated` and asks for the latest on opening.
 */
/** Whether the game runs, asked of the task list at most every 30 s (the log watcher asks only while its logs say «in a raid»). */
let tarkovRunning: { at: number; value: Promise<boolean | null> } | null = null
function tarkovRunningRecently() {
  // The game's window in front proves it runs: no `tasklist` process then — in a raid the log watcher asked for one
  // every 30 s while the player played (report 227, 25.11.2026: «игра фризит»).
  if (foregroundGame()) return Promise.resolve(true)
  if (!tarkovRunning || Date.now() - tarkovRunning.at > 30_000) tarkovRunning = { at: Date.now(), value: isTarkovRunning() }
  return tarkovRunning.value
}

const logWatcher = createLogWatcher({
  discover: async ({ thorough, extra }) => {
    const found = await discoverAllEftLogs(app.getPath('appData'), thorough ? { fresh: true } : { drives: false, lookupMaxAgeMs: 10 * 60_000 })
    const remembered = await rememberedLogsFolder().catch(() => '')
    const folders = [...extra, remembered || undefined, ...found]
    // the Steam build writes its screenshots beside its logs: that folder is followed for the position too
    setGameLogFolders(folders)
    return freshestLogsFolder(folders)
  },
  scan: (root, options) => scanLogFolderBySession(root, options),
  identity: (root, options) => scanLogIdentity(root, options),
  raidState: (root) => readRaidState(root),
  send: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
    if (channel === 'logs:updated') void pushToDevelopmentServer(payload as ModeLogScanResult)
  },
  gameWindow: () => foregroundGame()?.id ?? null,
  gameRunning: () => tarkovRunningRecently(),
  // Constant tracking (owner, 15.10.2026): the Logs folder with its launch folders, recursive (Windows and Node 20+).
  watchFolder: (root, onChange, onError) => {
    const watcher = watchFs(root, { recursive: true, persistent: false }, () => onChange())
    watcher.on('error', onError)
    return () => { try { watcher.close() } catch { /* closed already */ } }
  },
  exists: async (root) => Boolean(await stat(root).then((info) => info.isDirectory()).catch(() => false)),
  onFolder: (folder) => {
    logFolderGrants.grant(folder)
    void rememberedLogsFolder().catch(() => '').then((remembered) => {
      if (remembered !== folder) void writeAtomically(pickedLogsFolderFile(), JSON.stringify({ folder }))
    })
  },
  onRaidOver: () => clearRaidSignals(),
  loadKept: async () => {
    // The logs read in the last run: the first scan after a start reads only what is new.
    await loadLogCache(logCacheFile()).catch(() => 0)
    let parsed: { modes?: Record<string, unknown> } = {}
    try { parsed = JSON.parse(await readFile(logQuestIdsFile(), 'utf8')) as typeof parsed } catch { /* none kept yet */ }
    const ids: QuestIdsByMode = {}
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
      const list = parsed.modes?.[mode]
      if (Array.isArray(list)) ids[mode] = list.filter((id): id is string => typeof id === 'string' && QUEST_ID.test(id)).slice(0, 5000)
    }
    return ids
  },
  saveQuestIds: (ids) => writeAtomically(logQuestIdsFile(), JSON.stringify({ modes: ids })),
  saveCache: () => saveLogCache(logCacheFile()),
})


// UI hover ticks must play before the first click in the window.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/**
 * The players' exe (client edition, packaged): game data only through the server with a subscription
 * (docs/subscription-protection.md) — no DevTools, no reload shortcuts, no direct tarkov.dev requests from the pages.
 * RAIDOS_DATA_GATEWAY=1 turns the same data routing on in a development run of the client edition.
 */
const dataGatewayOnly = app.isPackaged || process.env.RAIDOS_DATA_GATEWAY === '1'
// Item pictures through the main process (electron/itemImages.ts); a scheme is registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: ITEM_IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

/** Release client: DevTools closed at once and the reload / DevTools keys ignored, in every window and webview. */
function lockDevTools(contents: WebContents) {
  contents.on('devtools-opened', () => contents.closeDevTools())
  contents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    const ctrl = input.control || input.meta
    if (key === 'f12' || key === 'f5' || (ctrl && key === 'r') || (ctrl && input.shift && ['i', 'j', 'c'].includes(key))) event.preventDefault()
  })
}
// Owner, 09.11.2026: «нужно максимально защитить приложение» — every packaged build, the owner's too, keeps DevTools shut.
if (app.isPackaged) app.on('web-contents-created', (_event, contents) => lockDevTools(contents))

/** The main window on a Full HD screen (bigger screens: in proportion, electron/uiScale.ts). */
const MAIN_WINDOW = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }
/** A page that never paints still gets its window, with whatever it has. */
const WINDOW_REVEAL_MAX_MS = 5000

function createWindow() {
  // Sizes are for a Full HD screen; a bigger one gets them (and the page zoom) in proportion (electron/uiScale.ts).
  const display = screen.getPrimaryDisplay()
  const size = scaledWindowSize(MAIN_WINDOW, displayScale(display), display.workArea)
  const trialWindow = trialLaunchesAtStart() > 0
  // Where it was left (electron/windowState.ts); a monitor that is gone gives the usual size.
  const stateFile = join(app.getPath('userData'), 'window-state.json')
  const saved = readSavedWindow(stateFile)
  const restored = saved && restoredBounds(saved, screen.getAllDisplays().map((entry) => entry.workArea), { width: size.minWidth, height: size.minHeight })
  // An upright monitor or a small screen: the first start fills it (electron/uiScale.ts opensMaximized).
  const maximizeAtStart = !restored && opensMaximized(size, display.workArea)
  // The page starts at the zoom of the monitor it opens on: no first picture at another zoom (electron/uiScale.ts).
  const startZoom = displayScale(restored ? screen.getDisplayMatching(restored) : display)
  mainWindow = new BrowserWindow({
    ...size,
    ...(restored ?? {}),
    backgroundColor: '#0d1110',
    // Shown with its first picture (owner, 07.11.2026: «маленький квадрат темный, и остальной экран белый, кусками»): before that Windows
    // draws an empty window at whatever size it has.
    show: false,
    title: trialWindow ? 'Raid OS — тестовая версия' : 'Raid OS',
    // The window and taskbar icon (the exe file itself gets build/icon.ico from electron-builder).
    icon: join(appDir, '../../dist/app-icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(appDir, '../../electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload.cjs only needs contextBridge + ipcRenderer from 'electron', which a sandboxed preload may require.
      sandbox: true,
      // No <webview> at all (security review, 03.11.2026): the app embeds no pages (WEBVIEW_HOSTS is empty).
      webviewTag: false,
      // Minimized or hidden, the window must cost the game nothing: Chromium then stops drawing it (animations,
      // requestAnimationFrame, the 3D mask) and slows its timers to once a second. IPC still arrives at once, so the
      // item lookup's questions (experimental:query) and log sync keep working. With `false` a minimized window kept
      // rendering at 60 fps and stayed "visible" to the page. While it is only unfocused, see src/app/appActivity.ts.
      backgroundThrottling: false,
      // The players' exe: no DevTools at all (lockDevTools also covers webviews).
      devTools: !app.isPackaged,
      // One zoom for the whole window, its monitor's, not one per page address (report 234, electron/uiScale.ts).
      zoomFactor: startZoom,
      zoomMode: INTERFACE_ZOOM_MODE,
    },
  })

  // The owner's copy started a build staged by a partial update: its page loaded, so that build works (electron/deltaBoot.ts).
  mainWindow.webContents.once('did-finish-load', confirmStagedBoot)
  mainWindow.webContents.once('did-finish-load', () => { pageLoaded = true })
  // The page's own title would replace it: beside the real app, the tester must see which one this is.
  if (trialWindow) mainWindow.on('page-title-updated', (event) => event.preventDefault())
  followDisplayScale(mainWindow, { width: MAIN_WINDOW.minWidth, height: MAIN_WINDOW.minHeight })
  // Again, now that the minimum size is that monitor's own: a monitor with another scale would have changed the size given above.
  if (restored) {
    mainWindow.setBounds(restored)
  }
  // maximize() also shows a hidden window, so it waits for the picture too. Whatever happens to the page, the window does not stay hidden.
  const reveal = () => {
    clearTimeout(revealAnyway)
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    if ((restored && saved?.maximized) || maximizeAtStart) mainWindow.maximize()
    else mainWindow.show()
    windowShownAt = Date.now()
    askSafeStartBuild()
    // The last window closed soon after it appeared on a PC where the app never worked: was it black? «Да» restarts it.
    void askIfLastWindowWasDark()
    // Still there after DARK_WINDOW_MS with its picture: a start that showed its window (the sandbox comes back after a few).
    setTimeout(noteShownWindow, DARK_WINDOW_MS).unref()
  }
  const revealAnyway = setTimeout(reveal, WINDOW_REVEAL_MAX_MS)
  mainWindow.once('ready-to-show', reveal)
  // Nothing drawn, or the page gone before its first picture: the graphics card is blamed once (electron/gpuFallback.ts)
  const noPicture = setTimeout(() => drawInSoftware({ kind: 'no-picture' }), FIRST_PAINT_MS)
  mainWindow.once('ready-to-show', () => { firstPicture = true; clearTimeout(noPicture); startLog('first picture') })
  mainWindow.webContents.on('render-process-gone', (_event, details) => drawInSoftware({ kind: 'page-gone', reason: details.reason }))
  watchStart(mainWindow)
  rememberWindow(mainWindow, stateFile)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalLink(url, mainWindow)
    return { action: 'deny' }
  })
  // Only the app's own page (dist/index.html, or exactly the dev server's origin): not http://127.0.0.1.evil.com.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppPage(url)) event.preventDefault()
  })
  // The app embeds no pages: a <webview> never gets the app's preload or Node, and none attaches (trustedPages.ts).
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    delete (webPreferences as { preloadURL?: string }).preloadURL
    webPreferences.sandbox = true
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!isEmbeddableWebviewUrl(params.src)) event.preventDefault()
  })

  // The only window: closing it ends the app.
  mainWindow.on('closed', () => {
    noteDarkWindowClose()
    mainWindow = null
    stopExperimental()
    stopScreenTuning()
    stopMapFloorWheel()
    app.quit()
  })

  loadRenderer(mainWindow, '')
}

function loadRenderer(window: BrowserWindow, hash: string) {
  const devUrl = devRendererUrl()
  if (devUrl) void window.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void window.loadFile(APP_INDEX_FILE, hash ? { hash } : undefined)
}

// What a second start sends (its command line and folder) is not read: it may only bring the window forward.
// A start again soon after the window appeared may mean the player sees it black: then a window of Windows asks.
app.on('second-instance', () => {
  bringToFront(mainWindow)
  void askIfDarkAfterSecondStart()
})

app.whenReady().then(async () => {
  if (anotherCopyRuns) return
  if (takesLockLater) {
    await waitForPreviousCopy()
    if (!(await waitForInstanceLock(() => app.requestSingleInstanceLock()))) { leaveForTheRunningCopy(); return }
  }
  // The usual second start has no rights and this copy has them (the start below), and Windows would not let it reach here.
  if (isElevated() === true) allowSecondStartMessages(app.getPath('userData'))
  // The second «Raid OS» Electron wrote in the Start menu under its old ID goes (report 252, electron/startMenuIdentity.ts).
  if (installerIdentity) removeStaleStartMenuShortcut()
  // Server, tunnel and owner controls exist only in the owner build (electron/buildEdition.ts): a player's copy
  // ignores --enable-local-server / --server-mode / --enable-tunnel.
  const ownerBuild = isOwnerBuild()
  if (ownerBuild) {
    await enableFromCommandLine(process.argv)
    await enableTunnelFromCommandLine(process.argv)
  }
  const serverMode = ownerBuild && isServerMode()
  // No File / Edit / View / Window menu in any build, not even on Alt (owner, 09.11.2026: «что бы по нажатию ALT не
  // открывалось это меню и что бы оно вообще не открывалось»).
  Menu.setApplicationMenu(null)
  // Paid data never goes to tarkov.dev straight from the pages: the renderer routes it through the server
  // (src/data/tarkovApi.ts); anything that slips past, including an image URL, is cancelled here.
  // Item pictures (https://raidos.app/v1/item-images/…) are redirected to raidos-img:// and fetched here, the same way
  // as the data (electron/itemImages.ts). One listener: Electron keeps only the last onBeforeRequest of a session.
  // Sources in order: the app's own server (where the data comes from), raidos.app, the same through Chromium's network
  // (system proxy; a separate session, so this redirect and the tarkov.dev block below do not apply), tarkov.dev. The next
  // one starts when one fails or hangs, and the one that answered goes first after that (createSourceRace).
  const imageSession = session.fromPartition('raidos-item-images')
  const chromiumFetch = (url: string, init: { signal: AbortSignal }) => imageSession.fetch(url, init)
  const ownServer = (file: string) => { try { const base = apiBaseUrl(); return isLocalAddress(base) || `${base}/v1/item-images/` === ITEM_IMAGE_ORIGIN ? null : `${base}/v1/item-images/${file}` } catch { return null } }
  const answerItemImage = createItemImageResponder(join(app.getPath('userData'), 'item-images'), [
    { name: 'app server', url: ownServer, fetch },
    { name: 'raidos.app', url: (file) => `${ITEM_IMAGE_ORIGIN}${file}`, fetch },
    { name: 'raidos.app (Chromium)', url: (file) => `${ITEM_IMAGE_ORIGIN}${file}`, fetch: chromiumFetch },
    { name: 'tarkov.dev', url: tarkovDevImageUrl, fetch: chromiumFetch },
  ])
  const answerMapFile = createMapFileResponder([
    { name: 'raidos.app', url: (path) => `${MAP_FILE_ORIGIN}${path}`, fetch },
    { name: 'raidos.app (Chromium)', url: (path) => `${MAP_FILE_ORIGIN}${path}`, fetch: chromiumFetch },
    { name: 'tarkov.dev', url: tarkovDevMapUrl, fetch: chromiumFetch },
  ])
  // «Сборка оружия»: the part pictures inside the app, one encrypted pack (electron/gunParts.ts)
  const answerGunPart = createGunPartResponder(join(dirname(APP_INDEX_FILE), 'gun-parts.pack'))
  // «Тир»: its pictures, a test build only (src/range/rangeFigures.ts)
  const answerRangeFigure = createGunPartResponder(join(dirname(APP_INDEX_FILE), RANGE_PACK_NAME), undefined, 'range', RANGE_PACK_FILE)
  protocol.handle(ITEM_IMAGE_SCHEME, (request) => {
    const host = new URL(request.url).hostname
    return host === 'map' ? answerMapFile(request.url) : host === 'parts' ? answerGunPart(request.url) : host === 'range' ? answerRangeFigure(request.url) : answerItemImage(request.url)
  })
  // What the page may ask for (security review, 03.11.2026): copying text, the owner panel's notifications, full screen
  // for a video. Camera, microphone, the screen, location, USB and the rest are refused without asking — the app runs as
  // administrator, and Electron would otherwise grant them all.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(PAGE_PERMISSIONS.has(permission)))
  const blocked = dataGatewayOnly ? ['https://api.tarkov.dev/*', 'https://json.tarkov.dev/*', 'https://players.tarkov.dev/*', 'https://assets.tarkov.dev/*'] : []
  session.defaultSession.webRequest.onBeforeRequest({ urls: [`${ITEM_IMAGE_ORIGIN}*`, `${MAP_FILE_ORIGIN}*`, ...blocked] }, (details, callback) => {
    const local = itemImageRedirect(details.url) ?? mapFileRedirect(details.url)
    if (local) callback({ redirectURL: local })
    else callback(details.url.startsWith(ITEM_IMAGE_ORIGIN) || details.url.startsWith(MAP_FILE_ORIGIN) ? {} : { cancel: true })
  })
  // The signed entitlement is renewed every few hours while the app runs (electron/entitlement.ts).
  if (!ownerBuild) setInterval(() => { void refreshEntitlement().catch(() => undefined) }, ENTITLEMENT_REFRESH_MS).unref()
  // Always with administrator rights (owner, 15.10.2026: «приложение запускается всегда от имени администратора»; the
  // settings switch went): the BSG launcher runs the game elevated, and Windows hides its keys from apps that are not.
  // The exe asks for no rights in its manifest, so the app starts itself again with them; when the prompt is refused
  // it simply goes on without them (the settings then offer «Перезапустить от имени администратора»).
  if (!serverMode && process.platform === 'win32' && !isElevatedRelaunch() && relaunchAsAdmin()) return
  void logSystem()
  // The installed app's first start after «Установить» in the portable exe: that exe goes (electron/appInstall.ts).
  removeMigratedPortable()
  // What the portable exe left in %TEMP% on earlier starts goes a minute in, never while the game runs (same file).
  setTimeout(() => { void removePortableLeftovers(async () => await isTarkovRunning() !== false) }, 60_000).unref()
  registerIpc()
  createWindow()
  // A test build for friends counts its launches and removes itself after the last one (electron/trial.ts).
  if (!serverMode && !(await startTrial(() => mainWindow))) return
  // The server laptop: no game features, the window waits minimized (closing it stops the server).
  if (serverMode) mainWindow?.minimize()
  // A friend's (or the owner's gaming) copy updates itself from the server laptop's site.
  else if (!isTrialBuild() && !isTestBuild()) startUpdateChecks((status) => mainWindow?.webContents.send('update:status', status), { inRaid: async () => {
    // No game running = no raid, whatever the last log says (a game closed or crashed mid-raid never logs the end).
    if (await isTarkovRunning() === false) return false
    if (logWatcher.raidState().inRaid) return true
    const folder = logWatcher.folder() || (await discoverEftLogs(app.getPath('appData')))?.logsFolder
    return folder ? (await readRaidState(folder)).inRaid : false
  }, gameRunning: async () => await isTarkovRunning() === true, applyLive: (indexFile) => loadLiveRenderer(mainWindow, indexFile), windowIdle: () => windowNotInUse(mainWindow) })
  if (!serverMode) startExperimental({
    mainWindow: () => mainWindow,
    raidState: () => logWatcher.raidState(),
    logsRoot: async () => logWatcher.folder() || (await discoverEftLogs(app.getPath('appData')).catch(() => null))?.logsFolder || '',
    logsWatched: () => Boolean(logWatcher.folder()),
  })
  // «Настройка экрана» and «Оптимизировать компьютер» (electron/screenTuning): the players' PC app.
  if (!serverMode) startScreenTuning({ inRaid: () => logWatcher.raidState().inRaid || raidLikely() })
  // Alt + the wheel from the game steps the map's floors, for the accounts given it (electron/mapFloorWheel.ts).
  if (!serverMode) startMapFloorWheel(() => mainWindow)
  // The game's logs from the start, before sign-in (#202): the account, the mode and the raid state within seconds.
  if (!serverMode) logWatcher.start()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  // What the API process may ask this app (electron/apiChannel.ts): the «Обновление» tab and error reports.
  if (ownerBuild) {
    handleApiRequest('payments:yookassa:get', async () => {
      const saved = await paymentSettings()
      return { shopId: saved.shopId, monthPrice: saved.monthPrice, receipts: saved.receipts, streamerPercent: saved.streamerPercent, autopay: saved.autopay, hasKey: saved.hasKey }
    })
    handleApiRequest('payments:yookassa:set', async (payload) => {
      const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const saved = await setPaymentSettings({ shopId: input.shopId, monthPrice: input.monthPrice, receipts: input.receipts, streamerPercent: input.streamerPercent, autopay: input.autopay })
      const environment = await apiEnvironment('https://raidos.app')
      return { settings: { shopId: saved.shopId, monthPrice: saved.monthPrice, receipts: saved.receipts, streamerPercent: saved.streamerPercent, autopay: saved.autopay, hasKey: saved.hasKey }, env: Object.fromEntries(Object.entries(environment).filter(([key]) => key.startsWith('YOOKASSA_') || ['TARKOV_PRICE_MONTH_RUB', 'TARKOV_STREAMER_PERCENT', 'TARKOV_PUBLIC_URL'].includes(key))) }
    })
    handleApiRequest('self-update:status', () => selfUpdateStatus())
    handleApiRequest('self-update:check', () => checkSelfUpdateNow())
    handleApiRequest('self-update:install', (payload) => installSelfUpdateNow(payload))
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

// The lock goes first: the process can stay some seconds after its window has closed, and a start in that time must open
// the app, not silently ask a window that is gone to come forward.
app.on('will-quit', () => { app.releaseSingleInstanceLock(); stopScreenTuning(); stopServerSelfUpdate(); stopServerMonitor(); stopTunnel(); stopLocalServer(); finishTrial() })

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalLink(url, mainWindow)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('https://tarkov.dev/')) return
    event.preventDefault()
    void openExternalLink(url, mainWindow)
  })
})

let linkDialogOpen = false
/**
 * Opens a link from a page in the system browser (electron/externalLinks.ts): known sites at once, any other HTTPS page
 * only after a native dialog with the full address, everything else never. One dialog at a time: a page that opens
 * links in a loop cannot pile them up.
 */
async function openExternalLink(url: string, parent: BrowserWindow | null) {
  const policy = externalLinkPolicy(url)
  if (policy === 'refuse') return false
  if (policy === 'confirm') {
    if (linkDialogOpen) return false
    linkDialogOpen = true
    try {
      const options: MessageBoxOptions = { type: 'warning', buttons: ['Открыть', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true, title: 'Внешняя ссылка', ...externalLinkPrompt(url) }
      const window = parent && !parent.isDestroyed() ? parent : null
      const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      if (response !== 0) return false
    } finally {
      linkDialogOpen = false
    }
  }
  await shell.openExternal(url).catch(() => undefined)
  return true
}

let ownerDialogOpen = false
/**
 * Owner settings that decide where money, one-time codes, reports or server code go change only after the owner
 * confirms in a native dialog of this process (electron/ownerConfirm.ts): a compromised page cannot change them silently.
 */
async function confirmOwnerChange(event: IpcMainInvokeEvent, change: OwnerChange, payload: unknown) {
  if (ownerDialogOpen) throw new Error('Сначала ответьте на открытый запрос подтверждения')
  ownerDialogOpen = true
  try {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    const options: MessageBoxOptions = { type: 'warning', buttons: ['Сохранить', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true, title: 'Raid OS — подтверждение', ...ownerChangePrompt(change, payload) }
    const { response } = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (response !== 0) throw new Error('Изменение отменено')
  } finally {
    ownerDialogOpen = false
  }
}

app.on('window-all-closed', () => {
  logWatcher.stop()
  if (process.platform !== 'darwin') app.quit()
})

const OWNER_CHANNELS = [
  'local-server:status', 'local-server:set-enabled', 'tunnel:status', 'tunnel:set', 'tunnel:set-named',
  'server-watchdog:status', 'server-watchdog:restart', 'server-watchdog:check',
  'owner:payments', 'owner:set-payments', 'owner:streamers', 'owner:invite-streamer', 'owner:emails', 'owner:set-emails',
  'owner:sms', 'owner:set-sms', 'owner:sms-status', 'owner:sms-test',
  'owner:email', 'owner:set-email', 'owner:email-status', 'owner:email-test',
  'owner:error-reports', 'owner:set-error-reports', 'owner:error-reports-test',
  'owner:server-update', 'owner:set-server-update', 'owner:server-update-check', 'owner:server-update-install', 'owner:server-update-rollback',
  // The players' app never changes its server: it trusts only the entitlement key built into it (electron/entitlement.ts).
  'account:set-server-url',
]

function registerIpc() {
  ipcMain.handle('app:clear-data', async () => {
    // Everything read from the logs is forgotten too; they are found and read again from the start.
    logWatcher.stop()
    await clearLogCaches(logCacheFile()).catch(() => undefined)
    if (!mainWindow) return false
    await clearScanFrames().catch(() => 0)
    await clearGameCache()
    await mainWindow.webContents.session.clearStorageData({ storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] })
    if (!(isOwnerBuild() && isServerMode())) logWatcher.start()
    return true
  })
  ipcMain.handle('service:request', async (_event, method: string, path: string, body: unknown) => serviceRequest(method, path, body))
  // Paid game data cache: encrypted with safeStorage, only while the entitlement is valid (electron/gameDataCache.ts).
  ipcMain.handle('data-cache:get', async (_event, key: unknown) => readGameCache(await gameCacheAccess(), key))
  ipcMain.handle('data-cache:set', async (_event, key: unknown, value: unknown, maxAgeMs: unknown) => writeGameCache(await gameCacheAccess(), key, value, maxAgeMs))
  // true: this copy gets game data only through the server (src/data/tarkovApi.ts). Read once by the preload.
  ipcMain.on('app:data-gateway', (event) => { event.returnValue = dataGatewayOnly })
  // Server account: the session token never leaves the main process; the renderer only sees e-mail and status.
  ipcMain.handle('account:status', () => accountStatus())
  // Which app this is: 'owner' (server controls) or 'client' (players). Read once by the preload, synchronously.
  ipcMain.on('app:edition', (event) => { event.returnValue = buildEdition() })
  ipcMain.on('map:floor-wheel', (_event, on: unknown) => { setMapFloorWheel(on === true) })
  // The server laptop (owner build + --server-mode): the renderer skips catalog polling (src/data/catalogRefresh.ts).
  ipcMain.on('app:server-mode', (event) => { event.returnValue = isOwnerBuild() && isServerMode() })
  // window.confirm() of the page (src/app/nativeConfirm.ts): a dialog of this process, after which the window still takes
  // typed keys (electron/confirmDialog.ts). Not the blocking one: the page waits for the answer, this process does not.
  ipcMain.on('app:confirm', async (event, message: unknown, locale: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = confirmDialogOptions(message, locale)
    try {
      const { response } = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      event.returnValue = response === 0
    } catch {
      event.returnValue = false
    }
  })
  // «Войти в мобильную версию»: a two-minute one-time code in a website link, never the session token.
  ipcMain.handle('account:mobile-login', () => mobileLoginLink())
  // The public website address (streamer links, QR codes): the server's site, or this PC's public link.
  ipcMain.handle('account:website-url', () => websiteBase({ forPhone: true }))
  ipcMain.handle('account:login', (_event, email: unknown, password: unknown) => accountLogin(email, password))
  // «Войти по QR-коду» on this PC: the phone signed in to the account approves it (serviceGateway.ts accountQrStart).
  ipcMain.handle('account:qr-start', async () => {
    const request = await accountQrStart()
    const site = await websiteBase({ forPhone: true })
    return { ...request, url: `${site}/app-login#${new URLSearchParams({ approve: request.code }).toString()}` }
  })
  ipcMain.handle('account:qr-poll', () => accountQrPoll())
  ipcMain.handle('account:logout', () => accountLogout())
  // Sign-in / password reset by phone after the SMS code: the new session stays in the main process.
  ipcMain.handle('account:phone-sign-in', (_event, kind: unknown, challengeId: unknown, code: unknown, password: unknown) => accountPhoneSignIn(kind, challengeId, code, password))
  // The same after an e-mail code (sign-in or «Забыли пароль?» by e-mail).
  ipcMain.handle('account:email-sign-in', (_event, kind: unknown, challengeId: unknown, code: unknown, password: unknown) => accountEmailSignIn(kind, challengeId, code, password))
  // Registration in the app (the account window): the session of a new account stays in the main process as well.
  ipcMain.handle('account:register', (_event, email: unknown, password: unknown, referralCode: unknown, country: unknown) => accountRegister(email, password, referralCode, country))
  ipcMain.handle('account:register-confirm', (_event, challengeId: unknown, code: unknown) => accountRegisterConfirm(challengeId, code))
  ipcMain.handle('account:open-website', async (_event, page: unknown) => {
    // 'admin': the owner's «Админ-панель» on the site (the server itself refuses it to anybody but the owner).
    const path = page === 'register' ? '/register' : page === 'admin' && isOwnerBuild() ? '/admin' : '/cabinet'
    const target = `${await websiteBase()}${path}`
    if (!isExternalAllowed(target)) return false
    await shell.openExternal(target)
    return true
  })
  // The page's status line and the locked app's re-check (src/account/eftAccountLink.ts): this process found and follows
  // the logs already; the answer is what it has (the identity at least), sent again through `logs:updated` too, where the
  // page applies it (once: src/import/logResults.ts). Nothing is discovered or read again for a page that opens or
  // re-renders. `current`: the folder the page used last, looked at only while none is followed (when it may be watched).
  ipcMain.handle('logs:auto-find-and-scan', async (event, current: unknown) => {
    const known = !logWatcher.folder() && typeof current === 'string' && current && await mayWatchLogFolder(current, {
      grants: logFolderGrants,
      remembered: rememberedLogsFolder,
      discover: async () => (await discoverEftLogs(app.getPath('appData'))).logsFolder,
    }) ? current : undefined
    const status = await logWatcher.ready(known ? [known] : [])
    if (!status.folder) return null
    if (status.result && !event.sender.isDestroyed()) event.sender.send('logs:updated', status.result)
    return status.result ?? emptyLogScan(status.folder)
  })

  // The catalog's trader quest ids of a mode (src/app/AppShell.tsx, when the catalog loads): only those reveal a reset.
  ipcMain.handle('logs:set-quest-ids', async (_event, mode: unknown, ids: unknown) => {
    if ((mode !== 'pvp' && mode !== 'pve' && mode !== 'seasonal') || !Array.isArray(ids) || ids.length > 5000) return false
    return logWatcher.setQuestIds(mode, ids.filter((id): id is string => typeof id === 'string' && QUEST_ID.test(id)))
  })

  // «Где искали журналы»: every place looked at and every Logs folder found — paths only, shown to the player.
  ipcMain.handle('logs:search-report', async () => eftLogSearchReport(app.getPath('appData')))

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
    // Picked by the player in the dialog: may be watched now and after a restart (remembered here, not by the page).
    logFolderGrants.grant(folder)
    await writeAtomically(pickedLogsFolderFile(), JSON.stringify({ folder }))
    logWatcher.watch(folder)
    const status = await logWatcher.ready()
    return status.result ?? emptyLogScan(folder)
  })

  ipcMain.handle('logs:start-watching', async (_event, folder: unknown) => {
    // Only the game's Logs folder found by discovery or a folder picked in the dialog, never any path from the page.
    if (typeof folder !== 'string' || !(await mayWatchLogFolder(folder, {
      grants: logFolderGrants,
      remembered: rememberedLogsFolder,
      discover: async () => (await discoverEftLogs(app.getPath('appData'))).logsFolder,
    }))) return false
    const info = await stat(folder).catch(() => null)
    if (!info?.isDirectory()) return false
    logWatcher.watch(folder)
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

  // The build that runs (its build-info.json): after a partial update that is the staged build, not the exe's package.json;
  // after a live update of the interface the version of the page the window shows (electron/appUpdate.ts).
  ipcMain.handle('app:version', () => rendererVersion())
  // Trader restock reminders (src/restock/RestockNotifier.tsx) and «Торговля» (src/trading/TradingNotifier.tsx, with the item's
  // picture): a system notification. The picture is only ever a PNG the page drew itself, of a sane size.
  // Never over the game (owner, 07.11.2026: «Все уведомления в приложении не должны открываться поверх игры»): the message waits in
  // «Уведомления» on the top bar (src/notifications).
  // `silent`: the page plays its own sound, or none (the raid start's switch in «Уведомления» → «Настроить»)
  ipcMain.handle('app:notify', (_event, title: unknown, body: unknown, icon?: unknown, silent?: unknown) => {
    if (!Notification.isSupported() || foregroundGame() !== null) return false
    const text = (value: unknown, max: number) => String(value ?? '').slice(0, max)
    const picture = typeof icon === 'string' && icon.length < 300_000 && icon.startsWith('data:image/png;base64,') ? nativeImage.createFromDataURL(icon) : undefined
    const notification = new Notification({ title: text(title, 120), body: text(body, 300), silent: silent === true, ...(picture && !picture.isEmpty() ? { icon: picture } : {}) })
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
  ipcMain.handle('tunnel:set-named', async (event, hostname: unknown, token: unknown) => {
    await confirmOwnerChange(event, 'tunnel', { hostname, token })
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
  ipcMain.handle('owner:set-payments', async (event, settings: unknown) => {
    await confirmOwnerChange(event, 'payments', settings)
    const result = await setPaymentSettings(settings)
    await restartApi()
    return result
  })
  // «SMS: одноразовые коды»: provider and key only from this app (never the website); the API restarts to pick them up.
  ipcMain.handle('owner:sms', () => smsSettings())
  ipcMain.handle('owner:set-sms', async (event, settings: unknown) => {
    await confirmOwnerChange(event, 'sms', settings)
    const result = await setSmsSettings(settings)
    await restartApi()
    return result
  })
  ipcMain.handle('owner:sms-status', () => smsServerStatus())
  ipcMain.handle('owner:sms-test', (_event, phone: unknown) => sendTestSms(phone))
  // «Почта: коды подтверждения»: the same rule — provider and key only from this app, never from the website.
  ipcMain.handle('owner:email', () => emailSettings())
  ipcMain.handle('owner:set-email', async (event, settings: unknown) => {
    await confirmOwnerChange(event, 'email', settings)
    const result = await setEmailSettings(settings)
    await restartApi()
    return result
  })
  ipcMain.handle('owner:email-status', () => emailServerStatus())
  ipcMain.handle('owner:email-test', (_event, to: unknown) => sendTestEmail(to))
  // «Отчёты об ошибках (GitHub)»: repository, write-only token (safeStorage), on/off, test (electron/errorReporter.ts).
  ipcMain.handle('owner:error-reports', () => errorReportSettings())
  ipcMain.handle('owner:set-error-reports', async (event, settings: unknown) => {
    await confirmOwnerChange(event, 'error-reports', settings)
    return setErrorReportSettings(settings)
  })
  ipcMain.handle('owner:error-reports-test', () => testErrorReports())
  // «Автообновление сервера» on the server laptop (electron/selfUpdate.ts).
  ipcMain.handle('owner:server-update', () => selfUpdateStatus())
  ipcMain.handle('owner:set-server-update', async (event, settings: unknown) => {
    await confirmOwnerChange(event, 'server-update', settings)
    await setSelfUpdateSettings(settings)
    return selfUpdateStatus()
  })
  ipcMain.handle('owner:server-update-check', () => checkSelfUpdateNow())
  ipcMain.handle('owner:server-update-install', () => installSelfUpdateNow({ confirm: true }))
  ipcMain.handle('owner:server-update-rollback', () => rollbackToPrevious({ confirm: true }))
  ipcMain.handle('owner:streamers', () => listStreamers())
  ipcMain.handle('owner:emails', () => ownerEmails())
  ipcMain.handle('owner:set-emails', async (event, emails: unknown) => {
    await confirmOwnerChange(event, 'owner-emails', emails)
    const result = await setOwnerEmails(emails)
    await restartApi() // the API reads TARKOV_OWNER_EMAILS on start
    return result
  })
  ipcMain.handle('owner:invite-streamer', async (_event, code: unknown) => inviteStreamer(code, (await publicSiteUrl()) || LOCAL_SITE_URL))
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:install', () => installUpdate({ manual: true }))
  // «Загрузить обновление» while the game runs: download only, then «Обновить сейчас?» (src/components/UpdateButton.tsx).
  ipcMain.handle('update:download', () => downloadUpdate())
  // The portable exe: the installer, once the site publishes it (src/components/InstallerOffer.tsx).
  ipcMain.handle('update:installer-offer', () => installerOffer())
  ipcMain.handle('update:install-setup', () => installFromPortable())
  // Settings → «Проверить обновление приложения», «Автообновление», «Автоустановка»
  ipcMain.handle('update:check', () => checkForUpdateNow())
  ipcMain.handle('update:settings', () => updateSettings())
  ipcMain.handle('update:set-settings', (_event, patch: unknown) => setUpdateSettings(patch))
  // A player's copy (client build) has no server, tunnel or owner controls at all, not even hidden ones.
  if (!isOwnerBuild()) for (const channel of OWNER_CHANNELS) ipcMain.removeHandler(channel)

  ipcMain.handle('profile:refresh', async (_event, rawMode: unknown, rawAccountId: unknown) => {
    const mode = validateMode(rawMode)
    const accountId = Number(rawAccountId)
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Некорректный идентификатор профиля')
    // From this PC only (see profileFetch), in the background (account/logNickname.ts); the owner's development copy may
    // still try Node's fetch.
    const snapshot = await playerProfileFromPc(mode, accountId)
    if (snapshot || dataGatewayOnly) return snapshot
    return fetchPlayerProfile(mode, accountId).catch(() => null)
  })
  ipcMain.handle('game:get-raid-state', () => ({ ...logWatcher.raidState(), tracked: Boolean(logWatcher.folder()) }))
  // A few words about the computer for a «Скорость и зависания» report (report 227): cards, memory, battery; nothing personal.
  ipcMain.handle('system:brief', async () => describeSystemBrief({ gpuInfo: await app.getGPUInfo('basic').catch(() => null), totalMemBytes: totalmem(), onBattery: powerMonitor.isOnBatteryPower() }))
  ipcMain.handle('logs:watch-state', () => logWatcher.watchState())
  ipcMain.handle('collector:scan-screen', (_event, options?: unknown) => {
    const raw = options && typeof options === 'object' ? options as { restart?: unknown; names?: unknown } : {}
    // The wanted items' labels (a second look at a misread one): a short list of short strings, nothing else.
    const names = Array.isArray(raw.names) ? raw.names.filter((name): name is string => typeof name === 'string' && name.length <= 40).slice(0, 120) : undefined
    return scanCollectorScreen({ restart: raw.restart === true, names })
  })
  // A watched Logs folder tells the raids; otherwise the screenshots and the movement do (electron/experimental/raidSignals.ts).
  ipcMain.handle('quests:capture-frame', (_event, watch?: unknown, detail?: unknown) => captureQuestFrame(Boolean(watch), Boolean(detail), { logsWatched: Boolean(logWatcher.folder()) }))
  ipcMain.handle('quests:read-screenshot', (_event, after: unknown) => typeof after === 'number' && Number.isFinite(after) ? captureQuestScreenshot(after) : null)
  // The locked app (sign-in, subscription): the game-start screens only, only right after a new game window (screenOcr.ts).
  ipcMain.handle('quests:capture-identity', () => captureIdentityFrame())
}

/**
 * The single-owner development integration (server/README.md): with TARKOV_API_URL and TARKOV_API_TOKEN set, every
 * published full scan also goes to /v1/sync/events, per mode, game account and character.
 */
async function pushToDevelopmentServer(result: ModeLogScanResult) {
  if (!process.env.TARKOV_API_URL || !process.env.TARKOV_API_TOKEN || result.identityOnly) return
  const groups = new Map<string, typeof result.events>()
  for (const event of result.events) {
    if (!event.mode || !event.accountId || !event.profileId) continue
    const key = `${event.mode}:${event.accountId}:${event.profileId}`
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  for (const events of groups.values()) {
    const first = events[0]!
    await serviceRequest('POST', '/v1/sync/events', {
      mode: first.mode, accountId: first.accountId, characterId: first.profileId,
      events: events.map(({ taskId, status, timestamp }) => ({ taskId, status, timestamp })),
    }).catch(() => { /* The local projection stays available; the idempotent batch is resent on the next change. */ })
  }
}

function validateMode(value: unknown): RaidMode {
  if (value === 'pvp' || value === 'pve' || value === 'seasonal') return value
  throw new Error('Неизвестный режим Escape from Tarkov')
}
