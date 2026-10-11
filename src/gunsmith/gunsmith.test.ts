import { describe, expect, it } from 'vitest'
import { adaptMods, adaptWeapons } from '../arsenal/gunQueries'
import { installedParts } from '../arsenal/buildModel'
import { FX, FX_CATEGORY, gunsPayload, modsPayload } from '../arsenal/fixtures/gunFixture'
import { adaptObjectiveDetails, weaponBuild } from '../data/objectiveDetails'
import type { Quest, WeaponBuildRequirement } from '../domain/types'
import { attributeLabel, formatTarget, gunsmithSteps, gunsmithSummary, isGunsmithQuest, meets, shortfall } from './gunsmith'
import { solveGunsmithBuild } from './gunsmithSolver'

const catalog = { weapons: adaptWeapons(gunsPayload('ru')), mods: adaptMods(modsPayload('ru')) }
const quest = (id: string, name: string, normalizedName: string, build?: WeaponBuildRequirement): Quest => ({
  id, name, normalizedName, trader: 'Механик', level: 1, kappa: false, description: '', objectives: [], rewards: [],
  ...(build ? { objectiveDetails: [{ id: `${id}-o`, type: 'buildWeapon', description: '', count: 1, build }] } : {}),
})

describe('«Оружейник»: the Gunsmith chain', () => {
  it('finds every Gunsmith task: numbered, named by the weapon, or any task that asks to build a weapon', () => {
    expect(isGunsmithQuest({ name: 'x', normalizedName: 'gunsmith-part-12' })).toBe(true)
    expect(isGunsmithQuest({ name: 'Оружейник. Часть 3' })).toBe(true)
    expect(isGunsmithQuest({ name: 'Gunsmith - Part 25' })).toBe(true)
    // The game names the parts by their weapon now (owner's PvE, 11.10.2026), sometimes with Latin look-alike letters.
    expect(isGunsmithQuest({ name: 'Оружейник. АКС-74Н' })).toBe(true)
    expect(isGunsmithQuest({ name: 'Gunsmith - AKS-74N', normalizedName: 'gunsmith-aks-74n' })).toBe(true)
    expect(isGunsmithQuest({ name: 'Oружейник. MP-133' })).toBe(true)
    expect(isGunsmithQuest({ name: 'Особый заказ', objectiveDetails: [{ id: 'o', type: 'buildWeapon', description: '', count: 1, build: { weaponId: 'w', partIds: [], attributes: [] } }] })).toBe(true)
    expect(isGunsmithQuest({ name: 'Оружейная лихорадка', normalizedName: 'gun-fever' })).toBe(false)
    expect(isGunsmithQuest({ name: 'Мастер-оружейник', normalizedName: 'master-gunsmith' })).toBe(false)
  })

  it('orders unnumbered parts by the chain itself (each needs the one before)', () => {
    const named = (id: string, name: string, previous: string[], level: number): Quest => ({ ...quest(id, name, ''), previous, level })
    const quests = [named('k', 'Оружейник. Kedr', ['a'], 30), named('a', 'Оружейник. АКС-74Н', [], 40), named('m', 'Оружейник. MP-133', ['k'], 5)]
    expect(gunsmithSteps(quests, () => undefined).map((step) => [step.part, step.quest.id])).toEqual([[1, 'a'], [2, 'k'], [3, 'm']])
  })

  it('orders the parts, knows which are taken and which comes next', () => {
    const quests = [quest('c', 'Оружейник. Часть 3', 'gunsmith-part-3'), quest('a', 'Оружейник. Часть 1', 'gunsmith-part-1'), quest('b', 'Оружейник. Часть 2', 'gunsmith-part-2'), quest('z', 'Другое', 'other')]
    const statuses: Record<string, 'completed' | 'active' | 'locked'> = { a: 'completed', b: 'active', c: 'locked' }
    const steps = gunsmithSteps(quests, (id) => statuses[id])
    expect(steps.map((step) => [step.part, step.status])).toEqual([[1, 'completed'], [2, 'active'], [3, 'locked']])
    expect(gunsmithSummary(steps)).toMatchObject({ done: 1, total: 3, next: undefined })
    expect(gunsmithSummary(steps).active.map((step) => step.part)).toEqual([2])
    statuses.b = 'completed'
    expect(gunsmithSummary(gunsmithSteps(quests, (id) => statuses[id])).next?.part).toBe(3)
  })

  it('names every stat in the words of the game, effectiveDistance included', () => {
    expect(attributeLabel('effectiveDistance', 'ru')).toBe('Эффективная дальность')
    expect(attributeLabel('effectiveDistance', 'en')).toBe('Effective distance')
    expect(attributeLabel('someNewStat', 'en')).toBe('Some New Stat')
    expect(formatTarget({ name: 'weight', compare: '<=', value: 4 }, 'ru')).toBe('≤ 4 кг')
    expect(formatTarget({ name: 'effectiveDistance', compare: '>=', value: 300 }, 'en')).toBe('≥ 300 m')
    expect(meets({ name: 'recoil', compare: '<=', value: 310 }, 310)).toBe(true)
    expect(meets({ name: 'ergonomics', compare: '>', value: 50 }, 50)).toBe(false)
    expect(shortfall({ name: 'ergonomics', compare: '>=', value: 50 }, 40)).toBeCloseTo(0.2, 3)
    expect(shortfall({ name: 'ergonomics', compare: '>=', value: 50 }, 55)).toBe(0)
  })
})

describe('buildWeapon objectives from tarkov.dev', () => {
  it('reads the weapon, the parts and the stats in the JSON (ids) and GraphQL (objects) shapes', () => {
    const json = { id: 'o', type: 'buildWeapon', item: 'hk416', containsAll: ['rc2', 'exps3'], containsCategory: [{ id: 'cat', name: 'Тактическая рукоятка' }], attributes: [{ name: 'ergonomics', requirement: { compareMethod: '>=', value: 50 } }, { name: 'effectiveDistance', requirement: { compareMethod: '>=', value: 300 } }] }
    expect(weaponBuild(json)).toEqual({ weaponId: 'hk416', partIds: ['rc2', 'exps3'], categories: [{ id: 'cat', name: 'Тактическая рукоятка' }], attributes: [{ name: 'ergonomics', compare: '>=', value: 50 }, { name: 'effectiveDistance', compare: '>=', value: 300 }] })
    expect(weaponBuild({ type: 'buildWeapon', item: { id: 'hk416' }, containsAll: [{ id: 'rc2', name: 'RC2' }], attributes: [{ name: 'weight', requirement: { compareMethod: '<=', value: 4 } }] })).toMatchObject({ partIds: ['rc2'], attributes: [{ name: 'weight', compare: '<=', value: 4 }] })
    expect(weaponBuild({ type: 'giveItem', items: ['x'] })).toBeUndefined()
    const [objective] = adaptObjectiveDetails([json], () => undefined)
    expect(objective.build?.weaponId).toBe('hk416')
  })
})

describe('«Как собрать»: example build for a Gunsmith part', () => {
  it('puts in the required parts, the magazine the specification needs and the parts that reach the stats', () => {
    const plan = solveGunsmithBuild({
      weaponId: FX.m4,
      partIds: [FX.suppressor, FX.holo, FX.foregrip],
      attributes: [{ name: 'ergonomics', compare: '>=', value: 48 }, { name: 'recoil', compare: '<=', value: 200 }, { name: 'magazineCapacity', compare: '>=', value: 60 }, { name: 'effectiveDistance', compare: '>=', value: 300 }],
    }, catalog)!
    const ids = installedParts(plan.build, catalog).map((entry) => entry.part.id)
    expect(ids).toEqual(expect.arrayContaining([FX.suppressor, FX.holo, FX.foregrip, FX.mag60]))
    expect(ids).not.toContain(FX.flashHider)
    expect(plan.unplaced).toEqual([])
    const check = (name: string) => plan.checks.find((entry) => entry.attribute.name === name)!
    expect(check('ergonomics')).toMatchObject({ met: true })
    expect(check('recoil')).toMatchObject({ met: true })
    expect(check('magazineCapacity')).toMatchObject({ actual: 60, met: true })
    // Effective distance is not in the data: checked in the game.
    expect(check('effectiveDistance')).toEqual({ attribute: { name: 'effectiveDistance', compare: '>=', value: 300 } })
    const toBuy = plan.toBuy.map((line) => line.part.id)
    expect(toBuy).toEqual(expect.arrayContaining([FX.suppressor, FX.holo, FX.foregrip, FX.mag60]))
    expect(toBuy).not.toContain(FX.upper)
    // The flea-banned suppressor comes from Peacekeeper.
    expect(plan.toBuy.find((line) => line.part.id === FX.suppressor)?.offer?.vendor).toBe('peacekeeper')
  })

  it('lists cheaper parts that keep every requirement met, and leaves out those that break one', () => {
    const plan = solveGunsmithBuild({
      weaponId: FX.m4,
      partIds: [FX.holo],
      attributes: [{ name: 'ergonomics', compare: '>=', value: 48 }, { name: 'recoil', compare: '<=', value: 200 }, { name: 'magazineCapacity', compare: '>=', value: 60 }],
    }, catalog)!
    expect(plan.toBuy.map((line) => line.part.id)).toContain(FX.stockCtr)
    // The MOE stock also keeps ergonomics ≥ 48 and recoil ≤ 200, 4 400 ₽ cheaper (Mechanic 5 400 instead of 9 800).
    const stock = plan.alternatives.find((entry) => entry.part.id === FX.stockCtr)
    expect(stock?.options.map((option) => [option.part.id, option.saving])).toEqual([[FX.stockMoe, 4_400]])
    for (const value of stock!.options[0].values) expect(meets(value.attribute, value.actual)).toBe(true)
    // The rifle's own M4 stock would push the recoil over 200: not offered.
    expect(stock?.options.map((option) => option.part.id)).not.toContain(FX.stockM4)
    // Required parts have no alternatives.
    expect(plan.alternatives.map((entry) => entry.part.id)).not.toContain(FX.holo)
  })

  it('swaps in a part with the slot a required part needs (a handguard with a mount rail)', () => {
    const plan = solveGunsmithBuild({ weaponId: FX.m4, partIds: [FX.mount], attributes: [] }, catalog)!
    const ids = installedParts(plan.build, catalog).map((entry) => entry.part.id)
    expect(ids).toEqual(expect.arrayContaining([FX.handguardSmr, FX.mount]))
    expect(plan.unplaced).toEqual([])
  })

  it('puts in a part of a required category (json.tarkov.dev containsCategory), the cheapest that fits', () => {
    expect(catalog.mods.get(FX.foregrip)?.categoryIds).toEqual([FX_CATEGORY.foregrip, FX_CATEGORY.mod])
    const plan = solveGunsmithBuild({ weaponId: FX.m4, partIds: [], categories: [{ id: FX_CATEGORY.foregrip, name: 'Тактическая рукоятка' }], attributes: [] }, catalog)!
    // Two foregrips are in the category: the cheaper RVG goes in.
    expect(installedParts(plan.build, catalog).map((entry) => entry.part.id)).toContain(FX.foregripRvg)
    expect(plan.toBuy.map((line) => line.part.id)).toContain(FX.foregripRvg)
  })

  it('reads json.tarkov.dev `buildAttributes` and leaves out the stats the part does not ask for (value 0)', () => {
    expect(weaponBuild({ type: 'buildWeapon', item: 'mp133', containsAll: [], containsCategory: ['c1'], buildAttributes: { ergonomics: { compareMethod: '>=', value: 9 }, width: { compareMethod: '<=', value: 0 } } }, (id) => (id === 'c1' ? 'Цевьё' : undefined)))
      .toEqual({ weaponId: 'mp133', partIds: [], categories: [{ id: 'c1', name: 'Цевьё' }], attributes: [{ name: 'ergonomics', compare: '>=', value: 9 }] })
  })

  it('reports what cannot be done instead of guessing', () => {
    expect(solveGunsmithBuild({ weaponId: 'unknown', partIds: [], attributes: [] }, catalog)).toBeNull()
    expect(solveGunsmithBuild({ weaponId: FX.m4, partIds: ['not-in-data'], attributes: [] }, catalog)?.unplaced).toEqual(['not-in-data'])
    // A preset id leads to its weapon.
    expect(solveGunsmithBuild({ weaponId: FX.preset, partIds: [], attributes: [] }, catalog)?.weapon.id).toBe(FX.m4)
  })
})
