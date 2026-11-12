import { describe, expect, it } from 'vitest'
import { HOVER_STICK, hoverTarget } from './MarkerCanvasLayer'

// Two icons side by side that overlap by 4 px: A (lower, drawn first) and B on top of it.
const box = (id: string, left: number) => ({ id, x: left + 10, y: 10, left, top: 0, right: left + 20, bottom: 20 })
const boxes = [box('A', 0), box('B', 16)]

describe('the point under the pointer (owner, 11.11.2026: «окно постоянно прыгает… зависает»)', () => {
  it('the top-most icon when nothing is shown; nothing off the icons', () => {
    expect(hoverTarget(boxes, null, 5, 10)).toBe('A')
    expect(hoverTarget(boxes, null, 18, 10)).toBe('B')
    expect(hoverTarget(boxes, null, 60, 10)).toBeNull()
  })

  it('the shown point keeps the pointer over the overlap and a few pixels past its edge', () => {
    expect(hoverTarget(boxes, 'A', 18, 10)).toBe('A')
    expect(hoverTarget(boxes, 'A', 20 + HOVER_STICK, 10)).toBe('A')
    expect(hoverTarget(boxes, 'A', 0, -HOVER_STICK)).toBe('A')
    // well onto the neighbour: it takes over
    expect(hoverTarget(boxes, 'A', 30, 10)).toBe('B')
  })

  it('lets go the moment the pointer is off it and off every icon', () => {
    expect(hoverTarget(boxes, 'B', 36 + HOVER_STICK + 1, 10)).toBeNull()
    expect(hoverTarget(boxes, 'A', 10, 20 + HOVER_STICK + 1)).toBeNull()
    // a point no longer on the map (another floor, filtered out) is not kept
    expect(hoverTarget([box('B', 16)], 'A', 5, 10)).toBeNull()
  })
})
