import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_REFRESH_MS, CATALOG_RETRY_MS, CATALOG_SETTLE_MS, catalogRefetchDelay, catalogRefreshWait, createFailureCounter, isInitialCatalogLoad } from './catalogRefresh'
import { RAID_HOLD_MAX_MS } from '../app/useRaidState'
import type { AppDataset } from '../domain/types'
import type { RaidState } from '../import/raidState'

const fetchCatalog = vi.fn()
vi.mock('./tarkovJsonClient', () => ({ fetchTarkovCatalog: (...args: unknown[]) => fetchCatalog(...args) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
vi.mock('../i18n/englishDataset', () => ({ useEnglishOverlay: (data: unknown) => data }))
vi.mock('../i18n/catalogTranslations', () => ({ loadEnglishCatalog: vi.fn() }))

describe('catalog refresh timing', () => {
  it('refreshes every 10 minutes while it works and backs off 1 → 2 → 5 → 15 min while it fails', () => {
    expect(CATALOG_REFRESH_MS).toBe(10 * 60_000)
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

describe('catalog refresh policy: never behind the game or during a raid', () => {
  const now = 50_000_000
  const base = { now, lastAttemptAt: now, failures: 0, inUse: true, raid: null as RaidState | null, serverMode: false }

  it('every 10 minutes while the window is in use; not behind the game, in a raid, before the first answer or on the server laptop', () => {
    expect(catalogRefreshWait(base)).toBe(CATALOG_REFRESH_MS)
    expect(catalogRefreshWait({ ...base, now: now + 4 * 60_000 })).toBe(6 * 60_000)
    expect(catalogRefreshWait({ ...base, inUse: false })).toBe(false)
    expect(catalogRefreshWait({ ...base, raid: { inRaid: true, since: now - 60_000, location: 'bigmap' } })).toBe(false)
    expect(catalogRefreshWait({ ...base, raid: { inRaid: false } })).toBe(CATALOG_REFRESH_MS)
    expect(catalogRefreshWait({ ...base, lastAttemptAt: 0 })).toBe(false)
    expect(catalogRefreshWait({ ...base, serverMode: true })).toBe(false)
  })

  it('a refresh due while the player was away starts only once the window has been in use a few seconds', () => {
    expect(catalogRefreshWait({ ...base, now: now + 45 * 60_000 })).toBe(CATALOG_SETTLE_MS)
  })

  it('backs off while it fails; a catalog read back from the cache is tried again after a minute', () => {
    expect(catalogRefreshWait({ ...base, failures: 2 })).toBe(CATALOG_RETRY_MS[1])
    expect(catalogRefreshWait({ ...base, fromCache: true })).toBe(CATALOG_RETRY_MS[0])
    expect(catalogRefreshWait({ ...base, fromCache: true, failures: 3 })).toBe(CATALOG_RETRY_MS[2])
  })

  it('a raid whose end never reached the logs stops holding the refresh back after two hours', () => {
    expect(catalogRefreshWait({ ...base, now: now + 30 * 60_000, raid: { inRaid: true, since: now + 30 * 60_000 - RAID_HOLD_MAX_MS + 1 } })).toBe(false)
    expect(catalogRefreshWait({ ...base, now: now + 30 * 60_000, raid: { inRaid: true, since: now + 30 * 60_000 - RAID_HOLD_MAX_MS } })).toBe(CATALOG_SETTLE_MS)
  })
})

describe('DataProvider in the desktop app: refreshes follow the window and the raid', () => {
  const raidListeners = new Set<(state: RaidState) => void>()
  let focus: ReturnType<typeof vi.spyOn>
  const dataset = { quests: [{ id: 'q1' }], items: [], maps: [], markers: [], hideout: [], traders: [], metadata: { source: 'json.tarkov.dev', mode: 'pvp', loadedAt: '', counts: {}, contentVersion: '1'.repeat(40) } } as unknown as AppDataset

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    fetchCatalog.mockReset()
    // The server's catalog does not change: the client hands back the catalog on screen (tarkovJsonClient.ts).
    fetchCatalog.mockImplementation(async (_mode: string, _locale: string, previous?: AppDataset) => previous ?? dataset)
    focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    raidListeners.clear()
    Object.assign(window, { tarkovDesktop: {
      isDesktop: true,
      serviceRequest: vi.fn(async () => null),
      getRaidState: vi.fn(async () => ({ inRaid: false })),
      onRaidStateChanged: (listener: (state: RaidState) => void) => { raidListeners.add(listener); return () => raidListeners.delete(listener) },
    } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'tarkovDesktop')
  })

  async function mount() {
    const { DataProvider, useTarkovData, useTarkovDataStatus } = await import('./DataProvider')
    const renders = { page: 0, button: 0 }
    function Page() {
      const { data } = useTarkovData()
      renders.page += 1
      return <div data-testid="page">{data.quests.length}</div>
    }
    function RefreshButton() {
      const { isFetching } = useTarkovDataStatus()
      renders.button += 1
      return <span data-testid="spin" data-fetching={String(isFetching)} />
    }
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 10 } } })
    render(<QueryClientProvider client={client}><DataProvider><Page /><RefreshButton /></DataProvider></QueryClientProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    return { renders, client }
  }
  const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  const toGame = async () => { focus.mockReturnValue(false); window.dispatchEvent(new Event('blur')); await pass(1) }
  const backToApp = async () => { focus.mockReturnValue(true); await act(async () => { window.dispatchEvent(new Event('focus')) }) }
  const raid = async (inRaid: boolean) => { await act(async () => { for (const listener of raidListeners) listener(inRaid ? { inRaid: true, since: Date.now(), location: 'bigmap' } : { inRaid: false }) }) }

  it('every 10 minutes in use, nothing behind the game or in a raid, and once the player is back', async () => {
    const view = await mount()
    expect(fetchCatalog).toHaveBeenCalledTimes(1)
    await pass(CATALOG_REFRESH_MS - 1000)
    expect(fetchCatalog).toHaveBeenCalledTimes(1)
    await pass(1100)
    expect(fetchCatalog).toHaveBeenCalledTimes(2)
    // The catalog on screen went along (the server is asked with its version).
    expect(fetchCatalog.mock.calls[1]?.[2]).toBe(dataset)

    await toGame()
    await pass(60 * 60_000)
    expect(fetchCatalog).toHaveBeenCalledTimes(2)
    // Back for a quick look: nothing yet; staying a few seconds: the overdue refresh.
    await backToApp()
    await pass(CATALOG_SETTLE_MS - 1000)
    await toGame()
    await pass(30 * 60_000)
    expect(fetchCatalog).toHaveBeenCalledTimes(2)
    await backToApp()
    await pass(CATALOG_SETTLE_MS + 100)
    expect(fetchCatalog).toHaveBeenCalledTimes(3)

    // A raid while the window is in use (alt-tabbed out of it): no refresh until it ends.
    await raid(true)
    await pass(40 * 60_000)
    expect(fetchCatalog).toHaveBeenCalledTimes(3)
    await raid(false)
    await pass(CATALOG_SETTLE_MS + 100)
    expect(fetchCatalog).toHaveBeenCalledTimes(4)
    view.client.clear()
  })

  it('a refresh that brings the same catalog re-renders only the refresh button, not the pages', async () => {
    const view = await mount()
    const before = { ...view.renders }
    await pass(CATALOG_REFRESH_MS + 100)
    expect(fetchCatalog).toHaveBeenCalledTimes(2)
    expect(view.renders.page).toBe(before.page)
    expect(view.renders.button).toBeGreaterThan(before.button)
    view.client.clear()
  })
})

describe('DataProvider with tarkov.dev unreachable', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); fetchCatalog.mockReset() })
  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, 'tarkovDesktop') })

  async function mount() {
    const { DataProvider, useTarkovData, useTarkovDataStatus } = await import('./DataProvider')
    let mounts = 0
    function Page() {
      const { initialLoading, source } = useTarkovData()
      const { isFetching } = useTarkovDataStatus()
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
