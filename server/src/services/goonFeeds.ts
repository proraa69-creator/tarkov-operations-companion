/**
 * «Кочевники» from other trackers, so the card has sightings while few players report in the app (owner, 17.11.2026, report
 * 180: «Со всех сайтов бери данные по кочевникам, только не указывай, что мы их откуда-то там берем, просто указывай ник и
 * когда видели. И синхронизируй с нашими кочевниками»).
 *
 * Every few minutes the public lists of other trackers are read and each new sighting is saved beside our own (same store,
 * same 24 hours): map, time and the nickname of who saw them. Nothing tells the players where a sighting came from. PvP, PvE
 * and Seasonal stay apart: a feed adds only to the mode it is about.
 */
import { GOON_MAP_IDS, GOON_RETENTION_MS, type GoonMapId, type GoonMode, type GoonSighting, type GoonStore } from './goonStore.js'

export interface FeedSighting { mode: GoonMode; mapId: GoonMapId; reportedAt: string; nickname?: string }

export type FeedFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export interface GoonFeed {
  /** Reporter key of the feed's sightings (never returned by the API). */
  key: string
  url: string
  parse(body: string, nowMs: number): FeedSighting[]
}

const isGoonMap = (value: unknown): value is GoonMapId => typeof value === 'string' && (GOON_MAP_IDS as readonly string[]).includes(value)

/** EFT nicknames: letters, digits, «_», «-» (the app shows nothing else, src/data/goonTracker.ts). */
const NICKNAME = /^[\p{L}\p{N}_-]{2,32}$/u
/** Names a player must not read in the app: a tracker's own name or bot, and the rude ones. */
const HIDDEN_NAME = /^(bot[-_]|tarkov|goon|admin|test$)|fuck|dick|cunt|nigg|shibal|хуй|хуе|пизд|ебл|ебан|бля|сук[аи]|пидор/iu

/** A nickname as shown, or none: a «|TTV»-like tail cut, anything not like an EFT nickname dropped. */
export function feedNickname(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const name = raw.split('|')[0]!.trim()
  if (!NICKNAME.test(name) || HIDDEN_NAME.test(name)) return undefined
  return name
}

/** Minutes are what the list gives: the sighting's time to the minute. */
const minuteOf = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString()

/**
 * PvP only (its report form says so): `{ data: [{ reporter, location, created }] }`, `created` in minutes ago.
 */
export function parseMinutesAgoFeed(body: string, nowMs: number): FeedSighting[] {
  let root: unknown
  try { root = JSON.parse(body) } catch { return [] }
  const rows = (root as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row): FeedSighting[] => {
    const entry = row as { reporter?: unknown; location?: unknown; created?: unknown } | null
    const minutes = Number(entry?.created)
    if (!entry || !isGoonMap(entry.location) || !Number.isFinite(minutes) || minutes < 0) return []
    const nickname = feedNickname(entry.reporter)
    return [{ mode: 'pvp', mapId: entry.location, reportedAt: minuteOf(nowMs - minutes * 60_000), ...(nickname ? { nickname } : {}) }]
  })
}

/** A Next.js page whose `__NEXT_DATA__` holds `trackings: [{ username, map: { slug }, currentDate }]`. */
export function parseNextDataFeed(mode: GoonMode) {
  return (body: string): FeedSighting[] => {
    const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(body)
    if (!match) return []
    let rows: unknown
    try { rows = (JSON.parse(match[1]!) as { props?: { pageProps?: { trackings?: unknown } } }).props?.pageProps?.trackings } catch { return [] }
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row): FeedSighting[] => {
      const entry = row as { username?: unknown; map?: { slug?: unknown }; currentDate?: unknown } | null
      const time = typeof entry?.currentDate === 'string' ? Date.parse(entry.currentDate) : NaN
      if (!entry || !isGoonMap(entry.map?.slug) || !Number.isFinite(time)) return []
      const nickname = feedNickname(entry.username)
      return [{ mode, mapId: entry.map.slug, reportedAt: new Date(time).toISOString(), ...(nickname ? { nickname } : {}) }]
    })
  }
}

export const GOON_FEEDS: readonly GoonFeed[] = [
  { key: 'feed:a', url: 'https://tarkov.help/api/ru/goons/reports?limit=50&offset=0', parse: parseMinutesAgoFeed },
  { key: 'feed:b', url: 'https://www.tarkov-goon-tracker.com/', parse: parseNextDataFeed('pvp') },
  { key: 'feed:c', url: 'https://www.tarkov-goon-tracker.com/pve', parse: parseNextDataFeed('pve') },
]

/** The same sighting read again (or from another tracker, or reported in the app): same map, same nickname, this close. */
export const FEED_SAME_SIGHTING_MS = 3 * 60_000

/**
 * Saves the new ones; returns how many. Skipped: older than the day kept, in the future, or already there — the same map
 * and nickname within 3 minutes (one without a nickname: the same map and feed within 3 minutes).
 */
export function importFeedSightings(store: GoonStore, feedKey: string, sightings: readonly FeedSighting[], nowMs: number): number {
  const known = new Map<GoonMode, GoonSighting[]>()
  const dayOf = (mode: GoonMode) => {
    let list = known.get(mode)
    if (!list) { list = store.list(mode, nowMs - GOON_RETENTION_MS - FEED_SAME_SIGHTING_MS); known.set(mode, list) }
    return list
  }
  let added = 0
  for (const sighting of sightings) {
    const time = Date.parse(sighting.reportedAt)
    if (!Number.isFinite(time) || time < nowMs - GOON_RETENTION_MS || time > nowMs + 60_000) continue
    const name = sighting.nickname?.toLowerCase()
    const day = dayOf(sighting.mode)
    const same = day.some((entry) => entry.mapId === sighting.mapId && Math.abs(Date.parse(entry.reportedAt) - time) <= FEED_SAME_SIGHTING_MS
      && (name ? entry.nickname?.toLowerCase() === name : !entry.nickname && entry.reporter === feedKey))
    if (same) continue
    const saved: GoonSighting = { mapId: sighting.mapId, mode: sighting.mode, reportedAt: new Date(time).toISOString(), reporter: feedKey, ...(sighting.nickname ? { nickname: sighting.nickname } : {}) }
    store.add(saved)
    day.push(saved)
    added += 1
  }
  return added
}

/** Each feed is read this often: a few small requests, far below what a page visitor makes. */
export const GOON_FEED_EVERY_MS = 3 * 60_000
const FEED_TIMEOUT_MS = 20_000
const FEED_MAX_BYTES = 2 * 1024 * 1024

export interface GoonFeedOptions {
  store: GoonStore
  feeds?: readonly GoonFeed[]
  fetch?: FeedFetch
  now?: () => number
  everyMs?: number
  /** Told once a round added anything, so every running app refreshes the card (routes/mapUpdates.ts). */
  onImported?: () => void
  log?: (line: string) => void
}

/** One round over every feed; a feed that fails is skipped until the next round. */
export async function readGoonFeeds(options: GoonFeedOptions): Promise<number> {
  const fetchFeed = options.fetch ?? (globalThis.fetch as unknown as FeedFetch)
  const now = options.now ?? Date.now
  let added = 0
  for (const feed of options.feeds ?? GOON_FEEDS) {
    try {
      const response = await fetchFeed(feed.url, { headers: { accept: 'application/json, text/html', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) })
      if (!response.ok) { options.log?.(`Goon feed ${feed.key}: HTTP ${response.status}`); continue }
      const body = await response.text()
      if (body.length > FEED_MAX_BYTES) continue
      const time = now()
      added += importFeedSightings(options.store, feed.key, feed.parse(body, time), time)
    } catch (error) {
      options.log?.(`Goon feed ${feed.key}: ${error instanceof Error ? error.message : 'failed'}`)
    }
  }
  if (added > 0) { try { options.onImported?.() } catch { /* the sightings are saved anyway */ } }
  return added
}

/** Reads the feeds now and then every few minutes; returns the stop function. */
export function startGoonFeeds(options: GoonFeedOptions): () => void {
  let running = false
  const round = () => {
    if (running) return
    running = true
    void readGoonFeeds(options).finally(() => { running = false })
  }
  const first = setTimeout(round, 5_000)
  const timer = setInterval(round, options.everyMs ?? GOON_FEED_EVERY_MS)
  first.unref?.(); timer.unref?.()
  return () => { clearTimeout(first); clearInterval(timer) }
}
