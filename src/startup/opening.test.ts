import { describe, expect, it, vi } from 'vitest'
import { drawStitches, headAt, roundBox, straightLine, type Stitch } from './opening'

describe('the stitch', () => {
  it('goes round a box from the top centre, clockwise, and comes back', () => {
    const path = roundBox(10, 20, 400, 200, 20)
    expect(path.length).toBeCloseTo(2 * (400 + 200) - 8 * 20 + 2 * Math.PI * 20, 5)
    const [x0, y0] = path.at(0)
    expect([x0, y0]).toEqual([210, 20])
    expect(path.at(180)[0]).toBeCloseTo(390)
    expect(path.at(path.length / 2)[0]).toBeCloseTo(210)
    expect(path.at(path.length / 2)[1]).toBeCloseTo(220)
    expect(path.at(path.length - 0.001)[0]).toBeCloseTo(210, 1)
  })

  it('stays on the box at every point', () => {
    const path = roundBox(0, 0, 300, 200, 27)
    for (let at = 0; at < path.length; at += 7) {
      const [x, y] = path.at(at)
      expect(x).toBeGreaterThanOrEqual(-0.001)
      expect(x).toBeLessThanOrEqual(300.001)
      expect(y).toBeGreaterThanOrEqual(-0.001)
      expect(y).toBeLessThanOrEqual(200.001)
    }
  })

  const stitch: Stitch = { path: straightLine([0, 3], [1000, 3]), start: 100, ms: 500, on: 6, off: 4, width: 1, colour: 'red', tail: 200, hotWidth: 2 }

  it('moves on every frame instead of jumping: the head advances a little, never back, never far', () => {
    expect(headAt(stitch, 0)).toBe(0)
    expect(headAt(stitch, 100)).toBe(0)
    let last = 0
    let longest = 0
    for (let elapsed = 100; elapsed <= 600; elapsed += 1000 / 60) {
      const head = headAt(stitch, elapsed)
      expect(head).toBeGreaterThanOrEqual(last)
      longest = Math.max(longest, head - last)
      last = head
    }
    expect(headAt(stitch, 600)).toBe(1000)
    // A sixtieth of a second at its fastest: never a jump as long as the 126 px of the pictures it replaced.
    expect(longest).toBeLessThan(90)
  })

  const recording = () => {
    const lines: Array<{ alpha: number; style: string }> = []
    const context = {
      globalAlpha: 1, strokeStyle: '', lineWidth: 0, lineCap: '',
      clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke() { lines.push({ alpha: context.globalAlpha, style: String(context.strokeStyle) }) },
    }
    return { context: context as unknown as CanvasRenderingContext2D, lines, moveTo: context.moveTo }
  }

  it('draws nothing before it starts, and still asks for frames', () => {
    const { context, moveTo } = recording()
    expect(drawStitches(context, 1000, 6, [stitch], 50)).toBe(true)
    expect(moveTo).not.toHaveBeenCalled()
  })

  it('a bright head over the thin line, going out after it stops, then it rests', () => {
    const running = recording()
    expect(drawStitches(running.context, 1000, 6, [stitch], 400)).toBe(true)
    expect(running.lines[0]).toEqual({ alpha: 1, style: 'red' })
    expect(running.lines.filter((line) => line.style === '#fbffe9').length).toBeGreaterThan(5)
    const stopped = recording()
    expect(drawStitches(stopped.context, 1000, 6, [stitch], 2000)).toBe(false)
    expect(stopped.lines).toEqual([{ alpha: 1, style: 'red' }])
  })
})
