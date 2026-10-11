/**
 * Our copy of tarkov.dev's maps on the Raid OS server (server/src/services/mapMirror.ts, /v1/map-tiles/…): the app
 * takes tiles, schemes and maps.json from Raid OS. Published builds never retry an upstream host.
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

/** The URL rendered by the app: our server whenever this is a known map asset. */
export const primaryMapUrl = (url: string) => mirroredMapUrl(url) ?? url

/** maps.json from the copy (when GitHub / tarkov.dev is unreachable). */
export const mirroredMapsJsonUrl = () => `${server}/v1/map-tiles/maps.json`

/** Fetch only from our copy. A missing file remains a normal server error. */
export async function fetchWithMirror(url: string, init?: RequestInit) {
  return fetch(primaryMapUrl(url), init)
}
