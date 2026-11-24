import { describe, expect, it } from 'vitest'
import { installRichMotion, numberFrames } from './richMotion'

const NBSP = String.fromCharCode(160)

describe('the PC app in motion (owner, 18.11.2026)', () => {
  it('a number counts up written as the page writes it: grouping, decimals, signs around it', () => {
    const grouped = numberFrames(`275${NBSP}000 ₽`)!
    expect(grouped.value).toBe(275000)
    expect(grouped.write(0)).toBe('0 ₽')
    expect(grouped.write(12345.6)).toBe(`12${NBSP}346 ₽`)
    expect(grouped.write(275000)).toBe(`275${NBSP}000 ₽`)
    const percent = numberFrames('68%')!
    expect(percent.write(34)).toBe('34%')
    const decimal = numberFrames(' 24,8 °Bx')!
    expect(decimal.value).toBeCloseTo(24.8)
    expect(decimal.write(12.34)).toBe(' 12,3 °Bx')
    expect(numberFrames('+1 sent')).toBeNull()
    expect(numberFrames('1')).toBeNull()
    expect(numberFrames('Таможня')).toBeNull()
    expect(numberFrames('01:29')).toBeNull()
  })

  it('marks the document while on, and leaves nothing behind when turned off', () => {
    const off = installRichMotion()
    expect(document.documentElement.hasAttribute('data-rich-motion')).toBe(true)
    off()
    expect(document.documentElement.hasAttribute('data-rich-motion')).toBe(false)
  })
})
