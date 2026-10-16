import { afterEach, describe, expect, it } from 'vitest'
import { FRIEND_COLORS, friendColors } from './friendColors'

afterEach(() => localStorage.clear())

describe('friend colours', () => {
  it('gives every friend a different colour and keeps it when others come and go', () => {
    const first = friendColors(['a', 'b', 'c'])
    expect(new Set(first.values()).size).toBe(3)
    // «b» is removed, «d» added: «a» and «c» keep theirs, «d» takes a free one.
    const next = friendColors(['a', 'c', 'd'])
    expect(next.get('a')).toBe(first.get('a'))
    expect(next.get('c')).toBe(first.get('c'))
    expect(new Set(next.values()).size).toBe(3)
  })

  it('spreads more friends than colours over the palette', () => {
    const ids = Array.from({ length: FRIEND_COLORS.length + 2 }, (_, index) => `f${index}`)
    const colors = friendColors(ids)
    expect(new Set(colors.values()).size).toBe(FRIEND_COLORS.length)
  })
})
