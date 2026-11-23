import { hasBallistics, SIGHT_HEIGHT, zeroedTrajectory, type TrajectoryPoint } from '../arsenal/ballistics'
import type { AmmoStats } from '../arsenal/gunTypes'

/** The muzzle velocity of a round from a build: its initial speed × the parts' velocity change (percent). */
export function muzzleSpeed(ammo: AmmoStats, velocityModifierSum = 0) {
  return (ammo.initialSpeed ?? 0) * (1 + velocityModifierSum / 100)
}

/**
 * How the sight is zeroed: with which round (absent: the one fired; owner, 23.11.2026: «пристрелка должна меняться в зависимости от
 * патрона. Она должна быть не везде одинаковая» — the game itself zeroes with the weapon's default round) and how high the line of
 * sight is over the bore, metres (absent: the usual 6.858 cm; the build's own: src/range/rangeSight.ts).
 */
export interface Zeroing { zeroAmmo?: AmmoStats; sightHeight?: number }

/** The round as the solver takes it, and the one the sight was zeroed with, both at the build's velocity change. */
function solverRounds(ammo: AmmoStats, velocity: number | undefined, zeroAmmo: AmmoStats | undefined) {
  const as = (entry: AmmoStats, speed: number) => ({ initialSpeed: speed, bulletMassGrams: entry.bulletMassGrams ?? 0, bulletDiameterMm: entry.bulletDiameterMm ?? 0, ballisticCoefficient: entry.ballisticCoefficient ?? 0, damage: entry.damage, penetration: entry.penetration })
  const round = as(ammo, velocity ?? ammo.initialSpeed ?? 0)
  if (!hasBallistics(round)) return undefined
  const factor = ammo.initialSpeed ? round.initialSpeed / ammo.initialSpeed : 1
  const sighted = zeroAmmo && zeroAmmo.id !== ammo.id ? as(zeroAmmo, (zeroAmmo.initialSpeed ?? 0) * factor) : undefined
  return { round, zeroRound: sighted && hasBallistics(sighted) ? sighted : round }
}

/**
 * The bullet's flight to a distance: the trajectory's 10 m samples before it and the point at the distance itself (the tracer of a
 * single shot, owner 23.11.2026: «показывай траекторию полета пули в реальном времени… с соответствующей скоростью»).
 */
export function flightPath(ammo: AmmoStats, velocity: number | undefined, zero: number, distance: number, zeroing: Zeroing = {}): TrajectoryPoint[] | undefined {
  const rounds = solverRounds(ammo, velocity, zeroing.zeroAmmo)
  if (!rounds) return undefined
  const end = flightAt(ammo, velocity, zero, distance, zeroing)
  if (!end) return undefined
  return [...zeroedTrajectory(rounds.round, zero, Math.ceil(distance / 10) * 10 + 10, zeroing.sightHeight ?? SIGHT_HEIGHT, rounds.zeroRound).filter((point) => point.distance > 0 && point.distance < distance), end]
}

/** The trajectory's point at a distance, between its 10 m samples; undefined for a round without flight data. */
export function flightAt(ammo: AmmoStats, velocity: number | undefined, zero: number, distance: number, zeroing: Zeroing = {}): TrajectoryPoint | undefined {
  const rounds = solverRounds(ammo, velocity, zeroing.zeroAmmo)
  if (!rounds) return undefined
  const points = zeroedTrajectory(rounds.round, zero, Math.ceil(distance / 10) * 10 + 10, zeroing.sightHeight ?? SIGHT_HEIGHT, rounds.zeroRound)
  const below = [...points].reverse().find((point) => point.distance <= distance) ?? points[0]
  const above = points.find((point) => point.distance >= distance) ?? points[points.length - 1]
  if (!below || !above) return undefined
  const f = above.distance === below.distance ? 0 : (distance - below.distance) / (above.distance - below.distance)
  const mix = (a: number, b: number) => a + (b - a) * f
  return { distance, drop: mix(below.drop, above.drop), time: mix(below.time, above.time), speed: mix(below.speed, above.speed), energy: mix(below.energy, above.energy), damage: mix(below.damage, above.damage), penetration: mix(below.penetration, above.penetration) }
}
