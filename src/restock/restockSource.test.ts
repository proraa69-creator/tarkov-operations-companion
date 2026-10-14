import { describe, expect, it, vi } from 'vitest'

// json.tarkov.dev as the server's gateway passes it on: the traders file (names are translation keys) and its names.
const requested: string[] = []
const PRAPOR = '54cb50c76803fa8b248b4571'
const NEW_TRADER = '0123456789abcdef01234567'
vi.mock('../data/tarkovApi', () => ({
  usesDataGateway: () => true,
  gatewayRequest: vi.fn(),
  tarkovJson: vi.fn(async (path: string) => {
    requested.push(path)
    if (path.endsWith('/traders')) {
      return { data: { traders: {
        [PRAPOR]: { id: PRAPOR, name: `${PRAPOR} Nickname`, normalizedName: 'prapor', resetTime: '2026-10-14T10:00:00.000Z' },
        [NEW_TRADER]: { id: NEW_TRADER, name: `${NEW_TRADER} Nickname`, normalizedName: 'new-trader', resetTime: '2026-10-14T11:30:00.000Z' },
      } } }
    }
    if (path.endsWith('/traders_ru')) return { data: { [`${NEW_TRADER} Nickname`]: 'Новый торговец' } }
    throw new Error(`not needed for the restock times: ${path}`)
  }),
}))

const { fetchTraderResets } = await import('./restockSource')

describe('trader restock times', () => {
  it('come from the traders file and its names alone (they are read every 2 minutes, in the background too)', async () => {
    const resets = await fetchTraderResets('pve', 'ru')
    expect(requested).toEqual(['pve/traders', 'pve/traders_ru'])
    expect(resets).toEqual([
      { id: PRAPOR, name: 'Прапор', normalizedName: 'prapor', imageUrl: undefined, resetTime: '2026-10-14T10:00:00.000Z' },
      { id: NEW_TRADER, name: 'Новый торговец', normalizedName: 'new-trader', imageUrl: undefined, resetTime: '2026-10-14T11:30:00.000Z' },
    ])
  })
})
