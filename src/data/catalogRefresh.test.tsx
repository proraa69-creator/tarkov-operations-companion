import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_REFRESH_MS, catalogRefetchDelay, createFailureCounter, isInitialCatalogLoad } from './catalogRefresh'

const fetchCatalog = vi.fn()
vi.mock('./tarkovJsonClient', () => ({ fetchTarkovCatalog: (...args: unknown[]) => fetchCatalog(...args) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
vi.mock('../i18n/englishDataset', () => ({ useEnglishOverlay: (data: unknown) => data }))
vi.mock('../i18n/catalogTranslations', () => ({ loadEnglishCatalog: vi.fn() }))

describe('catalog refresh timing', () => {
  it('polls every minute while it works and backs off 1 → 2 → 5 → 15 min while it fails', () => {
    expect(catalogRefetchDelay(0)).toBe(CATALOG_REFRESH_MS)
    expect([1, 2, 3, 4, 5, 9].map((failures) => catalogRefetchDelay(failures))).toEqual([60_000, 120_000, 300_000, 900_000, 900_000, 900_000])
  })

  it('never polls on the server laptop', () => {
    expect(catalogRefetchDelay(0, true)).toBe(false)
    expect(catalogRefetchDelay(3, true)).toBe(false)
  })

  it('counts failures in a row per mode and resets after a success', () => {
    const count = createFailureCounter()
    expect(count('pvp', { errorUpdateCount: 1, dataUpdatedAt: 0, errorUpdatedAt: 10 })).toBe(1)
    expect(count('pvp', { errorUpdateCount: 2, dataUpdatedAt: 0, errorUpdatedAt: 20 })).toBe(2)
    expect(count('pvp', { errorUpdateCount: 2, dataUpdatedAt: 30, errorUpdatedAt: 20 })).toBe(0)
    expect(count('pvp', { errorUpdateCount: 3, dataUpdatedAt: 30, errorUpdatedAt: 40 })).toBe(1)
    expect(count('pve', { errorUpdateCount: 1, dataUpdatedAt: 0, errorUpdatedAt: 5 })).toBe(1)
  })

  it('the full-screen loader is for the very first load only', () => {
    expect(isInitialCatalogLoad({ hasData: false, isFetching: true, settledOnce: false })).toBe(true)
    expect(isInitialCatalogLoad({ hasData: false, isFetching: true, settledOnce: true })).toBe(false)
    expect(isInitialCatalogLoad({ hasData: true, isFetching: true, settledOnce: true })).toBe(false)
  })
})

describe('DataProvider with tarkov.dev unreachable', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); fetchCatalog.mockReset() })
  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, 'tarkovDesktop') })

  async function mount() {
    const { DataProvider, useTarkovData } = await import('./DataProvider')
    let mounts = 0
    function Page() {
      const { initialLoading, isFetching, source } = useTarkovData()
      useEffect(() => { mounts += 1 }, [])
      return <div data-testid="page" data-initial={String(initialLoading)} data-fetching={String(isFetching)} data-source={source} />
    }
    function Shell() {
      const { initialLoading } = useTarkovData()
      // Like AppShell: the loader replaces the page only while `initialLoading`.
      return initialLoading ? <div data-testid="loader" /> : <Page />
    }
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 10 } } })
    render(<QueryClientProvider client={client}><DataProvider><Shell /></DataProvider></QueryClientProvider>)
    return { mounts: () => mounts, client }
  }

  it('shows the loader once, then keeps the page mounted during background refetches with growing gaps', async () => {
    fetchCatalog.mockRejectedValue(new Error('tarkov.dev unreachable'))
    const view = await mount()
    expect(screen.getByTestId('loader')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) }) // first load + its one retry fail
    expect(screen.getByTestId('page').dataset.source).toBe('demo')
    const callsAfterFirst = fetchCatalog.mock.calls.length
    expect(view.mounts()).toBe(1)

    // 1 min later: a background refetch — no loader, same page instance.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchCatalog.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    expect(screen.queryByTestId('loader')).toBeNull()
    expect(view.mounts()).toBe(1)

    // The next ones wait longer: nothing new 1 minute after the second failure (it waits 2 minutes).
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    const afterSecond = fetchCatalog.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchCatalog.mock.calls.length).toBe(afterSecond)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchCatalog.mock.calls.length).toBeGreaterThan(afterSecond)
    expect(screen.queryByTestId('loader')).toBeNull()
    expect(view.mounts()).toBe(1)
    view.client.clear()
  })

  it('the server laptop fetches once and does not poll', async () => {
    Object.assign(window, { tarkovDesktop: { serverMode: true } })
    fetchCatalog.mockRejectedValue(new Error('tarkov.dev unreachable'))
    const view = await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(fetchCatalog).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000) })
    expect(fetchCatalog).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('loader')).toBeNull()
    view.client.clear()
  })
})
