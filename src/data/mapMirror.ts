/**
 * Our copy of tarkov.dev's maps on the Raid OS server (server/src/services/mapMirror.ts, /v1/map-tiles/…): the app
 * takes tiles, schemes and maps.json from Raid OS first. During the initial server bootstrap only, a file missing from
 * the copy may be retried from tarkov.dev so maps do not go blank while the mirror is still filling.
 */
const DEFAULT_SERVER = 'https://raidos.app'
let server = DEFAULT_SERVER

/** The Raid OS server the copy lives on (the account's server address; HTTPS only). */
export function setMapMirrorServer(origin: string | undefined) {
  try {
    const url = origin ? new URL(origin) : null
    server = url && url.protocol === 'https:' ? url.origin : DEFAULT_SERVER
  } catch {
    server = DEFAULT_SERVER
  }
}

/** The copy's address of a tarkov.dev map file (tile, scheme), or undefined for anything else. */
export function mirroredMapUrl(url: string): string | undefined {
  const match = /^https:\/\/assets\.tarkov\.dev\/(maps\/[A-Za-z0-9_./{}-]+)$/.exec(url)
  if (!match || match[1].includes('..')) return undefined
  return `${server}/v1/map-tiles/${match[1]}`
}

/** Convert a mirrored URL back to its upstream asset for the temporary bootstrap fallback. */
export function upstreamMapUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== server) return undefined
    const pathname = decodeURIComponent(parsed.pathname)
    const match = /^\/v1\/map-tiles\/(maps\/[A-Za-z0-9_./{}-]+)$/.exec(pathname)
    return match && !match[1].includes('..') ? `https://assets.tarkov.dev/${match[1]}` : undefined
  } catch { return undefined }
}

/** The URL rendered by the app: our server whenever this is a known map asset. */
export const primaryMapUrl = (url: string) => mirroredMapUrl(url) ?? url

/** maps.json from the copy (when GitHub / tarkov.dev is unreachable). */
export const mirroredMapsJsonUrl = () => `${server}/v1/map-tiles/maps.json`

/** Leaflet `tileerror`: during bootstrap, try the original source once after our copy. */
export function retryTileFromMirror(event: { tile: HTMLImageElement }) {
  const tile = event.tile
  if (tile.dataset.upstreamFallback) return
  const fallback = upstreamMapUrl(tile.src)
  if (!fallback) return
  tile.dataset.upstreamFallback = '1'
  tile.src = fallback
}

/** Fetch from our copy, then use upstream only as a bootstrap fallback. */
export async function fetchWithMirror(url: string, init?: RequestInit) {
  const primary = primaryMapUrl(url)
  try {
    const response = await fetch(primary, init)
    if (response.ok) return response
    throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    if (primary === url) throw error
    return fetch(url, init)
  }
}
