import { useQuery } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { graphqlGameMode } from '../arsenal/ammoSource'
import { loadTarkovDataset } from '../data/tarkovDataset'
import { buildLegacyTraders } from '../data/tarkovJsonAdapters'
import type { TraderReset } from './restock'
import { traderDisplayName } from '../data/traderNames'

/** Kept for legacy snapshot identity and compatibility tests. */
export function tradersQuery(mode: RaidMode, locale: AppLocale) {
  return `{ traders(gameMode: ${graphqlGameMode(mode)}, lang: ${locale === 'en' ? 'en' : 'ru'}) { id name normalizedName resetTime imageLink } }`
}

export function adaptTradersResponse(payload: unknown): TraderReset[] {
  const traders = (payload as { data?: { traders?: unknown } })?.data?.traders
  if (!Array.isArray(traders)) return []
  return traders.flatMap((raw) => {
    const trader = (raw ?? {}) as Record<string, unknown>
    const id = typeof trader.id === 'string' ? trader.id : ''
    if (!id) return []
    return [{
      id,
      name: traderDisplayName(typeof trader.name === 'string' ? trader.name : '', typeof trader.normalizedName === 'string' ? trader.normalizedName : undefined) || 'Торговец',
      normalizedName: typeof trader.normalizedName === 'string' ? trader.normalizedName : undefined,
      imageUrl: typeof trader.imageLink === 'string' ? trader.imageLink : undefined,
      resetTime: typeof trader.resetTime === 'string' && trader.resetTime ? trader.resetTime : undefined,
    }]
  })
}

export async function fetchTraderResets(mode: RaidMode, locale: AppLocale): Promise<TraderReset[]> {
  return adaptTradersResponse({ data: { traders: buildLegacyTraders(await loadTarkovDataset(mode, locale)) } })
}

/** Restock times for the selected mode; refreshed every 2 minutes so a passed restock picks up the next time soon. */
export function useTraderResets(mode: RaidMode, locale: AppLocale) {
  return useQuery({
    queryKey: ['tarkov-trader-resets', graphqlGameMode(mode), locale],
    queryFn: () => fetchTraderResets(mode, locale),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: true,
    gcTime: 60 * 60_000,
    retry: 1,
  })
}
