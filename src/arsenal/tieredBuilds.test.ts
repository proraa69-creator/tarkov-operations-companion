import { describe, expect, it } from 'vitest'
import { installedParts } from './buildModel'
import type { GunPart, GunSlot, Weapon } from './gunTypes'
import { pickTier, prune, partScore, solveTier } from './tieredBuilds'

const slot = (nameId: string, allowed: string[], required = false): GunSlot => ({ id: nameId, nameId, name: nameId, required, allowed })
const part = (id: string, recoil: number, ergonomics: number, price: number, slots: GunSlot[] = [], extra: Partial<GunPart> = {}): GunPart => ({
  id, name: id, shortName: id, weight: 0.1, ergonomics, recoilModifier: recoil, accuracyModifier: 0, slots, conflicts: [], noFlea: false,
  offers: [{ vendor: 'prapor', vendorName: 'Prapor', priceRUB: price, minTraderLevel: 1 }], ...extra,
})
const weaponOf = (slots: GunSlot[]): Weapon => ({
  ...part('gun', 0, 50, 10_000, slots), weaponClass: 'assault-rifle', weaponClassName: 'AR', caliber: 'Caliber556x45NATO', fireRate: 800, recoilVertical: 100, recoilHorizontal: 200,
})
const ids = (weapon: Weapon, mods: Map<string, GunPart>, tier: 'budget' | 'middle' | 'top') => installedParts(solveTier(weapon, { mods }, tier)!.build, { mods }).map((entry) => entry.part.id).sort()

describe('three builds of a weapon', () => {
  it('scores recoil reduction and ergonomics', () => {
    expect(partScore({ recoilModifier: -0.1, ergonomics: 10 })).toBeCloseTo(15.5)
  })
  it('keeps only the builds nobody beats on price and score', () => {
    expect(prune([{ cost: 10, score: 5 }, { cost: 20, score: 4 }, { cost: 30, score: 9 }, { cost: 5, score: 1 }])).toEqual([{ cost: 5, score: 1 }, { cost: 10, score: 5 }, { cost: 30, score: 9 }])
  })
  it('builds up to 100 000 ₽, up to 200 000 ₽ and the best with no limit (owner, 28.10.2026)', () => {
    const front = [{ cost: 50_000, score: 40 }, { cost: 95_000, score: 55 }, { cost: 150_000, score: 70 }, { cost: 190_000, score: 74 }, { cost: 400_000, score: 80 }]
    expect(pickTier(front, 'budget')).toEqual({ cost: 95_000, score: 55 })
    expect(pickTier(front, 'middle')).toEqual({ cost: 190_000, score: 74 })
    expect(pickTier(front, 'top')).toEqual({ cost: 400_000, score: 80 })
    // nothing that cheap: the cheapest there is
    expect(pickTier([{ cost: 120_000, score: 30 }], 'budget')).toEqual({ cost: 120_000, score: 30 })
  })
  it('takes the cheaper of two nearly equal builds', () => {
    const front = [{ cost: 100_000, score: 59.5 }, { cost: 180_000, score: 60 }]
    expect(pickTier(front, 'top')).toEqual({ cost: 100_000, score: 59.5 })
  })
  it('puts a rail adapter on when it opens a better foregrip', () => {
    const mods = new Map<string, GunPart>([
      ['weakGrip', part('weakGrip', 0, 2, 1_000)],
      ['strongGrip', part('strongGrip', -0.02, 14, 3_000)],
      ['adapter', part('adapter', 0, 0, 1_000, [slot('mod_foregrip', ['strongGrip'])])],
      ['guard', part('guard', 0, 5, 2_000, [slot('mod_foregrip', ['weakGrip']), slot('mod_mount_000', ['adapter'])], { conflicts: [] })],
    ])
    mods.set('adapter', { ...mods.get('adapter')!, conflicts: ['weakGrip'] })
    const weapon = weaponOf([slot('mod_handguard', ['guard'], true)])
    expect(ids(weapon, mods, 'top')).toEqual(['adapter', 'guard', 'strongGrip'])
  })
  it('compares a one-piece grip-stock with a grip, a buffer tube and a stock', () => {
    const separate = (stockRecoil: number) => new Map<string, GunPart>([
      ['oneP', part('oneP', -0.24, 10, 20_000, [], { conflicts: ['tube'] })],
      ['grip', part('grip', -0.01, 5, 2_000)],
      ['stock', part('stock', stockRecoil, 9, 10_000)],
      ['tube', part('tube', -0.005, -2, 2_000, [slot('mod_stock_000', ['stock'])], { conflicts: ['oneP'] })],
    ])
    const weapon = weaponOf([slot('mod_pistol_grip', ['oneP', 'grip']), slot('mod_stock', ['tube'])])
    expect(ids(weapon, separate(-0.1), 'top')).toEqual(['oneP'])
    expect(ids(weapon, separate(-0.3), 'top')).toEqual(['grip', 'stock', 'tube'])
  })
  it('a cheap one-piece grip-stock does not crowd out the ordinary grips (M4: ADAR wooden stock)', () => {
    // The tube is required and stays; the one-piece part only blocks the stock in it. Grip + stock is cheaper and better,
    // but the one-piece part beats every grip on its own — it used to push them out before the stock was considered.
    const mods = new Map<string, GunPart>([
      ['wood', part('wood', -0.2, 13, 10_000, [], { conflicts: ['stock'] })],
      ['grip', part('grip', -0.01, 5, 13_000)],
      ['stock', part('stock', -0.215, 12, 5_000, [], { conflicts: ['wood'] })],
      ['tube', part('tube', -0.005, -2, 2_000, [slot('mod_stock_000', ['stock'])])],
    ])
    const weapon = weaponOf([slot('mod_pistol_grip', ['wood', 'grip'], true), slot('mod_stock', ['tube'], true)])
    expect(ids(weapon, mods, 'top')).toEqual(['grip', 'stock', 'tube'])
  })
  it('has no «до 100 000 ₽» build when even the cheapest one costs more (MDR, SPEAR…)', () => {
    const weapon = { ...weaponOf([slot('mod_stock', ['stock'])]), offers: [{ vendor: 'prapor', vendorName: 'Prapor', priceRUB: 150_000, minTraderLevel: 1 }] }
    const mods = new Map<string, GunPart>([['stock', part('stock', -0.2, 5, 5_000)]])
    expect(solveTier(weapon, { mods }, 'budget')).toBeUndefined()
    expect(solveTier(weapon, { mods }, 'middle')?.cost.total).toBe(155_000)
  })
})
