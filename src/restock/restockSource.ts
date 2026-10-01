import { useQuery } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'
import { graphqlGameMode, TARKOV_GRAPHQL_URL } from '../arsenal/ammoSource'
import type { TraderReset } from './restock'

/** tarkov.dev GraphQL: `traders(gameMode: GameMode, lang: LanguageCode) { id name normalizedName resetTime imageLink }`. */
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
      name: typeof trader.name === 'string' ? trader.name : id,
      normalizedName: typeof trader.normalizedName === 'string' ? trader.normalizedName : undefined,
      imageUrl: typeof trader.imageLink === 'string' ? trader.imageLink : undefined,
      resetTime: typeof trader.resetTime === 'string' && trader.resetTime ? trader.resetTime : undefined,
    }]
  })
}

export async function fetchTraderResets(mode: RaidMode, locale: AppLocale, fetcher: typeof fetch = fetch): Promise<TraderReset[]> {
  const response = await fetcher(TARKOV_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: tradersQuery(mode, locale) }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`tarkov.dev: HTTP ${response.status}`)
  return adaptTradersResponse(await response.json())
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
