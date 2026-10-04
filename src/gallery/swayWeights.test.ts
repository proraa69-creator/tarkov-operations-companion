import { describe, expect, it } from 'vitest'
import { computeSwayWeights } from './swayWeights'
import { body, cape } from './testModels'

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

  it('holds a rigid hint box still and swings a whole-piece box about its pivot', () => {
    const positions: number[] = [], indices: number[] = []
    const column = body(positions, indices)
    const sheet = cape(positions, indices, column)
    // the model is 1 tall and centred on x = 0, z ≈ 0: hint boxes are in the same units
    const rigid = computeSwayWeights(new Float32Array(positions), new Uint32Array(indices), { hints: { rigid: [[-0.2, 0.3, -0.3, 0.2, 0.7, 0]] } })!
    for (let i = sheet.from; i < sheet.to; i++) if (positions[i * 3 + 1] > 0.33 && positions[i * 3 + 1] < 0.67) expect(rigid.weights[i * 2]).toBe(0)
    const whole = computeSwayWeights(new Float32Array(positions), new Uint32Array(indices), { hints: { pieces: [{ box: [-0.2, 0.3, -0.3, 0.2, 0.9, -0.105], pivot: [0, 0.9, -0.1] }] } })!
    expect(whole.parts).toBeDefined()
    const inside = sheet.to - 2
    expect(whole.parts![inside * 4 + 3]).toBeCloseTo(1)
    expect(whole.parts![inside * 4 + 1]).toBeCloseTo(0.9)
    // the body column never becomes part of the piece
    for (let i = column.from; i < column.to; i++) expect(whole.parts![i * 4 + 3]).toBe(0)
  })

  it('returns null for a model without loose parts', () => {
    const positions: number[] = [], indices: number[] = []
    body(positions, indices)
    expect(computeSwayWeights(new Float32Array(positions), new Uint32Array(indices))).toBeNull()
  })
})
