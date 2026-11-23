/**
 * Where a bullet lands at the range and series of shots for the comparison (pure; see rangeShot.test.ts).
 *
 * Spread: the build's MOA (src/arsenal/buildStats.ts, the game's inspect value) is the group's diameter — 2.9089 cm per MOA at
 * 100 m — and each shot lands around the aim with a normal deviation of a quarter of it, so nearly every shot is inside the
 * group. Recoil in a burst and the sway are estimates of ours (the game's recoil is the camera's movement and the player's
 * control of it): the climb settles at about half a centimetre per point of vertical recoil at 100 m, the side jitter is
 * 0.08 cm per point of horizontal recoil. The drop is the trajectory's against the zero (src/arsenal/ballistics.ts).
 */
import { fireAt, freshBody, normal, cloneKit, type ArmorPiece, type BodyPart, type Collider, type Health, type HitSpot, type PlateZone, type Round, type ShotOutcome } from './rangeModel'
import { hitAt, zoneCentre, type View } from './rangeHitboxes'
import { hitOnFigure, type FigureZone } from './rangeFigures'

export const CM_PER_MOA_100M = 2.9089

export interface AimSetup {
  distance: number
  moa?: number
  spread: boolean
  recoil: boolean
  sway: boolean
  recoilVertical: number
  recoilHorizontal: number
  /** The bullet's height against the line of sight at the distance, cm (negative below). */
  dropCm: number
  /** Where the game's recoil turned the barrel as the bullet left, cm at the target (src/range/rangeRecoil.ts). */
  recoilOffset?: { x: number; y: number }
}

export type Cover = 'none' | 'left' | 'right' | 'low' | 'window'

/** Where the bullet lands for an aim point; `burstIndex`: the shot's place in a burst (0 the first). */
export function landing(aim: { x: number; y: number }, setup: AimSetup, burstIndex: number, random: () => number) {
  const scale = setup.distance / 100
  let { x, y } = aim
  if (setup.spread && setup.moa) {
    const sigma = setup.moa * CM_PER_MOA_100M * scale / 4
    x += normal(random, 0, sigma)
    y += normal(random, 0, sigma)
  }
  if (setup.recoil && burstIndex > 0) {
    y += setup.recoilVertical * 0.5 * scale * (1 - Math.exp(-burstIndex / 2.5))
    x += normal(random, 0, setup.recoilHorizontal * 0.08 * scale * Math.min(1, burstIndex / 3))
  }
  if (setup.recoilOffset) {
    x += setup.recoilOffset.x
    y += setup.recoilOffset.y
  }
  if (setup.sway) {
    x += normal(random, 0, 2.5 * scale)
    y += normal(random, 0, 2.5 * scale)
  }
  return { x, y: y + setup.dropCm }
}

/** Whether a cover in front of the target takes the bullet (seen from the shooter). */
export function behindCover(cover: Cover, x: number, y: number) {
  switch (cover) {
    case 'left': return x < 2
    case 'right': return x > -2
    case 'low': return y < 108 && Math.abs(x) < 80
    case 'window': return y < 118 || y > 186 || Math.abs(x) > 34
    default: return false
  }
}

/** Where the zones of the target are: the schematic figure, or the game's colliders laid on a pictured body (src/range/rangeFigures.ts). */
export interface Geometry {
  hit(view: View, x: number, y: number, plates: ReadonlySet<PlateZone>): HitSpot | undefined
  centre(view: View, collider: Collider): { x: number; y: number } | undefined
}

export const SCHEMATIC: Geometry = { hit: hitAt, centre: zoneCentre }

export function figureGeometry(zones: Partial<Record<View, FigureZone[]>>): Geometry {
  return {
    hit: (view, x, y, plates) => { const list = zones[view]; return list?.length ? hitOnFigure(list, x, y, plates) : hitAt(view, x, y, plates) },
    centre: (view, collider) => {
      const zone = zones[view]?.find((entry) => entry.type === collider && !entry.plate)
      if (!zone) return zoneCentre(view, collider)
      const xs = zone.poly.map(([x]) => x), ys = zone.poly.map(([, y]) => y)
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    },
  }
}

/** The plate zones a kit lays over the body. */
export function kitPlateZones(kit: ArmorPiece[]): Set<PlateZone> {
  return new Set(kit.flatMap((piece) => piece.plates))
}

export interface FiredShot {
  aim: { x: number; y: number }
  point: { x: number; y: number }
  view: View
  /** undefined: a miss; 'cover': the cover took it. */
  spot?: HitSpot
  cover?: boolean
  outcome?: ShotOutcome
}

/** One shot at the range: the landing point, what it meets, and the result on the body and the kit (both changed in place). */
export function shootOnce(kit: ArmorPiece[], body: ReturnType<typeof freshBody>, view: View, aim: { x: number; y: number }, setup: AimSetup, round: Round, cover: Cover, burstIndex: number, random: () => number, geometry: Geometry = SCHEMATIC): FiredShot {
  const point = landing(aim, setup, burstIndex, random)
  if (behindCover(cover, point.x, point.y)) return { aim, point, view, cover: true }
  const spot = geometry.hit(view, point.x, point.y, kitPlateZones(kit))
  if (!spot) return { aim, point, view }
  return { aim, point, view, spot, outcome: fireAt(kit, body, spot, round, random) }
}

/** Where the comparison aims for each zone it lists. */
export const COMPARE_ZONES: Array<{ key: string; ru: string; en: string; collider: Collider; view: View }> = [
  { key: 'thorax', ru: 'Грудь', en: 'Thorax', collider: 'RibcageUp', view: 'front' },
  { key: 'head', ru: 'Лицо', en: 'Face', collider: 'HeadCommon', view: 'front' },
  { key: 'eyes', ru: 'Глаза', en: 'Eyes', collider: 'Eyes', view: 'front' },
  { key: 'top', ru: 'Макушка', en: 'Top of head', collider: 'ParietalHead', view: 'front' },
  { key: 'neck', ru: 'Шея', en: 'Neck', collider: 'NeckFront', view: 'front' },
  { key: 'stomach', ru: 'Живот', en: 'Stomach', collider: 'RibcageLow', view: 'front' },
  { key: 'pelvis', ru: 'Пах', en: 'Pelvis', collider: 'Pelvis', view: 'front' },
  { key: 'arms', ru: 'Руки', en: 'Arms', collider: 'LeftUpperArm', view: 'front' },
  { key: 'legs', ru: 'Ноги', en: 'Legs', collider: 'LeftThigh', view: 'front' },
  { key: 'back', ru: 'Спина', en: 'Back', collider: 'SpineTop', view: 'back' },
]

export interface SeriesResult {
  /** Shots to kill, one per series run (Infinity: not killed within the limit). */
  shots: number[]
  mean: number
  median: number
  min: number
  max: number
  /** Share of runs killed within the limit. */
  killedShare: number
  /** Share of hits that went through to the body. */
  throughShare: number
}

export const SHOT_LIMIT = 150

/**
 * `runs` characters shot at one zone until dead (or SHOT_LIMIT shots), each fresh in a fresh kit. Spread and recoil as set
 * (all shots one burst when recoil is on and the fire mode is automatic is left to the caller: `burst` gives the burst length).
 */
export function series(kit: ArmorPiece[], health: Health, blackedOut: BodyPart[], zone: { collider: Collider; view: View }, round: Round, setup: AimSetup, runs: number, random: () => number, burst = 1, geometry: Geometry = SCHEMATIC): SeriesResult {
  const aim = geometry.centre(zone.view, zone.collider) ?? { x: 0, y: 135 }
  const shots: number[] = []
  let hits = 0, through = 0
  for (let run = 0; run < runs; run++) {
    const pieces = cloneKit(kit)
    const body = freshBody(health, blackedOut)
    let count = 0
    while (!body.dead && count < SHOT_LIMIT) {
      const fired = shootOnce(pieces, body, zone.view, aim, setup, round, 'none', burst > 1 ? count % burst : 0, random, geometry)
      count++
      if (fired.outcome) { hits++; if (fired.outcome.penetrated) through++ }
    }
    shots.push(body.dead ? count : Infinity)
  }
  const finite = shots.filter(Number.isFinite).sort((a, b) => a - b)
  const killedShare = finite.length / Math.max(1, runs)
  return {
    shots,
    mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : Infinity,
    median: finite.length ? finite[Math.floor((finite.length - 1) / 2)]! : Infinity,
    min: finite[0] ?? Infinity,
    max: finite[finite.length - 1] ?? Infinity,
    killedShare,
    throughShare: hits ? through / hits : 0,
  }
}

/** Seconds from the first shot to the kill: the shots between at the fire rate, plus the flight. */
export function timeToKill(shots: number, fireRate: number, flightTime = 0) {
  if (!Number.isFinite(shots) || fireRate <= 0) return Infinity
  return (shots - 1) * 60 / fireRate + flightTime
}
