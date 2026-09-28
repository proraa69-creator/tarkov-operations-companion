import { describe, expect, it } from 'vitest'
import { chooseTooltipPlacement } from './tooltipPlacement'

const base = {
  icon: { left: -13, top: -26, right: 13, bottom: 0 },
  tooltip: { width: 244, height: 120 },
  container: { width: 1000, height: 700 },
}

describe('chooseTooltipPlacement', () => {
  it('opens beside the marker when there is room', () => {
    const placement = chooseTooltipPlacement({ ...base, point: { x: 500, y: 400 } })
    expect(placement.side).toBe('right')
    expect(placement.offset).toEqual([17, -13])
  })

  it('stays beside a marker at the top edge instead of flying up', () => {
    expect(chooseTooltipPlacement({ ...base, point: { x: 500, y: 90 } }).side).toBe('right')
  })

  it('goes left from the right edge', () => {
    const placement = chooseTooltipPlacement({ ...base, point: { x: 900, y: 300 } })
    expect(placement.side).toBe('left')
    expect(placement.offset[0]).toBeLessThan(0)
  })

  it('goes below when both sides are blocked', () => {
    const narrow = { ...base, container: { width: 300, height: 700 } }
    expect(chooseTooltipPlacement({ ...narrow, point: { x: 150, y: 100 } }).side).toBe('bottom')
  })

  it('avoids reserved interface blocks', () => {
    const panel = { left: 500, top: 0, right: 1000, bottom: 700 }
    expect(chooseTooltipPlacement({ ...base, point: { x: 480, y: 400 }, reserved: [panel] }).side).toBe('left')
  })
})
