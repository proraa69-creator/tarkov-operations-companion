/**
 * Halloween (owner, 31.10.2026): from `from` to `until` (Moscow days, inclusive) every start shows the pumpkin mask
 * (gear/helmets.ts) and the «Кровавая луна» scheme (theme.ts), whatever was picked before; another one picked now lasts
 * until the app closes. Outside these days the player's own choice as always.
 */
export const HALLOWEEN = { from: '2026-10-24', until: '2026-11-11' }

export function isHalloween(now = Date.now()) {
  const day = new Date(now + 3 * 3600_000).toISOString().slice(0, 10)
  return day >= HALLOWEEN.from && day <= HALLOWEEN.until
}
