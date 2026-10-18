import { describe, expect, it } from 'vitest'
import { classNotes, pickAmmo, weaponNotes } from './buildAdvice'
import type { AmmoStats } from './gunTypes'

const round = (id: string, caliber: string, penetration: number, price: number): AmmoStats => ({
  id, name: id, shortName: id, caliber, damage: 50, penetration, armorDamage: 50, fragmentationChance: 0, initialSpeed: 800,
  projectileCount: 1, recoilModifier: 0, accuracyModifier: 0, tracer: false, noFlea: false,
  offers: [{ vendor: 'prapor', vendorName: 'Прапор', priceRUB: price, minTraderLevel: 1 }],
})

const ammo = [
  round('ps', 'Caliber545x39', 28, 100),
  round('bt', 'Caliber545x39', 37, 300),
  round('bs', 'Caliber545x39', 45, 900),
  round('igolnik', 'Caliber545x39', 62, 2_000),
  round('sp5', 'Caliber9x39', 28, 200),
  round('sp6', 'Caliber9x39', 50, 700),
  round('bp', 'Caliber9x39', 57, 1_100),
]

describe('pickAmmo', () => {
  it('takes penetration per rouble for budget, the cheapest pen ≥ 40 for middle and the best pen for top', () => {
    const weapon = { caliber: 'Caliber545x39' }
    expect(pickAmmo(weapon, ammo, 'budget')?.ammo.id).toBe('bt')
    expect(pickAmmo(weapon, ammo, 'middle')?.ammo.id).toBe('bs')
    expect(pickAmmo(weapon, ammo, 'top')?.ammo.id).toBe('igolnik')
  })

  it('never loads weak 9x39 rounds', () => {
    const weapon = { caliber: 'Caliber9x39' }
    for (const tier of ['budget', 'middle', 'top'] as const) expect(['sp6', 'bp']).toContain(pickAmmo(weapon, ammo, tier)?.ammo.id)
  })

  it('returns nothing when no round of the calibre is sold', () => {
    expect(pickAmmo({ caliber: 'Caliber127x55' }, ammo, 'top')).toBeUndefined()
  })
})

describe('notes', () => {
  it('has class notes for 9x39, pistol calibres and 7.62 rifles', () => {
    expect(classNotes({ weaponClass: 'assault-rifle', caliber: 'Caliber9x39' })[0]).toMatch(/50 метров/)
    expect(classNotes({ weaponClass: 'smg', caliber: 'Caliber9x19PARA' })[0]).toMatch(/голову/)
    expect(classNotes({ weaponClass: 'assault-rifle', caliber: 'Caliber762x39' })[0]).toMatch(/Семёрка/)
    expect(classNotes({ weaponClass: 'assault-rifle', caliber: 'Caliber556x45NATO' })).toEqual([])
  })

  it('matches weapon notes by the short name', () => {
    expect(weaponNotes({ shortName: 'АК-308' })).toHaveLength(1)
    expect(weaponNotes({ shortName: 'RD-704' })).toHaveLength(1)
    expect(weaponNotes({ shortName: 'M4A1' })).toEqual([])
  })
})
