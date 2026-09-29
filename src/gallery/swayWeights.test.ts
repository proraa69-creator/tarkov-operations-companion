import { describe, expect, it } from 'vitest'
import { computeSwayWeights } from './swayWeights'

const SIDES = 24, ROWS = 40

/** A closed 24-sided column (radius 0.1, 1 tall) standing for the body. */
function body(positions: number[], indices: number[]) {
  const base = positions.length / 3
  for (let r = 0; r <= ROWS; r++) for (let k = 0; k < SIDES; k++) {
    const a = (k / SIDES) * Math.PI * 2
    positions.push(Math.cos(a) * 0.1, 1 - r / ROWS, Math.sin(a) * 0.1)
  }
  const v = (r: number, k: number) => base + r * SIDES + (k % SIDES)
  for (let r = 0; r < ROWS; r++) for (let k = 0; k < SIDES; k++) indices.push(v(r, k), v(r + 1, k), v(r + 1, k + 1), v(r, k), v(r + 1, k + 1), v(r, k + 1))
  const top = positions.length / 3, bottom = top + 1
  positions.push(0, 1, 0, 0, 0, 0)
  for (let k = 0; k < SIDES; k++) indices.push(top, v(0, k + 1), v(0, k), bottom, v(ROWS, k), v(ROWS, k + 1))
  return { from: base, to: positions.length / 3, vertex: v }
}

/**
 * A cape: a 6 mm sheet fused to the back of the body along one row at shoulder height (its first row of
 * inner vertices are body vertices), leaning away from the back and hanging 0.55 down.
 */
function cape(positions: number[], indices: number[], column: ReturnType<typeof body>) {
  const row = 4 // y = 0.9
  const left = column.vertex(row, 16), right = column.vertex(row, 20) // around the back (-z)
  const at = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
  const [lx, , lz] = at(left), [rx, , rz] = at(right)
  const base = positions.length / 3
  const STEPS = 24
  for (let s = 1; s <= STEPS; s++) {
    const t = s / STEPS
    const y = 0.9 - 0.55 * t
    const back = 0.07 * Math.min(1, t * 3)
    positions.push(lx, y, lz - back, rx, y, rz - back, rx, y, rz - back - 0.006, lx, y, lz - back - 0.006)
  }
  const v = (s: number, c: number) => (s === 0 ? [left, right, right, left][c % 4] : base + (s - 1) * 4 + (c % 4))
  for (let s = 0; s < STEPS; s++) for (let c = 0; c < 4; c++) {
    const a = v(s, c), b = v(s + 1, c), d = v(s + 1, c + 1), e = v(s, c + 1)
    if (a !== e) indices.push(a, b, d, a, d, e); else indices.push(a, b, d)
  }
  indices.push(v(STEPS, 0), v(STEPS, 2), v(STEPS, 1), v(STEPS, 0), v(STEPS, 3), v(STEPS, 2))
  return { from: base, to: positions.length / 3 }
}

describe('computeSwayWeights', () => {
  it('keeps a thick body rigid and lets a thin sheet hanging from its back swing, 0 at the seam', () => {
    const positions: number[] = [], indices: number[] = []
    const column = body(positions, indices)
    const sheet = cape(positions, indices, column)
    const result = computeSwayWeights(new Float32Array(positions), new Uint32Array(indices))
    expect(result).not.toBeNull()
    const w = (i: number) => result!.weights[i * 2]
    for (let i = column.from; i < column.to; i++) expect(w(i)).toBe(0)
    let top = 0, bottom = 0
    for (let i = sheet.from; i < sheet.to; i++) {
      if (positions[i * 3 + 1] > 0.87) top = Math.max(top, w(i))
      if (positions[i * 3 + 1] < 0.36) bottom = Math.max(bottom, w(i))
    }
    expect(top).toBeLessThan(0.05)
    expect(bottom).toBeGreaterThan(0.5)
  })

  it('gives coincident (UV seam) vertices the same weight', () => {
    const positions: number[] = [], indices: number[] = []
    const sheet = cape(positions, indices, body(positions, indices))
    // a seam twin of a cape vertex (same position, another index) used by one more triangle
    const source = sheet.to - 6
    const twin = positions.length / 3
    positions.push(positions[source * 3], positions[source * 3 + 1], positions[source * 3 + 2])
    indices.push(twin, source - 4, source - 3)
    const result = computeSwayWeights(new Float32Array(positions), new Uint32Array(indices))!
    expect(result.weights[source * 2]).toBeGreaterThan(0)
    expect(result.weights[twin * 2]).toBe(result.weights[source * 2])
  })

  it('returns null for a model without loose parts', () => {
    const positions: number[] = [], indices: number[] = []
    body(positions, indices)
    expect(computeSwayWeights(new Float32Array(positions), new Uint32Array(indices))).toBeNull()
  })
})
