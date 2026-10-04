// Checks the boss models' secondary physics (src/gallery/physics) on the real models, in Node: run through
// physics-check.mjs. For every model: the rig (particles, pins, links, pieces); the rest pose (exact, falls asleep);
// turns both ways with an abrupt stop; walking with an abrupt stop; the same turn at 30, 60 and 144 fps; a teleport;
// and that the body, weapons and rigid gear follow the body alone (all their weight on bone 0, the identity).
// Env: PHYSICS_DEBUG=1 (the particles furthest from rest after a turn, the most stretched link), PHYSICS_TRACE=1
// (offset/speed/piece swing every 0.25 s of a turn), PHYSICS_ITERATIONS / PHYSICS_HZ / PHYSICS_NOSLEEP (settings).
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { readGlbMesh } from './glb'
import { BOSS_SWAY_HINTS } from '../../src/gallery/bossSwayHints'
import { KIND, computeSwayWeights } from '../../src/gallery/swayWeights'
import { buildPhysicsRig, sampleSdf, type PhysicsRig } from '../../src/gallery/physics/rig'
import { BossPhysics, type PhysicsMetrics } from '../../src/gallery/physics/sim'

interface Pose { yaw: number; x: number; y: number; z: number }
type Motion = (t: number, dt: number) => Pose

/** World matrix like the viewer's: centred on the feet, 1 unit tall, turned by yaw about +y, moved by x, y, z. */
function worldMatrix(rig: PhysicsRig, height: number, pose: Pose): number[] {
  const s = 1 / height, c = Math.cos(pose.yaw), n = Math.sin(pose.yaw)
  const [ox, oy, oz] = rig.origin
  return [
    s * c, 0, -s * n, 0,
    0, s, 0, 0,
    s * n, 0, s * c, 0,
    pose.x - s * (c * ox + n * oz), pose.y - s * oy, pose.z - s * (-n * ox + c * oz), 1,
  ]
}

const METRES = 1.8 // world units are model heights

interface Run { peak: PhysicsMetrics; after: number; settle: number; slept: boolean; ms: number }

/** Plays a motion for `seconds` at `fps`; the stop is at `stopAt` s (settling is timed from there). */
function play(sim: BossPhysics, height: number, motion: Motion, seconds: number, fps: number, stopAt: number): Run {
  sim.reset()
  const dt = 1 / fps
  const peak: PhysicsMetrics = { offset: 0, speed: 0, stretch: 0, strain: 0, penetration: 0, pieceAngle: 0, finite: true }
  let after = 0, settle = -1, slept = false, ms = 0
  const bones = new Float32Array(sim.boneCount * 16)
  for (let frame = 0, t = 0; t <= seconds; frame++, t = frame * dt) {
    const matrix = worldMatrix(sim.rig, height, motion(t, dt))
    const started = performance.now()
    const awake = sim.step(frame === 0 ? 0 : dt, matrix)
    sim.writeBones(bones)
    ms += performance.now() - started
    const m = sim.metrics()
    peak.offset = Math.max(peak.offset, m.offset); peak.speed = Math.max(peak.speed, m.speed)
    peak.stretch = Math.max(peak.stretch, m.stretch); peak.strain = Math.max(peak.strain, m.strain)
    peak.penetration = Math.max(peak.penetration, m.penetration)
    peak.pieceAngle = Math.max(peak.pieceAngle, m.pieceAngle); peak.finite &&= m.finite && bones.every(Number.isFinite)
    if (Math.abs(t - (stopAt + 0.5)) < dt / 2) after = m.offset
    if (t > stopAt && settle < 0 && m.offset < 0.004 && m.speed < 0.02 && m.pieceAngle < 0.2) settle = t - stopAt
    if (!awake) slept = true
  }
  return { peak, after, settle, slept, ms }
}

/** Turning at `speed` rad/s: speeds up in 0.2 s, turns for 0.8 s, stops in 0.12 s. */
function turning(speed: number): Motion {
  let yaw = 0
  return (t, dt) => {
    const ramp = t < 0.2 ? smooth(t / 0.2) : t < 1 ? 1 : t < 1.12 ? 1 - smooth((t - 1) / 0.12) : 0
    yaw += speed * ramp * dt
    return { yaw, x: 0, y: 0, z: 0 }
  }
}

/** Walking forward at 1.4 m/s with the step's bob and sway for 3 s, then stopping in 0.25 s. */
function walking(): Motion {
  let z = 0
  return (t, dt) => {
    const go = t < 0.5 ? smooth(t / 0.5) : t < 3.5 ? 1 : t < 3.75 ? 1 - smooth((t - 3.5) / 0.25) : 0
    z += (1.4 / METRES) * go * dt
    const phase = t * Math.PI * 2 * 1.8
    return { yaw: 0, x: (0.02 / METRES) * Math.sin(phase / 2) * go, y: (0.025 / METRES) * Math.sin(phase) * go, z }
  }
}

/** PHYSICS_DEBUG=1: the particles furthest from rest 1.5 s after a turn stopped, and what holds them there. */
function worst(sim: BossPhysics, height: number, key: string) {
  const motion = turning(3)
  sim.reset()
  const dt = 1 / 60
  let before = new Float64Array(0)
  const { rig } = sim, x = sim.positions
  let peak = { stretch: 0, link: -1, t: 0, a: [] as number[], b: [] as number[] }
  for (let frame = 0; frame * dt <= 5.02; frame++) {
    if (frame * dt > 5) before = Float64Array.from(sim.positions)
    sim.step(frame === 0 ? 0 : dt, worldMatrix(sim.rig, height, motion(frame * dt, dt)))
    for (let l = 0; l < rig.links.length / 2; l++) {
      const a = rig.links[l * 2] * 3, b = rig.links[l * 2 + 1] * 3
      const was = Math.hypot(rig.rest[a] - rig.rest[b], rig.rest[a + 1] - rig.rest[b + 1], rig.rest[a + 2] - rig.rest[b + 2])
      const stretch = Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2]) / was - 1
      if (stretch > peak.stretch) peak = { stretch, link: l, t: frame * dt, a: [...x.subarray(a, a + 3)], b: [...x.subarray(b, b + 3)] }
    }
  }
  if (peak.link >= 0) {
    const describe = (p: number) => ({ p, type: rig.type[p], mob: +rig.mobility[p].toFixed(2), pinned: rig.pinned[p], tether: rig.tether[p], along: +rig.tetherLength[p].toFixed(3),
      rest: [...rig.rest.subarray(p * 3, p * 3 + 3)].map((v) => +v.toFixed(3)), restSdf: +rig.restDistance[p].toFixed(3) })
    const a = rig.links[peak.link * 2], b = rig.links[peak.link * 2 + 1]
    console.log(key, 'most stretched link', JSON.stringify({ stretch: +peak.stretch.toFixed(2), t: +peak.t.toFixed(2), a: describe(a), b: describe(b),
      at: [peak.a.map((v) => +v.toFixed(3)), peak.b.map((v) => +v.toFixed(3))] }))
  }
  const rows = []
  for (let i = 0; i < rig.particles; i++) {
    if (rig.pinned[i]) continue
    const i3 = i * 3
    const offset = Math.hypot(x[i3] - rig.rest[i3], x[i3 + 1] - rig.rest[i3 + 1], x[i3 + 2] - rig.rest[i3 + 2])
    const speed = Math.hypot(x[i3] - before[i3], x[i3 + 1] - before[i3 + 1], x[i3 + 2] - before[i3 + 2]) / dt
    const t = rig.tether[i] * 3
    const tether = t >= 0 ? Math.hypot(x[i3] - rig.rest[t], x[i3 + 1] - rig.rest[t + 1], x[i3 + 2] - rig.rest[t + 2]) / rig.tetherLength[i] : 0
    let stretch = 0
    for (let k = rig.neighbourStart[i]; k < rig.neighbourStart[i + 1]; k++) {
      const j3 = rig.neighbours[k] * 3
      const now = Math.hypot(x[i3] - x[j3], x[i3 + 1] - x[j3 + 1], x[i3 + 2] - x[j3 + 2])
      const was = Math.hypot(rig.rest[i3] - rig.rest[j3], rig.rest[i3 + 1] - rig.rest[j3 + 1], rig.rest[i3 + 2] - rig.rest[j3 + 2])
      stretch = Math.max(stretch, now / was - 1)
    }
    rows.push({ i, type: rig.type[i], mob: +rig.mobility[i].toFixed(2), offsetCm: +(offset * 100).toFixed(1), speed: +speed.toFixed(3),
      sdfCm: +(sampleSdf(rig, x[i3], x[i3 + 1], x[i3 + 2]) * 100).toFixed(1), restSdfCm: +(rig.restDistance[i] * 100).toFixed(1),
      tether: +tether.toFixed(3), stretch: +stretch.toFixed(2), deg: rig.neighbourStart[i + 1] - rig.neighbourStart[i],
      at: [...rig.rest.subarray(i3, i3 + 3)].map((v) => +v.toFixed(3)), now: [...x.subarray(i3, i3 + 3)].map((v) => +v.toFixed(3)),
      pinnedNeighbours: [...rig.neighbours.subarray(rig.neighbourStart[i], rig.neighbourStart[i + 1])].filter((j) => rig.pinned[j]).length,
      reach: +(0.3 * rig.mobility[i] ** 0.75).toFixed(3), tetherTo: rig.tether[i], along: +rig.tetherLength[i].toFixed(3) })
  }
  rows.sort((a, b) => b.offsetCm - a.offsetCm)
  // particles held by a hard limit: against the body, at the end of their tether, at the edge of their envelope
  const held = []
  for (let i = 0; i < rig.particles; i++) {
    if (rig.pinned[i]) continue
    const i3 = i * 3
    const radius = [0.012, 0.01, 0.012, 0][rig.type[i]]
    const allowed = radius > 0 ? Math.min(rig.restDistance[i], radius) : -Infinity
    const sdf = sampleSdf(rig, x[i3], x[i3 + 1], x[i3 + 2])
    const t = rig.tether[i] * 3
    const tetherNow = t >= 0 ? Math.hypot(x[i3] - rig.rest[t], x[i3 + 1] - rig.rest[t + 1], x[i3 + 2] - rig.rest[t + 2]) : 0
    const tetherLimit = rig.tetherLength[i] * 1.015 + 0.002
    const offset = Math.hypot(x[i3] - rig.rest[i3], x[i3 + 1] - rig.rest[i3 + 1], x[i3 + 2] - rig.rest[i3 + 2])
    const why = [sdf < allowed + 0.001 ? `body ${(sdf * 100).toFixed(1)}cm<=${(allowed * 100).toFixed(1)} rest ${(rig.restDistance[i] * 100).toFixed(1)}` : '', t >= 0 && tetherNow > tetherLimit - 0.001 ? 'tether' : ''].filter(Boolean)
    if (why.length && offset > 0.004) held.push({ i, offsetCm: +(offset * 100).toFixed(1), why: why.join(' '), at: [...rig.rest.subarray(i3, i3 + 3)].map((v) => +v.toFixed(3)), now: [...x.subarray(i3, i3 + 3)].map((v) => +v.toFixed(3)) })
  }
  console.log(key, 'held by a limit:', held.length)
  for (const row of held.slice(0, 10)) console.log(' ', JSON.stringify(row))
  console.log(key, 'worst after a turn:')
  for (const row of rows.slice(0, 12)) console.log(' ', JSON.stringify(row))
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c) }
const cm = (m: number) => (m * 100).toFixed(1)

export async function run(keys: string[]) {
  const dir = path.resolve('src/assets/boss-models')
  const files = readdirSync(dir).filter((file) => file.endsWith('.glb') && (!keys.length || keys.includes(file.replace(/\.glb$/, ''))))
  const rows: Record<string, unknown>[] = []
  for (const file of files) {
    const key = file.replace(/\.glb$/, '')
    const { position, index } = readGlbMesh(path.join(dir, file))
    const hints = BOSS_SWAY_HINTS[key]
    let t0 = performance.now()
    const sway = computeSwayWeights(position, index, { hints, internals: true })
    if (!sway?.internals) { console.log(`${key}: no analysis (rigid)`); continue }
    const rig = buildPhysicsRig(position, sway.internals, { parts: sway.parts, hints, overrides: hints?.physics })
    const build = performance.now() - t0
    t0 = performance.now()
    const sim = new BossPhysics(rig, { overrides: hints?.physics, settings: { ...(process.env.PHYSICS_NOSLEEP ? { sleepTime: 1e9 } : {}), ...(process.env.PHYSICS_ITERATIONS ? { iterations: +process.env.PHYSICS_ITERATIONS } : {}), ...(process.env.PHYSICS_HZ ? { substepHz: +process.env.PHYSICS_HZ } : {}) } })
    const createMs = performance.now() - t0
    // the body, the weapons and rigid gear: all weight on bone 0
    let bodyVertices = 0, bodyMoved = 0
    const { weld, kind } = sway.internals
    for (let i = 0; i < weld.length; i++) {
      const k = kind[weld[i]]
      if (k !== KIND.body && k !== KIND.rigid) continue
      bodyVertices++
      if (rig.skinIndex[i * 4] !== 0 || rig.skinWeight[i * 4] !== 1) bodyMoved++
    }
    const height = sway.height
    const rest = play(sim, height, () => ({ yaw: 0, x: 0, y: 0, z: 0 }), 3, 60, 0)
    const left = play(sim, height, turning(3), 4.5, 60, 1.12)
    const right = play(sim, height, turning(-3), 4.5, 60, 1.12)
    const walk = play(sim, height, walking(), 7, 60, 3.75)
    const fps30 = play(sim, height, turning(3), 2, 30, 1.12)
    const fps144 = play(sim, height, turning(3), 2, 144, 1.12)
    const teleport = play(sim, height, (t) => ({ yaw: 0, x: t > 1 ? 5 / METRES : 0, y: 0, z: 0 }), 2, 60, 1)
    if (process.env.PHYSICS_DEBUG) worst(sim, height, key)
    if (process.env.PHYSICS_TRACE) {
      // the turn, then every 0.25 s: the largest offset (cm), speed (m/s), piece swing (deg)
      sim.reset()
      const motion = turning(3), line: string[] = []
      for (let frame = 0; frame * (1 / 60) <= 6; frame++) {
        const t = frame / 60
        sim.step(frame === 0 ? 0 : 1 / 60, worldMatrix(rig, sway.height, motion(t, 1 / 60)))
        if (frame % 15 === 0) { const m = sim.metrics(); line.push(`${t.toFixed(2)}:${(m.offset * 100).toFixed(1)}/${m.speed.toFixed(2)}/${m.pieceAngle.toFixed(1)}`) }
      }
      console.log(key, 'trace', line.join(' '))
    }
    const perSecond = left.ms / 4.5
    const row = {
      key, ...Object.fromEntries(rig.info.map((line, i) => [`info${i}`, line])),
      build: Math.round(build), create: Math.round(createMs), msPerSecond: +perSecond.toFixed(1),
      bodyVertices, bodyMoved,
      restOffsetCm: +cm(rest.peak.offset), restSlept: rest.slept,
      leftPeakCm: +cm(left.peak.offset), rightPeakCm: +cm(right.peak.offset), afterStopCm: +cm(left.after), settleS: +left.settle.toFixed(2),
      walkPeakCm: +cm(walk.peak.offset), walkAfterCm: +cm(walk.after), walkSettleS: +walk.settle.toFixed(2),
      stretchMm: +(Math.max(left.peak.stretch, right.peak.stretch, walk.peak.stretch) * 1000).toFixed(1),
      strainPct: +(Math.max(left.peak.strain, right.peak.strain, walk.peak.strain) * 100).toFixed(1),
      penetrationCm: +cm(Math.max(left.peak.penetration, right.peak.penetration, walk.peak.penetration)),
      pieceDeg: +Math.max(left.peak.pieceAngle, right.peak.pieceAngle, walk.peak.pieceAngle).toFixed(1),
      fpsPeakCm: [fps30.peak.offset, left.peak.offset, fps144.peak.offset].map(cm).join(' / '),
      teleportSpeed: +teleport.peak.speed.toFixed(3),
      finite: [rest, left, right, walk, fps30, fps144, teleport].every((r) => r.peak.finite),
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
  return rows
}
