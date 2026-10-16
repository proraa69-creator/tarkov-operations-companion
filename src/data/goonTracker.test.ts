import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { GOON_REFRESH_MS, mergeGoonView, parseGoonReport, parseGoonSnapshot, readOwnSightings, useGoonTracker } from './goonTracker'

describe('Goons feed formats', () => {
  it('reads the live single-report shape and millisecond timestamp', () => {
    expect(parseGoonReport({ map: '5704e4dad2720bb55b8b4567', timestamp: '1790540705000' })).toEqual({ mapId: 'lighthouse', reportedAt: new Date(1790540705000).toISOString(), source: 'community' })
  })
  it('supports older arrays and chooses the newest valid report', () => {
    expect(parseGoonReport([{ map: { normalizedName: 'woods' }, timestamp: 1790540705 }, { map: 'customs', timestamp: 1790540805 }])?.mapId).toBe('customs')
  })
  it('rejects unknown maps, missing or invalid timestamps', () => {
    expect(parseGoonReport({ map: 'factory', timestamp: Date.now() })).toBeNull()
    expect(parseGoonReport({ map: 'woods' })).toBeNull()
    expect(parseGoonReport(null)).toBeNull()
  })
})

describe('Goons server snapshot', () => {
  it('keeps valid rows only and sorts by count', () => {
    const snapshot = parseGoonSnapshot({
      latest: { mapId: 'woods', reportedAt: '2026-09-28T10:00:00.000Z' },
      last5h: [{ mapId: 'woods', count: 1, lastAt: '2026-09-28T10:00:00.000Z' }, { mapId: 'factory', count: 9, lastAt: '2026-09-28T10:00:00.000Z' }, { mapId: 'customs', count: 3, lastAt: '2026-09-28T09:00:00.000Z' }],
    })
    expect(snapshot?.latest?.mapId).toBe('woods')
    expect(snapshot?.last5h.map((row) => row.mapId)).toEqual(['customs', 'woods'])
    expect(parseGoonSnapshot({ latest: null })).toBeNull()
    expect(parseGoonSnapshot('nope')).toBeNull()
  })

  it('merges unsent own sightings on top of the server data', () => {
    const now = Date.parse('2026-09-28T12:00:00.000Z')
    const server = { latest: { mapId: 'woods' as const, reportedAt: '2026-09-28T11:00:00.000Z' }, last5h: [{ mapId: 'woods' as const, count: 2, lastAt: '2026-09-28T11:00:00.000Z' }], recent: [] }
    const own = [
      { mapId: 'customs' as const, reportedAt: '2026-09-28T11:30:00.000Z', sent: false },
      { mapId: 'woods' as const, reportedAt: '2026-09-28T10:00:00.000Z', sent: true },
    ]
    const view = mergeGoonView({ server, community: null, own, now })
    expect(view.location).toEqual({ mapId: 'customs', reportedAt: '2026-09-28T11:30:00.000Z', source: 'local', unsent: true })
    expect(view.stats.map((row) => [row.mapId, row.count])).toEqual([['woods', 2], ['customs', 1]])
    const offline = mergeGoonView({ server: null, community: { mapId: 'lighthouse', reportedAt: '2026-09-28T11:45:00.000Z', source: 'community' }, own, now })
    expect(offline.location?.source).toBe('community')
    expect(offline.stats.map((row) => [row.mapId, row.count])).toEqual([['customs', 1], ['woods', 1]])
  })
})

describe('who saw them', () => {
  it('keeps the nickname of each server sighting and drops a malformed one', () => {
    const snapshot = parseGoonSnapshot({
      latest: { mapId: 'customs', reportedAt: '2026-09-28T10:00:00.000Z', nickname: 'Bober' },
      last5h: [{ mapId: 'customs', count: 1, lastAt: '2026-09-28T10:00:00.000Z' }],
      recent: [{ mapId: 'customs', reportedAt: '2026-09-28T10:00:00.000Z', nickname: 'Bober' }, { mapId: 'woods', reportedAt: '2026-09-28T09:00:00.000Z', nickname: '<script>' }, { mapId: 'factory', reportedAt: '2026-09-28T09:00:00.000Z' }],
    })
    expect(snapshot?.latest).toEqual({ mapId: 'customs', reportedAt: '2026-09-28T10:00:00.000Z', nickname: 'Bober' })
    expect(snapshot?.recent).toEqual([{ mapId: 'customs', reportedAt: '2026-09-28T10:00:00.000Z', nickname: 'Bober' }, { mapId: 'woods', reportedAt: '2026-09-28T09:00:00.000Z' }])
    expect(mergeGoonView({ server: snapshot, community: null, own: [], now: Date.parse('2026-09-28T11:00:00.000Z') }).location).toMatchObject({ source: 'server', nickname: 'Bober' })
    // An older server without the list.
    expect(parseGoonSnapshot({ latest: null, last5h: [] })?.recent).toEqual([])
  })
})

describe('useGoonTracker', () => {
  const serviceRequest = vi.fn()
  beforeEach(() => {
    localStorage.clear()
    serviceRequest.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    Object.assign(window, { tarkovDesktop: { serviceRequest } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  })

  it('sends a sighting to our server for the selected mode and shows the server answer', async () => {
    const snapshot = { latest: { mapId: 'shoreline', reportedAt: '2026-09-28T10:00:00.000Z' }, last5h: [{ mapId: 'shoreline', count: 4, lastAt: '2026-09-28T10:00:00.000Z' }] }
    serviceRequest.mockImplementation(async (method: string) => method === 'GET' ? { latest: null, last5h: [] } : { accepted: true, snapshot })
    const { result } = renderHook(() => useGoonTracker('pve'))
    await waitFor(() => expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/goons/pve', undefined))
    let outcome = ''
    await act(async () => { outcome = await result.current.reportSighting('shoreline') })
    expect(outcome).toBe('sent')
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/goons/pve/sightings', { mapId: 'shoreline' })
    expect(result.current.location).toMatchObject({ mapId: 'shoreline', source: 'server' })
    expect(result.current.stats[0]).toMatchObject({ mapId: 'shoreline', count: 4 })
    expect(readOwnSightings('pve')[0]).toMatchObject({ mapId: 'shoreline', sent: true })
    expect(readOwnSightings('pvp')).toEqual([])
  })

  it('keeps the sighting locally, marked unsent, when the server is unreachable', async () => {
    serviceRequest.mockRejectedValue(new Error('Сервис недоступен'))
    const { result } = renderHook(() => useGoonTracker('pvp'))
    await waitFor(() => expect(result.current.connection).toBe('offline'))
    let outcome = ''
    await act(async () => { outcome = await result.current.reportSighting('woods') })
    expect(outcome).toBe('unsent')
    expect(result.current.location).toMatchObject({ mapId: 'woods', source: 'local', unsent: true })
    expect(result.current.stats).toEqual([expect.objectContaining({ mapId: 'woods', count: 1 })])
  })

  it('waits out the spam protection: «later», kept unsent, and sent by itself on the next refresh', async () => {
    serviceRequest.mockImplementation(async (method: string) => {
      if (method === 'GET') return { latest: null, last5h: [], recent: [] }
      throw new Error("Error invoking remote method 'service:request': Error: Слишком частые отметки. Повторите через минуту.")
    })
    const { result } = renderHook(() => useGoonTracker('seasonal'))
    await waitFor(() => expect(result.current.connection).toBe('server'))
    let outcome = ''
    await act(async () => { outcome = await result.current.reportSighting('shoreline') })
    expect(outcome).toBe('later')
    expect(result.current.connection).toBe('server')
    expect(result.current.location).toMatchObject({ mapId: 'shoreline', source: 'local', unsent: true })
    serviceRequest.mockImplementation(async (method: string) => method === 'GET' ? { latest: null, last5h: [], recent: [] } : { accepted: true, snapshot: { latest: null, last5h: [], recent: [] } })
    act(() => { window.dispatchEvent(new Event('raidos:live-update')) })
    await waitFor(() => expect(readOwnSightings('seasonal')[0]).toMatchObject({ mapId: 'shoreline', sent: true }))
  })

  it('works in local-only mode when no server is configured', async () => {
    serviceRequest.mockResolvedValue(null)
    const { result } = renderHook(() => useGoonTracker('seasonal'))
    await waitFor(() => expect(result.current.connection).toBe('local-only'))
    let outcome = ''
    await act(async () => { outcome = await result.current.reportSighting('customs') })
    expect(outcome).toBe('local')
    expect(result.current.location).toMatchObject({ mapId: 'customs', source: 'local', unsent: true })
  })

  it('tells the player to sign in or to set a nickname, and keeps no never-sendable sighting', async () => {
    serviceRequest.mockImplementation(async (method: string) => method === 'GET' ? { latest: null, last5h: [], recent: [] } : { accepted: false, reason: 'nickname', snapshot: { latest: null, last5h: [], recent: [] } })
    const { result } = renderHook(() => useGoonTracker('pvp'))
    await waitFor(() => expect(result.current.connection).toBe('server'))
    let outcome = ''
    await act(async () => { outcome = await result.current.reportSighting('woods') })
    expect(outcome).toBe('nickname')
    expect(readOwnSightings('pvp')).toEqual([])
    expect(result.current.location).toBeNull()
    serviceRequest.mockImplementation(async (method: string) => method === 'GET' ? { latest: null, last5h: [], recent: [] } : { accepted: false, reason: 'signin' })
    await act(async () => { outcome = await result.current.reportSighting('customs') })
    expect(outcome).toBe('signin')
    expect(readOwnSightings('pvp')).toEqual([])
  })

  it('desktop app: polls every 30 s while the window is in use, not at all behind the game, and at once on the way back', async () => {
    vi.useFakeTimers()
    try {
      const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      serviceRequest.mockResolvedValue({ latest: null, last5h: [], recent: [] })
      const goons = () => serviceRequest.mock.calls.filter(([method, path]) => method === 'GET' && path === '/v1/goons/pvp').length
      const feed = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/regular/maps')).length
      renderHook(() => useGoonTracker('pvp'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(goons()).toBe(1)
      expect(feed()).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * GOON_REFRESH_MS) })
      expect(goons()).toBe(3)
      expect(feed()).toBe(2)

      // The game in front: neither our server nor the 9 MB community feed for an hour.
      focus.mockReturnValue(false)
      act(() => { window.dispatchEvent(new Event('blur')) })
      await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000) })
      expect(goons()).toBe(3)
      expect(feed()).toBe(2)

      focus.mockReturnValue(true)
      act(() => { window.dispatchEvent(new Event('focus')) })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(goons()).toBe(4)
      expect(feed()).toBe(3)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('refreshes at once when the server tells every app about a new sighting', async () => {
    serviceRequest.mockResolvedValue({ latest: null, last5h: [], recent: [] })
    const { result } = renderHook(() => useGoonTracker('pvp'))
    await waitFor(() => expect(result.current.connection).toBe('server'))
    serviceRequest.mockResolvedValue({ latest: { mapId: 'lighthouse', reportedAt: new Date().toISOString(), nickname: 'Bober' }, last5h: [], recent: [] })
    act(() => { window.dispatchEvent(new Event('raidos:live-update')) })
    await waitFor(() => expect(result.current.location).toMatchObject({ mapId: 'lighthouse', nickname: 'Bober' }))
  })
})
