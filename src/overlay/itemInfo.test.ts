import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { describeItem } from './itemInfo'

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
