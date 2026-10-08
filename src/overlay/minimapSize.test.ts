import { expect, it } from 'vitest'
import { minimapWidth } from './minimapSize'
it('keeps old settings at 420px and constrains the resize control', () => {
  for (const value of [undefined, null, '', NaN, 'invalid']) expect(minimapWidth(value)).toBe(420)
  expect(minimapWidth(100)).toBe(280)
  expect(minimapWidth(950)).toBe(720)
  expect(minimapWidth(520)).toBe(520)
})
