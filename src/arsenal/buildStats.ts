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
 * converted to MOA (1 MOA ≈ 2.9089 cm at 100 m, tarkov.dev convention) and scaled by (1 − Σ accuracyModifier).
 * The game's real dispersion also depends on ammo deviation curves and skills, which are not modelled.
 */
export interface BuildStats {
  recoilVertical: number
  recoilHorizontal: number
  ergonomics: number
  /** Σ recoil modifiers, as a fraction (−0.25 = −25 %). */
  recoilModifierSum: number
  accuracyModifierSum: number
  /** Approximate MOA; undefined when the data has no centre of impact. */
  moa?: number
  weight: number
  partCount: number
}

export const CM_PER_MOA_AT_100M = 2.9089

export function computeStats(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, ammo?: AmmoStats): BuildStats {
  const parts = installedParts(build, catalog).map((entry) => entry.part)
  const recoilModifierSum = sum(parts.map((part) => part.recoilModifier)) + (ammo?.recoilModifier ?? 0)
  const accuracyModifierSum = sum(parts.map((part) => part.accuracyModifier)) + (ammo?.accuracyModifier ?? 0)
  const factor = Math.max(0, 1 + recoilModifierSum)
  const barrel = parts.find((part) => part.centerOfImpact !== undefined)
  const centerOfImpact = barrel?.centerOfImpact ?? weapon.weaponCenterOfImpact
  return {
    recoilVertical: Math.round(weapon.recoilVertical * factor),
    recoilHorizontal: Math.round(weapon.recoilHorizontal * factor),
    ergonomics: clamp(Math.round(weapon.ergonomics + sum(parts.map((part) => part.ergonomics))), 0, 100),
    recoilModifierSum,
    accuracyModifierSum,
    moa: centerOfImpact ? round2(approximateMoa(centerOfImpact, accuracyModifierSum)) : undefined,
    weight: round3(weapon.weight + sum(parts.map((part) => part.weight))),
    partCount: parts.length,
  }
}

export function approximateMoa(centerOfImpact: number, accuracyModifierSum: number) {
  return (centerOfImpact * 100 / CM_PER_MOA_AT_100M) * Math.max(0.1, 1 - accuracyModifierSum)
}

/** What the player can buy from: trader loyalty levels reached and whether the flea market is open (level 15+). */
export interface PurchaseAccess {
  traderLevel: number
  flea: boolean
}

export const FULL_ACCESS: PurchaseAccess = { traderLevel: 4, flea: true }

/** Cheapest offer the player can use: flea (unless the item is flea-banned or the flea is closed) or a trader whose loyalty level is reached. */
export function cheapestOffer(item: Pick<GunPart, 'offers' | 'noFlea'>, access: PurchaseAccess = FULL_ACCESS): GunOffer | undefined {
  return item.offers
    .filter((offer) => offer.vendor === 'flea-market'
      ? access.flea && !item.noFlea
      : (offer.minTraderLevel ?? 1) <= access.traderLevel)
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
