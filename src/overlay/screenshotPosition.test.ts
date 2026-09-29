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

describe('screenshot position on comma-decimal locales', () => {
  it('reads coordinates written with decimal commas', () => {
    const name = '2026-09-29[21-14]_-181,42, 3,27, -77,07_0,00000, 0,70711, 0,00000, 0,70711_11,02 (0).png'
    expect(isPositionScreenshot(name)).toBe(true)
    expect(parseScreenshotPosition(name, 1)).toMatchObject({ x: -181.42, y: 3.27, z: -77.07 })
  })
})
