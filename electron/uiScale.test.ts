// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ screen: {} }))
const { scaledWindowSize, uiScaleFor } = await import('./uiScale')

describe('a Full HD look on every screen (owner, 11.10.2026)', () => {
  it('zooms by the display size in Windows units over 1920×1080', () => {
    expect(uiScaleFor({ width: 1920, height: 1080 })).toBe(1)
    expect(uiScaleFor({ width: 3840, height: 2160 })).toBe(2) // 4K at 100 % Windows scaling
    expect(uiScaleFor({ width: 2560, height: 1440 })).toBe(1.35) // 4K at 150 %, 1440p at 100 %
    expect(uiScaleFor({ width: 3440, height: 1440 })).toBe(1.35) // ultrawide: by its height
    expect(uiScaleFor({ width: 5120, height: 2880 })).toBe(2.65)
    expect(uiScaleFor({ width: 1366, height: 768 })).toBe(1) // smaller screens keep their own layout
    expect(uiScaleFor({ width: 7680, height: 4320 })).toBe(3)
  })

  it('sizes the window for the scale, never past the work area', () => {
    const base = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }
    expect(scaledWindowSize(base, 2, { width: 3840, height: 2100 })).toEqual({ width: 3000, height: 1860, minWidth: 2100, minHeight: 1400 })
    expect(scaledWindowSize(base, 1, { width: 1366, height: 728 })).toEqual({ width: 1366, height: 728, minWidth: 1050, minHeight: 700 })
  })
})
