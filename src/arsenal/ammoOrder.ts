import type { AmmoStats } from './ammoSource'

/** «Баллистика» (a player's proposal, №69, 06.11.2026): first the best penetration, the most damage, or the two together. */
export type AmmoOrder = 'penetration' | 'damage' | 'balance'

type Round = Pick<AmmoStats, 'damage' | 'penetration' | 'projectileCount'>

/** Every pellet of a shell counts: that is what hits. */
export const fleshDamage = (round: Round) => round.damage * Math.max(1, round.projectileCount ?? 1)

/**
 * Damage and penetration together: their product, so a round weak in either stays low, whichever calibers are compared. One pellet's
 * damage here: each has to go through the armor on its own, and fifteen pellets that do not are no balance.
 */
const balance = (round: Round) => round.damage * round.penetration

const ORDERS: Record<AmmoOrder, (a: Round, b: Round) => number> = {
  penetration: (a, b) => b.penetration - a.penetration || fleshDamage(b) - fleshDamage(a),
  damage: (a, b) => fleshDamage(b) - fleshDamage(a) || b.penetration - a.penetration,
  balance: (a, b) => balance(b) - balance(a) || b.penetration - a.penetration,
}

export function sortAmmo<T extends Round>(rounds: readonly T[], order: AmmoOrder): T[] {
  return [...rounds].sort(ORDERS[order])
}
