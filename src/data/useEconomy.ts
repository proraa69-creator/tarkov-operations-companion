import { useQuery } from '@tanstack/react-query'
import type { RaidMode } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { fetchEconomySnapshot, fetchPriceHistory, graphqlGameMode } from './economyApi'

/** Barters, crafts and prices for the selected mode (query key per mode + language: modes never share data). */
export function useEconomySnapshot(mode: RaidMode) {
  const { locale } = useLocale()
  const supported = graphqlGameMode(mode) !== null
  const query = useQuery({
    queryKey: ['tarkov-economy', mode, locale],
    queryFn: () => fetchEconomySnapshot(mode, locale),
    enabled: supported,
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
    gcTime: 60 * 60_000,
    retry: 1,
  })
  return { ...query, supported }
}

/** Up to 30 days of flea history for one item in one mode; the 7-day view is a slice of the same points. */
export function usePriceHistory(itemId: string | undefined, mode: RaidMode) {
  const supported = graphqlGameMode(mode) !== null
  const query = useQuery({
    queryKey: ['tarkov-price-history', mode, itemId],
    queryFn: () => fetchPriceHistory(itemId!, mode, 30),
    enabled: Boolean(itemId) && supported,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  return { ...query, supported }
}
