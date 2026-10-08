import { describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/ammoResponse.json'
import { adaptAmmoResponse, ammoFromCatalog, ammoQuery, caliberLabel, fetchAmmoStats, graphqlGameMode, withModePrices } from './ammoSource'
import type { Item } from '../domain/types'

describe('tarkov.dev ammo adapter', () => {
  it('keeps bullets and buckshot with the ballistic stats and the cheapest offer', () => {
    const rows = adaptAmmoResponse(fixture)
    expect(rows.map((row) => row.id)).not.toContain('flare')
    expect(rows.map((row) => row.id)).not.toContain('notammo')
    const bs = rows.find((row) => row.id === 'a545bs')!
    expect(bs).toMatchObject({
      shortName: 'BS', caliber: 'Caliber545x39', damage: 45, penetration: 54, armorDamage: 58,
      fragmentationChance: 0.17, initialSpeed: 830, ballisticCoefficient: 0.379, recoilModifier: 0.05,
      accuracyModifier: -0.04, price: 1250, priceSource: 'Flea Market',
    })
    expect(rows.find((row) => row.id === 'a12buck')?.projectileCount).toBe(8)
  })

  it('returns nothing for an error payload', () => {
    expect(adaptAmmoResponse({ errors: [{ message: 'x' }] })).toEqual([])
    expect(adaptAmmoResponse(null)).toEqual([])
  })

  it('asks for the selected mode and language; Season uses regular', () => {
    expect(graphqlGameMode('pve')).toBe('pve')
    expect(graphqlGameMode('seasonal')).toBe('regular')
    expect(ammoQuery('pve', 'en')).toContain('items(type: ammo, gameMode: pve, lang: en)')
    expect(ammoQuery('pvp', 'ru')).toContain('ballisticCoeficient')
  })

  it('posts the query to the GraphQL endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }))
    const rows = await fetchAmmoStats('pvp', 'ru', fetcher as unknown as typeof fetch)
    expect(rows.length).toBe(16)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tarkov.dev/graphql')
    expect(JSON.parse(String(init.body)).query).toContain('gameMode: regular')
  })

  it('formats caliber ids', () => {
    expect(caliberLabel('Caliber556x45NATO')).toBe('5.56×45')
    expect(caliberLabel('Caliber762x54R')).toBe('7.62×54R')
    expect(caliberLabel('Caliber20x1mm')).toBe('20×1mm')
    expect(caliberLabel('5.56×45')).toBe('5.56×45')
  })

  it('falls back to the catalog ammo', () => {
    const item = { id: 'x', name: 'X', shortName: 'X', category: 'Боеприпас', description: '', caliber: '5.56×45', damage: 49, penetration: 44, prices: [
      { source: 'Барахолка', price: 1200, mode: 'pvp', updatedAt: '' }, { source: 'Прапор', price: 900, mode: 'pvp', updatedAt: '' }, { source: 'Барахолка', price: 10, mode: 'pve', updatedAt: '' },
    ] } satisfies Item
    // The catalog's trader quotes are what Prapor PAYS for a round (900 ₽), not a price to buy at: the flea price of
    // the mode is the cost; the PvE quote (10 ₽) is never taken for PvP.
    expect(ammoFromCatalog([item], 'pvp')[0]).toMatchObject({ damage: 49, penetration: 44, price: 1200, priceSource: 'Барахолка' })
    expect(ammoFromCatalog([item], 'pve')[0]).toMatchObject({ price: 10 })
    expect(ammoFromCatalog([item], 'seasonal')[0]?.price).toBeUndefined()
  })

  it('prices the flea offer at the cheapest current offer, not tarkov.dev\'s 24-hour average in buyFor', () => {
    expect(ammoQuery('pvp', 'ru')).toContain('lastLowPrice')
    const payload = { data: { items: [{
      id: 'm855a1', name: '5.56x45mm M855A1', shortName: 'M855A1', lastLowPrice: 1480,
      // tarkov-api prices the flea entry of buyFor at avg24hPrice || lastLowPrice.
      buyFor: [{ priceRUB: 1720, vendor: { name: 'Барахолка', normalizedName: 'flea-market' } }, { priceRUB: 1650, vendor: { name: 'Миротворец', normalizedName: 'peacekeeper' } }],
      properties: { caliber: 'Caliber556x45NATO', ammoType: 'bullet', damage: 49, penetrationPower: 44 },
    }] } }
    // Before: the cheapest was Peacekeeper at 1 650 ₽ because the flea showed 1 720 ₽ (the average); the flea now has 1 480 ₽.
    expect(adaptAmmoResponse(payload)[0]).toMatchObject({ price: 1480, priceSource: 'Барахолка' })
    const noOffer = { data: { items: [{ ...payload.data.items[0], lastLowPrice: null }] } }
    expect(adaptAmmoResponse(noOffer)[0]).toMatchObject({ price: 1650, priceSource: 'Миротворец' })
  })

  it('Season rounds take the Season catalog flea price, never the PvP price GraphQL answered with', () => {
    const live = adaptAmmoResponse(fixture)
    const bs = live.find((row) => row.id === 'a545bs')!
    const catalog = [{ id: 'a545bs', name: 'BS', shortName: 'BS', category: 'Боеприпас', description: '', prices: [
      { source: 'Барахолка', price: 1250, mode: 'pvp', updatedAt: '', kind: 'flea' }, { source: 'Барахолка', price: 1990, mode: 'seasonal', updatedAt: '', kind: 'flea' },
    ] }] satisfies Item[]
    expect(withModePrices(live, catalog, 'pvp')).toBe(live)
    const season = withModePrices(live, catalog, 'seasonal')
    expect(season.find((row) => row.id === 'a545bs')).toMatchObject({ ...bs, price: 1990, priceSource: 'Барахолка' })
    // A round the Season catalog has no flea price for shows none instead of the PvP one.
    expect(season.find((row) => row.id === 'a545bt')?.price).toBeUndefined()
  })
})
