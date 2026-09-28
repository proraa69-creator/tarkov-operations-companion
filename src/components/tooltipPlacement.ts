export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface Box { left: number; top: number; right: number; bottom: number }

export interface PlacementInput {
  /** Marker anchor in map-container pixels. */
  point: { x: number; y: number }
  /** Icon rectangle relative to the anchor (top/left are usually negative). */
  icon: Box
  tooltip: { width: number; height: number }
  container: { width: number; height: number }
  /** Rectangles (container pixels) of interface blocks the tooltip must not cover. */
  reserved?: Box[]
  gap?: number
  margin?: number
}

export interface Placement { side: TooltipSide; offset: [number, number] }

/** Beside the icon first: above/below a marker near the map edge used to jump around. */
const ORDER: TooltipSide[] = ['right', 'left', 'bottom', 'top']

function rectFor(input: PlacementInput, side: TooltipSide): { box: Box; offset: [number, number] } {
  const { point, icon, tooltip } = input
  const gap = input.gap ?? 4
  let offset: [number, number]
  let box: Box
  if (side === 'top') {
    offset = [0, icon.top - gap]
    box = { left: point.x - tooltip.width / 2, right: point.x + tooltip.width / 2, bottom: point.y + offset[1], top: point.y + offset[1] - tooltip.height }
  } else if (side === 'bottom') {
    offset = [0, icon.bottom + gap]
    box = { left: point.x - tooltip.width / 2, right: point.x + tooltip.width / 2, top: point.y + offset[1], bottom: point.y + offset[1] + tooltip.height }
  } else {
    // Vertically centred on the icon, not on its anchor (which is the icon's foot for pins).
    const middle = (icon.top + icon.bottom) / 2
    offset = side === 'right' ? [icon.right + gap, middle] : [icon.left - gap, middle]
    const top = point.y + middle - tooltip.height / 2
    box = side === 'right'
      ? { left: point.x + offset[0], right: point.x + offset[0] + tooltip.width, top, bottom: top + tooltip.height }
      : { right: point.x + offset[0], left: point.x + offset[0] - tooltip.width, top, bottom: top + tooltip.height }
  }
  return { box, offset }
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
const area = (box: Box) => (box.right - box.left) * (box.bottom - box.top)

/**
 * Picks the side of the marker where the tooltip stays inside the map and off the reserved blocks.
 * The first side that fits completely wins (right, left, bottom, top); otherwise the least-covered one.
 */
export function chooseTooltipPlacement(input: PlacementInput): Placement {
  const margin = input.margin ?? 8
  const bounds: Box = { left: margin, top: margin, right: input.container.width - margin, bottom: input.container.height - margin }
  const reserved = input.reserved ?? []
  let best: { side: TooltipSide; offset: [number, number]; loss: number } | null = null
  for (const side of ORDER) {
    const { box, offset } = rectFor(input, side)
    const outside = area(box) - overlap(box, bounds)
    const covered = reserved.reduce((sum, block) => sum + overlap(box, block), 0)
    const loss = outside + covered
    if (loss === 0) return { side, offset }
    if (!best || loss < best.loss) best = { side, offset, loss }
  }
  return { side: best!.side, offset: best!.offset }
}
