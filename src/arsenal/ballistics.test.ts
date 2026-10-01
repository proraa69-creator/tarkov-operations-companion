import { describe, expect, it } from 'vitest'
import {
  armorEffectiveness, armorResistance, dragConstant, dropOffAt, dropOffCurve, effectiveArmorClass, effectiveResistance,
  expectedShotsToPenetrate, penetrationChance, shotsForConfidence, speedAtDistance,
} from './ballistics'

describe('armor penetration (Tarkov wiki «Ballistics»)', () => {
  it('maps a class to class × 10 resistance', () => {
    expect(armorResistance(4)).toBe(40)
    expect(armorResistance(6)).toBe(60)
  })

  it('uses (121 − 5000 / (45 + 2d)) · r / 100 for the effective resistance', () => {
    expect(effectiveResistance(4, 100)).toBeCloseTo((121 - 5000 / 245) * 0.4, 9)
    expect(effectiveResistance(4, 100)).toBeCloseTo(40.24, 2)
    expect(effectiveResistance(4, 50)).toBeCloseTo((121 - 5000 / 145) * 0.4, 6)
    // Worn armor resists less.
    expect(effectiveResistance(5, 30)).toBeLessThan(effectiveResistance(5, 100))
  })

  it('is 0 well below the class, 90 % at the threshold and close to 100 % far above', () => {
    expect(penetrationChance(20, 4)).toBe(0)
    const a = effectiveResistance(4)
    expect(penetrationChance(a, 4)).toBeCloseTo(0.9, 6)
    expect(penetrationChance(a - 15, 4)).toBe(0)
    expect(penetrationChance(a - 5, 4)).toBeCloseTo(0.4 * 10 ** 2 / 100, 6)
    expect(penetrationChance(70, 4)).toBeGreaterThan(0.97)
    expect(penetrationChance(70, 4)).toBeLessThanOrEqual(1)
  })

  it('is continuous around the threshold and monotonic in penetration', () => {
    const a = effectiveResistance(5)
    expect(penetrationChance(a - 1e-9, 5)).toBeCloseTo(penetrationChance(a, 5), 4)
    let previous = -1
    for (let pen = 0; pen <= 80; pen += 1) {
      const chance = penetrationChance(pen, 5)
      expect(chance).toBeGreaterThanOrEqual(previous)
      previous = chance
    }
  })

  it('lets more shots through damaged armor', () => {
    expect(penetrationChance(40, 5, 40)).toBeGreaterThan(penetrationChance(40, 5, 100))
  })

  it('counts shots: expected value 1/p and shots for 90 % confidence', () => {
    const chance = penetrationChance(38, 4)
    expect(expectedShotsToPenetrate(38, 4)).toBeCloseTo(1 / chance, 9)
    expect(expectedShotsToPenetrate(10, 6)).toBe(Infinity)
    expect(shotsForConfidence(10, 6)).toBe(Infinity)
    expect(shotsForConfidence(70, 2)).toBe(1)
    const shots = shotsForConfidence(38, 4)
    expect(1 - (1 - chance) ** shots).toBeGreaterThanOrEqual(0.9)
    expect(1 - (1 - chance) ** (shots - 1)).toBeLessThan(0.9)
  })

  it('applies the penetration ≥ class × 10 rule of thumb', () => {
    expect(effectiveArmorClass(9)).toBe(0)
    expect(effectiveArmorClass(44)).toBe(4)
    expect(effectiveArmorClass(50)).toBe(5)
    expect(effectiveArmorClass(72)).toBe(6)
  })

  it('builds one row per class', () => {
    const rows = armorEffectiveness(47)
    expect(rows.map((row) => row.armorClass)).toEqual([1, 2, 3, 4, 5, 6])
    expect(rows[0].chance).toBeGreaterThan(0.98)
    expect(rows[3].chance).toBeGreaterThan(0.9)
    expect(rows[5].chance).toBeLessThan(0.1)
    expect(armorEffectiveness(30)[5].chance).toBe(0)
  })
})

describe('approximate drop-off model', () => {
  it('has no drag without a ballistic coefficient', () => {
    expect(dragConstant(undefined)).toBe(0)
    expect(speedAtDistance(900, 0, 500)).toBe(900)
    expect(dropOffAt({ damage: 50, penetration: 40 }, 300)).toEqual({ distance: 300, speed: 0, damage: 50, penetration: 40 })
  })

  it('decays speed exponentially: v(x) = v0·exp(−ρ·Cd·x / (2·BC·703.07))', () => {
    const k = 1.225 * 0.3 / (2 * 0.3 * 703.07)
    expect(dragConstant(0.3)).toBeCloseTo(k, 12)
    expect(speedAtDistance(880, 0.3, 300)).toBeCloseTo(880 * Math.exp(-k * 300), 9)
    // A higher coefficient keeps more speed.
    expect(speedAtDistance(880, 0.5, 300)).toBeGreaterThan(speedAtDistance(880, 0.2, 300))
  })

  it('scales damage and penetration with the speed ratio', () => {
    const ammo = { damage: 50, penetration: 40, initialSpeed: 900, ballisticCoefficient: 0.3 }
    const at = dropOffAt(ammo, 400)
    const ratio = at.speed / 900
    expect(at.damage).toBeCloseTo(50 * ratio, 9)
    expect(at.penetration).toBeCloseTo(40 * ratio, 9)
    expect(dropOffAt(ammo, 0)).toEqual({ distance: 0, speed: 900, damage: 50, penetration: 40 })
  })

  it('samples a decreasing curve', () => {
    const curve = dropOffCurve({ damage: 60, penetration: 47, initialSpeed: 730, ballisticCoefficient: 0.26 }, 600, 100)
    expect(curve.map((point) => point.distance)).toEqual([0, 100, 200, 300, 400, 500, 600])
    for (let i = 1; i < curve.length; i += 1) expect(curve[i].damage).toBeLessThan(curve[i - 1].damage)
  })
})
