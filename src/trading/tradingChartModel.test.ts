import { describe, expect, it } from 'vitest'
import { chartModel, periodScans, priceTicks, timeTicks } from './tradingChartModel'

const HOUR = 3_600_000
const NOW = new Date(2026, 10, 5, 12, 0, 0, 0).getTime()
const scans = (floorAt: (index: number) => number, count = 36) => Array.from({ length: count }, (_, index) => ({ at: NOW - (count - 1 - index) * 2 * HOUR, floor: floorAt(index) }))
const base = { forecast: [], now: NOW, width: 900, height: 300 }

describe('the chart of «Торговля»', () => {
  it('dates at midnight and hours in between, at the player’s own clock, as many as fit', () => {
    const wide = timeTicks(NOW - 72 * HOUR, NOW, 1600)
    const days = wide.filter((tick) => tick.day)
    expect(days.length).toBe(3)
    for (const tick of days) expect(new Date(tick.at).getHours()).toBe(0)
    expect(wide.filter((tick) => !tick.day).length).toBeGreaterThan(days.length)
    const narrow = timeTicks(NOW - 72 * HOUR, NOW, 200)
    expect(narrow.length).toBeLessThan(wide.length)
    expect(narrow.every((tick) => tick.day)).toBe(true)
  })

  it('labels never run into each other, even on a phone over nine days', () => {
    const ticks = timeTicks(NOW - 168 * HOUR, NOW + 48 * HOUR, 256)
    const perPixel = (216 * HOUR) / 256
    for (let index = 1; index < ticks.length; index += 1) expect((ticks[index]!.at - ticks[index - 1]!.at) / perPixel).toBeGreaterThanOrEqual(44)
  })

  it('round prices at the left', () => {
    const ticks = priceTicks(12_345, 98_765)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.every((price) => price % 1000 === 0)).toBe(true)
    expect(ticks[0]).toBeGreaterThanOrEqual(12_345)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(98_765)
  })

  it('marks the lowest and the highest price with their moments', () => {
    const data = scans((index) => index === 10 ? 50_000 : index === 20 || index === 21 ? 150_000 : 100_000)
    const model = chartModel({ ...base, scans: data })!
    expect(model.low).toMatchObject({ price: 50_000, at: data[10]!.at, offChart: false })
    expect(model.high).toMatchObject({ price: 150_000, at: data[20]!.at, offChart: false })
    expect(model.low!.y).toBeGreaterThan(model.high!.y)
  })

  it('a lone spike does not squash the rest: it stays at the edge and says so', () => {
    const data = scans((index) => index === 20 ? 5_000_000 : 100_000 + index * 100)
    const model = chartModel({ ...base, scans: data })!
    expect(model.high).toMatchObject({ price: 5_000_000, offChart: true })
    expect(model.high!.y).toBe(model.top)
  })

  it('«now» stands before the two days ahead, and the forecast runs from it', () => {
    const data = scans(() => 100_000)
    const forecast = [{ at: NOW + 2 * HOUR, price: 120_000, low: 110_000, high: 130_000 }, { at: NOW + 48 * HOUR, price: 125_000, low: 115_000, high: 135_000 }]
    const model = chartModel({ ...base, scans: data, forecast, current: 100_000 })!
    expect(model.nowX).toBeGreaterThan(model.left)
    expect(model.nowX).toBeLessThan(model.right)
    expect(model.forecastLine.startsWith(`M${Math.round(model.nowX * 10) / 10} `)).toBe(true)
    expect(model.forecastBand).toContain('Z')
    expect(model.points.filter((point) => point.forecast).length).toBe(2)
  })

  it('shows the needed price in the frame and when it usually comes', () => {
    const data = scans(() => 100_000)
    const model = chartModel({ ...base, scans: data, target: 180_000, current: 100_000, sell: { state: 'window', from: NOW + 10 * HOUR, to: NOW + 20 * HOUR } })!
    expect(model.targetY).toBeGreaterThanOrEqual(model.top)
    expect(model.targetY).toBeLessThan(model.bottom)
    expect(model.sellBand!.x).toBeGreaterThan(model.nowX)
    expect(model.sellBand!.width).toBeGreaterThan(0)
  })

  it('a trader far off the prices is not drawn', () => {
    const data = scans(() => 100_000)
    expect(chartModel({ ...base, scans: data, trader: 1000 })!.traderY).toBeUndefined()
    expect(chartModel({ ...base, scans: data, trader: 101_000 })!.traderY).toBeDefined()
  })

  it('nothing to draw from one point', () => {
    expect(chartModel({ ...base, scans: scans(() => 1, 1) })).toBeNull()
  })

  it('the period counts back from the newest scan', () => {
    const row = { series: Array.from({ length: 84 }, (_, index) => index), seriesFrom: NOW - 166 * HOUR, seriesAt: Array.from({ length: 84 }, (_, index) => index * 120) }
    expect(periodScans(row, 7).length).toBe(84)
    expect(periodScans(row, 3).length).toBe(37)
    expect(periodScans(row, 3)[0]!.at).toBe(NOW - 72 * HOUR)
  })
})
