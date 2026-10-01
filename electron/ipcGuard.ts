import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isAppPageUrl } from './trustedPages.js'

/**
 * IPC only from the app's own pages. main.ts imports this module first, so the guard is in place before any
 * ipcMain.handle / ipcMain.on is registered (main.ts registerIpc, experimental/index.ts registerIpc): every handler is
 * wrapped, and a message whose sender frame is gone or is not an app page (a web page, a <webview> guest, a window
 * that navigated away) is refused — an invoke rejects with an error, a send is ignored (a sendSync gets null, so the
 * page does not hang).
 *
 * App pages: dist/index.html of this app with any #route — the main window and the item card / minimap overlays
 * (loadRenderer in main.ts, overlayWindow in experimental/index.ts) — or, in a development run only, exactly the
 * ELECTRON_RENDERER_URL origin (electron/trustedPages.ts).
 */
export const APP_INDEX_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'index.html')

/** The Vite dev server for a development run (ELECTRON_RENDERER_URL); a packaged exe never loads or trusts it. */
export function devRendererUrl() {
  return app.isPackaged ? '' : process.env.ELECTRON_RENDERER_URL?.trim() || ''
}

export function isTrustedAppPage(url: string) {
  return isAppPageUrl(url, { indexFile: APP_INDEX_FILE, devUrl: devRendererUrl() })
}

function fromAppPage(event: IpcMainEvent | IpcMainInvokeEvent) {
  const frame = event.senderFrame
  return Boolean(frame && isTrustedAppPage(frame.url))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (event: IpcMainEvent, ...args: any[]) => void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown

const guardedListeners = new WeakMap<Listener, Listener>()
function guardListener(listener: Listener): Listener {
  let guarded = guardedListeners.get(listener)
  if (!guarded) {
    guarded = function (this: unknown, event, ...args) {
      if (fromAppPage(event)) return listener.apply(this, [event, ...args])
      try { event.returnValue = null } catch { /* not a sendSync */ }
    }
    // EventEmitter matches `.listener` in removeListener (as for once()), so removing the original still works.
    guardedListeners.set(listener, Object.assign(guarded, { listener }))
  }
  return guarded
}

const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel: string, handler: Handler) => handle(channel, (event, ...args) => {
  if (!fromAppPage(event)) throw new Error(`IPC «${channel}» refused: the sender is not an app page`)
  return handler(event, ...args)
})
ipcMain.handleOnce = (channel: string, handler: Handler) => ipcMain.handle(channel, (event, ...args) => {
  ipcMain.removeHandler(channel)
  return handler(event, ...args)
})
// once() and prependOnceListener() register through on() / prependListener(), so they are guarded too.
for (const method of ['on', 'addListener', 'prependListener'] as const) {
  const register = ipcMain[method].bind(ipcMain)
  ipcMain[method] = ((channel: string, listener: Listener) => register(channel, guardListener(listener))) as typeof ipcMain.on
}
