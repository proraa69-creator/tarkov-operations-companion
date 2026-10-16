import { describe, expect, it } from 'vitest'
import { POSITION_PROBLEM_TEXT, positionProblem } from './positionReadiness'

describe('why the dot cannot appear on «Карты»', () => {
  it('only a game without a «Скриншот» key stops it: no key of the app is involved since the in-game minimap went', () => {
    expect(positionProblem({ key: { keys: ['Print'], unbound: false } })).toBeNull()
    expect(positionProblem({ key: { keys: ['LeftAlt', 'M'], unbound: false } })).toBeNull()
    expect(positionProblem({ key: { keys: [], unbound: true } })).toBe('no-key')
  })

  it('has words for the problem, and they say nothing about the app pressing keys or drawing over the game', () => {
    for (const text of Object.values(POSITION_PROBLEM_TEXT)) {
      expect(text.title.length).toBeGreaterThan(5)
      expect(`${text.title} ${text.text}`).not.toMatch(/нажима|нажать|мини-карт|поверх|оверле/)
    }
  })
})
