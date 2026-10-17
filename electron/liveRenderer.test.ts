// @vitest-environment node
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const ipcMain = Object.assign(new EventEmitter(), { handle: () => {}, handleOnce: () => {}, removeHandler: () => {} })
  return { ipcMain, app: { isPackaged: true }, idle: { seconds: 0 } }
})
vi.mock('electron', () => ({ ipcMain: electron.ipcMain, app: electron.app, powerMonitor: { getSystemIdleTime: () => electron.idle.seconds } }))

const { APP_INDEX_FILE, isTrustedAppPage, trustLiveRenderer } = await import('./ipcGuard')
const { LIVE_LOAD_TIMEOUT_MS, LIVE_RENDER_CHECK_MS, loadLiveRenderer, windowNotInUse } = await import('./liveRenderer')

const LIVE = join(tmpdir(), 'Raid OS Updates', 'client', '1792000000000', 'app.asar', 'dist', 'index.html')
const OLD_PAGE = `${pathToFileURL(APP_INDEX_FILE).href}#/maps/customs`

/** A BrowserWindow stand-in: loadFile resolves (or rejects / hangs) as told, #root has children unless told otherwise. */
function fakeWindow(options: { load?: 'ok' | 'fail' | 'hang'; drawn?: boolean } = {}) {
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => OLD_PAGE,
    executeJavaScript: vi.fn(async () => options.drawn ?? true),
  })
  const state = { destroyed: false, minimized: false, visible: true, focused: true }
  const loadFile = vi.fn((file: string) => {
    if (file === APP_INDEX_FILE || (options.load ?? 'ok') === 'ok') return Promise.resolve()
    return options.load === 'fail' ? Promise.reject(new Error('ERR_FILE_NOT_FOUND')) : new Promise<void>(() => {})
  })
  return {
    state,
    loadFile,
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    isVisible: () => state.visible,
    isFocused: () => state.focused,
    webContents: contents,
  }
}

beforeEach(() => { vi.useFakeTimers(); electron.app.isPackaged = true; electron.idle.seconds = 0 })
afterEach(() => { vi.useRealTimers(); trustLiveRenderer('') })

describe('live update of the interface in the window (electron/liveRenderer.ts)', () => {
  it('loads the staged page on the same route, checks that it drew #root, and keeps it trusted', async () => {
    const window = fakeWindow()
    const result = loadLiveRenderer(window, LIVE)
    await vi.advanceTimersByTimeAsync(LIVE_RENDER_CHECK_MS)
    await expect(result).resolves.toBe(true)
    expect(window.loadFile).toHaveBeenCalledExactlyOnceWith(LIVE, { hash: '/maps/customs' })
    expect(window.webContents.executeJavaScript).toHaveBeenCalledOnce()
    expect(isTrustedAppPage(`${pathToFileURL(LIVE).href}#/`)).toBe(true)
    // A later crash is not this load's business.
    expect(window.webContents.listenerCount('render-process-gone')).toBe(0)
  })

  it('goes back to the running page (same route) and trusts only it when the page fails, dies, stays white or hangs', async () => {
    const cases: Array<[string, ReturnType<typeof fakeWindow>, (window: ReturnType<typeof fakeWindow>) => void]> = [
      ['did-fail-load', fakeWindow({ load: 'fail' }), () => {}],
      ['white page', fakeWindow({ drawn: false }), () => {}],
      ['render-process-gone', fakeWindow({ load: 'hang' }), (window) => window.webContents.emit('render-process-gone')],
      ['timeout', fakeWindow({ load: 'hang' }), () => {}],
    ]
    for (const [name, window, act] of cases) {
      const result = loadLiveRenderer(window, LIVE)
      act(window)
      await vi.advanceTimersByTimeAsync(LIVE_LOAD_TIMEOUT_MS)
      await expect(result, name).resolves.toBe(false)
      expect(window.loadFile, name).toHaveBeenLastCalledWith(APP_INDEX_FILE, { hash: '/maps/customs' })
      expect(isTrustedAppPage(pathToFileURL(LIVE).href), name).toBe(false)
      expect(isTrustedAppPage(OLD_PAGE), name).toBe(true)
    }
  })

  it('tries nothing without a window, in a development run, or for a file the IPC guard may not trust', async () => {
    await expect(loadLiveRenderer(null, LIVE)).resolves.toBeNull()
    const gone = fakeWindow()
    gone.state.destroyed = true
    await expect(loadLiveRenderer(gone, LIVE)).resolves.toBeNull()
    const window = fakeWindow()
    await expect(loadLiveRenderer(window, join(tmpdir(), 'Downloads', 'index.html'))).resolves.toBeNull()
    electron.app.isPackaged = false
    await expect(loadLiveRenderer(window, LIVE)).resolves.toBeNull()
    expect(window.loadFile).not.toHaveBeenCalled()
  })

  it('the window is not in use when minimized, hidden, behind another window or after three idle minutes', () => {
    const window = fakeWindow()
    expect(windowNotInUse(window)).toBe(false)
    electron.idle.seconds = 180
    expect(windowNotInUse(window)).toBe(true)
    electron.idle.seconds = 0
    window.state.focused = false
    expect(windowNotInUse(window)).toBe(true)
    window.state.focused = true
    window.state.minimized = true
    expect(windowNotInUse(window)).toBe(true)
    window.state.minimized = false
    window.state.visible = false
    expect(windowNotInUse(window)).toBe(true)
    expect(windowNotInUse(null)).toBe(false)
  })
})
