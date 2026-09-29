import { describe, expect, it } from 'vitest'
import { isPositionScreenshot, parseScreenshotPosition } from './screenshotPosition'

describe('screenshot position', () => {
  it('accepts signed values and scientific notation used near zero', () => {
    expect(parseScreenshotPosition('2026-09-28_+1.2e2, .5, -4E-2_0,0,0,1_test.png')).toMatchObject({ x: 120, y: .5, z: -.04, yaw: 0 })
  })
  it('reads position and heading from an EFT screenshot name', () => {
    const name = '2024-06-13[11-05]_-181.42, 3.27, -77.07_0.00000, 0.70711, 0.00000, 0.70711_11.02 (0).png'
    expect(isPositionScreenshot(name)).toBe(true)
    const position = parseScreenshotPosition(name, 5)
    expect(position).toMatchObject({ x: -181.42, y: 3.27, z: -77.07, at: 5 })
    expect(position?.yaw).toBeCloseTo(90, 2)
  })

  it('ignores ordinary screenshots', () => {
    expect(isPositionScreenshot('Screenshot 2026-09-27 101010.png')).toBe(false)
    expect(parseScreenshotPosition('photo.png')).toBeNull()
  })
})

describe('screenshot names written by the current game build', () => {
  it('reads a live raid screenshot (2026)', () => {
    const name = '2026-09-04[04-56]_-230.88, 3.59, -375.83_-0.02798, -0.17807, 0.00669, -0.98360_0.64 (0).png'
    expect(isPositionScreenshot(name)).toBe(true)
    expect(parseScreenshotPosition(name, 7)).toMatchObject({ x: -230.88, y: 3.59, z: -375.83, at: 7 })
  })

  it('reads whole-number coordinates', () => {
    expect(parseScreenshotPosition('2026-09-04[04-56]_1, 2, 3_0, 0, 0, 1_0.5 (0).png')).toMatchObject({ x: 1, y: 2, z: 3, yaw: 0 })
  })

  it('treats menu screenshots (time only) as having no position', () => {
    expect(isPositionScreenshot('2026-09-04[01-12]_7.92 (0).png')).toBe(false)
  })
})

describe('screenshot position on comma-decimal locales', () => {
  it('reads coordinates written with decimal commas', () => {
    const name = '2026-09-29[21-14]_-181,42, 3,27, -77,07_0,00000, 0,70711, 0,00000, 0,70711_11,02 (0).png'
    expect(isPositionScreenshot(name)).toBe(true)
    expect(parseScreenshotPosition(name, 1)).toMatchObject({ x: -181.42, y: 3.27, z: -77.07 })
  })
})
