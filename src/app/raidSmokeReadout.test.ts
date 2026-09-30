import { describe, expect, it } from 'vitest'
import { DEFAULT_SMOKE_OPTIONS } from './raidSmokeSetting'
import { smokeHex, smokeSummary } from './raidSmokeReadout'

describe('smoke readout', () => {
  it('turns hue and tone into the colour of the settings dot', () => {
    expect(smokeHex(0, 0)).toBe('#e72323') // hsl(0 80% 52%) = rgb(231 35 35)
    expect(smokeHex(120, 0)).toBe('#23e723')
    expect(smokeHex(240, 0)).toBe('#2323e7')
    expect(smokeHex(0, 1)).toBe('#f7baba') // tone +1 → 85% lightness
    expect(smokeHex(0, -1)).toBe('#490808') // tone −1 → 16% lightness
  })

  it('lists every value in one line', () => {
    expect(smokeSummary(DEFAULT_SMOKE_OPTIONS)).toBe('width=1.00 speed=1.00 hue=115 (#33e723) tone=0.00 gradient=off topHue=55 (#e7d623)')
  })
})
