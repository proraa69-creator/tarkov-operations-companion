import { describe, expect, it } from 'vitest'
import type { AmmoStats } from '../arsenal/gunTypes'
import { flightAt, flightPath } from './rangeFlight'
import { similarRecoil, weaponRecoil } from './rangeRecoil'

const M4A1 = { id: '5447a9cd4bdc2dbd208b4567', weaponClass: 'assault-rifle', caliber: 'Caliber556x45NATO', recoilVertical: 56, fireRate: 800 }

describe('every weapon kicks (owner, 23.11.2026: «до сих пор пропадает отдача»)', () => {
  it('a weapon the game\'s data has keeps its own recoil', () => {
    expect(similarRecoil(M4A1, [M4A1])).toBe(weaponRecoil(M4A1.id))
  })

  it('one it lacks takes the most alike weapon\'s, at its own force and fire rate', () => {
    const newcomer = { id: 'not-in-the-data', weaponClass: 'assault-rifle', caliber: 'Caliber556x45NATO', recoilVertical: 70, fireRate: 750 }
    const recoil = similarRecoil(newcomer, [M4A1, newcomer])!
    expect(recoil.up).toBe(70)
    expect(recoil.fireRate).toBe(750)
    expect(recoil.groups).toEqual(weaponRecoil(M4A1.id)!.groups)
    expect(similarRecoil(newcomer, [newcomer])).toBeUndefined()
  })
})

describe('a single shot\'s flight (owner, 23.11.2026: «траекторию полета пули в реальном времени… с соответствующей скоростью»)', () => {
  const m855a1 = { id: 'r', caliber: 'Caliber556x45NATO', damage: 49, penetration: 44, initialSpeed: 945, bulletMassGrams: 4, bulletDiameterMm: 5.7, ballisticCoefficient: 0.152 } as unknown as AmmoStats

  it('runs from the muzzle to the target in the trajectory\'s own time, slowing down', () => {
    const path = flightPath(m855a1, undefined, 100, 455)!
    expect(path[0]!.distance).toBeGreaterThan(0)
    expect(path.at(-1)!.distance).toBe(455)
    for (let i = 1; i < path.length; i++) {
      expect(path[i]!.time).toBeGreaterThan(path[i - 1]!.time)
      expect(path[i]!.speed).toBeLessThan(path[i - 1]!.speed)
    }
    // 455 m take most of a second, not a frame
    expect(path.at(-1)!.time).toBeGreaterThan(0.5)
    expect(path.at(-1)!.time).toBeLessThan(1.2)
  })

  it('nothing for a round without flight data', () => {
    expect(flightPath({ ...m855a1, ballisticCoefficient: 0 } as AmmoStats, undefined, 100, 300)).toBeUndefined()
  })
})

describe('the sight zeroed with the default round of the weapon, as the game does (Weapon.CreateOpticCalibrationData)', () => {
  const m855 = { id: 'm855', caliber: 'Caliber556x45NATO', damage: 54, penetration: 31, initialSpeed: 922, bulletMassGrams: 4, bulletDiameterMm: 5.7, ballisticCoefficient: 0.152 } as unknown as AmmoStats
  const slow = { ...m855, id: 'slow', initialSpeed: 700 } as unknown as AmmoStats

  it('the default round crosses the line of sight at the zero; a slower one is under it there', () => {
    expect(Math.abs(flightAt(m855, undefined, 100, 100, { zeroAmmo: m855 })!.drop)).toBeLessThan(0.05)
    expect(Math.abs(flightAt(slow, undefined, 100, 100)!.drop)).toBeLessThan(0.05)
    expect(flightAt(slow, undefined, 100, 100, { zeroAmmo: m855 })!.drop).toBeLessThan(-1)
  })
})
