import { createRope, pushRope, ropeMotion, settleRope, stepRope, tipAngle } from './verlet'

const DT = 1 / 60

describe('gear theme rope physics', () => {
  it('hangs straight and stays asleep without input', () => {
    const rope = createRope(5, 10, 100, 50)
    for (let i = 0; i < 30; i++) stepRope(rope, 100, 50, DT)
    expect(rope.x[4]).toBeCloseTo(100, 3)
    expect(rope.y[4]).toBeGreaterThan(89)
    expect(ropeMotion(rope)).toBeLessThan(0.05)
  })

  it('swings when the pointer brushes past and then settles back', () => {
    const rope = createRope(4, 12, 0, 0, { tipRadius: 8 })
    const hit = pushRope(rope, rope.x[3] - 4, rope.y[3], 700, 0, 30, DT)
    expect(hit).toBe(true)
    let maxAngle = 0
    for (let i = 0; i < 30; i++) { stepRope(rope, 0, 0, DT); maxAngle = Math.max(maxAngle, Math.abs(tipAngle(rope))) }
    expect(maxAngle).toBeGreaterThan(0.15)
    for (let i = 0; i < 60 * 12; i++) stepRope(rope, 0, 0, DT)
    expect(Math.abs(tipAngle(rope))).toBeLessThan(0.02)
    expect(ropeMotion(rope)).toBeLessThan(0.05)
  })

  it('keeps segment lengths and ignores far pointers', () => {
    const rope = createRope(6, 8, 10, 10, { bend: 0.3 })
    expect(pushRope(rope, 500, 500, 900, 900, 30, DT)).toBe(false)
    pushRope(rope, 12, 40, 900, 200, 40, DT)
    for (let i = 0; i < 20; i++) stepRope(rope, 10, 10, DT)
    for (let i = 0; i < 5; i++) {
      expect(Math.hypot(rope.x[i + 1] - rope.x[i], rope.y[i + 1] - rope.y[i])).toBeCloseTo(8, 0)
    }
  })

  it('re-hangs instead of flinging after a large anchor jump', () => {
    const rope = createRope(4, 10, 0, 0)
    stepRope(rope, 0, 900, DT)
    expect(rope.y[3]).toBeGreaterThan(925)
    settleRope(rope, 5, 5)
    expect(rope.x[3]).toBe(5)
  })
})
