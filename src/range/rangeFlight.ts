import { hasBallistics, zeroedTrajectory, type TrajectoryPoint } from '../arsenal/ballistics'
import type { AmmoStats } from '../arsenal/gunTypes'

/** The muzzle velocity of a round from a build: its initial speed × the parts' velocity change (percent). */
export function muzzleSpeed(ammo: AmmoStats, velocityModifierSum = 0) {
  return (ammo.initialSpeed ?? 0) * (1 + velocityModifierSum / 100)
}

/** The trajectory's point at a distance, between its 10 m samples; undefined for a round without flight data. */
export function flightAt(ammo: AmmoStats, velocity: number | undefined, zero: number, distance: number): TrajectoryPoint | undefined {
  const round = { initialSpeed: velocity ?? ammo.initialSpeed ?? 0, bulletMassGrams: ammo.bulletMassGrams ?? 0, bulletDiameterMm: ammo.bulletDiameterMm ?? 0, ballisticCoefficient: ammo.ballisticCoefficient ?? 0, damage: ammo.damage, penetration: ammo.penetration }
  if (!hasBallistics(round)) return undefined
  const points = zeroedTrajectory(round, zero, Math.ceil(distance / 10) * 10 + 10)
  const below = [...points].reverse().find((point) => point.distance <= distance) ?? points[0]
  const above = points.find((point) => point.distance >= distance) ?? points[points.length - 1]
  if (!below || !above) return undefined
  const f = above.distance === below.distance ? 0 : (distance - below.distance) / (above.distance - below.distance)
  const mix = (a: number, b: number) => a + (b - a) * f
  return { distance, drop: mix(below.drop, above.drop), time: mix(below.time, above.time), speed: mix(below.speed, above.speed), energy: mix(below.energy, above.energy), damage: mix(below.damage, above.damage), penetration: mix(below.penetration, above.penetration) }
}
