/**
 * Secondary physics of the boss models (Gallery 3D viewer): material profiles per kind of loose element and the
 * global settings. Every number is in SI units for a figure BODY_HEIGHT metres tall (the models are scaled to that),
 * so the values read like real materials: mass in kg, stiffness as a natural frequency in Hz (mass independent),
 * damping and drag in 1/s, distances in metres, angles in degrees.
 *
 * Elements (physics/rig.ts decides which is which from the shape analysis and the model's hints):
 * - cloth   — capes, cloaks, coat hems, loincloths, tabards, ghillie strips: a sheet of particles;
 * - strap   — rifle slings, ropes, loose straps and cords: a chain, usually pinned at both ends;
 * - hair    — dreadlocks and ponytails: chains hanging from the scalp;
 * - antenna — radio antennas: a stiff chain that whips and springs back to its shape;
 * - pouch   — small pouches and pockets: a light rigid body swinging about its top seam;
 * - gear    — holsters, backpacks, bags, hoods: a heavier rigid body swinging about its strap point.
 * The body, the head, the arms and legs, weapons and rigid armour never move (they are not part of any element).
 */

/** A sheet or chain of particles (cloth, strap, hair, antenna). */
export interface ParticleProfile {
  /** Mass of one particle, kg. Heavier particles shrug off air drag and wind. */
  mass: number
  /** Stretch stiffness: natural frequency of the distance constraints, Hz (higher = stiffer; 0 = rigid links). */
  stretchHz: number
  /** Bending stiffness: how fast a bent region springs back to its sculpted shape (up to a turn), Hz (0 = folds freely). */
  bendHz: number
  /** Elasticity: frequency of the spring that brings every particle back to its rest shape, Hz (0 = none); a hanging
   * part also gets the pull back of a pendulum of its length. */
  shapeHz: number
  /** Shape spring multiplier at the attachment (the seam end of the element), × at mobility 0. */
  rootShape: number
  /** Damping of motion relative to the body, 1/s. */
  damping: number
  /** Air drag, N·s/m per particle (divided by the mass: light cloth trails, heavy gear does not). */
  drag: number
  /** Gravity multiplier. */
  gravity: number
  /** Reaction to the body's acceleration and turning (inertial forces), 0..1. */
  inertia: number
  /** Max distance a particle may move away from its rest position at full mobility, m (a soft limit from 60 % on). */
  maxDistance: number
  /** Max stretch along the element (distance to its attachment over the rest length − 1). */
  maxStretch: number
  /** Collision radius against the body, m (0 = no collisions). */
  collisionRadius: number
  /** Distance between particles, m. */
  spacing: number
}

/** A rigid piece swinging about a pivot (pouch, gear). */
export interface PieceProfile {
  /** Mass, kg (only affects air drag). */
  mass: number
  /** Natural frequency of the swing back to the rest pose, Hz, for a piece of `size`. */
  frequencyHz: number
  /** Radius of gyration about the pivot at which `frequencyHz` holds, m: a smaller piece on the same straps is stiffer. */
  size: number
  /** Damping ratio (0.2 = a couple of overshoots, 1 = no overshoot). */
  dampingRatio: number
  /** Air drag, N·s/m (divided by the mass). */
  drag: number
  gravity: number
  inertia: number
  /** Swing limits, degrees: away from the body, into the body, sideways, twist about the vertical. */
  limits: { out: number; in: number; side: number; twist: number }
}

export type ParticleKind = 'cloth' | 'strap' | 'hair' | 'antenna'
export type PieceKind = 'pouch' | 'gear'

export interface PhysicsSettings {
  /** Height the models are scaled to, m. */
  bodyHeight: number
  /** m/s². */
  gravity: number
  /** Fixed simulation rate, Hz: the result does not depend on the frame rate. */
  substepHz: number
  /** At most this many substeps per frame (a long frame is cut short, not slowed down). */
  maxSubsteps: number
  /** Constraint passes per substep (links, then the limits and the body). */
  iterations: number
  /** Turning faster than this (rad/s) or accelerating harder (rad/s², m/s²) is clamped for the inertial forces. */
  maxAngularSpeed: number
  maxAngularAcceleration: number
  maxLinearAcceleration: number
  /** Time constant of the motion smoothing (pointer jitter), s. */
  motionSmoothing: number
  /** A frame that moves the model further than this (m) or turns it further (rad) is a teleport: no inertia. */
  teleportDistance: number
  teleportAngle: number
  /** Particles slower than this (m/s) for sleepTime (s) with the model at rest: the simulation sleeps. */
  sleepSpeed: number
  sleepTime: number
  /** Particle speed limit relative to the body, m/s. */
  maxSpeed: number
  /** Idle wind, m/s (0 = still air). */
  wind: number
}

export const PHYSICS_SETTINGS: PhysicsSettings = {
  bodyHeight: 1.8,
  gravity: 9.81,
  substepHz: 120,
  maxSubsteps: 10,
  iterations: 3,
  maxAngularSpeed: 9,
  maxAngularAcceleration: 140,
  maxLinearAcceleration: 40,
  motionSmoothing: 0.025,
  teleportDistance: 0.9,
  teleportAngle: 1.2,
  sleepSpeed: 0.004,
  sleepTime: 0.5,
  maxSpeed: 8,
  wind: 0,
}

export const PARTICLE_PROFILES: Record<ParticleKind, ParticleProfile> = {
  // soft and light: trails behind a turn, flares out a little, folds; settles in about two seconds
  cloth: { mass: 0.02, stretchHz: 45, bendHz: 2.2, shapeHz: 0.5, rootShape: 8, damping: 2.6, drag: 0.04, gravity: 1, inertia: 1, maxDistance: 0.3, maxStretch: 0.015, collisionRadius: 0.012, spacing: 0.055 },
  // slings, ropes, straps: hardly stretch, bend freely, a bit heavier than cloth
  strap: { mass: 0.03, stretchHz: 80, bendHz: 1.2, shapeHz: 0.4, rootShape: 8, damping: 3, drag: 0.04, gravity: 1, inertia: 1, maxDistance: 0.18, maxStretch: 0.01, collisionRadius: 0.01, spacing: 0.03 },
  // hair and dreads: flexible, keep their fall, lively
  hair: { mass: 0.01, stretchHz: 70, bendHz: 1.6, shapeHz: 0.8, rootShape: 6, damping: 3.2, drag: 0.03, gravity: 1, inertia: 1, maxDistance: 0.14, maxStretch: 0.02, collisionRadius: 0.012, spacing: 0.03 },
  // antennas: springy rods, whip on a turn and spring back to their shape
  antenna: { mass: 0.01, stretchHz: 120, bendHz: 14, shapeHz: 4.5, rootShape: 4, damping: 4, drag: 0.003, gravity: 0.3, inertia: 1, maxDistance: 0.12, maxStretch: 0.005, collisionRadius: 0, spacing: 0.025 },
}

export const PIECE_PROFILES: Record<PieceKind, PieceProfile> = {
  // pouches: light, quick, a small wobble on their straps
  pouch: { mass: 0.4, frequencyHz: 4, size: 0.06, dampingRatio: 0.3, drag: 0.08, gravity: 1, inertia: 1, limits: { out: 8, in: 0.5, side: 6, twist: 3 } },
  // holsters, backpacks, bags: heavy and restrained
  gear: { mass: 2.5, frequencyHz: 2.5, size: 0.15, dampingRatio: 0.35, drag: 0.15, gravity: 1, inertia: 1, limits: { out: 6, in: 0.5, side: 5, twist: 2 } },
}

/** Per-model overrides (bossSwayHints.ts `physics`): any field of any profile. */
export interface PhysicsOverrides {
  cloth?: Partial<ParticleProfile>
  strap?: Partial<ParticleProfile>
  hair?: Partial<ParticleProfile>
  antenna?: Partial<ParticleProfile>
  pouch?: Partial<Omit<PieceProfile, 'limits'>> & { limits?: Partial<PieceProfile['limits']> }
  gear?: Partial<Omit<PieceProfile, 'limits'>> & { limits?: Partial<PieceProfile['limits']> }
}

export const PARTICLE_KINDS: ParticleKind[] = ['cloth', 'strap', 'hair', 'antenna']
export const PIECE_KINDS: PieceKind[] = ['pouch', 'gear']

export function particleProfile(kind: ParticleKind, overrides?: PhysicsOverrides): ParticleProfile {
  return { ...PARTICLE_PROFILES[kind], ...overrides?.[kind] }
}

export function pieceProfile(kind: PieceKind, overrides?: PhysicsOverrides): PieceProfile {
  const base = PIECE_PROFILES[kind], extra = overrides?.[kind]
  return { ...base, ...extra, limits: { ...base.limits, ...extra?.limits } }
}
