import { describe, expect, it } from 'vitest'
import { handActionRecent, markHandAction } from './handControlGuard'

describe('hand control focus guard', () => {
  it('is open until a hand action, closed shortly after, then open again', () => {
    expect(handActionRecent(1_000)).toBe(false)
    markHandAction(10_000)
    expect(handActionRecent(10_500)).toBe(true)
    expect(handActionRecent(11_199)).toBe(true)
    expect(handActionRecent(11_200)).toBe(false)
  })
})
