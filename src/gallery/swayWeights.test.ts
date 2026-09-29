import { describe, expect, it } from 'vitest'
import { computeSwayWeights } from './swayWeights'

/** Appends a closed axis-aligned box (12 triangles, 8 shared vertices) to the buffers. */
function box(positions: number[], indices: number[], min: [number, number, number], max: [number, number, number], subdivY = 1) {
  // subdivided along y so thin parts have vertices all the way down
  const base = positions.length / 3
  const rows = subdivY + 1
  for (let r = 0; r < rows; r++) {
    const y = max[1] - (max[1] - min[1]) * (r / subdivY)
    positions.push(min[0], y, min[2], max[0], y, min[2], max[0], y, max[2], min[0], y, max[2])
  }
  const v = (r: number, c: number) => base + r * 4 + (c % 4)
  for (let r = 0; r < subdivY; r++) for (let c = 0; c < 4; c++) {
    indices.push(v(r, c), v(r + 1, c), v(r + 1, c + 1), v(r, c), v(r + 1, c + 1), v(r, c + 1))
  }
  indices.push(v(0, 0), v(0, 1), v(0, 2), v(0, 0), v(0, 2), v(0, 3))
  indices.push(v(subdivY, 0), v(subdivY, 2), v(subdivY, 1), v(subdivY, 0), v(subdivY, 3), v(subdivY, 2))
  return { from: base, to: positions.length / 3 }
}

/**
 * A cape: a 6 mm sheet the width of the body, fused to the body's top back edge (its first row of inner
 * vertices is the body's corners), leaning away from the back and hanging 0.6 down.
 */
function cape(positions: number[], indices: number[]) {
  const base = positions.length / 3
  const ROWS = 24
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS
    const y = 1 - 0.6 * t
    const inner = r === 0 ? -0.08 : -0.08 - 0.07 * Math.min(1, t * 3)
    const outer = inner - 0.006
    positions.push(-0.1, y, inner, 0.1, y, inner, 0.1, y, outer, -0.1, y, outer)
  }
  const v = (r: number, c: number) => base + r * 4 + (c % 4)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < 4; c++) indices.push(v(r, c), v(r + 1, c), v(r + 1, c + 1), v(r, c), v(r + 1, c + 1), v(r, c + 1))
  indices.push(v(0, 0), v(0, 1), v(0, 2), v(0, 0), v(0, 2), v(0, 3))
  indices.push(v(ROWS, 0), v(ROWS, 2), v(ROWS, 1), v(ROWS, 0), v(ROWS, 3), v(ROWS, 2))
  return { from: base, to: positions.length / 3 }
}

describe('computeSwayWeights', () => {
  it('keeps a thick body rigid and lets a thin sheet hanging from its back swing, 0 at the seam', () => {
    const positions: number[] = [], indices: number[] = []
    const body = box(positions, indices, [-0.1, 0, -0.08], [0.1, 1, 0.08])
    const sheet = cape(positions, indices)
    const result = computeSwayWeights(new Float32Array(positions), new Uint32Array(indices))
    expect(result).not.toBeNull()
    const w = (i: number) => result!.weights[i * 2]
    for (let i = body.from; i < body.to; i++) expect(w(i)).toBe(0)
    let top = 0, bottom = 0
    for (let i = sheet.from; i < sheet.to; i++) {
      if (positions[i * 3 + 1] > 0.97) top = Math.max(top, w(i))
      if (positions[i * 3 + 1] < 0.41) bottom = Math.max(bottom, w(i))
    }
    expect(top).toBeLessThan(0.05)
    expect(bottom).toBeGreaterThan(0.5)
  })

  it('gives coincident (UV seam) vertices the same weight', () => {
    const positions: number[] = [], indices: number[] = []
    box(positions, indices, [-0.1, 0, -0.08], [0.1, 1, 0.08])
    const sheet = cape(positions, indices)
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
    box(positions, indices, [-0.1, 0, -0.08], [0.1, 1, 0.08])
    expect(computeSwayWeights(new Float32Array(positions), new Uint32Array(indices))).toBeNull()
  })
})
