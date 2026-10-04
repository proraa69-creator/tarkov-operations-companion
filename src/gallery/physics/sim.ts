/**
 * Secondary physics of a boss model: simulates its rig (rig.ts) and gives the bone matrices the skinned mesh is drawn
 * with (skin.ts). Runs on the main thread, a millisecond or two per frame, and sleeps once everything has settled.
 *
 * The simulation lives in the model's own frame, in metres (a 1.8 m figure), so the attachments never lag and a turn of
 * the turntable is felt the way a real body's turn is: through the inertial forces of the moving frame. Every frame
 * the model's world matrix gives the frame's angular velocity and acceleration and the linear velocity and
 * acceleration of its origin (smoothed, clamped; a jump is a teleport and brings no inertia), and each particle feels
 *   gravity − frame acceleration − α × x − ω × (ω × x) − 2 ω × v − air drag (relative to the still air) − damping.
 * Cloth, straps, hair and antennas are particles: XPBD stretch links (compliance from the material's frequency), local
 * shape matching of every particle's neighbourhood (bending: a fold keeps its shape and cannot pop inside out), a shape
 * spring back to the sculpted form (the material's elasticity, stronger at the attachment, plus the pull back of a
 * hanging pendulum, g / L), a tether to the nearest pin (no stretching out), a max-distance envelope (soft from 60 %),
 * collisions with the body's distance field and strain limiting. Pouches and gear are rigid pendulums about their
 * pivot with a spring, damping and anisotropic swing limits (out, in, sideways, twist).
 * The sculpted rest pose already hangs under gravity, so its pull is balanced out: at rest the model is exactly as
 * modelled. Once the model stands still and everything has calmed, the elements glide the last centimetres into the
 * rest pose (a flap caught on the coarse collider would stay there) and the simulation sleeps.
 * Fixed substeps (PhysicsSettings.substepHz) with an accumulator and interpolation between the last two substeps:
 * the motion is the same at 30, 60 or 144 frames per second.
 */
import {
  PARTICLE_KINDS, PHYSICS_SETTINGS, PIECE_KINDS, particleProfile, pieceProfile, type PhysicsOverrides, type PhysicsSettings,
} from './config'
import { sampleSdf, type PhysicsRig } from './rig'

export interface PhysicsOptions {
  overrides?: PhysicsOverrides
  settings?: Partial<PhysicsSettings>
}

export interface PhysicsMetrics {
  /** Largest distance of a free particle from its rest position, m. */
  offset: number
  /** Largest particle speed relative to the body, m/s. */
  speed: number
  /** Largest extension of a stretch link beyond its sculpted length, m. */
  stretch: number
  /** Largest relative extension of a stretch link at least 2 cm long (0.01 = 1 %). */
  strain: number
  /** Deepest particle below its allowed distance from the body, m (0 = no penetration). */
  penetration: number
  /** Largest swing of a piece, degrees. */
  pieceAngle: number
  /** Every number is finite. */
  finite: boolean
}

const TAU = Math.PI * 2
const DEG = Math.PI / 180
/** Below these the frame counts as standing still (rad/s, m/s, rad/s², m/s²). */
const STILL = { turn: 0.03, move: 0.01, turnAccel: 0.3, moveAccel: 0.1 }
/**
 * Coming to rest: once the model has stood still this long (s) and nothing moves faster than RECOVER_SPEED (m/s), the
 * particles glide into the rest pose with this time constant (s). A cloth flap can stay hooked on the coarse body
 * collider or wedged by its links a few centimetres off its pose; real cloth would slide off and hang down.
 */
const RECOVER_DELAY = 0.3, RECOVER_SPEED = 0.04, RECOVER_TIME = 0.35
/** No link ends a substep stretched by more than this (strain limiting). */
const LINK_STRAIN = 0.1
/** Asleep only this close to the rest pose (m); falling asleep puts every particle exactly at rest. */
const SLEEP_OFFSET = 0.002

const smooth = (t: number) => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c) }

export class BossPhysics {
  readonly rig: PhysicsRig
  readonly settings: PhysicsSettings
  /** Bones of the skinned mesh: the body, every particle, every piece. */
  readonly boneCount: number
  private readonly h: number
  private readonly N: number
  private readonly P: number
  // particles: position, velocity, predicted position, position before the last substep (render interpolation)
  private readonly x: Float64Array
  private readonly v: Float64Array
  private readonly p: Float64Array
  private readonly last: Float64Array
  private readonly shown: Float64Array
  private readonly turn: Float64Array
  private readonly invMass: Float64Array
  private readonly gravityScale: Float64Array
  private readonly inertia: Float64Array
  private readonly drag: Float64Array
  private readonly decay: Float64Array
  private readonly shapeFactor: Float64Array
  private readonly reach: Float64Array
  private readonly allowed: Float64Array
  private readonly tetherLimit: Float64Array
  private readonly balance: Float64Array
  private readonly compliance: Float64Array
  private readonly lambda: Float64Array
  // regions: rest offsets from the region's centre (particle i, then its neighbours), its rotation, the pull per substep
  private readonly matchFactor: Float64Array
  private readonly regionOffset: Float64Array
  private readonly regionTurn: Float64Array
  private readonly matchDelta: Float64Array
  private readonly matchCount: Float64Array
  // pieces: rotation (quaternion x y z w) relative to the body, the one before the last substep, angular velocity
  private readonly q: Float64Array
  private readonly qLast: Float64Array
  private readonly spin: Float64Array
  private readonly arm: Float64Array
  private readonly armInertia: Float64Array
  private readonly stiffness: Float64Array
  private readonly damping: Float64Array
  private readonly pieceGravity: Float64Array
  private readonly pieceInertia: Float64Array
  private readonly pieceDrag: Float64Array
  private readonly pieceBalance: Float64Array
  private readonly limits: Float64Array
  private readonly basis: Float64Array
  // the frame's motion (body frame): angular velocity, angular acceleration, acceleration and velocity of the origin,
  // gravity, the air's velocity
  private readonly w = new Float64Array(3)
  private readonly al = new Float64Array(3)
  private readonly a0 = new Float64Array(3)
  private readonly v0 = new Float64Array(3)
  private readonly g = new Float64Array(3)
  private readonly air = new Float64Array(3)
  // the same, smoothed, in the world frame (metres)
  private readonly wS = new Float64Array(3)
  private readonly vS = new Float64Array(3)
  private readonly alS = new Float64Array(3)
  private readonly aS = new Float64Array(3)
  private readonly R = new Float64Array(9)
  private readonly C = new Float64Array(3)
  private readonly prevR = new Float64Array(9)
  private readonly prevC = new Float64Array(3)
  private readonly rv = new Float64Array(3)
  private readonly grad = new Float64Array(3)
  private hasPrev = false
  private accumulator = 0
  private quiet = 0
  private asleep = false
  private time = 0
  private fastest = 0
  private furthest = 0
  /** Seconds the model has stood still; once it is still and the elements have calmed, they glide back to rest. */
  private still = 0
  private recovering = false

  constructor(rig: PhysicsRig, options: PhysicsOptions = {}) {
    this.rig = rig
    this.settings = { ...PHYSICS_SETTINGS, ...options.settings }
    this.h = 1 / this.settings.substepHz
    const N = (this.N = rig.particles), P = (this.P = rig.pieces), L = rig.links.length / 2
    this.boneCount = 1 + N + P
    this.x = new Float64Array(N * 3); this.v = new Float64Array(N * 3); this.p = new Float64Array(N * 3)
    this.last = new Float64Array(N * 3); this.shown = new Float64Array(N * 3); this.turn = new Float64Array(N * 4)
    this.invMass = new Float64Array(N); this.gravityScale = new Float64Array(N); this.inertia = new Float64Array(N)
    this.drag = new Float64Array(N); this.decay = new Float64Array(N); this.shapeFactor = new Float64Array(N)
    this.reach = new Float64Array(N); this.allowed = new Float64Array(N); this.tetherLimit = new Float64Array(N)
    this.balance = new Float64Array(N * 3); this.compliance = new Float64Array(L); this.lambda = new Float64Array(L)
    this.matchFactor = new Float64Array(N); this.regionOffset = new Float64Array((N + rig.neighbours.length) * 3)
    this.regionTurn = new Float64Array(N * 4); this.matchDelta = new Float64Array(N * 3); this.matchCount = new Float64Array(N)
    this.q = new Float64Array(P * 4); this.qLast = new Float64Array(P * 4); this.spin = new Float64Array(P * 3)
    this.arm = new Float64Array(P * 3); this.armInertia = new Float64Array(P); this.stiffness = new Float64Array(P)
    this.damping = new Float64Array(P); this.pieceGravity = new Float64Array(P); this.pieceInertia = new Float64Array(P)
    this.pieceDrag = new Float64Array(P); this.pieceBalance = new Float64Array(P * 3); this.limits = new Float64Array(P * 4)
    this.basis = new Float64Array(P * 9)
    this.configure(options.overrides)
    this.reset()
  }

  /** Material constants per particle, link and piece (config.ts profiles with the model's overrides). */
  private configure(overrides?: PhysicsOverrides) {
    const { rig, h, N, P } = this
    const gravity = this.settings.gravity
    const [ux, uy, uz] = rig.up
    // the gravity the model was sculpted under, in its own frame
    const gx = -ux * gravity, gy = -uy * gravity, gz = -uz * gravity
    const profiles = PARTICLE_KINDS.map((kind) => particleProfile(kind, overrides))
    for (let i = 0; i < N; i++) {
      const profile = profiles[rig.type[i]], i3 = i * 3
      const mobility = rig.mobility[i]
      this.invMass[i] = rig.pinned[i] ? 0 : 1 / profile.mass
      this.gravityScale[i] = profile.gravity
      this.inertia[i] = profile.inertia
      this.drag[i] = profile.drag / profile.mass
      this.decay[i] = Math.exp(-profile.damping * h)
      // the shape spring: the material's elasticity, stronger towards the attachment (the seam end of a cape or a
      // strand holds its shape), plus what gravity does to a hanging part — the pull back of a pendulum as long as
      // the part hangs below its attachment (g / L)
      const material = TAU * profile.shapeHz * (1 + (profile.rootShape - 1) * (1 - smooth(mobility / 0.5)))
      const hangs = Math.max(0, rig.hang[i3] * ux + rig.hang[i3 + 1] * uy + rig.hang[i3 + 2] * uz)
      const pendulum = (profile.gravity * gravity * hangs) / Math.max(0.05, rig.tetherLength[i])
      const kappa = (material * material + pendulum) * h * h
      this.shapeFactor[i] = kappa / (1 + kappa)
      this.reach[i] = Math.max(0.004, profile.maxDistance * mobility ** 0.75)
      this.allowed[i] = profile.collisionRadius > 0 ? Math.min(rig.restDistance[i], profile.collisionRadius) : -Infinity
      this.tetherLimit[i] = rig.tetherLength[i] * (1 + profile.maxStretch) + 0.002
      // the sculpted rest pose already hangs under gravity: its pull is balanced out, so the model rests exactly as
      // modelled; a change of gravity in the model's frame (the model tilted) still acts in full
      this.balance[i3] = -profile.gravity * gx
      this.balance[i3 + 1] = -profile.gravity * gy
      this.balance[i3 + 2] = -profile.gravity * gz
    }
    for (let l = 0; l < this.compliance.length; l++) {
      const profile = profiles[rig.linkType[l]]
      // XPBD: compliance / h² for a link of the material's natural frequency; 0 Hz = rigid
      this.compliance[l] = profile.stretchHz > 0 ? 1 / (profile.mass * (TAU * profile.stretchHz * h) ** 2) : 0
    }
    // regions (a particle and its linked neighbours) keep their sculpted shape up to a rotation: bending stiffness
    // that also tells a fold from its mirror image (distance links alone let a dent pop through and stay there)
    for (let i = 0; i < N; i++) {
      const profile = profiles[rig.type[i]]
      const kappa = (TAU * profile.bendHz * h) ** 2
      this.matchFactor[i] = rig.pinned[i] ? 0 : kappa / (1 + kappa)
      const start = rig.neighbourStart[i], end = rig.neighbourStart[i + 1], size = end - start + 1
      let cx = rig.rest[i * 3], cy = rig.rest[i * 3 + 1], cz = rig.rest[i * 3 + 2]
      for (let k = start; k < end; k++) { const j3 = rig.neighbours[k] * 3; cx += rig.rest[j3]; cy += rig.rest[j3 + 1]; cz += rig.rest[j3 + 2] }
      cx /= size; cy /= size; cz /= size
      const o = (i + start) * 3
      this.regionOffset[o] = rig.rest[i * 3] - cx; this.regionOffset[o + 1] = rig.rest[i * 3 + 1] - cy; this.regionOffset[o + 2] = rig.rest[i * 3 + 2] - cz
      for (let k = start; k < end; k++) {
        const j3 = rig.neighbours[k] * 3, m = (i + k + 1) * 3
        this.regionOffset[m] = rig.rest[j3] - cx; this.regionOffset[m + 1] = rig.rest[j3 + 1] - cy; this.regionOffset[m + 2] = rig.rest[j3 + 2] - cz
      }
    }
    const pieceProfiles = PIECE_KINDS.map((kind) => pieceProfile(kind, overrides))
    for (let j = 0; j < P; j++) {
      const profile = pieceProfiles[rig.pieceType[j]], j3 = j * 3
      const ax = rig.centroid[j3] - rig.pivot[j3], ay = rig.centroid[j3 + 1] - rig.pivot[j3 + 1], az = rig.centroid[j3 + 2] - rig.pivot[j3 + 2]
      this.arm[j3] = ax; this.arm[j3 + 1] = ay; this.arm[j3 + 2] = az
      const length = Math.hypot(ax, ay, az)
      this.armInertia[j] = length * length + rig.pieceRadius[j] ** 2 + 1e-6
      // the same straps hold a smaller piece stiffer (less inertia about the pivot)
      const omega = TAU * profile.frequencyHz * Math.max(1, profile.size / Math.sqrt(this.armInertia[j]))
      this.stiffness[j] = omega * omega
      this.damping[j] = 2 * profile.dampingRatio * omega
      this.pieceGravity[j] = profile.gravity
      this.pieceInertia[j] = profile.inertia
      this.pieceDrag[j] = profile.drag / profile.mass
      // no torque from gravity in the rest pose (the piece hangs as modelled)
      const nx = length > 1e-6 ? ax / length : -ux, ny = length > 1e-6 ? ay / length : -uy, nz = length > 1e-6 ? az / length : -uz
      const along = gx * nx + gy * ny + gz * nz
      this.pieceBalance[j3] = -profile.gravity * (gx - along * nx)
      this.pieceBalance[j3 + 1] = -profile.gravity * (gy - along * ny)
      this.pieceBalance[j3 + 2] = -profile.gravity * (gz - along * nz)
      const amount = rig.pieceAmount[j]
      this.limits[j * 4] = profile.limits.out * DEG * amount
      this.limits[j * 4 + 1] = profile.limits.in * DEG * amount
      this.limits[j * 4 + 2] = profile.limits.side * DEG * amount
      this.limits[j * 4 + 3] = profile.limits.twist * DEG * amount
      // swing axes: t (out/in: about the horizontal across the body), o (sideways: about the outward), u (twist)
      let ox = rig.outward[j3], oy = rig.outward[j3 + 1], oz = rig.outward[j3 + 2]
      const up = ox * ux + oy * uy + oz * uz
      ox -= up * ux; oy -= up * uy; oz -= up * uz
      const ol = Math.hypot(ox, oy, oz) || 1
      ox /= ol; oy /= ol; oz /= ol
      const b = j * 9
      this.basis[b] = uy * oz - uz * oy; this.basis[b + 1] = uz * ox - ux * oz; this.basis[b + 2] = ux * oy - uy * ox
      this.basis[b + 3] = ox; this.basis[b + 4] = oy; this.basis[b + 5] = oz
      this.basis[b + 6] = ux; this.basis[b + 7] = uy; this.basis[b + 8] = uz
    }
  }

  /** Back to the rest pose, at rest; the motion history is forgotten (a new model, a teleport). */
  reset() {
    const rest = this.rig.rest
    for (let k = 0; k < this.N * 3; k++) { this.x[k] = rest[k]; this.last[k] = rest[k]; this.p[k] = rest[k] }
    this.v.fill(0)
    for (let i = 0; i < this.N * 4; i++) { this.turn[i] = i % 4 === 3 ? 1 : 0; this.regionTurn[i] = i % 4 === 3 ? 1 : 0 }
    for (let j = 0; j < this.P; j++) {
      this.q.set([0, 0, 0, 1], j * 4)
      this.qLast.set([0, 0, 0, 1], j * 4)
    }
    this.spin.fill(0)
    this.hasPrev = false
    this.accumulator = 0
    this.quiet = 0
    this.asleep = false
    this.still = 0
    this.recovering = false
    this.forgetMotion()
  }

  private forgetMotion() {
    this.wS.fill(0); this.vS.fill(0); this.alS.fill(0); this.aS.fill(0)
    this.w.fill(0); this.al.fill(0); this.a0.fill(0); this.v0.fill(0)
  }

  /** True once everything has settled with the model standing still (nothing to draw until it moves again). */
  get sleeping() { return this.asleep }

  /**
   * Advances the simulation to now: `dt` seconds since the last call, `matrix` = the mesh's world matrix
   * (column-major, three.js Matrix4.elements). Returns true while anything still moves.
   */
  step(dt: number, matrix: ArrayLike<number>): boolean {
    const s = this.settings
    this.readMatrix(matrix)
    let jump = !this.hasPrev || !(dt > 0) || dt > 0.25
    if (!jump) {
      const angle = rotationBetween(this.R, this.prevR, this.rv)
      const moved = Math.hypot(this.C[0] - this.prevC[0], this.C[1] - this.prevC[1], this.C[2] - this.prevC[2])
      // a frame this far from the last is a teleport (or a jump of the view): no inertia from it
      if (angle > s.teleportAngle || moved > s.teleportDistance) jump = true
    }
    if (jump) this.forgetMotion()
    else {
      const blend = 1 - Math.exp(-dt / Math.max(1e-4, s.motionSmoothing))
      for (let c = 0; c < 3; c++) {
        const w0 = this.wS[c], v0 = this.vS[c]
        this.wS[c] += (this.rv[c] / dt - w0) * blend
        this.vS[c] += ((this.C[c] - this.prevC[c]) / dt - v0) * blend
        this.alS[c] += ((this.wS[c] - w0) / dt - this.alS[c]) * blend
        this.aS[c] += ((this.vS[c] - v0) / dt - this.aS[c]) * blend
      }
      clampLength(this.wS, s.maxAngularSpeed)
      clampLength(this.alS, s.maxAngularAcceleration)
      clampLength(this.aS, s.maxLinearAcceleration)
    }
    this.prevR.set(this.R)
    this.prevC.set(this.C)
    this.hasPrev = true
    // into the body frame
    const R = this.R
    toBody(R, this.wS, this.w)
    toBody(R, this.alS, this.al)
    toBody(R, this.aS, this.a0)
    toBody(R, this.vS, this.v0)
    this.g[0] = -R[3] * s.gravity; this.g[1] = -R[4] * s.gravity; this.g[2] = -R[5] * s.gravity
    this.time += Math.max(0, Math.min(dt, 0.25))
    if (s.wind > 0) {
      // a steady breeze from one side of the room with slow gusts
      const t = this.time
      const gusts = [s.wind * (0.75 + 0.25 * Math.sin(t * 1.3) + 0.12 * Math.sin(t * 3.1)), 0, s.wind * 0.3 * Math.sin(t * 0.7 + 1)]
      toBody(R, gusts, this.air)
    } else this.air.fill(0)
    const moving = length(this.wS) > STILL.turn || length(this.vS) > STILL.move || length(this.alS) > STILL.turnAccel
      || length(this.aS) > STILL.moveAccel || s.wind > 0
    if (moving) { this.quiet = 0; this.still = 0; this.asleep = false; this.recovering = false } else this.still += Math.max(0, dt)
    if (this.asleep) return false
    this.accumulator = Math.min(this.accumulator + Math.max(0, Math.min(dt, 0.25)), s.maxSubsteps * this.h)
    let stepped = false, fastest = 0
    while (this.accumulator >= this.h) {
      this.fastest = 0
      this.furthest = 0
      this.substep()
      this.accumulator -= this.h
      fastest = Math.max(fastest, this.fastest)
      stepped = true
    }
    if (stepped && this.still > RECOVER_DELAY && fastest < RECOVER_SPEED) this.recovering = true
    if (!moving && stepped && fastest < s.sleepSpeed && this.furthest < SLEEP_OFFSET) {
      this.quiet += dt
      if (this.quiet >= s.sleepTime) this.fallAsleep()
    } else if (stepped) this.quiet = 0
    return !this.asleep
  }

  /** Everything exactly at rest (it is within SLEEP_OFFSET already); nothing to simulate until the model moves. */
  private fallAsleep() {
    this.asleep = true
    this.x.set(this.rig.rest)
    this.last.set(this.rig.rest)
    this.v.fill(0)
    for (let j = 0; j < this.P; j++) { this.q.set([0, 0, 0, 1], j * 4); this.qLast.set([0, 0, 0, 1], j * 4) }
    this.spin.fill(0)
  }

  private readMatrix(m: ArrayLike<number>) {
    const R = this.R
    for (let c = 0; c < 3; c++) {
      const sx = Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]) || 1
      R[c] = m[c * 4] / sx; R[3 + c] = m[c * 4 + 1] / sx; R[6 + c] = m[c * 4 + 2] / sx
    }
    // the world position of the frame's origin, in metres (world units per mesh unit: the matrix's scale)
    const [ox, oy, oz] = this.rig.origin
    const metres = this.rig.scale / (Math.hypot(m[0], m[1], m[2]) || 1)
    for (let c = 0; c < 3; c++) this.C[c] = (m[c] * ox + m[4 + c] * oy + m[8 + c] * oz + m[12 + c]) * metres
  }

  private substep() {
    const { rig, h, N, x, v, p, last, invMass } = this
    last.set(x)
    const [wx, wy, wz] = this.w, [ax, ay, az] = this.al, [lx, ly, lz] = this.a0, [ux, uy, uz] = this.v0
    const [gx, gy, gz] = this.g, [fx, fy, fz] = this.air
    const maxSpeed = this.settings.maxSpeed
    const recovering = this.recovering
    // 1. forces in the moving frame, then the predicted positions (coming to rest: no forces, no drift — a glide)
    for (let i = 0; i < N; i++) {
      const i3 = i * 3
      if (invMass[i] === 0) continue
      if (recovering) { p[i3] = x[i3]; p[i3 + 1] = x[i3 + 1]; p[i3 + 2] = x[i3 + 2]; continue }
      const px = x[i3], py = x[i3 + 1], pz = x[i3 + 2], vx = v[i3], vy = v[i3 + 1], vz = v[i3 + 2]
      // velocity of the frame at the particle (ω × x), centripetal ω × (ω × x), Euler α × x, Coriolis 2 ω × v
      const rx = wy * pz - wz * py, ry = wz * px - wx * pz, rz = wx * py - wy * px
      const cx = wy * rz - wz * ry, cy = wz * rx - wx * rz, cz = wx * ry - wy * rx
      const ex = ay * pz - az * py, ey = az * px - ax * pz, ez = ax * py - ay * px
      const kx = 2 * (wy * vz - wz * vy), ky = 2 * (wz * vx - wx * vz), kz = 2 * (wx * vy - wy * vx)
      const inertia = this.inertia[i], gravity = this.gravityScale[i], drag = this.drag[i], decay = this.decay[i]
      // air drag on the particle's velocity through the air: its own, the frame's turn and the frame's motion
      const qx = gravity * gx + this.balance[i3] - inertia * (lx + ex + cx + kx) - drag * (vx + rx + ux - fx)
      const qy = gravity * gy + this.balance[i3 + 1] - inertia * (ly + ey + cy + ky) - drag * (vy + ry + uy - fy)
      const qz = gravity * gz + this.balance[i3 + 2] - inertia * (lz + ez + cz + kz) - drag * (vz + rz + uz - fz)
      let nx = (vx + qx * h) * decay, ny = (vy + qy * h) * decay, nz = (vz + qz * h) * decay
      const speed = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (speed > maxSpeed) { const k = maxSpeed / speed; nx *= k; ny *= k; nz *= k }
      p[i3] = px + nx * h; p[i3 + 1] = py + ny * h; p[i3 + 2] = pz + nz * h
    }
    // 2. constraints, interleaved so that they settle together: stretch links (XPBD), the regions' shapes (bending)
    // and the shape spring, then the hard limits — tether, envelope, body — and again links and limits.
    // Coming to rest (the model stands still, everything has calmed) skips them all and only glides into the rest
    // pose: both ends are valid poses, and a constraint must not hold a flap where it got caught.
    if (!recovering) {
      this.lambda.fill(0)
      for (let pass = 0; pass < this.settings.iterations; pass++) {
        this.solveLinks()
        if (pass === 0) { this.matchRegions(); this.pullToShape() }
        this.limit()
      }
      // what is left over at the peak of a hard turn: no link stretched past LINK_STRAIN
      this.limitStrain()
      this.limitStrain()
    }
    // 3. the velocities from the moves
    const rest = rig.rest
    const recover = recovering ? 1 - Math.exp(-h / RECOVER_TIME) : 0
    let fastest = this.fastest, furthest = this.furthest
    for (let i = 0; i < N; i++) {
      if (invMass[i] === 0) continue
      const i3 = i * 3
      const rx = rest[i3], ry = rest[i3 + 1], rz = rest[i3 + 2]
      let qx = p[i3], qy = p[i3 + 1], qz = p[i3 + 2]
      if (recover > 0) { qx += (rx - qx) * recover; qy += (ry - qy) * recover; qz += (rz - qz) * recover }
      furthest = Math.max(furthest, Math.abs(qx - rx), Math.abs(qy - ry), Math.abs(qz - rz))
      let vx = (qx - x[i3]) / h, vy = (qy - x[i3 + 1]) / h, vz = (qz - x[i3 + 2]) / h
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (speed > maxSpeed) { const k = maxSpeed / speed; vx *= k; vy *= k; vz *= k }
      if (speed > fastest) fastest = Math.min(speed, maxSpeed)
      v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz
      x[i3] = qx; x[i3 + 1] = qy; x[i3 + 2] = qz
      p[i3] = qx; p[i3 + 1] = qy; p[i3 + 2] = qz
    }
    // 4. pieces: rigid pendulums about their pivots
    for (let j = 0; j < this.P; j++) {
      fastest = Math.max(fastest, this.swingPiece(j))
      const theta = logQuat(this.q, j * 4)
      furthest = Math.max(furthest, Math.hypot(theta[0], theta[1], theta[2]) * Math.sqrt(this.armInertia[j]))
    }
    this.fastest = fastest
    this.furthest = furthest
  }

  /** One pass over the stretch links (XPBD: compliance from the material's frequency, λ kept over the passes). */
  private solveLinks() {
    const { rig, p, invMass, compliance, lambda } = this
    const links = rig.links, linkRest = rig.linkRest
    for (let l = 0; l < compliance.length; l++) {
      const alpha = compliance[l]
      const a = links[l * 2], b = links[l * 2 + 1], wa = invMass[a], wb = invMass[b]
      if (wa + wb === 0) continue
      const a3 = a * 3, b3 = b * 3
      const dx = p[b3] - p[a3], dy = p[b3 + 1] - p[a3 + 1], dz = p[b3 + 2] - p[a3 + 2]
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (len < 1e-9) continue
      const dl = (linkRest[l] - len - alpha * lambda[l]) / (wa + wb + alpha)
      lambda[l] += dl
      const k = dl / len
      p[a3] -= wa * k * dx; p[a3 + 1] -= wa * k * dy; p[a3 + 2] -= wa * k * dz
      p[b3] += wb * k * dx; p[b3 + 1] += wb * k * dy; p[b3 + 2] += wb * k * dz
    }
  }

  /**
   * Strain limiting (Provot 1995): last, no link longer than its rest length by more than LINK_STRAIN — what the
   * compliant links, the hard limits and the body leave over at the peak of a hard turn is taken out here.
   */
  private limitStrain() {
    const { rig, p, invMass } = this
    const links = rig.links, linkRest = rig.linkRest
    for (let l = 0; l < linkRest.length; l++) {
      const a = links[l * 2], b = links[l * 2 + 1], wa = invMass[a], wb = invMass[b]
      if (wa + wb === 0) continue
      const a3 = a * 3, b3 = b * 3
      const dx = p[b3] - p[a3], dy = p[b3 + 1] - p[a3 + 1], dz = p[b3 + 2] - p[a3 + 2]
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz), most = linkRest[l] * (1 + LINK_STRAIN)
      if (len <= most) continue
      const k = (len - most) / (len * (wa + wb))
      p[a3] += wa * k * dx; p[a3 + 1] += wa * k * dy; p[a3 + 2] += wa * k * dz
      p[b3] -= wb * k * dx; p[b3 + 1] -= wb * k * dy; p[b3 + 2] -= wb * k * dz
    }
  }

  /** The shape spring: every free particle a little towards its rest position (implicit, the material's frequency). */
  private pullToShape() {
    const { p, invMass } = this, rest = this.rig.rest
    for (let i = 0; i < this.N; i++) {
      if (invMass[i] === 0) continue
      const f = this.shapeFactor[i], i3 = i * 3
      p[i3] += (rest[i3] - p[i3]) * f; p[i3 + 1] += (rest[i3 + 1] - p[i3 + 1]) * f; p[i3 + 2] += (rest[i3 + 2] - p[i3 + 2]) * f
    }
  }

  /** Hard limits: the tether to the attachment, the envelope round the rest position (soft from 60 %), the body. */
  private limit() {
    const { rig, p, invMass, grad } = this, rest = rig.rest
    for (let i = 0; i < this.N; i++) {
      if (invMass[i] === 0) continue
      const i3 = i * 3
      const t = rig.tether[i]
      if (t >= 0) {
        const t3 = t * 3
        const dx = p[i3] - rest[t3], dy = p[i3 + 1] - rest[t3 + 1], dz = p[i3 + 2] - rest[t3 + 2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), limit = this.tetherLimit[i]
        if (d > limit) { const k = limit / d; p[i3] = rest[t3] + dx * k; p[i3 + 1] = rest[t3 + 1] + dy * k; p[i3 + 2] = rest[t3 + 2] + dz * k }
      }
      {
        const dx = p[i3] - rest[i3], dy = p[i3 + 1] - rest[i3 + 1], dz = p[i3 + 2] - rest[i3 + 2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), reach = this.reach[i], soft = reach * 0.6
        if (d > soft) {
          const k = (soft + (reach - soft) * Math.tanh((d - soft) / (reach - soft))) / d
          p[i3] = rest[i3] + dx * k; p[i3 + 1] = rest[i3 + 1] + dy * k; p[i3 + 2] = rest[i3 + 2] + dz * k
        }
      }
      const allowed = this.allowed[i]
      // out of the body along the field's gradient to the allowed distance (Newton steps on the distance field)
      for (let step = 0; step < 2 && allowed > -Infinity; step++) {
        const distance = sampleSdf(rig, p[i3], p[i3 + 1], p[i3 + 2], grad)
        if (distance >= allowed) break
        const g2 = grad[0] * grad[0] + grad[1] * grad[1] + grad[2] * grad[2]
        if (g2 < 1e-12) break
        const k = (allowed - distance) / g2
        p[i3] += grad[0] * k; p[i3 + 1] += grad[1] * k; p[i3 + 2] += grad[2] * k
      }
    }
  }

  /**
   * Local shape matching (Müller et al. 2005, regions as in FastLSM): the best rotation of each region's current shape
   * against its sculpted one (warm-started, one iteration per substep), and every free particle pulled towards the
   * average of its goals in the regions it belongs to, by its material's bending factor.
   */
  private matchRegions() {
    const { rig, N, p, regionOffset: offset, regionTurn: turn, matchDelta: delta, matchCount: count } = this
    const start = rig.neighbourStart, neighbours = rig.neighbours, A = scratchMatrix
    delta.fill(0)
    count.fill(0)
    for (let i = 0; i < N; i++) {
      const s0 = start[i], s1 = start[i + 1]
      if (s1 - s0 < 2) continue
      const size = s1 - s0 + 1, base = i + s0
      // current centre
      let cx = p[i * 3], cy = p[i * 3 + 1], cz = p[i * 3 + 2]
      for (let k = s0; k < s1; k++) { const j3 = neighbours[k] * 3; cx += p[j3]; cy += p[j3 + 1]; cz += p[j3 + 2] }
      cx /= size; cy /= size; cz /= size
      A.fill(0)
      for (let m = 0; m < size; m++) {
        const j3 = (m === 0 ? i : neighbours[s0 + m - 1]) * 3, o = (base + m) * 3
        const dx = p[j3] - cx, dy = p[j3 + 1] - cy, dz = p[j3 + 2] - cz
        const rx = offset[o], ry = offset[o + 1], rz = offset[o + 2]
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz
      }
      extractRotation(A, turn, i * 4, 1)
      const x = turn[i * 4], y = turn[i * 4 + 1], z = turn[i * 4 + 2], w = turn[i * 4 + 3]
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w)
      const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w)
      const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y)
      for (let m = 0; m < size; m++) {
        const j = m === 0 ? i : neighbours[s0 + m - 1], j3 = j * 3, o = (base + m) * 3
        const rx = offset[o], ry = offset[o + 1], rz = offset[o + 2]
        delta[j3] += cx + r00 * rx + r01 * ry + r02 * rz - p[j3]
        delta[j3 + 1] += cy + r10 * rx + r11 * ry + r12 * rz - p[j3 + 1]
        delta[j3 + 2] += cz + r20 * rx + r21 * ry + r22 * rz - p[j3 + 2]
        count[j]++
      }
    }
    for (let i = 0; i < N; i++) {
      const f = this.matchFactor[i]
      if (f === 0 || count[i] === 0) continue
      const k = f / count[i], i3 = i * 3
      p[i3] += delta[i3] * k; p[i3 + 1] += delta[i3 + 1] * k; p[i3 + 2] += delta[i3 + 2] * k
    }
  }

  /** One substep of a piece; returns how fast it turns, as the speed of its centre (m/s). */
  private swingPiece(j: number): number {
    const { h, rig, q, spin } = this
    const j3 = j * 3, j4 = j * 4
    this.qLast[j4] = q[j4]; this.qLast[j4 + 1] = q[j4 + 1]; this.qLast[j4 + 2] = q[j4 + 2]; this.qLast[j4 + 3] = q[j4 + 3]
    const d = rotate(q, j4, this.arm[j3], this.arm[j3 + 1], this.arm[j3 + 2])
    const dx = d[0], dy = d[1], dz = d[2]
    const cx = rig.pivot[j3] + dx, cy = rig.pivot[j3 + 1] + dy, cz = rig.pivot[j3 + 2] + dz
    const sx = spin[j3], sy = spin[j3 + 1], sz = spin[j3 + 2]
    // velocity of the centre relative to the body, and the frame's terms at the centre
    const vx = sy * dz - sz * dy, vy = sz * dx - sx * dz, vz = sx * dy - sy * dx
    const [wx, wy, wz] = this.w, [ax, ay, az] = this.al
    const rx = wy * cz - wz * cy, ry = wz * cx - wx * cz, rz = wx * cy - wy * cx
    const ccx = wy * rz - wz * ry, ccy = wz * rx - wx * rz, ccz = wx * ry - wy * rx
    const ex = ay * cz - az * cy, ey = az * cx - ax * cz, ez = ax * cy - ay * cx
    const kx = 2 * (wy * vz - wz * vy), ky = 2 * (wz * vx - wx * vz), kz = 2 * (wx * vy - wy * vx)
    const gravity = this.pieceGravity[j], inertia = this.pieceInertia[j], drag = this.pieceDrag[j]
    const fx = gravity * this.g[0] + this.pieceBalance[j3] - inertia * (this.a0[0] + ex + ccx + kx) - drag * (vx + rx + this.v0[0] - this.air[0])
    const fy = gravity * this.g[1] + this.pieceBalance[j3 + 1] - inertia * (this.a0[1] + ey + ccy + ky) - drag * (vy + ry + this.v0[1] - this.air[1])
    const fz = gravity * this.g[2] + this.pieceBalance[j3 + 2] - inertia * (this.a0[2] + ez + ccz + kz) - drag * (vz + rz + this.v0[2] - this.air[2])
    // torque about the pivot over the moment of inertia, the spring back to rest, damping
    const I = this.armInertia[j]
    const theta = logQuat(q, j4)
    const k = this.stiffness[j], c = this.damping[j]
    spin[j3] += ((dy * fz - dz * fy) / I - k * theta[0] - c * sx) * h
    spin[j3 + 1] += ((dz * fx - dx * fz) / I - k * theta[1] - c * sy) * h
    spin[j3 + 2] += ((dx * fy - dy * fx) / I - k * theta[2] - c * sz) * h
    turnQuat(q, j4, spin[j3] * h, spin[j3 + 1] * h, spin[j3 + 2] * h)
    // swing limits: out from / into the body, sideways, twist
    const after = logQuat(q, j4)
    const b = j * 9, limits = this.limits
    let clamped = false
    const parts = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      const nx = this.basis[b + axis * 3], ny = this.basis[b + axis * 3 + 1], nz = this.basis[b + axis * 3 + 2]
      const value = after[0] * nx + after[1] * ny + after[2] * nz
      // about t a positive turn swings the lower end into the body
      const low = axis === 0 ? -limits[j * 4] : axis === 1 ? -limits[j * 4 + 2] : -limits[j * 4 + 3]
      const high = axis === 0 ? limits[j * 4 + 1] : axis === 1 ? limits[j * 4 + 2] : limits[j * 4 + 3]
      const kept = Math.min(high, Math.max(low, value))
      parts[axis] = kept
      if (kept !== value) {
        clamped = true
        const along = spin[j3] * nx + spin[j3 + 1] * ny + spin[j3 + 2] * nz
        if ((value > high && along > 0) || (value < low && along < 0)) { spin[j3] -= along * nx; spin[j3 + 1] -= along * ny; spin[j3 + 2] -= along * nz }
      }
    }
    if (clamped) {
      let tx = 0, ty = 0, tz = 0
      for (let axis = 0; axis < 3; axis++) {
        tx += parts[axis] * this.basis[b + axis * 3]; ty += parts[axis] * this.basis[b + axis * 3 + 1]; tz += parts[axis] * this.basis[b + axis * 3 + 2]
      }
      expQuat(q, j4, tx, ty, tz)
    }
    return Math.hypot(sx, sy, sz) * Math.sqrt(I)
  }

  /**
   * Bone matrices of the skinned mesh (mesh space, column-major, 16 per bone) for the current frame: the body (the
   * identity), every particle (its position and the rotation of its neighbourhood), every piece.
   */
  writeBones(target: Float32Array) {
    const { rig, N, P, shown, turn } = this
    const alpha = Math.min(1, this.accumulator / this.h)
    for (let k = 0; k < N * 3; k++) shown[k] = this.last[k] + (this.x[k] - this.last[k]) * alpha
    target.fill(0, 0, 16)
    target[0] = 1; target[5] = 1; target[10] = 1; target[15] = 1
    const inv = 1 / rig.scale, [ox, oy, oz] = rig.origin, rest = rig.rest
    const A = scratchMatrix
    for (let i = 0; i < N; i++) {
      const i3 = i * 3
      A.fill(0)
      for (let k = rig.neighbourStart[i]; k < rig.neighbourStart[i + 1]; k++) {
        const j3 = rig.neighbours[k] * 3
        const dx = shown[j3] - shown[i3], dy = shown[j3 + 1] - shown[i3 + 1], dz = shown[j3 + 2] - shown[i3 + 2]
        const rx = rest[j3] - rest[i3], ry = rest[j3 + 1] - rest[i3 + 1], rz = rest[j3 + 2] - rest[i3 + 2]
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz
      }
      extractRotation(A, turn, i * 4, 3)
      // x' = position + R (x − rest), in mesh units
      writeRigid(target, (1 + i) * 16, turn, i * 4, ox + shown[i3] * inv, oy + shown[i3 + 1] * inv, oz + shown[i3 + 2] * inv, ox + rest[i3] * inv, oy + rest[i3 + 1] * inv, oz + rest[i3 + 2] * inv)
    }
    const qq = scratchQuat
    for (let j = 0; j < P; j++) {
      const j4 = j * 4
      // the rotation between the last two substeps (they are close: a normalised lerp is enough)
      const sign = this.qLast[j4] * this.q[j4] + this.qLast[j4 + 1] * this.q[j4 + 1] + this.qLast[j4 + 2] * this.q[j4 + 2] + this.qLast[j4 + 3] * this.q[j4 + 3] < 0 ? -1 : 1
      for (let c = 0; c < 4; c++) qq[c] = this.qLast[j4 + c] + (sign * this.q[j4 + c] - this.qLast[j4 + c]) * alpha
      const ql = Math.hypot(qq[0], qq[1], qq[2], qq[3]) || 1
      for (let c = 0; c < 4; c++) qq[c] /= ql
      const px = ox + rig.pivot[j * 3] * inv, py = oy + rig.pivot[j * 3 + 1] * inv, pz = oz + rig.pivot[j * 3 + 2] * inv
      writeRigid(target, (1 + N + j) * 16, qq, 0, px, py, pz, px, py, pz)
    }
  }

  /** Current particle positions (m, simulation frame; 3 per particle) — for tests and tools. */
  get positions(): Float64Array { return this.x }

  /** The state in numbers (tests, the lab). */
  metrics(): PhysicsMetrics {
    const { rig, x, v, N, P } = this
    let offset = 0, speed = 0, stretch = 0, strain = 0, penetration = 0, pieceAngle = 0, finite = true
    for (let i = 0; i < N; i++) {
      const i3 = i * 3
      if (!Number.isFinite(x[i3]) || !Number.isFinite(x[i3 + 1]) || !Number.isFinite(x[i3 + 2])) finite = false
      if (this.invMass[i] === 0) continue
      offset = Math.max(offset, Math.hypot(x[i3] - rig.rest[i3], x[i3 + 1] - rig.rest[i3 + 1], x[i3 + 2] - rig.rest[i3 + 2]))
      speed = Math.max(speed, Math.hypot(v[i3], v[i3 + 1], v[i3 + 2]))
      if (this.allowed[i] > -Infinity) penetration = Math.max(penetration, this.allowed[i] - sampleSdf(rig, x[i3], x[i3 + 1], x[i3 + 2]))
    }
    for (let l = 0; l < rig.links.length / 2; l++) {
      const a = rig.links[l * 2] * 3, b = rig.links[l * 2 + 1] * 3
      const sculpted = Math.hypot(rig.rest[a] - rig.rest[b], rig.rest[a + 1] - rig.rest[b + 1], rig.rest[a + 2] - rig.rest[b + 2])
      const now = Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2])
      stretch = Math.max(stretch, now - sculpted)
      if (sculpted >= 0.02) strain = Math.max(strain, now / sculpted - 1)
    }
    for (let j = 0; j < P; j++) {
      const theta = logQuat(this.q, j * 4)
      pieceAngle = Math.max(pieceAngle, Math.hypot(theta[0], theta[1], theta[2]) / DEG)
      if (!Number.isFinite(pieceAngle)) finite = false
    }
    return { offset, speed, stretch, strain, penetration: Math.max(0, penetration), pieceAngle, finite }
  }
}

const scratchMatrix = new Float64Array(9)
const scratchQuat = new Float64Array(4)

const length = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2])

function clampLength(a: Float64Array, limit: number) {
  const l = length(a)
  if (l > limit) { const k = limit / l; a[0] *= k; a[1] *= k; a[2] *= k }
}

/** Rᵀ a (R row-major): a world-frame vector in the body frame. */
function toBody(R: Float64Array, a: ArrayLike<number>, out: Float64Array) {
  const x = a[0], y = a[1], z = a[2]
  out[0] = R[0] * x + R[3] * y + R[6] * z
  out[1] = R[1] * x + R[4] * y + R[7] * z
  out[2] = R[2] * x + R[5] * y + R[8] * z
}

/** The rotation taking `from` to `to` (both row-major) as a world-frame rotation vector; returns its angle. */
function rotationBetween(to: Float64Array, from: Float64Array, out: Float64Array): number {
  // D = to · fromᵀ
  const d = (r: number, c: number) => to[r * 3] * from[c * 3] + to[r * 3 + 1] * from[c * 3 + 1] + to[r * 3 + 2] * from[c * 3 + 2]
  const cos = Math.max(-1, Math.min(1, (d(0, 0) + d(1, 1) + d(2, 2) - 1) / 2))
  const angle = Math.acos(cos)
  const x = d(2, 1) - d(1, 2), y = d(0, 2) - d(2, 0), z = d(1, 0) - d(0, 1)
  const s = Math.hypot(x, y, z)
  if (s < 1e-12) { out[0] = 0; out[1] = 0; out[2] = 0; return angle }
  out[0] = (x / s) * angle; out[1] = (y / s) * angle; out[2] = (z / s) * angle
  return angle
}

const rotated = new Float64Array(3)
/** Rotates (x, y, z) by the quaternion at q[o]. */
function rotate(q: Float64Array, o: number, x: number, y: number, z: number): Float64Array {
  const qx = q[o], qy = q[o + 1], qz = q[o + 2], qw = q[o + 3]
  // t = 2 q × v; v' = v + w t + q × t
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x)
  rotated[0] = x + qw * tx + (qy * tz - qz * ty)
  rotated[1] = y + qw * ty + (qz * tx - qx * tz)
  rotated[2] = z + qw * tz + (qx * ty - qy * tx)
  return rotated
}

const logged = new Float64Array(3)
/** Rotation vector (axis × angle) of the quaternion at q[o]. */
function logQuat(q: Float64Array, o: number): Float64Array {
  let x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3]
  if (w < 0) { x = -x; y = -y; z = -z; w = -w }
  const s = Math.sqrt(x * x + y * y + z * z)
  if (s < 1e-12) { logged[0] = 2 * x; logged[1] = 2 * y; logged[2] = 2 * z; return logged }
  const k = (2 * Math.atan2(s, w)) / s
  logged[0] = x * k; logged[1] = y * k; logged[2] = z * k
  return logged
}

/** The quaternion at q[o] becomes the rotation by the rotation vector (x, y, z). */
function expQuat(q: Float64Array, o: number, x: number, y: number, z: number) {
  const angle = Math.sqrt(x * x + y * y + z * z)
  if (angle < 1e-12) { q[o] = x / 2; q[o + 1] = y / 2; q[o + 2] = z / 2; q[o + 3] = 1; normalise(q, o); return }
  const s = Math.sin(angle / 2) / angle
  q[o] = x * s; q[o + 1] = y * s; q[o + 2] = z * s; q[o + 3] = Math.cos(angle / 2)
}

/** Turns the quaternion at q[o] further by the rotation vector (x, y, z), applied after it (in the body frame). */
function turnQuat(q: Float64Array, o: number, x: number, y: number, z: number) {
  const angle = Math.sqrt(x * x + y * y + z * z)
  if (angle < 1e-15) return
  const s = Math.sin(angle / 2) / angle
  const dx = x * s, dy = y * s, dz = z * s, dw = Math.cos(angle / 2)
  const qx = q[o], qy = q[o + 1], qz = q[o + 2], qw = q[o + 3]
  q[o] = dw * qx + dx * qw + dy * qz - dz * qy
  q[o + 1] = dw * qy - dx * qz + dy * qw + dz * qx
  q[o + 2] = dw * qz + dx * qy - dy * qx + dz * qw
  q[o + 3] = dw * qw - dx * qx - dy * qy - dz * qz
  normalise(q, o)
}

function normalise(q: Float64Array, o: number) {
  const l = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]) || 1
  q[o] /= l; q[o + 1] /= l; q[o + 2] /= l; q[o + 3] /= l
}

/**
 * Rotational part of A (row-major), as a quaternion at q[o] used as the starting guess: Müller et al. 2016, "A Robust
 * Method to Extract the Rotational Part of Deformations". Stable for flat and line-like neighbourhoods (the turn about
 * a strand's own axis stays where it was).
 */
function extractRotation(A: Float64Array, q: Float64Array, o: number, iterations: number) {
  for (let iteration = 0; iteration < iterations; iteration++) {
    const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3]
    // columns of R
    const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + z * w), r20 = 2 * (x * z - y * w)
    const r01 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + x * w)
    const r02 = 2 * (x * z + y * w), r12 = 2 * (y * z - x * w), r22 = 1 - 2 * (x * x + y * y)
    // Σ r_c × a_c over the columns c, over |Σ r_c · a_c|
    const a00 = A[0], a10 = A[3], a20 = A[6], a01 = A[1], a11 = A[4], a21 = A[7], a02 = A[2], a12 = A[5], a22 = A[8]
    const cx = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12)
    const cy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22)
    const cz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02)
    const dot = r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22
    const k = 1 / (Math.abs(dot) + 1e-9)
    const ox = cx * k, oy = cy * k, oz = cz * k
    if (ox * ox + oy * oy + oz * oz < 1e-18) break
    turnQuat(q, o, ox, oy, oz)
  }
}

/** Writes the rigid transform x' = to + R (x − from) (R from the quaternion at q[o]) as a column-major matrix. */
function writeRigid(target: Float32Array, offset: number, q: Float64Array, o: number, tx: number, ty: number, tz: number, fx: number, fy: number, fz: number) {
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3]
  const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + z * w), r20 = 2 * (x * z - y * w)
  const r01 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + x * w)
  const r02 = 2 * (x * z + y * w), r12 = 2 * (y * z - x * w), r22 = 1 - 2 * (x * x + y * y)
  target[offset] = r00; target[offset + 1] = r10; target[offset + 2] = r20; target[offset + 3] = 0
  target[offset + 4] = r01; target[offset + 5] = r11; target[offset + 6] = r21; target[offset + 7] = 0
  target[offset + 8] = r02; target[offset + 9] = r12; target[offset + 10] = r22; target[offset + 11] = 0
  target[offset + 12] = tx - (r00 * fx + r01 * fy + r02 * fz)
  target[offset + 13] = ty - (r10 * fx + r11 * fy + r12 * fz)
  target[offset + 14] = tz - (r20 * fx + r21 * fy + r22 * fz)
  target[offset + 15] = 1
}
