import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const idb = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  get: async (key: string) => idb.store.get(key),
  set: async (key: string, value: unknown) => { idb.store.set(key, value) },
  del: async (key: string) => { idb.store.delete(key) },
  keys: async () => [...idb.store.keys()],
}))

import { classifyTarkovUrl, DataAccessError, forgetSharedTarkovJson, GRAPHQL_URL, installTarkovFetchGuard, resolveDataRoute, setDataRouteForTests, tarkovGraphql, tarkovJson, uninstallTarkovFetchGuardForTests } from './tarkovApi'
import { fetchTarkovCatalog } from './tarkovJsonClient'
import { purgeLegacyPlaintextCaches, readGameCache, writeGameCache } from './gameDataCache'
import { computeDataAccess } from '../account/dataAccess'

type Desktop = NonNullable<Window['tarkovDesktop']>
const dataset = (mode: string) => ({ quests: [{ id: 'q' }], items: [], maps: [], markers: [], hideout: [], traders: [], metadata: { source: 'json.tarkov.dev', mode } })

function installDesktop(serviceRequest: Desktop['serviceRequest'], edition: 'owner' | 'client' = 'client') {
  const cache = new Map<string, string>()
  const desktop = {
    isDesktop: true, edition, dataGateway: true, serviceRequest,
    dataCache: { get: vi.fn(async (key: string) => cache.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { cache.set(key, value); return true }) },
  } as unknown as Desktop
  window.tarkovDesktop = desktop
  return { desktop, cache }
}

describe('data routing by edition', () => {
  it('every packaged build uses the gateway and only explicit development goes direct', () => {
    expect(resolveDataRoute({ edition: 'owner', dev: false, desktopGateway: true })).toBe('gateway')
    expect(resolveDataRoute({ edition: 'client', dev: false, desktopGateway: true })).toBe('gateway')
    expect(resolveDataRoute({ edition: 'client', dev: true, desktopGateway: false })).toBe('direct')
    // Phone / browser builds: production → gateway, development → direct.
    expect(resolveDataRoute({ edition: 'client', dev: false })).toBe('gateway')
    expect(resolveDataRoute({ edition: 'client', dev: true })).toBe('direct')
    expect(resolveDataRoute({ edition: 'owner', dev: true, forceGateway: true })).toBe('gateway')
  })

  it('classifies tarkov.dev URLs and blocks direct images', () => {
    expect(classifyTarkovUrl('https://api.tarkov.dev/graphql')).toEqual({ kind: 'graphql' })
    expect(classifyTarkovUrl('https://json.tarkov.dev/pve/tasks_en')).toEqual({ kind: 'json', path: 'pve/tasks_en' })
    expect(classifyTarkovUrl('https://players.tarkov.dev/profile/1.json')).toEqual({ kind: 'blocked' })
    expect(classifyTarkovUrl('https://api.tarkov.dev/other')).toEqual({ kind: 'blocked' })
    expect(classifyTarkovUrl('https://assets.tarkov.dev/killa-portrait.png')).toEqual({ kind: 'blocked' })
    expect(classifyTarkovUrl('https://raidos.app/v1/data/graphql')).toBeNull()
  })
})

describe('client data layer', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => { idb.store.clear() })
  afterEach(() => {
    uninstallTarkovFetchGuardForTests()
    globalThis.fetch = realFetch
    setDataRouteForTests(null)
    delete (window as { tarkovDesktop?: unknown }).tarkovDesktop
  })

  it('gateway: GraphQL goes to /v1/data/graphql with the session (main process), never to tarkov.dev', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const serviceRequest = vi.fn(async () => ({ data: { items: [] } }))
    installDesktop(serviceRequest as unknown as Desktop['serviceRequest'])
    setDataRouteForTests('gateway')
    await expect(tarkovGraphql('query RaidOsAmmo($gameMode: GameMode) { ammo(gameMode: $gameMode) { caliber } }', { gameMode: 'pve' })).resolves.toEqual({ data: { items: [] } })
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/data/graphql', { query: expect.stringContaining('RaidOsAmmo'), variables: { gameMode: 'pve' } })
    await tarkovJson('regular/items_en')
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/data/json/regular/items_en', undefined)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('direct (owner / development): GraphQL goes straight to tarkov.dev', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: { bosses: [] } }), { status: 200 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    await tarkovGraphql('{ bosses { name } }', undefined, 'direct')
    expect(fetchSpy).toHaveBeenCalledWith(GRAPHQL_URL, expect.objectContaining({ method: 'POST' }))
  })

  it('a 402 becomes DataAccessError («Нужна подписка») and tells the paywall', async () => {
    installDesktop((async () => { throw new Error("Error invoking remote method 'service:request': Error: Нужна подписка") }) as unknown as Desktop['serviceRequest'])
    const seen = vi.fn()
    window.addEventListener('raidos-data-access-denied', seen)
    await expect(tarkovGraphql('{ items { id } }', undefined, 'gateway')).rejects.toBeInstanceOf(DataAccessError)
    expect(seen).toHaveBeenCalled()
    window.removeEventListener('raidos-data-access-denied', seen)
  })

  it('the fetch guard routes code that still calls tarkov.dev directly (new features) through the gateway', async () => {
    const network = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = network as unknown as typeof fetch
    const serviceRequest = vi.fn(async (_method: string, path: string) => path === '/v1/data/graphql' ? { data: { barters: [1] } } : { data: { 'x Name': 'X' } })
    installDesktop(serviceRequest as unknown as Desktop['serviceRequest'])
    expect(installTarkovFetchGuard(globalThis, 'gateway')).toBe(true)

    const graphql = await fetch('https://api.tarkov.dev/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ barters { id } }' }) })
    expect(graphql.ok).toBe(true)
    expect(await graphql.json()).toEqual({ data: { barters: [1] } })
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/data/graphql', { query: '{ barters { id } }' })

    const json = await fetch('https://json.tarkov.dev/regular/items_ru')
    expect(await json.json()).toEqual({ data: { 'x Name': 'X' } })
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/data/json/regular/items_ru', undefined)

    expect((await fetch('https://players.tarkov.dev/profile/regular/1.json')).status).toBe(403)
    // Direct images are blocked too; the real network is not used.
    await fetch('https://assets.tarkov.dev/killa-portrait.png')
    expect(network).not.toHaveBeenCalled()
  })

  it('the guard answers 402 for a refused subscription, so feature code sees !response.ok', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
    installDesktop((async () => { throw new Error('Нужна подписка') }) as unknown as Desktop['serviceRequest'])
    installTarkovFetchGuard(globalThis, 'gateway')
    const answer = await fetch('https://api.tarkov.dev/graphql', { method: 'POST', body: JSON.stringify({ query: '{ items { id } }' }) })
    expect(answer.status).toBe(402)
  })

  it('catalog in the players’ app: only from the server (?lang=en for English), cached through the encrypted store', async () => {
    const serviceRequest = vi.fn(async (_method: string, path: string) => dataset(path.includes('pve') ? 'pve' : 'pvp'))
    const { desktop, cache } = installDesktop(serviceRequest as unknown as Desktop['serviceRequest'])
    setDataRouteForTests('gateway')
    await fetchTarkovCatalog('pve', 'en')
    expect(serviceRequest).toHaveBeenCalledWith('GET', '/v1/catalog/pve?lang=en', undefined)
    expect(desktop.dataCache!.set).toHaveBeenCalledWith('tarkov-operations-catalog-v11-pve-en', expect.any(String), expect.any(Number))
    expect(idb.store.size).toBe(0)
    // Offline: the encrypted copy; refused: no copy at all.
    serviceRequest.mockRejectedValueOnce(new Error('Сервер недоступен'))
    await expect(fetchTarkovCatalog('pve', 'en')).resolves.toMatchObject({ metadata: { source: 'cache' } })
    serviceRequest.mockRejectedValueOnce(new Error('Нужна подписка'))
    await expect(fetchTarkovCatalog('pve', 'en')).rejects.toBeInstanceOf(DataAccessError)
    expect(cache.size).toBe(1)
  })

  it('game cache: plaintext IndexedDB only on the direct route; old plaintext caches are purged in the players’ app', async () => {
    await writeGameCache('display-translations-v2-regular', { at: 1, entries: [] }, 1000, 'direct')
    expect(idb.store.has('display-translations-v2-regular')).toBe(true)
    idb.store.set('tarkov-operations-catalog-v11-pvp-ru', dataset('pvp'))
    idb.store.set('unrelated-setting', 1)
    expect(await purgeLegacyPlaintextCaches('direct')).toBe(0)
    expect(await purgeLegacyPlaintextCaches('gateway')).toBe(2)
    expect([...idb.store.keys()]).toEqual(['unrelated-setting'])
    // Phone / browser of the players’ edition without an entitlement: nothing is kept or read back.
    await writeGameCache('k', { secret: true }, 60_000, 'gateway')
    expect(await readGameCache('k', 'gateway')).toBeUndefined()
  })

  it('the paywall state follows the signed entitlement', () => {
    expect(computeDataAccess('direct', null)).toEqual({ state: 'open' })
    expect(computeDataAccess('gateway', null)).toEqual({ state: 'checking' })
    const base = { online: true, serverUrl: 'https://raidos.app', persistent: true }
    expect(computeDataAccess('gateway', { ...base, signedIn: false })).toEqual({ state: 'locked', reason: 'signed-out' })
    expect(computeDataAccess('gateway', { ...base, signedIn: true, entitlement: { valid: false, reason: 'subscription' } })).toEqual({ state: 'locked', reason: 'subscription' })
    expect(computeDataAccess('gateway', { ...base, signedIn: true, entitlement: { valid: true, plan: 'streamer', expiresAt: '2026-10-04T00:00:00.000Z' } })).toEqual({ state: 'granted', plan: 'streamer', expiresAt: '2026-10-04T00:00:00.000Z' })
  })
})

describe('big data files', () => {
  afterEach(() => { forgetSharedTarkovJson(); vi.unstubAllGlobals() })

  it('are downloaded once for the parts of a page that read them together, and again after a failure', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls === 3 ? new Response('busy', { status: 503 }) : Response.json({ data: { call: calls } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const [restock, bosses, ammo] = await Promise.all(['regular/items', 'regular/items', 'regular/items'].map((path) => tarkovJson<{ data: { call: number } }>(path, 'direct')))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(restock).toBe(bosses)
    expect(ammo.data.call).toBe(1)
    // Another file is its own download.
    expect((await tarkovJson<{ data: { call: number } }>('regular/maps', 'direct')).data.call).toBe(2)
    forgetSharedTarkovJson()
    await expect(tarkovJson('regular/items', 'direct')).rejects.toThrow(/HTTP 503/)
    // The failure is not kept: the next reader downloads again.
    expect((await tarkovJson<{ data: { call: number } }>('regular/items', 'direct')).data.call).toBe(4)
  })
})
