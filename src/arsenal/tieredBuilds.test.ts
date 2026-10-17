import { describe, expect, it } from 'vitest'
import { pickTier, prune, partScore } from './tieredBuilds'

describe('three builds of a weapon', () => {
  it('scores recoil reduction and ergonomics', () => {
    expect(partScore({ recoilModifier: -0.1, ergonomics: 10 })).toBeCloseTo(17)
  })
  it('keeps only the builds nobody beats on price and score', () => {
    expect(prune([{ cost: 10, score: 5 }, { cost: 20, score: 4 }, { cost: 30, score: 9 }, { cost: 5, score: 1 }])).toEqual([{ cost: 5, score: 1 }, { cost: 10, score: 5 }, { cost: 30, score: 9 }])
  })
  it('top takes a much cheaper build 1–2 points lower, never below the middle one', () => {
    const front = [{ cost: 50_000, score: 40 }, { cost: 150_000, score: 70 }, { cost: 160_000, score: 78.5 }, { cost: 400_000, score: 80 }]
    expect(pickTier(front, 'top')).toEqual({ cost: 160_000, score: 78.5 })
    expect(pickTier(front, 'budget')).toEqual({ cost: 50_000, score: 40 })
  })
})
