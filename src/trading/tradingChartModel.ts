import { rowScans, type ForecastPoint, type RowScan, type SellForecast, type TradingRow } from '../domain/trading'

const HOUR = 3_600_000

export interface ChartInput {
  scans: readonly RowScan[]
  forecast: readonly ForecastPoint[]
  now: number
  current?: number
  /** The cheapest offer the player needs, when they have chosen a sum. */
  target?: number
  trader?: number
  sell?: SellForecast
  width: number
  height: number
}

export interface ChartPoint { x: number; y: number; at: number; price: number; forecast: boolean }
export interface ChartMark { x: number; y: number; at: number; price: number; offChart: boolean }

export interface ChartModel {
  left: number
  right: number
  top: number
  bottom: number
  line: string
  forecastLine: string
  forecastBand: string
  xTicks: Array<{ x: number; at: number; day: boolean }>
  yTicks: Array<{ y: number; price: number }>
  low?: ChartMark
  high?: ChartMark
  nowX: number
  targetY?: number
  traderY?: number
  sellBand?: { x: number; width: number }
  points: ChartPoint[]
}

const round = (value: number) => Math.round(value * 10) / 10

/** The scans of the chosen period, counted back from the newest. */
export function periodScans(row: Pick<TradingRow, 'series' | 'seriesFrom' | 'seriesAt'>, days: number): RowScan[] {
  const scans = rowScans(row)
  const newest = scans[scans.length - 1]?.at ?? 0
  return scans.filter((scan) => scan.at >= newest - days * 24 * HOUR)
}

/** Round price steps for the left of the chart. */
export function priceTicks(min: number, max: number, count = 5): number[] {
  const span = Math.max(1, max - min)
  const raw = span / Math.max(1, count - 1)
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? raw
  const ticks: number[] = []
  for (let price = Math.ceil(min / step) * step; price <= max; price += step) ticks.push(price)
  return ticks
}

/**
 * Where the dates and hours go, at the player's own clock: every 2, 3, 6, 12 or 24 hours, whichever leaves room for a label.
 * Midnight is the day's mark and reads as a date.
 */
export function timeTicks(from: number, to: number, pixels: number): Array<{ at: number; day: boolean }> {
  const perHour = pixels / Math.max(1, (to - from) / HOUR)
  const step = [2, 3, 6, 12, 24].find((hours) => hours * perHour >= 44) ?? 24
  // On a phone even the days do not fit: every second or third one then.
  const everyDays = Math.max(1, Math.ceil(44 / (24 * perHour)))
  const ticks: Array<{ at: number; day: boolean }> = []
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  for (let day = start.getTime(); day <= to; day = new Date(new Date(day).setDate(new Date(day).getDate() + everyDays)).getTime()) {
    for (let hour = 0; hour < 24; hour += step) {
      const at = new Date(day).setHours(hour, 0, 0, 0)
      if (at >= from && at <= to) ticks.push({ at, day: hour === 0 })
    }
  }
  return ticks
}

/** The period's line, the next two days dashed after «now», the needed price and when it usually comes. */
export function chartModel(input: ChartInput): ChartModel | null {
  const { scans, forecast, now, current, target, trader, sell, width, height } = input
  if (scans.length < 2) return null
  const left = 74
  const right = width - 10
  const top = 14
  const bottom = height - 26
  const floors = scans.map((scan) => scan.floor)
  const sorted = [...floors].sort((a, b) => a - b)
  const usualHigh = sorted[Math.ceil(sorted.length * 0.97) - 1]!
  const lowest = sorted[0]!
  const highest = sorted[sorted.length - 1]!
  const lows = [lowest, ...forecast.map((point) => point.low), ...(current ? [current] : [])]
  const highs = [usualHigh, ...forecast.map((point) => point.high), ...(current ? [current] : []), ...(target ? [target] : [])]
  const minPrice = Math.min(...lows) * 0.94
  // A lone spike would squash the rest: the frame ends a little over the usual high and the spike is marked at its edge.
  const maxPrice = Math.max(...highs) * 1.06
  const from = scans[0]!.at
  const to = Math.max(now + 48 * HOUR, forecast[forecast.length - 1]?.at ?? 0)
  const xOf = (at: number) => left + ((at - from) / Math.max(1, to - from)) * (right - left)
  const yOf = (price: number) => bottom - ((Math.min(maxPrice, Math.max(minPrice, price)) - minPrice) / Math.max(1, maxPrice - minPrice)) * (bottom - top)
  const path = (points: Array<{ x: number; y: number }>) => points.map(({ x, y }, index) => `${index ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ')
  const past: ChartPoint[] = scans.map((scan) => ({ x: xOf(scan.at), y: yOf(scan.floor), at: scan.at, price: scan.floor, forecast: false }))
  const anchor: ChartPoint | null = current ? { x: xOf(now), y: yOf(current), at: now, price: current, forecast: false } : null
  const ahead: ChartPoint[] = forecast.map((point) => ({ x: xOf(point.at), y: yOf(point.price), at: point.at, price: point.price, forecast: true }))
  const mark = (price: number): ChartMark => {
    const scan = scans.find((entry) => entry.floor === price)!
    return { x: xOf(scan.at), y: yOf(price), at: scan.at, price, offChart: price > maxPrice }
  }
  const bandTop = forecast.map((point) => ({ x: xOf(point.at), y: yOf(point.high) }))
  const bandBottom = forecast.map((point) => ({ x: xOf(point.at), y: yOf(point.low) })).reverse()
  const sellBand = sell?.state === 'window' && sell.from !== undefined && sell.to !== undefined
    ? { x: xOf(Math.min(sell.from, to)), width: Math.max(3, xOf(Math.min(sell.to, to)) - xOf(Math.min(sell.from, to))) }
    : undefined
  return {
    left, right, top, bottom,
    line: path(anchor ? [...past, anchor] : past),
    forecastLine: path([...(anchor ? [anchor] : []), ...ahead]),
    forecastBand: bandTop.length ? `${path([...bandTop, ...bandBottom])} Z` : '',
    xTicks: timeTicks(from, to, right - left).map((tick) => ({ ...tick, x: xOf(tick.at) })),
    yTicks: priceTicks(minPrice, maxPrice).map((price) => ({ y: yOf(price), price })),
    low: mark(lowest),
    high: mark(highest),
    nowX: xOf(now),
    ...(target ? { targetY: yOf(target) } : {}),
    ...(trader && trader > minPrice && trader < maxPrice ? { traderY: yOf(trader) } : {}),
    ...(sellBand ? { sellBand } : {}),
    points: [...past, ...(anchor ? [anchor] : []), ...ahead],
  }
}
