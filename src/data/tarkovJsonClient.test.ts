import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset, RaidMode } from '../domain/types'
import { setDataRouteForTests } from './tarkovApi'
import { CATALOG_REWRITE_MS, fetchTarkovCatalog, forgetCatalogWrites } from './tarkovJsonClient'

const V1 = '1'.repeat(40)
const V2 = '2'.repeat(40)
const catalog = (mode: RaidMode, version: string | undefined, quests = ['q1']) => ({
  quests: quests.map((id) => ({ id, name: id })), items: [], maps: [], markers: [], hideout: [], traders: [],
  metadata: { source: 'json.tarkov.dev', mode, loadedAt: '2026-10-14T09:00:00.000Z', counts: {}, ...(version ? { contentVersion: version } : {}) },
}) as unknown as AppDataset

describe('catalog refresh through the desktop gateway (players\' app)', () => {
  const serviceRequest = vi.fn()
  const cacheSet = vi.fn(async () => true)
  const cacheGet = vi.fn(async () => null as string | null)
  beforeEach(() => {
    setDataRouteForTests('gateway')
    forgetCatalogWrites()
    vi.stubGlobal('tarkovDesktop', { isDesktop: true, dataGateway: true, serviceRequest, dataCache: { get: cacheGet, set: cacheSet } })
  })
  afterEach(() => {
    setDataRouteForTests(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
    serviceRequest.mockReset()
    cacheSet.mockClear()
    cacheGet.mockClear()
  })

  it('asks with the version on screen; «not modified» keeps the same object and writes nothing', async () => {
    serviceRequest.mockResolvedValueOnce(catalog('pvp', V1))
    const first = await fetchTarkovCatalog('pvp')
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/catalog/pvp', undefined)
    expect(cacheSet).toHaveBeenCalledTimes(1)

    serviceRequest.mockResolvedValueOnce({ notModified: true })
    const again = await fetchTarkovCatalog('pvp', 'ru', first)
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', `/v1/catalog/pvp?v=${V1}`, undefined)
    expect(again).toBe(first)
    expect(cacheSet).toHaveBeenCalledTimes(1)

    // A full answer with the same version (a server that ignored the version): still the object on screen, no write.
    serviceRequest.mockResolvedValueOnce(catalog('pvp', V1))
    expect(await fetchTarkovCatalog('pvp', 'ru', first)).toBe(first)
    expect(cacheSet).toHaveBeenCalledTimes(1)

    // New prices or quests: the new catalog, stored.
    const changed = catalog('pvp', V2, ['q1', 'q2'])
    serviceRequest.mockResolvedValueOnce(changed)
    expect(await fetchTarkovCatalog('pvp', 'ru', first)).toBe(changed)
    expect(cacheSet).toHaveBeenCalledTimes(2)
  })

  it('writes an unchanged catalog again once the last write is hours old (its cache expiry moves on)', async () => {
    vi.useFakeTimers()
    serviceRequest.mockResolvedValue(catalog('pvp', V1))
    const first = await fetchTarkovCatalog('pvp')
    expect(await fetchTarkovCatalog('pvp', 'ru', first)).toBe(first)
    expect(cacheSet).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(CATALOG_REWRITE_MS)
    expect(await fetchTarkovCatalog('pvp', 'ru', first)).toBe(first)
    expect(cacheSet).toHaveBeenCalledTimes(2)
  })

  it('asks with a version only for a catalog of this mode that came from the server; in English it follows lang=en', async () => {
    serviceRequest.mockResolvedValue(catalog('pve', V2))
    await fetchTarkovCatalog('pve', 'ru', catalog('pvp', V1))
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/catalog/pve', undefined)
    const cached = catalog('pve', V1)
    cached.metadata!.source = 'cache'
    await fetchTarkovCatalog('pve', 'ru', cached)
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/catalog/pve', undefined)
    await fetchTarkovCatalog('pve', 'ru', catalog('pve', undefined))
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/catalog/pve', undefined)
    serviceRequest.mockResolvedValue({ notModified: true })
    const english = catalog('pve', V1)
    expect(await fetchTarkovCatalog('pve', 'en', english)).toBe(english)
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', `/v1/catalog/pve?lang=en&v=${V1}`, undefined)
  })

  it('a failed refresh fails (the catalog on screen stays) without reading the same catalog back from the cache', async () => {
    serviceRequest.mockRejectedValue(new Error('Сервер недоступен'))
    await expect(fetchTarkovCatalog('pvp', 'ru', catalog('pvp', V1))).rejects.toThrow('Сервер недоступен')
    expect(cacheGet).not.toHaveBeenCalled()
    // The first load has nothing on screen: the cache is read as before.
    cacheGet.mockResolvedValueOnce(JSON.stringify(catalog('pvp', V1)))
    expect((await fetchTarkovCatalog('pvp')).metadata?.source).toBe('cache')
    expect(cacheGet).toHaveBeenCalledTimes(1)
  })

  it('«Нужна подписка» still goes to the paywall, whatever is on screen', async () => {
    serviceRequest.mockRejectedValue(new Error('Нужна подписка'))
    await expect(fetchTarkovCatalog('pvp', 'ru', catalog('pvp', V1))).rejects.toThrow('Нужна подписка')
  })
})
