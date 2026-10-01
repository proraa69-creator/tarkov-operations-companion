import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Which pages the app trusts (pure functions, no Electron: unit-tested in trustedPages.test.ts).
 * Every app window — the main window, the item card and minimap overlays — loads the same renderer page:
 * dist/index.html from the app (any #route), or in a development run the Vite dev server.
 */
export interface AppPages {
  /** Absolute path of dist/index.html. */
  indexFile: string
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
 * True for the app's own page: the renderer file itself (any #route or ?query), or a page of exactly the dev
 * server's origin. Not `http://127.0.0.1.evil.com`, another port, another local file or a web page.
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
  const [page, index] = [path.normalize(file), path.normalize(pages.indexFile)]
  // Windows paths are case-insensitive (Chromium may report the drive letter in another case).
  return windows ? page.toLowerCase() === index.toLowerCase() : page === index
}

/** Links opened in the system browser: any HTTPS page, or the local website / API on this computer (exact host). */
export function isExternalAllowed(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  } catch {
    return false
  }
}

