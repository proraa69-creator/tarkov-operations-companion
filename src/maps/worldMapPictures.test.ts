import { describe, expect, it } from 'vitest'
import { RENDER_ASPHALT, SATELLITE_RAMP, SATELLITE_WATER, blurMask, fillInnerDark, satelliteColour } from './worldMapPictures'

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

describe('«Все локации» on «Спутник»: holes inside a render (owner, 17.11.2026, Ground Zero)', () => {
  it('near-black inside the render takes the asphalt colour; the black joined to the edge stays the outside', () => {
    const width = 7
    const height = 5
    const data = new Uint8ClampedArray(width * height * 4)
    // a black frame (the outside), a grey render in it with a black hole in the middle and an empty one beside it
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const inside = x > 0 && x < width - 1 && y > 0 && y < height - 1
      const value = inside ? 120 : 0
      data.set([value, value, value, 255], i)
    }
    data.set([0, 0, 0, 255], (2 * width + 2) * 4)
    data.set([0, 0, 0, 0], (2 * width + 4) * 4)
    expect(fillInnerDark(data, width, height)).toBe(2)
    expect([...data.slice((2 * width + 2) * 4, (2 * width + 2) * 4 + 4)]).toEqual([...RENDER_ASPHALT, 255])
    expect([...data.slice((2 * width + 4) * 4, (2 * width + 4) * 4 + 4)]).toEqual([...RENDER_ASPHALT, 255])
    // the frame stays black for the mask to fade away
    expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 255])
  })
})

describe('Ground Zero: a hole reaching the render edge is filled when the render lies on both sides of it', () => {
  it('spans: across or down between render pixels is inside; beyond the outermost ones is the outside', () => {
    const width = 6
    const height = 3
    const data = new Uint8ClampedArray(width * height * 4)
    // row 1: render, hole, hole, render, empty, empty — the hole reaches row 0 (empty) and so the edge
    const render = new Set([6, 9, 12, 13, 14, 15])
    for (let i = 0; i < width * height; i += 1) data.set(render.has(i) ? [120, 120, 120, 255] : [0, 0, 0, 0], i * 4)
    const plain = data.slice()
    expect(fillInnerDark(plain, width, height)).toBe(0)
    expect(fillInnerDark(data, width, height, RENDER_ASPHALT, { spans: true })).toBe(2)
    expect(data[7 * 4 + 3]).toBe(255)
    expect(data[8 * 4 + 3]).toBe(255)
    // beyond the render's last pixel of that row and column: still outside
    expect(data[10 * 4 + 3]).toBe(0)
    expect(data[0 * 4 + 3]).toBe(0)
  })
})
