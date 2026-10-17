import { describe, expect, it } from 'vitest'
import { adaptAmmo, adaptMods, adaptOffers, adaptWeapons, asFraction } from './gunQueries'
import { canInstall, emptyBuild, installedParts, installPart, missingRequired, presetBuild, removePart } from './buildModel'
import { adsTime, approximateMoa, armStamina, cheapestOffer, computeCost, computeStats, deltaTone, evoErgoDelta, evoRecoil, headshotDistance100, headshotDistance80, muzzleVelocity, overswingWeight, partEvoErgo, valueScore } from './buildStats'
import { b64ToHex, decodeBuild, deleteSavedBuild, encodeBuild, hexToB64, loadSavedBuilds, saveBuild } from './buildStorage'
import { ammoPayload, FX, gunsPayload, modsPayload } from './fixtures/gunFixture'
import { prettyCaliber } from './gunFormat'
import type { Build, GunCatalog, Weapon } from './gunTypes'

const catalog: GunCatalog = { weapons: adaptWeapons(gunsPayload('en')), mods: adaptMods(modsPayload('en')), ammo: adaptAmmo(ammoPayload('en')), loadedAt: '', source: 'live' }
const m4 = catalog.weapons.find((weapon) => weapon.id === FX.m4) as Weapon
const slotOf = (parentId: string, nameId: string) => (parentId === FX.m4 ? m4 : catalog.mods.get(parentId)!).slots.find((slot) => slot.nameId === nameId)!

describe('tarkov.dev adapters', () => {
  it('keeps bare weapons, drops presets listed under type gun', () => {
    expect(catalog.weapons.map((weapon) => weapon.shortName)).toEqual(['M4A1', 'AK-74N', 'MP7A1', 'Glock 17', 'M700'])
    expect(m4.weaponClass).toBe('assault-rifle')
    expect(m4.defaultPreset?.itemIds).not.toContain(FX.m4)
    expect(m4.imageLink).toContain('m4-default-512')
  })
  it('reads slots, filters, conflicts, offers and flea bans', () => {
    expect(slotOf(FX.m4, 'mod_magazine')).toMatchObject({ required: true, allowed: [FX.mag30, FX.mag60] })
    expect(catalog.mods.get(FX.gasA2)?.conflicts).toEqual([FX.handguardSmr])
    expect(catalog.mods.get(FX.suppressor)?.noFlea).toBe(true)
    expect(catalog.mods.get(FX.barrel145)?.centerOfImpact).toBe(0.044)
    expect(catalog.mods.get(FX.mag60)?.offers.find((offer) => offer.vendor === 'peacekeeper')?.minTraderLevel).toBe(3)
  })
  it('reads modifiers as fractions, whole percents only when beyond ±1', () => {
    expect(asFraction(-0.05)).toBe(-0.05)
    expect(asFraction(-5)).toBe(-0.05)
    expect(asFraction(undefined)).toBe(0)
  })
  it('reads ammo ballistics', () => {
    expect(catalog.ammo.find((ammo) => ammo.id === FX.m995)).toMatchObject({ penetration: 53, damage: 42, noFlea: true, caliber: 'Caliber556x45NATO' })
  })
})

describe('build tree and compatibility', () => {
  it('rebuilds the default preset tree from its flat item list', () => {
    const { build, unplaced } = presetBuild(m4, catalog)
    expect(unplaced).toEqual([])
    expect(build.root.children.mod_reciever.children.mod_barrel.children.mod_gas_block.itemId).toBe(FX.gasLow)
    expect(build.root.children.mod_stock.children.mod_stock_000.itemId).toBe(FX.stockM4)
    expect(installedParts(build, catalog)).toHaveLength(11)
    expect(missingRequired(build, m4, catalog)).toEqual([])
  })
  it('lists required empty slots, nested ones included', () => {
    const empty = emptyBuild(m4)
    expect(missingRequired(empty, m4, catalog).map((entry) => entry.path.join('/'))).toEqual(['mod_magazine', 'mod_reciever'])
    const withUpper = installPart(empty, ['mod_reciever'], FX.upper, catalog)
    expect(missingRequired(withUpper, m4, catalog).map((entry) => entry.path.join('/'))).toEqual(['mod_magazine', 'mod_reciever/mod_barrel'])
  })
  it('allows only filters.allowedItems in a slot', () => {
    const build = emptyBuild(m4)
    expect(canInstall(build, ['mod_magazine'], slotOf(FX.m4, 'mod_magazine'), FX.mag60, catalog)).toEqual({ ok: true })
    expect(canInstall(build, ['mod_magazine'], slotOf(FX.m4, 'mod_magazine'), FX.grip, catalog)).toMatchObject({ ok: false, reason: 'not-allowed' })
  })
  it('blocks conflicting items in both directions, but not the item being replaced', () => {
    const { build } = presetBuild(m4, catalog)
    const withA2 = installPart(build, ['mod_reciever', 'mod_barrel', 'mod_gas_block'], FX.gasA2, catalog)
    const handguardPath = ['mod_reciever', 'mod_handguard']
    expect(canInstall(withA2, handguardPath, slotOf(FX.upper, 'mod_handguard'), FX.handguardSmr, catalog)).toMatchObject({ ok: false, reason: 'conflict', conflictWith: FX.gasA2 })
    const withSmr = installPart(build, handguardPath, FX.handguardSmr, catalog)
    const gasPath = ['mod_reciever', 'mod_barrel', 'mod_gas_block']
    expect(canInstall(withSmr, gasPath, slotOf(FX.barrel145, 'mod_gas_block'), FX.gasA2, catalog)).toMatchObject({ ok: false, reason: 'conflict' })
    // Replacing the conflicting gas block itself is fine.
    expect(canInstall(withA2, gasPath, slotOf(FX.barrel145, 'mod_gas_block'), FX.gasLow, catalog)).toEqual({ ok: true })
  })
  it('keeps fitting children when a part is swapped and drops a removed subtree', () => {
    const { build } = presetBuild(m4, catalog)
    const shortBarrel = installPart(build, ['mod_reciever', 'mod_barrel'], FX.barrel105, catalog)
    expect(shortBarrel.root.children.mod_reciever.children.mod_barrel.children.mod_muzzle.itemId).toBe(FX.flashHider)
    expect(build.root.children.mod_reciever.children.mod_barrel.itemId).toBe(FX.barrel145) // immutable
    const noUpper = removePart(build, ['mod_reciever'])
    expect(installedParts(noUpper, catalog)).toHaveLength(5)
  })
})

describe('stats', () => {
  it('applies the summed recoil modifiers once: base × (1 + Σ)', () => {
    // Preset mods: flash hider −5 %, gas block −1 %, handguard −1 %, stock −12 % → Σ = −19 %.
    const { build } = presetBuild(m4, catalog)
    const stats = computeStats(build, m4, catalog)
    expect(stats.recoilModifierSum).toBeCloseTo(-0.19)
    expect(stats.recoilVertical).toBe(Math.round(56 * 0.81))
    expect(stats.recoilHorizontal).toBe(Math.round(220 * 0.81))
  })
  it('includes the ammo recoil modifier and adds ergonomics', () => {
    const { build } = presetBuild(m4, catalog)
    const m995 = catalog.ammo.find((ammo) => ammo.id === FX.m995)
    const stats = computeStats(build, m4, catalog, m995)
    expect(stats.recoilVertical).toBe(Math.round(56 * (1 - 0.19 + 0.04)))
    // 50 + grip 6 − mag 2 + upper 4 − barrel 11 − hider 1 + 0 + handguard 4 + 0 + 0 + stock 7 + 0
    expect(stats.ergonomics).toBe(57)
  })
  it('clamps ergonomics to 0…100 and sums weight', () => {
    const heavy = { ...m4, ergonomics: 5 }
    const build = installPart(emptyBuild(m4), ['mod_magazine'], FX.mag60, catalog)
    expect(computeStats(build, heavy, catalog).ergonomics).toBe(0)
    expect(computeStats(build, m4, catalog).weight).toBeCloseTo(0.8 + 0.38)
  })
  it('approximates MOA as 35 × the barrel centre of impact, the round\'s accuracy dividing it', () => {
    expect(approximateMoa(0.044, 0)).toBeCloseTo(1.54, 2)
    // HK 416A5 barrels on db4tarkov: COI 0.032 → 1.12, 0.07 → 2.45
    expect(approximateMoa(0.032, 0)).toBeCloseTo(1.12, 2)
    expect(approximateMoa(0.07, 0)).toBeCloseTo(2.45, 2)
    expect(approximateMoa(0.044, 0.1)).toBeCloseTo(1.54 * 0.9, 2)
    expect(approximateMoa(0.044, 0, 0.1)).toBeCloseTo(1.54 / 1.1, 2)
    const { build } = presetBuild(m4, catalog)
    expect(computeStats(build, m4, catalog).moa).toBeCloseTo(1.54, 2)
    expect(computeStats(emptyBuild(m4), m4, catalog).moa).toBeCloseTo(3.5, 2)
  })
  it('carries the handling model into the build: EvoErgo, ADS, stamina, headshot distances, velocity', () => {
    const { build } = presetBuild(m4, catalog)
    const m995 = catalog.ammo.find((ammo) => ammo.id === FX.m995)!
    const stats = computeStats(build, m4, catalog, m995)
    expect(stats.evoErgo).toBeCloseTo(evoErgoDelta(stats.ergonomicsRaw, stats.weightLoaded), 1)
    expect(stats.overswing).toBe(stats.evoErgo <= 0)
    expect(stats.adsTime).toBeCloseTo(adsTime(stats.evoErgo), 2)
    expect(stats.headshot100).toBe(Math.round(headshotDistance100(stats.moa!)))
    expect(stats.recoilVerticalNoAmmo).toBe(Math.round(56 * 0.81))
    // the strength skill and an equipment penalty move the estimates
    expect(computeStats(build, m4, catalog, m995, { strength: 51 }).armStamina).toBeGreaterThan(stats.armStamina)
    expect(computeStats(build, m4, catalog, m995, { ergoPenaltyPercent: 20 }).evoErgo).toBeLessThan(stats.evoErgo)
  })
  it('uses the community formulas exactly', () => {
    expect(overswingWeight(50)).toBeCloseTo(0.0007556 * 2500 + 0.02736 * 50 + 2.9159, 9)
    expect(overswingWeight(50, 10)).toBeCloseTo(overswingWeight(45), 9)
    expect(evoErgoDelta(50, 3)).toBeCloseTo(15 * (overswingWeight(50) - 3), 9)
    expect(adsTime(-1)).toBe(1)
    expect(adsTime(10)).toBeCloseTo(-0.0096 * 10 + 0.819, 9)
    expect(adsTime(30)).toBeCloseTo(-0.0051 * 30 + 0.73, 9)
    expect(adsTime(100)).toBeCloseTo(-0.00192 * 100 + 0.59, 9)
    expect(adsTime(200)).toBe(0.29)
    expect(armStamina(3, 50)).toBeCloseTo((85.5 / 3.65 + 9.15 + 0.06477 * 50 * 0.94) / 1.04 * 1.2, 9)
    expect(headshotDistance100(1.97)).toBeCloseTo(141.9, 1)
    expect(headshotDistance80(1)).toBeCloseTo(465.445, 3)
    expect(partEvoErgo({ ergonomics: 50, weight: 3 }, { ergonomics: 5, weight: 0.2 })).toBeCloseTo(evoErgoDelta(55, 3.2) - evoErgoDelta(50, 3), 9)
    expect(evoRecoil(56, -19, -25)).toBeLessThan(0)
    expect(valueScore(-20, 60)).toBeCloseTo(40, 9)
    expect(muzzleVelocity(900, -8)).toBeCloseTo(828, 9)
  })
  it('colours deltas: less recoil/cost/weight is better, more ergonomics is better', () => {
    expect(deltaTone('recoil', -3)).toBe('better')
    expect(deltaTone('ergonomics', -3)).toBe('worse')
    expect(deltaTone('cost', 1000)).toBe('worse')
    expect(deltaTone('weight', 0)).toBe('same')
  })
})

describe('cost', () => {
  it('takes the cheapest source, respecting loyalty levels', () => {
    const mag60 = catalog.mods.get(FX.mag60)!
    expect(cheapestOffer(mag60)?.vendor).toBe('flea-market')
    expect(cheapestOffer(mag60, { traderLevel: 4, flea: false })).toMatchObject({ vendor: 'peacekeeper', minTraderLevel: 3 })
    expect(cheapestOffer(mag60, { traderLevel: 2, flea: false })).toBeUndefined()
    const handguardSmr = catalog.mods.get(FX.handguardSmr)!
    expect(cheapestOffer(handguardSmr)?.priceRUB).toBe(26_700)
    expect(cheapestOffer(handguardSmr, { traderLevel: 3, flea: true })?.priceRUB).toBe(29_000)
  })
  it('never buys a flea-banned item on the flea market', () => {
    const suppressor = catalog.mods.get(FX.suppressor)!
    expect(cheapestOffer(suppressor)).toMatchObject({ vendor: 'peacekeeper', priceRUB: 61_000 })
    expect(cheapestOffer(suppressor, { traderLevel: 2, flea: true })).toBeUndefined()
  })
  it('sums the weapon and every part and reports what cannot be bought', () => {
    const build = installPart(installPart(emptyBuild(m4), ['mod_magazine'], FX.mag30, catalog), ['mod_charge'], FX.chargeRaptor, catalog)
    const cost = computeCost(build, m4, catalog)
    expect(cost.total).toBe(29_500 + 3_100)
    expect(cost.unavailable.map((part) => part.id)).toEqual([FX.chargeRaptor])
  })
})

describe('caliber labels', () => {
  it('formats tarkov.dev caliber ids', () => {
    expect(prettyCaliber('Caliber556x45NATO')).toBe('5.56x45 NATO')
    expect(prettyCaliber('Caliber545x39')).toBe('5.45x39')
    expect(prettyCaliber('Caliber9x19PARA')).toBe('9x19 PARA')
    expect(prettyCaliber('Caliber127x55')).toBe('12.7x55')
    expect(prettyCaliber('Caliber1143x23ACP')).toBe('11.43x23 ACP')
    expect(prettyCaliber('Caliber12g')).toBe('12g')
  })
})

describe('share codes and saved builds', () => {
  it('converts ids to base64url and back', () => {
    expect(hexToB64(FX.m4)).toHaveLength(16)
    expect(b64ToHex(hexToB64(FX.suppressor))).toBe(FX.suppressor)
  })
  it('round-trips a nested build through a short code', () => {
    const { build } = presetBuild(m4, catalog)
    const modified: Build = { ...installPart(build, ['mod_reciever', 'mod_barrel', 'mod_muzzle'], FX.suppressor, catalog), ammoId: FX.m855a1 }
    const code = encodeBuild(modified, catalog)!
    expect(code.startsWith('RB1.')).toBe(true)
    expect(code.length).toBeLessThan(260)
    expect(decodeBuild(`Сборка: ${code}`, catalog)).toEqual(modified)
  })
  it('ignores items that no longer fit their slot', () => {
    const code = encodeBuild(installPart(emptyBuild(m4), ['mod_magazine'], FX.mag30, catalog), catalog)!
    const changed = { ...catalog, mods: new Map(catalog.mods) }
    expect(decodeBuild(code, changed)?.root.children.mod_magazine?.itemId).toBe(FX.mag30)
    const strictWeapon = { ...m4, slots: m4.slots.map((slot) => slot.nameId === 'mod_magazine' ? { ...slot, allowed: [FX.mag60] } : slot) }
    expect(decodeBuild(code, { ...catalog, weapons: [strictWeapon] })?.root.children).toEqual({})
    expect(decodeBuild('garbage', catalog)).toBeUndefined()
  })
  it('keeps saved builds per mode', () => {
    localStorage.clear()
    saveBuild('pvp', { name: 'Meta', weaponId: FX.m4, code: 'RB1.x' })
    expect(loadSavedBuilds('pvp')).toHaveLength(1)
    expect(loadSavedBuilds('pve')).toEqual([])
    expect(loadSavedBuilds('seasonal')).toEqual([])
    expect(deleteSavedBuild('pvp', loadSavedBuilds('pvp')[0].id)).toEqual([])
  })
})

describe('buy offers: the flea at the cheapest current offer', () => {
  it('replaces the 24-hour average tarkov.dev puts in the flea entry of buyFor with lastLowPrice', () => {
    const buyFor = [
      { priceRUB: 31_800, vendor: { name: 'Барахолка', normalizedName: 'flea-market' } },
      { priceRUB: 29_000, vendor: { name: 'Механик', normalizedName: 'mechanic', minTraderLevel: 3 } },
    ]
    expect(adaptOffers({ lastLowPrice: 26_700, buyFor })).toEqual([
      { vendor: 'flea-market', vendorName: 'Барахолка', priceRUB: 26_700 },
      { vendor: 'mechanic', vendorName: 'Механик', priceRUB: 29_000, minTraderLevel: 3 },
    ])
    // No current offer: the average from buyFor stays.
    expect(adaptOffers({ lastLowPrice: null, buyFor })[0]?.priceRUB).toBe(31_800)
  })
})
