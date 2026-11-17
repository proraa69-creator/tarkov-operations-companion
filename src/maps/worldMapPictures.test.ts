import { describe, expect, it } from 'vitest'
import { SATELLITE_RAMP, SATELLITE_WATER, blurMask, satelliteColour } from './worldMapPictures'

describe('«Все локации» on «Спутник» without canvas filters (owner, 17.11.2026: the iPhone showed black squares)', () => {
  it('blurs a mask in plain code, the outside counted as empty', () => {
    const width = 20
    const mask = new Float32Array(width * width).fill(1)
    blurMask(mask, width, width, 2)
    const at = (x: number, y: number) => mask[y * width + x]!
    // the middle stays full, the edge fades, the corner most
    expect(at(10, 10)).toBeCloseTo(1, 5)
    expect(at(0, 10)).toBeLessThan(0.75)
    expect(at(0, 0)).toBeLessThan(at(0, 10))
    // a lone point spreads and keeps its sum
    const dot = new Float32Array(width * width)
    dot[10 * width + 10] = 1
    blurMask(dot, width, width, 2)
    expect(dot.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5)
    expect(dot[10 * width + 10]).toBeLessThan(0.2)
  })

  it('a scheme with no render (Terminal) takes the renders\' colours: its sea their water, its ground their ramp', () => {
    // the scheme's light-blue sea
    const sea = satelliteColour(120, 170, 220)
    expect(sea[2]).toBeGreaterThan(sea[0])
    expect(sea[0]).toBeLessThanOrEqual(SATELLITE_WATER[0] * 1.25 + 1)
    // dark teal ground → dark olive, white buildings → the lightest of the ramp
    const ground = satelliteColour(31, 80, 84)
    expect(ground[1]).toBeGreaterThanOrEqual(ground[2])
    expect(satelliteColour(255, 255, 255)).toEqual([...SATELLITE_RAMP.at(-1)![1]])
    expect(satelliteColour(0, 0, 0)).toEqual([...SATELLITE_RAMP[0]![1]])
  })
})
