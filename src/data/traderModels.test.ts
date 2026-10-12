import { describe, expect, it } from 'vitest'
import { TRADER_SWAY_HINTS } from '../gallery/traderSwayHints'
import { TRADER_MODEL_FIX, traderModelKey, traderModelUrl } from './traderModels'

/** The traders' 3D figures (owner, 11.10.2026: «добавь 3д модели всех торговцев…», Jaeger included). */
describe('trader models', () => {
  const keys = ['prapor', 'therapist', 'fence', 'peacekeeper', 'mechanic', 'jaeger', 'ref', 'btr-driver']

  it('has a model and physics hints for each of the eight traders the owner sent', () => {
    for (const key of keys) {
      expect(traderModelUrl(key), key).toMatch(/\.glb/)
      expect(TRADER_SWAY_HINTS[key], key).toBeDefined()
    }
    expect(Object.keys(TRADER_SWAY_HINTS).sort()).toEqual([...keys].sort())
  })

  it('finds a trader by the catalog name, else by his Russian name; none for traders without a model', () => {
    expect(traderModelKey({ normalizedName: 'peacekeeper', name: 'Peacekeeper' })).toBe('peacekeeper')
    expect(traderModelKey({ name: 'Водитель БТР' })).toBe('btr-driver')
    expect(traderModelKey({ name: ' Егерь ' })).toBe('jaeger')
    expect(traderModelKey({ normalizedName: 'skier', name: 'Лыжник' })).toBeUndefined()
    expect(traderModelKey({ name: 'Смотритель' })).toBeUndefined()
  })

  it('fits each whole scene (desks, crates, the dog) in view', () => {
    expect(TRADER_MODEL_FIX.fit).toBe(true)
  })

  it('moves only the open coats: Peacekeeper and Therapist have cloth, everybody else is held still', () => {
    for (const key of keys) {
      const hints = TRADER_SWAY_HINTS[key]!
      if (key === 'peacekeeper' || key === 'therapist') expect(hints.cloth?.length, key).toBeGreaterThan(0)
      else expect(hints.rigid?.[0], key).toEqual([-3, -1, -3, 3, 3, 3])
    }
  })
})
