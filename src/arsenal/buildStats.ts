import { installedParts } from './buildModel'
import type { AmmoStats, Build, GunCatalog, GunOffer, GunPart, Weapon } from './gunTypes'

/**
 * Weapon stats of a build.
 *
 * Recoil — Escape from Tarkov wiki, «Weapon mods» (escapefromtarkov.fandom.com/wiki/Weapon_mods) and «Recoil»:
 * the recoil modifiers of all attachments (and the loaded ammo) are summed and applied once to the weapon's base
 * recoil, not multiplied one after another:
 *   recoil = base recoil × (1 + Σ recoilModifier)
 * e.g. base 100 with −5 %, −10 % and +2 % mods → 100 × (1 − 0.13) = 87.
 *
 * Ergonomics — additive: base ergonomics + Σ attachment ergonomics, shown clamped to the game's 0…100.
 *
 * Accuracy (MOA) is an approximation and is labelled so in the UI: the barrel's (else the weapon's) centre of impact
 * × 35 (the game's inspect MOA matches 35 × centerOfImpact within ±0.03), divided by (1 + the round's accuracy) and
 * scaled by (1 − Σ attachment accuracyModifier). The game's real dispersion also depends on skills, not modelled.
 *
 * Handling (owner, 17.10.2026: the weapon builder of db4tarkov «FORGE» studied and brought in): the community model of
 * «EvoErgo» — how far the build's weight is under the weight at which the weapon starts to overswing for its
 * ergonomics — and the aim-down-sights time and arm stamina fitted to it. Estimates, shown as such.
 */
export interface BuildStats {
  recoilVertical: number
  recoilHorizontal: number
  /** Unrounded recoil with the round, and the in-game figure without it (the game's weapon screen shows no ammo). */
  recoilVerticalExact: number
  recoilVerticalNoAmmo: number
  recoilHorizontalNoAmmo: number
  ergonomics: number
  /** Ergonomics before the 0…100 clamp (what the handling model takes). */
  ergonomicsRaw: number
  /** Muzzle velocity, m/s, with the round and the parts' velocity changes; undefined without a round. */
  velocity?: number
  /** Σ velocity changes of the parts, percent. */
  velocityModifierSum: number
  /** The weight with a full magazine of the round (the bare weight is `weight`). */
  weightLoaded: number
  /** Handling (estimates, see the model above). */
  evoErgo: number
  overswing: boolean
  adsTime: number
  armStamina: number
  /** Distance (m) at which every / 80 % of shots still land in a head; undefined without MOA. */
  headshot100?: number
  headshot80?: number
  /** Σ recoil modifiers, as a fraction (−0.25 = −25 %). */
  recoilModifierSum: number
  accuracyModifierSum: number
  /** Approximate MOA; undefined when the data has no centre of impact. */
  moa?: number
  weight: number
  partCount: number
  /** Inventory size in cells (see `weaponSize`); absent when the data has no part sizes. */
  width?: number
  height?: number
}

export const CM_PER_MOA_AT_100M = 2.9089
/** The game's inspect MOA per unit of tarkov.dev `centerOfImpact` (35.0 ± 0.03 over the HK 416 barrels and others). */
export const MOA_PER_CENTER_OF_IMPACT = 35

/** The player's side of the handling model: equipment ergonomics penalty (percent) and the Strength skill level. */
export interface HandlingOptions {
  ergoPenaltyPercent?: number
  strength?: number
}

export function computeStats(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, ammo?: AmmoStats, options: HandlingOptions = {}): BuildStats {
  const parts = installedParts(build, catalog).map((entry) => entry.part)
  const partRecoil = sum(parts.map((part) => part.recoilModifier))
  const partAccuracy = sum(parts.map((part) => part.accuracyModifier))
  const recoilModifierSum = partRecoil + (ammo?.recoilModifier ?? 0)
  const accuracyModifierSum = partAccuracy + (ammo?.accuracyModifier ?? 0)
  const factor = Math.max(0, 1 + recoilModifierSum)
  const bareFactor = Math.max(0, 1 + partRecoil)
  const barrel = parts.find((part) => part.centerOfImpact !== undefined)
  const centerOfImpact = barrel?.centerOfImpact ?? weapon.weaponCenterOfImpact
  const ergonomicsRaw = weapon.ergonomics + sum(parts.map((part) => part.ergonomics))
  const weight = weapon.weight + sum(parts.map((part) => part.weight))
  const capacity = Math.max(0, ...parts.map((part) => part.capacity ?? 0))
  const weightLoaded = weight + (ammo?.weight ?? 0) * capacity
  const velocityModifierSum = sum(parts.map((part) => part.velocity ?? 0))
  const moa = centerOfImpact ? approximateMoa(centerOfImpact, partAccuracy, ammo?.accuracyModifier ?? 0) : undefined
  const evoErgo = evoErgoDelta(ergonomicsRaw, weightLoaded, options.ergoPenaltyPercent)
  return {
    recoilVertical: Math.round(weapon.recoilVertical * factor),
    recoilHorizontal: Math.round(weapon.recoilHorizontal * factor),
    recoilVerticalExact: weapon.recoilVertical * factor,
    recoilVerticalNoAmmo: Math.round(weapon.recoilVertical * bareFactor),
    recoilHorizontalNoAmmo: Math.round(weapon.recoilHorizontal * bareFactor),
    ergonomics: clamp(Math.round(ergonomicsRaw), 0, 100),
    ergonomicsRaw,
    recoilModifierSum,
    accuracyModifierSum,
    moa: moa === undefined ? undefined : round2(moa),
    ...(ammo?.initialSpeed ? { velocity: muzzleVelocity(ammo.initialSpeed, velocityModifierSum) } : {}),
    velocityModifierSum,
    weight: round3(weight),
    weightLoaded: round3(weightLoaded),
    evoErgo: round2(evoErgo),
    overswing: evoErgo <= 0,
    adsTime: round3(adsTime(evoErgo)),
    armStamina: Math.round(armStamina(weightLoaded, ergonomicsRaw, options.strength) * 10) / 10,
    ...(moa ? { headshot100: Math.round(headshotDistance100(moa)), headshot80: Math.round(headshotDistance80(moa)) } : {}),
    partCount: parts.length,
    ...weaponSize(parts, weapon, catalog),
  }
}

// ------------------------------------------------------------------------------------------------------------
// Handling model (community fit, as db4tarkov FORGE uses it): E ergonomics (not clamped), W weight with a full magazine
// in kg, P the equipment ergonomics penalty in percent, S the Strength skill (default 50).
// ------------------------------------------------------------------------------------------------------------

/** Ergonomics after the equipment penalty: E' = E · (1 − P/100). */
export function penalizedErgonomics(ergonomics: number, ergoPenaltyPercent = 0) {
  return ergonomics * (1 - ergoPenaltyPercent / 100)
}

/** The weight (kg) above which a weapon of these ergonomics overswings: 0.0007556·E'² + 0.02736·E' + 2.9159. */
export function overswingWeight(ergonomics: number, ergoPenaltyPercent = 0) {
  const e = penalizedErgonomics(ergonomics, ergoPenaltyPercent)
  return 0.0007556 * e * e + 0.02736 * e + 2.9159
}

/** «EvoErgo» (EED) = 15 · (overswing weight − weight): positive is under the limit; ≤ 0 overswings. */
export function evoErgoDelta(ergonomics: number, weight: number, ergoPenaltyPercent = 0) {
  return 15 * (overswingWeight(ergonomics, ergoPenaltyPercent) - weight)
}

/** Aim-down-sights time in seconds for an EvoErgo value (piecewise linear fit; 1 s while overswinging, 0.29 s floor). */
export function adsTime(evoErgo: number) {
  if (evoErgo < 0) return 1
  if (evoErgo < 20) return -0.0096 * evoErgo + 0.819
  if (evoErgo < 44.41) return -0.0051 * evoErgo + 0.73
  if (evoErgo < 155) return -0.00192 * evoErgo + 0.59
  return 0.29
}

/** Seconds of aiming before the arms tire: (85.5/(W + 0.65) + 9.15 + 0.06477·E·0.94) / 1.04 · (1 + 0.004·S). */
export function armStamina(weight: number, ergonomics: number, strength = 50) {
  return (85.5 / (weight + 0.65) + 9.15 + 0.06477 * ergonomics * 0.94) / 1.04 * (1 + 0.004 * strength)
}

/** Distance (m) where every shot still lands in a head: ≈ 279.6 / MOA. */
export function headshotDistance100(moa: number) {
  return moa > 0 ? 279.6 / moa : Infinity
}

/** Distance (m) where 80 % of shots land in a head: 465.445 / MOA. */
export function headshotDistance80(moa: number) {
  return moa > 0 ? 465.445 / moa : Infinity
}

/** What one part does to EvoErgo: EED with it minus EED without it (its ergonomics and its weight). */
export function partEvoErgo(base: { ergonomics: number; weight: number }, part: { ergonomics: number; weight: number }, ergoPenaltyPercent = 0) {
  return evoErgoDelta(base.ergonomics + part.ergonomics, base.weight + part.weight, ergoPenaltyPercent) - evoErgoDelta(base.ergonomics, base.weight, ergoPenaltyPercent)
}

/**
 * «EvoRecoil» of a candidate against what is installed, percent: the felt recoil Reff(x) = 0.8333·V·(1 + x/100) + 16.666
 * of vertical recoil V with Σ recoil modifiers x (percent); (1 − Reff now / Reff candidate) · 100.
 */
export function evoRecoil(recoilVertical: number, sumNowPercent: number, sumCandidatePercent: number) {
  const felt = (x: number) => 0.8333 * recoilVertical * (1 + x / 100) + 16.666
  return (1 - felt(sumNowPercent) / felt(sumCandidatePercent)) * 100
}

/** «R+E/3»: −Σ recoil % + ergonomics / 3 — one number to rank builds by (higher is better). */
export function valueScore(recoilModifierPercent: number, ergonomics: number, ergonomicsDivisor = 3) {
  return -recoilModifierPercent + ergonomics / ergonomicsDivisor
}

/** Muzzle velocity, m/s: the round's initial speed × (100 + Σ part velocity %) / 100. */
export function muzzleVelocity(initialSpeed: number, velocityModifierSum: number) {
  return initialSpeed * (100 + velocityModifierSum) / 100
}

const SIDES = ['left', 'right', 'up', 'down'] as const
const sizeData = new WeakMap<Map<string, GunPart>, boolean>()

/**
 * Inventory size of the assembled weapon in cells, grown the way the game grows it: the bare weapon, plus on each side the
 * largest growth of its ordinary parts (they overlap) and every growth of the forced ones (`increaseSizeForced`). Gives
 * tarkov.dev's `defaultWidth` / `defaultHeight` for the default preset of every weapon (164 of 164 checked, 12.10.2026).
 * Nothing when the catalogue has no part sizes at all (one cached by an older version) or the weapon has no size.
 */
export function weaponSize(parts: GunPart[], weapon: Pick<Weapon, 'width' | 'height'>, catalog: Pick<GunCatalog, 'mods'>): { width?: number; height?: number } {
  let known = sizeData.get(catalog.mods)
  if (known === undefined) {
    known = [...catalog.mods.values()].some((part) => part.increaseSize)
    sizeData.set(catalog.mods, known)
  }
  if (!known || !weapon.width || !weapon.height) return {}
  const grow = { left: 0, right: 0, up: 0, down: 0 }
  const forced = { left: 0, right: 0, up: 0, down: 0 }
  for (const size of parts.flatMap((part) => part.increaseSize ?? [])) {
    for (const side of SIDES) {
      if (size.forced) forced[side] += size[side]
      else grow[side] = Math.max(grow[side], size[side])
    }
  }
  return {
    width: weapon.width + grow.left + grow.right + forced.left + forced.right,
    height: weapon.height + grow.up + grow.down + forced.up + forced.down,
  }
}

/** MOA = centerOfImpact · 35 / (1 + the round's accuracy) · (1 − Σ attachment accuracy). */
export function approximateMoa(centerOfImpact: number, accuracyModifierSum: number, ammoAccuracy = 0) {
  return (centerOfImpact * MOA_PER_CENTER_OF_IMPACT / Math.max(0.1, 1 + ammoAccuracy)) * Math.max(0.1, 1 - accuracyModifierSum)
}

/** What the player can buy from: trader loyalty levels reached and whether the flea market is open (level 15+). */
export interface PurchaseAccess {
  /** Loyalty level of every trader not listed in `traderLevels`. */
  traderLevel: number
  flea: boolean
  /** Loyalty per trader (normalized name: prapor, mechanic, …), e.g. the player's own levels of this mode. */
  traderLevels?: Record<string, number>
  /** Whether a task is completed: offers unlocked by a task (`taskUnlock`) need it. Unknown → the offer counts. */
  taskDone?: (taskId: string) => boolean
}

export const FULL_ACCESS: PurchaseAccess = { traderLevel: 4, flea: true }

/** Whether the player can use this offer under `access` (and why not). */
export function offerAccess(offer: GunOffer, item: Pick<GunPart, 'noFlea'>, access: PurchaseAccess = FULL_ACCESS): { ok: true } | { ok: false; reason: 'flea-closed' | 'no-flea' | 'level' | 'task'; level?: number } {
  if (offer.vendor === 'flea-market') {
    if (item.noFlea) return { ok: false, reason: 'no-flea' }
    return access.flea ? { ok: true } : { ok: false, reason: 'flea-closed' }
  }
  const level = access.traderLevels?.[offer.vendor] ?? access.traderLevel
  if ((offer.minTraderLevel ?? 1) > level) return { ok: false, reason: 'level', level }
  if (offer.taskUnlock && access.taskDone && !access.taskDone(offer.taskUnlock.id)) return { ok: false, reason: 'task' }
  return { ok: true }
}

/** Cheapest offer the player can use: flea (unless the item is flea-banned or the flea is closed) or a trader whose loyalty level is reached. */
export function cheapestOffer(item: Pick<GunPart, 'offers' | 'noFlea'>, access: PurchaseAccess = FULL_ACCESS): GunOffer | undefined {
  return item.offers
    .filter((offer) => offerAccess(offer, item, access).ok)
    .reduce<GunOffer | undefined>((best, offer) => !best || offer.priceRUB < best.priceRUB ? offer : best, undefined)
}

export interface CostLine {
  part: GunPart
  offer?: GunOffer
}

export interface BuildCost {
  total: number
  lines: CostLine[]
  /** Parts nobody sells under the given access (barter/craft only, flea-banned, loyalty too low). */
  unavailable: GunPart[]
}

/** Total cost: the weapon plus every installed part, each from its own cheapest available source. */
export function computeCost(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess = FULL_ACCESS): BuildCost {
  const lines: CostLine[] = [weapon, ...installedParts(build, catalog).map((entry) => entry.part)]
    .map((part) => ({ part, offer: cheapestOffer(part, access) }))
  return {
    total: sum(lines.map((line) => line.offer?.priceRUB ?? 0)),
    lines,
    unavailable: lines.filter((line) => !line.offer).map((line) => line.part),
  }
}

/**
 * What to buy on top of the weapon (owner, 18.10.2026: «в списке покупок не нужно писать стандартные модули, только
 * добавленные поверх оружия»): the installed parts minus the stock build's own parts (counted, so a second identical
 * part still shows), the weapon itself left out.
 */
export function computeExtraCost(build: Build, stock: Build, catalog: Pick<GunCatalog, 'mods'>, access: PurchaseAccess = FULL_ACCESS): BuildCost {
  const left = new Map<string, number>()
  for (const { part } of installedParts(stock, catalog)) left.set(part.id, (left.get(part.id) ?? 0) + 1)
  const added = installedParts(build, catalog).map((entry) => entry.part).filter((part) => {
    const count = left.get(part.id) ?? 0
    if (count > 0) left.set(part.id, count - 1)
    return count === 0
  })
  const lines: CostLine[] = added.map((part) => ({ part, offer: cheapestOffer(part, access) }))
  return { total: sum(lines.map((line) => line.offer?.priceRUB ?? 0)), lines, unavailable: lines.filter((line) => !line.offer).map((line) => line.part) }
}

/** Better/worse direction of each stat for the delta colours (recoil, MOA, weight, cost: lower is better). */
export function deltaTone(stat: 'recoil' | 'ergonomics' | 'moa' | 'weight' | 'cost', delta: number): 'better' | 'worse' | 'same' {
  if (Math.abs(delta) < 1e-9) return 'same'
  const higherIsBetter = stat === 'ergonomics'
  return (delta > 0) === higherIsBetter ? 'better' : 'worse'
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const round2 = (value: number) => Math.round(value * 100) / 100
const round3 = (value: number) => Math.round(value * 1000) / 1000
