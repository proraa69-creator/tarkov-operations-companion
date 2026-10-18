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
 * Trajectory — the game's point-mass G1 solver (owner, 17.10.2026: «возьми от туда баллистику патронов… таблицы падения
 * пули»; the model db4tarkov and tarkovgunsmith use): the round's mass, diameter and G1 ballistic coefficient
 * (json.tarkov.dev `bulletMassGrams`, `bulletDiameterMilimeters`, `ballisticCoeficient`), its initial speed (× the
 * weapon's velocity change), air ρ = 1.2 kg/m³, g = 9.81 m/s², steps of 0.01 s. Damage and penetration fall to
 * (0.5 + 0.5·v/v0) of their values. The previous exponential speed model (Cd 0.3) is gone with this.
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

/** The game's G1 drag table: drag coefficient at Mach 0 … 5 (79 points; uneven spacing above Mach 0.6). */
export const G1_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.2629], [0.05, 0.2558], [0.1, 0.2487], [0.15, 0.2413], [0.2, 0.2344], [0.25, 0.2278], [0.3, 0.2214], [0.35, 0.2155],
  [0.4, 0.2104], [0.45, 0.2061], [0.5, 0.2032], [0.55, 0.202], [0.6, 0.2034], [0.7, 0.2165], [0.725, 0.223], [0.75, 0.2313],
  [0.775, 0.2417], [0.8, 0.2546], [0.825, 0.2706], [0.85, 0.2901], [0.875, 0.3136], [0.9, 0.3415], [0.925, 0.3734], [0.95, 0.4084],
  [0.975, 0.4448], [1, 0.4805], [1.025, 0.5136], [1.05, 0.5427], [1.075, 0.5677], [1.1, 0.5883], [1.125, 0.6053], [1.15, 0.6191],
  [1.2, 0.6393], [1.25, 0.6518], [1.3, 0.6589], [1.35, 0.6621], [1.4, 0.6625], [1.45, 0.6607], [1.5, 0.6573], [1.55, 0.6528],
  [1.6, 0.6474], [1.65, 0.6413], [1.7, 0.6347], [1.75, 0.628], [1.8, 0.621], [1.85, 0.6141], [1.9, 0.6072], [1.95, 0.6003],
  [2, 0.5934], [2.05, 0.5867], [2.1, 0.5804], [2.15, 0.5743], [2.2, 0.5685], [2.25, 0.563], [2.3, 0.5577], [2.35, 0.5527],
  [2.4, 0.5481], [2.45, 0.5438], [2.5, 0.5397], [2.6, 0.5325], [2.7, 0.5264], [2.8, 0.5211], [2.9, 0.5168], [3, 0.5133],
  [3.1, 0.5105], [3.2, 0.5084], [3.3, 0.5067], [3.4, 0.5054], [3.5, 0.504], [3.6, 0.503], [3.7, 0.5022], [3.8, 0.5016],
  [3.9, 0.501], [4, 0.5006], [4.2, 0.4998], [4.4, 0.4995], [4.6, 0.4992], [4.8, 0.499], [5, 0.4988],
]

export const SPEED_OF_SOUND = 343
export const GRAVITY = 9.81
export const AIR_DENSITY = 1.2
export const TIME_STEP = 0.01
/** The sight line above the bore, metres (the game's value). */
export const SIGHT_HEIGHT = 0.06858
const MAX_STEPS = 2000
/** Points are recorded every this many metres. */
export const SAMPLE_STEP = 10

/**
 * Drag coefficient for a speed (m/s), looked up the way the game does: the index i = ⌊Mach / 0.05⌋ as if the table were
 * evenly spaced, the value between rows i−1 and i (by their Mach numbers), the last row above index 78.
 */
export function g1DragCoefficient(speed: number) {
  const mach = Math.max(0, speed) / SPEED_OF_SOUND
  const index = Math.floor(mach / 0.05)
  if (index >= G1_TABLE.length - 1) return G1_TABLE[G1_TABLE.length - 1]![1]
  if (index <= 0) return G1_TABLE[0]![1]
  const [m0, c0] = G1_TABLE[index - 1]!
  const [m1, c1] = G1_TABLE[index]!
  const t = clamp((mach - m0) / (m1 - m0), 0, 1)
  return c0 + (c1 - c0) * t
}

export interface BulletInput {
  /** m/s at the muzzle (the round's initial speed × the weapon's velocity change). */
  initialSpeed: number
  bulletMassGrams: number
  bulletDiameterMm: number
  ballisticCoefficient: number
  damage?: number
  penetration?: number
}

export interface TrajectoryPoint {
  /** Metres downrange. */
  distance: number
  /** Height against the line of sight, cm (negative: below it). */
  drop: number
  /** Seconds since the shot. */
  time: number
  /** m/s */
  speed: number
  /** Joules: ½·m·v². */
  energy: number
  damage: number
  penetration: number
}

/** Whether the round carries what the solver needs. */
export function hasBallistics(round: Partial<BulletInput>): round is BulletInput {
  return Boolean(round.initialSpeed && round.initialSpeed > 0 && round.bulletMassGrams && round.bulletMassGrams > 0
    && round.bulletDiameterMm && round.bulletDiameterMm > 0 && round.ballisticCoefficient && round.ballisticCoefficient > 0)
}

/**
 * Flies the bullet from the bore at `angleDeg` above level and records a point every SAMPLE_STEP metres up to
 * `maxDistance` (heights in metres against the bore, not yet against the sight line).
 */
function fly(round: BulletInput, angleDeg: number, maxDistance: number) {
  const mass = round.bulletMassGrams / 1000
  const diameter = round.bulletDiameterMm / 1000
  // Form factor: the sectional density (lb/in², from kg and m) over the G1 coefficient; ρ·A of the bullet.
  const form = (mass * 0.0014223) / (diameter * diameter * round.ballisticCoefficient)
  const rhoArea = AIR_DENSITY * Math.PI * diameter * diameter / 4
  const angle = angleDeg * Math.PI / 180
  let x = 0, y = 0, t = 0
  let vx = Math.cos(angle) * round.initialSpeed, vy = Math.sin(angle) * round.initialSpeed
  const points: Array<{ distance: number; y: number; time: number; speed: number; along: number }> = [{ distance: 0, y: 0, time: 0, speed: round.initialSpeed, along: round.initialSpeed }]
  let next = SAMPLE_STEP
  for (let step = 0; step < MAX_STEPS && next <= maxDistance; step++) {
    const speed = Math.hypot(vx, vy)
    const drag = rhoArea * (-g1DragCoefficient(speed) * form) * speed * speed / (2 * mass)
    const ax = drag * vx / speed
    const ay = -GRAVITY + drag * vy / speed
    const nx = x + vx * TIME_STEP + ax * TIME_STEP * TIME_STEP / 2
    const ny = y + vy * TIME_STEP + ay * TIME_STEP * TIME_STEP / 2
    const nvx = vx + ax * TIME_STEP, nvy = vy + ay * TIME_STEP
    while (next <= nx && next <= maxDistance) {
      const f = (next - x) / (nx - x)
      points.push({ distance: next, y: y + (ny - y) * f, time: t + TIME_STEP * f, speed: Math.hypot(vx + (nvx - vx) * f, vy + (nvy - vy) * f), along: vx + (nvx - vx) * f })
      next += SAMPLE_STEP
    }
    x = nx; y = ny; vx = nvx; vy = nvy; t += TIME_STEP
  }
  return points
}

/**
 * The trajectory zeroed at `zero` metres, the game's way: a level shot gives the drop at the zero distance, the bore is
 * raised by atan((|drop| + sight height) / zero), and every height is taken against the height at the zero distance —
 * 0 there, −6.858 cm at the muzzle. Points every 10 m up to `maxDistance` (damage and penetration × (0.5 + 0.5·v/v0)).
 */
export function zeroedTrajectory(round: BulletInput, zero = 50, maxDistance = 600, sightHeight = SIGHT_HEIGHT): TrajectoryPoint[] {
  const reach = Math.max(maxDistance, zero)
  const level = fly(round, 0, zero)
  const dropAtZero = level.find((point) => point.distance === zero)?.y ?? 0
  const angle = Math.atan((Math.abs(dropAtZero) + sightHeight) / zero) * 180 / Math.PI
  const shot = fly(round, angle, reach)
  const atZero = shot.find((point) => point.distance === zero)?.y ?? sightHeight
  const mass = round.bulletMassGrams / 1000
  return shot.filter((point) => point.distance <= maxDistance).map((point) => {
    const keep = 0.5 + 0.5 * clamp(point.along / round.initialSpeed, 0, 1)
    return {
      distance: point.distance,
      drop: (point.y - atZero) * 100,
      time: point.time,
      speed: point.speed,
      energy: 0.5 * mass * point.speed * point.speed,
      damage: (round.damage ?? 0) * keep,
      penetration: (round.penetration ?? 0) * keep,
    }
  })
}

/** The points at the given distances (multiples of 10 m). */
export function trajectoryAt(points: TrajectoryPoint[], distances: number[]) {
  return distances.map((distance) => points.find((point) => point.distance === distance)).filter((point): point is TrajectoryPoint => Boolean(point))
}

/** cm → inches for the imperial view. */
export const CM_PER_INCH = 2.54

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
