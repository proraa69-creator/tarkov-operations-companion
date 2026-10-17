import { describe, expect, it } from 'vitest'
import { favoriteChange, type FavoriteBuild } from './buildFavorites'

const saved: FavoriteBuild = { weaponId: 'm4', tier: 'top', savedAt: '2026-10-10T00:00:00.000Z', parts: ['a', 'b', 'c'], price: 300_000, ergonomics: 90, recoilVertical: 70, recoilHorizontal: 200 }

describe('favorite builds: what changed since saved', () => {
  it('a small price move is not a change', () => {
    expect(favoriteChange(saved, { ...saved, price: 305_000 })).toBeUndefined()
  })
  it('a replaced part, a big price move or new stats are', () => {
    expect(favoriteChange(saved, { ...saved, parts: ['a', 'b', 'd'] })).toMatchObject({ added: ['d'], removed: ['c'] })
    expect(favoriteChange(saved, { ...saved, price: 340_000 })).toMatchObject({ priceDelta: 40_000 })
    expect(favoriteChange(saved, { ...saved, ergonomics: 85 })).toMatchObject({ ergonomicsDelta: -5 })
  })
})
