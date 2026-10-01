/**
 * Ballistics math for «Баллистика 2.0» (pure functions, see ballistics.test.ts).
 *
 * Armor penetration — Escape from Tarkov Wiki, «Ballistics» (https://escapefromtarkov.fandom.com/wiki/Ballistics):
 *  - an armor class is worth `class × 10` points of resistance (class 4 → 40);
 *  - with durability d (0–100 %) the effective resistance is a = (121 − 5000 / (45 + 2d)) · resistance / 100;
 *  - penetration chance for penetration power p:
 *      p ≥ a            → 100 + p / (0.9a − p)   (90 % at p = a, approaching 100 %)
 *      a − 15 < p < a   → 0.4 · (a − p − 15)²
 *      otherwise        → 0
 *  - rule of thumb from the same page: ammo whose penetration is at least `class × 10` goes through that class
 *    reliably while the armor is fresh.
 * Durability loss between shots is not modelled (it depends on the armor material and max durability), so
 * «shots to penetrate» is the expected value at a fixed durability: real armor degrades and lets later shots
 * through sooner, which makes these numbers an upper bound.
 *
 * Damage drop-off — approximate, NOT the game's own solver: tarkov.dev gives `initialSpeed` (m/s) and
 * `ballisticCoeficient` (G1-style, lb/in²). We use a constant-drag-coefficient model
 *   dv/dt = −ρ·Cd·v² / (2·BC·703.07)   ⇒   v(x) = v0 · exp(−k·x),  k = ρ·Cd / (2·BC·703.07)
 * with sea-level air ρ = 1.225 kg/m³ and Cd = 0.3, and scale damage and penetration linearly with v(x)/v0.
 * Barrel length, weapon speed modifiers and the game's speed thresholds are ignored.
 */

export const ARMOR_CLASSES = [1, 2, 3, 4, 5, 6] as const
export type ArmorClass = (typeof ARMOR_CLASSES)[number]

/** Armor resistance points for a class (wiki: class × 10). */
export function armorResistance(armorClass: number) {
  return armorClass * 10
}

/** Effective resistance at a durability percentage (wiki formula). */
export function effectiveResistance(armorClass: number, durabilityPercent = 100) {
  const d = clamp(durabilityPercent, 0, 100)
  return (121 - 5000 / (45 + 2 * d)) * armorResistance(armorClass) / 100
}

/** Chance (0–1) that one shot with `penetration` goes through armor of `armorClass` at `durabilityPercent`. */
export function penetrationChance(penetration: number, armorClass: number, durabilityPercent = 100) {
  const p = Math.max(0, penetration)
  const a = effectiveResistance(armorClass, durabilityPercent)
  let percent: number
  if (p >= a) percent = 100 + p / (0.9 * a - p)
  else if (p > a - 15) percent = 0.4 * (a - p - 15) ** 2
  else percent = 0
  return clamp(percent, 0, 100) / 100
}

/** Expected number of shots until the first penetration (geometric distribution, fixed durability); Infinity if 0 %. */
export function expectedShotsToPenetrate(penetration: number, armorClass: number, durabilityPercent = 100) {
  const chance = penetrationChance(penetration, armorClass, durabilityPercent)
  return chance > 0 ? 1 / chance : Infinity
}

/** Shots needed for at least `confidence` probability of one penetration (fixed durability); Infinity if 0 %. */
export function shotsForConfidence(penetration: number, armorClass: number, durabilityPercent = 100, confidence = 0.9) {
  const chance = penetrationChance(penetration, armorClass, durabilityPercent)
  if (chance <= 0) return Infinity
  if (chance >= 1) return 1
  return Math.max(1, Math.ceil(Math.log(1 - confidence) / Math.log(1 - chance)))
}

/** Highest class the ammo beats by the wiki rule of thumb (penetration ≥ class × 10); 0 when below class 1. */
export function effectiveArmorClass(penetration: number) {
  let best = 0
  for (const armorClass of ARMOR_CLASSES) if (penetration >= armorResistance(armorClass)) best = armorClass
  return best
}

export interface ArmorEffectivenessRow {
  armorClass: ArmorClass
  chance: number
  expectedShots: number
  shotsFor90: number
}

/** One row per armor class 1–6 for the effectiveness table. */
export function armorEffectiveness(penetration: number, durabilityPercent = 100): ArmorEffectivenessRow[] {
  return ARMOR_CLASSES.map((armorClass) => ({
    armorClass,
    chance: penetrationChance(penetration, armorClass, durabilityPercent),
    expectedShots: expectedShotsToPenetrate(penetration, armorClass, durabilityPercent),
    shotsFor90: shotsForConfidence(penetration, armorClass, durabilityPercent, 0.9),
  }))
}

export const AIR_DENSITY = 1.225
export const DRAG_COEFFICIENT = 0.3
/** lb/in² → kg/m² */
export const BC_TO_SI = 703.07

/** Drag constant k (1/m) of the exponential speed model; 0 when the coefficient is unknown. */
export function dragConstant(ballisticCoefficient: number | undefined) {
  if (!ballisticCoefficient || ballisticCoefficient <= 0) return 0
  return (AIR_DENSITY * DRAG_COEFFICIENT) / (2 * ballisticCoefficient * BC_TO_SI)
}

/** Approximate projectile speed (m/s) after `distance` metres. */
export function speedAtDistance(initialSpeed: number, ballisticCoefficient: number | undefined, distance: number) {
  return initialSpeed * Math.exp(-dragConstant(ballisticCoefficient) * Math.max(0, distance))
}

export interface DropOffPoint {
  distance: number
  speed: number
  damage: number
  penetration: number
}

export interface DropOffInput {
  damage: number
  penetration: number
  initialSpeed?: number
  ballisticCoefficient?: number
}

/** Approximate damage / penetration at `distance` (both scale with v / v0). Without speed data nothing drops. */
export function dropOffAt(ammo: DropOffInput, distance: number): DropOffPoint {
  const v0 = ammo.initialSpeed ?? 0
  if (v0 <= 0 || !ammo.ballisticCoefficient) {
    return { distance, speed: v0, damage: ammo.damage, penetration: ammo.penetration }
  }
  const speed = speedAtDistance(v0, ammo.ballisticCoefficient, distance)
  const ratio = speed / v0
  return { distance, speed, damage: ammo.damage * ratio, penetration: ammo.penetration * ratio }
}

/** Samples the drop-off curve from 0 to `maxDistance` metres every `step` metres. */
export function dropOffCurve(ammo: DropOffInput, maxDistance = 600, step = 50): DropOffPoint[] {
  const points: DropOffPoint[] = []
  for (let distance = 0; distance <= maxDistance; distance += step) points.push(dropOffAt(ammo, distance))
  return points
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
