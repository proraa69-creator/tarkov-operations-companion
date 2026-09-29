import { createRequire } from 'node:module'
import { BrowserWindow, desktopCapturer, dialog, ipcMain, screen, type Display, type Point } from 'electron'
import type { PlayerPosition } from '../../src/overlay/screenshotPosition.js'
import { recognizeRegionLines, warmUpOcr } from '../screenOcr.js'
import { PositionTracker, screenshotFolderCandidates, screenshotsFolder, setScreenshotsOverride } from './positionTracker.js'
import { HOTKEYS } from '../../src/overlay/hotkeys.js'
import { readSettings, updateSettings, type ExperimentalSettings } from './settings.js'
import { foregroundDisplayMode, isTarkovForeground, isVirtualKeyDown, nativeKeysAvailable, pressScreenshotKey, type DisplayMode } from './win32.js'

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
}

const ITEM_OVERLAY = { width: 300, height: 118 }
/** The card closes when the cursor leaves the item (moves this far from where the key was pressed). */
const ITEM_LEAVE_PX = 42
/** Screen area read around the cursor, in 1080p units: the EFT name tooltip and the cell label. */
const CAPTURE = { left: 240, right: 520, up: 120, down: 150 }
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
    if (dragTimer) return
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
})

/** A position older than this probably belongs to a previous raid. */
const POSITION_MAX_AGE_MS = 20 * 60 * 1000
const freshPosition = () => lastPosition && Date.now() - lastPosition.at < POSITION_MAX_AGE_MS ? lastPosition : null

export function startExperimental(next: Options) {
  options = next
  registerIpc()
  startHook()
  applySettings(readSettings())
  watchTimer = setInterval(watchGame, 800)
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
    dragTimer = setInterval(() => {
      if (window.isDestroyed()) { if (dragTimer) clearInterval(dragTimer); dragTimer = null; return }
      const point = screen.getCursorScreenPoint()
      window.setPosition(origin.x + point.x - start.x, origin.y + point.y - start.y)
      // A mouse-up outside the window never reaches the renderer; stop when the button is released.
      if (nativeKeysAvailable() && !isVirtualKeyDown(0x01)) {
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
    if (!window || window !== minimapWindow || window.isDestroyed()) return
    const w = Math.round(Number(width))
    const h = Math.round(Number(height))
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 120 || h < 60) return
    const bounds = window.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const nextWidth = Math.min(w, area.width - 16)
    const nextHeight = Math.min(h, area.height - 16)
    if (nextWidth === bounds.width && nextHeight === bounds.height) return
    // Keep the top-right corner where it is.
    window.setBounds({ x: bounds.x + bounds.width - nextWidth, y: bounds.y, width: nextWidth, height: nextHeight })
  })
  ipcMain.handle('experimental:get-settings', () => readSettings())
  ipcMain.handle('experimental:update-settings', async (_event, patch: unknown) => {
    const settings = await updateSettings(patch)
    applySettings(settings)
    return settings
  })
  ipcMain.handle('experimental:status', () => ({
    hookReady: (Boolean(hook) && !hookError) || nativeKeysAvailable(),
    hookError,
    tracking: tracker.running,
    screenshotsFolder: screenshotsFolder(),
    screenshotCandidates: screenshotFolderCandidates(),
    lastScreenshot: tracker.lastSeen,
    screenshotPresses,
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
          if (settings.tracking) void takeScreenshot()
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
        if (settings.tracking) void takeScreenshot()
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
/** One screenshot key press for the position tracker: native scan-code input, uiohook as a fallback. */
async function takeScreenshot() {
  const now = Date.now()
  if (now - lastScreenshotPress < 500) return
  lastScreenshotPress = now
  screenshotPresses += 1
  if (await pressScreenshotKey()) return
  if (!hook) return
  try {
    hook.uIOhook.keyToggle(hook.UiohookKey.PrintScreen!, 'down')
    await new Promise((resolve) => setTimeout(resolve, 60))
    hook.uIOhook.keyToggle(hook.UiohookKey.PrintScreen!, 'up')
  } catch {
    hook.uIOhook.keyTap(hook.UiohookKey.PrintScreen!)
  }
}
let screenshotPresses = 0

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
    // Grab the screen first (fast), then show the card next to the item while the text is read.
    const shot = test ? null : await grabAroundCursor(point, display).catch(() => null)
    const window = ensureItemWindow()
    await whenLoaded(window)
    placeNearCursor(window, point, display)
    sendOverlay(window, 'overlay:item', { state: 'loading' })
    showOverlay(window)
    followCursor(window, point)
    const lines = shot ? await recognizeRegionLines(shot.image).catch(() => []) : []
    const nearby = shot ? lines.map((line) => ({ text: line.text, distance: distanceToLine(line, shot.cursor) })) : []
    const text = nearby.map((line) => line.text).join('\n')
    const answer = test
      ? await askRenderer('item', { text: '', test: true })
      : text ? await askRenderer('item', { text, lines: nearby }) : null
    if (!window.isDestroyed() && window.isVisible()) sendOverlay(window, 'overlay:item', answer && typeof answer === 'object' ? answer : { state: 'not-found', text })
    return answer
  } finally {
    lookupBusy = false
  }
}

/** Distance from the cursor to an OCR line, in image pixels; lines to the right/below (the tooltip) are slightly preferred. */
function distanceToLine(line: { x: number; y: number; height: number; text: string }, cursor: { x: number; y: number }) {
  const halfWidth = Math.max(8, line.text.length * line.height * 0.28)
  const dx = Math.max(0, Math.abs(line.x - cursor.x) - halfWidth)
  const dy = Math.max(0, Math.abs(line.y - cursor.y) - line.height / 2)
  return Math.hypot(dx, dy * 1.4)
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

/** Next to the item: just below and to the right of the cursor, flipped at the screen edges. */
function placeNearCursor(window: BrowserWindow, point: Point, display: Display) {
  const area = display.workArea
  let x = point.x + 16
  let y = point.y + 22
  if (x + ITEM_OVERLAY.width > area.x + area.width - 4) x = point.x - ITEM_OVERLAY.width - 12
  if (y + ITEM_OVERLAY.height > area.y + area.height - 4) y = point.y - ITEM_OVERLAY.height - 12
  window.setBounds({ x: Math.round(Math.max(area.x + 4, x)), y: Math.round(Math.max(area.y + 4, y)), ...ITEM_OVERLAY })
}

/** The EFT item tooltip and the short name on the cell sit right around the cursor. */
async function grabAroundCursor(point: Point, display: Display) {
  const scale = display.scaleFactor || 1
  const physical = { width: Math.round(display.bounds.width * scale), height: Math.round(display.bounds.height * scale) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: physical })
  const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return null
  const image = source.thumbnail
  const size = image.getSize()
  const ratio = size.width / display.bounds.width
  const unit = size.height / 1080
  const cx = (point.x - display.bounds.x) * ratio
  const cy = (point.y - display.bounds.y) * ratio
  const left = Math.max(0, Math.round(cx - CAPTURE.left * unit))
  const top = Math.max(0, Math.round(cy - CAPTURE.up * unit))
  const width = Math.min(size.width - left, Math.round((CAPTURE.left + CAPTURE.right) * unit))
  const height = Math.min(size.height - top, Math.round((CAPTURE.up + CAPTURE.down) * unit))
  if (width < 40 || height < 20) return null
  return { image: image.crop({ x: left, y: top, width, height }), cursor: { x: cx - left, y: cy - top } }
}

async function toggleMinimap(fromApp: boolean) {
  if (!readSettings().minimap) return false
  const window = ensureMinimapWindow()
  if (window.isVisible()) {
    window.hide()
    return false
  }
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
