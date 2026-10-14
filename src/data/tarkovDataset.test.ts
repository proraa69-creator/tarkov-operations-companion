import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
vi.mock('./tarkovApi', () => ({
  usesDataGateway: vi.fn(() => true),
  gatewayRequest: vi.fn(async (_method: string, path: string) => ({ mode: path.endsWith('/pve') ? 'pve' : 'regular', items: {} })),
  tarkovJson: vi.fn(async (path: string) => { calls.push(path); return { data: path.includes('_ru') ? { [`${path} Name`]: path } : {} } }),
}))

const { loadTarkovDataset, loadTarkovTradersDataset, mirrorMode } = await import('./tarkovDataset')

beforeEach(() => calls.length = 0)

describe('mirrored Tarkov dataset', () => {
  it('keeps all three economies separate', () => {
    expect(['pvp', 'pve', 'seasonal'].map((mode) => mirrorMode(mode as never))).toEqual(['regular', 'pve', 'pvp-season'])
  })

  it('the restock times read only the traders and their names, not the whole ~30 MB dataset', async () => {
    const bundle = await loadTarkovTradersDataset('seasonal', 'ru')
    expect(calls).toEqual(['pvp-season/traders', 'pvp-season/traders_ru'])
    expect(bundle).toMatchObject({ mode: 'seasonal', names: { data: { 'pvp-season/traders_ru Name': 'pvp-season/traders_ru' } } })
  })

  it('loads only the selected mode and its minute prices', async () => {
    const bundle = await loadTarkovDataset('pve', 'ru')
    expect(calls.length).toBe(8)
    expect(calls.every((path) => path.startsWith('pve/'))).toBe(true)
    expect(bundle).toMatchObject({ mode: 'pve', prices: { mode: 'pve' }, imageBaseUrl: 'https://raidos.app/v1/item-images' })
  })
})
