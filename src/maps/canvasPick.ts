/** Marks a map click that picked a canvas point, so «clear the selection on a map click» leaves it. */
export const CANVAS_PICK = Symbol('raid-canvas-pick')

export function wasCanvasPick(event: { originalEvent?: Event }) {
  return Boolean(event.originalEvent && (event.originalEvent as unknown as Record<symbol, boolean>)[CANVAS_PICK])
}
