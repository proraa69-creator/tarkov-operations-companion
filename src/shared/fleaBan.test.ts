import { describe, expect, it } from 'vitest'
import { fleaPriceOf } from '../data/catalogSource'
import { FLEA_OFFERS_PROOF_MS, fleaBanned, seenOnFleaLately } from './fleaBan'

/**
 * Report 240 (25.11.2026): «После обновления патроны продаются на барахолке. M80, M856A1, CBJ…». The game's update opened the
 * flea to most cartridges in PvP and PvE; tarkov.dev's scanner saw their offers the same day while its `noFlea` mark stayed.
 */
const NOW = Date.parse('2026-11-25T14:00:00.000Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('fleaBanned: the market decides over a lagging mark', () => {
  it('an item marked noFlea that the scanner saw on sale lately is on the flea (M80 on 25.11.2026)', () => {
    expect(fleaBanned({ types: ['ammo', 'noFlea'], lastOfferCount: 57, lastScan: ago(60) }, NOW)).toBe(false)
    expect(seenOnFleaLately({ lastOfferCount: 12, lastScan: NOW - 30 * 60_000 }, NOW)).toBe(true)
  })

  it('the mark stands without fresh offers: none seen, or the last ones from before the ban (M62 Tracer: 14.11.2025)', () => {
    expect(fleaBanned({ types: ['ammo', 'noFlea'], lastOfferCount: 34, lastScan: '2025-11-14T10:28:00.000Z' }, NOW)).toBe(true)
    expect(fleaBanned({ types: ['ammo', 'noFlea'], lastOfferCount: 0, lastScan: ago(10) }, NOW)).toBe(true)
    expect(fleaBanned({ types: ['ammo', 'noFlea'] }, NOW)).toBe(true)
    expect(fleaBanned({ types: ['ammo', 'noFlea'], lastOfferCount: 5, lastScan: new Date(NOW - FLEA_OFFERS_PROOF_MS - 60_000).toISOString() }, NOW)).toBe(true)
    // A scan time ahead of the clock proves nothing.
    expect(fleaBanned({ types: ['noFlea'], lastOfferCount: 5, lastScan: new Date(NOW + 60 * 60_000).toISOString() }, NOW)).toBe(true)
  })

  it('an unmarked item is never banned', () => {
    expect(fleaBanned({ types: ['ammo'] }, NOW)).toBe(false)
    expect(fleaBanned({}, NOW)).toBe(false)
  })

  it('the catalog gives a marked item seen on sale lately its flea price', () => {
    const m80 = { types: ['ammo', 'noFlea'], lastLowPrice: 2000, avg24hPrice: 2315, lastOfferCount: 57, lastScan: new Date(Date.now() - 60 * 60_000).toISOString() }
    expect(fleaPriceOf(m80)?.price).toBe(2000)
    expect(fleaPriceOf({ ...m80, lastScan: '2025-11-14T10:28:00.000Z' })).toBeUndefined()
  })
})
