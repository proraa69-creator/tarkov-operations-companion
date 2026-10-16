/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from './demo'
import { fetchTarkovCatalog } from './tarkovJsonClient'
import { useAppState } from '../state/AppState'
import { cleanDatasetText } from '../shared/questText'
import { withQuestGrid } from './questGrid'
import { useLocale } from '../i18n/LocaleProvider'
import { loadEnglishCatalog } from '../i18n/catalogTranslations'
import { useEnglishOverlay } from '../i18n/englishDataset'
import { CATALOG_REFRESH_MS, isInitialCatalogLoad, useCatalogAutoRefresh } from './catalogRefresh'
import { canLoadGameData, useDataAccess } from '../account/dataAccess'
import { useMapBossPlacements, withOwnerBosses } from './mapBossPlacements'
import { useQuestPointOverrides, withQuestPointOverrides } from './questPointOverrides'
import { useQuestTextOverrides, withQuestTextOverrides } from './questTextOverrides'
import { useLiveMapUpdates } from './mapUpdates'

/**
 * The catalog for the pages. It changes only when the catalog does: a refresh that brings nothing new (or is still
 * running) does not re-render the app — that part is in DataStatus below.
 */
interface DataContextValue {
  data: AppDataset
  source: 'live' | 'cache' | 'demo'
  /** Only the very first load (full-screen loader); background refetches keep the page as it is. */
  initialLoading: boolean
  refresh: () => void
}

/** What every refresh changes, unchanged catalog or not: only the refresh button and the «обновлено …» labels read it. */
interface DataStatusValue {
  isFetching: boolean
  /** When the catalog was last loaded (or found unchanged on the server). */
  updatedAt?: number
  error?: string
}

const DataContext = createContext<DataContextValue | null>(null)
const DataStatusContext = createContext<DataStatusValue>({ isFetching: false })

export function DataProvider({ children }: { children: ReactNode }) {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  // Players' app: nothing is requested before the server has granted access (the paywall is shown instead).
  const allowed = canLoadGameData(useDataAccess())
  useEffect(() => { if (allowed && locale === 'en') void loadEnglishCatalog(raidMode) }, [allowed, locale, raidMode])
  // The server laptop (--server-mode) fetches once and never polls.
  const serverMode = typeof window !== 'undefined' && window.tarkovDesktop?.serverMode === true
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['tarkov-companion-data', raidMode],
    // The catalog on screen goes along: unchanged on the server, it comes back as the very same object (no re-render,
    // no cache write — src/data/tarkovJsonClient.ts).
    queryFn: ({ queryKey }) => fetchTarkovCatalog(raidMode, 'ru', client.getQueryData<AppDataset>(queryKey)),
    enabled: allowed,
    staleTime: CATALOG_REFRESH_MS,
    // Refreshes follow the window and the game instead (below): every 10 min while the app is in use and no raid runs,
    // never behind the game; failures back off 1 → 2 → 5 → 15 min (src/data/catalogRefresh.ts).
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    retry: serverMode ? 0 : 1,
  })
  const { refetch } = query
  useCatalogAutoRefresh({
    enabled: allowed, serverMode, key: raidMode,
    dataUpdatedAt: query.dataUpdatedAt, errorUpdatedAt: query.errorUpdatedAt, errorUpdateCount: query.errorUpdateCount,
    fromCache: query.data?.metadata?.source === 'cache', fetching: query.isFetching, refetch,
  })

  const source = query.data ? (query.data.metadata?.source === 'cache' ? 'cache' : 'live') : 'demo'
  // Each quest's trader line and level and tarkov.help's view of it (src/data/questGrid.ts): the quest chronology.
  const russian = useMemo(() => cleanDatasetText(withQuestGrid(query.data ?? demoDataset, raidMode)), [query.data, raidMode])
  // English display text is laid over the Russian catalog by id (see src/i18n/englishDataset.ts).
  const translated = useEnglishOverlay(russian, raidMode, locale, allowed)
  // Bosses the owner placed by hand (in this mode, or for every mode) replace the automatic markers of that boss on that
  // map (src/data/mapBossPlacements.ts).
  const placements = useMapBossPlacements(allowed)
  // Quest points the owner corrected by hand (bug reports) are moved / hidden / added on top (src/data/questPointOverrides.ts).
  const questPoints = useQuestPointOverrides(allowed)
  // Quest texts the owner corrected in the quest constructor, in this interface language (src/data/questTextOverrides.ts).
  const questTexts = useQuestTextOverrides(allowed)
  // The owner's map corrections reach this app as soon as they are saved on the server (data/mapUpdates.ts).
  useLiveMapUpdates(allowed)
  const data = useMemo(() => {
    // Texts first: a point the owner added or moved then carries the corrected objective / stage text too.
    const texted = withQuestTextOverrides(translated, questTexts, locale === 'en' ? 'en' : 'ru')
    if (!placements.length && !questPoints.length) return texted
    const withBosses = placements.length ? withOwnerBosses(texted.markers, placements, raidMode) : texted.markers
    return { ...texted, markers: withQuestPointOverrides(withBosses, questPoints, texted.quests) }
  }, [translated, questTexts, locale, placements, questPoints, raidMode])
  const refresh = useCallback(() => { void refetch() }, [refetch])
  const initialLoading = isInitialCatalogLoad({ hasData: Boolean(query.data), isFetching: query.isFetching, settledOnce: query.errorUpdateCount > 0 || query.dataUpdatedAt > 0 })
  const value = useMemo<DataContextValue>(() => ({ data, source, initialLoading, refresh }), [data, source, initialLoading, refresh])
  const error = query.error instanceof Error ? query.error.message : undefined
  const status = useMemo<DataStatusValue>(() => ({ isFetching: query.isFetching, updatedAt: query.dataUpdatedAt || undefined, error }), [query.isFetching, query.dataUpdatedAt, error])

  return <DataContext.Provider value={value}><DataStatusContext.Provider value={status}>{children}</DataStatusContext.Provider></DataContext.Provider>
}

export function useTarkovData() {
  const value = useContext(DataContext)
  if (!value) throw new Error('useTarkovData must be used within DataProvider')
  return value
}

/** Whether the catalog is being fetched and when it was last loaded: the refresh button and the «обновлено …» labels. */
export function useTarkovDataStatus() {
  return useContext(DataStatusContext)
}

/** The game data when there is a provider (a dialog that also opens outside it, e.g. in tests). */
export function useOptionalTarkovData() {
  return useContext(DataContext)
}
