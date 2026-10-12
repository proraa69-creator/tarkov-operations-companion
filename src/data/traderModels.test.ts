import { describe, expect, it } from 'vitest'
import { TRADER_SWAY_HINTS } from '../gallery/traderSwayHints'
import { traderModelFix, traderModelKey, traderModelUrl } from './traderModels'

/**
 * The traders' 3D figures (owner, 11.10.2026: «добавь 3д модели всех торговцев…», Jaeger included; 12.10.2026: Skier,
 * Ragman and Lightkeeper — «модели оставшиеся устанавливай»).
 */
describe('trader models', () => {
  const keys = ['prapor', 'therapist', 'fence', 'peacekeeper', 'mechanic', 'jaeger', 'ref', 'btr-driver', 'skier', 'ragman', 'lightkeeper']
  const coats = ['peacekeeper', 'therapist', 'ragman']

  it('has a model and physics hints for each of the eleven traders the owner sent', () => {
    for (const key of keys) {
      expect(traderModelUrl(key), key).toMatch(/\.glb/)
      expect(TRADER_SWAY_HINTS[key], key).toBeDefined()
    }
    expect(Object.keys(TRADER_SWAY_HINTS).sort()).toEqual([...keys].sort())
  })

  it('finds a trader by the catalog name, else by the Russian name; none for traders without a model', () => {
    expect(traderModelKey({ normalizedName: 'peacekeeper', name: 'Peacekeeper' })).toBe('peacekeeper')
    expect(traderModelKey({ name: 'Водитель БТР' })).toBe('btr-driver')
    expect(traderModelKey({ name: ' Егерь ' })).toBe('jaeger')
    expect(traderModelKey({ normalizedName: 'skier', name: 'Лыжник' })).toBe('skier')
    expect(traderModelKey({ name: 'Смотритель' })).toBe('lightkeeper')
    expect(traderModelKey({ name: 'Барахольщик' })).toBe('ragman')
    expect(traderModelKey({ normalizedName: 'taran', name: 'Таран' })).toBeUndefined()
    expect(traderModelKey({ name: 'Мистер Керман' })).toBeUndefined()
  })

  it('fits each whole scene (desks, crates, the dog) in view; only Fence stands in black haze', () => {
    for (const key of keys) {
      expect(traderModelFix(key).fit, key).toBe(true)
      expect(Boolean(traderModelFix(key).haze), key).toBe(key === 'fence')
    }
  })

  it('moves only the open coats: Peacekeeper, Therapist and Ragman have cloth, everybody else is held still', () => {
    for (const key of keys) {
      const hints = TRADER_SWAY_HINTS[key]!
      if (coats.includes(key)) expect(hints.cloth?.length, key).toBeGreaterThan(0)
      else expect(hints.rigid?.[0], key).toEqual([-3, -1, -3, 3, 3, 3])
    }
  })
})
