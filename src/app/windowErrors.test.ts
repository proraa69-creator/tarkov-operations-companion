import { describe, expect, it } from 'vitest'
import { isBenignWindowError } from './windowErrors'

describe('window errors that never stop the app', () => {
  it('takes the ResizeObserver loop notices for harmless', () => {
    expect(isBenignWindowError('ResizeObserver loop completed with undelivered notifications.')).toBe(true)
    expect(isBenignWindowError(new Error('ResizeObserver loop limit exceeded'))).toBe(true)
  })

  it('keeps every other error', () => {
    expect(isBenignWindowError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isBenignWindowError(undefined)).toBe(false)
  })
})
