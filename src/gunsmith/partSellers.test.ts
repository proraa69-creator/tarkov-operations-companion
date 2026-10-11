import { describe, expect, it } from 'vitest'
import type { GunPart } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'
import { partSellers } from './partSellers'

const mod = (id: string, offers: GunPart['offers']) => [id, { id, name: id, shortName: id, offers } as unknown as GunPart] as const

describe('who sells each part of a Gunsmith build', () => {
  const build: WeaponBuildRequirement = {
    weaponId: 'w', partIds: ['rc2', 'rvg'], attributes: [],
    guide: { source: 'wiki', parts: [
      { itemId: 'rc2', name: 'SOCOM556-RC2', sellers: [{ trader: 'peacekeeper', level: 4 }] },
      { itemId: 'barrel', name: '11 inch barrel', sellers: [{ trader: 'peacekeeper', level: 2, barter: true }, { trader: 'mechanic', level: 3 }] },
      { name: 'Unknown part', sellers: [{ trader: 'ref', level: 2 }] },
    ] },
  }

  it('takes the wiki’s traders, levels and barters when the mod data is not loaded', () => {
    const sellers = partSellers(build)
    expect(sellers.get('rc2')).toEqual([{ trader: 'peacekeeper', level: 4 }])
    expect(sellers.get('barrel')).toEqual([{ trader: 'peacekeeper', level: 2, barter: true }, { trader: 'mechanic', level: 3 }])
    expect(sellers.has('rvg')).toBe(false)
  })

  it('prefers tarkov.dev’s cash offers, keeps the wiki’s barters, never lists the flea', () => {
    const mods = new Map([
      mod('rc2', [{ vendor: 'flea-market', vendorName: 'Барахолка', priceRUB: 30000 }, { vendor: 'peacekeeper', vendorName: 'Миротворец', priceRUB: 200, minTraderLevel: 3 }]),
      mod('rvg', [{ vendor: 'peacekeeper', vendorName: 'Миротворец', priceRUB: 100, minTraderLevel: 2 }]),
      mod('barrel', [{ vendor: 'mechanic', vendorName: 'Механик', priceRUB: 9000, minTraderLevel: 3 }]),
    ])
    const sellers = partSellers(build, mods)
    expect(sellers.get('rc2')).toEqual([{ trader: 'peacekeeper', level: 3 }])
    expect(sellers.get('rvg')).toEqual([{ trader: 'peacekeeper', level: 2 }])
    expect(sellers.get('barrel')).toEqual([{ trader: 'peacekeeper', level: 2, barter: true }, { trader: 'mechanic', level: 3 }])
  })
})
