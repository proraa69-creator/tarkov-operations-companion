import { describe, expect, it } from 'vitest'
import { fleaMarketFee, fleaNetProceeds } from './fleaFee'

describe('fleaMarketFee (EFT wiki formula)', () => {
  it('charges Ti + Tr of the price when listing at the base price', () => {
    // P0 = PR = 0 → V0·0.03 + VR·0.03
    expect(fleaMarketFee(10_000, 10_000)).toBe(600)
  })

  it('applies the 1.08 exponent to the side that is above the base price', () => {
    // VR = 2·V0: P0 = log10(0.5) (plain), PR = log10(2)^1.08
    const expected = 10_000 * 0.03 * Math.pow(4, Math.log10(0.5)) + 20_000 * 0.03 * Math.pow(4, Math.pow(Math.log10(2), 1.08))
    expect(fleaMarketFee(10_000, 20_000)).toBe(Math.round(expected))
    expect(fleaMarketFee(10_000, 20_000)).toBe(1074)
    // VR = V0/2: P0 = log10(2)^1.08, PR = log10(0.5) (plain)
    expect(fleaMarketFee(10_000, 5_000)).toBe(537)
  })

  it('grows with the asking price and scales with quantity', () => {
    expect(fleaMarketFee(10_000, 40_000)).toBeGreaterThan(fleaMarketFee(10_000, 20_000))
    expect(fleaMarketFee(10_000, 20_000, { count: 3 })).toBe(Math.round(3 * 1074.4))
  })

  it('takes 30% off with Intelligence Center level 3, more with Hideout Management', () => {
    const plain = 10_000 * 0.03 * Math.pow(4, Math.log10(0.5)) + 20_000 * 0.03 * Math.pow(4, Math.pow(Math.log10(2), 1.08))
    expect(fleaMarketFee(10_000, 20_000, { intelCenterLevel: 2 })).toBe(1074)
    expect(fleaMarketFee(10_000, 20_000, { intelCenterLevel: 3 })).toBe(Math.round(plain * 0.7))
    expect(fleaMarketFee(10_000, 20_000, { intelCenterLevel: 3, hideoutManagementLevel: 50 })).toBe(Math.round(plain * (1 - 0.3 * 1.5)))
  })

  it('uses the mode-specific fee rates when given', () => {
    expect(fleaMarketFee(10_000, 10_000, { offerFeeRate: 0.05, requirementFeeRate: 0.05 })).toBe(1000)
  })

  it('returns 0 for missing prices and nets the proceeds', () => {
    expect(fleaMarketFee(0, 10_000)).toBe(0)
    expect(fleaMarketFee(10_000, 0)).toBe(0)
    expect(fleaNetProceeds(10_000, 20_000)).toBe(20_000 - 1074)
    expect(fleaNetProceeds(10_000, 20_000, { count: 2 })).toBe(40_000 - fleaMarketFee(10_000, 20_000, { count: 2 }))
  })
})
