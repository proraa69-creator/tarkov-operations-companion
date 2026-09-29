import { readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell, type Display, type Point, type Rectangle } from 'electron'
import { gameKeyLabel, isPrintScreen, parseScreenshotBinding, unityKey } from '../../src/overlay/gameKeys.js'
import type { ScreenshotCheck, ScreenshotCheckFile, ScreenshotKeyInfo } from '../../src/overlay/screenshotCheck.js'
import { isPositionScreenshot, parseScreenshotPosition, type PlayerPosition } from '../../src/overlay/screenshotPosition.js'
import { readScreenshotBinding } from '../logScanner.js'
import { recognizeTooltip, warmUpOcr } from '../screenOcr.js'
import { findTooltip, tooltipForOcr } from '../../src/overlay/tooltipDetect.js'
import { relaunchAsAdmin } from './elevation.js'
import { PositionTracker, screenshotFolderCandidates, screenshotsFolder, setScreenshotsOverride } from './positionTracker.js'
import { HOTKEYS } from '../../src/overlay/hotkeys.js'
import { readSettings, updateSettings, type ExperimentalSettings } from './settings.js'
import {
  captureScreenRegion, foregroundDisplayMode, isElevated, isTarkovForeground, isVirtualKeyDown, nativeError, nativeKeysAvailable, pressKeys, printScreenOpensSnipping,
  type DisplayMode, type KeyStroke,
} from './win32.js'

const require = createRequire(import.meta.url)

interface HookEvent { keycode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
interface UiohookModule {
  uIOhook: { on: (event: 'keydown', listener: (event: HookEvent) => void) => void; start: () => void; stop: () => void; keyTap: (key: number) => void; keyToggle: (key: number, toggle: 'down' | 'up') => void }
  UiohookKey: Record<string, number>
}

interface Options {
  preload: string
  load: (window: BrowserWindow, hash: string) => void
  mainWindow: () => BrowserWindow | null
  raidState: () => { inRaid: boolean; since?: number; location?: string }
  /** The EFT Logs folder (the game logs its control bindings there at start); '' when unknown. */
  logsRoot: () => Promise<string>
}

const ITEM_OVERLAY = { width: 300, height: 118 }
/** The card closes when the cursor leaves the item (moves this far from where the key was pressed). */
const ITEM_LEAVE_PX = 42
/** Screen area searched around the cursor for the game's name tooltip, in 1080p units. */
const CAPTURE = { left: 520, right: 720, up: 240, down: 160 }
const MINIMAP_OVERLAY = { width: 436, height: 360 }
const QUERY_TIMEOUT_MS = 5000
const KEY_REPEAT_MS = 350

let options: Options
let hook: UiohookModule | null = null
let hookError = ''
let itemWindow: BrowserWindow | null = null
let minimapWindow: BrowserWindow | null = null
let screenshotTimer: NodeJS.Timeout | null = null
let keyTimer: NodeJS.Timeout | null = null
let watchTimer: NodeJS.Timeout | null = null
let dragTimer: NodeJS.Timeout | null = null
/** Clickable parts of the minimap (header, slider, quest list) in window coordinates, reported by the overlay. */
let minimapZones: Array<{ x: number; y: number; width: number; height: number }> = []
let hitTimer: NodeJS.Timeout | null = null
/** When the mouse button went down over a minimap control; 0 = not pressed. */
let minimapHeldAt = 0
const HOLD_MAX_MS = 8_000

/**
 * Makes the minimap clickable exactly over its controls. Forwarded mouse-move events are unreliable over a
 * full-screen game, so the cursor is checked here and the window stops ignoring the mouse only over a zone.
 */
function watchMinimapHits(window: BrowserWindow) {
  if (hitTimer) clearInterval(hitTimer)
  hitTimer = setInterval(() => {
    if (window.isDestroyed() || !window.isVisible()) {
      if (hitTimer) clearInterval(hitTimer)
      hitTimer = null
      return
    }
    // A press that started over a control (slider, quest list, map) keeps the window catching the mouse
    // until it is released, or the release would go to the game and the page would think the button is still down.
    if (dragTimer) return
    if (minimapHeldAt) {
      // The page may never get the release (it happened outside the window). Once the button is up — seen
      // through Windows when the key state is readable — or after a while, release the page ourselves.
      const readable = isElevated() === true || !isTarkovForeground()
      const released = readable && Date.now() - minimapHeldAt > 150 && !isVirtualKeyDown(0x01)
      if (!released && Date.now() - minimapHeldAt < HOLD_MAX_MS) return
      minimapHeldAt = 0
      const point = screen.getCursorScreenPoint()
      const bounds = window.getBounds()
      window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x - bounds.x, y: point.y - bounds.y, button: 'left', clickCount: 1 })
    }
    const point = screen.getCursorScreenPoint()
    const bounds = window.getBounds()
    const x = point.x - bounds.x
    const y = point.y - bounds.y
    const over = minimapZones.some((zone) => x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height)
    if (over !== interactive.has(window)) {
      if (over) interactive.add(window)
      else interactive.delete(window)
      window.setIgnoreMouseEvents(!over, { forward: true })
    }
  }, 50)
}
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
const overlayPayloads = new WeakMap<BrowserWindow, Map<string, unknown>>()
/** Overlay windows currently catching the mouse (pointer over a slider or the quest list). */
const interactive = new WeakSet<BrowserWindow>()
function sendOverlay(window: BrowserWindow | null, channel: string, payload: unknown) {
  if (!window || window.isDestroyed()) return
  let messages = overlayPayloads.get(window)
  if (!messages) { messages = new Map(); overlayPayloads.set(window, messages) }
  messages.set(channel, payload)
  window.webContents.send(channel, payload)
}
const tracker = new PositionTracker((position) => {
  lastPosition = position
  options.mainWindow()?.webContents.send('experimental:position', position)
  // Raid detection from the logs can lag or miss offline/training raids, so the position is not
  // gated on it: a fresh screenshot from the game is proof enough of where the player stands.
  sendOverlay(minimapWindow, 'overlay:position', position)
}, (file) => noteScreenshotFile(file))

/** A position older than this probably belongs to a previous raid. */
const POSITION_MAX_AGE_MS = 20 * 60 * 1000
const freshPosition = () => lastPosition && Date.now() - lastPosition.at < POSITION_MAX_AGE_MS ? lastPosition : null

export function startExperimental(next: Options) {
  options = next
  registerIpc()
  startHook()
  applySettings(readSettings())
  watchTimer = setInterval(watchGame, WATCH_MS)
  // Loading the OCR model takes a few seconds; do it up front so the first key press is instant.
  if (readSettings().itemLookup) setTimeout(() => void warmUpOcr().catch(() => {}), 4000)
}

/**
 * Remembers how the game is displayed while it is in front, and keeps visible overlays at the top of
 * the z-order: a borderless or optimized full-screen game re-raises itself after Alt+Tab, clicks and
 * loading screens, which would otherwise push a topmost overlay under it.
 */
function watchGame() {
  if (!isTarkovForeground()) return
  lastGameSeenAt = Date.now()
  gameFrontMs += WATCH_MS
  // Held movement keys or mouse buttons prove that Windows lets this app see the game's keys.
  if (!gameKeysSeenAt && PROBE_KEYS.some(isVirtualKeyDown)) gameKeysSeenAt = Date.now()
  displayMode = foregroundDisplayMode()
  for (const window of [itemWindow, minimapWindow]) {
    if (window && !window.isDestroyed() && window.isVisible()) reassertOverlay(window)
  }
}

export function stopExperimental() {
  tracker.stop()
  if (screenshotTimer) clearInterval(screenshotTimer)
  screenshotTimer = null
  if (keyTimer) clearInterval(keyTimer)
  keyTimer = null
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
  try { hook?.uIOhook.stop() } catch { /* already stopped */ }
}

function registerIpc() {
  ipcMain.on('overlay:subscribe', (event, channel: unknown) => {
    if (typeof channel !== 'string' || !['overlay:item', 'overlay:minimap', 'overlay:position'].includes(channel)) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || (window !== itemWindow && window !== minimapWindow)) return
    const messages = overlayPayloads.get(window)
    if (messages?.has(channel)) event.sender.send(channel, messages.get(channel))
  })
  ipcMain.on('overlay:interactive', (event, value: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window !== minimapWindow) return
    if (value === true) interactive.add(window)
    else interactive.delete(window)
    window.setIgnoreMouseEvents(value !== true, { forward: true })
  })
  ipcMain.on('overlay:hold', (event, held: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window !== minimapWindow) return
    minimapHeldAt = held === true ? Date.now() : 0
  })
  ipcMain.on('overlay:drag', (event, active: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window !== minimapWindow || window.isDestroyed()) return
    if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
    if (active !== true) {
      const { x, y } = window.getBounds()
      void updateSettings({ minimapPosition: { x, y } })
      return
    }
    // Follow the cursor from the main process: the overlay itself cannot move its own window smoothly.
    const start = screen.getCursorScreenPoint()
    const origin = window.getBounds()
    const startedAt = Date.now()
    dragTimer = setInterval(() => {
      if (window.isDestroyed()) { if (dragTimer) clearInterval(dragTimer); dragTimer = null; return }
      const point = screen.getCursorScreenPoint()
      window.setPosition(origin.x + point.x - start.x, origin.y + point.y - start.y)
      // The page reports the release (the window holds the mouse while the button is down). The button state
      // is only a fallback with administrator rights: for an elevated game Windows hides it from this app.
      const released = isElevated() === true && !isVirtualKeyDown(0x01) && Date.now() - startedAt > 150
      if (released || Date.now() - startedAt > HOLD_MAX_MS) {
        if (dragTimer) clearInterval(dragTimer)
        dragTimer = null
        const { x, y } = window.getBounds()
        void updateSettings({ minimapPosition: { x, y } })
      }
    }, 16)
  })
  ipcMain.on('overlay:zones', (event, zones: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window !== minimapWindow || !Array.isArray(zones)) return
    minimapZones = zones.slice(0, 40).flatMap((zone) => {
      const { x, y, width, height } = (zone ?? {}) as Record<string, unknown>
      return [x, y, width, height].every((value) => Number.isFinite(Number(value))) ? [{ x: Number(x), y: Number(y), width: Number(width), height: Number(height) }] : []
    })
  })
  ipcMain.on('overlay:resize', (event, width: unknown, height: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || (window !== minimapWindow && window !== itemWindow) || window.isDestroyed()) return
    const w = Math.round(Number(width))
    const h = Math.round(Number(height))
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 120 || h < 40) return
    const bounds = window.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const nextWidth = Math.min(w, area.width - 16)
    const nextHeight = Math.min(h, area.height - 16)
    if (nextWidth === bounds.width && nextHeight === bounds.height) return
    if (window === itemWindow) {
      // The item card keeps its top-left corner (next to the game's tooltip) and stays on screen.
      const x = Math.max(area.x + 4, Math.min(bounds.x, area.x + area.width - nextWidth - 4))
      window.setBounds({ x, y: bounds.y, width: nextWidth, height: nextHeight })
      return
    }
    // Keep the top-right corner where it is.
    window.setBounds({ x: bounds.x + bounds.width - nextWidth, y: bounds.y, width: nextWidth, height: nextHeight })
  })
  ipcMain.handle('experimental:get-settings', () => readSettings())
  ipcMain.handle('experimental:update-settings', async (_event, patch: unknown) => {
    const settings = await updateSettings(patch)
    applySettings(settings)
    return settings
  })
  ipcMain.handle('experimental:status', async () => ({
    // Hotkeys only fire with the game in front, and only the Windows functions can tell that.
    hookReady: nativeKeysAvailable(),
    hookError: nativeError() || hookError,
    tracking: tracker.running,
    screenshotsFolder: screenshotsFolder(),
    screenshotCandidates: screenshotFolderCandidates(),
    lastScreenshot: tracker.lastSeen,
    screenshotPresses,
    filesAfterPress,
    screenshotKey: await resolveScreenshotKey(),
    elevated: isElevated(),
    snipping: await snippingState(),
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
  ipcMain.handle('experimental:toggle-minimap', () => toggleMinimap(true))
  ipcMain.handle('experimental:test-item', () => lookupItem(true))
  ipcMain.handle('experimental:check-screenshots', () => checkScreenshots())
  ipcMain.handle('experimental:relaunch-admin', () => relaunchAsAdmin())
  // Only opens the Windows settings page; the player changes the setting there.
  ipcMain.handle('experimental:open-keyboard-settings', () => shell.openExternal('ms-settings:easeofaccess-keyboard').then(() => true, () => false))
}

let appliedScreenshotsDir: string | null = null

function applySettings(settings: ExperimentalSettings) {
  if (appliedScreenshotsDir !== null && appliedScreenshotsDir !== settings.screenshotsDir) tracker.stop()
  appliedScreenshotsDir = settings.screenshotsDir
  setScreenshotsOverride(settings.screenshotsDir)
  if (settings.tracking) void tracker.start()
  else tracker.stop()
  if (screenshotTimer) clearInterval(screenshotTimer)
  screenshotTimer = null
  if (settings.tracking && settings.autoScreenshot) {
    screenshotTimer = setInterval(() => {
      // Only press the screenshot key in a raid, with the game in front — never into other apps. Raid
      // detection from the logs can miss a raid, so a coordinate screenshot in the last minutes also counts.
      const recentlyInRaid = lastPosition && Date.now() - lastPosition.at < 3 * 60_000
      if (!(options.raidState().inRaid || recentlyInRaid) || !isTarkovForeground()) return
      // Presses that bring no screenshot (the game ignores them) are slowed down until one works again.
      if (pressesSinceFile >= MISSES_BEFORE_BACKOFF && Date.now() - lastScreenshotPress < BACKOFF_MS) return
      void takeScreenshot()
    }, settings.screenshotIntervalMs)
  }
  if (!settings.minimap) minimapWindow?.hide()
  if (!settings.itemLookup) itemWindow?.hide()
}

function startHook() {
  // A native polling fallback works even when a low-level hook misses a game input event.
  let previousMap = false
  let previousItem = false
  let previousCollector = false
  keyTimer = setInterval(() => {
    const settings = readSettings()
    const map = isVirtualKeyDown(HOTKEYS[settings.minimapKey]?.vk ?? 0x4d)
    const item = isVirtualKeyDown(HOTKEYS[settings.itemKey]?.vk ?? 0xba)
    const collectorVk = HOTKEYS[settings.collectorKey]?.vk
    const collector = collectorVk ? isVirtualKeyDown(collectorVk) : false
    if (collector && !previousCollector && !isVirtualKeyDown(0x11) && !isVirtualKeyDown(0x12) && Date.now() - lastKeyAt >= KEY_REPEAT_MS) {
      lastKeyAt = Date.now()
      options.mainWindow()?.webContents.send('experimental:collector-scan')
    }
    previousCollector = collector
    if ((map && !previousMap || item && !previousItem) && !isVirtualKeyDown(0x11) && !isVirtualKeyDown(0x12) && isTarkovForeground()) {
      const now = Date.now()
      if (now - lastKeyAt >= KEY_REPEAT_MS) {
        lastKeyAt = now
        if (item && !previousItem) void lookupItem(false)
        else {
          // A screenshot only when the minimap opens — closing it needs no new position.
          if (settings.tracking && !minimapShown()) void takeScreenshot()
          void toggleMinimap(false)
        }
      }
    }
    previousMap = map
    previousItem = item
  }, 40)
  try {
    hook = require('uiohook-napi') as UiohookModule
    const { uIOhook, UiohookKey } = hook
    uIOhook.on('keydown', (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const settings = readSettings()
      const isItemKey = event.keycode === UiohookKey[HOTKEYS[settings.itemKey]?.hook ?? '']
      const isMapKey = event.keycode === UiohookKey[HOTKEYS[settings.minimapKey]?.hook ?? '']
      const collectorHook = HOTKEYS[settings.collectorKey]?.hook
      if (collectorHook && event.keycode === UiohookKey[collectorHook]) {
        const stamp = Date.now()
        if (stamp - lastKeyAt >= KEY_REPEAT_MS) {
          lastKeyAt = stamp
          options.mainWindow()?.webContents.send('experimental:collector-scan')
        }
        return
      }
      if (!isItemKey && !isMapKey) return
      const now = Date.now()
      if (now - lastKeyAt < KEY_REPEAT_MS) return
      if (!isTarkovForeground()) return
      lastKeyAt = now
      if (isItemKey) void lookupItem(false)
      else {
        // Opening the map should immediately request a fresh coordinate-bearing EFT screenshot.
        // The tracker will update the marker as soon as the game writes the file.
        if (settings.tracking && !minimapShown()) void takeScreenshot()
        void toggleMinimap(false)
      }
    })
    uIOhook.start()
  } catch (error) {
    hook = null
    hookError = error instanceof Error ? error.message : String(error)
  }
}

let lastScreenshotPress = 0
let screenshotPresses = 0
/** Screenshots the game wrote right after a press by the app. */
let filesAfterPress = 0
/** Presses by the app since the last screenshot that followed one. */
let pressesSinceFile = 0
/** Times of the latest presses by the app, to tell its screenshots from the player's own. */
const recentPresses: number[] = []
/** The game writes the file this long after the key press at most. */
const PRESS_FILE_MS = 3000
const MISSES_BEFORE_BACKOFF = 8
const BACKOFF_MS = 10_000

/**
 * One press of the game's screenshot key for the position tracker. False when the app cannot press it:
 * no key bound in the game, a mouse button, or PrtSc while Windows gives that key to the Snipping Tool
 * (pressing it would open the snipping overlay over the game).
 */
async function takeScreenshot() {
  const now = Date.now()
  if (now - lastScreenshotPress < 500) return false
  lastScreenshotPress = now
  const key = await resolveScreenshotKey()
  if (!key.sendable) return false
  if (isPrintScreen(key.keys) && await snippingState() === 'on') return false
  return pressScreenshotKeys(key)
}

async function pressScreenshotKeys(key: ScreenshotKeyInfo) {
  const strokes = key.keys.map(unityKey).filter((stroke): stroke is KeyStroke => Boolean(stroke))
  screenshotPresses += 1
  pressesSinceFile += 1
  recentPresses.push(Date.now())
  if (recentPresses.length > 12) recentPresses.shift()
  if (await pressKeys(strokes)) return true
  if (!hook || !isPrintScreen(key.keys)) return false
  try {
    hook.uIOhook.keyToggle(hook.UiohookKey.PrintScreen!, 'down')
    await new Promise((resolve) => setTimeout(resolve, 60))
    hook.uIOhook.keyToggle(hook.UiohookKey.PrintScreen!, 'up')
  } catch {
    hook.uIOhook.keyTap(hook.UiohookKey.PrintScreen!)
  }
  return true
}

const pressedBefore = (at: number) => recentPresses.some((press) => at >= press - 300 && at <= press + PRESS_FILE_MS)
/** The app's own presses bring screenshots right now: automatic screenshots keep the minimap fresh by themselves. */
const autoScreenshotsWork = () => filesAfterPress > 0 && pressesSinceFile < MISSES_BEFORE_BACKOFF && Date.now() - (recentPresses.at(-1) ?? 0) < 10_000

/** Every new screenshot: counts the ones that followed the app's presses; the player's own may open the minimap. */
function noteScreenshotFile(file: { name: string; withCoordinates: boolean; at: number }) {
  if (pressedBefore(file.at)) {
    filesAfterPress += 1
    pressesSinceFile = 0
    return
  }
  const settings = readSettings()
  if (!file.withCoordinates || !settings.minimap || !settings.showOnScreenshot || Date.now() - file.at > 10_000 || autoScreenshotsWork()) return
  // Taken with the game in front: the player pressed the screenshot key in a raid.
  if (isTarkovForeground()) void peekMinimap()
}

const GAME_SETTINGS = () => join(app.getPath('appData'), 'Battlestate Games', 'Escape from Tarkov', 'Settings', 'Control.ini')
const KEY_CACHE_MS = 30_000
let keyCache: { at: number; key: ScreenshotKeyInfo } | null = null

/**
 * The key the app presses for a screenshot: chosen on the Mini Map page, else the one set in the game —
 * its settings file, then the bindings it logs at start — else PrtSc, the game's default.
 */
async function resolveScreenshotKey(fresh = false): Promise<ScreenshotKeyInfo> {
  const chosen = readSettings().screenshotKey
  if (chosen) return describeKey([chosen], 'setting')
  if (!fresh && keyCache && Date.now() - keyCache.at < KEY_CACHE_MS) return keyCache.key
  let keys: string[] | null = parseScreenshotBinding(await readFile(GAME_SETTINGS(), 'utf8').catch(() => ''))
  let source: ScreenshotKeyInfo['source'] = keys ? 'game-settings' : 'default'
  if (!keys) {
    const root = await options.logsRoot().catch(() => '')
    keys = root ? await readScreenshotBinding(root).catch(() => null) : null
    if (keys) source = 'game-log'
  }
  const key = describeKey(keys ?? ['Print'], source)
  keyCache = { at: Date.now(), key }
  return key
}

function describeKey(keys: string[], source: ScreenshotKeyInfo['source']): ScreenshotKeyInfo {
  return { keys, label: gameKeyLabel(keys), source, unbound: keys.length === 0, sendable: keys.length > 0 && keys.every((key) => unityKey(key)) }
}

let snipping: { at: number; value: 'on' | 'off' | 'unknown' } | null = null
async function snippingState() {
  if (snipping && Date.now() - snipping.at < 60_000) return snipping.value
  const value = await printScreenOpensSnipping().catch(() => 'unknown' as const)
  snipping = { at: Date.now(), value }
  return value
}

/** Asks the main window (which holds the catalog and quest progress) to answer a query. */
function askRenderer(kind: 'item' | 'minimap', input: unknown): Promise<unknown> {
  const target = options.mainWindow()
  if (!target || target.isDestroyed()) return Promise.resolve(null)
  const id = ++queryId
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve(null) }, QUERY_TIMEOUT_MS)
    pending.set(id, (payload) => { clearTimeout(timer); resolve(payload) })
    target.webContents.send('experimental:query', { id, kind, input })
  })
}

function overlayWindow(route: 'item' | 'minimap', size: { width: number; height: number }) {
  const window = new BrowserWindow({
    ...size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setIgnoreMouseEvents(true, { forward: true })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  options.load(window, `/overlay/${route}`)
  return window
}

function reassertOverlay(window: BrowserWindow) {
  if (window.isDestroyed()) return
  // Full-screen applications may demote a hidden overlay after Alt+Tab or a
  // minimize/restore cycle. Re-apply the native flags before every display.
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (!interactive.has(window)) window.setIgnoreMouseEvents(true, { forward: true })
  window.moveTop()
}

function showOverlay(window: BrowserWindow) {
  window.showInactive()
  reassertOverlay(window)
  // Some borderless/full-screen games reorder native windows one or two frames after a hotkey.
  // Reasserting without taking focus keeps the overlay visible above EFT.
  for (const delay of [60, 240]) setTimeout(() => {
    if (!window.isDestroyed() && window.isVisible()) reassertOverlay(window)
  }, delay)
}

function ensureItemWindow() {
  if (!itemWindow || itemWindow.isDestroyed()) itemWindow = overlayWindow('item', ITEM_OVERLAY)
  return itemWindow
}

const minimapShown = () => Boolean(minimapWindow && !minimapWindow.isDestroyed() && minimapWindow.isVisible())

function ensureMinimapWindow() {
  if (!minimapWindow || minimapWindow.isDestroyed()) minimapWindow = overlayWindow('minimap', MINIMAP_OVERLAY)
  return minimapWindow
}

function whenLoaded(window: BrowserWindow) {
  return window.webContents.isLoading() ? new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve())) : Promise.resolve()
}

async function lookupItem(test: boolean) {
  const settings = readSettings()
  if (!settings.itemLookup || lookupBusy) return null
  lookupBusy = true
  try {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    itemWindow?.hide()
    const window = ensureItemWindow()
    await whenLoaded(window)
    if (test) {
      const answer = await askRenderer('item', { text: '', test: true })
      showItemCard(window, point, display, null, answer && typeof answer === 'object' ? answer : { state: 'not-found' })
      return answer
    }
    // Only the game's own name tooltip is read: it holds the full name of exactly the hovered item.
    const found = await waitForGameTooltip(point, display)
    if (!found) {
      showItemCard(window, point, display, null, { state: 'not-found' })
      return null
    }
    showItemCard(window, point, display, found.screen, { state: 'loading' })
    const text = await recognizeTooltip(tooltipForOcr(found.image, found.rect)).catch(() => '')
    const answer = text ? await askRenderer('item', { text, tooltip: true }) : null
    if (!window.isDestroyed() && window.isVisible()) sendOverlay(window, 'overlay:item', answer && typeof answer === 'object' ? answer : { state: 'not-found', text })
    return answer
  } finally {
    lookupBusy = false
  }
}

/** The tooltip appears a moment after the cursor stops on an item: look again for a short while. */
const TOOLTIP_WAIT_MS = 900

async function waitForGameTooltip(point: Point, display: Display) {
  const until = Date.now() + TOOLTIP_WAIT_MS
  for (;;) {
    const shot = await grabAroundCursor(point, display).catch(() => null)
    const rect = shot ? findTooltip(shot.image, shot.cursor, shot.unit) : null
    if (shot && rect) return { image: shot.image, rect, screen: shot.toScreen(rect) }
    if (Date.now() >= until) return null
    await pause(110)
  }
}

function showItemCard(window: BrowserWindow, point: Point, display: Display, tooltip: Rectangle | null, payload: unknown) {
  placeItemCard(window, point, display, tooltip)
  sendOverlay(window, 'overlay:item', payload)
  showOverlay(window)
  followCursor(window, point)
}

let followTimer: NodeJS.Timeout | null = null
/** Keeps the card open while the cursor stays on the item; no timer. */
function followCursor(window: BrowserWindow, origin: Point) {
  if (followTimer) clearInterval(followTimer)
  followTimer = setInterval(() => {
    const point = screen.getCursorScreenPoint()
    const left = Math.hypot(point.x - origin.x, point.y - origin.y) > ITEM_LEAVE_PX
    if (window.isDestroyed() || !window.isVisible() || left || (nativeKeysAvailable() && !isTarkovForeground() && !lookupBusy)) {
      if (!window.isDestroyed()) window.hide()
      if (followTimer) clearInterval(followTimer)
      followTimer = null
    }
  }, 80)
}

/**
 * Right under the game's tooltip, aligned with it — like a part of it — or, without a tooltip, just below
 * and to the right of the cursor. The card sizes itself to its content (overlay:resize) and stays on screen.
 */
function placeItemCard(window: BrowserWindow, point: Point, display: Display, tooltip: Rectangle | null) {
  const area = display.workArea
  const { width, height } = window.getBounds()
  let x = tooltip ? tooltip.x - 1 : point.x + 16
  let y = tooltip ? tooltip.y + tooltip.height + 3 : point.y + 22
  if (y + height > area.y + area.height - 4) y = tooltip ? tooltip.y - height - 3 : point.y - height - 12
  if (x + width > area.x + area.width - 4) x = area.x + area.width - width - 4
  window.setBounds({ x: Math.round(Math.max(area.x + 4, x)), y: Math.round(Math.max(area.y + 4, y)), width: width || ITEM_OVERLAY.width, height: height || ITEM_OVERLAY.height })
}

/**
 * The screen around the cursor in physical pixels (BGRA) with the cursor position in it: a GDI copy of just
 * that area when possible (milliseconds), otherwise a crop of a full desktopCapturer grab.
 */
async function grabAroundCursor(point: Point, display: Display) {
  const physicalDisplay = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds
  const unit = physicalDisplay.height / 1080
  const cursor = process.platform === 'win32' ? screen.dipToScreenPoint(point) : point
  const left = Math.max(physicalDisplay.x, Math.round(cursor.x - CAPTURE.left * unit))
  const top = Math.max(physicalDisplay.y, Math.round(cursor.y - CAPTURE.up * unit))
  const right = Math.min(physicalDisplay.x + physicalDisplay.width, Math.round(cursor.x + CAPTURE.right * unit))
  const bottom = Math.min(physicalDisplay.y + physicalDisplay.height, Math.round(cursor.y + CAPTURE.down * unit))
  if (right - left < 40 || bottom - top < 20) return null
  const toScreen = (rect: Rectangle) => {
    const physical = { x: rect.x + left, y: rect.y + top, width: rect.width, height: rect.height }
    return process.platform === 'win32' ? screen.screenToDipRect(null, physical) : physical
  }
  const fast = captureScreenRegion(left, top, right - left, bottom - top)
  if (fast && !isBlank(fast.data)) return { image: fast, cursor: { x: cursor.x - left, y: cursor.y - top }, unit, toScreen }
  // Fallback: one full-screen grab (slower), cropped to the same area.
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

async function toggleMinimap(fromApp: boolean) {
  if (!readSettings().minimap) return false
  stopPeek()
  const window = ensureMinimapWindow()
  if (window.isVisible()) {
    window.hide()
    return false
  }
  return openMinimap(window, fromApp)
}

/** How long the minimap stays open after a screenshot the player took. */
const PEEK_MS = 15_000
let peekTimer: NodeJS.Timeout | null = null

function stopPeek() {
  if (peekTimer) clearTimeout(peekTimer)
  peekTimer = null
}

/**
 * The player took a screenshot in a raid: show the minimap with the new position for a moment. Needs no
 * hotkey, so it also works when Windows hides the game's keys from the app. A minimap the player opened stays.
 */
let peekOpening = false
async function peekMinimap() {
  const window = ensureMinimapWindow()
  if (peekOpening || (window.isVisible() && !peekTimer)) return
  stopPeek()
  if (!window.isVisible()) {
    peekOpening = true
    const shown = await openMinimap(window, false).finally(() => { peekOpening = false })
    if (!shown) return
  }
  peekTimer = setTimeout(() => {
    peekTimer = null
    if (!window.isDestroyed()) window.hide()
  }, PEEK_MS)
}

async function openMinimap(window: BrowserWindow, fromApp: boolean) {
  await whenLoaded(window)
  reassertOverlay(window)
  const raid = options.raidState()
  const settings = readSettings()
  const payload = await askRenderer('minimap', { location: raid.location, fromApp })
  const ready = payload && typeof payload === 'object' && (payload as { state?: string }).state === 'ready'
  sendOverlay(window, 'overlay:minimap', ready ? { ...payload, opacity: settings.minimapOpacity, playerMarker: settings.playerMarker } : payload ?? { state: 'no-data' })
  sendOverlay(window, 'overlay:position', freshPosition())
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  // The renderer resizes the window to the map; keep its last size and pin it to the top-right corner.
  const current = window.getBounds()
  const width = Math.min(current.width || MINIMAP_OVERLAY.width, area.width - 48)
  const height = Math.min(current.height || MINIMAP_OVERLAY.height, area.height - 48)
  const saved = settings.minimapPosition
  const onScreen = saved && screen.getAllDisplays().some(({ workArea: a }) => saved.x >= a.x - width / 2 && saved.x <= a.x + a.width - width / 2 && saved.y >= a.y && saved.y <= a.y + a.height - 40)
  window.setBounds(onScreen && saved ? { x: saved.x, y: saved.y, width, height } : { x: area.x + area.width - width - 24, y: area.y + 24, width, height })
  showOverlay(window)
  watchMinimapHits(window)
  return true
}

const IMAGE = /\.(png|jpe?g|bmp)$/i
const CHECK_WAIT_GAME_S = 20
const CHECK_WAIT_FILE_MS = 6000
let check: ScreenshotCheck | null = null
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The «Проверить скриншоты» button: where the game saves screenshots and whether coordinates can be read
 * from their names, which key the app presses, then one real press with the game in front and the file
 * it brings. A screenshot the player takes meanwhile counts too. Progress goes to the page as it happens.
 */
async function checkScreenshots(): Promise<ScreenshotCheck> {
  if (check && check.phase !== 'done') return { ...check }
  const folder = screenshotsFolder()
  const report: ScreenshotCheck = {
    phase: 'running',
    countdown: 0,
    folder: { path: folder, exists: false, images: 0, withCoordinates: 0, newest: null },
    key: await resolveScreenshotKey(true),
    snipping: await snippingState(),
    elevated: isElevated(),
    nativeError: nativeError(),
    pressed: false,
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
    if (!report.key.sendable) return 'no-key'
    if (isPrintScreen(report.key.keys) && report.snipping === 'on') return 'snipping'
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
      // Let the game take the keyboard after the switch, then press only if it is still in front.
      await pause(700)
      if (!isTarkovForeground()) return 'no-game'
      report.pressed = await pressScreenshotKeys(report.key)
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

