/**
 * Hand-measured corrections for the Gallery's secondary physics (swayWeights.ts analysis, physics/rig.ts), per boss
 * model. The automatic shape analysis cannot tell a rifle barrel from a strap or a holster from a pouch, so each model
 * lists:
 * - rigid: weapons and weapon parts (barrels, stocks, magazines, launchers, blades) — they never move;
 * - pieces: holsters, backpacks, buckles, hoods… that swing as ONE rigid piece about a pivot (default: the top
 *   centre of the box); `amount` scales the swing; `more` adds boxes to the same piece (a rifle strapped to a
 *   backpack); `whole`: a backpack or a bag moves as one item, blending into the body only where it touches it;
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
  pieces?: { box: HintBox; more?: HintBox[]; pivot?: readonly [number, number, number]; amount?: number; whole?: boolean }[]
  whips?: { box: HintBox; amount?: number }[]
  hair?: { box: HintBox; root: number; reach?: number; amount?: number }[]
  /** Parts that swing too far for their size (a short rope): their swing is scaled down. */
  soften?: { box: HintBox; factor: number }[]
  /**
   * Capes and cloaks the shape analysis rejects: thick folds read as lumps and long straight strips as blades. Inside
   * these boxes folds count as cloth and every thin piece hanging from its top seam is a cloth sheet.
   */
  cloth?: HintBox[]
  /**
   * A coat skirt hanging round the legs that the voxels merge with them (the gap is thinner than a voxel and the mesh
   * fuses them in places): inside these boxes every part of the surface that is a thin sheet — its other side within
   * `thickness` (fraction of height, default 0.03) along the inward normal — is cloth hanging from its top seam, and
   * the legs inside (thick) stay body.
   */
  sheet?: { box: HintBox; thickness?: number }[]
  /** Material settings for this model (mass, stiffness, damping, limits, collisions per kind of element). */
  physics?: PhysicsOverrides
}

export const BOSS_SWAY_HINTS: Record<string, BossSwayHints> = {
  partisan: {
    rigid: [
      // AK-74M with the GP-25, held across the body muzzle down: below the rope hanging from his fist (the rope's end
      // reached into the rifle's box, was held there and the rope did not move at all: owner, 12.10.2026)
      [-0.17, 0.45, -0.01, -0.06, 0.62, 0.27],
      [-0.06, 0.45, -0.01, 0.16, 0.66, 0.27],
    ],
    pieces: [
      { box: [-0.07, 0.6, -0.25, 0.13, 0.84, -0.14], whole: true }, // backpack
      { box: [-0.16, 0.36, -0.2, -0.09, 0.48, -0.09] }, // thigh pouch
      { box: [-0.02, 0.42, -0.21, 0.04, 0.53, -0.13] }, // knife sheath at the back
    ],
    // the rope looped in his fist (his only strap): a stiff cord that swings as a whole and keeps its loop
    physics: { strap: { bendHz: 10, airSoftness: 0.1, shapeHz: 1.2, inertia: 0.5, damping: 5 } },
  },
  shturman: {
    rigid: [[-0.085, 0.69, -0.01, 0.1, 0.89, 0.33]], // SVDS (the sling below it keeps swinging)
    pieces: [{ box: [-0.11, 0.55, -0.32, 0.16, 0.87, -0.15], pivot: [0.02, 0.86, -0.18], whole: true }], // backpack
  },
  'goon-1': {
    rigid: [[-0.07, 0.49, 0.0, 0.21, 0.79, 0.27]], // RSASS in the hands
    whips: [{ box: [-0.09, 0.81, -0.2, -0.01, 1.0, -0.13] }], // radio antenna over the backpack
    pieces: [{
      // the backpack and the two long guns strapped to its sides move as one: held still, the gun on its left side kept
      // that part of the backpack with it and the backpack broke in two (owner, 12.10.2026)
      box: [-0.1, 0.5, -0.27, 0.05, 0.81, -0.11],
      more: [
        [0.04, 0.5, -0.26, 0.12, 0.87, -0.12], // its left side and the gun on it
        [0.04, 0.41, -0.24, 0.12, 0.5, -0.155], // that gun's end below it, clear of the hip
        [-0.16, 0.62, -0.22, -0.09, 0.86, -0.14], // the rifle on its right side, clear of the arm
        [-0.18, 0.39, -0.21, -0.1, 0.62, -0.158], // the rifle below it, clear of the hip
      ],
      pivot: [-0.02, 0.8, -0.13],
      // the guns reach down to the hips: a smaller swing keeps their ends by the hips
      amount: 0.6,
      whole: true,
    }],
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
      { box: [-0.11, 0.62, -0.16, 0.045, 0.81, -0.085], pivot: [-0.03, 0.81, -0.1], whole: true }, // assault pack
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
    // radio antenna on the left shoulder: the thin rod from the radio (y 0.8) to its tip (0.925), off the rifle's box
    whips: [{ box: [0.075, 0.8, -0.025, 0.115, 0.95, 0.025] }],
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
  // the medic bag on his back stays still: its box moved the jacket's back with it while the bag itself, out at his
  // side, did not (owner, 12.10.2026: «убери сзади анимацию»)
  sanitar: {
    rigid: [[-0.32, 0.7, 0.0, 0.25, 0.86, 0.3]], // rifle
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
      // backpack, with its left side panel reaching forward along the flank (cut by the box, the backpack broke in two
      // along its side: owner, 12.10.2026)
      { box: [-0.08, 0.6, -0.32, 0.21, 0.89, -0.16], more: [[0.13, 0.62, -0.17, 0.235, 0.87, -0.075]], pivot: [0.06, 0.89, -0.17], whole: true },
      { box: [-0.19, 0.33, -0.06, -0.115, 0.48, 0.07] }, // holster on the right thigh
    ],
  },
  // the long leather coat, open in front: the two front flaps from the chest and the skirt below the hips hang free of
  // the body and swing as heavy cloth — sagging and pulling the leather down after it, not wobbling like jelly (owner,
  // 12.10.2026); the shape analysis took the flaps for cords and held most of the skirt
  kaban: {
    cloth: [
      [-0.32, 0.3, -0.08, -0.1, 0.72, 0.22], // the right front flap, below his raised fist
      [0.07, 0.3, -0.05, 0.32, 0.62, 0.25], // the left front flap, beside his fist at the belly
      [-0.32, 0.3, -0.3, 0.32, 0.48, -0.04], // the skirt behind the legs
    ],
    physics: {
      cloth: { mass: 0.05, stretchHz: 90, bendHz: 1.6, shapeHz: 0.25, rootShape: 6, airSoftness: 0.5, damping: 2.4, drag: 0.03, maxDistance: 0.25, collisionRadius: 0.015 },
    },
  },
  kollontay: {
    rigid: [[-0.3, 0.0, -0.05, -0.08, 0.8, 0.36]], // RPD standing by his leg
  },
  // the owner's new model of 19.10.2026 («обнови модель решалы»): jacket, trousers and boots fit tight, nothing hangs
  // («у Решалы нечего добавлять вообще») — he stays rigid
  reshala: {
    rigid: [[-0.6, 0.0, -0.6, 0.6, 1.2, 0.6]],
  },
  // Жрец культа (owner, 19.10.2026: «физику плаща — именно в тех местах, где он висит, спереди и сзади, без растяжений,
  // с инерцией, с тяжестью, с провисанием»): the long hooded coat is tight down to the belt (y ≈ 0.5) and hangs free from
  // there to the knees (hem y ≈ 0.28) around the legs; the body is centred at z ≈ −0.09 (the SMG held forward moves the
  // box centre). Only the skirt below the belt is cloth; the SMG and the hands on it never move.
  'cultist-priest': {
    rigid: [[-0.1, 0.52, -0.02, 0.14, 0.74, 0.34]], // SMG held at the chest (the hands on it)
    // the whole skirt round the legs, front and back: a sheet a few millimetres thick, the legs inside stay body
    sheet: [{ box: [-0.2, 0.26, -0.28, 0.2, 0.5, 0.12], thickness: 0.03 }],
    physics: {
      cloth: { mass: 0.06, stretchHz: 110, bendHz: 1.4, shapeHz: 0.22, rootShape: 7, airSoftness: 0.45, damping: 2.6, drag: 0.03, maxDistance: 0.2, collisionRadius: 0.016 },
    },
  },
  wadge: {
    rigid: [[-0.1, 0.58, 0.0, 0.2, 0.8, 0.28]], // MP7
    whips: [{ box: [0.1, 0.72, -0.14, 0.16, 0.84, -0.06] }], // radio antenna
    pieces: [
      { box: [-0.2, 0.3, -0.06, -0.12, 0.5, 0.06] }, // holster on the right thigh
      { box: [0.11, 0.33, -0.06, 0.2, 0.5, 0.06] }, // pouch on the left thigh
    ],
  },
  // the owner's new model of 16.10.2026 («замени модель рейдера»), simplified to ~47k vertices.
  // nothing hangs loose on him (tight plate carrier, pouches, knee pads): the shape analysis only finds bootlaces and a
  // glove cuff, which must not twitch — he stays rigid
  raiders: {
    rigid: [[-0.6, 0.0, -0.6, 0.6, 1.2, 0.6]],
  },
  military: {
    rigid: [[-0.22, 0.48, 0.0, 0.2, 0.8, 0.3]], // rifle
    pieces: [
      { box: [-0.2, 0.33, -0.06, -0.12, 0.5, 0.06] }, // holster on the right thigh
      { box: [-0.12, 0.58, -0.24, 0.12, 0.84, -0.1], pivot: [0.0, 0.84, -0.12], whole: true }, // backpack
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
      // the rifle on the back over the cape: only the rifle (its stock and the pouch on it), not the cape around it
      [-0.17, 0.55, -0.2, -0.125, 0.96, -0.04],
      [-0.15, 0.68, -0.2, -0.045, 0.85, -0.04],
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
