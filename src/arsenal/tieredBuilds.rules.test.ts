import { describe, expect, it } from 'vitest'
import { installedParts } from './buildModel'
import type { GunPart, Weapon } from './gunTypes'
import { solveTier, type BuildTier } from './tieredBuilds'
import fixture from './fixtures/buildRulesCatalog.json'

/**
 * The owner's rules for the builds (28.10.2026) on the real catalog: the M4A1, the АК-74М and the АКМ with every part
 * that fits them (json.tarkov.dev, PvP, 28.10.2026; fixtures/buildRulesCatalog.json).
 */
const data = fixture as unknown as { weapons: Weapon[]; mods: GunPart[] }
const catalog = { mods: new Map(data.mods.map((part) => [part.id, part])) }
const M4A1 = '5447a9cd4bdc2dbd208b4567', AK74M = '5ac4cd105acfc40016339859', AKM = '59d6088586f774275f37482f'
const WEAPONS = [M4A1, AK74M, AKM]
const TIERS: BuildTier[] = ['budget', 'middle', 'top']
const PRS_GEN3 = ['5d44069ca4b9361ebd26fc37', '5d4406a8a4b9361e4f6eb8b7']
const ARE = ['5c793fb92e221644f31bfb64', '5c793fc42e221600114ca25d']
const RAPTOR = ['5b2240bf5acfc40dc528af69', '5d44334ba4b9362b346d1948', '6895bf08e2d16810ba0bf43e']
const CSS_AK = '6130ca3fd92c473c77020dbd'
const PT_1 = '5b222d405acfc400153af4fe'

const builds = new Map<string, Array<{ path: string[]; part: GunPart }>>()
const parts = (weaponId: string, tier: BuildTier) => {
  const key = `${weaponId}:${tier}`
  if (!builds.has(key)) {
    const weapon = data.weapons.find((entry) => entry.id === weaponId)!
    builds.set(key, installedParts(solveTier(weapon, catalog, tier)!.build, catalog))
  }
  return builds.get(key)!
}
const has = (weaponId: string, tier: BuildTier, ids: string[]) => parts(weaponId, tier).some(({ part }) => ids.includes(part.id))

describe('the owner\'s build rules on the real catalog', () => {
  it('chooses no sight, scope or collimator', { timeout: 120_000 }, () => {
    for (const weapon of WEAPONS) for (const tier of TIERS) {
      expect(parts(weapon, tier).filter(({ part }) => /(sight|scope)/i.test(part.category ?? '')).map(({ part }) => part.name), `${weapon} ${tier}`).toEqual([])
    }
  })
  it('never puts a handstop on, and the handguard carries a foregrip', { timeout: 120_000 }, () => {
    for (const weapon of WEAPONS) for (const tier of TIERS) {
      const list = parts(weapon, tier)
      expect(list.filter(({ part }) => /стоппер|hand ?stop/i.test(part.name)).map(({ part }) => part.name), `${weapon} ${tier}`).toEqual([])
      expect(list.some(({ part }) => part.category === 'foregrip'), `${weapon} ${tier}`).toBe(true)
    }
  })
  it('the top build\'s foregrip is the one with the least recoil (BCM GUNFIGHTER, Зенит РК-2)', { timeout: 120_000 }, () => {
    for (const weapon of WEAPONS) {
      const grip = parts(weapon, 'top').find(({ part }) => part.category === 'foregrip')!.part
      expect(grip.recoilModifier, `${weapon} ${grip.name}`).toBeLessThanOrEqual(-0.035)
    }
  })
  it('the top build is a grip, the Strike Industries tube and the Magpul PRS GEN3', { timeout: 120_000 }, () => {
    for (const weapon of WEAPONS) {
      expect(has(weapon, 'top', PRS_GEN3), weapon).toBe(true)
      expect(has(weapon, 'top', ARE), weapon).toBe(true)
      expect(parts(weapon, 'top').some(({ part }) => part.category === 'pistol-grip'), weapon).toBe(true)
    }
  })
  it('takes the Radian Raptor on the M4A1 and the CSS handle in a Kalashnikov\'s top build', { timeout: 120_000 }, () => {
    for (const tier of TIERS) expect(has(M4A1, tier, RAPTOR), tier).toBe(true)
    expect(has(AK74M, 'top', [CSS_AK])).toBe(true)
    expect(has(AKM, 'top', [CSS_AK])).toBe(true)
  })
  it('never takes ПТ-1 over ПТ-3', { timeout: 120_000 }, () => {
    for (const weapon of WEAPONS) for (const tier of TIERS) expect(has(weapon, tier, [PT_1]), `${weapon} ${tier}`).toBe(false)
  })
  it('a Kalashnikov always gets a receiver cover with a scope rail', { timeout: 120_000 }, () => {
    for (const weapon of [AK74M, AKM]) for (const tier of TIERS) {
      const cover = parts(weapon, tier).find(({ path }) => path.join('/') === 'mod_reciever')?.part
      expect(cover?.slots.some((slot) => slot.nameId === 'mod_scope'), `${weapon} ${tier} ${cover?.name}`).toBe(true)
    }
  })
})
