/** Colours and marks of the range's target (shared by the target, the results and the comparison). */
import { CM_PER_MOA_100M, type FiredShot } from './rangeShot'

/** Class colours of the armour overlay (1 light … 6 heavy). */
export const CLASS_COLORS = ['#5c6b60', '#6f8f74', '#8fae6b', '#c9b15a', '#d48a4f', '#c8604f', '#a04b6e']

export interface MarkStyle { fill: string; label: string }

export function markOf(shot: FiredShot): MarkStyle {
  if (shot.cover) return { fill: '#4a4f4b', label: 'cover' }
  if (!shot.outcome) return { fill: '#8b938d', label: 'miss' }
  const layers = shot.outcome.stages.flatMap((stage) => stage.layers)
  if (layers.some((layer) => layer.outcome === 'ricochet')) return { fill: '#6aa6c8', label: 'ricochet' }
  if (!shot.outcome.penetrated) return { fill: '#e0b552', label: 'stopped' }
  return { fill: '#e2574c', label: 'through' }
}

/** The group's diameter (cm) at a distance for a MOA. */
export function spreadAt(moa: number | undefined, distance: number) {
  return moa ? moa * CM_PER_MOA_100M * distance / 100 : undefined
}
