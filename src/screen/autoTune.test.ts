import { describe, expect, it } from 'vitest'
import { autoProfile } from './autoTune'
import { screenTables } from './screenCurve'

const picture = (rgb: (index: number) => [number, number, number], size = 4096) => {
  const pixels = new Uint8ClampedArray(size * 4)
  for (let index = 0; index < size; index += 1) pixels.set([...rgb(index), 255], index * 4)
  return pixels
}

describe('«Подобрать по кадру»', () => {
  it('a dark hideout picture (10, 7, 6): the exposure curve with its haze and the red cast taken out', () => {
    const hideout = autoProfile(picture((index) => index % 10 === 0 ? [14, 11, 10] : [10, 7, 6]))
    expect(hideout.haze).toBeGreaterThanOrEqual(4)
    expect(hideout.cast).toBe(1)
    const tables = screenTables(hideout)
    // the haze stays dark and about the same in every channel, the room above it comes out lit
    expect(tables.g[7]! * 255).toBeLessThan(60)
    expect(tables.g[11]! * 255).toBeGreaterThan(70)
    expect(Math.abs(tables.r[10]! - tables.g[7]!) * 255).toBeLessThan(6)
    expect(tables.g[11]!).toBeGreaterThan(tables.g[7]!)
  })

  it('a bright day picture: next to nothing changes', () => {
    const day = autoProfile(picture((index) => [110 + (index % 100), 110 + (index % 100), 110 + (index % 100)]))
    expect(day.gamma).toBe(1)
    expect(day.shadows).toBe(0)
    expect(day.haze).toBeUndefined()
  })

  it('a dusky picture gets a gentle rise, no filters', () => {
    const dusk = autoProfile(picture((index) => index % 3 ? [45, 45, 45] : [120, 120, 120]))
    expect(dusk.gamma).toBeGreaterThan(1)
    expect(dusk.cast).toBeUndefined()
  })
})
