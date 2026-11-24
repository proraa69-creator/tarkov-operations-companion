import { describe, expect, it } from 'vitest'
import { installedParts, presetBuild } from './buildModel'
import type { GunPart, Weapon } from './gunTypes'
import { muzzleKits } from './muzzleKits'
import fixture from './fixtures/buildRulesCatalog.json'

const data = fixture as unknown as { weapons: Weapon[]; mods: GunPart[] }
const catalog = { mods: new Map(data.mods.map((part) => [part.id, part])) }
const M4A1 = '5447a9cd4bdc2dbd208b4567'

describe('«Комплекты: дульник + глушитель» (owner, 01.11.2026)', () => {
  it('pairs every muzzle device with the suppressors it takes, both installed', () => {
    const weapon = data.weapons.find((entry) => entry.id === M4A1)!
    const { build } = presetBuild(weapon, catalog)
    const muzzle = installedParts(build, catalog).find(({ path }) => /^mod_muzzle/.test(path[path.length - 1]!))!
    const owner = muzzle.path.length > 1 ? installedParts(build, catalog).find(({ path }) => path.join('/') === muzzle.path.slice(0, -1).join('/'))!.part : weapon
    const slot = owner.slots.find((entry) => entry.nameId === muzzle.path[muzzle.path.length - 1])!
    const kits = muzzleKits(build, muzzle.path, slot, catalog, weapon)
    expect(kits.length).toBeGreaterThan(0)
    for (const kit of kits.slice(0, 5)) {
      expect(kit.suppressor.category).toBe('silencer')
      expect(kit.device.category).not.toBe('silencer')
      const ids = installedParts(kit.build, catalog).map(({ part }) => part.id)
      expect(ids).toContain(kit.device.id)
      expect(ids).toContain(kit.suppressor.id)
    }
  })
  it('offers no kits for a slot that is not a muzzle', () => {
    const weapon = data.weapons.find((entry) => entry.id === M4A1)!
    const { build } = presetBuild(weapon, catalog)
    expect(muzzleKits(build, ['mod_magazine'], weapon.slots.find((slot) => slot.nameId === 'mod_magazine')!, catalog, weapon)).toEqual([])
  })
})
