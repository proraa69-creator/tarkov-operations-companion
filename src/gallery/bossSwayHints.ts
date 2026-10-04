/**
 * Hand-measured corrections for the Gallery's secondary physics (swayWeights.ts analysis, physics/rig.ts), per boss
 * model. The automatic shape analysis cannot tell a rifle barrel from a strap or a holster from a pouch, so each model
 * lists:
 * - rigid: weapons and weapon parts (barrels, stocks, magazines, launchers, blades) — they never move;
 * - pieces: holsters, backpacks, buckles, hoods… that swing as ONE rigid piece about a pivot (default: the top
 *   centre of the box); `amount` scales the swing;
 * - whips: radio antennas, fixed at the bottom of the box and bending more towards the tip;
 * - hair: dreads and strands in the box hang from `root` (the scalp line) and swing like hair;
 * - soften: a part that swings too far for its size moves less;
 * - physics: material settings of this model's elements, over the defaults of physics/config.ts.
 * Boxes are [x0, y0, z0, x1, y1, z1] in fractions of the model height: y from the feet, x and z from the centre
 * of the model's bounding box; +z is the model's front and +x is on the viewer's right when looking at its face.
 * Measured on orthographic renders with a grid (September 2026).
 */
import type { PhysicsOverrides } from './physics/config'

export type HintBox = readonly [number, number, number, number, number, number]

export interface BossSwayHints {
  rigid?: HintBox[]
  pieces?: { box: HintBox; pivot?: readonly [number, number, number]; amount?: number }[]
  whips?: { box: HintBox; amount?: number }[]
  hair?: { box: HintBox; root: number; reach?: number; amount?: number }[]
  /** Parts that swing too far for their size (a short rope): their swing is scaled down. */
  soften?: { box: HintBox; factor: number }[]
  /**
   * Capes and cloaks the shape analysis rejects: thick folds read as lumps and long straight strips as blades. Inside
   * these boxes folds count as cloth and every thin piece hanging from its top seam is a cloth sheet.
   */
  cloth?: HintBox[]
  /** Material settings for this model (mass, stiffness, damping, limits, collisions per kind of element). */
  physics?: PhysicsOverrides
}

export const BOSS_SWAY_HINTS: Record<string, BossSwayHints> = {
  reshala: {
    rigid: [[0.1, 0.15, -0.1, 0.21, 0.53, 0.075]], // AK in the right hand, muzzle down
    pieces: [{ box: [-0.08, 0.79, -0.14, 0.08, 0.9, -0.075] }], // hood on the back
  },
  partisan: {
    rigid: [[-0.17, 0.45, -0.01, 0.16, 0.66, 0.27]], // AK-74M with the GP-25
    pieces: [
      { box: [-0.07, 0.6, -0.25, 0.13, 0.84, -0.14] }, // backpack
      { box: [-0.16, 0.36, -0.2, -0.09, 0.48, -0.09] }, // thigh pouch
      { box: [-0.02, 0.42, -0.21, 0.04, 0.53, -0.13] }, // knife sheath at the back
    ],
    soften: [{ box: [-0.2, 0.6, -0.05, 0.0, 0.85, 0.25], factor: 0.4 }], // the rope in his hand
  },
  shturman: {
    rigid: [[-0.085, 0.69, -0.01, 0.1, 0.89, 0.33]], // SVDS (the sling below it keeps swinging)
    pieces: [{ box: [-0.11, 0.55, -0.32, 0.16, 0.87, -0.15], pivot: [0.02, 0.86, -0.18] }], // backpack
  },
  'goon-1': {
    rigid: [
      [-0.07, 0.49, 0.0, 0.21, 0.79, 0.27], // RSASS in the hands
      [0.05, 0.42, -0.24, 0.14, 0.86, -0.1], // rifle strapped to the backpack
    ],
    whips: [{ box: [-0.09, 0.81, -0.2, -0.01, 1.0, -0.13] }], // radio antenna over the backpack
    pieces: [{ box: [-0.09, 0.51, -0.26, 0.045, 0.8, -0.11], pivot: [-0.02, 0.8, -0.13] }], // backpack
  },
  'goon-2': {
    rigid: [
      [-0.26, 0.69, 0.02, 0.27, 0.81, 0.16], // SPEAR across the chest
      [-0.058, 0.84, 0.0, 0.03, 0.975, 0.14], // skull mask (the dreads around it swing)
    ],
    whips: [
      { box: [0.05, 0.82, -0.01, 0.09, 0.99, 0.1] }, // antenna in front of the left shoulder
      { box: [0.03, 0.76, -0.15, 0.08, 0.87, -0.1] }, // antenna on the back
    ],
    pieces: [
      { box: [-0.17, 0.43, -0.01, -0.126, 0.64, 0.07] }, // pistol holster on the right thigh
      { box: [-0.11, 0.62, -0.16, 0.045, 0.81, -0.085], pivot: [-0.03, 0.81, -0.1] }, // assault pack
    ],
    hair: [{ box: [-0.11, 0.866, -0.14, 0.11, 1.0, 0.11], root: 0.955, reach: 0.06 }], // all the dreads
  },
  'goon-3': {
    rigid: [
      [-0.2, 0.55, 0.0, 0.18, 0.84, 0.3], // M32A1 launcher in the hands
      [0.02, 0.38, -0.2, 0.2, 0.84, 0.0], // shotgun slung on the left hip
    ],
    pieces: [{ box: [-0.17, 0.49, -0.04, -0.105, 0.62, 0.06] }], // holster on the right hip
    hair: [{ box: [-0.05, 0.84, -0.16, 0.05, 0.95, -0.075], root: 0.94, reach: 0.05 }], // ponytail
  },
  glukhar: {
    rigid: [[-0.12, 0.58, 0.0, 0.2, 0.8, 0.3]], // ASh-12
  },
  'black-division': {
    rigid: [[-0.13, 0.46, 0.0, 0.1, 0.8, 0.28]], // rifle
    whips: [{ box: [0.06, 0.84, -0.08, 0.12, 0.96, 0.02] }], // radio antenna on the left shoulder
    pieces: [
      { box: [-0.2, 0.36, -0.07, -0.115, 0.52, 0.07] }, // drop-leg pouch, right thigh
      { box: [0.115, 0.36, -0.07, 0.2, 0.52, 0.07] }, // drop-leg pouch, left thigh
    ],
  },
  killa: {
    rigid: [[-0.26, 0.6, -0.08, -0.08, 1.0, 0.16]], // RPK held up
    pieces: [
      { box: [-0.18, 0.33, -0.05, -0.12, 0.46, 0.06] }, // holster on the right thigh
      { box: [0.11, 0.33, -0.05, 0.17, 0.46, 0.06] }, // pouch on the left thigh
    ],
  },
  tagilla: {
    rigid: [
      [-0.33, 0.44, -0.05, 0.4, 0.82, 0.25], // sledgehammer
      [-0.22, 0.35, -0.2, -0.08, 0.97, -0.02], // rifle on the back
    ],
  },
  'tagilla-2': {
    rigid: [
      [-0.35, 0.4, -0.05, 0.35, 0.85, 0.3], // scythe
      [-0.24, 0.35, -0.2, -0.1, 0.97, -0.02], // rifle on the back
    ],
  },
  sanitar: {
    rigid: [[-0.32, 0.7, 0.0, 0.25, 0.86, 0.3]], // rifle
    pieces: [{ box: [-0.18, 0.55, -0.22, 0.02, 0.76, -0.08], pivot: [-0.06, 0.8, -0.1] }], // medic bag over the shoulder
  },
  zryachiy: {
    rigid: [
      [-0.2, 0.3, 0.05, 0.14, 0.8, 0.3], // rifle held across the body
      [-0.1, 0.3, -0.25, 0.2, 0.82, -0.1], // rifle and axe on the back
    ],
  },
  rogue: {
    rigid: [[-0.15, 0.53, 0.0, 0.12, 0.78, 0.3]], // rifle
    pieces: [
      { box: [-0.08, 0.6, -0.32, 0.21, 0.89, -0.16], pivot: [0.06, 0.89, -0.17] }, // backpack
      { box: [-0.19, 0.33, -0.06, -0.115, 0.48, 0.07] }, // holster on the right thigh
    ],
  },
  kollontay: {
    rigid: [[-0.3, 0.0, -0.05, -0.08, 0.8, 0.36]], // RPD standing by his leg
  },
  wadge: {
    rigid: [[-0.1, 0.58, 0.0, 0.2, 0.8, 0.28]], // MP7
    whips: [{ box: [0.1, 0.72, -0.14, 0.16, 0.84, -0.06] }], // radio antenna
    pieces: [
      { box: [-0.2, 0.3, -0.06, -0.12, 0.5, 0.06] }, // holster on the right thigh
      { box: [0.11, 0.33, -0.06, 0.2, 0.5, 0.06] }, // pouch on the left thigh
    ],
  },
  military: {
    rigid: [[-0.22, 0.48, 0.0, 0.2, 0.8, 0.3]], // rifle
    pieces: [
      { box: [-0.2, 0.33, -0.06, -0.12, 0.5, 0.06] }, // holster on the right thigh
      { box: [-0.12, 0.58, -0.24, 0.12, 0.84, -0.1], pivot: [0.0, 0.84, -0.12] }, // backpack
    ],
  },
  'black-division-old': {
    rigid: [[-0.15, 0.4, 0.04, 0.26, 0.75, 0.32]], // rifle and the sling hanging under it
  },
  'killa-knight': {
    rigid: [[-0.4, 0.0, -0.15, -0.05, 0.56, 0.15], [0.1, 0.25, -0.1, 0.32, 0.68, 0.2], [-0.1, 0.4, -0.23, 0.03, 0.57, -0.1]], // sword, shield, dagger at the back
  },
  'reshala-knight': {
    rigid: [[-0.4, 0.0, -0.05, -0.1, 0.56, 0.2], [0.05, 0.3, 0.02, 0.2, 0.72, 0.3]], // sword, shield
  },
  'tagilla-knight': {
    rigid: [
      [-0.32, 0.44, 0.06, 0.2, 0.66, 0.26], // sledgehammer handle
      [0.12, 0.5, -0.08, 0.42, 0.8, 0.22], // sledgehammer head
      [-0.2, 0.55, -0.2, -0.05, 0.96, -0.04], // rifle on the back
    ],
  },
  'tagilla-2-knight': {
    rigid: [
      [0.12, 0.38, -0.2, 0.34, 0.86, 0.3], // scythe blade
      [-0.35, 0.38, 0.0, 0.2, 0.85, 0.3], // scythe shaft
      [-0.24, 0.42, -0.22, -0.08, 0.97, -0.02], // rifle on the back
    ],
  },
}
