import { describe, expect, it } from 'vitest'
import { installedParts } from './buildModel'
import type { Build, BuildNode, GunPart, Weapon } from './gunTypes'
import { buildOffer, LEARNED_POINTS, ruleScore, solveTier, type BuildTier } from './tieredBuilds'
import { withLiveGunPrices } from './liveGunPrices'
import { parseOwnerBuilds, partsMissingFrom } from './ownerBuilds'
import fixture from './fixtures/buildRulesCatalog.json'

/** The real catalog of the build rules (fixtures/buildRulesCatalog.json: M4A1, АК-74М, АКМ, СВДС, PvP 28.10.2026). */
const data = fixture as unknown as { weapons: Weapon[]; mods: GunPart[] }
const catalog = { mods: new Map(data.mods.map((part) => [part.id, part])) }
const M4A1 = '5447a9cd4bdc2dbd208b4567', AK74M = '5ac4cd105acfc40016339859', AKM = '59d6088586f774275f37482f'
const weapon = (id: string) => data.weapons.find((entry) => entry.id === id)!
const TIERS: BuildTier[] = ['budget', 'middle', 'top']
const solved = new Map<string, ReturnType<typeof solveTier>>()
const solve = (id: string, tier: BuildTier) => {
  const key = `${id}:${tier}`
  if (!solved.has(key)) solved.set(key, solveTier(weapon(id), catalog, tier))
  return solved.get(key)!
}
const partsOf = (build: Build) => installedParts(build, catalog)

describe('the builds after the solve (owner, 02.11.2026)', () => {
  it('leaves no part that a cheaper one of the same place, no worse, could take («аналоги дешевле такими же параметрами»)', { timeout: 120_000 }, () => {
    let checked = 0
    for (const id of [M4A1, AK74M, AKM]) for (const tier of TIERS) {
      const result = solve(id, tier)!
      const ids = new Set(partsOf(result.build).map(({ part }) => part.id))
      const included = new Set(result.cost.lines.filter((line) => line.included).map((line) => line.part.id))
      const visit = (node: BuildNode, owner: GunPart) => {
        for (const [slotId, child] of Object.entries(node.children)) {
          const slot = owner.slots.find((entry) => entry.nameId === slotId)
          const part = catalog.mods.get(child.itemId)
          if (!slot || !part) continue
          const price = buildOffer(part)?.priceRUB ?? 0
          const grip = part.category === 'foregrip' || part.category === 'pistol-grip'
          const cheaper = slot.allowed.map((other) => catalog.mods.get(other)).filter((other): other is GunPart => !!other && other.id !== part.id
            && other.category === part.category && other.recoilModifier <= part.recoilModifier && (grip || other.ergonomics >= part.ergonomics)
            && (other.capacity ?? 0) === (part.capacity ?? 0) && !other.slots.length && !part.slots.length && !other.conflicts.some((conflict) => ids.has(conflict))
            && (buildOffer(other)?.priceRUB ?? Infinity) < price && !/стоппер|hand ?stop/i.test(other.name))
          // what came with the preset costs nothing; the owner's named parts stay
          if (!included.has(part.id) && !/PRS|Raptor|ARE|CSS/.test(part.shortName)) {
            expect(cheaper.map((other) => `${other.shortName} ${buildOffer(other)?.priceRUB} for ${part.shortName} ${price}`), `${weapon(id).shortName} ${tier}`).toEqual([])
            checked++
          }
          visit(child, part)
        }
      }
      visit(result.build.root, weapon(id))
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('spends what «до 200 000 ₽» leaves on upgrades instead of one receiver more («лимит денег остался, проверяй что можно улучшить»)', { timeout: 120_000 }, () => {
    const budget = solve(M4A1, 'budget')!
    const middle = solve(M4A1, 'middle')!
    expect(middle.cost.total).toBeLessThanOrEqual(200_000)
    expect(middle.cost.total).toBeGreaterThan(150_000)
    const inBudget = new Set(partsOf(budget.build).map(({ part }) => part.id))
    expect(partsOf(middle.build).filter(({ part }) => !inBudget.has(part.id)).length).toBeGreaterThanOrEqual(3)
    expect(middle.stats.recoilVertical).toBeLessThan(budget.stats.recoilVertical)
    for (const tier of ['budget', 'middle'] as const) for (const id of [M4A1, AK74M, AKM]) expect(solve(id, tier)!.cost.total, `${id} ${tier}`).toBeLessThanOrEqual(tier === 'budget' ? 100_000 : 200_000)
  })

  it('counts a handguard\'s and a receiver\'s own ergonomics and recoil twice, a barrel\'s recoil twice', () => {
    const plain: GunPart = { id: 'x', name: 'x', shortName: 'x', weight: 0, accuracyModifier: 0, slots: [], conflicts: [], offers: [], noFlea: false, ergonomics: 10, recoilModifier: -0.02 }
    const base = ruleScore({ ...plain, category: 'muzzle-device' }, 'top')
    expect(ruleScore({ ...plain, category: 'handguard' }, 'top')).toBeCloseTo(base * 2)
    expect(ruleScore({ ...plain, category: 'receiver' }, 'top')).toBeCloseTo(base * 2)
    expect(ruleScore({ ...plain, category: 'barrel' }, 'top')).toBeCloseTo(base + 2 * 1.2 * 1)
  })
})

describe('the owner\'s builds and what they teach (owner, 02.11.2026: «ручное редактирование сборок… должен запоминать что я меняю»)', () => {
  it('shows the owner\'s build of a tier instead of the solved one', { timeout: 120_000 }, () => {
    const own = solve(M4A1, 'middle')!.build
    const shown = solveTier(weapon(M4A1), catalog, 'budget', { owner: { budget: own } })!
    expect(shown.owner).toBe(true)
    expect(partsOf(shown.build).map(({ part }) => part.id)).toEqual(partsOf(own).map(({ part }) => part.id))
    // a build whose parts no longer fit falls back to the solve
    const broken: Build = { weaponId: M4A1, root: { itemId: M4A1, children: { mod_magazine: { itemId: '0123456789abcdef01234567', children: {} } } } }
    expect(solveTier(weapon(M4A1), catalog, 'budget', { owner: { budget: broken } })!.owner).toBeUndefined()
  })

  it('leans the solver toward the parts the owner put in and away from the ones he took out, on any weapon', { timeout: 120_000 }, () => {
    const grip = (build: Build) => partsOf(build).find(({ part }) => part.category === 'pistol-grip')!.part
    const top = grip(solve(M4A1, 'top')!.build)
    const cheap = data.mods.find((part) => part.shortName === 'DLG138')!
    expect(top.id).not.toBe(cheap.id)
    const taught = solveTier(weapon(M4A1), catalog, 'top', { learned: new Map([[cheap.id, 3], [top.id, -3]]) })!
    expect(grip(taught.build).id).toBe(cheap.id)
    expect(LEARNED_POINTS).toBeGreaterThan(0)
  })

  it('reads the server\'s answer and tells what the owner changed against the app\'s build', () => {
    const answer = parseOwnerBuilds({ builds: [{ weaponId: M4A1, tier: 'middle', code: 'RB1.x..', updatedAt: '2026-11-02T10:00:00.000Z' }, { weaponId: M4A1, tier: 'cheap', code: 'RB1.x..' }],
      lessons: { a: { chosen: 2, rejected: 0 }, b: { chosen: 1, rejected: 2 }, c: { chosen: 1, rejected: 1 } } })
    expect(answer.builds.map((entry) => entry.tier)).toEqual(['middle'])
    expect([...answer.learned]).toEqual([['a', 2], ['b', -1]])
    expect(partsMissingFrom(['a', 'b', 'b', 'c'], ['c'])).toEqual(['a', 'b'])
    expect(parseOwnerBuilds(null)).toEqual({ builds: [], learned: new Map() })
  })
})

describe('the builds at this minute\'s flea prices (owner, 02.11.2026: «цена изменилась на барахолке, сборка тоже изменилась»)', () => {
  const part = data.mods.find((entry) => entry.offers.some((offer) => offer.vendor === 'flea-market'))!
  const gun = { weapons: data.weapons, mods: catalog.mods, ammo: [], loadedAt: '', source: 'live' as const }
  const flea = (entry: GunPart) => entry.offers.find((offer) => offer.vendor === 'flea-market')?.priceRUB

  it('puts the minute\'s lowest offer and day average on the flea offer; a lone dear listing takes the average', () => {
    const fresh = withLiveGunPrices(gun, { items: new Map([[part.id, { lastLowPrice: 12_345, avg24hPrice: 13_000 }]]) })
    expect(fresh).not.toBe(gun)
    expect(flea(fresh.mods.get(part.id)!)).toBe(12_345)
    expect(fresh.mods.get(part.id)!.fleaAvg24h).toBe(13_000)
    const lone = withLiveGunPrices(gun, { items: new Map([[part.id, { lastLowPrice: 500_000, avg24hPrice: 60_000 }]]) })
    expect(flea(lone.mods.get(part.id)!)).toBe(60_000)
    const banned = withLiveGunPrices(gun, { items: new Map([[part.id, { lastLowPrice: 1_000, noFlea: true }]]) })
    expect(flea(banned.mods.get(part.id)!)).toBeUndefined()
  })

  it('keeps the same catalogue when no price changed (nothing is solved again)', () => {
    expect(withLiveGunPrices(gun, null)).toBe(gun)
    const same = { lastLowPrice: flea(part), avg24hPrice: part.fleaAvg24h }
    expect(withLiveGunPrices(gun, { items: new Map([[part.id, same]]) })).toBe(gun)
  })
})
