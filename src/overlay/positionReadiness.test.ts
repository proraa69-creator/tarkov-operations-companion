import { describe, expect, it } from 'vitest'
import { POSITION_PROBLEM_TEXT, positionFix, positionProblem, type PositionReadinessInput } from './positionReadiness'

const ready: PositionReadinessInput = {
  native: true,
  key: { keys: ['Print'], unbound: false, sendable: true },
  snipping: 'off',
  elevated: true,
  gameKeys: 'visible',
}

describe('why the dot cannot appear on the minimap', () => {
  it('is ready with PrtSc when Windows does not open the Snipping Tool on it', () => {
    expect(positionProblem(ready)).toBeNull()
    expect(positionProblem({ ...ready, snipping: 'unknown' })).toBeNull()
  })
  it('names the Snipping Tool only for PrtSc, and offers to fix it', () => {
    expect(positionProblem({ ...ready, snipping: 'on' })).toBe('snipping')
    expect(positionFix('snipping')).toBe('snipping')
    expect(positionProblem({ ...ready, snipping: 'on', key: { keys: ['F12'], unbound: false, sendable: true } })).toBeNull()
  })
  it('asks for a game key when none is bound or it is a mouse button', () => {
    expect(positionProblem({ ...ready, key: { keys: [], unbound: true, sendable: false } })).toBe('no-key')
    expect(positionProblem({ ...ready, key: { keys: ['Mouse4'], unbound: false, sendable: false } })).toBe('mouse-key')
    expect(positionFix('no-key')).toBeNull()
  })
  it('asks for administrator rights only when the game keys are proven hidden', () => {
    expect(positionProblem({ ...ready, elevated: false, gameKeys: 'hidden' })).toBe('admin')
    expect(positionProblem({ ...ready, elevated: false, gameKeys: 'unknown' })).toBeNull()
    expect(positionFix('admin')).toBe('admin')
  })
  it('puts the missing Windows module first', () => {
    expect(positionProblem({ ...ready, native: false, snipping: 'on' })).toBe('no-native')
  })
  it('has words for every problem', () => {
    for (const text of Object.values(POSITION_PROBLEM_TEXT)) {
      expect(text.title.length).toBeGreaterThan(5)
      expect(text.text.length).toBeGreaterThan(20)
      expect(text.short.startsWith('нет позиции')).toBe(true)
    }
  })
})
