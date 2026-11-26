/**
 * Whether an item is banned from the flea market. tarkov.dev marks a banned item with `types: noFlea`, but it renews that mark
 * later than its flea scanner sees the market: after the game's update of 24–25.11.2026 most cartridges sold on the flea again
 * in PvP and PvE (report 240: «После обновления патроны продаются на барахолке. M80, M856A1, CBJ…»; its scans showed offers
 * for 166 kinds that day) while `noFlea` stayed on every one of them, and the app wrote «Недоступно на барахолке».
 *
 * So the market itself decides: an item tarkov.dev's scanner saw offers for lately is on the flea, whatever the mark says. The
 * mark alone still bans the items nobody can list (their last offers are from before the ban, or there are none).
 */

/** Offers seen this recently prove the item is on the flea (tarkov.dev scans each mode every few hours). */
export const FLEA_OFFERS_PROOF_MS = 48 * 60 * 60 * 1000

/** A tarkov.dev item row: its `types` and its scanner's last look at the flea (`lastOfferCount`, `lastScan`). */
export interface FleaBanRow {
  types?: unknown
  lastOfferCount?: unknown
  lastScan?: unknown
}

/** tarkov.dev's scanner saw offers for the item within FLEA_OFFERS_PROOF_MS of `nowMs` (and not ahead of it). */
export function seenOnFleaLately(row: FleaBanRow, nowMs: number) {
  const offers = typeof row.lastOfferCount === 'number' && Number.isFinite(row.lastOfferCount) ? row.lastOfferCount : 0
  const scanned = typeof row.lastScan === 'string' || typeof row.lastScan === 'number' ? new Date(row.lastScan).getTime() : Number.NaN
  return offers > 0 && Number.isFinite(scanned) && scanned <= nowMs + 5 * 60_000 && nowMs - scanned <= FLEA_OFFERS_PROOF_MS
}

/** Banned from the flea: tarkov.dev's mark, unless its scanner saw the item on sale lately (see above). */
export function fleaBanned(row: FleaBanRow, nowMs: number) {
  const types = Array.isArray(row.types) ? row.types.map(String) : []
  return types.includes('noFlea') && !seenOnFleaLately(row, nowMs)
}
