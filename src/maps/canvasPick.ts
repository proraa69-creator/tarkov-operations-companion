/** Marks a map click that picked a canvas point, so «clear the selection on a map click» leaves it. */
export const CANVAS_PICK = Symbol('raid-canvas-pick')

/**
 * When the last canvas point was picked. On a touch screen the map's `click` that follows the pick is not always the event the
 * pick was marked on (the phone, owner 18.11.2026: «точки на карте, спавны… их нажимаешь, и они никак не реагируют» — the pick
 * was made, then that same tap cleared it), so a click this soon after a pick is the pick's own.
 */
let pickedAt = -Infinity
const SAME_TAP_MS = 450

export function markCanvasPick(event: { originalEvent?: Event }, now = performance.now()) {
  if (event.originalEvent) (event.originalEvent as unknown as Record<symbol, boolean>)[CANVAS_PICK] = true
  pickedAt = now
}

export function wasCanvasPick(event: { originalEvent?: Event }, now = performance.now()) {
  return Boolean(event.originalEvent && (event.originalEvent as unknown as Record<symbol, boolean>)[CANVAS_PICK]) || now - pickedAt < SAME_TAP_MS
}
