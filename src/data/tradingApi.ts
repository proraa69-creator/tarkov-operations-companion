import { useQuery } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import type { TradingSnapshot } from '../domain/trading'
import { dataRoute, gatewayRequest } from './tarkovApi'

/**
 * The statistics of «Торговля» for one mode (server/src/services/tradingStats.ts). The server renews them every 6 hours,
 * so the app asks every 3 at most and never while its window is hidden: signals move with the prices the app already has
 * (the catalog every 10 minutes, the minute prices on the page itself), not with this file.
 */
export const TRADING_REFRESH_MS = 3 * 60 * 60_000
/** While there is nothing yet: a short answer from the server, and the page is not left empty for 3 hours. */
export const TRADING_RETRY_MS = 15 * 60_000

const GATHERING = 'ещё собирается'

const MODE_KEY: Record<RaidMode, TradingSnapshot['mode']> = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season' }

/** The mode's statistics, or null for another mode's file or a broken one: PvP, PvE and Season never mix. */
export function parseTradingSnapshot(body: unknown, mode: RaidMode): TradingSnapshot | null {
  const root = (body && typeof body === 'object' ? body : {}) as Partial<TradingSnapshot>
  if (root.format !== 1 || root.mode !== MODE_KEY[mode] || !Array.isArray(root.rows) || typeof root.builtAt !== 'string' || !root.fee) return null
  return root as TradingSnapshot
}

export function useTradingStats(mode: RaidMode, enabled = true) {
  return useQuery({
    queryKey: ['trading-stats', mode],
    queryFn: async () => {
      try { return parseTradingSnapshot(await gatewayRequest('GET', `/v1/data/trading/${mode}`), mode) }
      catch (error) {
        // The server's own answer while it has no file: nothing went wrong.
        if (error instanceof Error && error.message.includes(GATHERING)) return null
        throw error
      }
    },
    enabled: enabled && dataRoute() === 'gateway',
    refetchInterval: (query) => query.state.data ? TRADING_REFRESH_MS : TRADING_RETRY_MS,
    staleTime: TRADING_REFRESH_MS / 2,
    refetchOnWindowFocus: false,
    gcTime: 60 * 60_000,
    retry: 1,
  })
}
