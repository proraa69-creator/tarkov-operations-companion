interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface Bounds extends Point, Size {}

/** All coordinates are Electron DIP, including monitors with a negative origin. */
export function itemCardBounds(point: Point, area: Bounds, size: Size): Bounds {
  const margin = 4
  const width = Math.min(Math.max(1, Math.round(size.width)), Math.max(1, area.width - margin * 2))
  const height = Math.min(Math.max(1, Math.round(size.height)), Math.max(1, area.height - margin * 2))
  const right = area.x + area.width - margin
  const bottom = area.y + area.height - margin
  let x = point.x + 16
  let y = point.y + 22
  if (x + width > right) x = point.x - width - 16
  if (y + height > bottom) y = point.y - height - 12
  return {
    x: Math.round(Math.max(area.x + margin, Math.min(x, right - width))),
    y: Math.round(Math.max(area.y + margin, Math.min(y, bottom - height))),
    width,
    height,
  }
}
