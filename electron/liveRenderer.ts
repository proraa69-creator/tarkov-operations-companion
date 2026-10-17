import { powerMonitor } from 'electron'
import { APP_INDEX_FILE, devRendererUrl, trustLiveRenderer } from './ipcGuard.js'

/**
 * Live update of the interface (owner, 17.10.2026; electron/appUpdate.ts decides when): the main window loads the staged
 * build's dist/index.html — a verified build that differs only in its page (electron/deltaUpdate.ts) — on the same route.
 * It stays file://, so localStorage, sessionStorage and IndexedDB stay: Chromium keeps one storage origin for every
 * file:// page (checked on Electron 44.4.5 under xvfb: all three survive a loadFile from one app.asar/dist/index.html to
 * another). What lives only in the page's memory (an open dialog, text typed and not saved) is gone, which is why this
 * waits for the window to be unused (windowNotInUse).
 */

/** A staged page that has not loaded and drawn its root within this time goes back to the old one. */
export const LIVE_LOAD_TIMEOUT_MS = 20_000
/** After the load, how long React has to put something into #root (a white page is a failure). */
export const LIVE_RENDER_CHECK_MS = 3_000
/** No keyboard or mouse input on this computer for so long: the window counts as not in use even when focused. */
export const WINDOW_IDLE_SECONDS = 180

/** The part of a BrowserWindow this needs (the tests pass a stand-in). */
export interface LiveWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  isFocused(): boolean
  loadFile(file: string, options?: { hash?: string }): Promise<void>
  webContents: {
    getURL(): string
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
    on(event: 'render-process-gone', listener: () => void): unknown
    off(event: 'render-process-gone', listener: () => void): unknown
  }
}

/** «Автообновление» may switch the page only while the window is not in use: minimized, hidden, behind the game, or idle. */
export function windowNotInUse(window: LiveWindow | null, idleSeconds = () => powerMonitor.getSystemIdleTime()) {
  if (!window || window.isDestroyed()) return false
  return window.isMinimized() || !window.isVisible() || !window.isFocused() || idleSeconds() >= WINDOW_IDLE_SECONDS
}

/**
 * Loads `indexFile` (electron/deltaUpdate.ts liveRendererIndex) into the window; the IPC guard trusts exactly that file
 * from now on (trustLiveRenderer). true: it loaded and drew #root. false: it failed to load, its renderer process died,
 * it drew nothing or took longer than LIVE_LOAD_TIMEOUT_MS — the window is back on APP_INDEX_FILE (same route), only that
 * page is trusted again, and electron/appUpdate.ts marks the build bad. null: nothing was tried (no window, a development
 * run, or a file the guard may not trust).
 */
export function loadLiveRenderer(window: LiveWindow | null, indexFile: string): Promise<boolean | null> {
  if (!window || window.isDestroyed() || devRendererUrl()) return Promise.resolve(null)
  const contents = window.webContents
  let hash = ''
  try { hash = new URL(contents.getURL()).hash.slice(1) } catch { /* no page yet */ }
  if (!trustLiveRenderer(indexFile)) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      contents.off('render-process-gone', gone)
      if (!ok) {
        // Back to the running archive's own page, and only that one is trusted again.
        trustLiveRenderer('')
        if (!window.isDestroyed()) void window.loadFile(APP_INDEX_FILE, hash ? { hash } : undefined).catch(() => {})
      }
      resolve(ok)
    }
    const gone = () => finish(false)
    const timer = setTimeout(() => finish(false), LIVE_LOAD_TIMEOUT_MS)
    contents.on('render-process-gone', gone)
    window.loadFile(indexFile, hash ? { hash } : undefined).then(() => {
      setTimeout(() => {
        if (settled) return
        if (window.isDestroyed()) { finish(false); return }
        contents.executeJavaScript("(document.getElementById('root')?.childElementCount ?? 0) > 0", true)
          .then((drawn) => finish(drawn === true), () => finish(false))
      }, LIVE_RENDER_CHECK_MS)
    }, () => finish(false))
  })
}
