import { useEffect, useRef, useSyncExternalStore } from 'react'
import { startAppActivity, useAppActive } from '../app/appActivity'
import { raidRunning, useRaidState } from '../app/useRaidState'
import type { RaidState } from '../import/raidState'

/**
 * How often the game catalog (src/data/tarkovJsonClient.ts) is fetched again (owner, 14.10.2026: «что бы не было лагов
 * фризов и зависаний в игре при использовании приложения»).
 * - Every 10 minutes, and only while the window is in use (src/app/appActivity.ts: visible and focused; the phone and
 *   the browser: visible) and no raid is running (the game's logs). A refresh used to run every minute behind the game:
 *   the main process downloaded, parsed and copied the whole catalog, the page stringified it back, the main process
 *   encrypted it synchronously, and every page re-rendered — a hitch once a minute, at the player's expense.
 * - Back in the window, or out of the raid, with a catalog older than that: a few seconds later (a quick look at the app
 *   costs nothing; the refresh starts only once the player stays).
 * - An unchanged catalog costs almost nothing (an empty 304, the same object, no cache write: tarkovJsonClient.ts).
 * - While it fails: 1, 2, 5, then every 15 minutes, under the same rules; a catalog read back from the cache is tried
 *   again after a minute.
 * - The server laptop (--server-mode) does not show the catalog to anyone: it fetches once and never polls; the server
 *   process keeps its own catalog cache for the players' apps.
 */
export const CATALOG_REFRESH_MS = 10 * 60_000
export const CATALOG_RETRY_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000]
/** The window has to be in use this long before a due refresh starts. */
export const CATALOG_SETTLE_MS = 5000

export function catalogRefetchDelay(consecutiveFailures: number, serverMode = false): number | false {
  if (serverMode) return false
  if (consecutiveFailures <= 0) return CATALOG_REFRESH_MS
  return CATALOG_RETRY_MS[Math.min(consecutiveFailures, CATALOG_RETRY_MS.length) - 1]
}

/**
 * When the next refresh may start: `false` while it may not (no answer yet, the window not in use, a raid, the server
 * laptop), else in how many milliseconds (at least CATALOG_SETTLE_MS).
 */
export function catalogRefreshWait(input: {
  now: number
  /** The last answer or failure (react-query's dataUpdatedAt / errorUpdatedAt). */
  lastAttemptAt: number
  failures: number
  /** The catalog shown was read back from the cache, not from the server. */
  fromCache?: boolean
  inUse: boolean
  raid: RaidState | null
  serverMode: boolean
}): number | false {
  const delay = catalogRefetchDelay(input.fromCache ? Math.max(input.failures, 1) : input.failures, input.serverMode)
  if (delay === false || !input.lastAttemptAt || !input.inUse || raidRunning(input.raid, input.now)) return false
  return Math.max(CATALOG_SETTLE_MS, input.lastAttemptAt + delay - input.now)
}

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
const pageVisible = () => document.visibilityState !== 'hidden'

/** Desktop app: the window is in use (visible and focused). Phone and browser: the page is visible. */
export function useWindowInUse() {
  const desktop = typeof window !== 'undefined' && Boolean(window.tarkovDesktop)
  useEffect(() => (desktop ? startAppActivity() : undefined), [desktop])
  const active = useAppActive()
  const visible = useSyncExternalStore(subscribeVisibility, pageVisible, () => true)
  return desktop ? active : visible
}

/**
 * Refreshes the catalog query by the rules above; react-query's own interval and focus refetch are off (it knows
 * neither the game nor the raid). `key`: the game mode, failures are counted per mode (PvP / PvE / Season).
 */
export function useCatalogAutoRefresh(input: {
  enabled: boolean
  serverMode: boolean
  key: string
  dataUpdatedAt: number
  errorUpdatedAt: number
  errorUpdateCount: number
  fromCache: boolean
  fetching: boolean
  refetch: () => unknown
}) {
  const inUse = useWindowInUse()
  const raid = useRaidState()
  const failures = useRef<ReturnType<typeof createFailureCounter> | null>(null)
  const { enabled, serverMode, key, dataUpdatedAt, errorUpdatedAt, errorUpdateCount, fromCache, fetching, refetch } = input
  useEffect(() => {
    if (!enabled || fetching) return
    failures.current ??= createFailureCounter()
    const wait = catalogRefreshWait({
      now: Date.now(),
      lastAttemptAt: Math.max(dataUpdatedAt, errorUpdatedAt),
      failures: failures.current(key, { dataUpdatedAt, errorUpdatedAt, errorUpdateCount }),
      fromCache, inUse, raid, serverMode,
    })
    if (wait === false) return
    const timer = window.setTimeout(() => { void refetch() }, wait)
    return () => window.clearTimeout(timer)
  }, [enabled, fetching, inUse, raid, serverMode, key, dataUpdatedAt, errorUpdatedAt, errorUpdateCount, fromCache, refetch])
}

/**
 * The full-screen «Загружаем актуальную базу» only for the very first load, before any answer — never for a background
 * refetch: the page stays mounted with the data already shown and only the top-bar refresh icon spins.
 */
export function isInitialCatalogLoad(state: { hasData: boolean; isFetching: boolean; settledOnce: boolean }) {
  return !state.hasData && state.isFetching && !state.settledOnce
}

/**
 * Failed loads in a row for a react-query query state: total errors minus the errors counted at the last success
 * (react-query only keeps the running total). One counter per query key (PvP / PvE / Season).
 */
export function createFailureCounter() {
  const baselines = new Map<string, number>()
  return (key: string, state: { errorUpdateCount: number; dataUpdatedAt: number; errorUpdatedAt: number }) => {
    if (state.dataUpdatedAt > 0 && state.dataUpdatedAt >= state.errorUpdatedAt) baselines.set(key, state.errorUpdateCount)
    return Math.max(0, state.errorUpdateCount - (baselines.get(key) ?? 0))
  }
}
