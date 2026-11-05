import { describe, expect, it } from 'vitest'
import { INTERCHANGE_SHOP_SIGNS, shopSignsOf, signLines } from './interchangeShopSigns'

describe('Развязка shop signs', () => {
  it('only on Развязка\'s 2nd and 3rd floor, each floor its own shops', () => {
    const second = shopSignsOf('interchange', 'First_Floor').map((sign) => sign.name)
    const third = shopSignsOf('interchange', 'Second_Floor').map((sign) => sign.name)
    expect(second).toEqual(expect.arrayContaining(['OLI', 'IDEA', 'Goshan', 'Mantis', 'Book Store', 'Kiba']))
    expect(third).toEqual(expect.arrayContaining(['McDaniels', 'Tarducks', 'АПТЕКА', 'TECHLIGHT']))
    expect(second.some((name) => third.includes(name))).toBe(false)
    expect(shopSignsOf('interchange', undefined)).toEqual([])
    expect(shopSignsOf('interchange', 'Ground_Level')).toEqual([])
    expect(shopSignsOf('customs', 'First_Floor')).toEqual([])
  })

  it('every sign has a size, colours and text; plates of one floor never overlap', () => {
    for (const sign of INTERCHANGE_SHOP_SIGNS) {
      expect(sign.sign.trim()).not.toBe('')
      expect(sign.w).toBeGreaterThan(0)
      expect(sign.h).toBeGreaterThan(0)
      expect(signLines(sign).length).toBeLessThanOrEqual(2)
      expect(sign.bg).toMatch(/^#[0-9a-f]{6}$/)
      expect(sign.fg).toMatch(/^#[0-9a-f]{6}$/)
    }
    for (const a of INTERCHANGE_SHOP_SIGNS) for (const b of INTERCHANGE_SHOP_SIGNS) {
      if (a === b || a.floor !== b.floor) continue
      const apart = Math.abs(a.x - b.x) * 2 >= a.w + b.w - 0.2 || Math.abs(a.z - b.z) * 2 >= a.h + b.h - 0.2
      expect(apart, `${a.name} / ${b.name}`).toBe(true)
    }
  })
})
