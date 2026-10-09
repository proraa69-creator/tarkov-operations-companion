import { describe, expect, it } from 'vitest'
import { itemCardBounds } from './itemCardPlacement'

const area = { x: 0, y: 0, width: 1920, height: 1040 }
const size = { width: 300, height: 118 }

describe('item card placement', () => {
  it('opens beside the cursor at the time of the hotkey', () => {
    expect(itemCardBounds({ x: 800, y: 400 }, area, size)).toEqual({ x: 816, y: 422, ...size })
  })

  it('keeps the Kotton card near the hovered item instead of the screen edge', () => {
    expect(itemCardBounds({ x: 1440, y: 790 }, area, { width: 216, height: 94 }))
      .toEqual({ x: 1456, y: 812, width: 216, height: 94 })
  })

  it('flips left and above the cursor at the bottom-right corner', () => {
    expect(itemCardBounds({ x: 1900, y: 1020 }, area, size)).toEqual({ x: 1584, y: 890, ...size })
  })

  it('recomputes from the original cursor when loading content changes size', () => {
    const point = { x: 1630, y: 920 }
    expect(itemCardBounds(point, area, size)).toEqual({ x: 1314, y: 790, ...size })
    expect(itemCardBounds(point, area, { width: 216, height: 94 }))
      .toEqual({ x: 1646, y: 942, width: 216, height: 94 })
  })

  it('accepts DIP coordinates on a scaled monitor without scaling them again', () => {
    expect(itemCardBounds({ x: 950, y: 450 }, { x: 0, y: 0, width: 1280, height: 680 }, size))
      .toEqual({ x: 966, y: 472, ...size })
  })

  it('stays on monitors to the left and above the primary monitor', () => {
    expect(itemCardBounds({ x: -1900, y: -1000 }, { x: -1920, y: -1080, width: 1920, height: 1040 }, size))
      .toEqual({ x: -1884, y: -978, ...size })
  })

  it('clamps the window when the cursor or card extends beyond the work area', () => {
    expect(itemCardBounds({ x: -10, y: -10 }, area, { width: 3000, height: 2000 }))
      .toEqual({ x: 4, y: 4, width: 1912, height: 1032 })
  })
})
