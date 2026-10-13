import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { describeItem } from './itemInfo'
import { item as catalogItem, quest } from '../raidprep/fixtures'

const item: Item = { id: 'gun', name: 'Weapon', shortName: 'Weapon', category: 'Оружие', description: '', types: ['gun'], iconUrl: 'receiver.webp', presetImageUrl: 'assembled.webp', fleaPrice: 123, prices: [{ source: 'Mechanic', price: 99, updatedAt: '', mode: 'pvp' }] }
const progress = { taskProgress: {} }

describe('item overlay weapon pictures', () => {
  it.each(['M4A1', 'AK-105', 'RPK-16', 'MP-133'])('uses the assembled preset for %s without changing item identity or prices', name => {
    expect(describeItem({ ...item, name }, [], progress)).toMatchObject({ itemId: 'gun', name, iconUrl: 'assembled.webp', weaponPreset: true, fleaPrice: 123, bestTrader: { price: 99 } })
  })
  it('keeps module pictures even when a stray preset is present', () => {
    const result = describeItem({ ...item, types: ['mods'] }, [], progress)
    expect(result.iconUrl).toBe('receiver.webp')
    expect(result.weaponPreset).toBeUndefined()
  })
  it('keeps the catalog icon when a weapon has no known assembly', () => {
    expect(describeItem({ ...item, presetImageUrl: undefined }, [], progress).iconUrl).toBe('receiver.webp')
  })
})

describe('item overlay prices per mode', () => {
  const salewa: Item = {
    id: 'salewa', name: 'Salewa', shortName: 'Salewa', category: 'Медицина', description: '', fleaPrice: 36500,
    prices: [
      { source: 'Барахолка', price: 36500, mode: 'pvp', updatedAt: '', kind: 'flea', basis: 'last-low' },
      { source: 'Терапевт', price: 11000, mode: 'pvp', updatedAt: '', kind: 'trader' },
      { source: 'Барахолка', price: 25400, mode: 'pve', updatedAt: '', kind: 'flea', basis: 'avg-24h' },
      { source: 'Терапевт', price: 9000, mode: 'pve', updatedAt: '', kind: 'trader' },
    ],
  }
  it('shows the flea price and the trader of the selected mode only', () => {
    expect(describeItem(salewa, [], progress, 'pvp')).toMatchObject({ fleaPrice: 36500, bestTrader: { name: 'Терапевт', price: 11000 } })
    const pve = describeItem(salewa, [], progress, 'pve')
    expect(pve).toMatchObject({ fleaPrice: 25400, fleaAverage: true, bestTrader: { price: 9000 } })
    // Season has no flea quote here: no price rather than the PvP one in `fleaPrice`.
    expect(describeItem(salewa, [], progress, 'seasonal').fleaPrice).toBeUndefined()
    expect(describeItem(salewa, [], progress, 'pvp').fleaAverage).toBeUndefined()
  })
})

describe('«Каппа» badge only on missing items (owner, 13.10.2026)', () => {
  const egg = catalogItem('egg', 'Golden egg')
  const collector = quest('5c51aac186f77432ea65c552', 'Коллекционер', { trader: 'Скупщик', kappa: true, requiredItems: ['egg'] })
  it('drops the badge for an item already checked on the Kappa page and keeps it for the missing ones', () => {
    expect(describeItem(egg, [collector], progress, 'pvp').collector).toBe(true)
    expect(describeItem(egg, [collector], progress, 'pvp', undefined, ['egg']).collector).toBe(false)
    expect(describeItem(egg, [collector], progress, 'pvp', undefined, ['other']).collector).toBe(true)
    // The quest itself is still listed: only the badge goes.
    expect(describeItem(egg, [collector], progress, 'pvp', undefined, ['egg']).quests.map((need) => need.name)).toEqual(['Коллекционер'])
  })
})
