/**
 * Loose-part hints for the traders' 3D models (the Traders page figure), in the format of bossSwayHints.ts: weapons
 * and props rigid, the open coats' edges as cloth (owner, 11.10.2026: «физику одежды, в основном курток, если
 * расстёгнуты, чтобы края колыхались и сверху и снизу»). Boxes in fractions of the model height, measured on the
 * physics lab's views (scripts/bosses/physics-lab.mjs with PHYSICS_LAB_DIR=src/assets/trader-models).
 *
 * Peacekeeper (open parka), Therapist (open lab coat) and Ragman (open blazer) wear something that hangs loose: the free
 * edges of the open front, from the collar down, and the hem move; the coats themselves are thick shells lying on the
 * body and stay (moving whole skirts dragged the legs inside them along — owner: «не… кабура вместе с куском штанов»).
 * Everybody else stays still — the shape analysis would otherwise swing a stool's legs, a desk lamp or bootlaces.
 * Skier, Ragman and Lightkeeper: the owner's models of 12.10.2026 («модели оставшиеся устанавливай»); new Prapor and Jaeger
 * of 16.10.2026 («обнови 3д модели прапора и егеря»), simplified to ~40k vertices: still, like before.
 */
import type { BossSwayHints } from './bossSwayHints'

/** The whole scene (desk, crates, chair, dog): nothing on these traders hangs loose. */
const STILL: BossSwayHints = { rigid: [[-3, -1, -3, 3, 3, 3]] }

export const TRADER_SWAY_HINTS: Record<string, BossSwayHints> = {
  prapor: STILL,
  mechanic: STILL,
  jaeger: STILL,
  ref: STILL,
  fence: STILL,
  'btr-driver': STILL,
  peacekeeper: {
    rigid: [
      [-0.26, 0.37, -0.15, -0.153, 0.6, 0.01], // the pistol in the right hand, just outside the coat
      [0.1, 0.47, -0.06, 0.25, 0.64, 0.17], // the left hand in the coat pocket
    ],
    // the open parka: the edges of its front from the collar down and the hem all round
    cloth: [
      [-0.23, 0.36, -0.19, 0.24, 0.6, 0.17],
      [-0.12, 0.6, 0.02, 0.12, 0.86, 0.17],
    ],
  },
  therapist: {
    // the open lab coat: the edges of its front from the collar down and the hem all round
    cloth: [
      [-0.15, 0.32, -0.12, 0.15, 0.52, 0.11],
      [-0.1, 0.52, 0.0, 0.1, 0.82, 0.11],
    ],
  },
  // On a lighthouse balcony: the long coat hangs right behind the railing's bars, which the physics does not collide
  // with, so it stays still rather than swinging through them.
  lightkeeper: STILL,
  ragman: {
    rigid: [
      [-0.4, -0.05, -0.4, 0.4, 0.43, 0.4], // the bar stool and the legs, everything below the seat
      [-0.14, 0.42, 0.04, 0.06, 0.58, 0.36], // the right hand on the thigh
      [0.09, 0.55, -0.12, 0.21, 0.68, 0.2], // the left hand on the hip
    ],
    // the open blazer: the edges of its front from the lapels down and the flaps lying on the thighs
    cloth: [
      [-0.14, 0.56, 0.0, 0.09, 0.83, 0.3],
      [-0.19, 0.44, -0.06, 0.17, 0.57, 0.3],
    ],
  },
  // The open puffer vest is a thick shell lying on the body all round, its front edges included: the analysis pinned
  // every cloth particle (20 of 20 in a box over the whole vest), so nothing would move — held still like the others.
  skier: STILL,
}
