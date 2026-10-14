import { createHash } from 'node:crypto'
import type { AppDataset } from '../../../src/domain/types'

export type CatalogLocale = 'ru' | 'en'

/** `"loadedAt":"…"` as JSON.stringify writes it (a quote inside a string value is always escaped, so never a match there). */
const LOADED_AT = /"loadedAt":"[^"\\]*"/g

/**
 * Hex hash of a catalog's JSON without `metadata.loadedAt`: the time a snapshot was built, not its content. The same
 * content built twice hashes the same (services/questBase.ts versions its snapshots with it).
 */
export function hashWithoutLoadedAt(body: string, algorithm: 'sha1' | 'sha256' = 'sha1') {
  const hash = createHash(algorithm)
  let from = 0
  for (const match of body.matchAll(LOADED_AT)) {
    hash.update(body.slice(from, match.index))
    from = match.index + match[0].length
  }
  hash.update(body.slice(from))
  return hash.digest('hex')
}

/**
 * Weak ETag of a catalog answer (GET /v1/catalog/:mode): the SHA-1 of its JSON without `metadata.loadedAt`. The players'
 * app sends it back in If-None-Match (electron/serviceGateway.ts) and gets «304 Not Modified» while the catalog stays
 * the same: no download, no parse, no rewrite of its encrypted cache. Apps that send nothing get the catalog as before.
 * Computed once per prepared answer (services/catalogAnswers.ts), never per request.
 */
export function catalogEtag(body: string) {
  return `W/"${hashWithoutLoadedAt(body)}"`
}

/**
 * If-None-Match names this ETag (weak comparison, a list or `*`). Checked by the route itself: Express's own check
 * (req.fresh) never answers 304 to a request with `Cache-Control: no-cache`, and fetch() adds exactly that to every
 * request carrying If-None-Match — the desktop app's main process included.
 */
export function catalogNotModified(ifNoneMatch: string | undefined, etag: string) {
  if (!ifNoneMatch) return false
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === opaque(etag))
}

/** After failed builds in a row: 1, 2, 5, then 15 minutes before the sources are asked again (the last good base is served meanwhile). */
export const CATALOG_RETRY_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000]

/**
 * A built catalog is accepted only with quests, maps and items: an empty or cut answer from tarkov.dev must not replace
 * the last good snapshot (the players would lose their quests until the next build).
 */
export function isUsableCatalog(data: AppDataset | undefined): data is AppDataset {
  return Boolean(data && data.quests?.length && data.maps?.length && data.items?.length && Array.isArray(data.markers))
}
