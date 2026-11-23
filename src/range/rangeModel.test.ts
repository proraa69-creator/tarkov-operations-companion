import { describe, expect, it } from 'vitest'
import { applyDamage, fireAt, freshBody, keptAfterPenetration, penetrationChancePercent, PMC_HEALTH, realResistance, resolveStage, ricochetChance, seededRandom, type ArmorPiece } from './rangeModel'
import { hitAt, zoneCentre } from './rangeHitboxes'

const piece = (over: Partial<ArmorPiece>): ArmorPiece => ({
  key: 'p', itemId: 'p', name: 'p', armorClass: 4, maxDurability: 50, durability: 50, material: 'Aramid', destructibility: 0.1875,
  bluntThroughput: 0.33, colliders: ['RibcageUp'], plates: [], removable: false, ...over,
})
/** Always the same «random» value. */
const fixed = (value: number) => () => value

describe('the game’s armour formulas (Assembly-CSharp, 22.11.2026)', () => {
  it('effective resistance and the penetration chance', () => {
    expect(realResistance(4, 50, 50)).toBeCloseTo(40.237, 3)
    expect(realResistance(4, 25, 50)).toBeCloseTo((121 - 5000 / 145) * 0.4, 6)
    const r = realResistance(4, 50, 50)
    expect(penetrationChancePercent(r, 25)).toBe(0) // R ≥ p + 15
    expect(penetrationChancePercent(r, 40)).toBeCloseTo(0.4 * (r - 40 - 15) ** 2, 6) // R ≥ p
    expect(penetrationChancePercent(r, 50)).toBeCloseTo(100 + 50 / (0.9 * r - 50), 6)
    expect(penetrationChancePercent(r, 56)).toBe(100) // R ≤ p − 15
    expect(keptAfterPenetration(r, 50)).toBeCloseTo(50 / (r + 12), 6)
    expect(keptAfterPenetration(r, 20)).toBe(0.6)
  })

  it('a piece that stops the bullet: blunt damage and the durability it loses', () => {
    const soft = piece({})
    const stage = resolveStage([soft], 50, 30, 0.4, fixed(0.999))
    const r = realResistance(4, 50, 50)
    expect(stage.layers[0]!.outcome).toBe('stopped')
    expect(stage.bodyDamage).toBeCloseTo(50 * 0.33 * Math.min(1, Math.max(0.2, 1 - 0.03 * (r - 30))), 6)
    expect(soft.durability).toBeCloseTo(50 - 30 * 0.4 * Math.min(1.1, Math.max(0.6, 30 / 40)) * 0.1875, 6)
  })

  it('a piece gone through: damage and penetration × CF', () => {
    const soft = piece({ armorClass: 2, maxDurability: 40, durability: 40 })
    const stage = resolveStage([soft], 60, 40, 0.5, fixed(0))
    const r = realResistance(2, 40, 40)
    const kept = keptAfterPenetration(r, 40)
    expect(stage.layers[0]!.outcome).toBe('through')
    expect(stage.bodyDamage).toBeCloseTo(60 * kept, 6)
    expect(soft.durability).toBeCloseTo(40 - Math.max(1, 40 * kept * 0.5 * 0.9 * 0.1875), 6)
  })

  it('every piece after the one that stopped the bullet takes its blunt throughput off the damage', () => {
    const outer = piece({ key: 'outer', removable: true, armorClass: 6, bluntThroughput: 0.2 })
    const inner = piece({ key: 'inner', armorClass: 2, bluntThroughput: 0.5 })
    const stage = resolveStage([inner, outer], 50, 20, 0.4, fixed(0.999))
    expect(stage.layers.map((layer) => [layer.key, layer.outcome])).toEqual([['outer', 'stopped'], ['inner', 'behind']])
    const r = realResistance(6, 50, 50)
    expect(stage.bodyDamage).toBeCloseTo(50 * 0.2 * Math.max(0.2, 1 - 0.03 * (r - 20)) * 0.5, 6)
    expect(inner.durability).toBe(50)
  })

  it('a plate over soft armour: stopped, its blunt × 0.6 to the thorax; gone through, the soft insert behind it next', () => {
    const plate = piece({ key: 'plate', armorClass: 4, plates: ['Plate_Granit_SAPI_chest'], colliders: [], removable: true, softReduce: true, bluntThroughput: 0.3, material: 'Ceramic', destructibility: 0.6 })
    const soft = piece({ key: 'soft', armorClass: 2 })
    const body = freshBody(PMC_HEALTH)
    const stopped = fireAt([plate, soft], body, { collider: 'RibcageUp', plate: 'Plate_Granit_SAPI_chest' }, { damage: 60, penetration: 20, armorDamage: 0.4 }, fixed(0.999))
    const r = realResistance(4, 50, 50)
    expect(stopped.penetrated).toBe(false)
    expect(stopped.stages).toHaveLength(1)
    expect(stopped.damage).toBeCloseTo(60 * 0.3 * 0.6 * Math.max(0.2, 1 - 0.03 * (r - 20)), 6)
    expect(body.current.Chest).toBeCloseTo(85 - stopped.damage, 6)

    const plate2 = { ...plate, durability: 50 }
    const soft2 = { ...soft, durability: 50 }
    const through = fireAt([plate2, soft2], freshBody(PMC_HEALTH), { collider: 'RibcageUp', plate: 'Plate_Granit_SAPI_chest' }, { damage: 60, penetration: 60, armorDamage: 0.4 }, fixed(0))
    const keptPlate = keptAfterPenetration(r, 60)
    const keptSoft = keptAfterPenetration(realResistance(4, 50, 50), 60 * keptPlate)
    expect(through.stages).toHaveLength(2)
    expect(through.stages[0]!.bodyDamage).toBe(0)
    expect(through.penetrated).toBe(true)
    expect(through.damage).toBeCloseTo(60 * keptPlate * keptSoft, 6)
  })

  it('a ricochet halves the bullet and ends the hit as blunt damage', () => {
    const top = piece({ colliders: ['ParietalHead'], armorClass: 4, ricochet: { x: 0.2, y: 0.7, z: 85 }, bluntThroughput: 0.2 })
    expect(ricochetChance(top, 80)).toBe(0)
    expect(ricochetChance(top, 85)).toBe(0) // only above the angle
    expect(ricochetChance(top, 85.001)).toBeCloseTo(0.7, 3)
    expect(ricochetChance(top, 90)).toBeCloseTo(0.2, 6)
    const stage = resolveStage([top], 60, 60, 0.4, fixed(0), { angle: 89 })
    expect(stage.layers[0]!.outcome).toBe('ricochet')
    const r = realResistance(4, 50, 50)
    expect(stage.bodyDamage).toBeCloseTo(30 * 0.2 * Math.max(0.2, 1 - 0.03 * (r - 30)), 6)
  })
})

describe('health (ActiveHealthController.ApplyDamage)', () => {
  it('what a part cannot take spreads over the living parts by their maximum, × the factor of the part × 0.7', () => {
    const body = freshBody(PMC_HEALTH)
    applyDamage(body, 'LeftArm', 100)
    expect(body.current.LeftArm).toBe(0)
    expect(body.destroyed.LeftArm).toBe(true)
    const others = 440 - 60
    expect(body.current.Chest).toBeCloseTo(85 - 40 * 0.7 * 85 / others * 0.7, 6)
    expect(body.dead).toBe(false)
  })

  it('a destroyed head or thorax kills, also by spread damage', () => {
    const body = freshBody(PMC_HEALTH)
    expect(applyDamage(body, 'Head', 40).killed).toBe(true)
    const legs = freshBody(PMC_HEALTH, ['LeftLeg', 'RightLeg', 'LeftArm', 'RightArm', 'Stomach'])
    // 85 + 35 left: a leg shot of 1000 × 1 × 0.7 kills
    expect(applyDamage(legs, 'LeftLeg', 1000).killed).toBe(true)
  })
})

describe('the target’s zones', () => {
  it('finds the collider and the plate at a point, front and back', () => {
    expect(hitAt('front', 0, 135)?.collider).toBe('RibcageUp')
    expect(hitAt('front', 0, 135, new Set(['Plate_Granit_SAPI_chest']))?.plate).toBe('Plate_Granit_SAPI_chest')
    expect(hitAt('back', 0, 135)?.collider).toBe('SpineTop')
    expect(hitAt('front', 0, 164.5)?.collider).toBe('Eyes')
    expect(hitAt('front', 0, 175)?.collider).toBe('ParietalHead')
    expect(hitAt('front', 0, 150)?.collider).toBe('NeckFront')
    // the character's left arm is on the viewer's right from the front
    expect(hitAt('front', 22, 130)?.collider).toBe('LeftUpperArm')
    expect(hitAt('back', 22, 130)?.collider).toBe('RightUpperArm')
    expect(hitAt('front', 40, 130)).toBeUndefined()
    const eyes = zoneCentre('front', 'Eyes')!
    expect(hitAt('front', eyes.x, eyes.y)?.collider).toBe('Eyes')
  })

  it('a series is repeatable with a seed', () => {
    const a = seededRandom(7), b = seededRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})
