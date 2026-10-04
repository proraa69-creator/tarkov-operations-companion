import { describe, expect, it } from 'vitest'
import { body, cape } from '../testModels'
import { rigFromMesh, type PhysicsRig } from './rig'
import { BossPhysics } from './sim'

/** The synthetic model: a body column 1 tall with a cape fused to its back at shoulder height. */
function model() {
  const positions: number[] = [], indices: number[] = []
  const column = body(positions, indices)
  const sheet = cape(positions, indices, column)
  const rig = rigFromMesh(new Float32Array(positions), new Uint32Array(indices))
  if (!rig) throw new Error('no rig')
  return { rig, column, sheet }
}

/** The viewer's world matrix: the model 1 unit tall on the floor, turned by yaw, moved by x (world units). */
function matrix(rig: PhysicsRig, yaw: number, x = 0): number[] {
  const c = Math.cos(yaw), s = Math.sin(yaw), [ox, oy, oz] = rig.origin
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x - (c * ox + s * oz), -oy, -(-s * ox + c * oz), 1]
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c) }

/** Turns at `speed` rad/s for a second (with a short speed-up and an abrupt stop), then stands still; returns the peak. */
function turn(physics: BossPhysics, speed: number, fps: number, seconds = 5) {
  physics.reset()
  let yaw = 0, peak = 0
  const dt = 1 / fps
  for (let frame = 0; frame * dt <= seconds; frame++) {
    const t = frame * dt
    yaw += speed * (t < 0.2 ? smooth(t / 0.2) : t < 1 ? 1 : t < 1.12 ? 1 - smooth((t - 1) / 0.12) : 0) * dt
    physics.step(frame === 0 ? 0 : dt, matrix(physics.rig, yaw))
    peak = Math.max(peak, physics.metrics().offset)
  }
  return { peak, end: physics.metrics() }
}

describe('secondary physics', () => {
  it('rigs the cape as particles pinned at its seam; the body follows bone 0 alone', () => {
    const { rig, column } = model()
    expect(rig.particles).toBeGreaterThan(10)
    let pins = 0
    for (let p = 0; p < rig.particles; p++) if (rig.pinned[p]) { pins++; expect(rig.rest[p * 3 + 1]).toBeGreaterThan(1.3) }
    expect(pins).toBeGreaterThan(0)
    for (let i = column.from; i < column.to; i++) {
      expect(rig.skinIndex[i * 4]).toBe(0)
      expect(rig.skinWeight[i * 4]).toBe(1)
    }
  })

  it('rests exactly as modelled and falls asleep', () => {
    const { rig } = model()
    const physics = new BossPhysics(rig)
    for (let frame = 0; frame < 180; frame++) physics.step(frame === 0 ? 0 : 1 / 60, matrix(rig, 0.3))
    expect(physics.metrics().offset).toBe(0)
    expect(physics.sleeping).toBe(true)
  })

  it('lags behind a turn, swings, and settles back to rest after an abrupt stop', () => {
    const physics = new BossPhysics(model().rig)
    const { peak, end } = turn(physics, 3, 60)
    expect(peak).toBeGreaterThan(0.02)
    expect(peak).toBeLessThan(0.3)
    expect(end.finite).toBe(true)
    expect(end.offset).toBeLessThan(0.002)
    expect(physics.sleeping).toBe(true)
  })

  it('reacts alike to turns either way', () => {
    const physics = new BossPhysics(model().rig)
    const left = turn(physics, 3, 60, 2).peak, right = turn(physics, -3, 60, 2).peak
    expect(Math.abs(left - right) / Math.max(left, right)).toBeLessThan(0.15)
  })

  it('moves the same at 30, 60 and 144 frames per second', () => {
    const physics = new BossPhysics(model().rig)
    const peaks = [30, 60, 144].map((fps) => turn(physics, 3, fps, 2).peak)
    for (const peak of peaks) expect(Math.abs(peak - peaks[1]) / peaks[1]).toBeLessThan(0.05)
  })

  it('takes no inertia from a teleport', () => {
    const { rig } = model()
    const physics = new BossPhysics(rig)
    let fastest = 0
    for (let frame = 0; frame < 120; frame++) {
      physics.step(frame === 0 ? 0 : 1 / 60, matrix(rig, 0, frame >= 60 ? 3 : 0))
      fastest = Math.max(fastest, physics.metrics().speed)
    }
    expect(fastest).toBeLessThan(0.01)
  })

  it('writes finite bone matrices with the body bone the identity', () => {
    const { rig } = model()
    const physics = new BossPhysics(rig)
    const bones = new Float32Array(physics.boneCount * 16)
    for (let frame = 0; frame < 40; frame++) physics.step(frame === 0 ? 0 : 1 / 60, matrix(rig, frame * 0.05))
    physics.writeBones(bones)
    expect(bones.every(Number.isFinite)).toBe(true)
    expect([...bones.subarray(0, 16)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  })
})
