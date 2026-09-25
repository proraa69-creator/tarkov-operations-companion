/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from './demo'
import { fetchTarkovData } from './tarkovApi'

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
  const query = useQuery({
    queryKey: ['tarkov-companion-data'],
    queryFn: fetchTarkovData,
    staleTime: 1000 * 60 * 20,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    retry: 1,
  })

  const source = query.data ? (query.isFetchedAfterMount ? 'live' : 'cache') : 'demo'
  const value: DataContextValue = {
    data: query.data ?? demoDataset,
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
