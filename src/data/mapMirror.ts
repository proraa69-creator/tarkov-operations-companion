/**
 * Our copy of tarkov.dev's maps on the Raid OS server (server/src/services/mapMirror.ts, /v1/map-tiles/…): the app
 * keeps taking tiles, schemes and maps.json from tarkov.dev and switches to the copy when tarkov.dev does not answer
 * (owner, 10.10.2026: «чтобы не зависеть ни от кого»). A tile that fails on tarkov.dev is asked once more from the copy.
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

/** maps.json from the copy (when GitHub / tarkov.dev is unreachable). */
export const mirroredMapsJsonUrl = () => `${server}/v1/map-tiles/maps.json`

/** Leaflet `tileerror`: the same tile once more from our copy. */
export function retryTileFromMirror(event: { tile: HTMLImageElement }) {
  const tile = event.tile
  if (tile.dataset.mirror) return
  const fallback = mirroredMapUrl(tile.src)
  if (!fallback) return
  tile.dataset.mirror = '1'
  tile.src = fallback
}

/** Fetch from tarkov.dev, then from the copy. */
export async function fetchWithMirror(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, init)
    if (response.ok) return response
    throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    const fallback = mirroredMapUrl(url)
    if (!fallback) throw error
    return fetch(fallback, init)
  }
}
