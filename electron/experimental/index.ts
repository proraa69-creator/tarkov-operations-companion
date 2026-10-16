import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app, desktopCapturer, dialog, ipcMain, nativeImage, net, screen, shell, type BrowserWindow, type Display, type Point, type Rectangle } from 'electron'
import { gameKeyLabel, parseScreenshotBinding } from '../../src/overlay/gameKeys.js'
import type { ScreenshotCheck, ScreenshotCheckFile, ScreenshotKeyInfo } from '../../src/overlay/screenshotCheck.js'
import { isPositionScreenshot, parseScreenshotPosition, type PlayerPosition } from '../../src/overlay/screenshotPosition.js'
import { readScreenshotBindingAt } from '../logScanner.js'
import { recognizeTooltip, warmUpOcr } from '../screenOcr.js'
import { TOOLTIP_CAPTURE, type Bitmap, type Rect } from '../../src/overlay/tooltipDetect.js'
import { readGameTooltip, retryOcrReadings, type TooltipReading } from '../../src/overlay/tooltipLookup.js'
import { findItemCell, type ItemCell } from '../../src/overlay/itemCell.js'
import { isItemIconUrl, screenPicture, type PictureAnswer, type PictureCandidatesAnswer } from '../../src/overlay/iconMatch.js'
import { relaunchAsAdmin } from './elevation.js'
import { PositionTracker, screenshotFolderCandidates, screenshotsFolder, setScreenshotsOverride, type SeenScreenshot } from './positionTracker.js'
import { HOTKEYS } from '../../src/overlay/hotkeys.js'
import { readSettings, remoteMinimapOn, trackingOn, updateSettings, type ExperimentalSettings } from './settings.js'
import { createTrackingControl } from './trackingControl.js'
import { noteRaidSignal } from './raidSignals.js'
import { holdBackgroundScans } from '../ocrQueue.js'
import { foregroundWindowKey } from './win32.js'
import {
  captureScreenRegion, foregroundDisplayMode, isElevated, isTarkovForeground, isVirtualKeyDown, nativeError, nativeKeysAvailable, wasVirtualKeyPressed,
  type DisplayMode,
} from './win32.js'

/**
 * The game-related functions of the main process: the item lookup (the game's own name tooltip under the cursor, read
 * on the item key), the Collector scan key, and the player's position from the game's own screenshots. Nothing is drawn
 * over the game (owner, 15.10.2026: «убирай функции оверлей, карта поверх игры и информация о предмете поверх игры. все
 * это будет только в приложении на карте»): there are no windows besides the main one. The recognised item goes to the
 * main window (`experimental:item`), which shows it on «Карты» under «Вид» and passes it to the phone; the position the
 * same way (`experimental:position`). The screen is only read, never written to; the app presses no keys in the game.
 */

const require = createRequire(import.meta.url)

interface HookEvent { keycode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
interface UiohookModule {
  uIOhook: { on: (event: 'keydown', listener: (event: HookEvent) => void) => void; start: () => void; stop: () => void }
  UiohookKey: Record<string, number>
}

interface Options {
  mainWindow: () => BrowserWindow | null
  raidState: () => { inRaid: boolean; since?: number; location?: string }
  /** The EFT Logs folder (the game logs its control bindings there at start); '' when unknown. */
  logsRoot: () => Promise<string>
}

const QUERY_TIMEOUT_MS = 5000
const KEY_REPEAT_MS = 350

let options: Options
let hook: UiohookModule | null = null
let hookError = ''
let keyTimer: NodeJS.Timeout | null = null
let watchTimer: NodeJS.Timeout | null = null
let displayMode: DisplayMode = 'unknown'
const WATCH_MS = 800
/** Mouse buttons, W A S D, Shift, Ctrl, Space, Q E R F C: at least one is held now and then while playing. */
const PROBE_KEYS = [0x01, 0x02, 0x57, 0x41, 0x53, 0x44, 0x10, 0x11, 0x20, 0x51, 0x45, 0x52, 0x46, 0x43]
let lastGameSeenAt = 0
let gameFrontMs = 0
let gameKeysSeenAt = 0
/** Keys held in the game never reached this app although the game was in front this long: Windows hides them. */
const GAME_KEYS_HIDDEN_MS = 60_000
const gameKeysState = () => gameKeysSeenAt ? 'visible' as const : gameFrontMs >= GAME_KEYS_HIDDEN_MS ? 'hidden' as const : 'unknown' as const
let lastPosition: PlayerPosition | null = null
let lastKeyAt = 0
let lookupBusy = false
let queryId = 0
const pending = new Map<number, (payload: unknown) => void>()

/** The item lookup's states for the main window: «reading…», the card, or «not recognised» (src/overlay/types.ts). */
function sendItem(payload: unknown) {
  const target = options.mainWindow()
  if (target && !target.isDestroyed()) target.webContents.send('experimental:item', payload)
}

/** A position older than this probably belongs to a previous raid. */
const POSITION_MAX_AGE_MS = 20 * 60 * 1000
/** The last position given to the main window (for the diagnostics in the settings). */
let positionSentAt = 0

const tracker = new PositionTracker((position) => {
  lastPosition = position
  // The newest screenshot kept from before a restart (or one synced in late) is no position now: not shown, not relayed.
  if (Date.now() - position.at >= POSITION_MAX_AGE_MS) return
  // The game writes coordinates only in a raid: the quest scanner holds its screen copies back for a while (raidSignals.ts).
  noteRaidSignal('screenshot', position.at)
  // Raid detection from the logs can lag or miss offline/training raids, so the position is not gated on it: a fresh
  // screenshot from the game is proof enough of where the player stands. The main window draws it on «Карты» and
  // publishes it for the phone.
  positionSentAt = Date.now()
  options.mainWindow()?.webContents.send('experimental:position', position)
})

/** The owner's switch and the player's «Отключить местоположение» (electron/experimental/trackingControl.ts). */
const tracking = createTrackingControl({
  tracker,
  readSettings,
  setScreenshotsOverride,
  onOff: () => {
    lastPosition = null
    // The dot goes from «Карты» at once (and nothing more is relayed to the phone).
    const target = options.mainWindow()
    if (target && !target.isDestroyed()) target.webContents.send('experimental:position', null)
  },
})
// None while the tracking is off (the owner's switch or the player's): no dot on the maps from before it went off.
const freshPosition = () => lastPosition && trackingOn(readSettings()) && Date.now() - lastPosition.at < POSITION_MAX_AGE_MS ? lastPosition : null

export function startExperimental(next: Options) {
  options = next
  registerIpc()
  startHook()
  applySettings(readSettings())
  watchTimer = setInterval(watchGame, WATCH_MS)
  // The item lookup's OCR engine is not loaded at every start: it loads at the first key press (lookupItem).
}

/** W A S D: the player walks — a raid or the hideout, no screen the quest scanner reads. */
const MOVE_KEYS = [0x57, 0x41, 0x53, 0x44]
let movingBefore = false
/** The window in front at the last look (its handle), and whether the display mode is asked once more at the next look. */
let lastForeground = ''
let askAgain = false

/**
 * Notes what the app needs to know about the game while it is in front: that the game's keys reach this app (a held
 * key proves it), the movement that tells a raid to the quest scanner, and how the game is displayed (an exclusive
 * full-screen game hides from screen copies, so the item lookup skips it). The display mode is asked only when the
 * window in front changes, and once more a look later, when a switch of the display mode is through.
 */
function watchGame() {
  const foreground = foregroundWindowKey()
  const changed = foreground !== lastForeground
  lastForeground = foreground
  if (!isTarkovForeground()) { movingBefore = false; return }
  lastGameSeenAt = Date.now()
  gameFrontMs += WATCH_MS
  // Held movement keys or mouse buttons prove that Windows lets this app see the game's keys.
  if (!gameKeysSeenAt && PROBE_KEYS.some(isVirtualKeyDown)) gameKeysSeenAt = Date.now()
  // A movement key held at two looks in a row (typing does not hold a key that long): a raid sign (raidSignals.ts).
  const moving = MOVE_KEYS.some(isVirtualKeyDown)
  if (moving && movingBefore) noteRaidSignal('movement')
  movingBefore = moving
  if (!changed && !askAgain) return
  askAgain = changed
  displayMode = foregroundDisplayMode()
}

export function stopExperimental() {
  tracker.stop()
  if (keyTimer) clearInterval(keyTimer)
  keyTimer = null
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
  try { hook?.uIOhook.stop() } catch { /* already stopped */ }
}

function registerIpc() {
  ipcMain.handle('experimental:get-settings', () => readSettings())
  ipcMain.handle('experimental:update-settings', async (_event, patch: unknown) => {
    const settings = await updateSettings(patch)
    applySettings(settings)
    return settings
  })
  ipcMain.handle('experimental:status', async () => ({
    // The item key only fires with the game in front, and only the Windows functions can tell that.
    hookReady: nativeKeysAvailable(),
    hookError: nativeError() || hookError,
    tracking: tracker.running,
    // Why the dot may not come, for the settings' diagnostics (src/overlay/PositionSetupCard.tsx).
    remoteMinimap: remoteMinimapOn(),
    trackingOn: trackingOn(readSettings()),
    watchedFolders: tracker.folders,
    positionSentAt: positionSentAt || null,
    screenshotsFolder: screenshotsFolder(),
    screenshotCandidates: screenshotFolderCandidates(),
    lastScreenshot: describeSeen(tracker.lastSeen),
    screenshotKey: await resolveScreenshotKey(),
    otherKeys: [readSettings().itemKey, readSettings().collectorKey].filter(Boolean),
    elevated: isElevated(),
    nativeError: nativeError(),
    gameSeenAt: lastGameSeenAt || null,
    gameKeys: gameKeysState(),
    lastPosition: freshPosition(),
    raid: options.raidState(),
    displayMode,
  }))
  ipcMain.handle('experimental:answer', (_event, id: unknown, payload: unknown) => {
    const resolve = pending.get(Number(id))
    pending.delete(Number(id))
    resolve?.(payload)
  })
  ipcMain.handle('experimental:pick-screenshots', async () => {
    const parent = options.mainWindow()
    const options_ = { title: 'Папка скриншотов EFT', defaultPath: screenshotsFolder(), properties: ['openDirectory' as const] }
    const result = parent ? await dialog.showOpenDialog(parent, options_) : await dialog.showOpenDialog(options_)
    if (result.canceled || !result.filePaths[0]) return readSettings()
    const settings = await updateSettings({ screenshotsDir: result.filePaths[0] })
    applySettings(settings)
    return settings
  })
  ipcMain.handle('experimental:test-item', () => lookupItem(true))
  ipcMain.handle('experimental:check-screenshots', () => checkScreenshots())
  ipcMain.handle('experimental:open-lookup-log', async () => {
    await mkdir(lookupLogDir(), { recursive: true })
    return (await shell.openPath(lookupLogDir())) === ''
  })
  ipcMain.handle('experimental:relaunch-admin', () => relaunchAsAdmin())
  // The owner's switch for every app, as the renderer learnt it from the server (src/announcement/features.ts): off, the
  // screenshots folder's watch and the position go at once, like the player's own «Отключить местоположение». A second
  // argument (the window over the game of the apps before 15.10.2026) is ignored: no app window is drawn over the game.
  // Returns whether the position tracking is on now (the owner's switch and the player's).
  ipcMain.handle('experimental:set-remote-minimap', (_event, enabled: unknown) => tracking.setRemote(enabled === true))
}

/**
 * The settings applied: the screenshots folders are followed while the owner's switch and the player's are on (see
 * electron/experimental/trackingControl.ts). The app presses no keys (owner, 14.10.2026: «человек сам … нажимает клавишу.
 * не программа»): the screenshots the player takes with the game's own key move the marker.
 */
function applySettings(settings: ExperimentalSettings) {
  tracking.apply(settings)
}

/** The newest new screenshot for the diagnostics: its name, folder, time and the position read from its name. */
function describeSeen(seen: SeenScreenshot | null) {
  if (!seen) return null
  const { position, ...rest } = seen
  return { ...rest, position: position ? { x: position.x, y: position.y, z: position.z } : null, stale: Date.now() - seen.at >= POSITION_MAX_AGE_MS }
}

function startHook() {
  // The keys are polled (GetAsyncKeyState, 40 ms; a press shorter than that still sets its «pressed» bit). The global
  // uiohook hook is started only where that is unavailable: it hooked the mouse too, and every move of a 1–8 kHz mouse
  // became an event on the main process's thread, only to read a few hotkeys.
  const keyDown = (vk: number) => wasVirtualKeyPressed(vk)
  let previousItem = false
  let previousCollector = false
  keyTimer = setInterval(() => {
    const settings = readSettings()
    const item = keyDown(HOTKEYS[settings.itemKey]?.vk ?? 0xba)
    const collectorVk = HOTKEYS[settings.collectorKey]?.vk
    const collector = collectorVk ? keyDown(collectorVk) : false
    const plain = !isVirtualKeyDown(0x11) && !isVirtualKeyDown(0x12)
    if (collector && !previousCollector && plain && isTarkovForeground() && Date.now() - lastKeyAt >= KEY_REPEAT_MS) {
      lastKeyAt = Date.now()
      options.mainWindow()?.webContents.send('experimental:collector-scan')
    }
    previousCollector = collector
    if (item && !previousItem && plain && isTarkovForeground() && Date.now() - lastKeyAt >= KEY_REPEAT_MS) {
      lastKeyAt = Date.now()
      void lookupItem(false)
    }
    previousItem = item
  }, 40)
  // The global hook only where the key state cannot be polled; the app never presses keys with it either.
  if (nativeKeysAvailable()) return
  try {
    hook = require('uiohook-napi') as UiohookModule
    const { uIOhook, UiohookKey } = hook
    uIOhook.on('keydown', (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const settings = readSettings()
      const isItemKey = event.keycode === UiohookKey[HOTKEYS[settings.itemKey]?.hook ?? '']
      const collectorHook = HOTKEYS[settings.collectorKey]?.hook
      const isCollectorKey = Boolean(collectorHook) && event.keycode === UiohookKey[collectorHook!]
      if (!isItemKey && !isCollectorKey) return
      const now = Date.now()
      if (now - lastKeyAt < KEY_REPEAT_MS || !isTarkovForeground()) return
      lastKeyAt = now
      if (isCollectorKey) options.mainWindow()?.webContents.send('experimental:collector-scan')
      else void lookupItem(false)
    })
    uIOhook.start()
  } catch (error) {
    hook = null
    hookError = error instanceof Error ? error.message : String(error)
  }
}

const GAME_SETTINGS = () => join(app.getPath('appData'), 'Battlestate Games', 'Escape from Tarkov', 'Settings', 'Control.ini')
const KEY_CACHE_MS = 30_000
let keyCache: { at: number; key: ScreenshotKeyInfo } | null = null
/** The Logs folder for the logged keys: looking for it may sweep the drives, so not more than every 10 minutes. */
const ROOT_CACHE_MS = 10 * 60_000
let rootCache: { at: number; root: string } | null = null

async function logsRoot() {
  if (rootCache && Date.now() - rootCache.at < ROOT_CACHE_MS) return rootCache.root
  const root = await options.logsRoot().catch(() => '')
  rootCache = { at: Date.now(), root }
  return root
}

/**
 * The game's screenshot key: the one the player presses (the app only reads it, to tell the player which key moves the dot).
 * Its Control.ini and the keys it logs at start are both read and the fresher wins: the Steam game (store app 3932890)
 * logs into its own Steam library while a Control.ini may be left from the launcher's game, and a key changed during a
 * session is only in Control.ini. Neither found: PrtSc, the game's default.
 */
async function resolveScreenshotKey(fresh = false): Promise<ScreenshotKeyInfo> {
  if (!fresh && keyCache && Date.now() - keyCache.at < KEY_CACHE_MS) return keyCache.key
  const [ini, logged] = await Promise.all([
    Promise.all([readFile(GAME_SETTINGS(), 'utf8'), stat(GAME_SETTINGS())])
      .then(([text, info]) => ({ keys: parseScreenshotBinding(text), at: info.mtimeMs }), () => null),
    logsRoot().then((root) => (root ? readScreenshotBindingAt(root) : null)).catch(() => null),
  ])
  const fromIni = ini?.keys ? { keys: ini.keys, at: ini.at, source: 'game-settings' as const } : null
  const fromLog = logged ? { keys: logged.keys, at: logged.at, source: 'game-log' as const } : null
  const chosen = fromIni && fromLog ? (fromLog.at > fromIni.at ? fromLog : fromIni) : fromIni ?? fromLog
  const key = describeKey(chosen?.keys ?? ['Print'], chosen?.source ?? 'default')
  keyCache = { at: Date.now(), key }
  return key
}

function describeKey(keys: string[], source: ScreenshotKeyInfo['source']): ScreenshotKeyInfo {
  return { keys, label: gameKeyLabel(keys), source, unbound: keys.length === 0 }
}

/** Asks the main window (which holds the catalog and quest progress) to answer a query. */
function askRenderer(kind: 'item' | 'item-candidates' | 'item-picture', input: unknown): Promise<unknown> {
  const target = options.mainWindow()
  if (!target || target.isDestroyed()) return Promise.resolve(null)
  const id = ++queryId
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null) }, QUERY_TIMEOUT_MS)
    pending.set(id, (payload) => { clearTimeout(timer); resolve(payload) })
    target.webContents.send('experimental:query', { id, kind, input })
  })
}

/**
 * The item key (or «Проверить» in the settings): the game's name tooltip under the cursor is read and the item it names
 * goes to the main window — «reading…» as soon as the tooltip is seen, then the card or «not recognised». The main window
 * shows it on «Карты» under «Вид» and sends it to the phone of the account; no window opens over the game.
 */
async function lookupItem(test: boolean) {
  const settings = readSettings()
  if (!settings.itemLookup || lookupBusy) return null
  // An exclusive full-screen game hides from screen copies (they come out black, and the fallback copied the whole display
  // again and again): no copies at all.
  if (!test && foregroundDisplayMode() === 'exclusive') return null
  lookupBusy = true
  // The quest scanner yields while the player waits for the card (electron/ocrQueue.ts).
  const release = holdBackgroundScans()
  // The engine loads (the first time, or after 5 idle minutes) while the screen is searched for the tooltip.
  if (!test) void warmUpOcr().catch(() => {})
  try {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    if (test) {
      const answer = await askRenderer('item', { text: '', test: true })
      sendItem(answer && typeof answer === 'object' ? answer : { state: 'not-found' })
      return answer
    }
    // Only the game's own name tooltip is read: it holds the name of exactly the hovered item. It appears a moment
    // after the cursor stops, so the screen is grabbed again until it does (see readGameTooltip).
    const started = Date.now()
    // The area around the cursor only, never the whole display; the slow whole-screen fallback once a lookup at most.
    const fallback = { left: 1 }
    const reading = await readGameTooltip({
      grab: () => grabAroundCursor(point, display, fallback),
      recognize: (bitmap) => recognizeTooltip(bitmap),
      match: async (text) => {
        const reply = await askRenderer('item', { text, tooltip: true })
        return found(reply) ? reply : null
      },
      onTooltip: () => sendItem({ state: 'loading' }),
    })
    if (!reading.shot || !reading.rect) {
      sendItem({ state: 'not-found' })
      void logLookup({ outcome: 'no-tooltip', reading, ms: Date.now() - started })
      return null
    }
    // Not found the first time: the tooltip is read other ways, then the picture is compared (see secondAttempt).
    const second = reading.answer ? null : await secondAttempt(reading as TooltipReading<unknown, Grab> & { shot: Grab; rect: Rect })
    const answer = reading.answer ?? second?.answer ?? null
    if (second) void logLookup({ outcome: second.answer ? second.via! : 'not-found', reading, second, ms: Date.now() - started })
    sendItem(answer ?? { state: 'not-found', text: reading.tries[0] ?? '' })
    return answer
  } finally {
    lookupBusy = false
    release()
  }
}

type Grab = NonNullable<Awaited<ReturnType<typeof grabAroundCursor>>>
const found = (reply: unknown) => Boolean(reply && typeof reply === 'object' && (reply as { state?: string }).state === 'found')

interface SecondAttempt {
  answer: unknown
  via?: 'retry' | 'picture'
  /** What the other OCR readings of the tooltip gave. */
  retry: string[]
  /** The picture check: where the item was taken to be and every candidate's comparison. */
  picture?: { cell: ItemCell; reason: string; candidates: PictureAnswer['candidates']; icons: number; ms: number }
  ms: number
}

/**
 * The second attempt for a tooltip whose readings named no item: the last (settled) tooltip is read other ways
 * (retryOcrReadings), then the picture of the item under the cursor — from the first grab with the tooltip — is compared with the icons of the items the readings could be (iconMatch.ts).
 * An item found so is remembered for these readings by the main window. Icons are fetched meanwhile.
 */
async function secondAttempt(reading: TooltipReading<unknown, Grab> & { shot: Grab; rect: Rect }): Promise<SecondAttempt> {
  const started = Date.now()
  const readings = [...new Set(reading.tries.map((text) => text.trim()).filter(Boolean))]
  const result: SecondAttempt = { answer: null, retry: [], ms: 0 }
  const done = () => { result.ms = Date.now() - started; return result }
  const prefetch = readings.length ? pictureIcons(readings) : null
  for (const pictures of retryOcrReadings(reading.shot.image, reading.rect, reading.shot.cursor, reading.unit ?? reading.shot.unit)) {
    const parts: string[] = []
    for (const picture of pictures) parts.push(await recognizeTooltip(picture).catch(() => ''))
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    result.retry.push(text)
    if (!text || readings.includes(text)) continue
    const reply = await askRenderer('item', { text, tooltip: true, remember: readings })
    if (found(reply)) { result.answer = reply; result.via = 'retry'; return done() }
  }
  const texts = [...new Set([...readings, ...result.retry.filter(Boolean)])]
  const shot = reading.first ?? { shot: reading.shot, rect: reading.rect, unit: reading.unit ?? reading.shot.unit }
  if (!texts.length) return done()
  const pictureStarted = Date.now()
  const cell = findItemCell(shot.shot.image, shot.shot.cursor, shot.unit, shot.rect)
  const screen = screenPicture(shot.shot.image, cell)
  await prefetch
  const icons = await pictureIcons(texts)
  const reply = await askRenderer('item-picture', { texts, screen, icons }) as PictureAnswer | null
  result.picture = { cell, reason: reply?.reason ?? 'no-reply', candidates: reply?.candidates ?? [], icons: Object.keys(icons).length, ms: Date.now() - pictureStarted }
  if (reply && found(reply.payload)) { result.answer = reply.payload; result.via = 'picture' }
  return done()
}

/** Icon bytes by address (base64, for the main window to decode), for the session; failed ones are tried again after a minute. */
const iconBytes = new Map<string, { at: number; failed: boolean; bytes: Promise<string | null> }>()
/** The fetch runs while the tooltip is read again, so it mostly costs no extra wait; a slow one is given up. */
const ICON_TIMEOUT_MS = 1500
const ICON_MAX_BYTES = 256 * 1024
const ICONS_KEPT = 300

function iconBase64(url: string) {
  const known = iconBytes.get(url)
  if (known && (!known.failed || Date.now() - known.at < 60_000)) return known.bytes
  const entry = { at: Date.now(), failed: false, bytes: Promise.resolve<string | null>(null) }
  entry.bytes = (async () => {
    // No cookies: just the public picture.
    const response = await net.fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(ICON_TIMEOUT_MS) })
    if (!response.ok || !/^image\/(?:webp|png|jpeg)\b/i.test(response.headers.get('content-type') ?? '')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.length && bytes.length <= ICON_MAX_BYTES ? bytes.toString('base64') : null
  })().catch(() => null).then((bytes) => { entry.failed = !bytes; return bytes })
  if (iconBytes.size >= ICONS_KEPT) iconBytes.delete(iconBytes.keys().next().value!)
  iconBytes.set(url, entry)
  return entry.bytes
}

/** Icons of the items these readings could be, that the main window has no signature of yet (fetched together). */
async function pictureIcons(texts: string[]) {
  const reply = await askRenderer('item-candidates', { texts }) as PictureCandidatesAnswer | null
  const icons: Record<string, string> = {}
  await Promise.all((reply?.candidates ?? []).map(async (candidate) => {
    if (candidate.known || !isItemIconUrl(candidate.iconUrl)) return
    const bytes = await iconBase64(candidate.iconUrl)
    if (bytes) icons[candidate.itemId] = bytes
  }))
  return icons
}

/**
 * Lookups the first attempt could not answer are kept (last 30) so the owner can send them: what was read, the second
 * attempt (other readings, the picture candidates and their distances), the tooltip's size, and small crops — the
 * tooltip, the item cell, or (when no tooltip was found) the area beside the cursor where it should have been.
 */
const lookupLogDir = () => join(app.getPath('userData'), 'item-lookups')
const LOOKUPS_KEPT = 30

async function logLookup(entry: { outcome: string; reading: TooltipReading<unknown, Grab>; second?: SecondAttempt; ms: number }) {
  try {
    const { reading, second } = entry
    const dir = lookupLogDir()
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const unit = reading.unit ?? reading.latest?.unit ?? 1
    const rect = reading.rect
    const cell = second?.picture?.cell.layouts[0]?.rect
    const record = {
      outcome: entry.outcome,
      ms: entry.ms,
      read: reading.tries,
      grabs: reading.grabs,
      // Size in game pixels too (1080p): a box taller than one line is a two-line tooltip.
      box: rect ? { ...rect, unit: Number(unit.toFixed(3)), width1080: Math.round(rect.width / unit), height1080: Math.round(rect.height / unit) } : null,
      capture: reading.latest ? { width: reading.latest.image.width, height: reading.latest.image.height, cursor: reading.latest.cursor, screenUnit: Number(reading.latest.unit.toFixed(3)) } : null,
      ...(second ? {
        second: {
          ms: second.ms,
          retry: second.retry,
          ...(second.picture ? { picture: {
            reason: second.picture.reason,
            ms: second.picture.ms,
            iconsFetched: second.picture.icons,
            grid: second.picture.cell.grid,
            layouts: second.picture.cell.layouts.map((layout) => ({ cols: layout.cols, rows: layout.rows, rect: layout.rect })),
            candidates: second.picture.candidates,
          } } : {}),
        },
      } : {}),
    }
    await writeFile(join(dir, `${stamp}.json`), JSON.stringify(record, null, 2), 'utf8')
    if (rect && reading.shot) await writeCrop(join(dir, `${stamp}.png`), reading.shot.image, rect, 6)
    // The item from the grab the picture check used (see secondAttempt).
    const pictured = reading.first?.shot ?? reading.shot
    if (cell && pictured) await writeCrop(join(dir, `${stamp}.cell.png`), pictured.image, cell, 4)
    if (!rect && reading.latest) {
      const { cursor } = reading.latest
      const near = { x: Math.round(cursor.x - 40 * unit), y: Math.round(cursor.y - 60 * unit), width: Math.round(640 * unit), height: Math.round(140 * unit) }
      await writeCrop(join(dir, `${stamp}.near.png`), reading.latest.image, near, 0)
    }
    // The newest lookups stay: every file of one lookup starts with its time stamp.
    const files = (await readdir(dir)).sort()
    const stamps = [...new Set(files.map((name) => name.split('.')[0]!))]
    const keep = new Set(stamps.slice(-LOOKUPS_KEPT))
    for (const name of files) if (!keep.has(name.split('.')[0]!)) await rm(join(dir, name), { force: true })
  } catch { /* diagnostics only */ }
}

/** A PNG of part of a grab (with `pad` pixels around it), clipped to the grab. */
async function writeCrop(file: string, image: Bitmap, area: Rectangle, pad: number) {
  const x = Math.max(0, area.x - pad), y = Math.max(0, area.y - pad)
  const width = Math.min(image.width, area.x + area.width + pad) - x, height = Math.min(image.height, area.y + area.height + pad) - y
  if (width <= 0 || height <= 0) return
  const crop = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) crop.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4)
  await writeFile(file, nativeImage.createFromBitmap(Buffer.from(crop.buffer), { width, height }).toPNG())
}

/**
 * The screen around the cursor in physical pixels (BGRA) with the cursor position in it: a GDI copy of just
 * that area when possible (milliseconds), otherwise — `fallback.left` times a lookup — a crop of a full desktopCapturer grab.
 */
async function grabAroundCursor(point: Point, display: Display, fallback: { left: number }) {
  const physicalDisplay = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds
  const unit = physicalDisplay.height / 1080
  const cursor = process.platform === 'win32' ? screen.dipToScreenPoint(point) : point
  // Generous around the cursor: over a big item the tooltip may sit at the item's corner (TOOLTIP_CAPTURE).
  const left = Math.max(physicalDisplay.x, Math.round(cursor.x - TOOLTIP_CAPTURE.left * unit))
  const top = Math.max(physicalDisplay.y, Math.round(cursor.y - TOOLTIP_CAPTURE.up * unit))
  const right = Math.min(physicalDisplay.x + physicalDisplay.width, Math.round(cursor.x + TOOLTIP_CAPTURE.right * unit))
  const bottom = Math.min(physicalDisplay.y + physicalDisplay.height, Math.round(cursor.y + TOOLTIP_CAPTURE.down * unit))
  if (right - left < 40 || bottom - top < 20) return null
  const toScreen = (rect: Rectangle) => {
    const physical = { x: rect.x + left, y: rect.y + top, width: rect.width, height: rect.height }
    return process.platform === 'win32' ? screen.screenToDipRect(null, physical) : physical
  }
  const fast = captureScreenRegion(left, top, right - left, bottom - top)
  if (fast && !isBlank(fast.data)) return { image: fast, cursor: { x: cursor.x - left, y: cursor.y - top }, unit, toScreen }
  // Fallback: one full-screen grab (slower), cropped to the same area — not again and again within one lookup.
  if (fallback.left <= 0) return null
  fallback.left -= 1
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: physicalDisplay.width, height: physicalDisplay.height } })
  const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return null
  const crop = source.thumbnail.crop({ x: left - physicalDisplay.x, y: top - physicalDisplay.y, width: right - left, height: bottom - top })
  const size = crop.getSize()
  return { image: { width: size.width, height: size.height, data: new Uint8Array(crop.toBitmap()) }, cursor: { x: cursor.x - left, y: cursor.y - top }, unit, toScreen }
}

/** An all-black copy: the game in exclusive full screen hides from GDI. */
function isBlank(data: Uint8Array) {
  for (let index = 0; index < data.length; index += 4 * 97) if (data[index]! > 8 || data[index + 1]! > 8 || data[index + 2]! > 8) return false
  return true
}

const IMAGE = /\.(png|jpe?g|bmp)$/i
const CHECK_WAIT_GAME_S = 20
/** The player presses the game's screenshot key themselves: time for that once the game is in front. */
const CHECK_WAIT_FILE_MS = 20_000
let check: ScreenshotCheck | null = null
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The «Проверить скриншоты» check: where the game saves screenshots and whether coordinates can be read from their
 * names, the game's screenshot key, then — with the game in front — the screenshot the player takes with that key. The
 * app presses nothing. Progress goes to the page as it happens.
 */
async function checkScreenshots(): Promise<ScreenshotCheck> {
  if (check && check.phase !== 'done') return { ...check }
  const folder = screenshotsFolder()
  const report: ScreenshotCheck = {
    phase: 'running',
    countdown: 0,
    folder: { path: folder, exists: false, images: 0, withCoordinates: 0, newest: null },
    key: await resolveScreenshotKey(true),
    elevated: isElevated(),
    nativeError: nativeError(),
    file: null,
    raid: options.raidState(),
    verdict: null,
  }
  check = report
  const emit = () => {
    report.raid = options.raidState()
    options.mainWindow()?.webContents.send('experimental:check-progress', { ...report })
  }
  const run = async (): Promise<NonNullable<ScreenshotCheck['verdict']>> => {
    const before = await imagesIn(folder)
    const withCoordinates = (before ?? []).filter((file) => isPositionScreenshot(file.name))
    const newest = withCoordinates.sort((a, b) => b.at - a.at)[0]
    report.folder = {
      path: folder,
      exists: before !== null,
      images: before?.length ?? 0,
      withCoordinates: withCoordinates.length,
      newest: newest ? { ...newest, position: parseScreenshotPosition(newest.name, newest.at) } : null,
    }
    emit()
    if (report.nativeError) return 'no-native'
    if (report.key.unbound) return 'no-key'
    const known = new Set((before ?? []).map((file) => file.name))
    report.phase = 'waiting-game'
    let file: ScreenshotCheckFile | null = null
    for (let tick = 0; tick < CHECK_WAIT_GAME_S * 4 && !isTarkovForeground(); tick += 1) {
      const left = CHECK_WAIT_GAME_S - Math.floor(tick / 4)
      if (left !== report.countdown) { report.countdown = left; emit() }
      await pause(250)
      if (tick % 4 === 3 && (file = await newImage(folder, known))) break
    }
    report.countdown = 0
    if (!file) {
      if (!isTarkovForeground()) return 'no-game'
      report.phase = 'waiting-file'
      emit()
      const until = Date.now() + CHECK_WAIT_FILE_MS
      while (!file && Date.now() < until) {
        await pause(250)
        file = await newImage(folder, known)
      }
    }
    report.file = file
    if (!file) return 'no-file'
    return file.position ? 'ok' : 'no-coordinates'
  }
  try {
    report.verdict = await run()
  } catch {
    report.verdict = report.verdict ?? 'no-file'
  }
  report.phase = 'done'
  report.countdown = 0
  emit()
  return { ...report }
}

/** Images in the folder with their times; null when the folder does not exist. */
async function imagesIn(folder: string) {
  const names = await readdir(folder).catch(() => null)
  if (!names) return null
  const files = await Promise.all(names.filter((name) => IMAGE.test(name)).map(async (name) => ({ name, at: (await stat(join(folder, name)).catch(() => null))?.mtimeMs ?? 0 })))
  return files
}

/** The newest image that was not in the folder before the check. */
async function newImage(folder: string, known: Set<string>): Promise<ScreenshotCheckFile | null> {
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => IMAGE.test(name) && !known.has(name))
  if (!names.length) return null
  const files = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(folder, name)).catch(() => null))?.mtimeMs ?? Date.now() })))
  const newest = files.sort((a, b) => b.at - a.at)[0]!
  return { ...newest, position: parseScreenshotPosition(newest.name, newest.at) }
}

