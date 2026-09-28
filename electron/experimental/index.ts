import { createRequire } from 'node:module'
import { BrowserWindow, desktopCapturer, ipcMain, screen, type Display, type Point } from 'electron'
import type { PlayerPosition } from '../../src/overlay/screenshotPosition.js'
import { recognizeRegion } from '../screenOcr.js'
import { PositionTracker, screenshotsFolder } from './positionTracker.js'
import { HOTKEYS } from '../../src/overlay/hotkeys.js'
import { readSettings, updateSettings, type ExperimentalSettings } from './settings.js'
import { isTarkovForeground, isVirtualKeyDown, nativeKeysAvailable } from './win32.js'

const require = createRequire(import.meta.url)

interface HookEvent { keycode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
interface UiohookModule {
  uIOhook: { on: (event: 'keydown', listener: (event: HookEvent) => void) => void; start: () => void; stop: () => void; keyTap: (key: number) => void }
  UiohookKey: Record<string, number>
}

interface Options {
  preload: string
  load: (window: BrowserWindow, hash: string) => void
  mainWindow: () => BrowserWindow | null
  raidState: () => { inRaid: boolean; since?: number; location?: string }
}

const ITEM_OVERLAY = { width: 300, height: 72 }
const MINIMAP_OVERLAY = { width: 520, height: 520 }
const ITEM_HIDE_MS = 9000
const QUERY_TIMEOUT_MS = 5000
const KEY_REPEAT_MS = 350

let options: Options
let hook: UiohookModule | null = null
let hookError = ''
let itemWindow: BrowserWindow | null = null
let minimapWindow: BrowserWindow | null = null
let itemHideTimer: NodeJS.Timeout | null = null
let screenshotTimer: NodeJS.Timeout | null = null
let keyTimer: NodeJS.Timeout | null = null
let lastPosition: PlayerPosition | null = null
let lastKeyAt = 0
let lookupBusy = false
let queryId = 0
const pending = new Map<number, (payload: unknown) => void>()
const overlayPayloads = new WeakMap<BrowserWindow, Map<string, unknown>>()
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
  const raid = options.raidState()
  if (raid.inRaid && (!raid.since || position.at >= raid.since)) sendOverlay(minimapWindow, 'overlay:position', position)
})

export function startExperimental(next: Options) {
  options = next
  registerIpc()
  startHook()
  applySettings(readSettings())
}

export function stopExperimental() {
  tracker.stop()
  if (screenshotTimer) clearInterval(screenshotTimer)
  screenshotTimer = null
  if (keyTimer) clearInterval(keyTimer)
  keyTimer = null
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
    lastPosition,
    raid: options.raidState(),
  }))
  ipcMain.handle('experimental:answer', (_event, id: unknown, payload: unknown) => {
    const resolve = pending.get(Number(id))
    pending.delete(Number(id))
    resolve?.(payload)
  })
  ipcMain.handle('experimental:toggle-minimap', () => toggleMinimap(true))
  ipcMain.handle('experimental:test-item', () => lookupItem(true))
}

function applySettings(settings: ExperimentalSettings) {
  if (settings.tracking) void tracker.start()
  else tracker.stop()
  if (screenshotTimer) clearInterval(screenshotTimer)
  screenshotTimer = null
  if (settings.tracking && settings.autoScreenshot) {
    screenshotTimer = setInterval(() => {
      // Only press the screenshot key in a raid, with the game in front — never into other apps.
      if (!hook || !options.raidState().inRaid || !isTarkovForeground()) return
      hook.uIOhook.keyTap(hook.UiohookKey.PrintScreen!)
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
          if (settings.tracking && options.raidState().inRaid && hook) hook.uIOhook.keyTap(hook.UiohookKey.PrintScreen!)
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
        if (settings.tracking && options.raidState().inRaid) uIOhook.keyTap(UiohookKey.PrintScreen!)
        void toggleMinimap(false)
      }
    })
    uIOhook.start()
  } catch (error) {
    hook = null
    hookError = error instanceof Error ? error.message : String(error)
  }
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
  window.setIgnoreMouseEvents(true)
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
  window.setIgnoreMouseEvents(true)
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
  if (!readSettings().itemLookup || lookupBusy) return null
  lookupBusy = true
  try {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    itemWindow?.hide()
    // Capture the tooltip before drawing our own window above it.
    const text = test ? '' : await captureAroundCursor(point, display).catch(() => '')
    const window = ensureItemWindow()
    await whenLoaded(window)
    reassertOverlay(window)
    placeNearCursor(window, point, display)
    sendOverlay(window, 'overlay:item', { state: 'loading' })
    showOverlay(window)
    if (itemHideTimer) clearTimeout(itemHideTimer)

    const answer = test
      ? await askRenderer('item', { text: '', test: true })
      : text ? await askRenderer('item', { text }) : null
    sendOverlay(window, 'overlay:item', answer ?? { state: 'not-found', text })
    itemHideTimer = setTimeout(() => window.hide(), ITEM_HIDE_MS)
    return answer
  } finally {
    lookupBusy = false
  }
}

function placeNearCursor(window: BrowserWindow, point: Point, display: Display) {
  const area = display.workArea
  const x = Math.min(point.x + 28, area.x + area.width - ITEM_OVERLAY.width - 8)
  const y = Math.min(Math.max(point.y + 24, area.y + 8), area.y + area.height - ITEM_OVERLAY.height - 8)
  window.setBounds({ x: Math.round(x), y: Math.round(y), ...ITEM_OVERLAY })
}

/** The EFT item tooltip and the short name on the cell sit right around the cursor. */
async function captureAroundCursor(point: Point, display: Display) {
  const scale = display.scaleFactor || 1
  const physical = { width: Math.round(display.bounds.width * scale), height: Math.round(display.bounds.height * scale) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: physical })
  const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return ''
  const image = source.thumbnail
  const size = image.getSize()
  const ratio = size.width / display.bounds.width
  const unit = size.height / 1080
  const cx = (point.x - display.bounds.x) * ratio
  const cy = (point.y - display.bounds.y) * ratio
  const left = Math.max(0, Math.round(cx - 400 * unit))
  const top = Math.max(0, Math.round(cy - 220 * unit))
  const width = Math.min(size.width - left, Math.round(900 * unit))
  const height = Math.min(size.height - top, Math.round(440 * unit))
  if (width < 40 || height < 20) return ''
  return recognizeRegion(image.crop({ x: left, y: top, width, height }))
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
  const payload = await askRenderer('minimap', { location: raid.location, fromApp })
  sendOverlay(window, 'overlay:minimap', payload ?? { state: 'no-data' })
  sendOverlay(window, 'overlay:position', raid.inRaid && lastPosition && (!raid.since || lastPosition.at >= raid.since) ? lastPosition : null)
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const width = Math.min(MINIMAP_OVERLAY.width, Math.max(320, area.width - 48))
  const height = Math.min(MINIMAP_OVERLAY.height, Math.max(320, area.height - 48))
  window.setBounds({ x: area.x + area.width - width - 24, y: area.y + 24, width, height })
  showOverlay(window)
  return true
}
