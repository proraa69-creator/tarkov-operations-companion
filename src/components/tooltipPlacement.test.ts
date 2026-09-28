import { describe, expect, it } from 'vitest'
import { chooseTooltipPlacement } from './tooltipPlacement'

const base = {
  icon: { left: -13, top: -26, right: 13, bottom: 0 },
  tooltip: { width: 244, height: 120 },
  container: { width: 1000, height: 700 },
}

describe('chooseTooltipPlacement', () => {
  it('prefers the top when there is room', () => {
    expect(chooseTooltipPlacement({ ...base, point: { x: 500, y: 400 } }).side).toBe('top')
  })

  it('flips below a marker near the top edge', () => {
    expect(chooseTooltipPlacement({ ...base, point: { x: 500, y: 60 } }).side).toBe('bottom')
  })

  it('moves to the side in a top-left corner', () => {
    const placement = chooseTooltipPlacement({ ...base, point: { x: 30, y: 30 } })
    expect(placement.side).toBe('right')
    expect(placement.offset[0]).toBeGreaterThan(0)
  })

  it('goes left from the right edge', () => {
    const placement = chooseTooltipPlacement({ ...base, point: { x: 990, y: 30 } })
    expect(placement.side).toBe('left')
    expect(placement.offset[0]).toBeLessThan(0)
  })

  it('avoids reserved interface blocks', () => {
    const hud = { left: 0, top: 0, right: 1000, bottom: 300 }
    expect(chooseTooltipPlacement({ ...base, point: { x: 500, y: 400 }, reserved: [hud] }).side).not.toBe('top')
  })
})
