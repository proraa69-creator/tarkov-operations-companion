import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, LAYOUT_KEY, LEGACY_LAYOUT_KEY, badgeBoxes, clampOffset, loadLayout, migrateLegacyLayout, sanitizeLayout, saveLayout } from './helmetLayout'

const storage = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null })

describe('mask badge layout', () => {
  it('starts at the resting pose next to «Обзор» when nothing is saved', () => {
    expect(loadLayout(storage({}))).toEqual(DEFAULT_LAYOUT)
    expect(loadLayout(null)).toEqual(DEFAULT_LAYOUT)
  })

  it('turns the old absolute angles into offsets from the resting pose, keeping how the mask looked', () => {
    // the untouched old default is the new zero
    expect(migrateLegacyLayout({ rotX: 12, rotY: -35, rotZ: -8, scale: 1, dx: 0, dy: 0, size: 86 })).toEqual(DEFAULT_LAYOUT)
    // the old «Наклон» slider (rotZ, + = counter-clockwise) becomes the left / right tilt (+ = right); dx / dy stay the mask's place
    expect(migrateLegacyLayout({ rotX: 12, rotY: -35, rotZ: 20, dx: -30, dy: 14 })).toMatchObject({ roll: -28, pitch: 0, yaw: 0, dx: -30, dy: 14 })
    // the first editor's nod and turn; out-of-range values are clamped to the sliders, the turn wrapped first
    expect(migrateLegacyLayout({ rotX: 70, rotY: 20, rotZ: -8 })).toMatchObject({ pitch: -45, yaw: 55, roll: 0 })
    expect(migrateLegacyLayout({ rotY: 170 })).toMatchObject({ yaw: -90 })
    // scale and size from the first editor are still honoured, within its old limits
    expect(migrateLegacyLayout({ scale: 1.4, size: 120 })).toMatchObject({ scale: 1.4, size: 120 })
    expect(migrateLegacyLayout({ scale: 9, size: 5000 })).toMatchObject({ scale: 2.5, size: 220 })
  })

  it('reads the old key only while there is no new one, and survives junk', () => {
    expect(loadLayout(storage({ [LEGACY_LAYOUT_KEY]: JSON.stringify({ rotZ: 0 }) }))).toMatchObject({ roll: -8 })
    expect(loadLayout(storage({ [LEGACY_LAYOUT_KEY]: JSON.stringify({ rotZ: 0 }), [LAYOUT_KEY]: JSON.stringify({ yaw: 30 }) }))).toMatchObject({ roll: 0, yaw: 30 })
    expect(loadLayout(storage({ [LAYOUT_KEY]: '{not json' }))).toEqual(DEFAULT_LAYOUT)
    expect(loadLayout(storage({ [LAYOUT_KEY]: '[1,2]' }))).toEqual(DEFAULT_LAYOUT)
    expect(sanitizeLayout({ pitch: 'up', roll: Number.NaN, yaw: 1e9, dx: null, dy: 12.6, extra: 1 })).toEqual({ ...DEFAULT_LAYOUT, yaw: 90, dy: 13 })
  })

  it('saves under the new key', () => {
    const saved: Record<string, string> = {}
    saveLayout({ ...DEFAULT_LAYOUT, pitch: 10 }, { setItem: (key: string, value: string) => { saved[key] = value } })
    expect(JSON.parse(saved[LAYOUT_KEY]!)).toMatchObject({ pitch: 10 })
  })

  it('keeps the dragged mask and its button inside the window', () => {
    const spot = { top: 130, left: 212, width: 1400, height: 860 }
    const size = 86
    const inside = (dx: number, dy: number) => {
      const { helmet, button } = badgeBoxes(spot, dx, dy, size)
      return helmet.left >= 4 && helmet.top >= 4 && helmet.left + size <= 1396 && helmet.top + size <= 856 && button.left + 20 <= 1396
    }
    expect(clampOffset(spot, 0, 0, size)).toEqual({ dx: 0, dy: 0 })
    for (const [dx, dy] of [[-5000, -5000], [5000, 5000], [-5000, 5000], [5000, -5000], [300, 200]]) {
      const offset = clampOffset(spot, dx!, dy!, size)
      expect(inside(offset.dx, offset.dy)).toBe(true)
    }
    expect(clampOffset(spot, 300, 200, size)).toEqual({ dx: 300, dy: 200 })
  })
})
