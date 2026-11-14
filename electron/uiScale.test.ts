// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ screen: {} }))
const { opensMaximized, scaledWindowSize, uiScaleFor } = await import('./uiScale')

describe('a Full HD look on every screen (owner, 11.10.2026)', () => {
  it('zooms by the display size in Windows units over 1920×1080', () => {
    expect(uiScaleFor({ width: 1920, height: 1080 })).toBe(1)
    expect(uiScaleFor({ width: 3840, height: 2160 })).toBe(2) // 4K at 100 % Windows scaling
    expect(uiScaleFor({ width: 2560, height: 1440 })).toBe(1.35) // 4K at 150 %, 1440p at 100 %
    expect(uiScaleFor({ width: 3440, height: 1440 })).toBe(1.35) // ultrawide: by its height
    expect(uiScaleFor({ width: 5120, height: 2880 })).toBe(2.65)
    expect(uiScaleFor({ width: 1366, height: 768 })).toBe(0.8) // smaller screens: zoomed out, down to 0.8 (owner, 14.11.2026)
    expect(uiScaleFor({ width: 1600, height: 900 })).toBe(0.85)
    expect(uiScaleFor({ width: 1536, height: 864 })).toBe(0.8) // Full HD laptop at 125 %
    expect(uiScaleFor({ width: 1280, height: 720 })).toBe(0.8) // never below 0.8
    expect(uiScaleFor({ width: 7680, height: 4320 })).toBe(3)
  })

  it('an upright (9:16) monitor is measured against Full HD upright (report 158, owner 14.11.2026)', () => {
    expect(uiScaleFor({ width: 1080, height: 1920 })).toBe(1)
    expect(uiScaleFor({ width: 2160, height: 3840 })).toBe(2) // 4K upright, as 4K lying down
    expect(uiScaleFor({ width: 1440, height: 2560 })).toBe(1.35)
    expect(uiScaleFor({ width: 1200, height: 1920 })).toBe(1) // 16:10 upright
  })

  it('the first start fills an upright monitor or a small screen, not a Full HD one', () => {
    const base = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }
    const at = (screen: { width: number; height: number }, area: { width: number; height: number }) => opensMaximized(scaledWindowSize(base, uiScaleFor(screen), area), area)
    expect(at({ width: 1920, height: 1080 }, { width: 1920, height: 1040 })).toBe(false)
    expect(at({ width: 2560, height: 1440 }, { width: 2560, height: 1400 })).toBe(false)
    expect(at({ width: 1080, height: 1920 }, { width: 1080, height: 1880 })).toBe(true)
    expect(at({ width: 1366, height: 768 }, { width: 1366, height: 728 })).toBe(true)
  })

  it('sizes the window for the scale, never past the work area', () => {
    const base = { width: 1500, height: 930, minWidth: 1050, minHeight: 700 }
    expect(scaledWindowSize(base, 2, { width: 3840, height: 2100 })).toEqual({ width: 3000, height: 1860, minWidth: 2100, minHeight: 1400 })
    expect(scaledWindowSize(base, 1, { width: 1366, height: 728 })).toEqual({ width: 1366, height: 728, minWidth: 1050, minHeight: 700 })
  })
})
