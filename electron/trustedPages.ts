import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Which pages the app trusts (pure functions, no Electron: unit-tested in trustedPages.test.ts).
 * The app's window loads the renderer page (there are no other windows since the in-game overlays went, 15.10.2026):
 * dist/index.html from the app (any #route), or in a development run the Vite dev server.
 */
export interface AppPages {
  /** Absolute path of dist/index.html. */
  indexFile: string
  /**
   * dist/index.html of the staged build the window shows after a live update (electron/deltaUpdate.ts liveRendererIndex:
   * a build verified like the one electron/boot.ts starts); '' when there is none. Only an absolute `app.asar/dist/index.html`.
   */
  liveIndexFile?: string
  /** The dev server (ELECTRON_RENDERER_URL) in a development run; '' otherwise. */
  devUrl?: string
  /** Compare Windows paths (default: the current platform). */
  windows?: boolean
}

function exactOrigin(raw: string | undefined) {
  if (!raw) return ''
  try {
    const { origin } = new URL(raw)
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

/**
 * True for the app's own page: the renderer file itself (any #route or ?query), the staged build's renderer file after a
 * live update (liveIndexFile), or a page of exactly the dev server's origin. Not `http://127.0.0.1.evil.com`, another port, another local file or a web page.
 */
export function isAppPageUrl(raw: string, pages: AppPages): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  const dev = exactOrigin(pages.devUrl)
  if (dev && url.origin === dev) return true
  if (url.protocol !== 'file:') return false
  const windows = pages.windows ?? process.platform === 'win32'
  let file: string
  try { file = fileURLToPath(url, { windows }) } catch { return false }
  const path = windows ? win32 : posix
  const page = path.normalize(file)
  // Windows paths are case-insensitive (Chromium may report the drive letter in another case).
  const same = (index: string) => windows ? page.toLowerCase() === path.normalize(index).toLowerCase() : page === path.normalize(index)
  return same(pages.indexFile) || Boolean(pages.liveIndexFile && isArchiveIndex(pages.liveIndexFile, windows) && same(pages.liveIndexFile))
}

/** An absolute path ending in app.asar/dist/index.html (the page inside a build's archive). */
function isArchiveIndex(file: string, windows: boolean) {
  const path = windows ? win32 : posix
  if (!path.isAbsolute(file) || (windows && !/^[a-z]:\\/i.test(path.normalize(file)))) return false
  const parts = path.normalize(file).split(path.sep).slice(-3)
  return parts.length === 3 && parts[0].toLowerCase() === 'app.asar' && parts[1] === 'dist' && parts[2] === 'index.html' && !file.split(/[\\/]/).includes('..')
}

/**
 * Addresses the main process itself builds (the website of the configured server, «Личный кабинет»): any HTTPS page,
 * or the local website / API on this computer (exact host). Links coming from a page go through
 * electron/externalLinks.ts instead (known sites only, anything else after a confirmation dialog).
 */
export function isExternalAllowed(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  } catch {
    return false
  }
}

/** Hosts the app shows in a <webview>: none — the app embeds no outside pages (the wiki maps were removed, 12.10.2026). */
export const WEBVIEW_HOSTS: string[] = []

/** A <webview> may attach only to these hosts, over HTTPS on the default port, without credentials in the URL. */
export function isEmbeddableWebviewUrl(raw: string) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && WEBVIEW_HOSTS.includes(url.hostname) && !url.port && !url.username && !url.password
  } catch {
    return false
  }
}
