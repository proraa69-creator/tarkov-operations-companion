import type { PricePoint } from '../data/economyApi'

/** Points from the last `days` days, counted back from the newest point (history can lag behind the clock). */
export function lastDays(points: PricePoint[], days: number): PricePoint[] {
  if (!points.length) return []
  const newest = points[points.length - 1].timestamp
  const from = newest - days * 86_400_000
  return points.filter((point) => point.timestamp >= from)
}

export interface ChartGeometry {
  line: string
  area: string
  min: number
  max: number
  first: number
  last: number
  /** Change from the first to the last point, percent. */
  change: number
  coords: Array<{ x: number; y: number; point: PricePoint }>
}

/** SVG path for a price line in a width × height box with `pad` px inside. */
export function chartGeometry(points: PricePoint[], width: number, height: number, pad = 4): ChartGeometry | null {
  if (points.length < 2) return null
  const prices = points.map((point) => point.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const t0 = points[0].timestamp
  const span = Math.max(1, points[points.length - 1].timestamp - t0)
  const range = max - min || 1
  const coords = points.map((point) => ({
    x: pad + ((point.timestamp - t0) / span) * (width - pad * 2),
    y: max === min ? height / 2 : pad + (1 - (point.price - min) / range) * (height - pad * 2),
    point,
  }))
  const round = (value: number) => Math.round(value * 10) / 10
  const line = coords.map(({ x, y }, index) => `${index ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ')
  const area = `${line} L${round(coords[coords.length - 1].x)} ${height} L${round(coords[0].x)} ${height} Z`
  const first = prices[0]
  const last = prices[prices.length - 1]
  return { line, area, min, max, first, last, change: first > 0 ? ((last - first) / first) * 100 : 0, coords }
}
