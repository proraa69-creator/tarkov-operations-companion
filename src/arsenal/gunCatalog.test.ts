import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Weapon } from './gunTypes'

const cache = vi.hoisted(() => ({ value: undefined as unknown, writes: 0 }))
const live = vi.hoisted(() => ({ calls: 0, fail: false, release: () => {} }))
vi.mock('../data/gameDataCache', () => ({
  readGameCache: async () => cache.value,
  writeGameCache: async (_key: string, value: unknown) => { cache.value = value; cache.writes++ },
}))
vi.mock('../data/tarkovDataset', () => ({
  loadTarkovItemsDataset: () => {
    live.calls++
    return new Promise((resolve, reject) => { live.release = () => (live.fail ? reject(new Error('offline')) : resolve({})) })
  },
}))
vi.mock('../data/tarkovJsonAdapters', () => ({ buildLegacyItems: () => [], buildLegacyAmmo: () => [] }))
vi.mock('./gunQueries', () => ({ adaptWeapons: () => [{ id: 'new-gun' }], adaptMods: () => new Map(), adaptAmmo: () => [] }))

const { fetchGunCatalog } = await import('./gunCatalog')
const old = (ageMs: number) => ({ savedAt: Date.now() - ageMs, weapons: [{ id: 'old-gun' } as Weapon], mods: [], ammo: [], loadedAt: '2026-11-14T00:00:00.000Z' })
const ids = (catalog: { weapons: Array<{ id: string }> }) => catalog.weapons.map((weapon) => weapon.id)

beforeEach(() => { cache.value = undefined; cache.writes = 0; live.calls = 0; live.fail = false })

// Owner, 15.11.2026: «очень долго загружается сборка оружия» — an older copy no longer waits for the whole items file.
describe('gun catalogue', () => {
  it('a copy younger than half an hour is used as it is', async () => {
    cache.value = old(10 * 60_000)
    expect(ids(await fetchGunCatalog('pvp', 'ru', () => {}))).toEqual(['old-gun'])
    expect(live.calls).toBe(0)
  })

  it('an older copy opens at once and the new catalogue follows', async () => {
    cache.value = old(2 * 60 * 60_000)
    const newer = vi.fn()
    expect(ids(await fetchGunCatalog('pvp', 'ru', newer))).toEqual(['old-gun'])
    expect(newer).not.toHaveBeenCalled()
    live.release()
    await vi.waitFor(() => expect(newer).toHaveBeenCalledTimes(1))
    expect(ids(newer.mock.calls[0][0])).toEqual(['new-gun'])
    expect(cache.writes).toBe(1)
  })

  it('offline, the older copy simply stays', async () => {
    cache.value = old(2 * 60 * 60_000)
    live.fail = true
    const newer = vi.fn()
    expect(ids(await fetchGunCatalog('pvp', 'ru', newer))).toEqual(['old-gun'])
    live.release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(newer).not.toHaveBeenCalled()
  })

  it('with no copy, it waits for the live catalogue', async () => {
    const pending = fetchGunCatalog('pvp', 'ru', () => {})
    await vi.waitFor(() => expect(live.calls).toBe(1))
    live.release()
    expect(ids(await pending)).toEqual(['new-gun'])
  })
})
