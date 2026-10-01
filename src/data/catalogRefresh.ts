/**
 * How often the game catalog (tarkov.dev, src/data/tarkovJsonClient.ts) is fetched again.
 * - While it works: every minute (prices move).
 * - While it fails (tarkov.dev unreachable or slow): 1, 2, 5, then every 15 minutes — not a fixed minute, which kept
 *   the app (the server laptop in particular) busy «loading the current database» all the time.
 * - The server laptop (--server-mode) does not show the catalog to anyone: it fetches once and never polls; the server
 *   process keeps its own catalog cache for the players' apps.
 */
export const CATALOG_REFRESH_MS = 60_000
export const CATALOG_RETRY_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000]

export function catalogRefetchDelay(consecutiveFailures: number, serverMode = false): number | false {
  if (serverMode) return false
  if (consecutiveFailures <= 0) return CATALOG_REFRESH_MS
  return CATALOG_RETRY_MS[Math.min(consecutiveFailures, CATALOG_RETRY_MS.length) - 1]
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
