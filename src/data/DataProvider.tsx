/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from './demo'
import { fetchTarkovCatalog } from './tarkovJsonClient'
import { useAppState } from '../state/AppState'
import { cleanDatasetText } from '../shared/questText'
import { useLocale } from '../i18n/LocaleProvider'
import { loadEnglishCatalog } from '../i18n/catalogTranslations'

interface DataContextValue {
  data: AppDataset
  source: 'live' | 'cache' | 'demo'
  isFetching: boolean
  updatedAt?: number
  error?: string
  refresh: () => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  useEffect(() => { if (locale === 'en') void loadEnglishCatalog(raidMode) }, [locale, raidMode])
  const query = useQuery({
    queryKey: ['tarkov-companion-data', raidMode],
    queryFn: () => fetchTarkovCatalog(raidMode, 'ru'),
    staleTime: 55_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    retry: 1,
  })

  const source = query.data ? (query.data.metadata?.source === 'cache' ? 'cache' : 'live') : 'demo'
  const data = useMemo(() => cleanDatasetText(query.data ?? demoDataset), [query.data])
  const value: DataContextValue = {
    data,
    source,
    isFetching: query.isFetching,
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
