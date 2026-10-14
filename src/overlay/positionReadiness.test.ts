import { describe, expect, it } from 'vitest'
import { POSITION_PROBLEM_TEXT, positionFix, positionProblem, type PositionReadinessInput } from './positionReadiness'

// owner, 14.10.2026: «сделай что бы человек билдил кнопку в игре одну и туже куда он билдит миникарту в приложении».
const ready: PositionReadinessInput = {
  native: true,
  key: { keys: ['M'], unbound: false },
  minimapKey: 'KeyM',
  elevated: true,
  gameKeys: 'visible',
}

describe('why the dot cannot appear on the minimap', () => {
  it('is ready when the game\'s «Скриншот» is the minimap\'s key, whatever kind of key it is', () => {
    expect(positionProblem(ready)).toBeNull()
    expect(positionProblem({ ...ready, key: { keys: ['F12'], unbound: false }, minimapKey: 'F12' })).toBeNull()
    expect(positionProblem({ ...ready, key: { keys: ['Alpha5'], unbound: false }, minimapKey: 'Digit5' })).toBeNull()
    // Unity's Mouse3 is the back side button, the app's «Мышь 4».
    expect(positionProblem({ ...ready, key: { keys: ['Mouse3'], unbound: false }, minimapKey: 'Mouse4' })).toBeNull()
  })

  it('asks for the minimap key in the game when the screenshot is on another one (PrtSc, the default, too)', () => {
    expect(positionProblem({ ...ready, key: { keys: ['Print'], unbound: false } })).toBe('other-key')
    expect(positionProblem({ ...ready, key: { keys: ['LeftAlt', 'M'], unbound: false } })).toBe('other-key')
    expect(positionProblem({ ...ready, key: { keys: [], unbound: true } })).toBe('no-key')
  })

  it('offers the other way round only for a key the app can watch and no other function has', () => {
    expect(positionFix('other-key', ['F12'])).toBe('use-game-key')
    expect(positionFix('other-key', ['Print'])).toBeNull()
    expect(positionFix('other-key', ['LeftAlt', 'F12'])).toBeNull()
    expect(positionFix('other-key', ['Semicolon'], ['Semicolon'])).toBeNull()
    expect(positionFix('no-key')).toBeNull()
  })

  it('asks for administrator rights only when the game keys are proven hidden', () => {
    expect(positionProblem({ ...ready, elevated: false, gameKeys: 'hidden' })).toBe('admin')
    expect(positionProblem({ ...ready, elevated: false, gameKeys: 'unknown' })).toBeNull()
    expect(positionFix('admin')).toBe('admin')
  })

  it('puts the missing Windows module first', () => {
    expect(positionProblem({ ...ready, native: false, key: { keys: [], unbound: true } })).toBe('no-native')
  })

  it('has words for every problem, and none says the app presses a key', () => {
    for (const text of Object.values(POSITION_PROBLEM_TEXT)) {
      expect(text.title.length).toBeGreaterThan(5)
      expect(text.text.length).toBeGreaterThan(20)
      expect(text.short.length).toBeGreaterThan(10)
      expect(`${text.title} ${text.text} ${text.short}`).not.toMatch(/нажимает клавишу скриншота|нажать/)
    }
  })
})
