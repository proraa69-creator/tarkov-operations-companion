/**
 * Content-Security-Policy of the desktop app's pages (the main window and the overlays, all dist/index.html).
 *
 * Electron loads the page from file://, where no response header can carry a policy, and the same index.html is also
 * the phone app (Capacitor) and the Vite dev page, which need other addresses (a server address typed on the phone, the
 * dev server's inline React Refresh preamble). So index.html carries only what fits everywhere (object-src 'none',
 * base-uri 'none'), and this module — the first import of src/main.tsx, evaluated before any other app code — adds
 * the strict policy as a <meta> when the page is the packaged desktop renderer. Both policies are enforced together.
 *
 * Scripts only from the app itself (no inline scripts, no eval — React, Leaflet and three.js need neither); network
 * only to the hosts the renderer really fetches from. The API server is reached through the main process (IPC), never
 * from the page, so it is not listed. `frame-ancestors` is ignored in a <meta> policy, so it is not repeated here (a
 * file:// page cannot be framed by a web page anyway).
 */

/** Hosts the desktop renderer fetches from directly (see the comments for who uses each). */
export const DESKTOP_CONNECT_HOSTS = [
  // tarkov.dev GraphQL / JSON (owner's app and development; the players' app goes through the server, and the main
  // process cancels these requests there — electron/main.ts).
  'https://api.tarkov.dev',
  'https://json.tarkov.dev',
  // Map SVG layers and tiles (src/components/FloorSvgOverlay.tsx; tilePath / svgPath of maps.json).
  'https://assets.tarkov.dev',
  // tarkov.dev map configuration (src/data/mapConfigClient.ts).
  'https://raw.githubusercontent.com',
  // Fandom wiki API for the quest catalogue (src/data/wikiQuestCatalog.ts).
  'https://escapefromtarkov.fandom.com',
]

function origin(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : ''
  } catch {
    return ''
  }
}

/** The policy text; `extraConnect`: build-time service addresses (VITE_COMPANION_API_URL, VITE_SERVICE_URL), if any. */
export function desktopContentSecurityPolicy(extraConnect: unknown[] = []) {
  const connect = [...new Set([...DESKTOP_CONNECT_HOSTS, ...extraConnect.map(origin).filter(Boolean)])]
  return [
    "default-src 'self'",
    "script-src 'self'",
    // The 3D boss viewer's physics worker is bundled inline (a blob: URL).
    "worker-src 'self' blob:",
    // React style props and Leaflet's inline positioning.
    "style-src 'self' 'unsafe-inline'",
    // Item icons, map tiles and wiki pictures come from several CDNs; blob: map layers, data: icons from CSS.
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    // data: / blob: for small inlined assets and glTF textures.
    `connect-src 'self' data: blob: ${connect.join(' ')}`,
    // <webview> of the wiki maps (src/components/WikiMapEmbed.tsx).
    'frame-src https://escapefromtarkov.fandom.com',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/** True for the desktop renderer loaded from the app's files (not the dev server, the phone app or a browser). */
export function isPackagedDesktopPage(win: Pick<Window, 'location'> & { tarkovDesktop?: { isDesktop?: boolean } } = window) {
  return Boolean(win.tarkovDesktop?.isDesktop) && win.location.protocol === 'file:'
}

/** Adds the strict policy to <head> (once). Returns whether it was added. */
export function installDesktopContentSecurityPolicy(doc: Document = document, win: Pick<Window, 'location'> & { tarkovDesktop?: { isDesktop?: boolean } } = window) {
  if (!isPackagedDesktopPage(win) || doc.querySelector('meta[data-raidos-csp]')) return false
  const meta = doc.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.setAttribute('data-raidos-csp', '')
  meta.content = desktopContentSecurityPolicy([import.meta.env.VITE_COMPANION_API_URL, import.meta.env.VITE_SERVICE_URL])
  doc.head.prepend(meta)
  return true
}

installDesktopContentSecurityPolicy()
