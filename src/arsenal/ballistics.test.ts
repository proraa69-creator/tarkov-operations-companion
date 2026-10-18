import { describe, expect, it } from 'vitest'
import {
  armorEffectiveness, armorResistance, effectiveArmorClass, effectiveResistance, expectedShotsToPenetrate, G1_TABLE,
  g1DragCoefficient, hasBallistics, penetrationChance, shotsForConfidence, trajectoryAt, zeroedTrajectory,
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

// 5.56×45 M855 (json.tarkov.dev): BC 0.233, 5.7 mm, 4 g, 922 m/s, damage 54, penetration 31.
const M855 = { initialSpeed: 922, bulletMassGrams: 4, bulletDiameterMm: 5.7, ballisticCoefficient: 0.233, damage: 54, penetration: 31 }

describe('G1 trajectory (the game\'s solver)', () => {
  it('has the 79-point G1 table and looks it up the game\'s way', () => {
    expect(G1_TABLE).toHaveLength(79)
    expect(g1DragCoefficient(0)).toBeCloseTo(0.2629, 4)
    // Mach 0.52: index 10 → between Mach 0.45 (0.2061) and 0.5 (0.2032), past 0.5 → clamped to 0.2032
    expect(g1DragCoefficient(0.52 * 343)).toBeCloseTo(0.2032, 4)
    expect(g1DragCoefficient(20 * 343)).toBeCloseTo(0.4988, 4)
  })

  it('needs mass, diameter, coefficient and speed', () => {
    expect(hasBallistics(M855)).toBe(true)
    expect(hasBallistics({ ...M855, ballisticCoefficient: 0 })).toBe(false)
    expect(hasBallistics({ initialSpeed: 900 })).toBe(false)
  })

  it('crosses the line of sight at the zero distance and starts a sight height below it', () => {
    for (const zero of [50, 100, 200]) {
      const points = zeroedTrajectory(M855, zero, 400)
      expect(points[0].drop).toBeCloseTo(-6.858, 3)
      expect(trajectoryAt(points, [zero])[0].drop).toBeCloseTo(0, 6)
    }
  })

  it('slows down, takes longer and loses damage and penetration with distance', () => {
    const points = zeroedTrajectory(M855, 50, 600)
    expect(points.map((point) => point.distance).slice(0, 4)).toEqual([0, 10, 20, 30])
    for (let i = 1; i < points.length; i++) {
      expect(points[i].speed).toBeLessThan(points[i - 1].speed)
      expect(points[i].time).toBeGreaterThan(points[i - 1].time)
      expect(points[i].damage).toBeLessThanOrEqual(points[i - 1].damage)
    }
    expect(points[0].damage).toBeCloseTo(54, 6)
    expect(points[0].energy).toBeCloseTo(0.5 * 0.004 * 922 * 922, 3)
    expect(points.at(-1)!.penetration).toBeGreaterThanOrEqual(31 * 0.5)
  })

  it('drops M855 a sane amount: zeroed at 50 m, some tens of cm low at 300 m', () => {
    const [at300] = trajectoryAt(zeroedTrajectory(M855, 50, 300), [300])
    // A 4 g bullet at ~920 m/s takes ~0.4 s to 300 m: free fall alone is ½·g·t² ≈ 80 cm; the 50 m zero tilts the bore up
    // by ~(sight height + 50 m drop)/50 m, which gives back ~45 cm at 300 m — leaving a few tens of cm below the line.
    expect(at300.drop).toBeLessThan(-30)
    expect(at300.drop).toBeGreaterThan(-90)
    expect(at300.time).toBeGreaterThan(0.33)
    expect(at300.time).toBeLessThan(0.5)
  })
})
