import { describe, expect, it } from 'vitest'
import { chartGeometry, lastDays } from './priceChart'

const day = 86_400_000
const points = [0, 10, 20, 25, 29, 30].map((d, index) => ({ timestamp: d * day, price: [100, 200, 150, 300, 250, 120][index] }))

describe('price chart helpers', () => {
  it('keeps the last N days counted from the newest point', () => {
    expect(lastDays(points, 7).map((point) => point.timestamp / day)).toEqual([25, 29, 30])
    expect(lastDays(points, 30)).toHaveLength(6)
    expect(lastDays([], 7)).toEqual([])
  })

  it('scales prices into the box with the max at the top', () => {
    const geometry = chartGeometry(points, 100, 50, 0)!
    expect(geometry.min).toBe(100)
    expect(geometry.max).toBe(300)
    expect(geometry.coords[0]).toMatchObject({ x: 0, y: 50 })
    expect(geometry.coords[3]).toMatchObject({ x: 25 / 30 * 100, y: 0 })
    expect(geometry.line.startsWith('M0 50 L33.3 25')).toBe(true)
    expect(geometry.change).toBeCloseTo(20, 6)
  })

  it('needs at least two points and draws flat history in the middle', () => {
    expect(chartGeometry(points.slice(0, 1), 100, 50)).toBeNull()
    const flat = chartGeometry([{ timestamp: 0, price: 5 }, { timestamp: 1, price: 5 }], 100, 50)!
    expect(flat.coords.every((coord) => coord.y === 25)).toBe(true)
  })
})
