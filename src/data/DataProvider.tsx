/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from './demo'
import { fetchTarkovCatalog } from './tarkovJsonClient'
import { useAppState } from '../state/AppState'
import { cleanDatasetText } from '../shared/questText'
import { useLocale } from '../i18n/LocaleProvider'
import { loadEnglishCatalog } from '../i18n/catalogTranslations'
import { useEnglishOverlay } from '../i18n/englishDataset'
import { catalogRefetchDelay, createFailureCounter, isInitialCatalogLoad } from './catalogRefresh'

interface DataContextValue {
  data: AppDataset
  source: 'live' | 'cache' | 'demo'
  isFetching: boolean
  /** Only the very first load (full-screen loader); background refetches keep the page as it is. */
  initialLoading: boolean
  updatedAt?: number
  error?: string
  refresh: () => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  useEffect(() => { if (locale === 'en') void loadEnglishCatalog(raidMode) }, [locale, raidMode])
  // Failed loads in a row (reset by a successful one): the retry backs off 1 → 2 → 5 → 15 min (src/data/catalogRefresh.ts).
  const failures = useRef(createFailureCounter())
  // The server laptop (--server-mode) fetches once and never polls.
  const serverMode = typeof window !== 'undefined' && window.tarkovDesktop?.serverMode === true
  const query = useQuery({
    queryKey: ['tarkov-companion-data', raidMode],
    queryFn: () => fetchTarkovCatalog(raidMode, 'ru'),
    staleTime: 55_000,
    refetchInterval: (current) => catalogRefetchDelay(failures.current(current.queryHash, current.state), serverMode),
    refetchIntervalInBackground: !serverMode,
    refetchOnWindowFocus: !serverMode,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    retry: serverMode ? 0 : 1,
  })

  const source = query.data ? (query.data.metadata?.source === 'cache' ? 'cache' : 'live') : 'demo'
  const russian = useMemo(() => cleanDatasetText(query.data ?? demoDataset), [query.data])
  // English display text is laid over the Russian catalog by id (see src/i18n/englishDataset.ts).
  const data = useEnglishOverlay(russian, raidMode, locale)
  const value: DataContextValue = {
    data,
    source,
    isFetching: query.isFetching,
    initialLoading: isInitialCatalogLoad({ hasData: Boolean(query.data), isFetching: query.isFetching, settledOnce: query.errorUpdateCount > 0 || query.dataUpdatedAt > 0 }),
    updatedAt: query.dataUpdatedAt || undefined,
    error: query.error instanceof Error ? query.error.message : undefined,
    refresh: () => void query.refetch(),
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useTarkovData() {
  const value = useContext(DataContext)
  if (!value) throw new Error('useTarkovData must be used within DataProvider')
  return value
}
