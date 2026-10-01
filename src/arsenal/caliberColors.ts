import type { AmmoStats } from './ammoSource'

/** Categorical hues (dataviz reference palette, dark-surface steps) in fixed order; never cycled. */
export const CALIBER_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
export const OTHER_CALIBER_COLOR = '#8a8d91'

/**
 * Colour per caliber: the calibers with the most rounds get the palette slots in order, the rest share a neutral grey
 * («Прочие»). Computed from the full list so a caliber filter never repaints the survivors.
 */
export function caliberColors(ammo: Pick<AmmoStats, 'caliber'>[]) {
  const counts = new Map<string, number>()
  for (const round of ammo) counts.set(round.caliber, (counts.get(round.caliber) ?? 0) + 1)
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([caliber]) => caliber)
  const colors = new Map<string, string>()
  ordered.forEach((caliber, index) => colors.set(caliber, CALIBER_PALETTE[index] ?? OTHER_CALIBER_COLOR))
  return { colors, ordered, colorOf: (caliber: string) => colors.get(caliber) ?? OTHER_CALIBER_COLOR }
}

export interface LabelBox { x: number; y: number; width: number; height: number }

/** Greedy label placement: a label is shown only if its box does not overlap one already placed. */
export function placeLabels<T extends { box: LabelBox }>(candidates: T[]): T[] {
  const placed: T[] = []
  for (const candidate of candidates) {
    const a = candidate.box
    const hit = placed.some(({ box: b }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
    if (!hit) placed.push(candidate)
  }
  return placed
}
