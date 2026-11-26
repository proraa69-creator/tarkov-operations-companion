import { describe, expect, it } from 'vitest'
import { installedParts, presetBuild } from '../arsenal/buildModel'
import type { GunPart, Weapon } from '../arsenal/gunTypes'
import fixture from '../arsenal/fixtures/buildRulesCatalog.json'
import { assembleGuideBuild } from './guideBuild'

const data = fixture as unknown as { weapons: Weapon[]; mods: GunPart[] }
const catalog = { mods: new Map(data.mods.map((part) => [part.id, part])) }
const M4A1 = '5447a9cd4bdc2dbd208b4567'

describe('a Gunsmith build without the weapon\'s own stock (BuildGuide.withoutSlots)', () => {
  it('takes the stock off wherever it sits and keeps the rest of the build', () => {
    const weapon = data.weapons.find((entry) => entry.id === M4A1)!
    const slotsOf = (build: ReturnType<typeof presetBuild>['build']) => installedParts(build, catalog).map(({ path }) => path.join('/'))
    const preset = slotsOf(presetBuild(weapon, catalog).build)
    expect(preset.some((path) => path.split('/').includes('mod_stock'))).toBe(true)
    const without = slotsOf(assembleGuideBuild(weapon, [], catalog, ['mod_stock']).build)
    expect(without.some((path) => path.split('/').includes('mod_stock'))).toBe(false)
    expect(without).toEqual(preset.filter((path) => !path.split('/').includes('mod_stock')))
    expect(slotsOf(assembleGuideBuild(weapon, [], catalog).build)).toEqual(preset)
  })
})
